-- 0306: BROWSE-AS SEES THEIR TEAM (v0.431.1).
--
-- Founder: "I need to check if Mooney can put a player in IR. If I use the
-- view as admin feature, it's still viewing my team as me instead of viewing
-- Mooney's team as Mooney."
--
-- The 0125 regression, again, one screen over. Browse-as (0108/0109/0149)
-- reads the VIEWED user's data through admin-gated twins wherever a
-- player-path RPC keys on auth.uid(). MY TEAM's whole desk — the roster with
-- its IR/taxi places, the FAAB, the claims, the header's name and crest —
-- comes from native_team_state(league), which keys on auth.uid() and had no
-- twin. So "BROWSING AS mooney" on MY TEAM drew the banner and then the
-- ADMIN's own seat in that league (the founder's, "dachhack"), and the one
-- question browse-as exists to answer — what does THIS manager see, can
-- they stash this player — was unanswerable.
--
-- The body moves, verbatim, into _native_team_state_for(league, uid,
-- commish) with `p_uid` where auth.uid() read and `p_commish` where the
-- is_commish flag was computed. Two callers:
--   · native_team_state(league) — the same gate, auth.uid(), and the same
--     is_commish (commissioner or admin) it has always answered; nothing a
--     manager sees moves;
--   · admin_user_native_team_state(user, league) — admin-only; the viewed
--     user's seat, and is_commish as THEY would see it (commissioner of the
--     league or not — an admin browsing is not made a commissioner of what
--     they browse, that is the point of browsing).
-- Read-only by construction: it returns a view; the desk's writes still run
-- as the admin, and the client refuses them under browse-as (as every other
-- browse-as screen does), because set_roster_spot on the admin's own seat is
-- exactly the wrong thing to do with a tap meant for Mooney's.

create or replace function _native_team_state_for(p_league_id uuid, p_uid uuid, p_commish boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_roster int; d draft%rowtype; mode text;
begin
  select sleeper_roster_id into my_roster from league_membership
    where league_id = p_league_id and app_user_id = p_uid and enrolled
    order by sleeper_roster_id limit 1;
  select * into d from draft where league_id = p_league_id;
  mode := league_waiver_mode(p_league_id);
  return jsonb_build_object(
    'my_roster_id', my_roster,
    -- 0272: the week the guillotine took THIS seat (null while it lives) —
    -- the team desk's own copy, so the wire can say why it is closed.
    'eliminated', (select eliminated_week from league_membership
      where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_team', (select team_name from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_avatar', (select avatar_url from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'league_avatar', (select avatar_url from league l where l.id = p_league_id),
    'is_commish', p_commish,
    'draft_status', coalesce(d.status, 'none'),
    'roster_cap', d.rounds,
    -- ACTIVE SEATS (0199): what an ADD is actually bounded by. `roster_cap` is
    -- still the whole roster, stash places included, because that is what the
    -- "MY ROSTER (n/m)" line counts.
    'active_seats', league_active_seats(p_league_id),
    'active_held', case when my_roster is not null then
        (select count(*) from native_roster nr where nr.league_id = p_league_id
           and nr.roster_id = my_roster and nr.spot = 'active') end,
    'pos_caps', league_pos_caps(p_league_id),
    'waiver_mode', mode,
    'trade_review', league_trade_review(p_league_id),
    'my_faab', case when mode = 'faab' and my_roster is not null then member_faab(p_league_id, my_roster) end,
    'roster_issue', case when my_roster is not null then roster_illegal_reason(p_league_id, my_roster) end,
    'fa_open', fa_window_open(p_league_id),
    'fa_start_min', (select nullif(l.settings_json ->> 'fa_start_min', '')::int from league l where l.id = p_league_id),
    'fa_end_min', (select nullif(l.settings_json ->> 'fa_end_min', '')::int from league l where l.id = p_league_id),
    'waiver_clear_min', (select nullif(l.settings_json ->> 'waiver_clear_min', '')::int from league l where l.id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(l.settings_json ->> 'waiver_hold_days', '')::int, 1) from league l where l.id = p_league_id),
    'next_waiver_run', next_waiver_run(p_league_id),   -- 0291
    'waiver_clear_dow', (select l.settings_json -> 'waiver_clear_dow' from league l where l.id = p_league_id),
    'server_now', now(),
    'waiver_order', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'priority', m.waiver_priority,
        'avatar', m.avatar_url,
        'faab', case when mode = 'faab' then member_faab(p_league_id, m.sleeper_roster_id) end)
        order by m.waiver_priority nulls last, m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id),
    'my_claims', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'add_slug', c.add_slug, 'drop_slug', c.drop_slug, 'status', c.status,
        'note', c.note, 'bid', c.bid, 'created_at', c.created_at,
        -- 0289: when this row settles — its own clock if 0288 admitted it,
        -- else the pool hold it is queued behind.
        'clears_at', coalesce(c.clears_at, (select lp.waived_until from league_pool lp
           where lp.league_id = c.league_id and lp.slug = c.add_slug))) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;
revoke all on function _native_team_state_for(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function native_team_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return _native_team_state_for(p_league_id, auth.uid(), is_league_commish(p_league_id) or is_admin());
end $$;
grant execute on function native_team_state(uuid) to authenticated;

create or replace function admin_user_native_team_state(p_app_user_id uuid, p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  if p_app_user_id is null then return jsonb_build_object('error', 'no user'); end if;
  return _native_team_state_for(p_league_id, p_app_user_id,
    exists (select 1 from league where id = p_league_id and commissioner_id = p_app_user_id));
end $$;
grant execute on function admin_user_native_team_state(uuid, uuid) to authenticated;
