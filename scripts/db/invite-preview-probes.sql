-- 0206 probes: the invite preview a SIGNED-OUT visitor gets.
--
-- The bug this guards is a grant, not a query — `league_by_invite` returned the
-- right rows for four years and simply could not be called by the one caller
-- that needed it. A grant is invisible in application code and silent when
-- wrong (PostgREST answers 401/404, the UI shrugs and shows generic copy), so
-- it is exactly the kind of thing that belongs in a probe.
\set ON_ERROR_STOP on
set client_min_messages = notice;
do $$
declare
  lg   uuid;
  n    int;
  got  record;
  acl  text;
begin
  insert into league (id, sleeper_league_id, name, season, provider, avatar_url, invite_code)
  values (gen_random_uuid(), 'INVITE-PREVIEW-PROBE', 'Kickoff League', '2026', 'native',
          'https://img.example/k.png', 'A1B2C3D4')
  returning id into lg;

  -- 1. THE SHAPE. avatar_url is new in 0206 and the whole point of the card.
  select * into got from league_by_invite('A1B2C3D4');
  if got.league_id is distinct from lg then raise exception 'PROBE FAIL: wrong league for the code'; end if;
  if got.name <> 'Kickoff League' then raise exception 'PROBE FAIL: name not returned'; end if;
  if got.season <> '2026' then raise exception 'PROBE FAIL: season not returned'; end if;
  if got.provider <> 'native' then raise exception 'PROBE FAIL: provider not returned'; end if;
  if got.avatar_url <> 'https://img.example/k.png' then raise exception 'PROBE FAIL: avatar_url not returned (0206)'; end if;

  -- 2. THE GRANT — the actual bug. anon must be able to call it, because the
  --    preview is wanted BEFORE there is an authenticated anybody.
  if not has_function_privilege('anon', 'league_by_invite(text)', 'execute') then
    raise exception 'PROBE FAIL: anon cannot execute league_by_invite — the signed-out preview is the feature';
  end if;
  if not has_function_privilege('authenticated', 'league_by_invite(text)', 'execute') then
    raise exception 'PROBE FAIL: authenticated lost execute — the redeem form previews too';
  end if;

  -- 3. IT LEAKS NOTHING ELSE. If a column is ever added to the return, this
  --    fails and whoever added it has to think about anon reading it.
  select count(*) into n from information_schema.routines r
    join information_schema.parameters p on p.specific_name = r.specific_name
   where r.routine_name = 'league_by_invite' and p.parameter_mode = 'OUT';
  if n <> 6 then raise exception 'PROBE FAIL: league_by_invite returns % columns, expected 6 — anon reads every one', n; end if;

  -- 3b. GAME MODE (0207) — what lets the join card say "Classic" rather than
  --     pitching hidden picks to someone joining a classic league. UNSET means
  --     'drip', the same default every other reader of settings_json uses.
  if got.game_mode <> 'drip' then
    raise exception 'PROBE FAIL: an unset game_mode should read as drip, got %', got.game_mode;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('game_mode', 'classic')
   where id = lg;
  select * into got from league_by_invite('A1B2C3D4');
  if got.game_mode <> 'classic' then
    raise exception 'PROBE FAIL: a classic league previews as %, not classic', got.game_mode;
  end if;
  if got.name <> 'Kickoff League' then raise exception 'PROBE FAIL: the rest of the row broke'; end if;

  -- 4. THE CODE IS NORMALISED both ways, so a link that arrives lowercased (or
  --    with a stray space from a chat client) still previews.
  if (select count(*) from league_by_invite('a1b2c3d4')) <> 1 then
    raise exception 'PROBE FAIL: a lowercase code did not match';
  end if;
  if (select count(*) from league_by_invite('  A1B2C3D4  ')) <> 1 then
    raise exception 'PROBE FAIL: a padded code did not match';
  end if;

  -- 5. A DEAD CODE RETURNS NOTHING, rather than erroring — the UI needs to tell
  --    the difference between "no such league" and "the lookup broke".
  if (select count(*) from league_by_invite('DEADBEEF')) <> 0 then
    raise exception 'PROBE FAIL: an unknown code matched something';
  end if;
  if (select count(*) from league_by_invite('')) <> 0 then
    raise exception 'PROBE FAIL: an empty code matched something';
  end if;

  delete from league where id = lg;
  raise notice 'invite-preview probes done';
end $$;
select 'ALL INVITE-PREVIEW PROBES PASSED' as result;
