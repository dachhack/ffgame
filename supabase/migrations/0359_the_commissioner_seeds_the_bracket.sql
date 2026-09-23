-- ═══════════════════════════════════════════════════════════════════════════
-- 0359 · THE COMMISSIONER SEEDS THE BRACKET
--
-- Item 7 of the commissioner list: a playoff seed override. The machinery has
-- existed since the bracket did. generate_playoffs takes a seed list, and the
-- web console's ↑↓ fed it. But nobody was told, nothing said why, the console
-- compared the order against the plain standings rather than the seeding the
-- league actually uses (0215 puts division winners first), and the app
-- couldn't do it at all.
--
-- This is the commissioner's door onto the same generator:
--   • `league_default_seeds` is the order the league would seed itself
--     (league_seed_standings, every team), so a console can say "custom";
--   • `commish_seed_playoffs` builds the bracket from the commissioner's order.
--     When that order differs from the default's top N, it needs a reason, and
--     the league gets one chat line with the seeds and the reason. The bracket
--     records `by_hand`.
-- Everything else is generate_playoffs_bracket's, unchanged. It refuses once
-- the playoffs are underway, checks the list names N different league teams,
-- and replaces any bracket that hasn't started. Lineups saved for the old
-- round 1 go with its games, so the answer counts them (`lineups_cleared`).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function league_default_seeds(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'seeds', coalesce((
    select jsonb_agg((e ->> 'roster_id')::int order by ord)
      from jsonb_array_elements(league_seed_standings(p_league_id)) with ordinality t(e, ord)), '[]'::jsonb));
end $$;
grant execute on function league_default_seeds(uuid) to authenticated;

create or replace function commish_seed_playoffs(p_league_id uuid, p_seeds jsonb, p_note text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := league_playoff_teams(p_league_id); why text := nullif(btrim(coalesce(p_note, '')), '');
        dflt jsonb; by_hand boolean; cleared int; r jsonb; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if n = 0 then
    return jsonb_build_object('ok', false, 'error', 'this league plays no playoffs — turn them on first');
  end if;
  if jsonb_typeof(p_seeds) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'seeds must be a list of teams');
  end if;
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into dflt from (
    select (e ->> 'roster_id')::int x, ord
      from jsonb_array_elements(league_seed_standings(p_league_id)) with ordinality t(e, ord)
     where ord <= n) s;
  by_hand := p_seeds <> dflt;
  if by_hand and why is null then
    return jsonb_build_object('ok', false, 'error', 'say why — seeding against the standings is posted to the league with your reason');
  end if;
  select count(*) into cleared from sealed_pick sp join matchup m on m.id = sp.matchup_id
   where m.league_id = p_league_id and m.is_playoff and sp.player_slug is not null;
  r := generate_playoffs_bracket(p_league_id, p_seeds, false);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  update league set settings_json = jsonb_set(settings_json, '{playoff_bracket,by_hand}', to_jsonb(by_hand))
   where id = p_league_id and settings_json ? 'playoff_bracket' and settings_json -> 'playoff_bracket' <> 'null'::jsonb;
  if by_hand then
    select string_agg('#' || ord || ' ' || _txn_team(p_league_id, v::int), ' · ' order by ord) into line
      from jsonb_array_elements_text(p_seeds) with ordinality t(v, ord);
    line := '🏆 The commissioner seeded the playoffs: ' || line || ' — ' || left(why, 200);
    perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'seeds'));
  end if;
  return r || jsonb_build_object('by_hand', by_hand, 'lineups_cleared', cleared, 'note', line);
end $$;
grant execute on function commish_seed_playoffs(uuid, jsonb, text) to authenticated;
