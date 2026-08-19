-- 0203: THE DRAFT BOARD READS A LIVE ADP.
--
-- Founder, choosing between a live ESPN feed and the baked consensus blend:
-- "let's do 1" — the live one.
--
-- 0202 built the table and deliberately left `adp` null, because re-pointing
-- the board onto another market is a decision about the product rather than a
-- data refresh: ESPN's ADP is ESPN's draft rooms, and against the baked
-- consensus (`adp2026.ts`, FantasyPros + Sleeper + FFC) it sits about 13 picks
-- away at the median. That decision is now made, so the poller fills the column
-- and this migration is the read side.
--
-- ONE CALL, BOTH NUMBERS. The clients already fetch ownership once per league
-- to sort by it (v0.302.0); ADP travels the same road rather than opening a
-- second one, and `player_ownership` stays exactly as 0202 left it so nothing
-- that only wants ownership has to change.
--
-- THE BAKE STAYS UNDERNEATH. `league_market` returns only what the feed knows,
-- and the client overlays it on `ADP_2026` rather than replacing it: a feed
-- that has never run, has gone stale, or simply doesn't price a player leaves
-- the consensus number showing. A draft board that blanked 200 rows because a
-- poll failed would be a worse answer than a slightly older one.

/** The live market for a league's screens: slug → adp, and slug → owned %.
 *  Empty maps when the feed is stale, which is the client's cue to keep using
 *  the baked consensus. League-scoped for the member check only; the numbers
 *  are platform-wide because a market is. */
create or replace function league_market(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare fresh boolean;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  fresh := market_is_fresh();
  return jsonb_build_object(
    'ok', true,
    'fresh', fresh,
    'as_of', (select max(updated_at) from player_market),
    'source', (select source from player_market order by updated_at desc limit 1),
    -- ADP rides the same freshness gate as ownership: they come from one pull,
    -- so one of them being current and the other not is not a state that exists.
    'adp', case when fresh then coalesce(
      (select jsonb_object_agg(slug, adp) from player_market where adp is not null), '{}'::jsonb)
      else '{}'::jsonb end,
    'own', case when fresh then coalesce(
      (select jsonb_object_agg(slug, owned_pct) from player_market where owned_pct is not null), '{}'::jsonb)
      else '{}'::jsonb end);
end $$;
grant execute on function league_market(uuid) to authenticated;
