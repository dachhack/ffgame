-- 0129 probes: correcting the email on a code request (admin_set_code_request_email).
-- The lead's address is anonymous, unverified input, and send-invite mails it
-- verbatim — so what this function accepts, stores and refuses is the whole
-- difference between an invite that lands and one that vanishes.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;

insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

do $$
declare rid uuid; empty_id uuid; r jsonb;
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000a', false);
  perform set_config('app.email', 'a@test.dev', false);

  -- A lead arrives with a mistyped address (the case this exists for).
  perform request_code('typo@gmial.com', 'sleeper', 'Gridiron Gang', '22016B67', 'note', null);
  select id into rid from code_request where email = 'typo@gmial.com' order by created_at desc limit 1;

  -- e1. a non-admin can't rewrite where an invite goes, and nothing moves
  perform set_config('app.email', '', false);
  perform assert_err(admin_set_code_request_email(rid, 'fixed@gmail.com'), 'forbidden', 'e1 non-admin refused');
  perform assert_true((select email from code_request where id = rid) = 'typo@gmial.com', 'e1 row untouched');
  perform set_config('app.email', 'a@test.dev', false);

  -- e2. junk the mailer would reject never reaches the mailer
  perform assert_err(admin_set_code_request_email(rid, 'not-an-email'), 'does not look like', 'e2 invalid rejected');
  perform assert_err(admin_set_code_request_email(rid, 'who@nowhere'), 'does not look like', 'e2 no-dot rejected');
  perform assert_err(admin_set_code_request_email(rid, '  '), 'required', 'e3 blank rejected');
  perform assert_err(admin_set_code_request_email(gen_random_uuid(), 'a@b.com'), 'No such request', 'e4 unknown id');

  -- e5. the correction lands, trimmed
  r := admin_set_code_request_email(rid, '  landon@gmail.com ');
  perform assert_true(coalesce((r ->> 'ok')::boolean, false), 'e5 returns ok');
  perform assert_true((select email from code_request where id = rid) = 'landon@gmail.com', 'e5 stored trimmed');

  -- e6. an admin redirecting an invite leaves a trail (code_request has no audit trigger)
  perform assert_true(exists (
    select 1 from audit_log where table_name = 'code_request' and row_id = rid::text
      and old_row ->> 'email' = 'typo@gmial.com' and new_row ->> 'email' = 'landon@gmail.com'
  ), 'e6 old value audited');

  -- e7. triage sees the fixed address, so "send invite" mails the right person
  perform assert_true((select email from jsonb_to_recordset(admin_code_requests()) as x(id uuid, email text)
                       where x.id = rid) = 'landon@gmail.com', 'e7 visible in triage');

  -- e8. a request that came in with only a platform username can be given one
  insert into code_request (email, sleeper_username) values (null, 'sleeper') returning id into empty_id;
  perform assert_true(coalesce((admin_set_code_request_email(empty_id, 'nobody@yahoo.com') ->> 'ok')::boolean, false), 'e8 email added');
  perform assert_true((select email from code_request where id = empty_id) = 'nobody@yahoo.com', 'e8 stored');
end $$;

select 'ALL CODE-REQUEST-EMAIL PROBES PASSED' as result;
