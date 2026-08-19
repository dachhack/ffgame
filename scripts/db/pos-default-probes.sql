-- 0195 position-default probes.
--
--   • a CLASSIC league's default position limits READ ITS LINEUP: a position no
--     starting spot accepts defaults to 0, one the spec accepts is uncapped,
--     and an explicit blob still outranks both;
--   • a DRIP league keeps 0071's defaults, because its lineup really does have
--     a kicker and a defense in it;
--   • autodraft in a league with no K/DEF spot drafts NEITHER — including
--     through the last-resort fallback, which used to ignore caps outright;
--   • and a QUEUED player the league doesn't roster is passed over rather than
--     forced through the auto path.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
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
declare r jsonb; lid uuid; drip uuid; code text; pick text; i int; seat int; drafted text;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  -- ══ A DRIP LEAGUE KEEPS THE OLD DEFAULTS ═════════════════════════════════
  r := create_native_league('Drippy', '2024', 2, 8, 60);
  perform assert_ok(r, 'pd0 drip league'); drip := (r ->> 'league_id')::uuid;
  perform assert_true(league_pos_cap(drip, 'K') = 1 and league_pos_cap(drip, 'DEF') = 1,
    'pd0a drip still defaults to one K and one D/ST — its lineup has them');
  perform assert_true(league_pos_cap(drip, 'QB') = 3, 'pd0b …and three QBs');

  -- ══ A CLASSIC LEAGUE READS ITS OWN LINEUP ════════════════════════════════
  r := create_native_league('No Kickers Here', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'pd1 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'PD-B'), 'pd1a join'); perform probe_as('a');
  -- QB / RB / WR / TE / FLEX — no K, no D/ST anywhere in it.
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["TE"]},{"pos":["RB","WR","TE"]}]'::jsonb),
    'pd1b a spec with no kicker in it');
  perform assert_true(league_pos_cap(lid, 'K') = 0, 'pd2 K defaults to ZERO — no spot accepts one');
  perform assert_true(league_pos_cap(lid, 'DEF') = 0, 'pd2a and so does D/ST');
  perform assert_true(league_pos_cap(lid, 'RB') is null, 'pd2b RB is uncapped — the spec accepts it');
  perform assert_true(league_pos_cap(lid, 'QB') is null, 'pd2c so is QB, rather than 0071''s three');
  -- ══ AUTODRAFT TAKES NEITHER ══════════════════════════════════════════════
  -- ONE call: seed_league_pool REPLACES the unrostered pool, so a second one
  -- would take the first's players away with it.
  perform seed_league_pool(lid,
    '[{"slug":"pd-k1","full":"Kicker One","pos":"K","team":"KC"},
      {"slug":"pd-dst1","full":"Defense One","pos":"DEF","team":"KC"}]'::jsonb || (
    select jsonb_agg(jsonb_build_object('slug', 'pd-rb' || g, 'full', 'RB ' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 40) g));
  -- Rank them FIRST, so anything that ignores the cap will take them.
  update league_pool set rank = 1 where league_id = lid and slug = 'pd-k1';
  update league_pool set rank = 2 where league_id = lid and slug = 'pd-dst1';
  -- The refusal reads like the rule it is (the pool has him now).
  perform assert_true(pos_cap_error(lid, 1, 'pd-k1') like 'this league does not roster%',
    'pd2d a human pick is refused in those words, got: ' || coalesce(pos_cap_error(lid, 1, 'pd-k1'), 'null'));
  perform assert_ok(start_draft(lid, null), 'pd4 draft starts');
  for i in 1..16 loop
    exit when (select status from draft where league_id = lid) <> 'live';
    seat := (select draft_on_clock(d.*) from draft d where d.league_id = lid);
    pick := coalesce(native_queue_pick(lid, seat), native_autopick_slug(lid, seat, 8));
    exit when pick is null;
    perform native_exec_pick(lid, pick, true);
  end loop;
  select string_agg(slug, ', ') into drafted from draft_pick where league_id = lid and slug in ('pd-k1', 'pd-dst1');
  perform assert_true(drafted is null, 'pd4a the top-ranked kicker and defense went undrafted, got: ' || coalesce(drafted, '—'));
  perform assert_true((select count(*) from draft_pick where league_id = lid) > 0, 'pd4b …and the draft still ran');

  -- ══ A QUEUED BAN IS PASSED OVER ══════════════════════════════════════════
  perform assert_ok(commish_reset_draft(lid, 'reset'), 'pd5 start over');
  perform assert_ok(set_draft_queue(lid, 1, '["pd-k1", "pd-rb7"]'::jsonb), 'pd5a queue the kicker first');
  perform assert_true(native_queue_pick(lid, 1) = 'pd-rb7',
    'pd5b the queue skips the player the league does not roster and takes the next one');

  -- ══ AN EXPLICIT BLOB STILL OUTRANKS THE DERIVATION ═══════════════════════
  -- Last, because `set_roster_rules(…, null)` means "leave the caps alone" —
  -- there is no way back to derived once a blob is written, which is right for
  -- a commissioner's explicit word and would have made every check above read
  -- the blob instead.
  perform assert_ok(set_roster_rules(lid, null, '{"QB":null,"RB":null,"WR":null,"TE":null,"K":2,"DEF":null}'::jsonb),
    'pd6 explicit caps save');
  perform assert_true(league_pos_cap(lid, 'K') = 2, 'pd6a the commissioner outranks the derivation');
  perform assert_true(league_pos_cap(lid, 'DEF') is null, 'pd6b an explicit null is uncapped, not derived-zero');

  raise notice 'pos-default probes done';
end $$;

select 'ALL POS-DEFAULT PROBES PASSED' as result;
