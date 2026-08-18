-- 0187 league-rename probes.
--
-- What must hold:
--   • only the commissioner (or an admin) may rename a league;
--   • the name is trimmed and its inner whitespace collapsed;
--   • too short and too long are refused, and refusal leaves the OLD name;
--   • the rename is what my_teams and the league row report afterwards.
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
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');

  perform probe_as('a');
  r := create_native_league('Naem Typo', '2024', 2, 5, 60);
  perform assert_ok(r, 'ln0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'LN-B'), 'ln0a b joins');

  -- ── only the commissioner ────────────────────────────────────────────────
  perform assert_err(set_league_name(lid, 'Hostile Takeover'), 'forbidden', 'ln1 member refused');
  perform assert_true((select name from league where id = lid) = 'Naem Typo', 'ln1a name untouched');

  -- ── the commissioner renames it ──────────────────────────────────────────
  perform probe_as('a');
  r := set_league_name(lid, '  Turf    Warriors  ');
  perform assert_ok(r, 'ln2 rename');
  perform assert_true(r ->> 'name' = 'Turf Warriors', 'ln2a trimmed + inner whitespace collapsed');
  perform assert_true((select name from league where id = lid) = 'Turf Warriors', 'ln2b stored');

  -- ── bounds, and a refusal never half-applies ─────────────────────────────
  perform assert_err(set_league_name(lid, ' x '), 'at least 2', 'ln3 too short');
  perform assert_err(set_league_name(lid, null), 'at least 2', 'ln3a null');
  perform assert_err(set_league_name(lid, repeat('z', 61)), 'too long', 'ln3b too long');
  perform assert_true((select name from league where id = lid) = 'Turf Warriors', 'ln3c refusals left the old name');
  perform assert_ok(set_league_name(lid, repeat('z', 60)), 'ln3d 60 is allowed');
  perform assert_ok(set_league_name(lid, 'Turf Warriors'), 'ln3e back');

  -- ── what the app reads afterwards ────────────────────────────────────────
  perform probe_as('b');
  perform assert_true(
    (select count(*) from jsonb_array_elements(my_teams()) e
      where e -> 'league' ->> 'name' = 'Turf Warriors') = 1,
    'ln4 my_teams reports the new name');

  raise notice 'league-name probes done';
end $$;

select 'ALL LEAGUE-NAME PROBES PASSED' as result;
