-- 0206: SHOW THE LEAGUE BEFORE THE SIGN-UP.
--
-- Founder: "If you go in with a code, it should show you the league you are
-- joining before the sign up action."
--
-- WHY IT DIDN'T. `league_by_invite` has existed since 0002 and its own comment
-- says what it is for — 'Look up a league by code so the client can show
-- "You're joining <name>" before the user commits'. But it was granted to
-- `authenticated` only, and the moment the preview is WANTED is the moment
-- before there is an authenticated anybody. So the join screen could only say
-- "Join your league." in the abstract, to someone who had just been handed a
-- link by a friend and had no way to tell which league it was for — or whether
-- the code was live at all — until after making an account.
--
-- WHAT THIS EXPOSES TO anon, stated plainly rather than waved at:
--   • the league's NAME, SEASON, PROVIDER and AVATAR — to a caller who already
--     holds the invite code.
--   • Nothing else. No rosters, no members, no ids beyond the league's own.
--
-- THE CODE IS THE CREDENTIAL. It is what `redeem_invite` and `native_join`
-- already accept as proof of invitation, and a holder of it can (after signing
-- up) simply join and read the name anyway. Showing it one screen earlier
-- grants no access that the code did not already grant.
--
-- ENUMERATION, since that is the fair question. `gen_invite_code()` (0002)
-- makes 8 hex characters — 4.3 billion values — and a hit returns a league
-- name. That is a poor prize for a very large amount of guessing, it is
-- rate-limited by the API gateway like every other anon call, and the same
-- surface is already reachable by anyone willing to create a free account.
-- Judged acceptable for the value of a recruit knowing where they are going.
--
-- Return type changes (avatar_url) ⇒ drop first, exactly as 0064 had to.

drop function if exists league_by_invite(text);
create function league_by_invite(code text)
  returns table (league_id uuid, name text, season text, provider text, avatar_url text)
  language sql stable security definer set search_path = public as $$
  select id, name, season, provider, avatar_url from league where invite_code = upper(trim(code));
$$;
-- BOTH roles. `authenticated` keeps the existing callers working (the redeem
-- form previews the code it is about to spend); `anon` is the new half.
grant execute on function league_by_invite(text) to authenticated, anon;
