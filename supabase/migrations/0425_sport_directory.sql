-- 0425 — THE SPORT DIRECTORY (phase 2, v0.617.0): every rostered NBA / WNBA /
-- NHL / MLB player, ranked, and the pool a sport league drafts from.
--
-- `sport_player` is what the worker's directory sweep writes
-- (server/src/poll/sportDirectory.js): one row per player per sport, keyed
-- `<sport>-<feed id>` like game_stat_line, with his eligibility in core's
-- vocabulary, an injury status, and a rank — fantasy points under the
-- sport's default table over his ranking season — that stands in for ADP.
-- Retirement is by absence from a completed sweep, as college_player does.
--
-- `league_pool.eligible` is new: the NFL has one position per player and the
-- schema assumed it; a shooting guard who also plays the wing carries
-- {SG, SF}. NULL means "the pos column", so every NFL row reads as before.
--
-- Undo:
--   drop function if exists seed_sport_pool(uuid, int);
--   drop function if exists sport_player_add_alt(text, text, text, text);
--   alter table league_pool drop column if exists eligible;
--   drop table if exists sport_player;

create table if not exists sport_player (
  sport         text not null check (sport in ('nba', 'wnba', 'nhl', 'mlb')),
  player_key    text not null,               -- <sport>-<feed id>
  ext_id        text not null,
  full_name     text not null,
  team          text not null default '',    -- feed tricode; '' = free agent
  pos           text not null,               -- primary eligibility (eligible[1])
  eligible      text[] not null default '{}',
  feed_pos      text,                        -- the feed's own code ("G-F", "RF", "L")
  jersey        text,
  headshot      text,
  active        boolean not null default true,
  injury_status text,                        -- the sport's codes (core sports/<sport>.ts)
  injury_note   text,
  rank          int,                         -- 1 = best; null = unranked
  rank_pts      numeric,                     -- points behind the rank
  season        text,                        -- the ranking season's starting year
  gp            int not null default 0,
  season_line   jsonb,                       -- the ranking season's raw line
  -- Other feeds' ids for the same player, learned by the box-score crosswalk
  -- ({"nba": "1627759"}); NHL and MLB never need one.
  alt_ids       jsonb,
  seen_at       timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (sport, player_key)
);
create index if not exists sport_player_rank on sport_player(sport, rank) where active;
create index if not exists sport_player_team on sport_player(sport, team);

alter table sport_player enable row level security;
drop policy if exists sport_player_read on sport_player;
create policy sport_player_read on sport_player for select using (auth.role() = 'authenticated');
grant select on sport_player to authenticated;

-- The crosswalk remembers a match (worker only).
create or replace function sport_player_add_alt(p_sport text, p_key text, p_feed text, p_id text)
returns void language sql security definer set search_path = public as $$
  update sport_player
     set alt_ids = coalesce(alt_ids, '{}'::jsonb) || jsonb_build_object(p_feed, p_id),
         updated_at = now()
   where sport = p_sport and player_key = p_key;
$$;
revoke execute on function sport_player_add_alt(text, text, text, text) from public, anon, authenticated;
grant execute on function sport_player_add_alt(text, text, text, text) to service_role;

-- ── league_pool.eligible ──────────────────────────────────────────────────────
alter table league_pool add column if not exists eligible text[];
comment on column league_pool.eligible is '0425: every slot position this player may fill (NBA SG/SF, MLB 1B/OF…). NULL = just `pos`, which is every NFL row.';

-- ── seed a sport league's pool from the directory ────────────────────────────
-- The NFL pool is built client-side from the Sleeper directory and posted
-- through seed_league_pool; a sport league's comes straight from
-- sport_player, ranked, active players only, capped. Same guards as
-- seed_league_pool: commissioner or admin, native, draft still pending.
-- Rostered players survive a re-seed, as there.
create or replace function seed_sport_pool(p_league_id uuid, p_limit int default 600)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare sp text; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  select sport into sp from league where id = p_league_id;
  if sp is null or sp = 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'not a sport league');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'draft already started');
  end if;
  p_limit := least(greatest(coalesce(p_limit, 600), 50), 2000);

  delete from league_pool lp where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug);
  insert into league_pool (league_id, slug, full_name, pos, team, rank, eligible)
  select p_league_id, p.player_key, p.full_name, p.pos, p.team,
         row_number() over (order by p.rank nulls last, p.full_name), p.eligible
    from sport_player p
   where p.sport = sp and p.active
   order by p.rank nulls last, p.full_name
   limit p_limit
  on conflict (league_id, slug) do update
    set full_name = excluded.full_name, pos = excluded.pos, team = excluded.team, eligible = excluded.eligible;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n, 'sport', sp);
end $$;
grant execute on function seed_sport_pool(uuid, int) to authenticated;

-- ── a player's current eligibility, for boards ───────────────────────────────
create or replace function pool_eligible(p_league_id uuid, p_slug text) returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(lp.eligible, array[lp.pos]) from league_pool lp
   where lp.league_id = p_league_id and lp.slug = p_slug;
$$;
grant execute on function pool_eligible(uuid, text) to authenticated;
