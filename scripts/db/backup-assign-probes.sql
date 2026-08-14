-- 0137 probes: manual backup assignments (set_backup_assign).
--
-- The stakes: this store is what the WORKER scores. If the gate slips, a
-- non-participant could steer someone else's subs; if the final-check slips,
-- assignments could rewrite a settled matchup; if the key validation slips,
-- garbage keys ride into the engine's assign map.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000401', 'bkhome@test.dev'),
  ('00000000-0000-0000-0000-000000000402', 'bkaway@test.dev'),
  ('00000000-0000-0000-0000-000000000403', 'bkoutsider@test.dev')
on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000000401', 'bkhome@test.dev'),
  ('00000000-0000-0000-0000-000000000402', 'bkaway@test.dev'),
  ('00000000-0000-0000-0000-000000000403', 'bkoutsider@test.dev')
on conflict (id) do nothing;

insert into league (id, sleeper_league_id, season, name, commissioner_id) values
  ('00000000-0000-0000-0000-000000000cf1', 'BACKUP-PROBE', '2026', 'Backup Probe', '00000000-0000-0000-0000-000000000401');
insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name) values
  ('00000000-0000-0000-0000-000000000cf1', 1, '00000000-0000-0000-0000-000000000401', true, 'Home'),
  ('00000000-0000-0000-0000-000000000cf1', 2, '00000000-0000-0000-0000-000000000402', true, 'Away');
insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status) values
  ('00000000-0000-0000-0000-000000000cf9', '00000000-0000-0000-0000-000000000cf1', 9, 1, 2, 'live');

do $$
declare mid uuid := '00000000-0000-0000-0000-000000000cf9'; r jsonb;
begin
  -- b1. a non-participant is refused
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000403', false);
  perform assert_err(set_backup_assign(mid, 'tnf#0', 'snf#1'), 'forbidden', 'b1 outsider refused');

  -- b2. a participant assigns, LIVE matchup included (that's the point)
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000401', false);
  r := set_backup_assign(mid, 'tnf#0', 'snf#1');
  perform assert_true(coalesce((r ->> 'ok')::boolean, false), 'b2 assign ok on a live matchup');
  perform assert_true((select payload_json->'targeted'->'backups'->>'tnf#0' from applied_state
    where matchup_id = mid and app_user_id = '00000000-0000-0000-0000-000000000401') = 'snf#1',
    'b2 stored where the worker reads');

  -- b3. reassign replaces; null clears back to auto
  perform set_backup_assign(mid, 'tnf#0', 'mnf#2');
  perform assert_true((select payload_json->'targeted'->'backups'->>'tnf#0' from applied_state
    where matchup_id = mid and app_user_id = '00000000-0000-0000-0000-000000000401') = 'mnf#2', 'b3 reassigned');
  perform set_backup_assign(mid, 'tnf#0', null);
  perform assert_true((select payload_json->'targeted'->'backups' ? 'tnf#0' from applied_state
    where matchup_id = mid and app_user_id = '00000000-0000-0000-0000-000000000401') = false, 'b3 cleared to auto');

  -- b4. each side's assignments are their own
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000402', false);
  perform set_backup_assign(mid, 'early#1', 'late#0');
  perform assert_true((select count(*) from applied_state where matchup_id = mid) = 2, 'b4 per-side rows');

  -- b5. garbage keys never reach the engine
  perform assert_err(set_backup_assign(mid, 'not a key', 'snf#1'), 'bad backup key', 'b5 bad backup key');
  perform assert_err(set_backup_assign(mid, 'tnf#0', 'nor; this'), 'bad target key', 'b5 bad target key');

  -- b6. a settled matchup refuses
  update matchup set status = 'final' where id = mid;
  perform assert_err(set_backup_assign(mid, 'tnf#0', 'snf#1'), 'final', 'b6 final refused');
  update matchup set status = 'live' where id = mid;

  -- b7. unknown matchup is a calm error
  perform assert_err(set_backup_assign(gen_random_uuid(), 'tnf#0', 'snf#1'), 'no matchup', 'b7 unknown matchup');
end $$;

select 'ALL BACKUP-ASSIGN PROBES PASSED' as result;
