-- 0209 probes: per-reception points as an editable field.
--
-- The whole risk here is a value with TWO homes. `ppr` lives in
-- settings_json.ppr (0157, read directly by every surface that renders "full
-- PPR") and now in the scoring catalog too. These assert that both writers
-- write both, so the number a commissioner types cannot end up disagreeing
-- with the sentence rendered next to it.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function rc_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000rc0' || u, false);
  perform set_config('app.email', 'rc' || u || '@test.dev', false);
end $$;

do $$
declare
  lg uuid; u uuid := '00000000-0000-0000-0000-0000000000c1'; r jsonb; got numeric; cat jsonb;
begin
  insert into auth.users (id, email) values (u, 'rc1@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values (u, 'rc1@test.dev') on conflict (id) do nothing;
  perform set_config('app.uid', u::text, false);
  perform set_config('app.email', 'rc1@test.dev', false);

  insert into league (id, sleeper_league_id, name, season, provider, invite_code, commissioner_id, settings_json)
  values (gen_random_uuid(), 'RECEPTION-PROBE', 'PPR Probe', '2026', 'native', 'RECP0001', u,
          jsonb_build_object('game_mode', 'classic', 'classic_ok', true, 'ppr', 1))
  returning id into lg;

  -- 1. THE FIELD SAVES AT ALL. Before 0209 `ppr` was not whitelisted, so this
  --    was silently dropped — the exact failure this suite exists to catch.
  r := set_league_classic_scoring(lg, jsonb_build_object('ppr', 0.5, 'recTd', 6));
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: save rejected: %', r; end if;
  cat := (select settings_json -> 'scoring_classic' from league where id = lg);
  if (cat ->> 'ppr')::numeric <> 0.5 then
    raise exception 'PROBE FAIL: ppr was stripped by the sanitizer — got %', cat;
  end if;

  -- 2. AND MIRRORS OUT, so every sentence rendered from settings_json.ppr
  --    ("full PPR" on the invite preview) tells the truth.
  got := (select (settings_json ->> 'ppr')::numeric from league where id = lg);
  if got <> 0.5 then raise exception 'PROBE FAIL: settings_json.ppr still % after saving 0.5', got; end if;

  -- 3. PRECISION. Two decimals, so a quarter-point league is not rounded to 0.3
  --    the way the shared event clamp (one decimal) would have.
  r := set_league_classic_scoring(lg, jsonb_build_object('ppr', 0.25));
  cat := (select settings_json -> 'scoring_classic' from league where id = lg);
  if (cat ->> 'ppr')::numeric <> 0.25 then
    raise exception 'PROBE FAIL: 0.25 PPR rounded to % — the clamp is too coarse', cat ->> 'ppr';
  end if;

  -- 4. ABOVE THE PER-YARD CAP. 1.5 is a real setting and must survive; the
  --    yard clamp of 1 would have flattened it.
  r := set_league_classic_scoring(lg, jsonb_build_object('ppr', 1.5));
  if (select (settings_json -> 'scoring_classic' ->> 'ppr')::numeric from league where id = lg) <> 1.5 then
    raise exception 'PROBE FAIL: 1.5 PPR did not survive';
  end if;

  -- 5. CLAMPED AT BOTH ENDS.
  perform set_league_classic_scoring(lg, jsonb_build_object('ppr', 99));
  if (select (settings_json -> 'scoring_classic' ->> 'ppr')::numeric from league where id = lg) <> 5 then
    raise exception 'PROBE FAIL: ppr was not clamped to 5';
  end if;
  perform set_league_classic_scoring(lg, jsonb_build_object('ppr', -3));
  if (select (settings_json -> 'scoring_classic' ->> 'ppr')::numeric from league where id = lg) <> 0 then
    raise exception 'PROBE FAIL: a negative ppr was not clamped to 0';
  end if;

  -- 6. THE PRESET PATH MIRRORS THE OTHER WAY. Applying a preset must not leave
  --    a stale catalog copy behind it, or the field would show the value the
  --    preset just replaced.
  perform set_league_classic_scoring(lg, jsonb_build_object('ppr', 0.5));
  r := set_league_game_mode(lg, 'classic', 1);
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: preset rejected: %', r; end if;
  if (select (settings_json -> 'scoring_classic' ->> 'ppr')::numeric from league where id = lg) <> 1 then
    raise exception 'PROBE FAIL: the preset left a stale scoring_classic.ppr behind';
  end if;
  if (select (settings_json ->> 'ppr')::numeric from league where id = lg) <> 1 then
    raise exception 'PROBE FAIL: the preset did not set settings_json.ppr';
  end if;

  -- 7. THE TWO HOMES AGREE, always. This is the whole point of the migration.
  if (select (settings_json ->> 'ppr')::numeric from league where id = lg)
     <> (select (settings_json -> 'scoring_classic' ->> 'ppr')::numeric from league where id = lg) then
    raise exception 'PROBE FAIL: the two ppr homes disagree';
  end if;

  -- 8. OTHER FIELDS ARE UNDISTURBED by the new key's own clamp block.
  perform set_league_classic_scoring(lg, jsonb_build_object('ppr', 1, 'recTd', 6, 'recYd', 0.1, 'teRec', 0.5));
  cat := (select settings_json -> 'scoring_classic' from league where id = lg);
  if (cat ->> 'recTd')::numeric <> 6 or (cat ->> 'recYd')::numeric <> 0.1 or (cat ->> 'teRec')::numeric <> 0.5 then
    raise exception 'PROBE FAIL: the ppr block disturbed its neighbours — %', cat;
  end if;

  -- 9. A SAVE WITHOUT ppr LEAVES settings_json.ppr ALONE rather than zeroing it.
  perform set_league_classic_scoring(lg, jsonb_build_object('recTd', 7));
  if (select (settings_json ->> 'ppr')::numeric from league where id = lg) <> 1 then
    raise exception 'PROBE FAIL: a save that omitted ppr clobbered settings_json.ppr';
  end if;

  -- 10. STILL COMMISSIONER-ONLY.
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c2', 'rc2@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000000c2', 'rc2@test.dev') on conflict (id) do nothing;
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000000c2', false);
  r := set_league_classic_scoring(lg, jsonb_build_object('ppr', 3));
  if (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: a non-commissioner set the league PPR'; end if;

  delete from league where id = lg;
  delete from app_user where id in (u, '00000000-0000-0000-0000-0000000000c2');
  raise notice 'reception-scoring probes done';
end $$;
select 'ALL RECEPTION-SCORING PROBES PASSED' as result;
