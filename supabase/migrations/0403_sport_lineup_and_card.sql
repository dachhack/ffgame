-- 0403 — A SPORT LEAGUE SHAPES ITS OWN LINEUP; A SPORT PLAYER HAS A CARD (v0.570.0).
--
-- set_sport_lineup is set_league_classic_slots for a daily sport: the same
-- guards (commissioner, classic, before the draft, at most 20 starters),
-- the positions of the league's sport rather than the NFL's, and
-- _sync_classic_rounds afterwards so the draft drafts the roster the
-- league is shaped for. Filters, best ball and the per-spot rules stay
-- football-only for now.
--
-- sport_positions is the SportDef's position list restated for the
-- database; scripts/check-sports.mjs pins the two.
--
-- sport_player_card is what a player card reads for a sport key: the
-- directory row and the last ten games' lines.
--
-- Undo: drop function if exists set_sport_lineup(uuid, jsonb), sport_positions(text),
--       sport_player_card(text);

create or replace function sport_positions(p_sport text) returns text[]
  language sql immutable as $$
  select case p_sport
    when 'nba'  then array['PG','SG','SF','PF','C']
    when 'wnba' then array['G','F','C']
    when 'nhl'  then array['C','LW','RW','D','G']
    when 'mlb'  then array['C','1B','2B','3B','SS','OF','DH','SP','RP']
    else array[]::text[] end;
$$;

create or replace function set_sport_lineup(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare sp text; allowed text[]; n int; i int; spot jsonb; ps jsonb; p text; seen text[]; cleaned jsonb := '[]'::jsonb; lbl text; dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  sp := league_sport(p_league_id);
  if sp = 'nfl' then return jsonb_build_object('ok', false, 'error', 'not a sport league'); end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the lineup freezes when the draft starts');
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    return jsonb_build_object('ok', false, 'error', 'a lineup needs at least one spot');
  end if;
  n := jsonb_array_length(p_slots);
  if n > 20 then return jsonb_build_object('ok', false, 'error', 'lineups cap at 20 starters'); end if;
  allowed := sport_positions(sp);
  for i in 0 .. n - 1 loop
    spot := p_slots -> i;
    if jsonb_typeof(spot) <> 'object' or jsonb_typeof(spot -> 'pos') <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'each spot needs an eligible-position list');
    end if;
    seen := array[]::text[];
    for ps in select * from jsonb_array_elements(spot -> 'pos') loop
      p := upper(trim(both '"' from ps::text));
      if not (p = any (allowed)) then return jsonb_build_object('ok', false, 'error', 'unknown ' || upper(sp) || ' position: ' || p); end if;
      if not (p = any (seen)) then seen := seen || p; end if;
    end loop;
    if coalesce(array_length(seen, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'error', 'each spot needs at least one eligible position');
    end if;
    lbl := nullif(left(regexp_replace(coalesce(spot ->> 'label', ''), '[^A-Za-z0-9 /_-]', '', 'g'), 12), '');
    cleaned := cleaned || jsonb_build_object('pos', to_jsonb(seen), 'label', coalesce(lbl, array_to_string(seen, '/')));
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('roster_slots', cleaned)
   where id = p_league_id;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n,
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;
grant execute on function set_sport_lineup(uuid, jsonb) to authenticated;

create or replace function sport_player_card(p_key text)
  returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'player', (select to_jsonb(p) - 'alt_ids' from sport_player p where p.player_key = p_key),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', s.game_id, 'game_date', g.game_date, 'status', g.status,
        'team', s.team, 'opp', case when g.home = s.team then g.away else g.home end,
        'home', g.home = s.team, 'away_score', g.away_score, 'home_score', g.home_score,
        'played', s.played, 'line', s.line) order by g.game_date desc)
      from (
        select s.* from game_stat_line s
         where s.player_key = p_key
         order by s.season desc, s.game_id desc limit 10
      ) s
      join sport_game g on g.sport = s.sport and g.season = s.season and g.game_id = s.game_id), '[]'::jsonb))
  where auth.uid() is not null;
$$;
grant execute on function sport_player_card(text) to authenticated;
