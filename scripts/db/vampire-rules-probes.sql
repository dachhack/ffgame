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

  -- ══ a PRACTICE-WEEK win is not fresh blood (0297, v0.425.0) ══════════════
  -- Founder: "the vampire lost but took Amon-Ra." Practice weeks (101+) are
  -- final rows that sit ABOVE every regular week, so `max(week)` used to
  -- answer 103 all season — a vampire that won practice week 103 kept its
  -- window open on that win through a real week-1 loss.
  lid := _vr_league('VR Practice Blood', 'vrp-', 4, '[2]'::jsonb);
  perform vr_as('1');
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, home_final, away_final)
    values (lid, 103, 2, 1, 'final', now() - interval '30 days', 130.0, 70.0),
           (lid, 103, 3, 4, 'final', now() - interval '30 days', 130.0, 70.0);
  r := vampire_state(lid);
  perform vr_true(r ->> 'week' is null, 'vr6 a finaled practice week is no completed week: ' || coalesce(r ->> 'week', 'null'));
  perform vr_true(coalesce((r ->> 'won')::boolean, true) is false, 'vr6a …and opens no window');
  select slug into tk from native_roster where league_id = lid and roster_id = 1 limit 1;
  select slug into gv from native_roster where league_id = lid and roster_id = 2 limit 1;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false
      and position('no completed week' in coalesce(r ->> 'error', '')) > 0,
    'vr6b a practice win feeds nobody: ' || r::text);
  perform _vr_final(lid, 1, array[1, 3]);        -- the vampire LOSES week 1
  r := vampire_state(lid);
  perform vr_true((r ->> 'week')::int = 1, 'vr6c week 1 is the latest completed week, not 103: ' || coalesce(r ->> 'week', 'null'));
  perform vr_true(coalesce((r ->> 'won')::boolean, true) is false, 'vr6d the week-1 loss is what the window reads');
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false
      and position('lost week 1' in coalesce(r ->> 'error', '')) > 0,
    'vr6e the vampire that lost week 1 cannot bite: ' || r::text);
  r := vampire_state(lid);
  perform vr_true((r -> 'record' ->> 'wins')::int = 0 and (r -> 'record' ->> 'losses')::int = 1,
    'vr6f the record counts the season only (0-1), not the practice win: ' || (r -> 'record')::text);
  perform vr_true(jsonb_array_length(r -> 'weeks') = 1 and (r -> 'weeks' -> 0 ->> 'week')::int = 1,
    'vr6g the week list carries week 1 alone');
  perform _vr_final(lid, 2, array[2]);           -- …and WINS week 2
  r := vampire_state(lid);
  perform vr_true((r ->> 'week')::int = 2 and coalesce((r ->> 'won')::boolean, false),
    'vr6h a real win still opens the window');
  vic := (r ->> 'victim')::int;
  select slug into tk from native_roster where league_id = lid and roster_id = vic limit 1;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, false), 'vr6i …and feeds: ' || r::text);

  raise notice 'vampire-rules probes done';
end $$;

-- ══ the BOT VAMPIRE bites (0300, v0.427.0) ═══════════════════════════════
-- The worker (service role, no uid) may read the window and declare the
-- bite for a vampire seat nobody manages — and for no other seat.
create or replace function vr_as_worker() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;

do $$
declare lid uuid; r jsonb; vic int; tk text; gv text;
begin
  -- a 🤖 vampire: seat 2, no human, controller 'ai'
  lid := _vr_league('VR Bot Fangs', 'vrbf-', 4, '[2]'::jsonb);
  perform vr_as('1');
  update league_membership set controller = 'ai', app_user_id = null where league_id = lid and sleeper_roster_id = 2;
  perform _vr_final(lid, 1, array[2]);
  perform vr_as_worker();
  r := vampire_state(lid);
  perform vr_true(r ->> 'error' is null and coalesce((r ->> 'vampire')::boolean, false),
    'vr7 the worker reads the window: ' || left(r::text, 60));
  perform vr_true(coalesce((r ->> 'won')::boolean, false) and (r ->> 'victim') is not null,
    'vr7a …and sees the fresh win and the victim');
  vic := (r ->> 'victim')::int;
  select slug into tk from native_roster where league_id = lid and roster_id = vic limit 1;
  select slug into gv from native_roster where league_id = lid and roster_id = 2 limit 1;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, false) and r ->> 'status' = 'executed',
    'vr7b the worker bites for the bot vampire: ' || r::text);
  perform vr_true((select roster_id from native_roster where league_id = lid and slug = tk) = 2
      and (select roster_id from native_roster where league_id = lid and slug = gv) = vic,
    'vr7c the players changed hands');
  r := vampire_steal(lid, gv, tk, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false,
    'vr7d one bite per win still binds the worker: ' || r::text);
  -- the worker names the seat: a non-vampire seat is refused
  r := vampire_steal(lid, tk, gv, 3);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false, 'vr7e a seat that is not a vampire is refused: ' || r::text);

  -- a HUMAN-CONTROLLED vampire nobody has claimed and nobody agents: not the worker's
  lid := _vr_league('VR Human Fangs', 'vrhf-', 4, '[2]'::jsonb);
  perform vr_as('1');
  update league_membership set controller = 'human', app_user_id = null where league_id = lid and sleeper_roster_id = 2;
  perform _vr_final(lid, 1, array[2]);
  perform vr_as_worker();
  r := vampire_state(lid); vic := (r ->> 'victim')::int;
  select slug into tk from native_roster where league_id = lid and roster_id = vic limit 1;
  select slug into gv from native_roster where league_id = lid and roster_id = 2 limit 1;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false
      and position('only the vampire feeds' in coalesce(r ->> 'error', '')) > 0,
    'vr7f a vampire seat with no bot and no agent is not the worker''s to feed: ' || r::text);
  -- …until it is agented (0180's row), on the wire's own terms (0213)
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c3fa1', 'vr-agent@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000c3fa1', 'vr-agent@test.dev') on conflict (id) do nothing;
  insert into seat_agent (league_id, roster_id, agent_user_id) values (lid, 2, '00000000-0000-0000-0000-0000000c3fa1') on conflict do nothing;
  r := vampire_steal(lid, tk, gv, 2);
  perform vr_true(coalesce((r ->> 'ok')::boolean, false), 'vr7g an agented vampire seat feeds through the worker: ' || r::text);

  -- a vampire a HUMAN holds on 🤖 auto-pilot: the worker's to feed (0308,
  -- v0.432.3 — a seat on AI control is the AI's to manage); on 'human', not
  lid := _vr_league('VR Held Fangs', 'vrhe-', 4, '[1]'::jsonb);   -- seat 1 is user 1's
  perform vr_as('1');
  perform _vr_final(lid, 1, array[1]);
  perform vr_as_worker();
  r := vampire_state(lid); vic := (r ->> 'victim')::int;
  select slug into tk from native_roster where league_id = lid and roster_id = vic limit 1;
  select slug into gv from native_roster where league_id = lid and roster_id = 1 limit 1;
  r := vampire_steal(lid, tk, gv, 1);
  perform vr_true(coalesce((r ->> 'ok')::boolean, true) is false,
    'vr7h a human-controlled vampire a human holds keeps the bite as their own: ' || r::text);
  perform vr_as('1');
  update league_membership set controller = 'ai' where league_id = lid and sleeper_roster_id = 1;
  perform vr_as_worker();
  r := vampire_steal(lid, tk, gv, 1);
  perform vr_true(coalesce((r ->> 'ok')::boolean, false),
    'vr7i …and on auto-pilot the worker feeds for them: ' || r::text);

  raise notice 'bot-vampire probes done';
end $$;

select 'ALL VAMPIRE-RULES PROBES PASSED' as status;
