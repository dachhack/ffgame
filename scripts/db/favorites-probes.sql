-- 0139 probes: ★ favorites are private per account and RLS is the whole gate.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000501', 'fava@test.dev'),
  ('00000000-0000-0000-0000-000000000502', 'favb@test.dev')
on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000000501', 'fava@test.dev'),
  ('00000000-0000-0000-0000-000000000502', 'favb@test.dev')
on conflict (id) do nothing;

do $$
begin
  -- RLS sections must run as the API role — superuser bypasses RLS and proves
  -- nothing (the scratch-probe discipline's own trap list).
  set local role authenticated;

  -- f1. A stars two players and sees exactly them.
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000501', true);
  insert into favorite_player (app_user_id, player_slug) values
    ('00000000-0000-0000-0000-000000000501', 'jahmyr-gibbs'),
    ('00000000-0000-0000-0000-000000000501', 'carson-beck');
  perform assert_true((select count(*) from favorite_player) = 2, 'f1 A sees own stars');

  -- f2. B sees none of A's, and cannot write rows in A's name.
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000502', true);
  perform assert_true((select count(*) from favorite_player) = 0, 'f2 B sees nothing');
  begin
    insert into favorite_player (app_user_id, player_slug) values
      ('00000000-0000-0000-0000-000000000501', 'planted-star');
    raise exception 'PROBE FAIL f2 B wrote into A''s stars';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- f3. B's own star is invisible to A; A's unstar removes only A's row.
  insert into favorite_player (app_user_id, player_slug) values
    ('00000000-0000-0000-0000-000000000502', 'jahmyr-gibbs');
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000501', true);
  perform assert_true((select count(*) from favorite_player) = 2, 'f3 A still sees exactly own');
  delete from favorite_player where player_slug = 'jahmyr-gibbs'; -- RLS scopes to A
  perform assert_true((select count(*) from favorite_player) = 1, 'f3 A unstarred own');
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000502', true);
  perform assert_true((select count(*) from favorite_player) = 1, 'f3 B''s star survives A''s delete');

  reset role;
end $$;

select 'ALL FAVORITES PROBES PASSED' as result;
