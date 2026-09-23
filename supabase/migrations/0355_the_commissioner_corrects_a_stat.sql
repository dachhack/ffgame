-- ═══════════════════════════════════════════════════════════════════════════
-- 0355 · THE COMMISSIONER CORRECTS A STAT
--
-- Founder: "Change scoring for a player and restamp?" — item 3 of the
-- commissioner list: points added to or taken from ONE player in ONE week of
-- ONE league, with the reason written down. For the touchdown the feed never
-- credited, the stat correction ESPN posted a week late, the ruling the
-- league made in its group chat.
--
-- ── WHERE IT COUNTS ────────────────────────────────────────────────────────
-- Everywhere a classic week is scored, because it lives in the one function
-- that scores a classic player's week — classicPoints — as a third layer after
-- his flag and the scoped rules (flat, so a bonus multiplier never pays on it):
--   • the worker's classic resolve, so finals, the weekly report and the
--     re-score (0353) all see it;
--   • both classic boards, which install the week's adjustments beside the
--     flags and list them under the board, so board and final agree.
-- It follows his POINTS, so it counts only where his points count: in a
-- starting spot, not on the bench. A best-ball spot picks its player by points
-- after the games, so a correction can change which bench player a best-ball
-- spot takes — exactly as the corrected stat would have.
--
-- ── CLASSIC ONLY ───────────────────────────────────────────────────────────
-- A drip week is a battle of windows and power-ups, not a sum of points; a
-- flat number on one player has no honest meaning there, and a drip week
-- cannot be re-scored afterwards anyway (0353).
--
-- ── A FINISHED WEEK ────────────────────────────────────────────────────────
-- Saving an adjustment on a week whose finals are stamped changes nothing
-- stored until the week is re-scored: the answer says so (`rescore`), and the
-- consoles offer ⟳ RE-SCORE right there. A week still being played picks it up
-- on its next tick, like every other scoring change.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists player_adjustment (
  league_id  uuid not null references league(id) on delete cascade,
  week       int  not null,
  slug       text not null,
  points     numeric(5, 1) not null check (points between -50 and 50 and points <> 0),
  note       text not null,
  set_by     uuid,
  set_at     timestamptz not null default now(),
  primary key (league_id, week, slug)
);
alter table player_adjustment enable row level security;
-- League-visible, like the register: a correction to somebody's score is the
-- league's business. Writes go through the function below only.
drop policy if exists player_adjustment_read on player_adjustment;
create policy player_adjustment_read on player_adjustment for select using (is_league_member(league_id));

-- The week's adjustments, for the boards and the console. p_search (the
-- commissioner's console only) also finds pool players by name to adjust,
-- rostered ones first, each with the team that has him.
create or replace function league_player_adjustments(p_league_id uuid, p_week int default null, p_search text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'adjustments', coalesce((
    select jsonb_agg(jsonb_build_object('week', a.week, 'slug', a.slug, 'name', _txn_player(a.league_id, a.slug),
             'points', a.points, 'note', a.note, 'set_at', a.set_at) order by a.week desc, a.set_at desc)
      from player_adjustment a
     where a.league_id = p_league_id and (p_week is null or a.week = p_week)), '[]'::jsonb),
    'found', case when q is null or not (is_league_commish(p_league_id) or is_admin()) then '[]'::jsonb else coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
                 'owner', case when nr.roster_id is not null then _txn_team(p_league_id, nr.roster_id) end) as x
          from league_pool lp
          left join native_roster nr on nr.league_id = lp.league_id and nr.slug = lp.slug
         where lp.league_id = p_league_id and lp.full_name ilike '%' || q || '%'
         order by (nr.roster_id is null), lp.rank limit 12) s), '[]'::jsonb) end);
end $$;
grant execute on function league_player_adjustments(uuid, int, text) to authenticated;

-- p_points 0 (or null) removes the adjustment.
create or replace function commish_set_player_adjustment(p_league_id uuid, p_week int, p_slug text, p_points numeric, p_note text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare pts numeric := round(coalesce(p_points, 0), 1); why text := nullif(btrim(coalesce(p_note, '')), '');
        had numeric; stamped boolean; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if (select coalesce(settings_json ->> 'game_mode', 'drip') from league where id = p_league_id) <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'point adjustments are for classic leagues — a drip week isn''t a sum of points');
  end if;
  if p_week is null or not exists (select 1 from matchup where league_id = p_league_id and week = p_week) then
    return jsonb_build_object('ok', false, 'error', 'this league has no week ' || coalesce(p_week::text, '?'));
  end if;
  if not exists (select 1 from league_pool where league_id = p_league_id and slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in this league''s pool');
  end if;
  if pts < -50 or pts > 50 then
    return jsonb_build_object('ok', false, 'error', 'an adjustment is between -50 and +50 points');
  end if;
  if pts <> 0 and why is null then
    return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason');
  end if;
  select points into had from player_adjustment where league_id = p_league_id and week = p_week and slug = p_slug;
  if pts = 0 then
    delete from player_adjustment where league_id = p_league_id and week = p_week and slug = p_slug;
    if had is null then return jsonb_build_object('ok', true, 'removed', false); end if;
    line := '✏️ The commissioner removed the week ' || p_week || ' adjustment on ' || _txn_player(p_league_id, p_slug)
      || ' (was ' || case when had > 0 then '+' else '' end || had::text || ')';
  else
    insert into player_adjustment (league_id, week, slug, points, note, set_by)
    values (p_league_id, p_week, p_slug, pts, left(why, 200), auth.uid())
    on conflict (league_id, week, slug) do update
      set points = excluded.points, note = excluded.note, set_by = excluded.set_by, set_at = now();
    line := '✏️ The commissioner adjusted ' || _txn_player(p_league_id, p_slug) || '''s week ' || p_week || ' score by '
      || case when pts > 0 then '+' else '' end || trim(to_char(pts, 'FM990.0')) || ' — ' || left(why, 200);
  end if;
  select exists (select 1 from matchup where league_id = p_league_id and week = p_week
                   and home_final is not null and away_final is not null) into stamped;
  perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'adjust', 'week', p_week, 'slug', p_slug, 'points', pts));
  return jsonb_build_object('ok', true, 'points', pts, 'note', line,
    -- A stamped week keeps its old finals until it is re-scored.
    'rescore', stamped);
end $$;
grant execute on function commish_set_player_adjustment(uuid, int, text, numeric, text) to authenticated;
