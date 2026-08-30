-- 0268 probes: the coven — vampires don't draft, may own the wire, can be many.
--
-- What must hold:
--   • a vampire appointed BEFORE the draft never enters it: the order skips
--     the seat, the completed draft leaves it rosterless, and it then BUILDS
--     from the pool through ordinary FA adds (the 0221 block is gone);
--   • the coven queues behind the drafting teams in waiver priority;
--   • set_vampires guards: unknown seats refused, and at least one
--     non-vampire team must remain to draft;
--   • several vampires feed independently — one steal per win PER VAMPIRE in
--     the same week — and a commissioner in a many-vampire league must name
--     the seat;
--   • the legacy single-seat surface holds: set_vampire still appoints, and
--     vampire_state's old top-level fields mirror the first (or the caller's
--     own) vampire while `vampires` carries the whole coven.
-- (The wire lock itself is probed in format-probes f3e2/f3e3, where the old
-- vampire-block probe lived.)
\set QUIET on
\pset pager off

create or replace function vc_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000d0a0' || u, false);
  perform set_config('app.email', 'vc' || u || '@test.dev', false);
end $$;
create or replace function vc_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function vc_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function vc_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d0a01', 'vc1@test.dev')
on conflict (id) do nothing;

do $$
declare
  lid uuid; lid2 uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; t int;
  wk_t int := null; m record; pair record; victim3 int; w jsonb;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000d0a01', 'vc1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000d0a01';
  perform vc_as('1');

  -- ══ 1 · THE VAMPIRE DOESN'T DRAFT ═════════════════════════════════════════
  r := create_native_league('No Fangs In The Room', '2026', 4, 5, 60, 'snake');
  perform vc_ok(r, 'vc0 league'); lid := (r ->> 'league_id')::uuid;
  perform vc_ok(set_league_format(lid, 'vampire'), 'vc0a format');
  perform vc_ok(set_vampires(lid, '[4]'::jsonb), 'vc0b seat 4 is the vampire, pre-draft');
  for i in 1..24 loop
    pool := pool || jsonb_build_object('slug', 'nf-' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  perform vc_ok(seed_league_pool(lid, pool), 'vc0c pool');
  -- every seat autodrafts (the creator's human seat included)
  update league_membership set controller = 'ai' where league_id = lid;

  r := start_draft(lid);
  perform vc_ok(r, 'vc1 the draft starts');
  perform vc_true((r ->> 'vampires_excluded')::int = 1, 'vc1a …and says it left the vampire out');
  perform vc_true(jsonb_array_length(r -> 'order') = 3, 'vc1b three drafting seats, not four');
  perform vc_true(not (r -> 'order') @> '4', 'vc1c seat 4 is not in the order');
  r := draft_tick(lid);
  perform vc_ok(r, 'vc2 one tick autodrafts the room');
  perform vc_true((select status from draft where league_id = lid) = 'complete', 'vc2a draft complete');
  perform vc_true((select count(*) from draft_pick where league_id = lid and roster_id = 4) = 0,
    'vc3 the vampire made no picks');
  perform vc_true((select count(*) from native_roster where league_id = lid and roster_id = 4) = 0,
    'vc3a …and drafted no roster');
  perform vc_true((select count(*) from native_roster where league_id = lid and roster_id = 1) = 5,
    'vc3b the drafting seats filled their five rounds');
  perform vc_true((select waiver_priority from league_membership
      where league_id = lid and sleeper_roster_id = 4) = 4,
    'vc4 the coven queues behind the drafting teams');

  -- the cradle: the vampire builds from what the draft left in the pool
  r := add_free_agent(lid, 4, (select lp.slug from league_pool lp
      where lp.league_id = lid
        and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
      order by lp.rank limit 1));
  perform vc_ok(r, 'vc5 the vampire signs its first player from the pool');

  -- ══ 2 · SET_VAMPIRES GUARDS ═══════════════════════════════════════════════
  perform vc_err(set_vampires(lid, '[9]'::jsonb), 'no such seat', 'vc6 unknown seats refused');
  perform vc_err(set_vampires(lid, '[1,2,3,4]'::jsonb), 'somebody has to draft', 'vc6a a full coven is refused');

  -- ══ 3 · MANY VAMPIRES, FEEDING INDEPENDENTLY ══════════════════════════════
  pool := '[]'::jsonb;
  r := create_native_league('Double Coven', '2026', 4, 5, 60, 'snake');
  perform vc_ok(r, 'vc7 league'); lid2 := (r ->> 'league_id')::uuid;
  perform vc_ok(set_league_format(lid2, 'vampire'), 'vc7a format');
  for i in 1..28 loop
    pool := pool || jsonb_build_object('slug', 'dc-' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  perform vc_ok(seed_league_pool(lid2, pool), 'vc7b pool');
  update draft set status = 'complete' where league_id = lid2;
  for t in 1..4 loop
    for i in 1..3 loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid2, t, 'dc-' || ((t - 1) * 3 + i), 'commish');
    end loop;
  end loop;
  perform vc_ok(native_generate_schedule(lid2, 3), 'vc7c schedule');

  -- legacy setter still appoints (the shipped APK calls it)…
  perform vc_ok(set_vampire(lid2, 3), 'vc8 set_vampire still works');
  perform vc_true(vampire_seats(lid2) = array[3], 'vc8a …one seat');
  -- …and the coven replaces it
  perform vc_ok(set_vampires(lid2, '[3,4]'::jsonb), 'vc8b two vampires');
  perform vc_true(vampire_seats(lid2) = array[3, 4], 'vc8c seats read back');

  -- a week where the two vampires do NOT meet each other; final every week up
  -- to it with each vampire beating its (non-vampire) opponent
  for i in 1..3 loop
    if not exists (select 1 from matchup where league_id = lid2 and week = i
        and home_roster_id in (3, 4) and away_roster_id in (3, 4)) then
      wk_t := i; exit;
    end if;
  end loop;
  perform vc_true(wk_t is not null, 'vc9pre a usable week exists');
  for i in 1..wk_t loop
    for m in select * from matchup where league_id = lid2 and week = i loop
      update matchup set status = 'final',
        home_final = case when home_roster_id in (3, 4) then 120 else 80 end,
        away_final = case when away_roster_id in (3, 4) then 120 else 80 end
        where id = m.id;
    end loop;
  end loop;

  -- who did vampire 3 beat in the target week
  select case when home_roster_id = 3 then away_roster_id else home_roster_id end into victim3
    from matchup where league_id = lid2 and week = wk_t and 3 in (home_roster_id, away_roster_id);

  -- a commissioner in a many-vampire league must NAME the seat
  perform vc_err(vampire_steal(lid2, 'dc-' || ((victim3 - 1) * 3 + 1), 'dc-7'),
    'name the seat', 'vc9 several vampires — the seat must be named');
  r := vampire_steal(lid2, 'dc-' || ((victim3 - 1) * 3 + 1), 'dc-7', 3);
  perform vc_ok(r, 'vc9a vampire 3 feeds');
  perform vc_err(vampire_steal(lid2, 'dc-' || ((victim3 - 1) * 3 + 2), 'dc-8', 3),
    'one steal per win', 'vc9b …once per win');
  -- vampire 4 feeds on ITS OWN win, same week
  select case when home_roster_id = 4 then away_roster_id else home_roster_id end into t
    from matchup where league_id = lid2 and week = wk_t and 4 in (home_roster_id, away_roster_id);
  r := vampire_steal(lid2, 'dc-' || ((t - 1) * 3 + 1), 'dc-10', 4);
  perform vc_ok(r, 'vc9c vampire 4 feeds in the same week');

  -- ══ 4 · THE STATE READS THE WHOLE COVEN ═══════════════════════════════════
  r := vampire_state(lid2);
  perform vc_true((r ->> 'vampire')::boolean and r -> 'seats' = '[3, 4]'::jsonb,
    'vc10 the coven is listed');
  perform vc_true(jsonb_array_length(r -> 'vampires') = 2, 'vc10a one entry per vampire');
  w := r -> 'vampires' -> 0;
  perform vc_true((w ->> 'seat')::int = 3 and (w -> 'record' ->> 'wins')::int >= 1
      and (w ->> 'fed')::boolean, 'vc10b vampire 3''s chair: record, fed');
  perform vc_true((r -> 'vampires' -> 1 ->> 'seat')::int = 4
      and (r -> 'vampires' -> 1 ->> 'fed')::boolean, 'vc10c vampire 4''s chair too');
  -- the legacy surface points at the first of the coven for a non-vampire caller
  perform vc_true((r ->> 'seat')::int = 3 and (r ->> 'fed')::boolean,
    'vc10d the shipped APK''s fields still read');
  perform vc_true((r -> 'steals' -> 0 ->> 'vampire') is not null,
    'vc10e steal rows say whose bite it was');

  raise notice 'vampire-coven probes done';
end $$;

select 'ALL VAMPIRE-COVEN PROBES PASSED' as status;
