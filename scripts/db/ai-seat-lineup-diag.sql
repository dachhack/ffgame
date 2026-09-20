-- ─────────────────────────────────────────────────────────────────────────────
-- ai-seat-lineup-diag.sql — why is THAT player in the AI seat's lineup? (v0.432.3)
--
-- READ ONLY. Every statement is a SELECT. Run it through dbquery.yml, or:
--   psql "$DATABASE_URL" -f scripts/db/ai-seat-lineup-diag.sql
-- Set the league-name prefix and the team-name prefix in the CTEs below.
--
-- Founder: "Heidenreich in a starting RB spot is not optimal. There are like 20
-- better options on waivers. Steelers should have added an RB on waivers."
-- The fill (autoSlotClassicLineups) re-plans a seat the worker manages every
-- tick; the wire (seatWire) claims hourly. Each section names one thing that
-- decides what they do:
--   1. THE SEAT — who manages it (controller, account, agent row): the fill
--      writes rows only for an account (the human's, or the agent's); an AI
--      seat with neither has its lineup computed live and never stored.
--   2. THE WEEK — matchup status, lock; the slate's kickoffs are the worker's.
--   3. THE ROWS — the stored lineup, locked or not, and who wrote it.
--   4. THE ROSTER — every player, spot, designation, and the bake's projection
--      is NOT here (it is in the app) — so the designation column is what the
--      fill zeroes on (O/IR) or prices (Q/D in golf).
--   5. THE WIRE — the seat's claims, the league's waiver mode and FA window,
--      the commissioner's agent-waivers switch, and the wire block reason.
-- ─────────────────────────────────────────────────────────────────────────────
\set QUIET on
with lg as (select id, name, settings_json, lineup_policy from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower('Steelers%') limit 1)
select 'seat' as section, lg.name as league, lg.settings_json ->> 'game_mode' as game_mode,
       lg.settings_json ->> 'golf' as golf, lg.lineup_policy,
       lg.settings_json -> 'roster_slots' as roster_slots,
       seat.sleeper_roster_id as roster_id, seat.team_name, seat.controller, seat.app_user_id,
       seat.enrolled, seat.eliminated_week,
       exists (select 1 from seat_agent sa where sa.league_id = lg.id and sa.roster_id = seat.sleeper_roster_id) as agent_row,
       agent_wire_seat(lg.id, seat.sleeper_roster_id) as worker_may_transact,
       wire_block_reason(lg.id, seat.sleeper_roster_id) as wire_block,
       league_agent_waivers(lg.id) as agent_waivers_on,
       league_waiver_mode(lg.id) as waiver_mode
from lg cross join seat;

with lg as (select id from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower('Steelers%') limit 1)
select 'week' as section, mu.id as matchup_id, mu.week, mu.status, mu.lock_at, mu.home_roster_id, mu.away_roster_id, mu.home_final, mu.away_final
from lg cross join seat
join matchup mu on mu.league_id = lg.id and seat.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
where mu.week between 1 and 18
order by mu.week desc limit 3;

with lg as (select id from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower('Steelers%') limit 1),
     wk as (select mu.id, mu.week from lg cross join seat join matchup mu on mu.league_id = lg.id and seat.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
            where mu.week between 1 and 18 and mu.status in ('scheduled', 'live') order by mu.week limit 1)
select 'rows' as section, wk.week, sp.roster_slot, sp.player_slug, sp.locked, sp.app_user_id,
       case when sp.app_user_id = seat.app_user_id then 'the seat''s account'
            when exists (select 1 from seat_agent sa where sa.agent_user_id = sp.app_user_id) then 'an agent'
            else 'someone else' end as written_as,
       sp.updated_at
from lg cross join seat cross join wk
join sealed_pick sp on sp.matchup_id = wk.id and sp.game_window = 'wk'
order by sp.app_user_id, sp.roster_slot;

with lg as (select id from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower('Steelers%') limit 1)
select 'roster' as section, nr.slug, nr.spot, nr.acquired, lp.pos, lp.team, ist.status as designation, ist.updated_at as designated_at
from lg cross join seat
join native_roster nr on nr.league_id = lg.id and nr.roster_id = seat.sleeper_roster_id
left join league_pool lp on lp.league_id = lg.id and lp.slug = nr.slug
left join injury_status ist on ist.player_slug = nr.slug
order by lp.pos, nr.spot, nr.slug;

with lg as (select id from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower('Steelers%') limit 1)
select 'claims' as section, wc.add_slug, wc.drop_slug, wc.bid, wc.status, wc.note, wc.created_at, wc.processed_at
from lg cross join seat
join waiver_claim wc on wc.league_id = lg.id and wc.roster_id = seat.sleeper_roster_id
order by wc.created_at desc limit 12;

with lg as (select id, settings_json from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1)
select 'wire' as section,
       league_fa_mode(lg.id) as fa_mode, fa_window_open(lg.id) as fa_open_now, fa_open_since(lg.id) as fa_open_since,
       fa_opens_at(lg.id) as fa_opens_at, next_waiver_run(lg.id) as next_waiver_run,
       lg.settings_json ->> 'fa_start_min' as fa_start_min, lg.settings_json ->> 'fa_end_min' as fa_end_min,
       lg.settings_json ->> 'waiver_clear_min' as waiver_clear_min, lg.settings_json -> 'waiver_clear_dow' as waiver_clear_dow,
       count(*) filter (where lp.waived_until > now()) as on_waivers_now,
       count(*) filter (where lp.waived_until is null or lp.waived_until <= now()) as free_agents,
       count(*) filter (where lp.pos = 'RB' and (lp.waived_until is null or lp.waived_until <= now())) as free_rbs,
       (select count(*) from injury_status) as designations_on_file,
       (select max(updated_at) from injury_status) as last_injury_poll
from lg join league_pool lp on lp.league_id = lg.id
where not exists (select 1 from native_roster nr where nr.league_id = lg.id and nr.slug = lp.slug)
group by lg.id, lg.settings_json;

with lg as (select id from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1)
select 'free RBs' as section, lp.slug, lp.team, lp.waived_until, ist.status as designation
from lg join league_pool lp on lp.league_id = lg.id
left join injury_status ist on ist.player_slug = lp.slug
where lp.pos = 'RB' and not exists (select 1 from native_roster nr where nr.league_id = lg.id and nr.slug = lp.slug)
order by lp.slug limit 40;
