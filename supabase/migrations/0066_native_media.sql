-- 0066: native-league media — player headshots + selectable team/league avatars.
--
--   • league_pool.espn_id — the ESPN athlete id per pool player (seeded from the
--     Sleeper directory), so the draft room / team screens render headshots for
--     EVERYONE including 2026 rookies (the baked HEADSHOTS map only covers ~600
--     2025 veterans by slug). Display goes through the existing mark-free switch.
--   • league.avatar_url — a league crest, set by the commissioner.
--   • set_team_avatar / set_league_avatar — self-serve avatar selection (the
--     avatar_url column on league_membership has existed since 0030; until now
--     only imports/admins wrote it). URLs are https-only and length-capped; the
--     client offers a preset gallery (generated avatars + team logos).
--   • native_team_state v2 — adds my_team / my_avatar / league_avatar /
--     is_commish and an avatar per waiver_order row, so the team screen and the
--     draft room render identities without extra reads.

alter table league_pool add column if not exists espn_id text;
alter table league add column if not exists avatar_url text;

-- Accepts an https URL up to 300 chars, or null/'' to clear.
create or replace function clean_avatar_url(p_url text) returns text
  language sql immutable as $$
  select case
    when p_url is null or btrim(p_url) = '' then null
    when p_url ~ '^https://' and length(btrim(p_url)) <= 300 then btrim(p_url)
    else '!invalid'
  end;
$$;

-- seed_league_pool v2: each entry may carry espn_id (rookies get headshots).
create or replace function seed_league_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'draft already started');
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'players must be an array');
  end if;
  if jsonb_array_length(p_players) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large (max 2000)');
  end if;

  delete from league_pool where league_id = p_league_id;
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id)
  select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
         nullif(btrim(coalesce(p ->> 'espn_id', '')), '')
  from jsonb_array_elements(p_players) with ordinality as t(p, ord)
  where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
    and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
  on conflict (league_id, slug) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n);
end $$;

-- A manager picks their own team's avatar (or the commissioner/admin does).
create or replace function set_team_avatar(p_league_id uuid, p_roster_id int, p_url text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare u text;
begin
  if not (is_admin() or is_league_commish(p_league_id) or owns_roster(p_league_id, p_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  u := clean_avatar_url(p_url);
  if u = '!invalid' then return jsonb_build_object('ok', false, 'error', 'avatar must be an https URL'); end if;
  update league_membership set avatar_url = u
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
  return jsonb_build_object('ok', true, 'avatar', u);
end $$;

-- The commissioner picks the league's crest.
create or replace function set_league_avatar(p_league_id uuid, p_url text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare u text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  u := clean_avatar_url(p_url);
  if u = '!invalid' then return jsonb_build_object('ok', false, 'error', 'avatar must be an https URL'); end if;
  update league set avatar_url = u where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  return jsonb_build_object('ok', true, 'avatar', u);
end $$;

-- native_team_state v2: identity fields for the team screen + draft room.
create or replace function native_team_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_roster int; d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select sleeper_roster_id into my_roster from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select * into d from draft where league_id = p_league_id;
  return jsonb_build_object(
    'my_roster_id', my_roster,
    'my_team', (select team_name from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_avatar', (select avatar_url from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'league_avatar', (select avatar_url from league l where l.id = p_league_id),
    'is_commish', is_league_commish(p_league_id) or is_admin(),
    'draft_status', coalesce(d.status, 'none'),
    'roster_cap', d.rounds,
    'server_now', now(),
    'waiver_order', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'priority', m.waiver_priority,
        'avatar', m.avatar_url)
        order by m.waiver_priority nulls last, m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id),
    'my_claims', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'add_slug', c.add_slug, 'drop_slug', c.drop_slug, 'status', c.status,
        'note', c.note, 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;

grant execute on function set_team_avatar(uuid, int, text) to authenticated;
grant execute on function set_league_avatar(uuid, text) to authenticated;
