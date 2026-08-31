-- 0273: THE BLADE AND THE BITE, ON YOUR PHONE (v0.387.0).
--
-- Founder: "let's do the push notifications for both."
--
-- v0.385.0 and v0.386.0 gave the two format events a banner — 🪓 CHOPPED and
-- 🩸 BITTEN — but a banner only lands if you happen to open the app. These
-- are the two moments in the whole product a manager most needs to hear about
-- without looking: your season ended, or a player left your roster while you
-- were not watching. Neither had ever pushed.
--
-- One new kind, `format`, rather than two: both events are rare, high-stakes
-- and per-format, and a manager who wants to hear about their own elimination
-- wants to hear about being fed on too. Muting is per device, like every other
-- kind (push_token.prefs — a missing key is ON).
--
-- The DETECTORS are the worker's (server/src/push.js), and both key off rows
-- that already carry a timestamp, so the trailing-window re-scan the other
-- detectors use works unchanged:
--   • the blade → league_txn (kind 'elimination'), written by guillotine_tick;
--   • the bite  → vampire_steal.resolved_at, stamped by _execute_steal.
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('lineup', 'chat', 'trades', 'waivers', 'draft', 'members', 'format'));

-- 0241's body, with the new key appended.
create or replace function _sanitize_push_prefs(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['lineup', 'chat', 'trades', 'waivers', 'draft', 'members', 'format'] loop
    if jsonb_typeof(p -> k) = 'boolean' then out := out || jsonb_build_object(k, (p ->> k)::boolean); end if;
  end loop;
  return out;
end $$;
