-- 0154 league-signals probes: the one badge RPC.
--
-- What must hold:
--   • an unvoted poll counts; voting clears it; the asker never counts their own;
--   • a resolved claim counts until the member OPENS the league (league_seen
--     watermark), then stops;
--   • commish block: null for a member, counts for the commissioner —
--     the waiting room and (review mode only) accepted trades;
--   • an outsider is refused.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; pid bigint;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Signals League', '2026', 4, 7, 60);
  perform assert_ok(r, 'sg0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'SG-C'), 'sg1 c joins');

  set local role authenticated;

  -- outsider refused
  perform probe_as('d');
  perform assert_err(league_signals(lid), 'forbidden', 'sg2 outsider refused');

  -- a poll: the asker doesn't count it, the member does; voting clears
  perform probe_as('b');
  r := chat_post_poll(lid, 'Best kickoff snack?', array['wings', 'nachos']);
  perform assert_ok(r, 'sg3 poll posted');
  pid := (r ->> 'id')::bigint;
  perform assert_true((league_signals(lid) ->> 'polls_unvoted')::int = 0, 'sg4 asker sees no dot');
  perform probe_as('c');
  perform assert_true((league_signals(lid) ->> 'polls_unvoted')::int = 1, 'sg5 member sees the poll');
  perform assert_ok(poll_cast(lid, pid::int, 0), 'sg6 c votes');
  perform assert_true((league_signals(lid) ->> 'polls_unvoted')::int = 0, 'sg7 voting clears it');

  -- a resolved claim badges until the member opens the league
  reset role;
  insert into waiver_claim (league_id, roster_id, add_slug, status, processed_at)
  values (lid, 2, 'probe-player', 'won', now());
  set local role authenticated;
  perform probe_as('c');
  perform assert_true((league_signals(lid) ->> 'waiver_results')::int = 1, 'sg8 fresh result badges');
  perform assert_ok(league_touch(lid), 'sg9 c opens the league');
  perform assert_true((league_signals(lid) ->> 'waiver_results')::int = 0, 'sg10 opening clears it');

  -- commish block: null for a member, counts for the commissioner
  perform assert_true(league_signals(lid) -> 'commish' = 'null'::jsonb, 'sg11 member gets no commish block');
  reset role;
  insert into league_join (league_id, app_user_id, email)
  values (lid, '00000000-0000-0000-0000-00000000000d', 'd@test.dev');
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"trade_review": "commish"}'::jsonb
    where id = lid;
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, status)
  values (lid, 1, 2, '["a-guy"]'::jsonb, '["b-guy"]'::jsonb, 'accepted');
  set local role authenticated;
  perform probe_as('b');
  r := league_signals(lid);
  perform assert_true((r -> 'commish' ->> 'waiting')::int = 1, 'sg12 waiting room counted');
  perform assert_true((r -> 'commish' ->> 'review')::int = 1, 'sg13 review trade counted');
  reset role;
end $$;

select 'ALL LEAGUE-SIGNALS PROBES PASSED' as result;
