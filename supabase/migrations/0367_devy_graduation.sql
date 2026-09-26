-- ═══════════════════════════════════════════════════════════════════════════
-- 0367 · COLLEGE PLAYERS, PHASE 2b — GRADUATION.
--
-- When a college player joins an NFL team, every LIVE row that holds him by
-- his college slug (c-<espn_id>, 0365) moves to his NFL slug in one
-- transaction, per league. HISTORY keeps the college slug, and player_alias
-- lets any screen read an old slug as the current player.
--
-- WHO HE IS. The worker (server/src/poll/graduate.js) decides:
--   1. ESPN lists the same athlete id on an NFL roster (the college id IS the
--      NFL id — 0365);
--   2. the crosswalk (player_xref, 0331) gives his Sleeper id by that ESPN id.
--      Sleeper's own directory carries no espn_id for rookies (0 of 147 active
--      rookies on 2026-09-26), so this is the only id-only bridge;
--   3. the Sleeper id gives our NFL slug (playerIndex).
-- Until all three hold, he stays a college player. Nothing here matches names.
--
-- THE COLUMNS. Every column that holds a player slug is classified below and
-- scripts/db/graduation-probes.sql fails on any it does not recognise, so a new
-- table has to be placed before it can be forgotten:
--   live    — rewritten here, within the league;
--   history — kept (draft_pick, draft_event, league_txn, dead_money,
--             vampire_steal, player_adjustment, sealed_pick, live_play);
--   feed    — NFL boards keyed by the feeds, which never hold a college slug.
--
-- CONFLICT. If the league's pool already holds the NFL player and a DIFFERENT
-- team rosters him, the league is not touched: the commissioner decides. The
-- row lands in college_graduation as a conflict and the worker retries later.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists player_alias (
  old_slug   text primary key,
  new_slug   text not null,
  espn_id    text,
  at         timestamptz not null default now()
);
alter table player_alias enable row level security;
drop policy if exists player_alias_read on player_alias;
create policy player_alias_read on player_alias for select using (auth.uid() is not null);

create table if not exists college_graduation (
  espn_id    text not null,
  league_id  uuid not null references league(id) on delete cascade,
  status     text not null check (status in ('done', 'conflict')),
  new_slug   text,
  note       text,
  at         timestamptz not null default now(),
  primary key (espn_id, league_id)
);
alter table college_graduation enable row level security;
drop policy if exists college_graduation_read on college_graduation;
create policy college_graduation_read on college_graduation for select
  using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());

-- Rewrite one slug column in one league, skipping rows whose target already
-- exists (a queue or a flag that already names the NFL player) and clearing the
-- leftovers, so a unique key can never trip. p_where narrows to live rows.
create or replace function _graduate_col(p_table text, p_col text, p_league uuid, p_old text, p_new text,
                                         p_where text default 'true') returns void
  language plpgsql security definer set search_path = public as $$
begin
  execute format('update %I t set %I = $3 where t.league_id = $1 and t.%I = $2 and (%s)
                    and not exists (select 1 from %I u where u.league_id = $1 and u.%I = $3)',
                 p_table, p_col, p_col, p_where, p_table, p_col)
    using p_league, p_old, p_new;
  execute format('delete from %I t where t.league_id = $1 and t.%I = $2 and (%s)', p_table, p_col, p_where)
    using p_league, p_old;
end $$;

-- A slug inside jsonb (pending trades: arrays of slugs, {slug, to} legs, the
-- retention map). The quoted college slug cannot occur by accident.
create or replace function _graduate_json(p_doc jsonb, p_old text, p_new text) returns jsonb
  language sql immutable as $$
  select case when p_doc is null then null
              else replace(p_doc::text, '"' || p_old || '"', '"' || p_new || '"')::jsonb end
$$;

-- The pool's college slugs, with the crosswalk's Sleeper id where it has one.
-- The worker's worklist; it asks ESPN about each.
create or replace function graduation_candidates() returns table (espn_id text, sleeper_id text, leagues int)
  language sql stable security definer set search_path = public as $$
  select substr(lp.slug, 3), max(x.sleeper_id), count(distinct lp.league_id)::int
    from league_pool lp
    left join player_xref x on x.espn_id = substr(lp.slug, 3)
   where lp.level = 'college'
   group by substr(lp.slug, 3)
$$;
revoke all on function graduation_candidates() from public, anon, authenticated;
grant execute on function graduation_candidates() to service_role;

create or replace function graduate_college_player(
  p_espn_id text, p_new_slug text, p_full_name text, p_pos text, p_team text, p_sleeper_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  old text := 'c-' || p_espn_id;
  lg record; target text; nfl_holder int; col_holder int; col_rank int;
  done int := 0; conflicts int := 0; kp int[];
begin
  if coalesce(p_espn_id, '') !~ '^\d+$' or coalesce(p_new_slug, '') = '' or p_new_slug ~ '^c-[0-9]+$' then
    return jsonb_build_object('ok', false, 'error', 'an ESPN id and an NFL slug');
  end if;

  for lg in select distinct league_id from league_pool where slug = old loop
    -- One league at a time, each its own sub-transaction: a trigger that
    -- refuses (a commissioner's flag on the NFL slug, say) records a conflict
    -- for that league and rolls back only its half-done rewrite.
    begin
      -- The NFL row this league already has for him, by slug or by Sleeper id.
      select lp.slug into target from league_pool lp
       where lp.league_id = lg.league_id and lp.slug <> old
         and (lp.slug = p_new_slug or (p_sleeper_id is not null and lp.sleeper_id = p_sleeper_id))
       order by (lp.slug = p_new_slug) desc limit 1;
      select roster_id into col_holder from native_roster where league_id = lg.league_id and slug = old;
      if target is not null then
        select roster_id into nfl_holder from native_roster where league_id = lg.league_id and slug = target;
        if nfl_holder is not null and col_holder is not null and nfl_holder <> col_holder then
          insert into college_graduation (espn_id, league_id, status, new_slug, note)
            values (p_espn_id, lg.league_id, 'conflict', target,
                    'Team ' || col_holder || ' holds him as a devy player and Team ' || nfl_holder || ' rosters him as an NFL player')
            on conflict (espn_id, league_id) do update set status = 'conflict', new_slug = excluded.new_slug,
              note = excluded.note, at = now();
          conflicts := conflicts + 1;
          continue;
        end if;
        if nfl_holder is not null and col_holder is not null then
          -- The same team holds both rows: keep the NFL row, drop the college one.
          delete from native_roster where league_id = lg.league_id and slug = old;
          col_holder := null;
        end if;
      else
        target := p_new_slug;
        select rank into col_rank from league_pool where league_id = lg.league_id and slug = old;
        insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
          values (lg.league_id, target, p_full_name, p_pos, coalesce(p_team, ''), col_rank, p_espn_id, 0,
                  -- The per-league unique index (0205) must not trip on a row
                  -- that holds the id under another slug; that case took the
                  -- branch above.
                  p_sleeper_id);
      end if;

      -- ── live rows ──
      if col_holder is not null then
        -- keeper_pick references native_roster (league_id, slug): lift the
        -- keeper marks off, move the row, put them back on the new slug.
        select array_agg(roster_id) into kp from keeper_pick where league_id = lg.league_id and slug = old;
        delete from keeper_pick where league_id = lg.league_id and slug = old;
        update native_roster set slug = target where league_id = lg.league_id and slug = old;
        if kp is not null then
          insert into keeper_pick (league_id, roster_id, slug)
            select lg.league_id, k, target from unnest(kp) k on conflict do nothing;
        end if;
      end if;
      perform _graduate_col('contract', 'slug', lg.league_id, old, target);
      perform _graduate_col('salary_retention', 'slug', lg.league_id, old, target);
      perform _graduate_col('rfa_tender', 'slug', lg.league_id, old, target);
      perform _graduate_col('player_flag', 'slug', lg.league_id, old, target);
      perform _graduate_col('draft_queue', 'slug', lg.league_id, old, target);
      perform _graduate_col('trade_signal', 'slug', lg.league_id, old, target);
      perform _graduate_col('auction_lot', 'slug', lg.league_id, old, target);
      update draft set lot_slug = target where league_id = lg.league_id and lot_slug = old;
      update waiver_claim set add_slug = target where league_id = lg.league_id and add_slug = old and status = 'pending';
      update waiver_claim set drop_slug = target where league_id = lg.league_id and drop_slug = old and status = 'pending';
      update trade_proposal set give = _graduate_json(give, old, target), get = _graduate_json(get, old, target),
                                retain = _graduate_json(retain, old, target)
       where league_id = lg.league_id and status in ('pending', 'accepted', 'review')
         and (give::text || get::text || coalesce(retain::text, '')) like '%"' || old || '"%';
      update trade_leg l set send = _graduate_json(send, old, target)
        from trade_proposal t
       where t.id = l.trade_id and l.league_id = lg.league_id and t.status in ('pending', 'accepted', 'review')
         and l.send::text like '%"' || old || '"%';

      delete from league_pool where league_id = lg.league_id and slug = old;
      insert into college_graduation (espn_id, league_id, status, new_slug, note)
        values (p_espn_id, lg.league_id, 'done', target, null)
        on conflict (espn_id, league_id) do update set status = 'done', new_slug = excluded.new_slug, note = null, at = now();
      done := done + 1;
    exception when others then
      insert into college_graduation (espn_id, league_id, status, new_slug, note)
        values (p_espn_id, lg.league_id, 'conflict', p_new_slug, sqlerrm)
        on conflict (espn_id, league_id) do update set status = 'conflict', note = excluded.note, at = now();
      conflicts := conflicts + 1;
    end;
  end loop;

  -- ── account-wide ──
  if done > 0 then
    insert into player_alias (old_slug, new_slug, espn_id) values (old, p_new_slug, p_espn_id)
      on conflict (old_slug) do update set new_slug = excluded.new_slug, at = now();
    insert into favorite_player (app_user_id, player_slug, created_at)
      select app_user_id, p_new_slug, created_at from favorite_player where player_slug = old
      on conflict do nothing;
    delete from favorite_player where player_slug = old;
  end if;
  return jsonb_build_object('ok', true, 'leagues', done, 'conflicts', conflicts);
end $$;
revoke all on function graduate_college_player(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function graduate_college_player(text, text, text, text, text, text) to service_role;

-- The current slug for any slug: itself, or where its alias points.
create or replace function current_slug(p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select new_slug from player_alias where old_slug = p_slug), p_slug)
$$;
grant execute on function current_slug(text) to authenticated;
