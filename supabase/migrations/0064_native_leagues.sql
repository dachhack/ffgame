-- 0064: NATIVE LEAGUES — create a league inside Drip, no Sleeper/ESPN/… import.
--
-- Removes the platform's biggest structural liability: needing a league that
-- already exists in another product. A native league is created in-app and gets
-- its rosters from an in-app SNAKE DRAFT, then manages them through WAIVERS and
-- FREE AGENCY. Everything downstream is untouched: a native league emits the
-- same four row-sets the lock/resolve/client machinery already consumes
-- (league / league_membership / matchup / sleeper_lineup starters_json), with
-- provider='native' and a namespaced sleeper_league_id key ('native-…'), the
-- exact pattern 0041 established for ESPN. See docs/native-league-plan.md.
--
-- Net-new concepts (all additive):
--   • league_pool     — the ranked, draftable player universe for one league
--                       (seeded by the client from the baked-PBP player set, so
--                       every draftable player actually scores in the engine).
--   • native_roster   — persistent team rosters (the first roster construction
--                       in this codebase; imported leagues stay snapshot-based).
--   • draft/draft_pick— snake draft with a per-pick clock + server-side autopick
--                       (best-available with positional caps + forced K/DST).
--   • waiver_claim    — dropped players sit on waivers (waived_until); claims
--                       resolve in rolling-priority order; unclaimed = free agent.
--   • Weekly pools    — native_materialize() rewrites sleeper_lineup for every
--                       still-scheduled week from native_roster, so lock/resolve
--                       and the pick UI see a native league exactly like an
--                       imported one.
--
-- Concurrency: every draft/roster mutation takes a per-league advisory xact
-- lock, so two managers racing the same pick (or a tick racing a human pick)
-- serialize instead of double-inserting.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists league_pool (
  league_id    uuid not null references league(id) on delete cascade,
  slug         text not null,               -- engine slug (baked-PBP key)
  full_name    text not null,
  pos          text not null,               -- QB | RB | WR | TE | K | DEF
  team         text not null default '',    -- NFL team code ('' unknown)
  rank         int  not null,               -- 1 = best (drives autopick + UI sort)
  waived_until timestamptz,                 -- non-null ⇒ on waivers until then
  primary key (league_id, slug)
);
create index if not exists league_pool_rank on league_pool(league_id, rank);

create table if not exists native_roster (
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  slug       text not null,
  acquired   text not null default 'draft' check (acquired in ('draft', 'waiver', 'fa', 'commish')),
  added_at   timestamptz not null default now(),
  primary key (league_id, slug),            -- one owner per player per league
  foreign key (league_id, slug) references league_pool(league_id, slug) on delete cascade
);
create index if not exists native_roster_team on native_roster(league_id, roster_id);

create table if not exists draft (
  league_id       uuid primary key references league(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'live', 'complete')),
  rounds          int  not null default 12 check (rounds between 5 and 25),
  pick_seconds    int  not null default 90 check (pick_seconds between 15 and 86400),
  draft_order     jsonb,                    -- round-1 roster order, e.g. [3,1,4,2]
  current_overall int  not null default 1,  -- 1-based
  deadline_at     timestamptz,              -- current pick's clock
  started_at      timestamptz,
  completed_at    timestamptz
);

create table if not exists draft_pick (
  league_id uuid not null references league(id) on delete cascade,
  overall   int  not null,
  round     int  not null,
  roster_id int  not null,
  slug      text not null,
  auto      boolean not null default false, -- clock expiry / vacant-seat pick
  made_at   timestamptz not null default now(),
  primary key (league_id, overall)
);
create index if not exists draft_pick_roster on draft_pick(league_id, roster_id);

create table if not exists waiver_claim (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references league(id) on delete cascade,
  roster_id    int  not null,
  add_slug     text not null,
  drop_slug    text,
  status       text not null default 'pending' check (status in ('pending', 'won', 'lost', 'cancelled')),
  note         text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists waiver_claim_league on waiver_claim(league_id, status);

-- Rolling waiver priority (1 = first claim). Initialized at draft start as the
-- reverse of the draft order; a won claim rotates the winner to the back.
alter table league_membership add column if not exists waiver_priority int;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — reads for league members; ALL writes go through the RPCs below.
-- ─────────────────────────────────────────────────────────────────────────────

alter table league_pool   enable row level security;
alter table native_roster enable row level security;
alter table draft         enable row level security;
alter table draft_pick    enable row level security;
alter table waiver_claim  enable row level security;

drop policy if exists league_pool_read on league_pool;
create policy league_pool_read on league_pool for select using (is_league_member(league_id));
drop policy if exists native_roster_read on native_roster;
create policy native_roster_read on native_roster for select using (is_league_member(league_id));
drop policy if exists draft_read on draft;
create policy draft_read on draft for select using (is_league_member(league_id));
drop policy if exists draft_pick_read on draft_pick;
create policy draft_pick_read on draft_pick for select using (is_league_member(league_id));
-- Pending claims are private to the claiming manager (+ commish); resolved ones
-- are league-visible history.
drop policy if exists waiver_claim_read on waiver_claim;
create policy waiver_claim_read on waiver_claim for select using (
  is_league_commish(league_id)
  or (status <> 'pending' and is_league_member(league_id))
  or exists (select 1 from league_membership m
             where m.league_id = waiver_claim.league_id
               and m.sleeper_roster_id = waiver_claim.roster_id
               and m.app_user_id = auth.uid())
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function is_native_league(l_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league where id = l_id and provider = 'native');
$$;

-- Does auth.uid() manage this roster in this league?
create or replace function owns_roster(l_id uuid, r_id int) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_membership m
                 where m.league_id = l_id and m.sleeper_roster_id = r_id
                   and m.app_user_id = auth.uid() and m.enrolled);
$$;

-- The roster on the clock for a draft row (snake order).
create or replace function draft_on_clock(d draft) returns int
  language plpgsql immutable as $$
declare n int; rnd int; idx int;
begin
  n := jsonb_array_length(d.draft_order);
  if n is null or n = 0 then return null; end if;
  rnd := ((d.current_overall - 1) / n) + 1;
  idx := (d.current_overall - 1) % n;
  if rnd % 2 = 0 then idx := n - 1 - idx; end if;   -- even rounds reverse
  return (d.draft_order ->> idx)::int;
end $$;

-- Best available pick for a roster: best-ranked free player under positional
-- caps (QB≤3, TE≤3, K≤1, DEF≤1; RB/WR uncapped), forcing a missing K/DEF once
-- the roster's remaining picks are only enough to cover them.
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  qb_n int; te_n int; k_n int; def_n int; total int;
  remaining int; need_k boolean; need_def boolean; forced int; pick text;
begin
  select count(*) filter (where lp.pos = 'QB'),
         count(*) filter (where lp.pos = 'TE'),
         count(*) filter (where lp.pos = 'K'),
         count(*) filter (where lp.pos = 'DEF'),
         count(*)
    into qb_n, te_n, k_n, def_n, total
  from native_roster nr join league_pool lp
    on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id;

  remaining := p_rounds - total;
  need_k   := k_n = 0;
  need_def := def_n = 0;
  forced := (case when need_k then 1 else 0 end) + (case when need_def then 1 else 0 end);

  if remaining <= forced and forced > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and lp.pos = (case when need_k then 'K' else 'DEF' end)
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and (   (lp.pos = 'QB'  and qb_n  < 3)
         or (lp.pos = 'TE'  and te_n  < 3)
         or (lp.pos = 'K'   and k_n   < 1)
         or (lp.pos = 'DEF' and def_n < 1)
         or lp.pos in ('RB', 'WR'))
  order by lp.rank limit 1;
  if pick is not null then return pick; end if;

  -- Caps exhausted the board (tiny pools) — take the best free player outright.
  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
  order by lp.rank limit 1;
  return pick;
end $$;

-- Rewrite sleeper_lineup (the weekly pick pool / auto-lineup source the whole
-- pipeline consumes) from native_roster, for every week of this league whose
-- matchups are ALL still 'scheduled'. Locked/live/final weeks are frozen — the
-- resolver may be reading them mid-game.
create or replace function native_materialize(p_league_id uuid)
  returns int language plpgsql security definer set search_path = public as $$
declare wk int; n int := 0;
begin
  if not is_native_league(p_league_id) then return 0; end if;
  for wk in
    select m.week from matchup m where m.league_id = p_league_id
    group by m.week
    having bool_and(m.status = 'scheduled')
  loop
    delete from sleeper_lineup where league_id = p_league_id and week = wk;
    insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    select p_league_id, wk, t.roster_id,
           jsonb_agg(jsonb_build_object(
             'slot', t.slot, 'slug', t.slug, 'player_slug', t.slug,
             'full', t.full_name, 'pos', t.pos, 'team', t.team
           ) order by t.slot)
    from (
      select nr.roster_id, nr.slug, lp.full_name, lp.pos, lp.team,
             row_number() over (partition by nr.roster_id order by lp.rank) as slot
      from native_roster nr
      join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      where nr.league_id = p_league_id
    ) t
    group by t.roster_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- League creation + joining
-- ─────────────────────────────────────────────────────────────────────────────

-- league_by_invite (0002) gains `provider`, so the join screen can route a
-- native league's code to native_join (claim an open seat) instead of the
-- Sleeper-username match. Return type changes ⇒ drop first.
drop function if exists league_by_invite(text);
create function league_by_invite(code text)
  returns table (league_id uuid, name text, season text, provider text)
  language sql stable security definer set search_path = public as $$
  select id, name, season, provider from league where invite_code = upper(trim(code));
$$;
grant execute on function league_by_invite(text) to authenticated;

-- Create a native league: the caller becomes commissioner AND claims roster 1.
-- Seats 2..N are open; share the invite code (native_join fills seats in order).
create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; e text; nm text; i int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league needs a name'); end if;
  if p_teams is null or p_teams < 2 or p_teams > 14 then
    return jsonb_build_object('ok', false, 'error', 'team count must be 2–14');
  end if;
  if p_rounds is null or p_rounds < 5 or p_rounds > 25 then
    return jsonb_build_object('ok', false, 'error', 'roster size must be 5–25');
  end if;
  if p_pick_seconds is null or p_pick_seconds < 15 or p_pick_seconds > 86400 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–24h');
  end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  insert into league (sleeper_league_id, season, name, provider, settings_json, commissioner_id, synced_at)
  values ('native-' || replace(gen_random_uuid()::text, '-', ''), coalesce(nullif(btrim(p_season), ''), '2026'),
          nm, 'native', jsonb_build_object('teams', p_teams, 'rounds', p_rounds), auth.uid(), now())
  returning id into lid;

  for i in 1..p_teams loop
    insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled)
    values (lid, i, 'Team ' || i, false);
  end loop;
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e
    where league_id = lid and sleeper_roster_id = 1;

  insert into draft (league_id, rounds, pick_seconds) values (lid, p_rounds, p_pick_seconds);

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1,
    'invite_code', (select invite_code from league where id = lid));
end $$;

-- Join a native league by invite code: takes the lowest open seat directly (no
-- commissioner mapping step — native leagues have no external identity to match).
create or replace function native_join(p_code text, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; seat int; e text; nm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid invite code'); end if;
  if lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league — use the join flow'); end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  -- Already seated? Idempotent.
  select sleeper_roster_id into seat from league_membership
    where league_id = lg.id and app_user_id = auth.uid() and enrolled limit 1;
  if seat is not null then
    return jsonb_build_object('ok', true, 'league_id', lg.id, 'roster_id', seat, 'status', 'enrolled');
  end if;

  perform pg_advisory_xact_lock(hashtext(lg.id::text));
  select sleeper_roster_id into seat from league_membership
    where league_id = lg.id and app_user_id is null and not enrolled
    order by sleeper_roster_id limit 1;
  if seat is null then return jsonb_build_object('ok', false, 'error', 'league is full'); end if;

  nm := nullif(btrim(coalesce(p_team_name, '')), '');
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e,
        team_name = coalesce(nm, team_name)
    where league_id = lg.id and sleeper_roster_id = seat;
  delete from league_join where league_id = lg.id and app_user_id = auth.uid();

  return jsonb_build_object('ok', true, 'league_id', lg.id, 'roster_id', seat, 'status', 'enrolled', 'league', lg.name);
end $$;

-- Rename a team (the seat's manager, the commissioner, or an admin).
create or replace function set_team_name(p_league_id uuid, p_roster_id int, p_name text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('ok', false, 'error', 'name required'); end if;
  if not (is_admin() or is_league_commish(p_league_id) or owns_roster(p_league_id, p_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update league_membership set team_name = left(nm, 40)
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
  return jsonb_build_object('ok', true, 'team_name', left(nm, 40));
end $$;

-- Seed (or replace) the draftable player universe. Commissioner-only, and only
-- before the draft starts. The client sends the baked-PBP player set ranked by
-- real production, so everything draftable actually scores in the engine.
create or replace function seed_league_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'draft already started');
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'players must be an array');
  end if;
  if jsonb_array_length(p_players) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large (max 2000)');
  end if;

  delete from league_pool where league_id = p_league_id;
  insert into league_pool (league_id, slug, full_name, pos, team, rank)
  select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord
  from jsonb_array_elements(p_players) with ordinality as t(p, ord)
  where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
    and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
  on conflict (league_id, slug) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n);
end $$;

-- Generate the season round-robin (circle method; odd team counts get byes).
-- lock_at comes from nfl_slate's first kickoff per week when present; otherwise
-- the worker's backfillLockAt fills it from the live scoreboard.
create or replace function native_generate_schedule(p_league_id uuid, p_weeks int default 14)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ids int[]; n int; ghost boolean := false; wk int; i int;
  a int; b int; hm int; aw int; la timestamptz; seas text; made int := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 18 then
    return jsonb_build_object('ok', false, 'error', 'weeks must be 1–18');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'season already underway — schedule is locked');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id), count(*)::int
    into ids, n from league_membership where league_id = p_league_id;
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  if n % 2 = 1 then ids := ids || 0; n := n + 1; ghost := true; end if;  -- 0 = bye

  select l.season into seas from league l where l.id = p_league_id;
  delete from matchup where league_id = p_league_id;  -- all scheduled (checked above)

  for wk in 1..p_weeks loop
    select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = wk;
    for i in 0..(n / 2 - 1) loop
      -- circle method: ids[n] fixed, the rest rotate one step per week
      a := ids[((wk - 1 + i) % (n - 1)) + 1];
      b := case when i = 0 then ids[n]
                else ids[((wk - 1 + n - 1 - i) % (n - 1)) + 1] end;
      if ghost and (a = 0 or b = 0) then continue; end if;
      -- alternate home/away by week so pairings aren't always same-sided
      if wk % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
      insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
      values (p_league_id, wk, hm, aw, 'scheduled', la)
      on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
      made := made + 1;
    end loop;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'weeks', p_weeks, 'matchups', made);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The draft
-- ─────────────────────────────────────────────────────────────────────────────

-- Start the draft (commissioner). Order = p_order (roster-id array) or a random
-- permutation. Also initializes rolling waiver priority as the REVERSE of the
-- draft order (last pick = first waiver claim).
create or replace function start_draft(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ids int[]; ord jsonb; n int; i int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  if (select count(*) from league_pool where league_id = p_league_id) < d.rounds * n then
    return jsonb_build_object('ok', false, 'error', 'pool smaller than the draft');
  end if;

  if p_order is not null then
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v.x) from (select (jsonb_array_elements_text(p_order))::int as x) v
        where v.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  else
    select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
  end if;

  update draft set status = 'live', draft_order = ord, current_overall = 1,
    deadline_at = now() + make_interval(secs => d.pick_seconds), started_at = now()
    where league_id = p_league_id;

  -- waiver priority = reverse draft order
  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord);
end $$;

-- Internal: execute one pick for the roster on the clock, advance the draft,
-- complete + materialize when the last pick lands. Caller must hold the league
-- advisory lock and have validated the actor.
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int;
begin
  select * into d from draft where league_id = p_league_id;
  if d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  n := jsonb_array_length(d.draft_order);
  rnd := ((d.current_overall - 1) / n) + 1;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;

  insert into draft_pick (league_id, overall, round, roster_id, slug, auto)
  values (p_league_id, d.current_overall, rnd, oc, p_slug, p_auto);
  insert into native_roster (league_id, roster_id, slug, acquired)
  values (p_league_id, oc, p_slug, 'draft');

  if d.current_overall >= d.rounds * n then
    update draft set status = 'complete', completed_at = now(), deadline_at = null,
      current_overall = d.current_overall + 1
      where league_id = p_league_id;
    perform native_materialize(p_league_id);
    return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc,
      'slug', p_slug, 'complete', true);
  end if;

  update draft set current_overall = d.current_overall + 1,
    deadline_at = now() + make_interval(secs => d.pick_seconds)
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc, 'slug', p_slug);
end $$;

-- A manager makes the pick for their roster on the clock. The commissioner may
-- pick on behalf of any seat (proxy pick for someone at the stadium).
create or replace function make_draft_pick(p_league_id uuid, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; oc int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  if not (owns_roster(p_league_id, oc) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your pick');
  end if;
  return native_exec_pick(p_league_id, p_slug, false);
end $$;

-- Advance the draft clock: autopick every seat whose clock expired, plus any
-- seat with no live human on it (vacant or AI-controlled) — so a half-filled
-- league drafts in seconds, not hours. Any league member (or the worker via
-- service role) may call it; it's deterministic and idempotent.
create or replace function draft_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; oc int; human boolean; pick text; made int := 0; r jsonb;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  loop
    select * into d from draft where league_id = p_league_id;
    exit when not found or d.status <> 'live';
    oc := draft_on_clock(d);
    select (m.app_user_id is not null and m.enrolled and m.controller = 'human') into human
      from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = oc;
    exit when coalesce(human, false) and d.deadline_at > now();
    pick := native_autopick_slug(p_league_id, oc, d.rounds);
    exit when pick is null;
    r := native_exec_pick(p_league_id, pick, true);
    exit when not coalesce((r ->> 'ok')::boolean, false);
    made := made + 1;
    exit when made >= 200;  -- one call never runs unbounded
  end loop;
  return jsonb_build_object('ok', true, 'autopicks', made);
end $$;

-- One-shot draft-room poll: the draft row + whose pick it is + server time (for
-- an accurate client countdown) + every pick so far.
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'no draft'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'overall', dp.overall, 'round', dp.round, 'roster_id', dp.roster_id,
      'slug', dp.slug, 'auto', dp.auto) order by dp.overall), '[]'::jsonb)
    into picks from draft_pick dp where dp.league_id = p_league_id;
  return jsonb_build_object(
    'status', d.status, 'rounds', d.rounds, 'pick_seconds', d.pick_seconds,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', case when d.status = 'live' then draft_on_clock(d) end,
    -- true ⇒ the seat on the clock has no live human (vacant or AI) and the next
    -- draft_tick will autopick it — clients call the tick immediately instead of
    -- letting an empty seat run out the full clock.
    'on_clock_auto', case when d.status = 'live' then not exists (
      select 1 from league_membership m
      where m.league_id = p_league_id and m.sleeper_roster_id = draft_on_clock(d)
        and m.app_user_id is not null and m.enrolled and m.controller = 'human') end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Waivers + free agency
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop a player: off the roster, onto waivers for 24h (claims beat first-come).
create or replace function drop_player(p_league_id uuid, p_roster_id int, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'complete') then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'player not on this roster'); end if;
  update league_pool set waived_until = now() + interval '24 hours'
    where league_id = p_league_id and slug = p_slug;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

-- Add a FREE AGENT (unrostered + not on waivers) immediately; optionally drop
-- someone in the same move. Roster size is capped at the draft's rounds.
create or replace function add_free_agent(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; cnt int; cap int; wu timestamptz;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  cap := d.rounds;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is not null and wu > now() then
    return jsonb_build_object('ok', false, 'error', 'on waivers — submit a claim instead');
  end if;

  if p_drop_slug is not null then
    delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug;
    if not found then return jsonb_build_object('ok', false, 'error', 'drop player not on this roster'); end if;
    update league_pool set waived_until = now() + interval '24 hours'
      where league_id = p_league_id and slug = p_drop_slug;
  end if;
  select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'roster full — drop someone'); end if;

  insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, p_roster_id, p_add_slug, 'fa');
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

-- Claim a player who is ON WAIVERS. Resolves at the waiver clear (see
-- process_waivers) in rolling-priority order, not first-come.
create or replace function submit_waiver_claim(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wu timestamptz; cnt int; cid uuid;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is null then return jsonb_build_object('ok', false, 'error', 'player not in pool'); end if;
  if wu <= now() then return jsonb_build_object('ok', false, 'error', 'free agent — add directly'); end if;
  if p_drop_slug is not null and not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug) then
    return jsonb_build_object('ok', false, 'error', 'drop player not on this roster');
  end if;
  if p_drop_slug is null then
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
    if cnt >= d.rounds then return jsonb_build_object('ok', false, 'error', 'roster full — include a drop'); end if;
  end if;
  if exists (select 1 from waiver_claim c where c.league_id = p_league_id and c.roster_id = p_roster_id
             and c.add_slug = p_add_slug and c.status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'claim already pending');
  end if;
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug)
    values (p_league_id, p_roster_id, p_add_slug, p_drop_slug) returning id into cid;
  return jsonb_build_object('ok', true, 'claim_id', cid,
    'clears_at', (select waived_until from league_pool where league_id = p_league_id and slug = p_add_slug));
end $$;

create or replace function cancel_waiver_claim(p_claim_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c waiver_claim%rowtype;
begin
  select * into c from waiver_claim where id = p_claim_id;
  if not found or c.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'no pending claim'); end if;
  if not (owns_roster(c.league_id, c.roster_id) or is_league_commish(c.league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update waiver_claim set status = 'cancelled', processed_at = now() where id = p_claim_id;
  return jsonb_build_object('ok', true);
end $$;

-- Process every DUE claim (target's waiver window has closed) in rolling
-- priority order. Winner's priority rotates to the back. Deterministic and
-- idempotent — safe for any league member, the commissioner, or the worker's
-- tick to call as often as they like.
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; d draft%rowtype; cnt int; won int := 0; lost int := 0; changed boolean := false;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return jsonb_build_object('ok', true, 'won', 0, 'lost', 0); end if;

  for c in
    select wc.*, m.waiver_priority
    from waiver_claim wc
    join league_membership m on m.league_id = wc.league_id and m.sleeper_roster_id = wc.roster_id
    join league_pool lp on lp.league_id = wc.league_id and lp.slug = wc.add_slug
    where wc.league_id = p_league_id and wc.status = 'pending'
      and (lp.waived_until is null or lp.waived_until <= now())
    order by m.waiver_priority nulls last, wc.created_at
  loop
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = c.add_slug) then
      update waiver_claim set status = 'lost', note = 'player taken', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if c.drop_slug is not null and not exists (select 1 from native_roster
        where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug) then
      update waiver_claim set status = 'lost', note = 'drop player no longer on roster', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = c.roster_id;
    if c.drop_slug is null and cnt >= d.rounds then
      update waiver_claim set status = 'lost', note = 'roster full', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;

    if c.drop_slug is not null then
      delete from native_roster where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug;
      update league_pool set waived_until = now() + interval '24 hours'
        where league_id = p_league_id and slug = c.drop_slug;
    end if;
    insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, c.roster_id, c.add_slug, 'waiver');
    update waiver_claim set status = 'won', processed_at = now() where id = c.id;
    update league_membership set waiver_priority =
        (select coalesce(max(waiver_priority), 0) + 1 from league_membership where league_id = p_league_id)
      where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    won := won + 1; changed := true;
  end loop;

  if changed then perform native_materialize(p_league_id); end if;
  return jsonb_build_object('ok', true, 'won', won, 'lost', lost);
end $$;

-- One-shot team-management poll: my roster id, roster cap, waiver order, my
-- pending claims, and recent transactions.
create or replace function native_team_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_roster int; d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select sleeper_roster_id into my_roster from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select * into d from draft where league_id = p_league_id;
  return jsonb_build_object(
    'my_roster_id', my_roster,
    'draft_status', coalesce(d.status, 'none'),
    'roster_cap', d.rounds,
    'server_now', now(),
    'waiver_order', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'priority', m.waiver_priority)
        order by m.waiver_priority nulls last, m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id),
    'my_claims', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'add_slug', c.add_slug, 'drop_slug', c.drop_slug, 'status', c.status,
        'note', c.note, 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants (RPC-only writes; tables stay RLS-guarded)
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function create_native_league(text, text, int, int, int) to authenticated;
grant execute on function native_join(text, text) to authenticated;
grant execute on function set_team_name(uuid, int, text) to authenticated;
grant execute on function seed_league_pool(uuid, jsonb) to authenticated;
grant execute on function native_generate_schedule(uuid, int) to authenticated;
grant execute on function start_draft(uuid, jsonb) to authenticated;
grant execute on function make_draft_pick(uuid, text) to authenticated;
grant execute on function draft_tick(uuid) to authenticated;
grant execute on function draft_state(uuid) to authenticated;
grant execute on function drop_player(uuid, int, text) to authenticated;
grant execute on function add_free_agent(uuid, int, text, text) to authenticated;
grant execute on function submit_waiver_claim(uuid, int, text, text) to authenticated;
grant execute on function cancel_waiver_claim(uuid) to authenticated;
grant execute on function process_waivers(uuid) to authenticated;
grant execute on function native_team_state(uuid) to authenticated;
grant execute on function native_materialize(uuid) to authenticated;
