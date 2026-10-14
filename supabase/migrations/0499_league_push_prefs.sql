-- 0499: NOTIFICATIONS, PER LEAGUE AND OVERALL (v0.708.3).
--
-- Founder: "Let's do per league settings and overall." The overall switches
-- stay per device (push_token.prefs, 0153/0498). Each league adds the
-- member's own switches for that league — one per type, plus `muted` for the
-- whole league — and a push about a league goes out only when both say yes.
-- A league switch nobody touched is on: a league follows the overall
-- settings until told otherwise. Per account, not per device: "mute this
-- league" means on the phone and the browser alike.
--
-- league_chat_push (0241, "every message in this league") is a different
-- question — which chat messages count — and stays as it is.

create table if not exists league_push_pref (
  app_user_id uuid not null references app_user(id) on delete cascade,
  league_id   uuid not null references league(id) on delete cascade,
  prefs       jsonb not null default '{}'::jsonb,
  set_at      timestamptz not null default now(),
  primary key (app_user_id, league_id)
);
alter table league_push_pref enable row level security;   -- no policies: RPC-only, the worker reads as service role

-- The keys a league may store: 0498's types plus `muted`.
create or replace function _sanitize_league_push_prefs(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['muted', 'lineup', 'chat', 'trades', 'waivers', 'draft', 'members', 'format',
                           'status', 'rosterqc', 'timing', 'result', 'bigplay', 'oppplay', 'coin'] loop
    if jsonb_typeof(p -> k) = 'boolean' then out := out || jsonb_build_object(k, (p ->> k)::boolean); end if;
  end loop;
  return out;
end $$;

create or replace function set_league_push_prefs(p_league_id uuid, p_prefs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare clean jsonb := _sanitize_league_push_prefs(p_prefs);
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your league');
  end if;
  insert into league_push_pref (app_user_id, league_id, prefs, set_at)
    values (auth.uid(), p_league_id, clean, now())
  on conflict (app_user_id, league_id) do update set prefs = excluded.prefs, set_at = now();
  return jsonb_build_object('ok', true, 'prefs', clean);
end $$;

create or replace function my_league_push_prefs(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', true, 'prefs', '{}'::jsonb); end if;
  return jsonb_build_object('ok', true, 'prefs', coalesce(
    (select prefs from league_push_pref where app_user_id = auth.uid() and league_id = p_league_id), '{}'::jsonb));
end $$;

revoke all on function _sanitize_league_push_prefs(jsonb) from public, anon, authenticated;
revoke all on function set_league_push_prefs(uuid, jsonb), my_league_push_prefs(uuid) from public, anon;
grant execute on function set_league_push_prefs(uuid, jsonb) to authenticated;
grant execute on function my_league_push_prefs(uuid) to authenticated;
