-- 0478: SWAP HISTORY (v0.676.0). HANDOFF's sixth not-done item, its middle
-- part: "swap history." A squad is one row (sleeper_lineup.starters_json)
-- rewritten on every save, so nothing remembered who went out for whom, or
-- when — the question a league asks the morning after ("did he really have
-- Lamb before kickoff?"). Now every change to a SAVED squad is a row per spot
-- in contest_swap: the member's own swap, the commissioner's fix (0474) and
-- the worker's auto-sub (0470, kind 'sub', written by contestSubs.js). The
-- first save of a week is not a swap.
--
-- Who reads it: a member reads their own seat's any time; the rest of the
-- league reads a seat's once the week's squads have unsealed — a swap made
-- before kickoff would otherwise give a sealed pick away — through
-- contest_swaps. The commissioner reads any seat any time.

create table if not exists contest_swap (
  id        bigint generated always as identity primary key,
  league_id uuid not null references league(id) on delete cascade,
  week      int  not null,
  roster_id int  not null,
  slot      text not null,
  out_slug  text,
  in_slug   text,
  kind      text not null default 'swap',   -- swap | commish | sub
  by_user   uuid,
  at        timestamptz not null default now()
);
create index if not exists contest_swap_seat_idx on contest_swap (league_id, week, roster_id);
alter table contest_swap enable row level security;   -- read through contest_swaps; the worker writes with the service role

create or replace function _log_contest_swaps(p_league uuid, p_week int, p_roster int, p_old jsonb, p_new jsonb, p_kind text, p_by uuid)
  returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if p_old is null or jsonb_typeof(p_old) <> 'array' or jsonb_array_length(p_old) = 0 then return 0; end if;
  insert into contest_swap (league_id, week, roster_id, slot, out_slug, in_slug, kind, by_user)
  select p_league, p_week, p_roster, s.slot, s.o, s.i, p_kind, p_by
    from (select coalesce(o.slot, i.slot) as slot, o.slug as o, i.slug as i
            from (select e ->> 'slot' as slot, e ->> 'player_slug' as slug from jsonb_array_elements(p_old) e) o
            full join (select e ->> 'slot' as slot, e ->> 'player_slug' as slug from jsonb_array_elements(p_new) e) i on i.slot = o.slot) s
   where s.o is distinct from s.i;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function _log_contest_swaps(uuid, int, int, jsonb, jsonb, text, uuid) from public, anon, authenticated;

create or replace function contest_swaps(p_league uuid, p_week int, p_roster int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; rid int; open_ boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  rid := coalesce(p_roster, me.sleeper_roster_id);
  if rid is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  open_ := rid = me.sleeper_roster_id or is_league_commish(p_league) or is_admin()
           or coalesce(_week_first_lock(lg.season, p_week) <= now(), false);
  if not open_ then return jsonb_build_object('ok', false, 'error', 'a squad''s swaps show once the week''s squads unseal'); end if;
  return jsonb_build_object('ok', true, 'roster_id', rid, 'week', p_week, 'swaps', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'slot', s.slot, 'kind', s.kind, 'at', s.at,
             'out', s.out_slug, 'out_name', case when s.out_slug is null then null else _txn_player(p_league, s.out_slug) end,
             'in', s.in_slug, 'in_name', case when s.in_slug is null then null else _txn_player(p_league, s.in_slug) end) order by s.at desc, s.id desc)
      from contest_swap s where s.league_id = p_league and s.week = p_week and s.roster_id = rid), '[]'::jsonb));
end $$;
revoke all on function contest_swaps(uuid, int, int) from public, anon;
grant execute on function contest_swaps(uuid, int, int) to authenticated;

-- save_contest_entry — 0475's body, logging the swaps.
create or replace function save_contest_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; bad text; chk jsonb;
        spent int := 0; old jsonb; lineup jsonb := '[]'::jsonb; lk timestamptz; budget int; floor_ int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  if lg.contest_week is null and p_week < coalesce(_contest_week(lg.season), 1) then
    return jsonb_build_object('ok', false, 'error', 'that week has been played');
  end if;
  select * into seat from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final'
               and seat.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;
  -- ENTRIES CLOSE AT THE FIRST KICKOFF (0475): no new squad after it. A
  -- squad the worker wrote empty for a no-show (`zero`) counts as none.
  if _contest_entry_deadline(lg) = 'first' and coalesce(jsonb_array_length(old), 0) = 0
     and coalesce(_week_first_lock(p_season, p_week) <= now(), false) then
    return jsonb_build_object('ok', false, 'error', 'entries closed at the week''s first kickoff');
  end if;

  chk := _contest_squad_check(lg, seat.sleeper_roster_id, p_week, p_slots, p_season, old, true);
  if chk ? 'error' then return jsonb_build_object('ok', false, 'error', chk ->> 'error'); end if;
  lineup := chk -> 'lineup'; spent := (chk ->> 'spent')::int; budget := (chk ->> 'budget')::int; floor_ := (chk ->> 'min_spend')::int;

  -- the per-player lock (0093) — AT KICKOFF for a contest league (0470).
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = o ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff <= now())
     and (p_slots ->> (o ->> 'slot')) is distinct from (o ->> 'player_slug');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'locked in — ' || bad || ' can''t be moved or dropped'); end if;
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(lineup) e
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = e ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff <= now())
     and not exists (select 1 from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
                      where o ->> 'player_slug' = e ->> 'player_slug' and o ->> 'slot' = e ->> 'slot');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'game locked — can''t add ' || bad); end if;

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, seat.sleeper_roster_id, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  -- SWAP HISTORY (0478): a change to a saved squad, spot by spot.
  perform _log_contest_swaps(p_league, p_week, seat.sleeper_roster_id, old, lineup, 'swap', auth.uid());
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'budget', budget, 'min_spend', floor_, 'roster_id', seat.sleeper_roster_id);
end $$;

-- commish_set_contest_squad — 0474's body, logging its edit as the seat's history too.
create or replace function commish_set_contest_squad(p_league uuid, p_week int, p_roster int, p_slots jsonb, p_note text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; why text := nullif(btrim(coalesce(p_note, '')), ''); old jsonb; chk jsonb; lineup jsonb;
        ins text[]; outs text[]; stamped boolean; lk timestamptz;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can do this'); end if;
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  if p_week is null or not exists (select 1 from matchup where league_id = p_league and week = p_week) then
    return jsonb_build_object('ok', false, 'error', 'this league has no week ' || coalesce(p_week::text, '?'));
  end if;
  select * into seat from league_membership where league_id = p_league and sleeper_roster_id = p_roster and enrolled;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'no such seat'); end if;
  if why is null then return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason'); end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = p_roster;

  chk := _contest_squad_check(lg, p_roster, p_week, p_slots, lg.season, old, false);
  if chk ? 'error' then return jsonb_build_object('ok', false, 'error', chk ->> 'error'); end if;
  lineup := chk -> 'lineup';

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, p_roster, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  perform _log_contest_swaps(p_league, p_week, p_roster, old, lineup, 'commish', auth.uid());
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(lg.season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, p_roster, p_roster, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  insert into lineup_edit_log (league_id, week, roster_id, before, after, note, set_by)
  values (p_league, p_week, p_roster, coalesce(old, '[]'::jsonb), lineup, left(why, 200), auth.uid());

  select array_agg(_txn_player(p_league, s) order by s) into ins from (
    select x ->> 'player_slug' s from jsonb_array_elements(lineup) x
    except select x ->> 'player_slug' from jsonb_array_elements(coalesce(old, '[]'::jsonb)) x) a;
  select array_agg(_txn_player(p_league, s) order by s) into outs from (
    select x ->> 'player_slug' s from jsonb_array_elements(coalesce(old, '[]'::jsonb)) x
    except select x ->> 'player_slug' from jsonb_array_elements(lineup) x) a;
  select exists (select 1 from matchup where league_id = p_league and week = p_week and p_roster in (home_roster_id, away_roster_id)
                   and home_final is not null and away_final is not null) into stamped;
  if ins is not null or outs is not null then
    perform _chat_house(p_league,
      '🧾 The commissioner set ' || _txn_team(p_league, p_roster) || '''s week ' || p_week || ' squad: '
      || concat_ws('; ', 'in ' || array_to_string(ins, ', '), 'out ' || array_to_string(outs, ', '))
      || ' — ' || left(why, 200),
      jsonb_build_object('kind', 'lineup_fix', 'week', p_week, 'roster_id', p_roster));
  end if;
  return jsonb_build_object('ok', true, 'in', coalesce(to_jsonb(ins), '[]'::jsonb), 'out', coalesce(to_jsonb(outs), '[]'::jsonb),
    'spent', (chk ->> 'spent')::int, 'rescore', stamped);
end $$;
