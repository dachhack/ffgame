-- 0323 probes: CONDITIONAL WAIVER CLAIMS.
--   • linking: 2–10 of my own pending claims, a ceiling below the count,
--     somebody else's claim refused, a settled claim refused;
--   • the run: the first claim of a group wins and the rest settle as
--     losses with the reason — and the report says so;
--   • the group never wins anything on its own: a member that loses on the
--     league's rules still loses, and the fallback then gets its chance;
--   • a ceiling above one lets that many land;
--   • filing a whole list at once is all-or-nothing;
--   • unlinking, cancelling a group, and a group left with one member.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function cc_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cc_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cc_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cc_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000014' || u, false); perform set_config('app.email', 'cc' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001401', 'cc01@test.dev'), ('00000000-0000-0000-0000-000000001402', 'cc02@test.dev'),
  ('00000000-0000-0000-0000-000000001403', 'cc03@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001401', 'cc01@test.dev'), ('00000000-0000-0000-0000-000000001402', 'cc02@test.dev'),
  ('00000000-0000-0000-0000-000000001403', 'cc03@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001401', '00000000-0000-0000-0000-000000001402',
              '00000000-0000-0000-0000-000000001403');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c int; gid uuid;
        c1 uuid; c2 uuid; c3 uuid; st jsonb;
begin
  perform cc_as('01');
  r := create_native_league('CondClaims', '2026', 3, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform cc_ok(r, 'cc0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform cc_as('02'); perform cc_ok(native_join(code, 'CC-B'), 'cc0 B joins');
  perform cc_as('03'); perform cc_ok(native_join(code, 'CC-C'), 'cc0 C joins');
  perform cc_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'cc-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'CCH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001401';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001402';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001403';
  perform cc_ok(native_generate_schedule(lid, 2), 'cc0 the schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'cc-1', 'draft'), (lid, b, 'cc-2', 'draft'), (lid, c, 'cc-3', 'draft');
  -- FAAB waivers, free agency shut so every unowned player is a claim.
  perform cc_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'off'), 'cc0 FAAB, no free agency');

  -- ── cc1. linking ──
  r := submit_waiver_claim(lid, a, 'cc-10', null, 40); perform cc_ok(r, 'cc1 first claim'); c1 := (r ->> 'claim_id')::uuid;
  r := submit_waiver_claim(lid, a, 'cc-11', null, 12); perform cc_ok(r, 'cc1 fallback'); c2 := (r ->> 'claim_id')::uuid;
  perform cc_refused(group_waiver_claims(array[c1]), '2–10 claims', 'cc1 a group of one');
  perform cc_refused(group_waiver_claims(array[c1, c1]), 'only appear once', 'cc1 the same claim twice');
  perform cc_refused(group_waiver_claims(array[c1, c2], 2), 'lands 1–1', 'cc1 a ceiling that cannot bind');
  perform cc_as('02');
  perform cc_refused(group_waiver_claims(array[c1, c2]), 'forbidden', 'cc1 not my claims to link');
  perform cc_as('01');
  r := group_waiver_claims(array[c1, c2]);
  perform cc_ok(r, 'cc1 linked'); gid := (r ->> 'group_id')::uuid;
  perform cc_true((select group_seq from waiver_claim where id = c1) = 1
    and (select group_seq from waiver_claim where id = c2) = 2
    and (select group_max from waiver_claim where id = c1) = 1, 'cc1 the order and the ceiling are kept');
  st := native_team_state(lid);
  perform cc_true((select count(*) from jsonb_array_elements(st -> 'my_claims') e where e ->> 'group_id' = gid::text) = 2,
    'cc1 the team screen sees the group');

  -- ── cc2. the run takes the rest of the group off the table ──
  update league_pool set waived_until = now() - interval '1 second' where league_id = lid and slug in ('cc-10', 'cc-11');
  update waiver_claim set clears_at = now() - interval '1 second' where league_id = lid and status = 'pending';
  r := process_waivers(lid);
  perform cc_true((r ->> 'won')::int = 1 and (r ->> 'lost')::int = 1, 'cc2 one win, one taken off the table');
  perform cc_true((select status from waiver_claim where id = c1) = 'won', 'cc2 the first choice landed');
  perform cc_true((select status from waiver_claim where id = c2) = 'lost'
    and (select note from waiver_claim where id = c2) ilike 'conditional%', 'cc2 the fallback says why');
  perform cc_true(not exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'cc-11'),
    'cc2 and the fallback player did not land');
  perform cc_true(member_faab(lid, a) = 60, 'cc2 only the winning bid was spent');
  perform cc_true(exists (select 1 from league_message where league_id = lid and kind = 'txn'
    and txn ->> 'kind' = 'waiver' and body ilike '%conditional%'), 'cc2 the report carries the reason');

  -- ── cc3. the group wins nothing by itself ──
  -- A's first choice is outbid by B; the fallback then gets its chance.
  perform cc_as('01');
  r := submit_waiver_claim(lid, a, 'cc-12', null, 5);  c1 := (r ->> 'claim_id')::uuid;
  r := submit_waiver_claim(lid, a, 'cc-13', null, 5);  c2 := (r ->> 'claim_id')::uuid;
  perform cc_ok(group_waiver_claims(array[c1, c2]), 'cc3 linked');
  perform cc_as('02');
  perform cc_ok(submit_waiver_claim(lid, b, 'cc-12', null, 50), 'cc3 B wants the first one badly');
  update league_pool set waived_until = now() - interval '1 second' where league_id = lid and slug in ('cc-12', 'cc-13');
  update waiver_claim set clears_at = now() - interval '1 second' where league_id = lid and status = 'pending';
  r := process_waivers(lid);
  perform cc_true((select status from waiver_claim where id = c1) = 'lost', 'cc3 A is outbid on his first choice');
  perform cc_true((select status from waiver_claim where id = c2) = 'won', 'cc3 so the fallback fires');
  perform cc_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'cc-13')
    and exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'cc-12'),
    'cc3 both teams got what the rules said');

  -- ── cc4. a ceiling above one ──
  perform cc_as('01');
  r := submit_waiver_claim(lid, a, 'cc-14', null, 4); c1 := (r ->> 'claim_id')::uuid;
  r := submit_waiver_claim(lid, a, 'cc-15', null, 3); c2 := (r ->> 'claim_id')::uuid;
  r := submit_waiver_claim(lid, a, 'cc-16', null, 2); c3 := (r ->> 'claim_id')::uuid;
  perform cc_ok(group_waiver_claims(array[c1, c2, c3], 2), 'cc4 "two of these three"');
  update league_pool set waived_until = now() - interval '1 second' where league_id = lid and slug in ('cc-14', 'cc-15', 'cc-16');
  update waiver_claim set clears_at = now() - interval '1 second' where league_id = lid and status = 'pending';
  r := process_waivers(lid);
  perform cc_true((select count(*) from waiver_claim where id in (c1, c2, c3) and status = 'won') = 2
    and (select status from waiver_claim where id = c3) = 'lost', 'cc4 two landed, the third stood down');

  -- ── cc5. filing a whole list at once ──
  perform cc_as('02');
  r := submit_waiver_group(lid, b, jsonb_build_array(
    jsonb_build_object('add', 'cc-20', 'bid', 9),
    jsonb_build_object('add', 'cc-99', 'bid', 3)));       -- cc-99 is not in the pool
  perform cc_refused(r, 'not in pool', 'cc5 a bad claim refuses the list');
  perform cc_true(not exists (select 1 from waiver_claim where league_id = lid and roster_id = b
                               and add_slug = 'cc-20' and status = 'pending'),
    'cc5 all or nothing — the good one was not left behind');
  r := submit_waiver_group(lid, b, jsonb_build_array(
    jsonb_build_object('add', 'cc-20', 'bid', 9),
    jsonb_build_object('add', 'cc-21', 'bid', 4),
    jsonb_build_object('add', 'cc-22', 'bid', 1)));
  perform cc_ok(r, 'cc5 the list files'); gid := (r ->> 'group_id')::uuid;
  perform cc_true((select count(*) from waiver_claim where group_id = gid and status = 'pending') = 3,
    'cc5 three claims in the group');

  -- ── cc6. unlinking, cancelling, and a group down to one ──
  perform cc_ok(ungroup_waiver_claims(gid), 'cc6 unlinked');
  perform cc_true((select count(*) from waiver_claim where group_id = gid) = 0, 'cc6 nothing carries the group now');
  r := submit_waiver_group(lid, b, jsonb_build_array(
    jsonb_build_object('add', 'cc-23', 'bid', 7),
    jsonb_build_object('add', 'cc-24', 'bid', 2)));
  perform cc_ok(r, 'cc6 a new pair'); gid := (r ->> 'group_id')::uuid;
  select id into c1 from waiver_claim where group_id = gid and add_slug = 'cc-23';
  perform cc_ok(cancel_waiver_claim(c1), 'cc6 one of them is withdrawn');
  perform cc_true((select group_id from waiver_claim where group_id = gid and status = 'pending') is not null,
    'cc6 the other still carries it until something tidies up');
  perform cc_ok(cancel_waiver_group(gid), 'cc6 the group is withdrawn');
  perform cc_true((select count(*) from waiver_claim where group_id = gid and status = 'pending') = 0,
    'cc6 nothing pending is left');
  perform cc_as('03');
  perform cc_refused(cancel_waiver_group(gid), 'forbidden', 'cc6 a stranger cannot touch another team''s group');
  perform cc_refused(cancel_waiver_group(gen_random_uuid()), 'no such group', 'cc6 and a group that never existed says so');
end $$;

select 'ALL CONDITIONAL-CLAIM PROBES PASS' as result;
drop function if exists cc_true(boolean, text);
drop function if exists cc_ok(jsonb, text);
drop function if exists cc_refused(jsonb, text, text);
drop function if exists cc_as(text);
