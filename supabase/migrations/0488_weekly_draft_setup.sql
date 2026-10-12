-- 0488: THE WEEKLY DRAFT SETUP (v0.691.0)
--
-- The founder, on the weekly form: "Weekly draft is just NFL. Let's force
-- that. In the league set up, let's have drip coin and power ups as part of
-- the setup for weekly competitions. Let's also have it be all season or one
-- week only with a which week selector. Mark the current week in the
-- selector. Have a box where you can type the budget instead of all the chips.
-- Default the box to $50000."
--
-- Two of those reach the SQL: a one-week league may name ITS WEEK (this
-- week to 18, so a league for the bye-week slate can be made today), and
-- drip coin can be on from creation (the creator's seat seeded here, every
-- later seat by join_contest as before). The NFL rule needs nothing: a
-- contest league reads the NFL slate by construction. The budget box and the
-- week selector are the clients'; `contest_week_now` tells them which week
-- it is. Body copied from the live 0469; a new parameter means drop and
-- recreate, and the grant again.
drop function if exists create_contest_league(text, text, text, text, int, int, text, int, text, text, int);
create or replace function create_contest_league(p_name text, p_contest text default 'high', p_format text default 'board',
    p_span text default 'season', p_max int default 12, p_budget int default 50000,
    p_variant text default 'slots', p_radius int default 10, p_team_name text default null, p_season text default '2026',
    p_min_spend int default 0,
    -- 0488: WHICH WEEK a one-week league plays (this week to 18; null = this
    -- week), and DRIP COIN from the start (the creator's seat is seeded here;
    -- join_contest seeds every later seat, 0483).
    p_week int default null, p_coin boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; cap int; lid uuid; nm text; tm text; lg league; s jsonb; i int;
        names text[] := array['Bench Warmers','Hail Mary Hopefuls','Red Zone Regulars','Two Minute Drill','Garbage Time Gang','Coin Flip Crew',
                              'Punt Return Party','Blitz Brigade','Fourth And Long','Snap Count Crew','End Around Gang','Mud Dogs'];
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  if p_contest not in ('high', 'golf', 'bullseye') then return jsonb_build_object('ok', false, 'error', 'a contest is high, golf or bullseye'); end if;
  if p_format not in ('h2h', 'board') then return jsonb_build_object('ok', false, 'error', 'a format is h2h or board'); end if;
  if p_span not in ('week', 'season') then return jsonb_build_object('ok', false, 'error', 'a league runs one week or the season'); end if;
  if p_variant not in ('slots', 'total') then return jsonb_build_object('ok', false, 'error', 'variant is slots or total'); end if;
  if p_radius is null or p_radius < 2 or p_radius > 50 then return jsonb_build_object('ok', false, 'error', 'radius is 2–50'); end if;
  if p_budget is null or (p_budget <> 0 and (p_budget < 10000 or p_budget > 500000)) then return jsonb_build_object('ok', false, 'error', 'the budget is $10,000–$500,000, or 0 for no cap'); end if;
  if p_min_spend is null or (p_min_spend <> 0 and (p_min_spend < 5000 or p_min_spend > 500000)) then return jsonb_build_object('ok', false, 'error', 'the minimum spend is $5,000–$500,000, or 0 for none'); end if;
  if p_budget > 0 and p_min_spend > p_budget then return jsonb_build_object('ok', false, 'error', 'the minimum spend can''t be above the budget'); end if;
  cap := case when p_format = 'h2h' then 32 else _bullseye_max_cap() end;
  if p_max is null or p_max < 2 or p_max > cap then
    return jsonb_build_object('ok', false, 'error', 'a ' || case when p_format = 'h2h' then 'head-to-head' else 'leaderboard' end || ' league holds 2–' || cap || ' people');
  end if;
  if p_format = 'h2h' and p_max % 2 <> 0 then return jsonb_build_object('ok', false, 'error', 'a head-to-head league needs an even number of teams'); end if;
  wk := _contest_week(p_season);
  if p_span = 'week' and wk is null then return jsonb_build_object('ok', false, 'error', 'no NFL week on the slate right now'); end if;
  if p_span = 'week' and p_week is not null then
    if p_week < wk or p_week > 18 then
      return jsonb_build_object('ok', false, 'error', 'pick a week from this one (week ' || wk || ') to 18');
    end if;
    wk := p_week;
  end if;
  nm := coalesce(nullif(left(btrim(coalesce(p_name, '')), 60), ''),
                 case p_contest when 'golf' then 'Golf DFS' when 'bullseye' then 'Bullseye' else 'DFS' end
                 || case when p_span = 'week' then ' · Week ' || wk else ' League' end);
  s := jsonb_build_object('game_mode', 'classic', 'contest', p_contest, 'contest_format', p_format, 'budget', (p_budget / 100) * 100,
                          'min_spend', (p_min_spend / 100) * 100,
                          'span', p_span, 'max_seats', p_max, 'roster_slots', _contest_default_slots(), 'ppr', 1);
  if p_contest = 'bullseye' then s := s || jsonb_build_object('dfs_bullseye', true, 'bullseye', p_variant, 'bullseye_radius', p_radius); end if;
  if p_contest = 'golf' then s := s || '{"golf": true}'::jsonb; end if;
  if coalesce(p_coin, false) then s := s || '{"coin": true}'::jsonb; end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league (sleeper_league_id, season, name, kind, contest_week, kdst_mode, provider, lineup_policy, commissioner_id, settings_json)
  values ('CON-' || upper(left(md5(gen_random_uuid()::text), 10)), p_season, nm, 'dfs',
          case when p_span = 'week' then wk end, 'off', 'pod', 'empty', auth.uid(), s)
  returning id into lid;
  tm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), _bullseye_default_team(1));
  if p_format = 'h2h' then
    for i in 1..p_max loop
      insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
      values (lid, i, 'CON-AI-' || i, null, false,
              names[1 + ((i - 1) % 12)] || case when i > 12 then ' ' || (1 + (i - 1) / 12) else '' end, 'ai');
    end loop;
    update league_membership set app_user_id = auth.uid(), enrolled = true, controller = 'human', team_name = tm
     where league_id = lid and sleeper_roster_id = 1;
  else
    insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
    values (lid, 1, 'CON-1', auth.uid(), true, tm, 'human');
  end if;
  if coalesce(p_coin, false) then perform _contest_seed_coin(lid, 1); end if;
  select * into lg from league where id = lid;
  return jsonb_build_object('ok', true, 'league_id', lid, 'name', lg.name, 'invite_code', lg.invite_code,
    'roster_id', 1, 'team', tm, 'bullseye', _bullseye_info(lg));
end $$;

grant execute on function create_contest_league(text, text, text, text, int, int, text, int, text, text, int, int, boolean) to authenticated;

-- THE WEEK IT IS, for the form's selector: the first NFL week whose last
-- kickoff is not four hours gone (the rule _contest_week has always used).
create or replace function contest_week_now(p_season text default '2026') returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'week', _contest_week(p_season), 'last', 18);
$$;
grant execute on function contest_week_now(text) to authenticated;
