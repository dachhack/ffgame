-- 0156 league-preview probes: look before you join.
--
-- What must hold:
--   • an unlisted league previews only to its members/commish — an outsider
--     is told it isn't open for browsing;
--   • once LISTED, any signed-in user reads the full preview: seats, draft
--     shape, rules, the seat map (team names + taken flags, nothing more);
--   • closing the listing closes the window again.
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
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Preview League', '2026', 4, 7, 60);
  perform assert_ok(r, 'pv0 create');
  lid := (r ->> 'league_id')::uuid;

  set local role authenticated;

  -- unlisted: outsider refused, the commissioner still reads their own
  perform probe_as('d');
  perform assert_err(league_preview(lid), 'not open', 'pv1 unlisted hides from outsiders');
  perform probe_as('b');
  perform assert_ok(league_preview(lid), 'pv2 commish previews own unlisted league');

  -- listed: any signed-in user reads the full shape
  perform assert_ok(post_league_listing(lid, 'Come draft with us'), 'pv3 commish lists');
  perform probe_as('d');
  r := league_preview(lid);
  perform assert_ok(r, 'pv4 outsider previews listed league');
  perform assert_true(r ->> 'name' = 'Preview League', 'pv5 identity');
  perform assert_true((r ->> 'seats_total')::int = 4 and (r ->> 'seats_open')::int = 3, 'pv6 seats');
  perform assert_true(r -> 'draft' ->> 'mode' = 'snake' and (r -> 'draft' ->> 'rounds')::int = 7, 'pv7 draft shape');
  perform assert_true(r -> 'rules' ->> 'trade_review' = 'none' and (r -> 'rules' ->> 'live_buffs')::boolean, 'pv8 rules');
  perform assert_true(jsonb_array_length(r -> 'teams') = 4, 'pv9 seat map');
  perform assert_true((select bool_and(x ? 'team_name' and x ? 'taken' and not (x ? 'email'))
                        from jsonb_array_elements(r -> 'teams') x), 'pv10 seat map carries no identities');
  perform assert_true(r ->> 'blurb' = 'Come draft with us', 'pv11 blurb');

  -- closed listing: the window shuts again
  perform probe_as('b');
  perform assert_ok(close_league_listing(lid), 'pv12 commish closes');
  perform probe_as('d');
  perform assert_err(league_preview(lid), 'not open', 'pv13 closed hides again');
  reset role;
end $$;

select 'ALL LEAGUE-PREVIEW PROBES PASSED' as result;
