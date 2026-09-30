-- 0394 + 0395 probes: MARK-FREE.
--   • 0394 clears team avatars and league crests that are ESPN NFL logos, and
--     only those; the old values land in nfl_logo_avatar_backup; re-running is
--     harmless;
--   • mark_free_state() answers signed out (global only) and signed in
--     (global + mine, null until set);
--   • set_my_mark_free writes the caller's row and nobody else's;
--   • admin_set_global_mark_free is refused to a non-admin and flips the
--     switch for everyone, signed out included;
--   • site_pref and the backup table are unreadable to a player directly.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function mf_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function mf_as(u text) returns void language plpgsql as $$
begin
  if u = '' then perform set_config('app.uid', '', false); perform set_config('app.email', '', false); return; end if;
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000039' || u, false);
  perform set_config('app.email', 'mf' || u || '@test.dev', false);
end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003901', 'mf01@test.dev'), ('00000000-0000-0000-0000-000000003902', 'mf02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000003901', 'mf01@test.dev'), ('00000000-0000-0000-0000-000000003902', 'mf02@test.dev')
  on conflict (id) do nothing;
insert into app_admin (email, note) values ('mf01@test.dev', 'mark-free probe admin') on conflict (email) do nothing;

-- ── mf1. 0394: only NFL logos are cleared, and they're backed up ──
insert into league (id, sleeper_league_id, season, name, avatar_url) values
  ('00000000-0000-0000-0000-00000000f001', 'MF-NFL', '2026', 'MF nfl crest',   'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png'),
  ('00000000-0000-0000-0000-00000000f002', 'MF-OWN', '2026', 'MF drip crest',  'https://drip.example/avatars/a1.png'),
  ('00000000-0000-0000-0000-00000000f003', 'MF-NCAA', '2026', 'MF ncaa crest', 'https://a.espncdn.com/i/teamlogos/ncaa/500/248.png');
insert into league_membership (id, league_id, sleeper_roster_id, team_name, avatar_url) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f001', 1, 'MF nfl team', 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000f001', 2, 'MF sleeper team', 'https://sleepercdn.com/avatars/abc');
\i supabase/migrations/0394_clear_nfl_logo_avatars.sql
\i supabase/migrations/0394_clear_nfl_logo_avatars.sql
do $$
begin
  perform mf_true((select avatar_url from league where id = '00000000-0000-0000-0000-00000000f001') is null, 'mf1 nfl crest cleared');
  perform mf_true((select avatar_url from league where id = '00000000-0000-0000-0000-00000000f002') = 'https://drip.example/avatars/a1.png', 'mf1 drip crest kept');
  perform mf_true((select avatar_url from league where id = '00000000-0000-0000-0000-00000000f003') like '%/ncaa/%', 'mf1 college crest kept');
  perform mf_true((select avatar_url from league_membership where id = '00000000-0000-0000-0000-00000000f101') is null, 'mf1 nfl team avatar cleared');
  perform mf_true((select avatar_url from league_membership where id = '00000000-0000-0000-0000-00000000f102') like 'https://sleepercdn.com/%', 'mf1 sleeper avatar kept');
  perform mf_true((select avatar_url from nfl_logo_avatar_backup where tbl = 'league' and row_id = '00000000-0000-0000-0000-00000000f001') like '%/nfl/500/kc.png', 'mf1 crest backed up');
  perform mf_true((select avatar_url from nfl_logo_avatar_backup where tbl = 'league_membership' and row_id = '00000000-0000-0000-0000-00000000f101') like '%/nfl/500/buf.png', 'mf1 team avatar backed up');
  perform mf_true((select count(*) from nfl_logo_avatar_backup where row_id::text like '00000000-0000-0000-0000-00000000f%') = 2, 'mf1 exactly the two NFL rows backed up, once');
end $$;

-- ── mf2..mf4. 0395 RPCs, as the caller ──
set role authenticated;
do $$
declare r jsonb;
begin
  -- mf2. signed out
  perform mf_as('');
  r := mark_free_state();
  perform mf_true(r ->> 'mine' is null, 'mf2 signed out: no preference');
  perform mf_true((r ->> 'global')::boolean = false, 'mf2 signed out: global off');
  r := set_my_mark_free(true);
  perform mf_true((r ->> 'ok')::boolean = false, 'mf2 signed out cannot save a preference');

  -- mf3. a player's own switch
  perform mf_as('02');
  perform mf_true(mark_free_state() ->> 'mine' is null, 'mf3 no preference until set');
  r := set_my_mark_free(true);
  perform mf_true((r ->> 'ok')::boolean, 'mf3 save on');
  perform mf_true((mark_free_state() ->> 'mine')::boolean = true, 'mf3 reads back on');
  perform mf_true((set_my_mark_free(null) ->> 'ok')::boolean = false, 'mf3 null refused');
  perform mf_as('01');
  perform mf_true(mark_free_state() ->> 'mine' is null, 'mf3 another account is untouched');

  -- mf4. the global switch
  perform mf_as('02');
  r := admin_set_global_mark_free(true);
  perform mf_true((r ->> 'ok')::boolean = false and r ->> 'error' = 'forbidden', 'mf4 non-admin refused');
  perform mf_true((mark_free_state() ->> 'global')::boolean = false, 'mf4 still off');
  perform mf_as('01');
  r := admin_set_global_mark_free(true);
  perform mf_true((r ->> 'ok')::boolean, 'mf4 admin turns it on');
  perform mf_as('');
  perform mf_true((mark_free_state() ->> 'global')::boolean = true, 'mf4 signed out sees it on');
  perform mf_as('02');
  perform mf_true((mark_free_state() ->> 'global')::boolean = true and (mark_free_state() ->> 'mine')::boolean = true, 'mf4 player sees global on, own pref kept');
  perform mf_as('01');
  perform mf_true((admin_set_global_mark_free(false) ->> 'ok')::boolean, 'mf4 admin turns it off');
  perform mf_true((mark_free_state() ->> 'global')::boolean = false, 'mf4 off again');
end $$;

-- ── mf5. the tables themselves are closed to a player ──
-- (Refused outright, or RLS with no policy: either way, no rows.)
do $$
declare n int;
begin
  perform mf_as('02');
  begin select count(*) into n from site_pref; exception when insufficient_privilege then n := 0; end;
  perform mf_true(n = 0, 'mf5 site_pref not readable directly');
  begin select count(*) into n from nfl_logo_avatar_backup; exception when insufficient_privilege then n := 0; end;
  perform mf_true(n = 0, 'mf5 backup not readable directly');
end $$;
reset role;

select 'ALL MARK-FREE PROBES PASS';
