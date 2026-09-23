-- ═══════════════════════════════════════════════════════════════════════════
-- 0357 · THE COMMISSIONER REDRAWS A WEEK
--
-- Item 5 of the commissioner list: swap two teams' opponents in a week that
-- hasn't started. X played A and Y played B; now Y plays A and X plays B. In
-- an odd league, a team on BYE (no matchup row, 0247) can be swapped in: it
-- takes the other team's game, and that team takes the bye.
--
-- ── ONLY BEFORE IT STARTS ──────────────────────────────────────────────────
-- Both games must still be `scheduled`, the week's first kickoff must still be
-- ahead, and neither can be a playoff game. The bracket is its own seeding,
-- and item 7 is the tool for that.
--
-- ── WHAT MOVES WITH A TEAM ─────────────────────────────────────────────────
-- A lineup is saved against a MATCHUP (sealed_pick.matchup_id), so each team's
-- saved picks move with it into its new game, untouched. The four lock
-- triggers are passed with 0356's switch, because nothing about the picks
-- changes. A team that goes to a bye has its picks removed: a lineup left in
-- a game its author no longer plays is an orphan, and the resolver ADOPTS a
-- lone orphan (resolve.js, assignSealedRows). A drip power-up armed or bought
-- for a game (applied_state, hero_applied, the pots) was aimed at the old
-- opponent and can't follow. So a swap touching either game is refused while
-- any exist, and the answer says why.
--
-- ── WHAT THE LEAGUE SEES ───────────────────────────────────────────────────
-- A reason is required. `schedule_edit_log` keeps both games before and
-- after, and one chat line gives the new pairings.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists schedule_edit_log (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references league(id) on delete cascade,
  week       int  not null,
  before     jsonb not null,
  after      jsonb not null,
  note       text not null,
  set_by     uuid,
  set_at     timestamptz not null default now()
);
alter table schedule_edit_log enable row level security;
drop policy if exists schedule_edit_log_read on schedule_edit_log;
create policy schedule_edit_log_read on schedule_edit_log for select using (is_league_member(league_id));

-- Why a week can't be redrawn, or null.
create or replace function _week_redraw_blocker(p_league_id uuid, p_week int) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from matchup where league_id = p_league_id and week = p_week)
      then 'week ' || p_week || ' has no games'
    when exists (select 1 from matchup where league_id = p_league_id and week = p_week and is_playoff)
      then 'week ' || p_week || ' is a playoff week — the bracket follows the seeds'
    when exists (select 1 from matchup where league_id = p_league_id and week = p_week and status <> 'scheduled')
      then 'week ' || p_week || ' has started'
    when coalesce(window_kickoff(p_week, 'wk') <= now(), false)
      then 'week ' || p_week || ' has kicked off'
  end;
$$;
revoke all on function _week_redraw_blocker(uuid, int) from public, anon, authenticated;

-- The weeks still open to redraw, each with its games and its byes.
create or replace function commish_open_schedule(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  return jsonb_build_object('ok', true, 'weeks', coalesce((
    select jsonb_agg(jsonb_build_object('week', w.week,
      'games', (select jsonb_agg(jsonb_build_object('id', m.id,
                  'home', jsonb_build_object('roster_id', m.home_roster_id, 'name', _txn_team(p_league_id, m.home_roster_id)),
                  'away', jsonb_build_object('roster_id', m.away_roster_id, 'name', _txn_team(p_league_id, m.away_roster_id)))
                  order by m.created_at, m.id)
                  from matchup m where m.league_id = p_league_id and m.week = w.week),
      'byes', coalesce((select jsonb_agg(jsonb_build_object('roster_id', lm.sleeper_roster_id, 'name', _txn_team(p_league_id, lm.sleeper_roster_id))
                  order by lm.sleeper_roster_id)
                  from league_membership lm
                 where lm.league_id = p_league_id and lm.sleeper_roster_id is not null
                   and not exists (select 1 from matchup m where m.league_id = p_league_id and m.week = w.week
                                     and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id))), '[]'::jsonb))
      order by w.week)
      from (select distinct week from matchup where league_id = p_league_id) w
     where _week_redraw_blocker(p_league_id, w.week) is null), '[]'::jsonb));
end $$;
grant execute on function commish_open_schedule(uuid) to authenticated;

create or replace function _week_games(p_league_id uuid, p_week int, p_ids uuid[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'home', home_roster_id, 'away', away_roster_id) order by id), '[]'::jsonb)
    from matchup where league_id = p_league_id and week = p_week and id = any(p_ids);
$$;
revoke all on function _week_games(uuid, int, uuid[]) from public, anon, authenticated;

create or replace function commish_swap_opponents(p_league_id uuid, p_week int, p_a int, p_b int, p_note text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare why text := nullif(btrim(coalesce(p_note, '')), ''); blk text; ma uuid; mb uuid; ua uuid; ub uuid;
        before jsonb; after jsonb; opp_a int; opp_b int; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if why is null then return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason'); end if;
  if p_a is null or p_b is null or p_a = p_b then
    return jsonb_build_object('ok', false, 'error', 'choose two different teams');
  end if;
  if (select count(*) from league_membership where league_id = p_league_id and sleeper_roster_id in (p_a, p_b)) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'both teams must be in this league');
  end if;
  perform pg_advisory_xact_lock(hashtext('redraw:' || p_league_id::text || ':' || p_week));
  blk := _week_redraw_blocker(p_league_id, p_week);
  if blk is not null then return jsonb_build_object('ok', false, 'error', blk); end if;
  if (select count(*) from matchup where league_id = p_league_id and week = p_week and p_a in (home_roster_id, away_roster_id)) > 1
     or (select count(*) from matchup where league_id = p_league_id and week = p_week and p_b in (home_roster_id, away_roster_id)) > 1 then
    return jsonb_build_object('ok', false, 'error', 'a team plays twice that week — fix the schedule by hand');
  end if;
  select id into ma from matchup where league_id = p_league_id and week = p_week and p_a in (home_roster_id, away_roster_id);
  select id into mb from matchup where league_id = p_league_id and week = p_week and p_b in (home_roster_id, away_roster_id);
  if ma is null and mb is null then return jsonb_build_object('ok', false, 'error', 'both teams are on bye that week'); end if;
  if ma = mb then return jsonb_build_object('ok', false, 'error', 'those two already play each other'); end if;
  -- Drip purchases were aimed at the old opponent (see the header).
  if exists (select 1 from applied_state where matchup_id in (ma, mb))
     or exists (select 1 from hero_applied where matchup_id in (ma, mb))
     or exists (select 1 from pot_action where matchup_id in (ma, mb))
     or exists (select 1 from window_pot where matchup_id in (ma, mb)) then
    return jsonb_build_object('ok', false, 'error', 'a power-up is already armed against one of these opponents — it can''t follow a swap');
  end if;

  before := _week_games(p_league_id, p_week, array_remove(array[ma, mb], null));
  ua := _seat_author(p_league_id, p_a);
  ub := _seat_author(p_league_id, p_b);
  if ua = ub and ma is not null and mb is not null then
    return jsonb_build_object('ok', false, 'error', 'one manager holds both teams — their saved picks can''t be told apart');
  end if;
  select case when home_roster_id = p_a then away_roster_id else home_roster_id end into opp_a from matchup where id = ma;
  select case when home_roster_id = p_b then away_roster_id else home_roster_id end into opp_b from matchup where id = mb;

  perform set_config('drip.commish_lineup', 'on', true);
  -- A team going to a bye leaves no lineup behind (the orphan rule).
  if mb is null and ua is not null then delete from sealed_pick where matchup_id = ma and app_user_id = ua; end if;
  if ma is null and ub is not null then delete from sealed_pick where matchup_id = mb and app_user_id = ub; end if;
  -- Each team's saved picks follow it into its new game.
  if ma is not null and mb is not null then
    update sealed_pick set matchup_id = case when matchup_id = ma then mb else ma end
     where (matchup_id = ma and app_user_id = ua) or (matchup_id = mb and app_user_id = ub);
  end if;
  perform set_config('drip.commish_lineup', '', true);
  update matchup set home_roster_id = case when home_roster_id = p_a then p_b else home_roster_id end,
                     away_roster_id = case when away_roster_id = p_a then p_b else away_roster_id end
   where id = ma;
  update matchup set home_roster_id = case when home_roster_id = p_b then p_a else home_roster_id end,
                     away_roster_id = case when away_roster_id = p_b then p_a else away_roster_id end
   where id = mb;
  delete from matchup_state where matchup_id in (ma, mb);

  after := _week_games(p_league_id, p_week, array_remove(array[ma, mb], null));
  insert into schedule_edit_log (league_id, week, before, after, note, set_by)
  values (p_league_id, p_week, before, after, left(why, 200), auth.uid());
  line := '🔀 The commissioner redrew week ' || p_week || ': '
    || concat_ws('; ',
         case when opp_a is not null then _txn_team(p_league_id, p_b) || ' now plays ' || _txn_team(p_league_id, opp_a) end,
         case when opp_b is not null then _txn_team(p_league_id, p_a) || ' now plays ' || _txn_team(p_league_id, opp_b) end,
         case when ma is null then _txn_team(p_league_id, p_b) || ' is on bye' end,
         case when mb is null then _txn_team(p_league_id, p_a) || ' is on bye' end)
    || ' — ' || left(why, 200);
  perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'redraw', 'week', p_week));
  return jsonb_build_object('ok', true, 'note', line, 'games', after);
end $$;
grant execute on function commish_swap_opponents(uuid, int, int, int, text) to authenticated;
