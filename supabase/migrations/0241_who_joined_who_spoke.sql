-- 0241 — WHO JOINED, AND WHO SPOKE.
--
-- Founder: "Can I get a phone alert from my app anytime someone joins a league
-- or posts a comment?"
--
-- Neither existed. Chat only pushed on an @mention naming you, a DM in your
-- thread, or a new poll — a plain message to nobody in particular reached
-- nobody's phone. And nothing at all watched membership.
--
-- Three pieces of schema, one per obstacle:
--
--   1. WHEN did somebody join? league_membership has carried no timestamp
--      since 0001, and every detector in the worker windows on one. Twenty-odd
--      migrations flip `enrolled = true` (native_join, redeem_invite, the pod
--      and showdown doors, claim_my_rosters…) so a stamp written at each call
--      site would be twenty edits and a twenty-first the day someone adds a
--      door. A TRIGGER catches every one of them, including the ones not
--      written yet.
--
--   2. WHICH KIND is it? push_outbox constrains kind, so 'members' has to be
--      admitted, and _sanitize_push_prefs has to learn the matching key or a
--      device's mute for it is silently discarded.
--
--   3. WHO WANTS EVERY MESSAGE? Per-device mutes are global across leagues —
--      "chat off" means off everywhere. Wanting every word of one league and
--      only mentions in another is a per-LEAGUE, per-PERSON answer, so it gets
--      its own table rather than a sixth device key.

-- ── 1. when the seat was taken ──────────────────────────────────────────────
-- NULLABLE, AND NO DEFAULT, DELIBERATELY. A default would stamp every existing
-- row with now(), and the members detector windows on this column — so the
-- first sweep after deploy would tell every commissioner that all twelve of
-- their long-standing members had just joined. Existing rows stay NULL, which
-- reads as "joined before we started counting" and notifies nobody.
alter table league_membership add column if not exists enrolled_at timestamptz;

-- Stamped on the TRANSITION into enrolled, cleared on the way out — so a seat
-- that is vacated and taken by somebody else stamps fresh for the new owner
-- rather than keeping the old one's date.
create or replace function _stamp_enrolled_at() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.enrolled then new.enrolled_at := now(); end if;
    return new;
  end if;
  if new.enrolled and not coalesce(old.enrolled, false) then
    new.enrolled_at := now();
  elsif not new.enrolled and coalesce(old.enrolled, false) then
    new.enrolled_at := null;
  end if;
  return new;
end $$;

drop trigger if exists stamp_enrolled_at on league_membership;
create trigger stamp_enrolled_at before insert or update on league_membership
  for each row execute function _stamp_enrolled_at();

-- ── 2. the new kind ─────────────────────────────────────────────────────────
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('lineup', 'chat', 'trades', 'waivers', 'draft', 'members'));

create or replace function _sanitize_push_prefs(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['lineup', 'chat', 'trades', 'waivers', 'draft', 'members'] loop
    if jsonb_typeof(p -> k) = 'boolean' then out := out || jsonb_build_object(k, (p ->> k)::boolean); end if;
  end loop;
  return out;
end $$;

-- ── 3. every message, in the leagues you want it from ───────────────────────
-- OFF BY DEFAULT, and absence means off: nobody's phone starts buzzing because
-- they upgraded. A row exists only once someone has said yes (or said yes and
-- then no), so the worker's read is "is there a true row", never "is there a
-- row".
create table if not exists league_chat_push (
  app_user_id   uuid not null references app_user(id) on delete cascade,
  league_id     uuid not null references league(id) on delete cascade,
  all_messages  boolean not null default false,
  set_at        timestamptz not null default now(),
  primary key (app_user_id, league_id)
);
create index if not exists league_chat_push_league_idx on league_chat_push(league_id) where all_messages;
alter table league_chat_push enable row level security;   -- no policies: RPC-only, worker reads as service role

/** Turn "every message in this league" on or off for the caller. Members only
 *  — a stranger has no chat here to subscribe to. */
create or replace function set_league_chat_push(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your league');
  end if;
  insert into league_chat_push (app_user_id, league_id, all_messages, set_at)
    values (auth.uid(), p_league_id, coalesce(p_on, false), now())
  on conflict (app_user_id, league_id) do update
    set all_messages = excluded.all_messages, set_at = now();
  return jsonb_build_object('ok', true, 'all_messages', coalesce(p_on, false));
end $$;

/** What the caller has chosen for this league. False when they never said. */
create or replace function my_league_chat_push(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', true, 'all_messages', false); end if;
  return jsonb_build_object('ok', true, 'all_messages', coalesce(
    (select all_messages from league_chat_push
      where app_user_id = auth.uid() and league_id = p_league_id), false));
end $$;

grant execute on function set_league_chat_push(uuid, boolean) to authenticated;
grant execute on function my_league_chat_push(uuid) to authenticated;
