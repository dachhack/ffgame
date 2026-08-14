-- 0150: APP PUSH NOTIFICATIONS — the plumbing half.
--
-- App-only by the founder's call (the web stays in-app badges; beta testers
-- arrive in a few weeks and the APK is where pushes matter). Delivery is raw
-- FCM: the app registers its DEVICE token here; the Fly worker detects the
-- notify-worthy moments, writes them to an outbox, and sends via FCM HTTP v1
-- with a service-account credential that lives in Fly secrets — no Expo push
-- service, no third relay.
--
-- Two tables, one contract each:
--   • push_token — device tokens by account, with per-device mute prefs.
--     RPC-only (deny-all RLS): the app registers/removes its own token and
--     flips its own prefs; the WORKER (service role) reads them all.
--   • push_outbox — the worker's queue. No RPCs at all: the worker writes
--     with dedupe (unique dedupe_key + on-conflict-do-nothing makes every
--     detector re-scan idempotent) and marks sent_at as it delivers.
--     Clients never touch it.

create table push_token (
  token         text primary key,
  app_user_id   uuid not null references app_user(id) on delete cascade,
  platform      text not null default 'android',
  -- Per-device mutes: {"lineup": false} silences that kind; a missing key is
  -- ON. Kinds: lineup | chat | trades | waivers.
  prefs         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index on push_token(app_user_id);
alter table push_token enable row level security;   -- no policies: RPC-only

create table push_outbox (
  id           bigint generated always as identity primary key,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  kind         text not null check (kind in ('lineup', 'chat', 'trades', 'waivers')),
  title        text not null,
  body         text not null,
  data         jsonb not null default '{}'::jsonb,
  dedupe_key   text unique,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  error        text
);
create index on push_outbox(id) where sent_at is null;
alter table push_outbox enable row level security;  -- no policies: worker-only

-- Keep only the known mute keys, booleans only.
create or replace function _sanitize_push_prefs(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['lineup', 'chat', 'trades', 'waivers'] loop
    if jsonb_typeof(p -> k) = 'boolean' then out := out || jsonb_build_object(k, (p ->> k)::boolean); end if;
  end loop;
  return out;
end $$;

-- Upsert BY TOKEN: a device that changes accounts moves its token to the new
-- account (the old account must stop receiving this phone's pushes).
create or replace function register_push_token(p_token text, p_platform text default 'android', p_prefs jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if p_token is null or length(btrim(p_token)) < 8 or length(p_token) > 4096 then
    return jsonb_build_object('ok', false, 'error', 'bad token');
  end if;
  insert into push_token (token, app_user_id, platform, prefs)
    values (btrim(p_token), auth.uid(), coalesce(p_platform, 'android'), coalesce(_sanitize_push_prefs(p_prefs), '{}'::jsonb))
    on conflict (token) do update set
      app_user_id = excluded.app_user_id,
      platform = excluded.platform,
      prefs = case when p_prefs is null then push_token.prefs else _sanitize_push_prefs(p_prefs) end,
      last_seen_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function remove_push_token(p_token text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from push_token where token = btrim(coalesce(p_token, '')) and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'removed', found);
end $$;

create or replace function set_push_prefs(p_token text, p_prefs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare cleaned jsonb := _sanitize_push_prefs(p_prefs);
begin
  update push_token set prefs = cleaned, last_seen_at = now()
    where token = btrim(coalesce(p_token, '')) and app_user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'no such token'); end if;
  return jsonb_build_object('ok', true, 'prefs', cleaned);
end $$;

create or replace function my_push_tokens()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'token', t.token, 'platform', t.platform, 'prefs', t.prefs, 'last_seen_at', t.last_seen_at)
      order by t.last_seen_at desc), '[]'::jsonb)
    into result from push_token t where t.app_user_id = auth.uid();
  return result;
end $$;

grant execute on function register_push_token(text, text, jsonb) to authenticated;
grant execute on function remove_push_token(text) to authenticated;
grant execute on function set_push_prefs(text, jsonb) to authenticated;
grant execute on function my_push_tokens() to authenticated;
