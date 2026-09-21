-- 0274 probes: the invite link's landing preview.
--
-- What must hold:
--   • invite_preview answers a SIGNED-OUT caller who holds the code — that is
--     the whole point, and the one thing league_preview cannot do;
--   • it answers for a league that is NOT publicly listed (the private league
--     whose invite gets sent is exactly the case league_preview refuses);
--   • it carries the rules a recruit decides on — scoring, roster, waivers,
--     draft, seats — plus format and continuity;
--   • team names come with NO owner attached, and no email, user id or Sleeper
--     id appears anywhere in the payload;
--   • a bad code and a rotated code answer the same way, so the endpoint can't
--     be used to tell live codes from dead ones;
--   • the code is matched case-insensitively and trimmed, as redeem does.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function il_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000e1d0' || u, false);
  perform set_config('app.email', 'il' || u || '@test.dev', false);
end $$;
-- signed OUT: the empty uid the shim reads as null (the anon caller).
create or replace function il_anon() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;
create or replace function il_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e1d01', 'il1@test.dev')
on conflict (id) do nothing;

do $$
declare lid uuid; code text; r jsonb; pool jsonb := '[]'::jsonb; i int; blob text;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000e1d01', 'il1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000e1d01';
  perform il_as('1');

  r := create_native_league('Invite Landing', '2026', 4, 6, 60, 'snake');
  perform il_true(coalesce((r ->> 'ok')::boolean, false), 'il0 league created: ' || r::text);
  lid := (r ->> 'league_id')::uuid;
  for i in 1..24 loop
    pool := pool || jsonb_build_object('slug', 'il-' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  perform seed_league_pool(lid, pool);
  select invite_code into code from league where id = lid;
  perform il_true(code is not null and length(code) = 8, 'il0a the league has an invite code');

  -- ══ the signed-out recruit ════════════════════════════════════════════════
  perform il_anon();
  perform il_true(auth.uid() is null, 'il1 the probe really is signed out');
  r := invite_preview(code);
  perform il_true(coalesce((r ->> 'ok')::boolean, false),
    'il2 a signed-out holder of the code gets a preview: ' || left(r::text, 90));
  perform il_true(r ->> 'name' = 'Invite Landing', 'il2a …naming the league');

  -- league_preview, by contrast, refuses this caller — the gap 0274 fills.
  perform il_true(coalesce((league_preview(lid) ->> 'ok')::boolean, true) is false,
    'il3 league_preview still refuses a signed-out caller');

  -- ══ the rules a recruit decides on ════════════════════════════════════════
  perform il_true(r ? 'format' and r ? 'continuity',
    'il4 the payload says what KIND of league this is');
  perform il_true((r ->> 'continuity') is not null, 'il4a continuity is populated');
  perform il_true(r ? 'scoring' and r ? 'roster' and r ? 'rules' and r ? 'draft',
    'il5 scoring, roster, rules and draft all ride along');
  perform il_true((r -> 'rules' ->> 'waiver_mode') is not null, 'il5a the waiver mode is named');
  perform il_true((r ->> 'seats_total')::int = 4, 'il6 seats_total counts the league');
  perform il_true((r ->> 'seats_open')::int between 0 and 4, 'il6a seats_open is sane');
  perform il_true(jsonb_array_length(r -> 'teams') = 4, 'il7 every seat is listed');
  perform il_true((r -> 'teams' -> 0) ? 'team_name' and (r -> 'teams' -> 0) ? 'taken',
    'il7a each seat carries its name and whether it is taken');

  -- ══ NOTHING ABOUT THE PEOPLE ══════════════════════════════════════════════
  blob := r::text;
  perform il_true(position('il1@test.dev' in blob) = 0, 'il8 no email leaks into the preview');
  perform il_true(position('00000000-0000-0000-0000-0000000e1d01' in blob) = 0,
    'il8a no app_user_id leaks into the preview');
  perform il_true(not ((r -> 'teams' -> 0) ? 'app_user_id')
      and not ((r -> 'teams' -> 0) ? 'sleeper_owner_id')
      and not ((r -> 'teams' -> 0) ? 'owner'),
    'il8b a team row carries no owner of any kind');

  -- ══ the code is the credential ════════════════════════════════════════════
  r := invite_preview('deadbeef');
  perform il_true(coalesce((r ->> 'ok')::boolean, true) is false, 'il9 an unknown code is refused');
  perform il_true(r ->> 'error' = 'that invite link is not valid', 'il9a …with the neutral message');
  r := invite_preview(null);
  perform il_true(coalesce((r ->> 'ok')::boolean, true) is false, 'il9b a null code is refused');
  r := invite_preview('   ');
  perform il_true(coalesce((r ->> 'ok')::boolean, true) is false, 'il9c an empty code is refused');

  -- case and whitespace, exactly as redeem_invite treats them
  r := invite_preview('  ' || lower(code) || '  ');
  perform il_true(coalesce((r ->> 'ok')::boolean, false),
    'il10 the code is trimmed and case-insensitive');

  -- a ROTATED code stops working, and says the same thing a typo does
  update league set invite_code = 'aaaaaaaa' where id = lid;
  r := invite_preview(code);
  perform il_true(coalesce((r ->> 'ok')::boolean, true) is false
      and r ->> 'error' = 'that invite link is not valid',
    'il11 a rotated code is as dead as a typo, and reads the same');

  raise notice 'invite-landing probes done';
end $$;

select 'ALL INVITE-LANDING PROBES PASSED' as status;
