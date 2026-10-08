-- 0454: SHOTGUN WEDDING, THE HOUSE RULES (v0.654.0) — docs/shotgun-wedding.md §1.
--
-- Founder: "I'm debating whether the winning or losing team should get the
-- right to decline. Or there should be a right to decline at all? Maybe make
-- it a commish choice along with adjusting the deadline? A later deadline
-- runs into waivers, but it still technically possible" — then "Let's build
-- those options."
--
-- Two commissioner settings, read when a wedding is FILED (a change mid-week
-- leaves that week's weddings as they were announced):
--   · settings_json.shotgun_veto     'winner' (default) | 'loser' | 'none'
--   · settings_json.shotgun_deadline 'tue20' (default, Tue 8 PM ET)
--                                    | 'wed20' (Wed 8 PM ET) | 'thu12' (Thu noon ET)
-- A deadline after the Wednesday waiver run is allowed: a claim that would
-- drop one of the four is refused at the run by drop_lock_reason, like any
-- other locked drop. Whatever the setting, a deadline never lands inside the
-- hour before the next week's first kickoff.
--
-- The row now carries who may call it off (veto_seat) and under which rule,
-- so the card and the decline read the row, not today's settings. `winner`
-- stays the matchup's winner, for display.

alter table shotgun_wedding add column if not exists veto_seat int;
alter table shotgun_wedding add column if not exists veto_rule text not null default 'winner'
  check (veto_rule in ('winner', 'loser', 'none'));
update shotgun_wedding set veto_seat = winner where veto_seat is null and veto_rule = 'winner';

create or replace function _shotgun_veto_rule(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when s in ('winner', 'loser', 'none') then s else 'winner' end
    from (select settings_json ->> 'shotgun_veto' as s from league where id = p_league_id) x;
$$;
create or replace function _shotgun_deadline_rule(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when s in ('tue20', 'wed20', 'thu12') then s else 'tue20' end
    from (select settings_json ->> 'shotgun_deadline' as s from league where id = p_league_id) x;
$$;
/** The deadline for a wedding filed now, under a rule: counted from today's
 *  Eastern date (the worker files Tuesday morning). */
create or replace function _shotgun_deadline_at(p_rule text, p_now timestamptz default now()) returns timestamptz
  language sql stable as $$
  select ((p_now at time zone 'America/New_York')::date
          + case p_rule when 'wed20' then interval '1 day 20 hours'
                        when 'thu12' then interval '2 days 12 hours'
                        else interval '20 hours' end)
         at time zone 'America/New_York';
$$;
/** How the rules read in a sentence: "8 PM ET Tuesday". */
create or replace function _shotgun_deadline_words(p_rule text) returns text
  language sql immutable as $$
  select case p_rule when 'wed20' then '8 PM ET Wednesday' when 'thu12' then 'noon ET Thursday' else '8 PM ET Tuesday' end;
$$;
create or replace function _shotgun_veto_words(p_rule text) returns text
  language sql immutable as $$
  select case p_rule when 'loser' then 'the team that lost can call it off'
                     when 'none' then 'nobody can call it off — only new vows both sides agree to change it'
                     else 'the team that won can call it off' end;
$$;

-- ── filing, under the house rules ─────────────────────────────────────────
-- 0453's body; the deadline and the veto now come from the settings, and the
-- card says which.
create or replace function shotgun_propose(p_league_id uuid, p_week int, p_home int, p_away int,
                                           p_home_gives jsonb, p_away_gives jsonb, p_deadline timestamptz default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare mu matchup%rowtype; why text; dl timestamptz; win int; lose int; veto int; rule text; wid uuid; s text;
        cancelled int := 0; slugs text[]; next_kick timestamptz; tail text;
begin
  if not league_shotgun(p_league_id) then return jsonb_build_object('ok', false, 'error', 'shotgun wedding is off'); end if;
  why := coalesce(_shotgun_ineligible(p_league_id), trade_deadline_error(p_league_id));
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  select * into mu from matchup where league_id = p_league_id and week = p_week
     and home_roster_id = p_home and away_roster_id = p_away;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such matchup'); end if;
  if mu.status <> 'final' or mu.home_final is null or mu.away_final is null then
    return jsonb_build_object('ok', false, 'error', 'that matchup is not final yet');
  end if;
  if coalesce(mu.is_playoff, false) or is_practice_week(p_week) then
    return jsonb_build_object('ok', false, 'error', 'weddings are for regular-season weeks');
  end if;
  if jsonb_typeof(p_home_gives) <> 'array' or jsonb_typeof(p_away_gives) <> 'array'
     or jsonb_array_length(p_home_gives) <> 2 or jsonb_array_length(p_away_gives) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'a wedding is two players each way');
  end if;
  for s in select value from jsonb_array_elements_text(p_home_gives) loop
    if not exists (select 1 from native_roster where league_id = p_league_id and roster_id = p_home and slug = s and spot = 'active') then
      return jsonb_build_object('ok', false, 'error', s || ' is not on the home active roster');
    end if;
  end loop;
  for s in select value from jsonb_array_elements_text(p_away_gives) loop
    if not exists (select 1 from native_roster where league_id = p_league_id and roster_id = p_away and slug = s and spot = 'active') then
      return jsonb_build_object('ok', false, 'error', s || ' is not on the away active roster');
    end if;
  end loop;
  if exists (select 1 from shotgun_wedding where league_id = p_league_id and week = p_week and home_roster = p_home) then
    return jsonb_build_object('ok', false, 'error', 'already married this week');
  end if;
  dl := coalesce(p_deadline, _shotgun_deadline_at(_shotgun_deadline_rule(p_league_id)));
  -- Never inside the hour before the next week's first kickoff: a wedding
  -- must settle before anyone's lineup is spoken for.
  select min(lock_at) into next_kick from matchup
   where league_id = p_league_id and week > p_week and lock_at is not null and lock_at > now();
  if next_kick is not null and dl > next_kick - interval '1 hour' then dl := next_kick - interval '1 hour'; end if;
  if dl < now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'error', 'too late in the day — a wedding needs time to talk');
  end if;
  win := case when golf_beats(p_league_id, mu.home_final, mu.away_final) then p_home
              when golf_beats(p_league_id, mu.away_final, mu.home_final) then p_away end;
  lose := case when win = p_home then p_away when win = p_away then p_home end;
  rule := _shotgun_veto_rule(p_league_id);
  veto := case rule when 'winner' then win when 'loser' then lose end;
  insert into shotgun_wedding (league_id, week, home_roster, away_roster, home_score, away_score, winner,
                               home_gives, away_gives, deadline, veto_seat, veto_rule)
    values (p_league_id, p_week, p_home, p_away, mu.home_final, mu.away_final, win,
            p_home_gives, p_away_gives, dl, veto, rule)
    returning id into wid;

  slugs := array(select value from jsonb_array_elements_text(p_home_gives || p_away_gives));
  with gone as (
    update trade_proposal t set status = 'cancelled', resolved_at = now()
     where t.league_id = p_league_id and t.status in ('pending', 'accepted', 'review')
       and (t.give ?| slugs or t.get ?| slugs
            or exists (select 1 from trade_leg l, jsonb_array_elements(l.send) e
                        where l.trade_id = t.id and e ->> 'slug' = any (slugs)))
    returning 1)
  select count(*) into cancelled from gone;

  tail := case
    when rule = 'none' then 'unless they agree on new vows — nobody can call this one off.'
    when win is null then 'unless they agree on new vows — it was a tie, so nobody can call it off.'
    else 'unless ' || _txn_team(p_league_id, veto) || ', who ' || case rule when 'loser' then 'lost' else 'won' end || ', calls it off.' end;
  perform _chat_house(p_league_id,
    '💍 Shotgun Wedding — ' || _wedding_side(p_league_id, p_home, p_home_gives) || '; '
      || _wedding_side(p_league_id, p_away, p_away_gives) || '. It goes through at '
      || to_char(dl at time zone 'America/New_York', 'FMHH12 AM') || ' ET '
      || trim(to_char(dl at time zone 'America/New_York', 'Day')) || ' '
      || tail
      || case when cancelled > 0 then ' Open offers naming these players were cancelled.' else '' end,
    jsonb_build_object('kind', 'wedding', 'wedding_id', wid, 'week', p_week));
  return jsonb_build_object('ok', true, 'wedding_id', wid, 'winner', win, 'veto', veto, 'veto_rule', rule,
                            'deadline', dl, 'cancelled', cancelled);
end $$;
revoke all on function shotgun_propose(uuid, int, int, int, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function shotgun_propose(uuid, int, int, int, jsonb, jsonb, timestamptz) to service_role;

-- ── calling it off: whoever the row says ──────────────────────────────────
create or replace function shotgun_decline(p_wedding_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype; other int;
begin
  select * into w from shotgun_wedding where id = p_wedding_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such wedding'); end if;
  if w.veto_rule = 'none' then
    return jsonb_build_object('ok', false, 'error', 'nobody can call off a wedding in this league — only new vows both sides agree to change it');
  end if;
  if w.veto_seat is null then return jsonb_build_object('ok', false, 'error', 'it was a tie — nobody can call this one off'); end if;
  if not owns_roster(w.league_id, w.veto_seat) then
    return jsonb_build_object('ok', false, 'error', 'only the team that ' || case w.veto_rule when 'loser' then 'lost' else 'won' end || ' can call it off');
  end if;
  if w.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'this wedding is already settled'); end if;
  if w.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'too late — the deadline has passed'); end if;
  update shotgun_wedding set status = 'declined', settled_at = now() where id = w.id;
  other := case when w.veto_seat = w.home_roster then w.away_roster else w.home_roster end;
  perform _chat_house(w.league_id,
    '💔 ' || _txn_team(w.league_id, w.veto_seat) || ' called off the wedding with ' || _txn_team(w.league_id, other)
      || '. Everyone keeps their players.',
    jsonb_build_object('kind', 'wedding', 'wedding_id', w.id, 'week', w.week));
  return jsonb_build_object('ok', true, 'status', 'declined');
end $$;
grant execute on function shotgun_decline(uuid) to authenticated;

-- ── the switch, with the house rules ──────────────────────────────────────
-- 0453's (uuid, boolean) is replaced: a two-argument call still lands here
-- (both rules default to "leave as is").
drop function if exists set_league_shotgun(uuid, boolean);
create or replace function set_league_shotgun(p_league_id uuid, p_on boolean,
                                              p_veto text default null, p_deadline text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare why text; was boolean; n int := 0; v text := lower(nullif(btrim(coalesce(p_veto, '')), ''));
        d text := lower(nullif(btrim(coalesce(p_deadline, '')), '')); patch jsonb; changed text := '';
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if v is not null and v not in ('winner', 'loser', 'none') then
    return jsonb_build_object('ok', false, 'error', 'who can call it off is winner, loser or none');
  end if;
  if d is not null and d not in ('tue20', 'wed20', 'thu12') then
    return jsonb_build_object('ok', false, 'error', 'the deadline is tue20, wed20 or thu12');
  end if;
  was := league_shotgun(p_league_id);
  if coalesce(p_on, false) then
    why := _shotgun_ineligible(p_league_id);
    if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  end if;
  if v is not null and v is distinct from _shotgun_veto_rule(p_league_id) then changed := changed || ' ' || upper(left(_shotgun_veto_words(v), 1)) || substr(_shotgun_veto_words(v), 2) || '.'; end if;
  if d is not null and d is distinct from _shotgun_deadline_rule(p_league_id) then changed := changed || ' The deadline is ' || _shotgun_deadline_words(d) || '.'; end if;
  patch := jsonb_build_object('shotgun_wedding', coalesce(p_on, false));
  if v is not null then patch := patch || jsonb_build_object('shotgun_veto', v); end if;
  if d is not null then patch := patch || jsonb_build_object('shotgun_deadline', d); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || patch where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if coalesce(p_on, false) and not was then
    perform _chat_house(p_league_id,
      '💍 Shotgun Wedding is on. Every Tuesday morning each matchup''s two teams are handed a fair 2-for-2 trade. '
        || 'It goes through at ' || _shotgun_deadline_words(_shotgun_deadline_rule(p_league_id))
        || ' unless they agree on new vows' || case _shotgun_veto_rule(p_league_id) when 'none' then '' else ' or ' || _shotgun_veto_words(_shotgun_veto_rule(p_league_id)) end
        || '. The four players can''t move until then.'
        || case when _shotgun_deadline_rule(p_league_id) <> 'tue20' then ' Waivers run first, so a claim that would drop one of them fails.' else '' end,
      jsonb_build_object('kind', 'wedding'));
  elsif not coalesce(p_on, false) and was then
    with off as (update shotgun_wedding set status = 'annulled', settled_at = now()
                  where league_id = p_league_id and status = 'pending' returning 1)
    select count(*) into n from off;
    perform _chat_house(p_league_id,
      '💍 Shotgun Wedding is off.' || case when n > 0 then ' This week''s weddings are annulled — everyone keeps their players.' else '' end,
      jsonb_build_object('kind', 'wedding'));
  elsif coalesce(p_on, false) and was and changed <> '' then
    perform _chat_house(p_league_id, '💍 Shotgun Wedding house rules, from next Tuesday:' || changed,
      jsonb_build_object('kind', 'wedding'));
  end if;
  return jsonb_build_object('ok', true, 'shotgun_wedding', coalesce(p_on, false), 'annulled', n,
    'veto', _shotgun_veto_rule(p_league_id), 'deadline', _shotgun_deadline_rule(p_league_id));
end $$;
grant execute on function set_league_shotgun(uuid, boolean, text, text) to authenticated;

-- ── the reader: the rules, and the row's own veto ─────────────────────────
create or replace function shotgun_state(p_league_id uuid, p_week int default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare wk int; out jsonb;
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
             'can_accept', w.status = 'pending' and w.deadline > now() and w.counter_from is not null
                           and owns_roster(w.league_id, case when w.counter_from = w.home_roster then w.away_roster else w.home_roster end),
             'rosters', case when w.status = 'pending'
                              and (owns_roster(w.league_id, w.home_roster) or owns_roster(w.league_id, w.away_roster))
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
