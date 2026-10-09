-- 0456: SHOTGUN WEDDING, THE COMMISSIONER'S HAND (v0.655.0) — docs/shotgun-wedding.md §1.
--
-- Founder: "Let's let commissioner edit and decline for teams vows."
--
-- Two commissioner powers over any pending wedding in the league, whatever
-- the house rules say:
--   · shotgun_commish_edit(wedding, home_gives, away_gives) — rewrite the
--     trade that goes through at the deadline. One to three players each way
--     from the two active rosters (the same bounds as new vows). The lock
--     follows the row, so the players taken out are free at once and the new
--     ones are locked; any new vows on the table were offered against the old
--     terms, so they are cleared; open offers naming the new players are
--     cancelled, as at filing. The deadline and the veto stay as announced.
--   · shotgun_commish_decline(wedding) — call it off for the teams, even
--     under "nobody can call it off", and even on a tie.
-- Both post a card naming the commissioner's hand. The reader marks each
-- pending wedding `can_commish` for the commissioner and hands over both
-- rosters, so the card can compose the edit.

create or replace function shotgun_commish_edit(p_wedding_id uuid, p_home_gives jsonb, p_away_gives jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype; s text; nh int; na int; slugs text[]; cancelled int := 0;
begin
  select * into w from shotgun_wedding where id = p_wedding_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such wedding'); end if;
  if not (is_league_commish(w.league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if w.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'this wedding is already settled'); end if;
  if w.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'too late — the deadline has passed'); end if;
  nh := case when jsonb_typeof(p_home_gives) = 'array' then jsonb_array_length(p_home_gives) else 0 end;
  na := case when jsonb_typeof(p_away_gives) = 'array' then jsonb_array_length(p_away_gives) else 0 end;
  if nh < 1 or nh > 3 or na < 1 or na > 3 then
    return jsonb_build_object('ok', false, 'error', 'the vows are one to three players each way');
  end if;
  if p_home_gives @> w.home_gives and w.home_gives @> p_home_gives
     and p_away_gives @> w.away_gives and w.away_gives @> p_away_gives then
    return jsonb_build_object('ok', false, 'error', 'that is the trade already on the table');
  end if;
  for s in select value from jsonb_array_elements_text(p_home_gives) loop
    if not exists (select 1 from native_roster where league_id = w.league_id and roster_id = w.home_roster and slug = s and spot = 'active') then
      return jsonb_build_object('ok', false, 'error', _txn_player(w.league_id, s) || ' is not on ' || _txn_team(w.league_id, w.home_roster) || '''s active roster');
    end if;
  end loop;
  for s in select value from jsonb_array_elements_text(p_away_gives) loop
    if not exists (select 1 from native_roster where league_id = w.league_id and roster_id = w.away_roster and slug = s and spot = 'active') then
      return jsonb_build_object('ok', false, 'error', _txn_player(w.league_id, s) || ' is not on ' || _txn_team(w.league_id, w.away_roster) || '''s active roster');
    end if;
  end loop;
  update shotgun_wedding set home_gives = p_home_gives, away_gives = p_away_gives,
         counter_from = null, counter_home_gives = null, counter_away_gives = null, counter_at = null
   where id = w.id;
  -- The newly named players are spoken for, as at filing.
  slugs := array(select value from jsonb_array_elements_text(p_home_gives || p_away_gives));
  with gone as (
    update trade_proposal t set status = 'cancelled', resolved_at = now()
     where t.league_id = w.league_id and t.status in ('pending', 'accepted', 'review')
       and (t.give ?| slugs or t.get ?| slugs
            or exists (select 1 from trade_leg l, jsonb_array_elements(l.send) e
                        where l.trade_id = t.id and e ->> 'slug' = any (slugs)))
    returning 1)
  select count(*) into cancelled from gone;
  perform _chat_house(w.league_id,
    '💍 The commissioner rewrote the vows between ' || _txn_team(w.league_id, w.home_roster) || ' and '
      || _txn_team(w.league_id, w.away_roster) || ': ' || _wedding_side(w.league_id, w.home_roster, p_home_gives) || '; '
      || _wedding_side(w.league_id, w.away_roster, p_away_gives) || '. It still goes through at '
      || to_char(w.deadline at time zone 'America/New_York', 'FMHH12 AM') || ' ET '
      || trim(to_char(w.deadline at time zone 'America/New_York', 'Day')) || '.'
      || case when cancelled > 0 then ' Open offers naming these players were cancelled.' else '' end,
    jsonb_build_object('kind', 'wedding', 'wedding_id', w.id, 'week', w.week));
  return jsonb_build_object('ok', true, 'cancelled', cancelled);
end $$;
grant execute on function shotgun_commish_edit(uuid, jsonb, jsonb) to authenticated;

create or replace function shotgun_commish_decline(p_wedding_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype;
begin
  select * into w from shotgun_wedding where id = p_wedding_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such wedding'); end if;
  if not (is_league_commish(w.league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if w.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'this wedding is already settled'); end if;
  if w.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'too late — the deadline has passed'); end if;
  update shotgun_wedding set status = 'declined', settled_at = now(), note = 'called off by the commissioner' where id = w.id;
  perform _chat_house(w.league_id,
    '💔 The commissioner called off the wedding between ' || _txn_team(w.league_id, w.home_roster) || ' and '
      || _txn_team(w.league_id, w.away_roster) || '. Everyone keeps their players.',
    jsonb_build_object('kind', 'wedding', 'wedding_id', w.id, 'week', w.week));
  return jsonb_build_object('ok', true, 'status', 'declined');
end $$;
grant execute on function shotgun_commish_decline(uuid) to authenticated;

-- ── the reader: 0454's, plus the commissioner's hand ──────────────────────
create or replace function shotgun_state(p_league_id uuid, p_week int default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare wk int; out jsonb; boss boolean := is_league_commish(p_league_id) or is_admin();
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  wk := coalesce(p_week, (select max(week) from shotgun_wedding where league_id = p_league_id));
  select coalesce(jsonb_agg(x.j order by x.mine desc, x.home_roster), '[]'::jsonb) into out from (
    select w.home_roster,
           (owns_roster(w.league_id, w.home_roster) or owns_roster(w.league_id, w.away_roster)) as mine,
           jsonb_build_object(
             'id', w.id, 'week', w.week, 'status', w.status, 'deadline', w.deadline, 'note', w.note,
             'home', jsonb_build_object('roster', w.home_roster, 'team', _txn_team(w.league_id, w.home_roster),
                                        'score', w.home_score, 'gives', _wedding_players_json(w.league_id, w.home_gives)),
             'away', jsonb_build_object('roster', w.away_roster, 'team', _txn_team(w.league_id, w.away_roster),
                                        'score', w.away_score, 'gives', _wedding_players_json(w.league_id, w.away_gives)),
             'winner', w.winner, 'veto', w.veto_seat, 'veto_rule', w.veto_rule,
             'counter', case when w.counter_from is null then null else jsonb_build_object(
                 'from', w.counter_from, 'at', w.counter_at,
                 'home_gives', _wedding_players_json(w.league_id, w.counter_home_gives),
                 'away_gives', _wedding_players_json(w.league_id, w.counter_away_gives)) end,
             'my_seat', case when owns_roster(w.league_id, w.home_roster) then w.home_roster
                             when owns_roster(w.league_id, w.away_roster) then w.away_roster end,
             'can_decline', w.status = 'pending' and w.deadline > now() and w.veto_rule <> 'none'
                            and w.veto_seat is not null and owns_roster(w.league_id, w.veto_seat),
             'can_counter', w.status = 'pending' and w.deadline > now()
                            and (owns_roster(w.league_id, w.home_roster) or owns_roster(w.league_id, w.away_roster)),
             'can_commish', boss and w.status = 'pending' and w.deadline > now(),
             'can_accept', w.status = 'pending' and w.deadline > now() and w.counter_from is not null
                           and owns_roster(w.league_id, case when w.counter_from = w.home_roster then w.away_roster else w.home_roster end),
             'rosters', case when w.status = 'pending'
                              and (boss or owns_roster(w.league_id, w.home_roster) or owns_roster(w.league_id, w.away_roster))
               then jsonb_build_object(
                 'home', (select coalesce(jsonb_agg(jsonb_build_object('slug', nr.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team)
                                                    order by lp.rank), '[]'::jsonb)
                            from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
                           where nr.league_id = w.league_id and nr.roster_id = w.home_roster and nr.spot = 'active'),
                 'away', (select coalesce(jsonb_agg(jsonb_build_object('slug', nr.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team)
                                                    order by lp.rank), '[]'::jsonb)
                            from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
                           where nr.league_id = w.league_id and nr.roster_id = w.away_roster and nr.spot = 'active'))
               end) as j
      from shotgun_wedding w where w.league_id = p_league_id and w.week = wk) x;
  return jsonb_build_object('ok', true, 'on', league_shotgun(p_league_id),
    'eligible', _shotgun_ineligible(p_league_id) is null, 'why_not', _shotgun_ineligible(p_league_id),
    'veto_rule', _shotgun_veto_rule(p_league_id), 'deadline_rule', _shotgun_deadline_rule(p_league_id),
    'week', wk, 'weddings', out);
end $$;
grant execute on function shotgun_state(uuid, int) to authenticated, service_role;
