-- 0041: provider-tag live leagues so non-Sleeper platforms (ESPN/Yahoo/…) can be
-- imported into the pilot. The membership/matchup/lineup writers are already
-- provider-agnostic (they take opaque roster ids + slugs), so the only schema
-- change is a `provider` column + letting admin_upsert_league set it. Non-Sleeper
-- leagues use a namespaced sleeper_league_id key (e.g. "espn-123456") to avoid id
-- collisions. Live scoring always comes from the ESPN play feed regardless.

alter table league add column if not exists provider text not null default 'sleeper';

-- admin_upsert_league gains p_provider (default 'sleeper' → existing Sleeper imports
-- are unaffected). Drop the 4-arg version first so there's no ambiguous overload.
drop function if exists admin_upsert_league(text, text, text, jsonb);
create or replace function admin_upsert_league(p_sleeper_id text, p_season text, p_name text, p_settings jsonb, p_provider text default 'sleeper')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into league (sleeper_league_id, season, name, settings_json, provider, synced_at)
  values (p_sleeper_id, p_season, coalesce(p_name, 'League'), p_settings, coalesce(p_provider, 'sleeper'), now())
  on conflict (sleeper_league_id, season) do update
    set name = excluded.name, settings_json = excluded.settings_json, provider = excluded.provider, synced_at = now()
  returning id into lid;
  return jsonb_build_object('ok', true, 'league_id', lid);
end $$;
grant execute on function admin_upsert_league(text, text, text, jsonb, text) to authenticated;

-- Surface provider in the admin + commish league lists.
create or replace function admin_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider,
      'commish_code', l.commish_code, 'invite_code', l.invite_code,
      'commissioner', l.commissioner_id is not null, 'lineup_policy', l.lineup_policy,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function admin_overview() to authenticated;

create or replace function commish_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true, 'lineup_policy', l.lineup_policy,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l where l.commissioner_id = auth.uid() order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function commish_overview() to authenticated;
