-- 0279 probes: DRAFTING MID-SEASON, in a classic league whose week has kicked off.
--
-- What must hold:
--   • while the draft is unfinished, a MANAGER can pick a player whose week-1
--     game has already started (the roster is being built, not changed);
--   • the worker and an admin could always do this, and still can;
--   • the moment the draft COMPLETES the 0179 kickoff lock re-arms: the same
--     manager can no longer drop that player, and the error still names why;
--   • a player who has NOT kicked off is droppable after the draft, so the
--     exemption did not simply switch the rule off.
--
-- WHY THIS SUITE EXISTS: every pre-existing classic/draft fixture skips
-- `native_generate_schedule`, so `league_live_week` was NULL and the 0179
-- trigger was inert — the bug reproduced only in a league shaped exactly like
-- a real one, which is the shape this suite builds.
\set QUIET on
\pset pager off

create or replace function dm_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function dm_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

-- ── fixture: a CLASSIC league, schedule generated, week 1 already kicked off ──
do $$
declare lid uuid; code text; r jsonb; i int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c');
  perform probe_as('b');
  r := create_native_league('Midseason Draft', '2026', 4, 7, 60, 'snake', 200, 15, 1,
                            null, null, null, 'classic');
  perform dm_ok(r, 'dm0 classic league created');
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('c'); perform dm_ok(native_join(code, 'MD-C'), 'dm0a c joins');
  reset role;
  -- A kickoff in the PAST for the league's live week. classic_kickoff_for takes
  -- MIN over the week's slate, so this row wins whatever the baked slate says.
  insert into nfl_slate (season, week, win, home, away, kickoff)
    values ('2026', 1, 'sun_early', 'MDH', 'MDA', now() - interval '6 hours')
    on conflict do nothing;
  -- MDH players have kicked off; ZZZ players have no game this week at all.
  for i in 1..40 loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank)
      values (lid, 'md-' || i, 'MD ' || i, (array['QB','RB','WR','TE'])[1 + (i % 4)], 'MDH', i)
      on conflict do nothing;
  end loop;
  insert into league_pool (league_id, slug, full_name, pos, team, rank)
    values (lid, 'md-bye', 'MD Bye', 'RB', 'ZZZ', 99) on conflict do nothing;
  -- THE STEP THAT MAKES IT REAL: the creation flow generates the schedule first.
  -- As the COMMISSIONER — the RPC is commish/admin gated and answers a plain
  -- {ok:false,'forbidden'} to anyone else, which is easy to skip past.
  perform probe_as('b');
  perform dm_ok(native_generate_schedule(lid, 2), 'dm0b the schedule is generated');
  perform set_config('probe.md_lid', lid::text, false);
  perform dm_true((select min(week) from matchup where league_id = lid and status <> 'final') = 1,
    'dm1 the league is live on week 1');
  perform dm_true(classic_slug_started(lid, 'md-1'),
    'dm2 and week 1 HAS kicked off for a pooled player — the condition 0179 locks on');
  perform probe_as('b');
  perform dm_ok(start_draft(lid), 'dm3 the draft opens');
end $$;

-- ── 1. a manager drafts a kicked-off player, mid-season ────────────────────
do $$
declare lid uuid := current_setting('probe.md_lid')::uuid; r jsonb; oc int;
begin
  reset role;
  select draft_on_clock(d) into oc from draft d where d.league_id = lid;
  -- Hand the seat on the clock to b, so the pick below is made by a MANAGER
  -- (the whole point — the server and an admin were never blocked). Four seats,
  -- two joiners, so the opening seat is often an unclaimed one.
  update league_membership set app_user_id = '00000000-0000-0000-0000-00000000000b',
         enrolled = true, controller = 'human', autodraft = false
    where league_id = lid and sleeper_roster_id = oc;
  set local role authenticated;
  perform probe_as('b');
  r := make_draft_pick(lid, 'md-1');
  perform dm_ok(r, 'dm4 a MANAGER drafts a player whose game already kicked off');
  reset role;
  -- the server's autopick path was never blocked and still is not
  perform set_config('app.uid', '', false);
  r := draft_tick(lid);
  perform dm_ok(r, 'dm5 the worker''s tick still runs');
end $$;

-- ── 2. once the draft COMPLETES, the kickoff lock is back ──────────────────
do $$
declare lid uuid := current_setting('probe.md_lid')::uuid; seat int; n int;
begin
  reset role;
  -- Finish it. `draft_tick` deliberately WAITS on a live human whose clock has
  -- not run out (seat_is_live_human), so flip every seat to autodraft first —
  -- otherwise the loop below just watches a 60s deadline it cannot pass.
  update league_membership set autodraft = true where league_id = lid;
  perform set_config('app.uid', '', false);
  for n in 1..60 loop
    exit when (select status from draft where league_id = lid) = 'complete';
    perform draft_tick(lid);
  end loop;
  perform dm_true((select status from draft where league_id = lid) = 'complete',
    'dm6 the draft finished');
  select roster_id into seat from native_roster
    where league_id = lid and slug = 'md-1';
  perform dm_true(seat is not null, 'dm7 the drafted player is on a roster');
  -- hand that seat to b so a MANAGER (not the server) tries the drop
  update league_membership set app_user_id = '00000000-0000-0000-0000-00000000000b',
         enrolled = true, controller = 'human'
    where league_id = lid and sleeper_roster_id = seat;
  set local role authenticated;
  perform probe_as('b');
  -- is_admin() is an EXEMPTION in this trigger, so a leaked app_admin row from
  -- an earlier suite would make dm8 pass for the wrong reason. Assert it.
  perform dm_true(not is_admin(), 'dm7a the actor is a plain manager, not an admin');
  perform dm_true(classic_slug_started(lid, 'md-1'), 'dm7b the player has still kicked off');
  perform dm_true((select status from draft where league_id = lid) = 'complete',
    'dm7c and the draft is complete, so the exemption is off');
  -- THROUGH drop_player, the door a manager actually uses. A bare DELETE here
  -- would prove nothing: native_roster's RLS grants SELECT only, so as
  -- `authenticated` it removes zero rows and the trigger never fires.
  begin
    perform drop_player(lid, seat, 'md-1');
    raise exception 'PROBE FAIL dm8 — a kicked-off player was dropped AFTER the draft; the 0179 lock did not re-arm';
  exception when check_violation then null;
  end;
  reset role;
  -- …and a player with no game this week is still movable, so the lock is a
  -- lock and not an outage.
  perform set_config('app.uid', '', false);
  insert into native_roster (league_id, roster_id, slug, acquired)
    values (lid, seat, 'md-bye', 'commish') on conflict do nothing;
  set local role authenticated;
  perform probe_as('b');
  perform dm_ok(drop_player(lid, seat, 'md-bye'),
    'dm9 a player with no game this week is still droppable after the draft');
  perform dm_true(not exists (select 1 from native_roster where league_id = lid and slug = 'md-bye'),
    'dm9a and he is really gone');
  reset role;
  raise notice 'draft-midseason probes done';
end $$;

select 'ALL DRAFT-MIDSEASON PROBES PASSED' as status;
