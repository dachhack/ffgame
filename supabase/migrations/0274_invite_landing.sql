-- 0274: THE INVITE LINK GETS A LANDING PAGE (v0.388.0).
--
-- Founder: "I'd love a landing page for the league invite links for external
-- viewing. So someone opens the link and gets a preview of the league and
-- settings before joining."
--
-- WHAT EXISTED. 0206 taught `league_by_invite` to answer signed-out callers so
-- the sign-in card could say "You're joining <name>" — name, season, provider,
-- avatar and (0207) the game mode. That is an identification, not a preview: it
-- tells a recruit WHICH league, never WHAT KIND of league. Everything they
-- would actually want to know before making an account — the scoring, the
-- lineup, the draft, the waiver rules, how many seats are left, who is already
-- in — lives in `league_preview`, which is gated on `auth.uid() is null` and on
-- the league being publicly LISTED. Both gates are right for a browse-the-board
-- stranger and wrong for someone holding an invite: the moment the preview is
-- wanted is the moment before there is an authenticated anybody, and a private
-- league that never lists itself is exactly the league whose invite gets sent.
--
-- THE CODE IS THE CREDENTIAL — the same reasoning 0206 set out, and the same
-- one `redeem_invite` and `native_join` already run on: holding the code is
-- what the commissioner handed out, so it is what this answers to.
--
-- WHAT THIS EXPOSES TO anon, stated plainly rather than waved at:
--   • the league's identity (name, season, avatar, provider, game mode, format,
--     continuity) and its listing blurb and dues, if it set any;
--   • its RULES — scoring, roster and lineup, waivers, trade review, position
--     caps, the contract book when it plays with one, and the draft's shape and
--     clock;
--   • its SEAT COUNT, and the TEAM NAMES with whether each is taken.
--   • Nothing else. No emails, no member names, no app_user_ids, no Sleeper
--     ids, no rosters of players, no ids beyond the league's own. A team name
--     is what the recruit sees on the board the moment they join anyway.
--
-- THE PAYLOAD IS COPIED FROM `league_preview` (0223, the live definition) so
-- the landing page and the browse card can never drift about what a rule is
-- called. The additions are `format` and `continuity` — the two facts that
-- change what the game IS, which a browse card of an already-chosen league
-- never had to say and a recruit deciding whether to join very much does.
create or replace function invite_preview(p_code text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare l league%rowtype; d draft%rowtype;
begin
  if p_code is null or length(trim(p_code)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no code');
  end if;
  select * into l from league where invite_code = upper(trim(p_code));
  if not found then
    -- Deliberately the same answer for a typo and for a code that has been
    -- rotated away: a probe must not be able to tell live codes from dead ones.
    return jsonb_build_object('ok', false, 'error', 'that invite link is not valid');
  end if;
  select * into d from draft where league_id = l.id;

  return jsonb_build_object(
    'ok', true,
    'league_id', l.id,
    'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
    'provider', l.provider,
    'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
    -- 0274's two additions: what KIND of game this is.
    'format', league_format(l.id),
    'continuity', league_continuity(l.id),
    'ppr', coalesce((l.settings_json ->> 'ppr')::numeric, 1),
    'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
    'roster', coalesce(l.settings_json -> 'roster_classic', '{}'::jsonb),
    'dues', (select li.dues from league_listing li where li.league_id = l.id),
    'blurb', (select li.blurb from league_listing li where li.league_id = l.id),
    'seats_total', (select count(*) from league_membership m where m.league_id = l.id),
    'seats_open',  (select count(*) from league_membership m
                     where m.league_id = l.id and m.app_user_id is null and not m.enrolled),
    'draft', case when d.league_id is null then null else jsonb_build_object(
      'status', d.status, 'mode', d.mode, 'rounds', d.rounds,
      'pick_seconds', d.pick_seconds,
      'budget', case when d.mode = 'auction' then d.budget end,
      'night', case when d.night_start_min is not null then jsonb_build_object(
        'start_min', d.night_start_min, 'end_min', d.night_end_min) end) end,
    'rules', jsonb_build_object(
      'waiver_mode', coalesce(l.settings_json ->> 'waiver_mode', 'rolling'),
      'faab_budget', l.settings_json -> 'faab_budget',
      'trade_review', coalesce(l.settings_json ->> 'trade_review', 'none'),
      'pos_caps', l.settings_json -> 'pos_caps',
      'live_buffs', not league_powerups_off(l.id)),
    'contract_rules', case when contracts_on(l.id) then jsonb_build_object(
      'salary_cap', league_salary_cap(l.id),
      'years_max', contract_years_max(l.id),
      'dead_pct', contract_dead_pct(l.id),
      'retention', salary_retention_on(l.id),
      'cap_trading', cap_trading_on(l.id),
      'ir_relief', ir_cap_relief_on(l.id),
      'tag_raise_pct', tag_raise_pct(l.id),
      'ext_discount_pct', ext_discount_pct(l.id),
      'rfa', rfa_on(l.id)) end,
    'scoring', l.settings_json -> 'scoring',
    -- TEAM NAMES AND NOTHING ATTACHED TO THEM. No owner, no email, no user id —
    -- the seat number and whether somebody is sitting in it.
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team_name', m.team_name,
        'taken', m.app_user_id is not null and m.enrolled)
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = l.id));
end $$;
grant execute on function invite_preview(text) to anon, authenticated;
