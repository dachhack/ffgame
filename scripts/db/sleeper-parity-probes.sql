-- 0319 probes: FOUR SLEEPER SETTINGS.
--   • the minimum bid refuses a lower FAAB claim, takes an equal one, and
--     zero (the default) takes $0;
--   • free-agency days: a day outside the set shuts the add market (a claim
--     is the way in, stamped no later than the next free-agency midnight);
--     a day inside it opens as before; fa_open_since dates the opening at
--     that midnight;
--   • the trade deadline: offers and acceptances go through THROUGH the
--     deadline week, are refused once it is final, and clearing it reopens;
--   • a hold of none: a dropped player is addable at once.
\set QUIET on
\pset pager off
create or replace function sp_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function sp_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function sp_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function sp_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000010' || u, false); perform set_config('app.email', 'sp' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001001', 'sp01@test.dev'), ('00000000-0000-0000-0000-000000001002', 'sp02@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000001001', 'sp01@test.dev'), ('00000000-0000-0000-0000-000000001002', 'sp02@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000001002');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c1 uuid; today int; tomorrow int; run_min int; wk int; tid uuid;
begin
  perform sp_as('01');
  r := create_native_league('SleeperParity', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform sp_ok(r, 'sp0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform sp_as('02'); perform sp_ok(native_join(code, 'SP-B'), 'sp0 B takes a seat'); perform sp_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'sp-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'SPH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001001';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001002';
  perform sp_ok(native_generate_schedule(lid, 2), 'sp0 the schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, a, 'sp-1', 'draft'), (lid, a, 'sp-2', 'draft'), (lid, b, 'sp-3', 'draft');
  run_min := (et_minutes(now()) + 180) % 1440;
  perform sp_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'off', p_waiver_clear_min => run_min), 'sp0 faab, run in 3h, FA off');
  perform sp_true((roster_rules(lid) ->> 'faab_min_bid')::int = 0 and jsonb_typeof(roster_rules(lid) -> 'fa_dow') = 'null'
    and (roster_rules(lid) ->> 'trade_deadline_week') is null and (roster_rules(lid) ->> 'trade_deadline_passed')::boolean = false,
    'sp0 the reader reports the defaults');

  -- ── sp1. the minimum bid ──
  r := submit_waiver_claim(lid, a, 'sp-10', null, 0); perform sp_ok(r, 'sp1 with no floor a $0 claim is fine');
  perform sp_ok(cancel_waiver_claim((r ->> 'claim_id')::uuid), 'sp1 (withdrawn)');
  perform sp_ok(set_transaction_rules(lid, p_faab_min_bid => 2), 'sp1 the commissioner sets a $2 floor');
  perform sp_true((roster_rules(lid) ->> 'faab_min_bid')::int = 2, 'sp1 the reader says $2');
  r := submit_waiver_claim(lid, a, 'sp-10', null, 1); perform sp_refused(r, 'minimum bid is $2', 'sp1 $1 is refused');
  r := submit_waiver_claim(lid, a, 'sp-10', null, 2); perform sp_ok(r, 'sp1 $2 is taken');
  perform sp_ok(cancel_waiver_claim((r ->> 'claim_id')::uuid), 'sp1 (withdrawn)');
  perform sp_ok(set_transaction_rules(lid, p_faab_min_bid => -1), 'sp1 cleared');
  r := submit_waiver_claim(lid, a, 'sp-10', null, 0); perform sp_ok(r, 'sp1 and $0 is fine again');
  perform sp_ok(cancel_waiver_claim((r ->> 'claim_id')::uuid), 'sp1 (withdrawn)');

  -- ── sp2. free-agency days ──
  today := extract(dow from now() at time zone 'America/New_York')::int;
  tomorrow := (today + 1) % 7;
  perform sp_ok(set_transaction_rules(lid, p_fa_mode => 'open', p_fa_dow => to_jsonb(array[today])), 'sp2 free agency open, today only');
  perform sp_true(fa_window_open(lid), 'sp2 open now (today is a free-agency day)');
  perform sp_true(fa_open_since(lid) is not null and et_minutes(fa_open_since(lid)) = 0 and fa_open_since(lid) > now() - interval '25 hours',
    'sp2 and it opened at midnight ET (got ' || coalesce(fa_open_since(lid)::text, 'null') || ')');
  perform sp_ok(set_transaction_rules(lid, p_fa_dow => to_jsonb(array[tomorrow])), 'sp2 tomorrow only');
  perform sp_true(not fa_window_open(lid), 'sp2 shut now (today is a waivers-only day)');
  perform sp_true(fa_opens_at(lid) > now() and fa_opens_at(lid) <= now() + interval '24 hours' and et_minutes(fa_opens_at(lid)) = 0,
    'sp2 it opens at the next midnight ET (got ' || coalesce(fa_opens_at(lid)::text, 'null') || ')');
  r := add_free_agent(lid, a, 'sp-11', null); perform sp_refused(r, 'closed', 'sp2 an add is refused on a waivers-only day');
  r := submit_waiver_claim(lid, a, 'sp-11', null, 1); perform sp_ok(r, 'sp2 a claim is the way in'); c1 := (r ->> 'claim_id')::uuid;
  perform sp_true((select clears_at from waiver_claim where id = c1) = least(next_waiver_run(lid), fa_opens_at(lid)),
    'sp2 stamped with the run or the free-agency morning, whichever first');
  perform sp_ok(cancel_waiver_claim(c1), 'sp2 (withdrawn)');
  perform sp_ok(set_transaction_rules(lid, p_fa_dow => '[]'::jsonb), 'sp2 every day again');
  perform sp_true(fa_window_open(lid) and jsonb_typeof(roster_rules(lid) -> 'fa_dow') = 'null', 'sp2 open, and the reader shows no day set');

  -- ── sp3. the trade deadline ──
  select league_live_week(lid) into wk;
  perform sp_true(wk is not null, 'sp3 the league has a live week');
  perform sp_ok(set_transaction_rules(lid, p_trade_deadline_week => wk), 'sp3 deadline = the live week');
  perform sp_true((roster_rules(lid) ->> 'trade_deadline_week')::int = wk and (roster_rules(lid) ->> 'trade_deadline_passed')::boolean = false,
    'sp3 the reader: set, not passed');
  r := propose_trade(lid, a, b, '["sp-1"]'::jsonb, '["sp-3"]'::jsonb, null, null, null); perform sp_ok(r, 'sp3 an offer goes through during the deadline week');
  tid := (r ->> 'trade_id')::uuid;
  update matchup set status = 'final' where league_id = lid and week = wk;
  perform sp_true(league_live_week(lid) is distinct from wk, 'sp3 the week is final');
  perform sp_true((roster_rules(lid) ->> 'trade_deadline_passed')::boolean, 'sp3 the reader: passed');
  r := propose_trade(lid, a, b, '["sp-2"]'::jsonb, '["sp-3"]'::jsonb, null, null, null); perform sp_refused(r, 'deadline has passed', 'sp3 a new offer is refused');
  perform sp_as('02');
  r := respond_trade(tid, true); perform sp_refused(r, 'deadline has passed', 'sp3 accepting the earlier offer is refused too');
  r := respond_trade(tid, false); perform sp_ok(r, 'sp3 declining it is fine');
  perform sp_as('01');
  perform sp_ok(set_transaction_rules(lid, p_trade_deadline_week => -1), 'sp3 the deadline is cleared');
  r := propose_trade(lid, a, b, '["sp-2"]'::jsonb, '["sp-3"]'::jsonb, null, null, null); perform sp_ok(r, 'sp3 and offers go through again');
  perform sp_ok(cancel_trade((r ->> 'trade_id')::uuid), 'sp3 (withdrawn)');

  -- ── sp4. a hold of none ──
  perform sp_ok(set_transaction_rules(lid, p_waiver_hold_days => 0), 'sp4 no hold after a drop');
  perform sp_true((roster_rules(lid) ->> 'waiver_hold_days')::int = 0, 'sp4 the reader says 0');
  perform sp_ok(drop_player(lid, a, 'sp-1'), 'sp4 A drops sp-1');
  perform sp_true(coalesce((select waived_until from league_pool where league_id = lid and slug = 'sp-1') <= now(), true), 'sp4 no hold on him');
  perform sp_as('02');
  perform sp_ok(add_free_agent(lid, b, 'sp-1', null), 'sp4 B adds him at once');
  perform sp_as('01');
  perform sp_ok(set_transaction_rules(lid, p_waiver_hold_days => 1), 'sp4 a day again');
  perform sp_ok(drop_player(lid, a, 'sp-2'), 'sp4 A drops sp-2');
  perform sp_true((select waived_until from league_pool where league_id = lid and slug = 'sp-2') > now(), 'sp4 and this one is held');
end $$;

select 'ALL SLEEPER-PARITY PROBES PASSED' as result;
