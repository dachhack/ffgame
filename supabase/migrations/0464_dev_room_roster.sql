-- 0464: THE DEV ROOM'S ROSTER (v0.662.0).
--
-- Founder: "I'd like the ability to just pull up the list of registered site
-- users and toggle them in the dev chat. No other form of invite."
--
--   • dev_room_users(room, search): every registered account (app_user) with
--     whether it is in the room — for an admin (app or room) only. Newest
--     accounts first; a search matches the name or the email.
--   • dev_room_set_member(room, user, in): an admin puts someone in, or takes
--     them out. Out is remembered (dev_room_left, 0463), so an open room
--     doesn't seat them again; in clears it.
--   • Invite codes are retired: every code is revoked, and no new one can be
--     made. (dev_room_join keeps answering, with "that invite code isn't valid".)
--
-- The EVERYONE switch (0463) stays: one tap still seats every account.

create or replace function _dev_room_admin(p_room uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_admin() or exists (select 1 from dev_room_member
    where room_id = p_room and app_user_id = auth.uid() and role = 'admin');
$$;

create or replace function dev_room_users(p_room uuid, p_search text default null, p_limit int default 200)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), ''); out jsonb; n int;
begin
  if not _dev_room_admin(p_room) then return jsonb_build_object('ok', false, 'error', 'only an admin can see this'); end if;
  select count(*) into n from app_user;
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u.id, 'name', _dev_room_name(u.id), 'email', u.email, 'joined', u.created_at,
           'in', m.app_user_id is not null, 'role', m.role, 'me', u.id = auth.uid())
         order by (m.app_user_id is not null) desc, u.created_at desc), '[]'::jsonb)
    into out
    from (select * from app_user a
           where q is null or a.email ilike '%' || q || '%' or a.display_name ilike '%' || q || '%'
           order by a.created_at desc
           limit greatest(1, least(coalesce(p_limit, 200), 1000))) u
    left join dev_room_member m on m.room_id = p_room and m.app_user_id = u.id;
  return jsonb_build_object('ok', true, 'users', out, 'total', n);
end $$;

create or replace function dev_room_set_member(p_room uuid, p_user uuid, p_in boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not _dev_room_admin(p_room) then return jsonb_build_object('ok', false, 'error', 'only an admin can change this'); end if;
  if not exists (select 1 from dev_room where id = p_room) then return jsonb_build_object('ok', false, 'error', 'no such room'); end if;
  if not exists (select 1 from app_user where id = p_user) then return jsonb_build_object('ok', false, 'error', 'no such account'); end if;
  if coalesce(p_in, false) then
    insert into dev_room_member (room_id, app_user_id) values (p_room, p_user) on conflict do nothing;
    delete from dev_room_left where room_id = p_room and app_user_id = p_user;
  else
    if exists (select 1 from dev_room_member where room_id = p_room and app_user_id = p_user and role = 'admin')
       and (select count(*) from dev_room_member where room_id = p_room and role = 'admin') <= 1 then
      return jsonb_build_object('ok', false, 'error', 'the room''s last admin can''t be taken out');
    end if;
    delete from dev_room_member where room_id = p_room and app_user_id = p_user;
    insert into dev_room_left (room_id, app_user_id) values (p_room, p_user) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'in', coalesce(p_in, false));
end $$;

-- No other form of invite.
update dev_room_invite set revoked = true where not revoked;
create or replace function dev_room_invite_create(p_room uuid, p_max_uses int default null)
  returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('ok', false, 'error', 'invite codes are retired — add people from the room''s PEOPLE list');
$$;

revoke all on function _dev_room_admin(uuid) from public, anon, authenticated;
revoke all on function dev_room_users(uuid, text, int), dev_room_set_member(uuid, uuid, boolean) from public, anon;
grant execute on function dev_room_users(uuid, text, int), dev_room_set_member(uuid, uuid, boolean) to authenticated;
