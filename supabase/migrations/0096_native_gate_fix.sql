-- 0096: re-apply 0095 against the LIVE database.
--
-- 0095's first cut hardcoded create_native_league's signature and missed
-- p_season, so pg_get_functiondef raised and psql aborted the file mid-way:
-- has_native() was created, but the gate patch and admin_set_feature's
-- 'native' flag never applied. The migrate workflow only runs NEW files, so
-- the fix ships as this file (0095 itself is also corrected in-repo for
-- fresh-database replays; this file is a no-op after a successful 0095 —
-- every statement below is idempotent / already-patched-tolerant).

create or replace function has_native() returns boolean
  language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce((select features ? 'native' from app_user where id = auth.uid()), false);
$$;

do $patch$
declare
  fn regprocedure;
  src text;
  hits int := 0;
  patched boolean := false;
  tgt text := $g$if not is_admin() then return jsonb_build_object('ok', false, 'error', 'native leagues are in closed testing'); end if;$g$;
  rep text := $g$if not has_native() then return jsonb_build_object('ok', false, 'error', 'native leagues are invite-only — ask the pilot owner for access'); end if;$g$;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_native_league'
  loop
    src := pg_get_functiondef(fn);
    if strpos(src, tgt) > 0 then
      execute replace(src, tgt, rep);
      hits := hits + 1;
    elsif strpos(src, rep) > 0 then
      patched := true;
    end if;
  end loop;
  if hits = 0 and not patched then
    raise exception 'create_native_league gate line not found — update this migration to match the current definition';
  end if;
end $patch$;

create or replace function admin_set_feature(p_email text, p_feature text, p_on boolean)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_feature not in ('solo', 'dfs_commish', 'native') then
    return jsonb_build_object('ok', false, 'error', 'unknown feature');
  end if;
  select id into uid from app_user where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'no account with that email (they must sign in once first)');
  end if;
  update app_user set features = case when p_on
      then features || jsonb_build_object(p_feature, true)
      else features - p_feature end
    where id = uid;
  return jsonb_build_object('ok', true, 'email', lower(trim(p_email)), 'feature', p_feature, 'on', p_on);
end $$;
