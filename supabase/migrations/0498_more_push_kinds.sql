-- 0498: SEVEN NEW PUSH TYPES, EACH ITS OWN SWITCH (v0.708.0).
--
-- Founder: "Any app notification additions we could do? League event timing,
-- player status, roster QC, player events like TDs and big plays" → "Let's do
-- them all but work through tuning and turn off/on options for each."
--
-- The types (packages/core/src/data/pushKinds.ts is the one list the phone,
-- the web and the worker read): status (a starter ruled out), rosterqc (the
-- night-before and 90-minute lineup checks), timing (league deadlines),
-- result (finals, the Monday sweat, clinched/eliminated), bigplay and oppplay
-- (live TDs and 20+ yard plays — off until a member switches them on; the
-- default lives in pushKinds.ts, the database only stores what was touched),
-- coin (drip coin).
--
-- Two lists gate a type, and both move here:
--   • push_outbox_kind_check — the previous list (0295) plus the seven;
--   • _sanitize_push_prefs — the switches a device may store (0273's body,
--     the keys extended), or a new switch would be dropped on save.

alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('lineup', 'chat', 'trades', 'waivers', 'draft', 'members', 'format', 'widget',
                  'status', 'rosterqc', 'timing', 'result', 'bigplay', 'oppplay', 'coin'));

create or replace function _sanitize_push_prefs(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['lineup', 'chat', 'trades', 'waivers', 'draft', 'members', 'format',
                           'status', 'rosterqc', 'timing', 'result', 'bigplay', 'oppplay', 'coin'] loop
    if jsonb_typeof(p -> k) = 'boolean' then out := out || jsonb_build_object(k, (p ->> k)::boolean); end if;
  end loop;
  return out;
end $$;
