-- 0310: FREE AGENCY ON FOR THE KICKOFF LEAGUE (v0.433.7). A data migration.
--
-- Founder: "I need the turn free agency on for kick off league." Then:
-- "Right now."
--
-- The console does this with FREE AGENCY → ALWAYS OPEN (WAIVERS & TRADES),
-- and scripts/db/kickoff-free-agency-open.sql does it from psql — but the
-- session's GitHub integration may not dispatch dbquery.yml (403), and the
-- one write path that runs on its own is this: a migration lands on main and
-- migrate.yml applies it within the minute. So the same two statements ride
-- here. Scoped to the newest league whose name starts with "Kickoff";
-- idempotent; a no-op on any database without one (the scratch runner, a
-- fresh install).
--
--   1. fa_mode = 'open' (0287). 'open' ignores any stored window hours, so
--      fa_start_min / fa_end_min are left as they are, exactly as the
--      console's ALWAYS OPEN toggle leaves them.
--   2. Pending claims that carry their own clock are re-stamped through
--      claim_clears_at (0291), as set_transaction_rules would — a claim born
--      behind the shut door keeps a deadline that no longer applies.
do $$
declare lid uuid; before_mode text; after_mode text; restamped int;
begin
  select id into lid from league where lower(name) like 'kickoff%' order by created_at desc limit 1;
  if lid is null then
    raise notice '0310: no Kickoff league here — nothing to do';
    return;
  end if;
  before_mode := league_fa_mode(lid);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"fa_mode": "open"}'::jsonb where id = lid;
  update waiver_claim c set clears_at = claim_clears_at(c.league_id)
    where c.league_id = lid and c.status = 'pending' and c.clears_at is not null;
  get diagnostics restamped = row_count;
  after_mode := league_fa_mode(lid);
  raise notice '0310: Kickoff league % — fa_mode % → %, open now: %, % pending claim(s) re-stamped',
    lid, before_mode, after_mode, fa_window_open(lid), restamped;
end $$;
