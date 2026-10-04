-- ═══════════════════════════════════════════════════════════════════════════
-- 0423 · EVERY PLATFORM, SELF-SERVE (v0.613.0).
--
-- Founder, after 0422 made Sleeper self-serve: "Any player works for the
-- sleeper import. Let's do the same for the other league providers (ESPN,
-- Yahoo, etc). Current season inputs only."
--
-- ESPN, Fleaflicker, MFL and Yahoo leagues have had normalizers for a while
-- (packages/core/src/data/{espn,fleaflicker,mfl,yahoo}.ts) and the admin
-- console has imported ESPN ones with them. What stood between a member and
-- doing it themself was admin_upsert_league (admin-only) and the fact that
-- no platform but Sleeper gives us a user id to match a seat with. So:
--
--   import_provider_league(...)  the league row (provider-keyed, as the admin
--       import keys it: sleeper_league_id = '<provider>-<ref>'), its seats,
--       the caller as commissioner — and the caller PICKS THEIR OWN TEAM from
--       the list, since there is no owner id to match. The founder's trust
--       call: "any player works".
--   invite_seats(code) / claim_platform_seat(code, roster_id)  the same
--       pick-your-team step for everyone who follows with the invite code,
--       on platforms where redeem_invite's Sleeper-username match can't
--       apply. A claimed team can't be taken twice; disputes go to the
--       commissioner, who can reassign from the desk (admin_assign_roster).
--
-- Season: the current calendar year only, like 0422.
-- The schedule and lineups are written by the client straight after, through
-- admin_upsert_matchups / admin_upsert_lineups, which already admit the
-- league's commissioner (0010). Nothing here touches the worker: non-Sleeper
-- leagues still refresh when the commissioner presses "sync season".
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function import_provider_league(
  p_provider text, p_ref text, p_season text, p_name text, p_settings jsonb, p_members jsonb, p_my_roster_id int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; lid uuid; key text; e text; cnm text; mine league_membership;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if p_provider is null or p_provider not in ('espn', 'yahoo', 'mfl', 'fleaflicker') then
    return jsonb_build_object('ok', false, 'error', 'that platform is not supported here');
  end if;
  if p_ref is null or p_ref !~ '^[A-Za-z0-9._-]{1,64}$' then return jsonb_build_object('ok', false, 'error', 'that is not a league id'); end if;
  if p_season is distinct from to_char(now(), 'YYYY') then
    return jsonb_build_object('ok', false, 'error', format('only this season (%s) can be brought in', to_char(now(), 'YYYY')));
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 then
    return jsonb_build_object('ok', false, 'error', 'that league has no teams yet');
  end if;
  if p_my_roster_id is null or not exists (select 1 from jsonb_array_elements(p_members) m where (m ->> 'roster_id')::int = p_my_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'pick your team from the list');
  end if;
  key := p_provider || '-' || p_ref;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  select * into lg from league where sleeper_league_id = key and season = p_season;
  if lg.id is not null then
    if lg.commissioner_id = auth.uid() or is_league_commish(lg.id) then
      lid := lg.id;
    elsif lg.commissioner_id is null then
      update league set commissioner_id = auth.uid() where id = lg.id;   -- imported by an admin, never claimed
      lid := lg.id;
    else
      select coalesce(display_name, sleeper_username, 'its commissioner') into cnm from app_user where id = lg.commissioner_id;
      return jsonb_build_object('ok', false, 'error', format('%s is already on Drip — ask %s for the invite code', lg.name, cnm));
    end if;
  else
    insert into league (sleeper_league_id, season, name, settings_json, provider, synced_at, commissioner_id)
    values (key, p_season, coalesce(nullif(btrim(p_name), ''), 'League'), coalesce(p_settings, '{}'::jsonb), p_provider, now(), auth.uid())
    returning id into lid;
    update league set avatar_url = random_drip_avatar() where id = lid and avatar_url is null;
  end if;

  perform _upsert_membership_rows(lid, p_members);
  -- Your team: the one you picked, unless somebody already holds it.
  select * into mine from league_membership where league_id = lid and sleeper_roster_id = p_my_roster_id;
  if mine.app_user_id is not null and mine.app_user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'that team is already claimed by another member — pick yours, or sort it out with them');
  end if;
  update league_membership set app_user_id = auth.uid(), enrolled = true where id = mine.id;

  select * into lg from league where id = lid;
  return jsonb_build_object('ok', true, 'league_id', lid, 'name', lg.name, 'invite_code', lg.invite_code,
    'seats', jsonb_array_length(p_members), 'roster_id', p_my_roster_id);
end $$;
grant execute on function import_provider_league(text, text, text, text, jsonb, jsonb, int) to authenticated;

/** The teams behind an invite code on a platform league, for picking yours.
 *  Native leagues seat by native_join and Sleeper ones by username, so this
 *  answers only for the rest. */
create or replace function invite_seats(p_code text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare lg league;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where invite_code = upper(trim(p_code));
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'invalid code'); end if;
  if lg.provider in ('native', 'sleeper') then return jsonb_build_object('ok', false, 'error', 'use the join flow'); end if;
  return jsonb_build_object('ok', true, 'league', lg.name, 'provider', lg.provider, 'seats', coalesce((
    select jsonb_agg(jsonb_build_object('roster_id', m.sleeper_roster_id, 'team_name', m.team_name,
                                        'taken', m.app_user_id is not null and m.app_user_id <> auth.uid(),
                                        'mine', m.app_user_id = auth.uid())
                     order by m.sleeper_roster_id)
    from league_membership m where m.league_id = lg.id), '[]'::jsonb));
end $$;
grant execute on function invite_seats(text) to authenticated;

/** Take a team on a platform league by its invite code. */
create or replace function claim_platform_seat(p_code text, p_roster_id int) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare lg league; m league_membership; e text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where invite_code = upper(trim(p_code));
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'invalid code'); end if;
  if lg.provider in ('native', 'sleeper') then return jsonb_build_object('ok', false, 'error', 'use the join flow'); end if;
  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);
  -- Already seated here? Then that is your team, whichever you tapped.
  select * into m from league_membership where league_id = lg.id and app_user_id = auth.uid() and enrolled;
  if m.id is not null then
    return jsonb_build_object('ok', true, 'league', lg.name, 'league_id', lg.id, 'roster_id', m.sleeper_roster_id, 'status', 'enrolled');
  end if;
  select * into m from league_membership where league_id = lg.id and sleeper_roster_id = p_roster_id;
  if m.id is null then return jsonb_build_object('ok', false, 'error', 'no such team in this league'); end if;
  if m.app_user_id is not null and m.app_user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'that team is already claimed — pick yours, or ask your commissioner');
  end if;
  update league_membership set app_user_id = auth.uid(), enrolled = true, claim_email = coalesce(e, claim_email) where id = m.id;
  delete from league_join where league_id = lg.id and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'league', lg.name, 'league_id', lg.id, 'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'status', 'enrolled');
end $$;
grant execute on function claim_platform_seat(text, int) to authenticated;
