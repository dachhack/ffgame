-- ─────────────────────────────────────────────────────────────────────────────
-- kickoff-free-agency-open.sql — turn free agency ON for the Kickoff League.
--
-- WRITES. Run through dbquery.yml with allow_writes = true, or:
--   psql "$DATABASE_URL" -f scripts/db/kickoff-free-agency-open.sql
--
-- Founder: "I need the turn free agency on for kick off league."
--
-- The same change the commissioner console makes with FREE AGENCY → ALWAYS
-- OPEN (WAIVERS & TRADES tab), done here because set_transaction_rules
-- answers only a signed-in commissioner and psql has no auth.uid(). Two
-- statements, both scoped to the league by name:
--   1. fa_mode = 'open' (0287). 'open' ignores any stored window hours, so
--      fa_start_min / fa_end_min are left as they are, exactly as the
--      console's ALWAYS OPEN toggle leaves them.
--   2. Pending claims that carry their own clock are re-stamped through
--      claim_clears_at (0291), as set_transaction_rules would — a claim
--      born behind the shut door keeps a deadline that no longer applies.
-- Prints the league's rules before and after, so the run is its own receipt.
-- ─────────────────────────────────────────────────────────────────────────────
\set QUIET on
with lg as (select id, name, settings_json from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1)
select 'before' as section, name, league_fa_mode(id) as fa_mode, fa_window_open(id) as fa_open_now,
       settings_json ->> 'fa_start_min' as fa_start_min, settings_json ->> 'fa_end_min' as fa_end_min,
       league_waiver_mode(id) as waiver_mode,
       (select count(*) from waiver_claim c where c.league_id = lg.id and c.status = 'pending') as pending_claims
from lg;

update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"fa_mode": "open"}'::jsonb
where id = (select id from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1);

update waiver_claim c set clears_at = claim_clears_at(c.league_id)
where c.status = 'pending' and c.clears_at is not null
  and c.league_id = (select id from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1);

with lg as (select id, name, settings_json from league where lower(name) like lower('Kickoff%') order by created_at desc limit 1)
select 'after' as section, name, league_fa_mode(id) as fa_mode, fa_window_open(id) as fa_open_now,
       fa_open_since(id) as fa_open_since, next_waiver_run(id) as next_waiver_run,
       (select count(*) from waiver_claim c where c.league_id = lg.id and c.status = 'pending') as pending_claims
from lg;
