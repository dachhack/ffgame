create extension if not exists pgcrypto;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true),'')::uuid $$;
create function is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('t.admin', true), '') = '1' $$;
create table app_user (id uuid primary key, email text, display_name text, features jsonb not null default '{}'::jsonb);
create function gen_invite_code() returns text language sql volatile as $$ select upper(substring(replace(gen_random_uuid()::text, '-', '') for 8)); $$;
create table league (id uuid primary key default gen_random_uuid(), sleeper_league_id text not null, season text not null, name text, settings_json jsonb,
  kind text not null default 'league', contest_week int, kdst_mode text not null default 'off', provider text not null default 'sleeper',
  lineup_policy text not null default 'best_lineup', commissioner_id uuid, avatar_url text, invite_code text unique default gen_invite_code(),
  created_at timestamptz default now(), unique (sleeper_league_id, season));
create table league_commish (league_id uuid, app_user_id uuid);
create function is_league_commish(l uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from league where id = l and commissioner_id = auth.uid()) $$;
create table league_membership (id uuid primary key default gen_random_uuid(), league_id uuid, sleeper_roster_id int not null, sleeper_owner_id text,
  app_user_id uuid, enrolled boolean not null default false, team_name text, controller text not null default 'human', unique (league_id, sleeper_roster_id));
create function is_league_member(l uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_membership where league_id = l and app_user_id = auth.uid() and enrolled) $$;
create table nfl_slate (season text, week int, home text, away text, kickoff timestamptz);
create table pod_salary (season text, week int, slug text, name text, pos text, team text, salary int, proj numeric, primary key (season, week, slug));
create table sleeper_lineup (league_id uuid, week int, roster_id int, starters_json jsonb, primary key (league_id, week, roster_id));
create type matchup_status as enum ('scheduled','locked','live','final');
create table matchup (id uuid primary key default gen_random_uuid(), league_id uuid, week int, sleeper_matchup_id text, home_roster_id int, away_roster_id int,
  status matchup_status default 'scheduled', lock_at timestamptz, home_final numeric, away_final numeric, unique (league_id, week, home_roster_id, away_roster_id));
create table matchup_state (matchup_id uuid, game_window text, home_score numeric, away_score numeric, slot_scores jsonb, primary key (matchup_id, game_window));
create table league_listing (league_id uuid primary key references league(id) on delete cascade, created_by uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), blurb text not null default '', open boolean not null default true, dues text);
create table draft (league_id uuid, status text, mode text, rounds int, pick_seconds int, budget int, night_start_min int, night_end_min int);
create function _league_identity(l uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function league_powerups_off(l uuid) returns boolean language sql as $$ select false $$;
create function contracts_on(l uuid) returns boolean language sql as $$ select false $$;
create function league_salary_cap(l uuid) returns int language sql as $$ select 0 $$;
create function contract_years_max(l uuid) returns int language sql as $$ select 0 $$;
create function contract_dead_pct(l uuid) returns int language sql as $$ select 0 $$;
create function salary_retention_on(l uuid) returns boolean language sql as $$ select false $$;
create function cap_trading_on(l uuid) returns boolean language sql as $$ select false $$;
create function ir_cap_relief_on(l uuid) returns boolean language sql as $$ select false $$;
create function tag_raise_pct(l uuid) returns int language sql as $$ select 0 $$;
create function ext_discount_pct(l uuid) returns int language sql as $$ select 0 $$;
create function rfa_on(l uuid) returns boolean language sql as $$ select false $$;
create function native_join(code text, t text) returns jsonb language sql as $$ select '{"native":true}'::jsonb $$;
insert into app_user (id, email, display_name) values ('00000000-0000-0000-0000-00000000000a','boss@x.com',null),('00000000-0000-0000-0000-00000000000b','tess@y.com','Tess'),('00000000-0000-0000-0000-00000000000c','eve@z.com',null);
insert into nfl_slate values ('2026',6,'NYJ','BUF', now() + interval '3 hours'),('2026',6,'PHI','DAL', now() + interval '2 days'),('2026',6,'SF','KC', now() + interval '2 days');
insert into pod_salary values
 ('2026',6,'allen','Josh Allen','QB','BUF',9000,24),('2026',6,'hurts','Jalen Hurts','QB','PHI',7000,22),
 ('2026',6,'barkley','Saquon Barkley','RB','PHI',7000,18),('2026',6,'mccaffrey','C McCaffrey','RB','SF',8800,20),('2026',6,'hall','Breece Hall','RB','NYJ',6000,14),
 ('2026',6,'lamb','CeeDee Lamb','WR','DAL',6500,19),('2026',6,'brown','AJ Brown','WR','PHI',5500,16),('2026',6,'kelce-wr','Rashee Rice','WR','KC',5200,12),('2026',6,'wilson','G Wilson','WR','NYJ',6100,14),
 ('2026',6,'kittle','George Kittle','TE','SF',5000,11),('2026',6,'phi-k','PHI Kicker','K','PHI',3000,8),('2026',6,'sf-dst','SF D/ST','DEF','SF',3100,7);
