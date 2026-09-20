-- 0309: WHEN DID THE DOOR OPEN? (v0.433.0)
--
-- Founder: "We shouldn't be working the wire at times not in line with what
-- the league has."
--
-- The seat wire (server/src/seatWire.js) chose its instrument by ONE thing:
-- a player inside his waived_until hold was a claim, anyone else an add. The
-- league's own clock never entered it. 0288 settled what a manager sees at
-- the pool: a player free agency cannot reach RIGHT NOW — the window shut,
-- or a league with no free agency at all — is a claim, hold or no hold, and
-- the claim clears at the league's run (0291). The sweep never learned that.
-- In a FAAB league with free agency off it called add_free_agent on every
-- unheld player, was told "put in a waiver claim instead", and filed
-- nothing, every hour, all season. In a windowed league it added only when
-- its hour happened to fall inside the window, and was refused otherwise.
--
-- Two readings of the league's clock, both already defined here, are what
-- the sweep needs: fa_window_open() — may an add land this minute — and the
-- one this migration adds: WHEN DID IT LAST BECOME TRUE. The second is for
-- manners. A first-come add is a race, and a worker that wakes on the hour
-- is a faster runner than any manager; the sweep gives every human the first
-- hour on a player who has JUST become addable — his hold cleared, or the
-- window opened — and takes him on the next sweep if he is still there.
-- Claims need no such courtesy: they settle at the run, against everyone.
--
-- Same search space fa_opens_at (0289) walks forward: a window can only
-- open at fa_start_min, and the after-waivers gate can only lift at
-- waiver_clear_min, so those two minutes across the last two days are every
-- instant the door could have swung open. Null when it is shut now. When no
-- boundary lies in the last two days the door has stood open at least that
-- long, and that instant is returned — "at least this long" is all a caller
-- measuring a grace period needs.
create or replace function fa_open_since(p_league_id uuid) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare fs int; cm int; day_local timestamp; best timestamptz;
begin
  if not fa_window_open_at(p_league_id, now()) then return null; end if;
  select nullif(settings_json ->> 'fa_start_min', '')::int,
         coalesce(nullif(settings_json ->> 'waiver_clear_min', '')::int, 180)
    into fs, cm from league where id = p_league_id;
  day_local := date_trunc('day', now() at time zone 'America/New_York');
  -- The latest boundary at which the door swung open: open at t, shut the
  -- minute before. Local wall minutes converted through the zone, so a DST
  -- weekend moves with the clocks, exactly as 0289 and 0291 do it.
  select max(c.t) into best from (
    select (day_local + make_interval(days => i, mins => m)) at time zone 'America/New_York' as t
    from generate_series(-2, 0) i, unnest(array[fs, cm]) m
    where m is not null
  ) c
  where c.t <= now()
    and fa_window_open_at(p_league_id, c.t)
    and not fa_window_open_at(p_league_id, c.t - interval '1 minute');
  return coalesce(best, now() - interval '2 days');
end $$;
grant execute on function fa_open_since(uuid) to authenticated;
