-- 0243 — THE INVITE PANEL LEARNS WHICH GAME.
--
-- Founder: "let's add the classic link to the commish invite area. Classic
-- league invites should get you there."
--
-- v0.357.3 gave recruiting a `?game=classic` link and v0.358.0 gave it a
-- classic board to land on, but the commissioner had to REMEMBER the URL. It
-- belongs beside the invite link, and for a classic league it has to point at
-- the classic game without anyone choosing.
--
-- WHY THIS IS THE ONE PLACE TO PUT IT. Four surfaces build invite links — the
-- web league panel, the app's, MY TEAM's recruit sheet and the commissioner's
-- tools — and every one of them already calls league_invite() and nothing
-- else. Adding the mode here hands it to all four with no second round trip
-- and no per-caller wiring.
--
-- NOTE WHAT IS *NOT* CHANGING: the invite link itself. `?live=1&code=…` goes
-- straight to sign-in and redeem, never to the demo, and the join screen has
-- asked the league what it plays since 0206/0207 (see leagueTagline). A game
-- hint on that link would be dead weight. What the commissioner lacks is the
-- OTHER link — the one for a recruit who wants to look before committing —
-- and that one lands on the demo, where the hint is the whole difference.
--
-- Respun from the 0123 body; only the returned object grows.
create or replace function league_invite(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id) or exists (
    select 1 from league_membership m
     where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
  )) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  return jsonb_build_object('ok', true, 'invite_code', lg.invite_code, 'name', lg.name,
    -- 0243: which game a recruit should be shown. Unset means drip, matching
    -- league_game_mode, the resolver and the board — a league that never chose
    -- is a drip league everywhere else.
    'game_mode', coalesce(lg.settings_json ->> 'game_mode', 'drip'),
    'seats_open', (select count(*) from league_membership m
                    where m.league_id = lg.id and m.app_user_id is null and not m.enrolled));
end $$;
