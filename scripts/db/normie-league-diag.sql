-- Is a classic ("normie") league actually ready to play — and will its weeks
-- ever lock?
--
-- READ-ONLY. Run through dbquery.yml with the default (no writes).
--
-- WHY THIS FILE. Chasing "the matchup screen shows the wrong board" took four
-- wrong turns that a single query would have settled: is the league really in
-- classic mode, is the draft actually complete, are there matchups, and — the
-- one that bites silently — do those matchups have a lock_at at all.
--
-- THE LOCK_AT QUESTION IS THE POINT. server/src/lock.js seals with
--   .eq('status','scheduled').not('lock_at','is',null).lte('lock_at', now)
-- so a scheduled matchup with a NULL lock_at never seals: picks stay open,
-- the board never flips from the lineup setter to the head-to-head, and the
-- countdown still renders because the client derives that label from the slate
-- rather than from this column. It looks completely fine right up until
-- nothing happens. backfill-lock-at.sql is the fix when this shows nulls.
--
-- Scoped by NAME so it needs no ids pasted in; adjust the filter for a
-- different league.
\set QUIET on
\pset pager off

\echo '── LEAGUE ────────────────────────────────────────────────────────────'
select l.id,
       l.name,
       l.season,
       l.provider,
       coalesce(l.settings_json ->> 'game_mode', 'drip')          as game_mode,
       coalesce((l.settings_json ->> 'classic_ok')::boolean, false) as classic_ok,
       (select count(*) from league_membership m where m.league_id = l.id)                  as seats,
       (select count(*) from league_membership m where m.league_id = l.id and m.enrolled)   as enrolled
  from league l
 where l.name ilike '%normie%'
 order by l.name;

\echo ''
\echo '── DRAFT ─────────────────────────────────────────────────────────────'
select l.name,
       d.status,
       d.rounds,
       d.mode,
       d.start_at,
       (select count(*) from draft_pick p where p.league_id = l.id) as picks_made
  from league l join draft d on d.league_id = l.id
 where l.name ilike '%normie%';

\echo ''
\echo '── WEEK 1 MATCHUPS — the lock_at question ────────────────────────────'
select l.name,
       m.week,
       m.home_roster_id  as home,
       m.away_roster_id  as away,
       m.status,
       m.lock_at,
       case
         when m.lock_at is null and m.status = 'scheduled'
           then 'NEVER LOCKS — no lock_at; run backfill-lock-at.sql'
         when m.lock_at is null then 'no lock_at (status is not scheduled)'
         when m.lock_at > now() then 'locks in ' || justify_interval(m.lock_at - now())
         else 'lock time has passed'
       end as verdict
  from league l join matchup m on m.league_id = l.id
 where l.name ilike '%normie%' and m.week = 1
 order by l.name, m.home_roster_id;

\echo ''
\echo '── EVERY WEEK: how many matchups, how many missing a lock_at ─────────'
select l.name,
       m.week,
       count(*)                                        as matchups,
       count(*) filter (where m.lock_at is null)       as missing_lock_at
  from league l join matchup m on m.league_id = l.id
 where l.name ilike '%normie%'
 group by l.name, m.week
 order by l.name, m.week;

\echo ''
\echo '── LINEUPS SET FOR WEEK 1 (classic uses the wk pseudo-window) ────────'
-- An unclaimed seat drafts a roster but nobody sets its lineup, so a solo test
-- league shows the opponent column as Empty. That is honest, not broken — this
-- says which seats actually have picks in.
select l.name,
       sp.app_user_id is not null as has_owner,
       m.home_roster_id           as home,
       m.away_roster_id           as away,
       count(sp.*)                as wk_picks
  from league l
  join matchup m on m.league_id = l.id and m.week = 1
  left join sealed_pick sp on sp.matchup_id = m.id and sp.game_window = 'wk'
 where l.name ilike '%normie%'
 group by l.name, sp.app_user_id is not null, m.home_roster_id, m.away_roster_id
 order by l.name, m.home_roster_id;
