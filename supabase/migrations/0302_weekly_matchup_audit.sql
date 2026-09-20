-- 0302: THE WEEKLY MATCHUP AUDIT (v0.430.0) — who actually played the week.
--
-- Founder: "Let's create a weekly audit of matchups for me. I'd love to know
-- how active each team and league is. What moves were from the computer vs
-- player vs AI players. Were slots left empty or out players started. What
-- waiver pickups were player vs AI. Etc"
--
-- One admin-only read, `admin_week_audit(week, season)`, that answers those
-- questions from rows that already exist. Nothing new is written by the game
-- to feed it; the audit is a READING of the week, and it repairs nothing.
--
-- ── WHO MADE A MOVE ─────────────────────────────────────────────────────────
-- Every lineup row is a sealed_pick and every sealed_pick write is audited
-- (0001's trigger) with `actor = auth.uid()` — a person's uid when a browser
-- wrote it, NULL when the worker (service role) did. That NULL is the whole
-- distinction the founder is asking for, and it has been recorded since day
-- one; this migration only reads it. A fielded slot's SOURCE is:
--
--   player   a human on that seat (the holder or a co-manager, 0125) wrote
--            the player who is in the slot;
--   admin    a different human did — the commissioner or an admin, through
--            admin_set_picks and friends;
--   auto     the computer: the worker's lock-time fill on a HUMAN-held seat
--            (a missed or partial lineup, lock.js materializeAutoLineups), or
--            the resolve-time fallback lineup when nothing was stored;
--   agent    the auto-managed UNCLAIMED seat (0180 seat_agent) — also the
--            computer, but with nobody anywhere behind it;
--   ai       a 🤖 seat (league_membership.controller = 'ai', 0022): the AI
--            persona at resolve, or an auto-pilot manager's rows.
--
-- What is COUNTED as fielded is the union of the seat's sealed rows and what
-- matchup_state.slot_scores says scored for that side — the second covers an
-- AI seat with no account, whose lineup is composed at resolve and never
-- stored as rows.
--
-- Transactions read league_txn (0186) the same way: `actor` set → a person
-- (player if on that seat, admin otherwise; a trade's rows are the deal's two
-- humans); NULL on a held seat → the waiver run processed that manager's own
-- claim (0213/0298 never let the worker file for a held seat); NULL on an
-- agent or AI seat → the seat wire (seatWire.js). Waiver CLAIMS carry no actor
-- at all, so a claim's source is simply whose seat it is.
--
-- ── EMPTY, OUT, BYE ─────────────────────────────────────────────────────────
-- Expected slots per seat are the board's own count: enforce_slot_cap's rule
-- (0163) — a classic league's spot list, a drip week's week_slot_count. Empty
-- is expected minus fielded, never below zero (best-ball backups can exceed
-- it). "Out started" is a fielded player whose injury_status is O or IR NOW —
-- the poll is current, not as-of-kickoff, and the audit says so in its
-- payload. "Bye started" is a fielded player whose team (league_pool, or
-- player_team_override) does not appear in the week's nfl_slate; leagues with
-- no pool row for the player (Sleeper imports) cannot be judged and are left
-- out rather than guessed.
--
-- ── THE WINDOW ──────────────────────────────────────────────────────────────
-- "This week" for activity (pick edits, transactions, claims, chat, shop) runs
-- from five hours after the PREVIOUS week's last kickoff to five hours after
-- this week's; a season with no slate loaded falls back to the week's lock_at
-- minus six days / plus one. Both ends can be overridden (p_from, p_to), which
-- is also what lets the probes run on a fixture week the real calendar never
-- covers.
--
-- ── COST ────────────────────────────────────────────────────────────────────
-- The one lookup that had no index is "the audit rows of THIS pick"; 0058
-- indexed the log by time only. A partial index on row_id for sealed_pick rows
-- makes the per-slot source an index probe. `concurrently` as in 0058: the
-- migrate workflow applies statement by statement in autocommit.

create index concurrently if not exists audit_log_sealed_row_idx
  on audit_log (row_id) where table_name = 'sealed_pick';
create index if not exists waiver_claim_league_created_idx
  on waiver_claim (league_id, created_at desc);

-- NFL codes drift between feeds; the audit compares byes after folding the
-- usual aliases. Mirrors the worker's normTeam for the codes that matter.
create or replace function _audit_team_code(t text) returns text
  language sql immutable as $$
  select case upper(coalesce(t, ''))
           when 'JAC' then 'JAX' when 'WSH' then 'WAS' when 'LA' then 'LAR'
           when 'STL' then 'LAR' when 'SD' then 'LAC' when 'OAK' then 'LV'
           else upper(coalesce(t, '')) end;
$$;

create or replace function admin_week_audit(
  p_week int default null, p_season text default null,
  p_from timestamptz default null, p_to timestamptz default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wk int := p_week; sea text := p_season;
  w_from timestamptz := p_from; w_to timestamptz := p_to;
  slate_loaded boolean; result jsonb;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  -- The season: as given, else the newest one with a matchup (for that week).
  if sea is null then
    select l.season into sea from matchup m join league l on l.id = m.league_id
     where (wk is null or m.week = wk) order by l.season desc limit 1;
  end if;
  -- The week: as given, else the latest regular week with a stamped final,
  -- else the latest with any matchup at all.
  if wk is null and sea is not null then
    select max(m.week) into wk from matchup m join league l on l.id = m.league_id
     where l.season = sea and m.week < 100 and m.status = 'final';
    if wk is null then
      select max(m.week) into wk from matchup m join league l on l.id = m.league_id
       where l.season = sea and m.week < 100;
    end if;
  end if;
  if wk is null or sea is null then
    return jsonb_build_object('ok', true, 'week', wk, 'season', sea, 'leagues', '[]'::jsonb,
                              'note', 'no matchups to audit');
  end if;

  if w_from is null then
    select coalesce(
      (select max(kickoff) + interval '5 hours' from nfl_slate
        where season = sea and week = wk - 1 and kickoff is not null),
      (select min(m.lock_at) - interval '6 days' from matchup m join league l on l.id = m.league_id
        where l.season = sea and m.week = wk),
      now() - interval '7 days') into w_from;
  end if;
  if w_to is null then
    select coalesce(
      (select max(kickoff) + interval '5 hours' from nfl_slate
        where season = sea and week = wk and kickoff is not null),
      (select min(m.lock_at) + interval '1 day' from matchup m join league l on l.id = m.league_id
        where l.season = sea and m.week = wk),
      now()) into w_to;
  end if;
  slate_loaded := exists (select 1 from nfl_slate where season = sea and week = wk);

  with
  lg as (
    select l.id, l.name, l.season, l.provider, l.lineup_policy, l.settings_json,
           coalesce(l.settings_json ->> 'game_mode', 'drip') as game_mode,
           coalesce(l.settings_json ->> 'format', 'standard') as format
      from league l
     where l.season = sea
       and exists (select 1 from matchup m where m.league_id = l.id and m.week = wk)
  ),
  mu as (select m.* from matchup m join lg on lg.id = m.league_id where m.week = wk),
  seat as (
    select lm.league_id, lm.sleeper_roster_id as roster_id, coalesce(nullif(lm.team_name, ''), 'Team ' || lm.sleeper_roster_id) as team,
           lm.app_user_id, lm.enrolled, coalesce(lm.controller, 'human') as controller,
           sa.agent_user_id,
           case when lm.app_user_id is not null then 'human'
                when coalesce(lm.controller, 'human') = 'ai' then 'ai'
                when sa.agent_user_id is not null then 'agent'
                else 'empty' end as kind,
           coalesce(lm.app_user_id, sa.agent_user_id) as seat_uid
      from league_membership lm join lg on lg.id = lm.league_id
      left join seat_agent sa on sa.league_id = lm.league_id and sa.roster_id = lm.sleeper_roster_id
  ),
  seat_users as (
    select s.league_id, s.roster_id, s.app_user_id as uid from seat s where s.app_user_id is not null
    union
    select tm.league_id, tm.roster_id, tm.app_user_id from team_manager tm join lg on lg.id = tm.league_id
  ),
  side as (
    select m.id as matchup_id, m.league_id, m.home_roster_id as roster_id, 'home' as side,
           m.away_roster_id as opp, m.home_final as pf, m.away_final as pa, m.status::text as status from mu m
    union all
    select m.id, m.league_id, m.away_roster_id, 'away', m.home_roster_id, m.away_final, m.home_final, m.status::text from mu m
  ),
  -- What scored, per side, from the resolver's own slot rows.
  scored as (
    select sd.matchup_id, sd.league_id, sd.roster_id, ms.game_window as win,
           sc ->> 'slot' as slot, sc ->> 'slug' as slug, nullif(sc ->> 'metric', '') as metric,
           (sc ->> 'score')::numeric as score
      from side sd
      join matchup_state ms on ms.matchup_id = sd.matchup_id
      cross join lateral jsonb_array_elements(coalesce(ms.slot_scores, '[]'::jsonb)) sc
     where sc ->> 'side' = sd.side and coalesce(sc ->> 'slug', '') <> ''
  ),
  -- What was stored, per seat, with who wrote the player who is in the slot.
  sealed as (
    select sp.id, sp.matchup_id, sd.league_id, sd.roster_id, s.kind, s.controller,
           sp.game_window as win, sp.roster_slot as slot, sp.player_slug as slug,
           nullif(sp.metric_id, '') as metric, sp.locked,
           (select a.actor from audit_log a
             where a.table_name = 'sealed_pick' and a.row_id = sp.id::text
               and a.actor is not null and a.new_row ->> 'player_slug' = sp.player_slug
             order by a.at desc limit 1) as set_by
      from sealed_pick sp
      join side sd on sd.matchup_id = sp.matchup_id
      join seat s on s.league_id = sd.league_id and s.roster_id = sd.roster_id
     where sp.player_slug is not null and sp.app_user_id = s.seat_uid
  ),
  fielded as (
    select x.league_id, x.roster_id, x.matchup_id, x.win, x.slot, x.slug, x.metric, x.locked,
           case when x.set_by is not null and exists (select 1 from seat_users su
                    where su.league_id = x.league_id and su.roster_id = x.roster_id and su.uid = x.set_by) then 'player'
                when x.set_by is not null then 'admin'
                when x.kind = 'ai' or x.controller = 'ai' then 'ai'
                when x.kind = 'agent' then 'agent'
                else 'auto' end as source,
           (select sc.score from scored sc where sc.matchup_id = x.matchup_id and sc.roster_id = x.roster_id and sc.slug = x.slug limit 1) as score
      from sealed x
    union all
    select sc.league_id, sc.roster_id, sc.matchup_id, sc.win, sc.slot, sc.slug, sc.metric, true,
           case when s.kind = 'ai' or s.controller = 'ai' then 'ai' when s.kind = 'agent' then 'agent' else 'auto' end,
           sc.score
      from scored sc join seat s on s.league_id = sc.league_id and s.roster_id = sc.roster_id
     where not exists (select 1 from sealed x
                        where x.matchup_id = sc.matchup_id and x.roster_id = sc.roster_id and x.slug = sc.slug)
  ),
  expected as (
    select lg.id as league_id,
           case when lg.game_mode = 'classic' then coalesce(
                    case when jsonb_typeof(lg.settings_json -> 'roster_slots') = 'array'
                         then jsonb_array_length(lg.settings_json -> 'roster_slots') end,
                    case when jsonb_typeof(lg.settings_json -> 'roster_classic') = 'object'
                         then (select sum((v.value)::int)::int from jsonb_each_text(lg.settings_json -> 'roster_classic') v) end,
                    9)
                when wk >= 101 then practice_slot_cap()
                else greatest(base_slot_count(), week_slot_count(lg.season, wk)) end as n
      from lg
  ),
  team_of as (
    select f.league_id, f.slug,
           _audit_team_code(coalesce(nullif(o.team, ''), nullif(p.team, ''))) as team,
           (o.slug is not null or p.slug is not null) as known
      from (select distinct league_id, slug from fielded) f
      left join league_pool p on p.league_id = f.league_id and p.slug = f.slug
      left join player_team_override o on o.slug = f.slug
  ),
  slate_teams as (
    select _audit_team_code(home) as t from nfl_slate where season = sea and week = wk
    union select _audit_team_code(away) from nfl_slate where season = sea and week = wk
  ),
  outs as (select player_slug as slug from injury_status where upper(status) in ('O', 'IR', 'OUT')),
  flagged as (
    select f.league_id, f.roster_id, f.slug, f.source,
           exists (select 1 from outs o where o.slug = f.slug) as is_out,
           (slate_loaded and t.known and t.team <> '' and t.team not in (select t2.t from slate_teams t2)) as is_bye
      from fielded f join team_of t on t.league_id = f.league_id and t.slug = f.slug
  ),
  pick_edits as (
    select su.league_id, su.roster_id, count(*)::int as n, max(a.at) as last_at
      from audit_log a
      join seat_users su on su.uid = a.actor
      join mu m on m.id::text = coalesce(a.new_row ->> 'matchup_id', a.old_row ->> 'matchup_id')
              and m.league_id = su.league_id
     where a.table_name = 'sealed_pick' and a.actor is not null and a.at >= w_from and a.at < w_to
     group by 1, 2
  ),
  txn as (
    select t.league_id, t.roster_id, t.kind, t.at,
           case when t.kind = 'commish' then 'commish'
                when t.actor is not null and (t.kind = 'trade' or exists (select 1 from seat_users su
                    where su.league_id = t.league_id and su.roster_id = t.roster_id and su.uid = t.actor)) then 'player'
                when t.actor is not null then 'admin'
                when s.kind = 'ai' then 'ai'
                when s.kind = 'agent' then 'agent'
                when s.kind = 'human' and t.kind in ('waiver', 'trade') then 'player'
                else 'system' end as source
      from league_txn t join seat s on s.league_id = t.league_id and s.roster_id = t.roster_id
     where t.at >= w_from and t.at < w_to
  ),
  claim as (
    select c.league_id, c.roster_id, c.status, c.created_at, c.bid,
           case when s.kind = 'human' then 'player' when s.kind = 'ai' then 'ai'
                when s.kind = 'agent' then 'agent' else 'system' end as source
      from waiver_claim c join seat s on s.league_id = c.league_id and s.roster_id = c.roster_id
     where c.created_at >= w_from and c.created_at < w_to
  ),
  chat as (
    select su.league_id, su.roster_id, count(*)::int as n, max(m.created_at) as last_at
      from league_message m join seat_users su on su.uid = m.author_id and su.league_id = m.league_id
     where m.created_at >= w_from and m.created_at < w_to and m.author_id is not null
     group by 1, 2
  ),
  shop as (
    select c.league_id, c.roster_id, count(*)::int as n, (-sum(c.delta))::numeric as coin, max(c.created_at) as last_at
      from coin_ledger c join lg on lg.id = c.league_id
     where c.week = wk and c.delta < 0 and c.reason like 'spend:%'
     group by 1, 2
  ),
  seen as (
    select su.league_id, su.roster_id, max(ls.last_at) as last_at
      from league_seen ls join seat_users su on su.uid = ls.app_user_id and su.league_id = ls.league_id
     group by 1, 2
  ),
  team_rows as (
    select s.league_id, s.roster_id, s.team, s.kind, s.controller, s.enrolled,
           coalesce(nullif(u.display_name, ''), u.email) as manager,
           ex.n as expected,
           (select count(*)::int from fielded f where f.league_id = s.league_id and f.roster_id = s.roster_id) as fielded_n,
           (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
              select f.source, count(*)::int as n from fielded f
               where f.league_id = s.league_id and f.roster_id = s.roster_id group by f.source) x) as sources,
           (select coalesce(jsonb_agg(jsonb_build_object('slug', g.slug, 'source', g.source) order by g.slug), '[]'::jsonb)
              from flagged g where g.league_id = s.league_id and g.roster_id = s.roster_id and g.is_out) as out_started,
           (select coalesce(jsonb_agg(jsonb_build_object('slug', g.slug, 'source', g.source) order by g.slug), '[]'::jsonb)
              from flagged g where g.league_id = s.league_id and g.roster_id = s.roster_id and g.is_bye) as bye_started,
           coalesce(pe.n, 0) as pick_edits, pe.last_at as pick_last,
           (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
              select t.source, count(*)::int as n from txn t
               where t.league_id = s.league_id and t.roster_id = s.roster_id group by t.source) x) as txns,
           (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb) from (
              select t.kind, count(*)::int as n from txn t
               where t.league_id = s.league_id and t.roster_id = s.roster_id group by t.kind) x) as txn_kinds,
           (select max(t.at) from txn t where t.league_id = s.league_id and t.roster_id = s.roster_id and t.source = 'player') as txn_last,
           (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (
              select c.status, count(*)::int as n from claim c
               where c.league_id = s.league_id and c.roster_id = s.roster_id group by c.status) x) as claims,
           (select count(*)::int from claim c where c.league_id = s.league_id and c.roster_id = s.roster_id) as claims_n,
           (select max(c.created_at) from claim c where c.league_id = s.league_id and c.roster_id = s.roster_id and c.source = 'player') as claim_last,
           coalesce(ch.n, 0) as chat_n, ch.last_at as chat_last,
           coalesce(sh.n, 0) as shop_n, coalesce(sh.coin, 0) as shop_coin,
           case when s.kind = 'human' then sh.last_at end as shop_last,
           se.last_at as seen_last,
           sd.opp, sd.pf, sd.pa, sd.status as m_status
      from seat s
      left join app_user u on u.id = s.app_user_id
      join expected ex on ex.league_id = s.league_id
      left join pick_edits pe on pe.league_id = s.league_id and pe.roster_id = s.roster_id
      left join chat ch on ch.league_id = s.league_id and ch.roster_id = s.roster_id
      left join shop sh on sh.league_id = s.league_id and sh.roster_id = s.roster_id
      left join seen se on se.league_id = s.league_id and se.roster_id = s.roster_id
      left join side sd on sd.league_id = s.league_id and sd.roster_id = s.roster_id
  ),
  team_json as (
    select t.league_id, t.kind, t.fielded_n, t.expected, t.sources, t.txns, t.claims_n,
           t.chat_n, t.shop_n, t.pick_edits, t.out_started, t.bye_started,
           (t.kind = 'human' and (t.pick_edits > 0 or t.chat_n > 0 or t.shop_n > 0
              or coalesce((t.txns ->> 'player')::int, 0) > 0 or t.claim_last is not null)) as active,
           (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
              select c.source, count(*)::int as n from claim c
               where c.league_id = t.league_id and c.roster_id = t.roster_id group by c.source) x) as claim_sources,
           jsonb_build_object(
             'roster_id', t.roster_id, 'team', t.team, 'kind', t.kind, 'controller', t.controller,
             'enrolled', t.enrolled, 'manager', t.manager,
             'result', case when t.opp is null then 'bye'
                            when t.pf is null or t.pa is null then null
                            when t.pf > t.pa then 'W' when t.pf < t.pa then 'L' else 'T' end,
             'opp', t.opp, 'pf', t.pf, 'pa', t.pa, 'matchup_status', t.m_status,
             'lineup', jsonb_build_object(
               'expected', t.expected, 'fielded', t.fielded_n,
               'empty', greatest(t.expected - t.fielded_n, 0),
               'sources', t.sources,
               'out_started', t.out_started, 'bye_started', t.bye_started),
             'activity', jsonb_build_object(
               'active', (t.kind = 'human' and (t.pick_edits > 0 or t.chat_n > 0 or t.shop_n > 0
                            or coalesce((t.txns ->> 'player')::int, 0) > 0 or t.claim_last is not null)),
               'pick_edits', t.pick_edits,
               'txns', t.txns, 'txn_kinds', t.txn_kinds,
               'claims', t.claims, 'claims_n', t.claims_n,
               'chat', t.chat_n, 'shop', t.shop_n, 'shop_coin', t.shop_coin,
               'last_active_at', greatest(t.pick_last, t.txn_last, t.claim_last, t.chat_last, t.shop_last),
               'last_seen_at', t.seen_last)) as j
      from team_rows t
  ),
  league_json as (
    select lg.id, jsonb_build_object(
      'league_id', lg.id, 'name', coalesce(lg.name, 'League'), 'provider', lg.provider,
      'game_mode', lg.game_mode, 'format', lg.format, 'lineup_policy', lg.lineup_policy,
      'matchups', (select count(*)::int from mu where mu.league_id = lg.id),
      'finals', (select count(*)::int from mu where mu.league_id = lg.id and mu.status = 'final'),
      'seats', jsonb_build_object(
        'total', (select count(*)::int from team_json t where t.league_id = lg.id),
        'human', (select count(*)::int from team_json t where t.league_id = lg.id and t.kind = 'human'),
        'ai',    (select count(*)::int from team_json t where t.league_id = lg.id and t.kind = 'ai'),
        'agent', (select count(*)::int from team_json t where t.league_id = lg.id and t.kind = 'agent'),
        'empty', (select count(*)::int from team_json t where t.league_id = lg.id and t.kind = 'empty'),
        'active', (select count(*)::int from team_json t where t.league_id = lg.id and t.active)),
      'lineup', jsonb_build_object(
        'expected', (select coalesce(sum(t.expected), 0)::int from team_json t where t.league_id = lg.id),
        'fielded',  (select coalesce(sum(t.fielded_n), 0)::int from team_json t where t.league_id = lg.id),
        'empty',    (select coalesce(sum(greatest(t.expected - t.fielded_n, 0)), 0)::int from team_json t where t.league_id = lg.id),
        'out_started', (select coalesce(sum(jsonb_array_length(t.out_started)), 0)::int from team_json t where t.league_id = lg.id),
        'bye_started', (select coalesce(sum(jsonb_array_length(t.bye_started)), 0)::int from team_json t where t.league_id = lg.id),
        'sources', (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
            select f.source, count(*)::int as n from fielded f where f.league_id = lg.id group by f.source) x)),
      'activity', jsonb_build_object(
        'pick_edits', (select coalesce(sum(t.pick_edits), 0)::int from team_json t where t.league_id = lg.id),
        'txns', (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
            select t.source, count(*)::int as n from txn t where t.league_id = lg.id group by t.source) x),
        'txn_kinds', (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb) from (
            select t.kind, count(*)::int as n from txn t where t.league_id = lg.id group by t.kind) x),
        'claims', (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
            select c.source, count(*)::int as n from claim c where c.league_id = lg.id group by c.source) x),
        'claims_won', (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
            select c.source, count(*)::int as n from claim c where c.league_id = lg.id and c.status = 'won' group by c.source) x),
        'chat', (select coalesce(sum(t.chat_n), 0)::int from team_json t where t.league_id = lg.id),
        'shop', (select coalesce(sum(t.shop_n), 0)::int from team_json t where t.league_id = lg.id)),
      'teams', (select coalesce(jsonb_agg(t.j order by (t.j ->> 'roster_id')::int), '[]'::jsonb)
                  from team_json t where t.league_id = lg.id)) as j
      from lg
  )
  select jsonb_build_object(
    'ok', true, 'v', 1, 'week', wk, 'season', sea,
    'window', jsonb_build_object('from', w_from, 'to', w_to),
    'slate_loaded', slate_loaded,
    'injury_as_of', (select max(updated_at) from injury_status),
    'totals', jsonb_build_object(
      'leagues', (select count(*) from league_json),
      'matchups', (select count(*) from mu),
      'finals', (select count(*) from mu where mu.status = 'final'),
      'seats', jsonb_build_object(
        'total', (select count(*) from team_json),
        'human', (select count(*) from team_json where kind = 'human'),
        'ai',    (select count(*) from team_json where kind = 'ai'),
        'agent', (select count(*) from team_json where kind = 'agent'),
        'empty', (select count(*) from team_json where kind = 'empty'),
        'active', (select count(*) from team_json where active)),
      'lineup', jsonb_build_object(
        'expected', (select coalesce(sum(expected), 0) from team_json),
        'fielded',  (select coalesce(sum(fielded_n), 0) from team_json),
        'empty',    (select coalesce(sum(greatest(expected - fielded_n, 0)), 0) from team_json),
        'out_started', (select coalesce(sum(jsonb_array_length(out_started)), 0) from team_json),
        'bye_started', (select coalesce(sum(jsonb_array_length(bye_started)), 0) from team_json),
        'sources', (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
            select source, count(*)::int as n from fielded group by source) x)),
      'activity', jsonb_build_object(
        'pick_edits', (select coalesce(sum(pick_edits), 0) from team_json),
        'txns', (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
            select source, count(*)::int as n from txn group by source) x),
        'claims', (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
            select source, count(*)::int as n from claim group by source) x),
        'claims_won', (select coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) from (
            select source, count(*)::int as n from claim where status = 'won' group by source) x),
        'chat', (select coalesce(sum(chat_n), 0) from team_json),
        'shop', (select coalesce(sum(shop_n), 0) from team_json))),
    'leagues', (select coalesce(jsonb_agg(l.j order by l.j ->> 'name'), '[]'::jsonb) from league_json l))
  into result;
  return result;
end $$;
grant execute on function admin_week_audit(int, text, timestamptz, timestamptz) to authenticated;
