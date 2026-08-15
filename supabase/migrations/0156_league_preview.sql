-- 0156: LOOK BEFORE YOU JOIN — a full preview of a posted league, readable
-- before taking a seat.
--
-- The board (0123) sells a league in one line; JOIN was one tap that took a
-- seat. The founder's rule: only committed users take a spot — so a browsing
-- user gets the whole picture first. league_preview answers for any league
-- with an OPEN listing (members and the commissioner may also read their
-- own): identity, seats, the draft's shape (mode, rounds, clock, quiet
-- hours), the house rules (waivers, trade review, position caps, the
-- real-time power-up switch), non-default scoring, and the seat map —
-- team names + taken/open, never emails or identities.

create or replace function league_preview(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l league%rowtype; d draft%rowtype; listed boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into l from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  listed := exists (select 1 from league_listing li where li.league_id = p_league_id and li.open);
  if not (listed or is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not open for browsing');
  end if;
  select * into d from draft where league_id = p_league_id;

  return jsonb_build_object(
    'ok', true,
    'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
    'blurb', (select li.blurb from league_listing li where li.league_id = p_league_id),
    'seats_total', (select count(*) from league_membership m where m.league_id = p_league_id),
    'seats_open',  (select count(*) from league_membership m
                     where m.league_id = p_league_id and m.app_user_id is null and not m.enrolled),
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
      'live_buffs', coalesce(l.settings_json ->> 'live_buffs', 'on') <> 'off'),
    'scoring', l.settings_json -> 'scoring',
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team_name', m.team_name,
        'taken', m.app_user_id is not null and m.enrolled)
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id));
end $$;

grant execute on function league_preview(uuid) to authenticated;
