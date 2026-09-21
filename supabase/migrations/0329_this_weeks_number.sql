-- 0329: THIS WEEK'S NUMBER, AND THE NEWS — refreshed projections and player
-- headlines, instead of a set baked in August.
--
-- The gap list called the baked projections "the weakest data point vs the
-- big three", and it was right for a reason that has nothing to do with the
-- model: proj2026.ts is a SEASON rate, frozen before week 1. It cannot know
-- that a starter is out, that a back-up has the job, that a bye is this week
-- or that a man was traded on Tuesday. Every platform we compared against
-- refreshes weekly; we shipped a number that was right in August and quietly
-- aged all year.
--
-- WHAT LANDS HERE. Two tables the worker fills and everything reads:
--
--   nfl_week_proj — one row per player per week, carrying BOTH the source's
--     own PPR total AND the raw projected stat line. The line is the useful
--     half: it can be re-scored in a league's own catalog later, so a
--     TE-premium league is not stuck reading somebody else's PPR.
--   player_news — the headline feed, tagged with the players it is about, so
--     a roster row can carry "why is he questionable" without anyone
--     searching for it.
--
-- KEYED ON THE CROSSWALK. Both are keyed by ESPN athlete id, which is what
-- league_pool.espn_id already holds (0064) — names drift between sources and
-- ids do not. A player our pool has no espn_id for simply has no weekly
-- number, which is honest; the baked season projection still answers for him.
--
-- THE BAKED SET IS NOT REPLACED. It is the fallback and the draft-room
-- ranking, and it stays. This is the WEEK's number, shown as the week's
-- number, beside it.

create table if not exists nfl_week_proj (
  season     text not null,
  week       int  not null,
  espn_id    text not null,
  -- The source's own scored total (PPR), and the projected stat line behind
  -- it. Both, deliberately: the total is what a screen shows today, the line
  -- is what a league's own scoring can be applied to tomorrow.
  pts        numeric,
  line       jsonb,
  source     text not null default 'espn',
  updated_at timestamptz not null default now(),
  primary key (season, week, espn_id)
);
create index if not exists nfl_week_proj_week on nfl_week_proj(season, week);
alter table nfl_week_proj enable row level security;
drop policy if exists nfl_week_proj_read on nfl_week_proj;
create policy nfl_week_proj_read on nfl_week_proj for select using (auth.uid() is not null);

create table if not exists player_news (
  id         text primary key,          -- the source's own article id
  at         timestamptz not null,
  headline   text not null,
  summary    text,
  url        text,
  source     text not null default 'espn',
  -- ESPN athlete ids this item is about. A story tagging four players shows
  -- up on four rosters, which is the point.
  athletes   text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists player_news_at on player_news(at desc);
create index if not exists player_news_athletes on player_news using gin(athletes);
alter table player_news enable row level security;
drop policy if exists player_news_read on player_news;
create policy player_news_read on player_news for select using (auth.uid() is not null);

-- ── the worker's writes ──────────────────────────────────────────────────
-- One statement per poll rather than a row at a time: the whole week is ~600
-- players, and a partial refresh is worse than a stale one.
create or replace function upsert_week_projections(p_season text, p_week int, p_rows jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_season is null or p_week is null or jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'season, week and a list of rows');
  end if;
  insert into nfl_week_proj (season, week, espn_id, pts, line, source, updated_at)
  select p_season, p_week, r ->> 'espn_id', nullif(r ->> 'pts', '')::numeric,
         r -> 'line', coalesce(r ->> 'source', 'espn'), now()
    from jsonb_array_elements(p_rows) r
   where nullif(r ->> 'espn_id', '') is not null
  on conflict (season, week, espn_id) do update
    set pts = excluded.pts, line = excluded.line, source = excluded.source, updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n, 'season', p_season, 'week', p_week);
end $$;
revoke all on function upsert_week_projections(text, int, jsonb) from public, anon, authenticated;
grant execute on function upsert_week_projections(text, int, jsonb) to service_role;

create or replace function upsert_player_news(p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  insert into player_news (id, at, headline, summary, url, source, athletes)
  select r ->> 'id', coalesce((r ->> 'at')::timestamptz, now()),
         left(btrim(r ->> 'headline'), 300), left(btrim(coalesce(r ->> 'summary', '')), 800),
         r ->> 'url', coalesce(r ->> 'source', 'espn'),
         coalesce((select array_agg(value) from jsonb_array_elements_text(r -> 'athletes')), '{}')
    from jsonb_array_elements(p_rows) r
   where nullif(r ->> 'id', '') is not null and nullif(btrim(coalesce(r ->> 'headline', '')), '') is not null
  on conflict (id) do update
    set headline = excluded.headline, summary = excluded.summary,
        url = excluded.url, athletes = excluded.athletes;
  get diagnostics n = row_count;
  -- The feed is a rolling window, not an archive: a month is more than any
  -- screen shows and keeps the table small enough to stay fast.
  delete from player_news where at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'rows', n);
end $$;
revoke all on function upsert_player_news(jsonb) from public, anon, authenticated;
grant execute on function upsert_player_news(jsonb) to service_role;

-- ── what the screens read ────────────────────────────────────────────────
-- This league's players, with the week's number attached by the crosswalk.
-- Returns only what it has: a player with no espn_id, or a week not yet
-- polled, is simply absent rather than zero.
create or replace function league_week_projections(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seas text;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()
          or coalesce(league_public_api(p_league_id), false)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select season into seas from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'season', seas, 'week', p_week,
    'as_of', (select max(updated_at) from nfl_week_proj w where w.season = seas and w.week = p_week),
    'projections', coalesce((select jsonb_object_agg(lp.slug, round(w.pts, 2))
      from league_pool lp
      join nfl_week_proj w on w.espn_id = lp.espn_id and w.season = seas and w.week = p_week
     where lp.league_id = p_league_id and lp.espn_id is not null and w.pts is not null), '{}'::jsonb));
end $$;
grant execute on function league_week_projections(uuid, int) to authenticated;

-- The headlines about THIS league's players, newest first — the feed a
-- manager actually wants, rather than the league-wide wire.
create or replace function league_news(p_league_id uuid, p_limit int default 30) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()
          or coalesce(league_public_api(p_league_id), false)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'news', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'at', x.at, 'headline', x.headline, 'summary', x.summary, 'url', x.url,
        'players', x.players) order by x.at desc)
      from (
        select n.id, n.at, n.headline, n.summary, n.url,
               (select jsonb_agg(distinct jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos))
                  from league_pool lp
                 where lp.league_id = p_league_id and lp.espn_id = any (n.athletes)) as players
          from player_news n
         where exists (select 1 from league_pool lp
                        where lp.league_id = p_league_id and lp.espn_id = any (n.athletes))
         order by n.at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) x), '[]'::jsonb));
end $$;
grant execute on function league_news(uuid, int) to authenticated;

-- One player's recent headlines, for the card that opens when you tap him.
create or replace function player_news_for(p_espn_id text, p_limit int default 5) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'at', n.at, 'headline', n.headline, 'summary', n.summary, 'url', n.url)
      order by n.at desc), '[]'::jsonb)
  from (select * from player_news n where p_espn_id = any (n.athletes)
         order by n.at desc limit least(greatest(coalesce(p_limit, 5), 1), 25)) n
  where auth.uid() is not null;
$$;
grant execute on function player_news_for(text, int) to authenticated;
