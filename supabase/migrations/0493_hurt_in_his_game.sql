-- 0493: HURT IN HIS GAME (v0.701.0). Founder: "We need a way to not apply
-- the 0 penalty to players who were injured during their game."
--
-- The dart's −10 is for a no-show. A player who took the field and got hurt
-- posted what he posted; his zero costs no distance. The worker waives it on
-- its own when its injury report dates his designation to his game
-- (server/src/injuries.js hurtInGame); this is the commissioner's hand for
-- what the report misses: a waiver on player_adjustment, the stat-correction
-- row, so the engine reads one cache (commish.ts hurtFor) for both.
--
-- • player_adjustment.hurt — the waiver; a row may carry it at 0 points.
-- • commish_set_player_adjustment gains p_hurt (a new parameter: dropped,
--   recreated, regranted). 0 points + the waiver saves without a reason and
--   tells the chat; 0 and no waiver removes the row as before.
-- • league_player_adjustments returns `hurt` on each row.
-- Bodies copied from 0474 (the live ones).

alter table player_adjustment add column if not exists hurt boolean not null default false;
alter table player_adjustment drop constraint if exists player_adjustment_points_check;
alter table player_adjustment add constraint player_adjustment_points_check
  check (points between -50 and 50 and (points <> 0 or hurt));

create or replace function league_player_adjustments(p_league_id uuid, p_week int default null, p_search text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), ''); lg league; wk int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'adjustments', coalesce((
    select jsonb_agg(jsonb_build_object('week', a.week, 'slug', a.slug, 'name', _txn_player(a.league_id, a.slug),
             'points', a.points, 'note', a.note, 'set_at', a.set_at, 'hurt', a.hurt) order by a.week desc, a.set_at desc)
      from player_adjustment a
     where a.league_id = p_league_id and (p_week is null or a.week = p_week)), '[]'::jsonb),
    'found', case when q is null or not (is_league_commish(p_league_id) or is_admin()) then '[]'::jsonb
      when _is_contest(lg) then coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('slug', ps.slug, 'name', ps.name, 'pos', ps.pos, 'team', ps.team,
                   'owner', case when h.n > 0 then 'in ' || h.n || ' squad' || case when h.n = 1 then '' else 's' end end) as x
            from pod_salary ps
            left join lateral (select count(*) as n from sleeper_lineup sl
                                where sl.league_id = p_league_id and sl.week = ps.week
                                  and exists (select 1 from jsonb_array_elements(sl.starters_json) e where e ->> 'player_slug' = ps.slug)) h on true
           where ps.season = lg.season and ps.week = coalesce(p_week, lg.contest_week, _contest_week(lg.season))
             and ps.name ilike '%' || q || '%'
           order by (h.n = 0), ps.salary desc limit 12) s), '[]'::jsonb)
      else coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
                   'owner', case when nr.roster_id is not null then _txn_team(p_league_id, nr.roster_id) end) as x
            from league_pool lp
            left join native_roster nr on nr.league_id = lp.league_id and nr.slug = lp.slug
           where lp.league_id = p_league_id and lp.full_name ilike '%' || q || '%'
           order by (nr.roster_id is null), lp.rank limit 12) s), '[]'::jsonb) end);
end $$;

drop function if exists commish_set_player_adjustment(uuid, int, text, numeric, text);
create or replace function commish_set_player_adjustment(p_league_id uuid, p_week int, p_slug text, p_points numeric, p_note text default null, p_hurt boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare pts numeric := round(coalesce(p_points, 0), 1); why text := nullif(btrim(coalesce(p_note, '')), '');
        had numeric; hadh boolean; stamped boolean; line text; lg league; hurt_ boolean := coalesce(p_hurt, false);
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'point adjustments are for classic leagues — a drip week isn''t a sum of points');
  end if;
  if p_week is null or not exists (select 1 from matchup where league_id = p_league_id and week = p_week) then
    return jsonb_build_object('ok', false, 'error', 'this league has no week ' || coalesce(p_week::text, '?'));
  end if;
  if _is_contest(lg) then
    if not exists (select 1 from pod_salary where season = lg.season and week = p_week and slug = p_slug) then
      return jsonb_build_object('ok', false, 'error', 'player not on week ' || p_week || '''s board');
    end if;
  elsif not exists (select 1 from league_pool where league_id = p_league_id and slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in this league''s pool');
  end if;
  if pts < -50 or pts > 50 then
    return jsonb_build_object('ok', false, 'error', 'an adjustment is between -50 and +50 points');
  end if;
  if pts <> 0 and why is null then
    return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason');
  end if;
  select points, hurt into had, hadh from player_adjustment where league_id = p_league_id and week = p_week and slug = p_slug;
  if pts = 0 and not hurt_ then
    delete from player_adjustment where league_id = p_league_id and week = p_week and slug = p_slug;
    if had is null then return jsonb_build_object('ok', true, 'removed', false); end if;
    line := case when had = 0 and coalesce(hadh, false)
      then '🩹 The commissioner put the no-show penalty back on ' || _txn_player(p_league_id, p_slug) || ' for week ' || p_week
      else '✏️ The commissioner removed the week ' || p_week || ' adjustment on ' || _txn_player(p_league_id, p_slug)
        || ' (was ' || case when had > 0 then '+' else '' end || had::text || ')' end;
  else
    -- HURT IN HIS GAME (0493): the waiver rides the same row — points may be 0 then, and no reason is owed.
    insert into player_adjustment (league_id, week, slug, points, hurt, note, set_by)
    values (p_league_id, p_week, p_slug, pts, hurt_, left(coalesce(why, 'hurt in his game'), 200), auth.uid())
    on conflict (league_id, week, slug) do update
      set points = excluded.points, hurt = excluded.hurt, note = excluded.note, set_by = excluded.set_by, set_at = now();
    line := case when pts = 0
      then '🩹 The commissioner waived the no-show penalty on ' || _txn_player(p_league_id, p_slug) || ' for week ' || p_week || ' — hurt in his game'
      else '✏️ The commissioner adjusted ' || _txn_player(p_league_id, p_slug) || '''s week ' || p_week || ' score by '
        || case when pts > 0 then '+' else '' end || trim(to_char(pts, 'FM990.0')) || ' — ' || left(why, 200)
        || case when hurt_ then ' · hurt in his game: no no-show penalty' else '' end end;
  end if;
  select exists (select 1 from matchup where league_id = p_league_id and week = p_week
                   and home_final is not null and away_final is not null) into stamped;
  perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'adjust', 'week', p_week, 'slug', p_slug, 'points', pts));
  return jsonb_build_object('ok', true, 'points', pts, 'hurt', hurt_, 'note', line,
    -- A stamped week keeps its old finals until it is re-scored.
    'rescore', stamped);
end $$;
grant execute on function commish_set_player_adjustment(uuid, int, text, numeric, text, boolean) to authenticated;
