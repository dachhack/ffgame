-- Vampire RULES probes (v0.386.0) — the edges an end-to-end audit walked that
-- nothing pinned: the coven/draft/multi-vampire machinery is covered by
-- vampire-coven-probes (0268) and format-probes (0222), so this suite is only
-- the rules ABOUT THE WIN.
--
-- What must hold:
--   • a TIE is not a win — the vampire feeds on wins, and a tie is not one;
--   • only the LATEST fully-final week is fresh: an older win goes cold;
--   • a STASHED (IR/taxi) player is not on the menu — the steal takes from the
--     beaten team's ACTIVE roster;
--   • a vampire appointed AFTER the draft keeps the roster it drafted (the
--     exclusion is a draft-time rule, not a confiscation);
--   • an emptied coven leaves the state readable and feeds nobody.
\set QUIET on
\pset pager off

create or replace function vr_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000c3f0' || u, false);
  perform set_config('app.email', 'vr' || u || '@test.dev', false);
end $$;
create or replace function vr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c3f01', 'vr1@test.dev')
on conflict (id) do nothing;

-- n seats, vampire format, the named coven, rosters for everyone, 4 weeks.
create or replace function _vr_league(nm text, pfx text, n int, covn jsonb) returns uuid
  language plpgsql as $$
declare r jsonb; lid uuid; pool jsonb := '[]'::jsonb; t int; i int; seats int[];
begin
  perform vr_as('1');
  r := create_native_league(nm, '2026', n, 8, 60, 'snake');
  if not (r ->> 'ok')::boolean then raise exception 'VR FIXTURE: create — %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  r := set_league_format(lid, 'vampire');
  if not (r ->> 'ok')::boolean then raise exception 'VR FIXTURE: format — %', r; end if;
  if jsonb_array_length(covn) > 0 then
    r := set_vampires(lid, covn);
    if not (r ->> 'ok')::boolean then raise exception 'VR FIXTURE: coven — %', r; end if;
  end if;
  select coalesce(array_agg(v::int), '{}') into seats from jsonb_array_elements_text(covn) t2(v);
  for i in 1..(n * 8 + 12) loop
    pool := pool || jsonb_build_object('slug', pfx || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  r := seed_league_pool(lid, pool);
  if not (r ->> 'ok')::boolean then raise exception 'VR FIXTURE: seed — %', r; end if;
  update draft set status = 'complete' where league_id = lid;
  for t in 1..n loop
    for i in 1..5 loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid, t, pfx || ((t - 1) * 5 + i), case when t = any(seats) then 'fa' else 'draft' end);
    end loop;
  end loop;
  r := native_generate_schedule(lid, 4);
  if not (r ->> 'ok')::boolean then raise exception 'VR FIXTURE: schedule — %', r; end if;
  return lid;
end $$;

-- final every matchup in a week; the named seats win
create or replace function _vr_final(lid uuid, wk int, winners int[]) returns void
  language plpgsql as $$
declare m record;
begin
  for m in select id, home_roster_id, away_roster_id from matchup where league_id = lid and week = wk loop
    update matchup set status = 'final',
      home_final = case when m.home_roster_id = any(winners) then 130.0 else 70.0 end,
      away_final = case when m.away_roster_id = any(winners) then 130.0 else 70.0 end
      where id = m.id;
  end loop;
end $$;

do $$
declare lid uuid; r jsonb; vic int; tk text; gv text; cnt int;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000c3f01', 'vr1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000c3f01';

  -- ══ a TIE is not a win ═══════════════════════════════════════════════════
  lid := _vr_league('VR Dead Heat', 'vrt-', 4, '[2]'::jsonb);
  perform vr_as('1');
  update matchup set status = 'final', home_final = 100.0, away_final = 100.0
    where league_id = lid and week = 1;
  r := vampire_state(lid);
  perform vr_true(coalesce((r ->> 'won')::boolean, true) is false,
    'vr1 a tie opens no window: ' || coalesce(r ->> 'won', 'null'));
  select slug into tk from native_roster where league_id = lid and roster_id <> 2 limit 1;
  select slug into gv from native_roster where league_id = lid and roster_id = 2 limit 1;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false, 'vr1a a tie feeds nobody: ' || r::text);

  -- ══ only the LATEST finaled week is fresh ════════════════════════════════
  lid := _vr_league('VR Stale Blood', 'vrs-', 4, '[2]'::jsonb);
  perform vr_as('1');
  perform _vr_final(lid, 1, array[2]);        -- the vampire wins week 1…
  r := vampire_state(lid);
  perform vr_true(coalesce((r ->> 'won')::boolean, false), 'vr2 the fresh win opens the window');
  perform _vr_final(lid, 2, array[1, 3]);     -- …and loses week 2
  r := vampire_state(lid);
  perform vr_true((r ->> 'week')::int = 2, 'vr2a the window follows the latest finaled week');
  perform vr_true(coalesce((r ->> 'won')::boolean, true) is false, 'vr2b the older win has gone cold');
  select slug into tk from native_roster where league_id = lid and roster_id <> 2 limit 1;
  select slug into gv from native_roster where league_id = lid and roster_id = 2 limit 1;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false,
    'vr2c a stale win cannot be fed on: ' || r::text);

  -- ══ a STASHED player is not on the menu ══════════════════════════════════
  lid := _vr_league('VR Stash Guard', 'vrg-', 4, '[2]'::jsonb);
  perform vr_as('1');
  perform _vr_final(lid, 1, array[2]);
  r := vampire_state(lid); vic := (r ->> 'victim')::int;
  perform vr_true(vic is not null, 'vr3 the window names the beaten team');
  update native_roster set spot = 'ir' where league_id = lid and roster_id = vic
    and slug = (select slug from native_roster where league_id = lid and roster_id = vic limit 1);
  select slug into tk from native_roster where league_id = lid and roster_id = vic and spot = 'ir' limit 1;
  select slug into gv from native_roster where league_id = lid and roster_id = 2 limit 1;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false,
    'vr3a a stashed (IR) player cannot be stolen: ' || r::text);
  select slug into tk from native_roster where league_id = lid and roster_id = vic
    and coalesce(spot, 'active') = 'active' limit 1;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, false),
    'vr3b …but an active one still can: ' || r::text);

  -- ══ appointed AFTER the draft: it keeps what it drew ═════════════════════
  lid := _vr_league('VR Late Fangs', 'vrl-', 4, '[]'::jsonb);
  perform vr_as('1');
  select count(*) into cnt from native_roster where league_id = lid and roster_id = 3;
  perform vr_true(cnt = 5, 'vr4 seat 3 drafted a roster');
  r := set_vampires(lid, '[3]'::jsonb);
  perform vr_true(coalesce((r ->> 'ok')::boolean, false),
    'vr4a a vampire may be appointed after the draft: ' || r::text);
  perform vr_true((select count(*) from native_roster where league_id = lid and roster_id = 3) = cnt,
    'vr4b …and keeps the roster it drafted — the exclusion is a draft-time rule');

  -- ══ disbanding the coven ═════════════════════════════════════════════════
  r := set_vampires(lid, '[]'::jsonb);
  perform vr_true(coalesce((r ->> 'ok')::boolean, false), 'vr5 the coven can be emptied: ' || r::text);
  r := vampire_state(lid);
  perform vr_true(coalesce((r ->> 'vampire')::boolean, false)
      and coalesce(jsonb_array_length(r -> 'vampires'), 0) = 0,
    'vr5a state still answers with an empty coven: ' || left(r::text, 80));
  perform vr_true(vampire_seat(lid) is null, 'vr5b the legacy seat reads null');
  select slug into tk from native_roster where league_id = lid and roster_id = 1 limit 1;
  select slug into gv from native_roster where league_id = lid and roster_id = 3 limit 1;
  r := vampire_steal(lid, tk, gv, null);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false,
    'vr5c nobody feeds with no coven: ' || r::text);

  raise notice 'vampire-rules probes done';
end $$;

select 'ALL VAMPIRE-RULES PROBES PASSED' as status;
