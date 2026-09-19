-- ─────────────────────────────────────────────────────────────────────────────
-- vampire-bite-diag.sql — how did THAT steal happen? (v0.425.0)
--
-- READ ONLY. Every statement is a SELECT; it changes nothing. Paste it into the
-- Supabase SQL editor (or run: psql "$DATABASE_URL" -f scripts/db/vampire-bite-diag.sql).
-- Set the league name in the first CTE; it matches on a prefix, case-insensitive.
--
-- Founder: "Looks like the vampire lost but took Amon-Ra. Should have not been
-- able to take a player." The steal RPC refuses a loss outright, so a bite
-- after a loss has exactly one of these shapes, and each section below names
-- the one it finds:
--
--   1. THE WINDOW READ A PRACTICE WEEK (0297 fixed it). Practice weeks 101+
--      are final rows above every regular week, so "latest final week" was
--      103 all season. Section 2 shows the week each bite was stamped with;
--      a bite at week > 100 is this.
--   2. THE FINALS MOVED UNDER IT. admin_stamp_week (0250) writes plausible
--      finals on a sandbox league; the resolver later rewrites home_final /
--      away_final on a final matchup from real plays. A bite that was legal
--      when declared reads as a loss now. Section 2's resolved_at against
--      section 3's matchup updated_at tells you which came first.
--   3. IT WAS NOT A STEAL. The vampire may SIGN from the pool (0268) — an
--      undrafted player is a plain add. Section 4 reads the register: a
--      'steal' kind is a bite, an 'add' is the wire.
--   4. SEVERAL VAMPIRES. A coven feeds independently; the one that won bit.
--      Section 1 lists the seats.
-- ─────────────────────────────────────────────────────────────────────────────
with lg as (
  select id, name, settings_json
  from league
  where lower(name) like lower('Vamp%')       -- ← the league
  order by created_at desc limit 1
)

-- ── 1. The league: format, the coven, the wire lock ──────────────────────────
select 'league' as section, l.name, league_format(l.id) as format,
       vampire_seats(l.id) as vampire_seats, vampire_wire_lock_on(l.id) as wire_lock,
       steal_review_on(l.id) as steal_review,
       (select count(*) from matchup m where m.league_id = l.id and is_practice_week(m.week)
          and m.status = 'final') as final_practice_matchups
from lg l;

-- ── 2. Every bite, with the result the window reads NOW for that week ────────
with lg as (select id from league where lower(name) like lower('Vamp%') order by created_at desc limit 1)
select 'bites' as section, v.id, v.week,
       case when is_practice_week(v.week) then 'PRACTICE WEEK — the 0297 hole' else 'regular' end as week_kind,
       v.vampire, vm.team_name as vampire_team, v.victim, tm.team_name as victim_team,
       v.take_slug, v.give_slug, v.status, v.created_at, v.resolved_at,
       mu.home_roster_id, mu.away_roster_id, mu.home_final, mu.away_final, mu.status as matchup_status,
       case when mu.id is null then 'no matchup row'
            when (mu.home_roster_id = v.vampire and mu.home_final > mu.away_final)
              or (mu.away_roster_id = v.vampire and mu.away_final > mu.home_final) then 'vampire WON (as read now)'
            else 'vampire did NOT win (as read now) — finals moved, or a practice week' end as verdict
from vampire_steal v
join lg on lg.id = v.league_id
left join matchup mu on mu.league_id = v.league_id and mu.week = v.week
  and v.vampire in (mu.home_roster_id, mu.away_roster_id)
left join league_membership vm on vm.league_id = v.league_id and vm.sleeper_roster_id = v.vampire
left join league_membership tm on tm.league_id = v.league_id and tm.sleeper_roster_id = v.victim
order by v.created_at desc;

-- ── 3. The vampire seats' matchups, every week, as the finals read now ───────
with lg as (select id from league where lower(name) like lower('Vamp%') order by created_at desc limit 1)
select 'vampire weeks' as section, mu.week,
       case when is_practice_week(mu.week) then 'practice' else 'regular' end as week_kind,
       s.seat as vampire, mu.home_roster_id, mu.away_roster_id, mu.status, mu.home_final, mu.away_final,
       case when mu.home_final is null or mu.away_final is null then 'unstamped'
            when (mu.home_roster_id = s.seat and mu.home_final > mu.away_final)
              or (mu.away_roster_id = s.seat and mu.away_final > mu.home_final) then 'W'
            when mu.home_final = mu.away_final then 'T' else 'L' end as result,
       mu.lock_at
from lg
cross join lateral unnest(vampire_seats(lg.id)) as s(seat)
join matchup mu on mu.league_id = lg.id and s.seat in (mu.home_roster_id, mu.away_roster_id)
order by mu.week, s.seat;

-- ── 4. The register: how each player on a vampire's roster got there ─────────
with lg as (select id from league where lower(name) like lower('Vamp%') order by created_at desc limit 1)
select 'vampire rosters' as section, nr.roster_id as vampire, nr.slug, nr.acquired, nr.spot,
       (select string_agg(t.kind || ' ' || coalesce(t.note, '') || ' @' || to_char(t.at, 'MM-DD HH24:MI'), ' | ' order by t.at)
          from league_txn t where t.league_id = lg.id and t.slug = nr.slug) as register
from lg
cross join lateral unnest(vampire_seats(lg.id)) as s(seat)
join native_roster nr on nr.league_id = lg.id and nr.roster_id = s.seat
order by nr.roster_id, nr.acquired, nr.slug;

-- ── 5. Who may the worker transact for here? (0298) ──────────────────────────
with lg as (select id from league where lower(name) like lower('Vamp%') order by created_at desc limit 1)
select 'seats' as section, m.sleeper_roster_id as seat, m.team_name, m.controller,
       m.app_user_id is not null as human_at_seat,
       exists (select 1 from seat_agent sa where sa.league_id = m.league_id and sa.roster_id = m.sleeper_roster_id) as agent_row,
       agent_wire_seat(m.league_id, m.sleeper_roster_id) as worker_may_transact,
       wire_block_reason(m.league_id, m.sleeper_roster_id) as wire_block,
       m.sleeper_roster_id = any(vampire_seats(m.league_id)) as is_vampire,
       (select count(*) from native_roster nr where nr.league_id = m.league_id and nr.roster_id = m.sleeper_roster_id) as rostered
from lg join league_membership m on m.league_id = lg.id
order by m.sleeper_roster_id;
