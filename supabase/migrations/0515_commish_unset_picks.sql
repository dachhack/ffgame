-- 0515 · THE COMMISSIONER CAN UNSET PICKS (v0.730.31)
--
-- Founder (commissioner of Monday Showdown, not playing): "Can I have the
-- commish option to unset picks". SET A SQUAD (0474) already offered
-- "— empty —" per spot, but _contest_squad_check refused any open spot
-- ("fill every spot — QB is empty"), so the commissioner could only swap
-- players, never take one out. For the commissioner's fix (p_member false)
-- an empty spot is now allowed, and the minimum spend waits until every spot
-- is filled. The budget, each spot's rules and the member's own save are
-- unchanged: a member still fills every spot. A squad left wholly empty is
-- still a saved squad, so the worker's no-show build doesn't refill it.

create or replace function _contest_squad_check(lg league, p_roster int, p_week int, p_slots jsonb, p_season text, p_old jsonb, p_member boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare spots jsonb; n int; i int; slot text; pslug text; ps pod_salary; bad text;
        spent int := 0; holes int := 0; seen text[] := '{}'; lineup jsonb := '[]'::jsonb; budget int; floor_ int;
begin
  if jsonb_typeof(p_slots) <> 'object' then return jsonb_build_object('error', 'a squad is one player per spot'); end if;
  spots := _contest_slots(lg);
  n := jsonb_array_length(spots);
  budget := _contest_budget(lg);
  floor_ := _contest_min_spend(lg);
  select string_agg(k, ', ') into bad from jsonb_object_keys(p_slots) k where k !~ '^S[0-9]+$' or substr(k, 2)::int < 1 or substr(k, 2)::int > n;
  if bad is not null then return jsonb_build_object('error', 'unknown spot: ' || bad); end if;
  for i in 1..n loop
    slot := 'S' || i;
    pslug := nullif(btrim(coalesce(p_slots ->> slot, '')), '');
    if pslug is null and exists (select 1 from contest_play c where c.league_id = lg.id and c.week = p_week and c.roster_id = p_roster and c.play_id = 'ghost' and c.slot = ('S' || i)) then
      continue;   -- THE GHOST (0484): the phantom fills the spot; no row, the scorer banks it
    end if;
    -- UNSET (0515): the commissioner may leave a spot open; the member fills it.
    if pslug is null and not p_member then holes := holes + 1; continue; end if;
    if pslug is null then
      return jsonb_build_object('error', 'fill every spot — ' || coalesce(nullif(spots -> (i - 1) ->> 'label', ''), array_to_string(array(select upper(x) from jsonb_array_elements_text(spots -> (i - 1) -> 'pos') x), '/')) || ' is empty');
    end if;
    if pslug = any (seen) then return jsonb_build_object('error', 'a player can only fill one spot'); end if;
    seen := array_append(seen, pslug);
    select * into ps from pod_salary where season = p_season and week = p_week and pod_salary.slug = pslug;
    if ps.slug is null then return jsonb_build_object('error', 'a pick is not on this week''s board'); end if;
    -- RULED OUT (0467): a player the injury report has at O or IR is not a
    -- new pick — the DFS rule. One already in the saved squad may stay (and
    -- be swapped out until his game locks). The commissioner's fix is after
    -- the fact: whoever played, played.
    if p_member and exists (select 1 from injury_status ist where ist.player_slug = pslug and upper(ist.status) in ('O', 'IR'))
       and not exists (select 1 from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o where o ->> 'player_slug' = pslug) then
      return jsonb_build_object('error', ps.name || ' is ruled out this week — pick someone else');
    end if;
    bad := _contest_spot_error(lg, p_roster, spots -> (i - 1), slot, ps);
    if bad is not null then return jsonb_build_object('error', bad); end if;
    spent := spent + ps.salary;
    lineup := lineup || jsonb_build_object('slot', slot, 'sleeper_id', null, 'player_slug', pslug, 'pos', upper(ps.pos));
  end loop;
  if budget > 0 and spent > budget then return jsonb_build_object('error', 'over the $' || to_char(budget, 'FM999,999,999') || ' budget by $' || to_char(spent - budget, 'FM999,999,999')); end if;
  -- THE FLOOR (0469): golf's constraint — spend at least this much.
  -- A squad the commissioner left with open spots isn't held to it yet (0515).
  if floor_ > 0 and spent < floor_ and holes = 0 then return jsonb_build_object('error', 'under the $' || to_char(floor_, 'FM999,999,999') || ' minimum spend by $' || to_char(floor_ - spent, 'FM999,999,999')); end if;
  return jsonb_build_object('lineup', lineup, 'spent', spent, 'budget', budget, 'min_spend', floor_);
end $$;

