-- 0095: native (drafted-on-site) league creation becomes a per-account
-- feature the pilot owner grants — third flag in the 0094 access model.
--
-- create_native_league's gate was hard `is_admin()` ("closed testing").
-- Now: admins OR accounts flagged 'native'. The mock-draft path wraps
-- create_native_league, so flag-holders get practice mocks too. Rather than
-- re-stating the ~150-line function body (0071's latest definition) just to
-- change one line, the DO block pulls the LIVE definition and swaps the gate
-- — and fails loudly if the expected line isn't found, so a future rewrite
-- of the function can't silently drop the gate change.

/** True when the caller may create native (in-app drafted) leagues. */
create or replace function has_native() returns boolean
  language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce((select features ? 'native' from app_user where id = auth.uid()), false);
$$;

do $patch$
declare
  src text;
  tgt text := $g$if not is_admin() then return jsonb_build_object('ok', false, 'error', 'native leagues are in closed testing'); end if;$g$;
  rep text := $g$if not has_native() then return jsonb_build_object('ok', false, 'error', 'native leagues are invite-only — ask the pilot owner for access'); end if;$g$;
begin
  src := pg_get_functiondef('create_native_league(text,int,int,int,text,int,int,int,int,int,jsonb)'::regprocedure);
  if strpos(src, tgt) = 0 then
    raise exception '0095: create_native_league gate line not found — update this migration to match the current definition';
  end if;
  execute replace(src, tgt, rep);
end $patch$;

-- admin_set_feature learns the third flag.
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
