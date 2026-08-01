-- 0097: AUTO-ISSUED SOLO PASSES with a weekly mint cap.
--
-- The demo's request funnel previously dead-ended for solo traffic: every lead
-- waited on the founder to flip the 'solo' feature by hand (0094). Now a solo
-- request MINTS a pass code on the spot — instantly shown in the modal — capped
-- at a founder-set number per rolling 7 days so supply stays scarce and the
-- pilot doesn't over-fill. Redeeming the pass (signed in) sets the same
-- app_user.features 'solo' flag admin_set_feature would have; join_pod /
-- join_weekly / has_solo() are untouched.
--
-- Shape follows the house patterns: RLS-locked table with no policies (all
-- access via SECURITY DEFINER RPCs), a singleton pref row for the quota
-- (demo_pref, 0078), and is_admin() gating the levers.

create table if not exists solo_pass (
  code       text primary key,
  created_at timestamptz not null default now(),
  email      text not null,
  claimed_by uuid references app_user(id),
  claimed_at timestamptz
);
create index if not exists solo_pass_email_idx on solo_pass (email);
create index if not exists solo_pass_created_idx on solo_pass (created_at);

alter table solo_pass enable row level security;
-- No policies on purpose → no direct anon/authenticated access.

create table if not exists solo_pass_pref (
  id           boolean primary key default true check (id),   -- singleton row
  weekly_quota int not null default 25,
  updated_at   timestamptz not null default now()
);
insert into solo_pass_pref (id) values (true) on conflict (id) do nothing;

/** Anonymous mint from the request-a-code modal (solo path). Idempotent per
 *  email: an unclaimed pass is returned again instead of minting a second one,
 *  so refresh/resubmit can't drain the quota. Over quota → waitlisted:true
 *  (the lead row from request_code still captures them for later). */
create or replace function issue_solo_pass(p_email text)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  e      text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  quota  int;
  minted int;
  c      text;
begin
  if e is null then
    return jsonb_build_object('ok', false, 'error', 'Add your email so we can issue your pass.');
  end if;

  -- Same email, pass still unclaimed → hand the same code back.
  select code into c from solo_pass
    where email = e and claimed_by is null
    order by created_at desc limit 1;
  if c is not null then
    return jsonb_build_object('ok', true, 'code', c, 'already', true);
  end if;

  select weekly_quota into quota from solo_pass_pref where id;
  select count(*) into minted from solo_pass where created_at > now() - interval '7 days';
  if minted >= coalesce(quota, 0) then
    return jsonb_build_object('ok', true, 'waitlisted', true);
  end if;

  -- Mint. Collision on the 6-hex-char suffix is vanishingly rare; loop anyway.
  for i in 1..5 loop
    c := 'SOLO-' || upper(left(md5(gen_random_uuid()::text), 6));
    begin
      insert into solo_pass (code, email) values (c, e);
      return jsonb_build_object('ok', true, 'code', c);
    exception when unique_violation then
      -- try a fresh suffix
    end;
  end loop;
  return jsonb_build_object('ok', false, 'error', 'Could not mint a pass — try again.');
end $$;
grant execute on function issue_solo_pass(text) to anon, authenticated;

/** Signed-in redemption: claims the pass and turns on the 'solo' feature —
 *  exactly what admin_set_feature(email, 'solo', true) does, self-serve. */
create or replace function redeem_solo_pass(p_code text)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  pass solo_pass%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into pass from solo_pass where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That pass code didn’t match. Double-check it.');
  end if;
  if pass.claimed_by is not null and pass.claimed_by <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'That pass has already been used.');
  end if;

  -- The app_user row normally exists (ensureAppUser on sign-in), but a redeem
  -- can race first sign-in — make the FK target, then flip the feature.
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;

  if pass.claimed_by is null then
    update solo_pass set claimed_by = auth.uid(), claimed_at = now() where code = pass.code;
  end if;
  update app_user set features = features || jsonb_build_object('solo', true) where id = auth.uid();

  return jsonb_build_object('ok', true, 'already', pass.claimed_by is not null);
end $$;
grant execute on function redeem_solo_pass(text) to authenticated;

/** Owner levers: quota + a snapshot of recent passes for triage. */
create or replace function admin_set_solo_quota(p_quota int)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_quota is null or p_quota < 0 or p_quota > 10000 then
    return jsonb_build_object('ok', false, 'error', 'quota must be 0–10000');
  end if;
  insert into solo_pass_pref (id, weekly_quota, updated_at) values (true, p_quota, now())
    on conflict (id) do update set weekly_quota = excluded.weekly_quota, updated_at = now();
  return jsonb_build_object('ok', true, 'weekly_quota', p_quota);
end $$;
grant execute on function admin_set_solo_quota(int) to authenticated;

create or replace function admin_solo_passes()
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select jsonb_build_object(
    'weekly_quota', (select weekly_quota from solo_pass_pref where id),
    'minted_7d', (select count(*) from solo_pass where created_at > now() - interval '7 days'),
    'claimed_7d', (select count(*) from solo_pass where claimed_at > now() - interval '7 days'),
    'passes', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'created_at', created_at, 'email', email,
        'claimed', claimed_by is not null, 'claimed_at', claimed_at
      ) order by created_at desc)
      from (select * from solo_pass order by created_at desc limit 100) p), '[]'::jsonb)
  ) into result;
  return result;
end $$;
grant execute on function admin_solo_passes() to authenticated;
