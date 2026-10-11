-- stub10: what 0474 (the commissioner fixes a contest week) leans on from the
-- classic console's migrations, which this chain doesn't load: the pool and
-- roster tables _txn_player / league_player_adjustments read, the adjustment
-- and lineup-edit tables, the house chat line, and _txn_team.
create table if not exists league_pool (league_id uuid, slug text, full_name text, pos text, team text, rank int);
create table if not exists native_roster (league_id uuid, slug text, roster_id int);
create table if not exists player_adjustment (
  league_id uuid not null, week int not null, slug text not null, points numeric not null, note text, set_by uuid, set_at timestamptz not null default now(),
  primary key (league_id, week, slug));
create table if not exists lineup_edit_log (
  id bigint generated always as identity primary key, league_id uuid not null, week int not null, roster_id int not null,
  before jsonb not null, after jsonb not null, note text not null, set_by uuid, set_at timestamptz not null default now());
create table if not exists league_message (id bigint generated always as identity primary key, league_id uuid, author_id uuid, kind text, body text, txn jsonb, created_at timestamptz default now());
create or replace function _chat_house(p_league_id uuid, p_body text, p_txn jsonb) returns void language sql as $$
  insert into league_message (league_id, author_id, kind, body, txn) values (p_league_id, null, 'txn', p_body, p_txn);
$$;
create or replace function _txn_team(p_league_id uuid, p_roster int) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(team_name, '') from league_membership
                    where league_id = p_league_id and sleeper_roster_id = p_roster),
                  'Team ' || p_roster);
$$;
