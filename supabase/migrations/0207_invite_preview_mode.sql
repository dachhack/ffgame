-- 0207: the invite preview says WHICH GAME the league plays.
--
-- Founder, looking at a chat unfurl of an invite link: "If the league being
-- advertised is a classic league, we need a different tagline."
--
-- WHAT CANNOT BE FIXED HERE, said plainly so nobody looks for it later: the
-- UNFURL is static. dripfantasy.com is GitHub Pages (.github/workflows/
-- deploy.yml) — a pure static host that returns the same index.html for every
-- query string, and a link unfurler reads meta tags without running JavaScript.
-- So `?code=A1B2C3D4` cannot carry its own og:description without putting a
-- server in front of the site. index.html's copy is instead made TRUE OF BOTH
-- modes in the same change; a per-league unfurl is a hosting decision, not a
-- code one.
--
-- WHAT CAN: the app's own join screen, which does run JavaScript and does know
-- the code. 0206 taught `league_by_invite` to answer signed-out callers; this
-- adds the one field that lets the card say "Classic — standard scoring, open
-- lineups" instead of a drip pitch to someone joining a classic league.
--
-- game_mode lives in settings_json (0157) and defaults to 'drip' when unset,
-- which is the same coalesce every other reader of it uses — league_game_mode,
-- the resolver, and the board all say 'drip' for a league that never chose.
--
-- Return type changes ⇒ drop first, as in 0064 and 0206.

drop function if exists league_by_invite(text);
create function league_by_invite(code text)
  returns table (league_id uuid, name text, season text, provider text, avatar_url text, game_mode text)
  language sql stable security definer set search_path = public as $$
  select id, name, season, provider, avatar_url,
         coalesce(settings_json ->> 'game_mode', 'drip')
  from league where invite_code = upper(trim(code));
$$;
grant execute on function league_by_invite(text) to authenticated, anon;
