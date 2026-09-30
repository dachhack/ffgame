-- 0395 · MARK-FREE: A PERSONAL SWITCH AND A GLOBAL ONE
--
-- Founder: "save it to my profile and add it to mobile.. we need a global mark
-- free switch too." Mark-free (hide NFL logos + player headshots) was a
-- per-browser localStorage flag behind the admin page. Now:
--   • app_user.mark_free — the account's own preference (null = none yet), set
--     from the gear on web and mobile, so it follows the account to every device.
--   • site_pref.mark_free — one global switch a super admin flips. When on,
--     everyone is mark-free, signed in or not, and a personal "off" can't undo it.
-- The client reads both through mark_free_state() and caches them on the device
-- (packages/core/src/data/markFree.ts).

alter table app_user add column if not exists mark_free boolean;

create table if not exists site_pref (
  id         boolean primary key default true check (id),   -- singleton row
  mark_free  boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into site_pref (id) values (true) on conflict (id) do nothing;
alter table site_pref enable row level security;  -- read through the RPC below

/** {global, mine}: the global switch, and the caller's preference (null when
 *  signed out or never set). Open to anon so the signed-out front door obeys
 *  the global switch too. */
create or replace function mark_free_state() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'global', coalesce((select mark_free from site_pref where id), false),
    'mine',   (select mark_free from app_user where id = auth.uid()));
$$;
grant execute on function mark_free_state() to anon, authenticated;

/** The caller's own preference. */
create or replace function set_my_mark_free(p_on boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if p_on is null then return jsonb_build_object('ok', false, 'error', 'on or off'); end if;
  update app_user set mark_free = p_on where id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'no profile yet'); end if;
  return jsonb_build_object('ok', true, 'mark_free', p_on);
end $$;
grant execute on function set_my_mark_free(boolean) to authenticated;

/** Super admin: mark-free for everyone. */
create or replace function admin_set_global_mark_free(p_on boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_on is null then return jsonb_build_object('ok', false, 'error', 'on or off'); end if;
  update site_pref set mark_free = p_on, updated_at = now() where id;
  return jsonb_build_object('ok', true, 'mark_free', p_on);
end $$;
grant execute on function admin_set_global_mark_free(boolean) to authenticated;
