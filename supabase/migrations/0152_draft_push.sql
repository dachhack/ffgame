-- 0152: DRAFT PUSHES — a fifth push kind.
--
-- Draft night is the one scheduled hour the whole league shares, and the two
-- pushes that matter most all season fire inside it: "the draft is LIVE" and
-- "you're ON THE CLOCK". The worker's draft sweep (push.js detectDraft) also
-- became the draft's heartbeat — draft_tick's guard already admits the
-- service role, so an unattended draft autopicks on the worker's cadence
-- instead of stalling until someone opens the room.
--
-- Schema half: the outbox admits kind 'draft', and the per-device mute prefs
-- learn the matching key.

alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('lineup', 'chat', 'trades', 'waivers', 'draft'));

create or replace function _sanitize_push_prefs(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['lineup', 'chat', 'trades', 'waivers', 'draft'] loop
    if jsonb_typeof(p -> k) = 'boolean' then out := out || jsonb_build_object(k, (p ->> k)::boolean); end if;
  end loop;
  return out;
end $$;
