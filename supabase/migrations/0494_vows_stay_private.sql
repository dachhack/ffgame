-- 0494: THE VOWS STAY PRIVATE (v0.706.0). Founder: "The league page doesn't
-- list the pending vows. Those stay private between the teams (and commish)."
--
-- • shotgun_counter no longer posts a league card for new vows; the other
--   team is told on their phone (push_outbox, kind trades). The wedding's
--   filing and its settling stay public, as before.
-- • shotgun_state hands the counter (the new vows on the table) only to the
--   two teams and the commissioner; everyone else reads null there.
-- Bodies copied from 0453 (shotgun_counter) and 0456 (shotgun_state), the live ones.

create or replace function shotgun_counter(p_wedding_id uuid, p_home_gives jsonb, p_away_gives jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype; me int; other int; s text; nh int; na int; owner uuid;
begin
  select * into w from shotgun_wedding where id = p_wedding_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such wedding'); end if;
  me := case when owns_roster(w.league_id, w.home_roster) then w.home_roster
             when owns_roster(w.league_id, w.away_roster) then w.away_roster end;
  if me is null then return jsonb_build_object('ok', false, 'error', 'only the two teams in this wedding can talk terms'); end if;
  if w.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'this wedding is already settled'); end if;
  if w.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'too late — the deadline has passed'); end if;
  nh := case when jsonb_typeof(p_home_gives) = 'array' then jsonb_array_length(p_home_gives) else 0 end;
  na := case when jsonb_typeof(p_away_gives) = 'array' then jsonb_array_length(p_away_gives) else 0 end;
  if nh < 1 or nh > 3 or na < 1 or na > 3 then
    return jsonb_build_object('ok', false, 'error', 'new vows are one to three players each way');
  end if;
  if p_home_gives @> w.home_gives and w.home_gives @> p_home_gives
     and p_away_gives @> w.away_gives and w.away_gives @> p_away_gives then
    return jsonb_build_object('ok', false, 'error', 'that is the original trade — it goes through on its own');
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
  update shotgun_wedding set counter_from = me, counter_home_gives = p_home_gives, counter_away_gives = p_away_gives,
                             counter_at = now()
   where id = w.id;
  other := case when me = w.home_roster then w.away_roster else w.home_roster end;
  -- PRIVATE (0494): no league card — the other team alone is told, on their phone; the league hears of a wedding
  -- when it is filed and when it is settled, not what the two sides say to each other in between.
  select m.app_user_id into owner from league_membership m where m.league_id = w.league_id and m.sleeper_roster_id = other;
  if owner is not null then
    insert into push_outbox (app_user_id, kind, title, body, data, dedupe_key)
    values (owner, 'trades', '💍 New vows from ' || _txn_team(w.league_id, me),
      _wedding_side(w.league_id, w.home_roster, p_home_gives) || '; ' || _wedding_side(w.league_id, w.away_roster, p_away_gives)
        || '. Say yes in My Team › Trades, or the original goes through.',
      jsonb_build_object('league_id', w.league_id, 'open', 'team'),
      'wedding:counter:' || w.id || ':' || extract(epoch from clock_timestamp())::bigint)
    on conflict (dedupe_key) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'counter_from', me);
end $$;

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
             -- PRIVATE (0494): the new vows are the two teams' and the commissioner's
             'counter', case when w.counter_from is null
                              or not (boss or owns_roster(w.league_id, w.home_roster) or owns_roster(w.league_id, w.away_roster)) then null
                        else jsonb_build_object(
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
