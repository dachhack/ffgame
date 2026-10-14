-- 0496: A PRACTICE ROOM KEEPS ITS LEAGUE'S SHAPE.
--
-- 0442's backstop refuses taxi or devy spots on a redraft league. A practice
-- room (create_mock_from_league, 0282/0283) is always a redraft mock and
-- copies its source's roster_shape, so opening one from a keeper or dynasty
-- league with a taxi squad raised "a redraft league starts over every season"
-- and the room never opened. Found by practice-room-probes once the scratch
-- runner got past its stale invite-only probes (v0.707.6); unreachable
-- before that since 0442. The rule's premise is a second season, which a
-- mock never has, so the trigger skips mocks. Body copied from the live
-- definition (0442); one condition added.

create or replace function _league_college_is_classic() returns trigger
  language plpgsql as $$
begin
  if _league_has_college(new.settings_json)
     and coalesce(new.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    raise exception 'a league with college players must be classic (0365)';
  end if;
  -- 0371: the college calendar needs college players, and has no devy spots
  -- (devy is an NFL league's shelf).
  if coalesce(new.settings_json ->> 'calendar', 'nfl') = 'college' then
    if not _league_has_college(new.settings_json) then
      raise exception 'a college-calendar league needs college players turned on (0371)';
    end if;
    if coalesce((new.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0 then
      raise exception 'a college-calendar league has no devy spots (0371)';
    end if;
  end if;
  -- 0372/0440: a spot with a level belongs to a league where college players
  -- score on the NFL calendar. The college calendar or COLLEGE off would
  -- leave it meaningless; devy spots no longer would.
  if jsonb_path_exists(coalesce(new.settings_json -> 'roster_slots', '[]'::jsonb), '$[*] ? (exists(@.level))')
     and not (_league_has_college(new.settings_json)
              and coalesce(new.settings_json ->> 'calendar', 'nfl') = 'nfl') then
    raise exception 'NFL/college spots need college players on and the NFL calendar (0372)';
  end if;
  -- 0442: the seasons rule, as a backstop for every writer. Only a NEW
  -- violation raises — a league already in the state keeps working.
  -- 0496: not for a practice room. A mock never sees a second season, so
  -- "starts over every season" has nothing to protect, and a room opened from
  -- a keeper or dynasty league with a taxi squad copies that shape (0282).
  if _league_seasons_rule(new.settings_json) is not null
     and not coalesce(new.is_mock, false)
     and (tg_op = 'INSERT' or _league_seasons_rule(old.settings_json) is null) then
    raise exception '%', _league_seasons_rule(new.settings_json);
  end if;
  return new;
end $$;
