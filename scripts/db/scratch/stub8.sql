create table if not exists seat_player_rule (league_id uuid, roster_id int, positions text[], teams text[], teams_label text, min_exp int, max_exp int, primary key (league_id, roster_id));
create or replace function _nfl_team_norm(p text) returns text language sql immutable as $$
  select case upper(btrim(coalesce(p,''))) when 'LAR' then 'LA' when 'WSH' then 'WAS' when 'JAC' then 'JAX' when 'LVR' then 'LV' else upper(btrim(coalesce(p,''))) end $$;
create or replace function _seat_rule_text(r seat_player_rule) returns text language sql immutable as $$
  select concat_ws(' · ', array_to_string(r.positions, '/'), coalesce(r.teams_label, array_to_string(r.teams, '/'))) $$;
create table if not exists player_flag (league_id uuid, slug text, label text, primary key (league_id, slug));
