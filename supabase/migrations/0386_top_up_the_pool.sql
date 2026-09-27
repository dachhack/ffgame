-- ═══════════════════════════════════════════════════════════════════════════
-- 0386 · TOP UP A LEAGUE'S PLAYER POOL, BEFORE OR AFTER THE DRAFT.
--
-- Founder: "How do I refresh the available players in the app?" … "I can't
-- find seed player pool in the app." A league's pool is seeded once, when it
-- is made; seed_league_pool refuses once the draft starts, and its button
-- only shows for an EMPTY pool. So a player the first seed missed — a
-- college breakout, an NFL signing, the college players of a league that
-- turned COLLEGE on after it was made — could never be picked up.
--
-- commish_top_up_pool(league, players): ADDS the given players that the pool
-- doesn't hold, and nothing else. No row is removed or re-ranked, no roster
-- or lineup is touched. The client builds the list exactly as the draft
-- room's seed does (the league's positions and pool filter, college rules
-- included). A newcomer ranks after everyone already there, in the order
-- given, and lands as a free agent.
--
-- Skipped, so no unique key can trip and nobody is in the pool twice:
--   · a slug already there;
--   · a Sleeper id or ESPN id already there under another slug;
--   · a college slug whose player has graduated (player_alias) and the NFL
--     slug he became, when either side is already there;
--   · college rows unless the league has COLLEGE on; unknown positions.
-- Commissioner or admin; native leagues. At most 2000 offered per call and
-- 3000 in a pool. The league hears about it in chat.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function commish_top_up_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; college boolean; have int; room int; top int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'players must be an array');
  end if;
  if jsonb_array_length(p_players) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'too many players at once (max 2000)');
  end if;
  college := _league_has_college((select settings_json from league where id = p_league_id));
  select count(*), coalesce(max(rank), 0) into have, top from league_pool where league_id = p_league_id;
  room := greatest(0, 3000 - have);

  with offered as (
    select p ->> 'slug' as slug, p ->> 'full' as full_name, p ->> 'pos' as pos,
           coalesce(p ->> 'team', '') as team, ord,
           case when (p ->> 'slug') ~ '^c-[0-9]+$' then substr(p ->> 'slug', 3)
                else nullif(btrim(coalesce(p ->> 'espn_id', '')), '') end as espn_id,
           case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
                then least(30, greatest(0, (p ->> 'exp')::int)) end as exp,
           nullif(btrim(coalesce(p ->> 'sleeper_id', '')), '') as sleeper_id
      from jsonb_array_elements(p_players) with ordinality as t(p, ord)
     where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
       and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
       and (college or (p ->> 'slug') !~ '^c-[0-9]+$')
  ), fresh as (
    select distinct on (o.slug) o.*
      from offered o
     where not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = o.slug)
       and (o.sleeper_id is null or not exists (select 1 from league_pool lp
             where lp.league_id = p_league_id and lp.sleeper_id = o.sleeper_id))
       and (o.espn_id is null or not exists (select 1 from league_pool lp
             where lp.league_id = p_league_id and lp.espn_id = o.espn_id))
       -- a graduated devy player is one man under two slugs
       and not exists (select 1 from player_alias a join league_pool lp
             on lp.league_id = p_league_id and lp.slug in (a.old_slug, a.new_slug)
             where o.slug in (a.old_slug, a.new_slug))
     order by o.slug, o.ord
  ), numbered as (
    select f.*, row_number() over (order by f.ord) as k from fresh f
  )
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
  select p_league_id, slug, full_name, pos, team, top + k, espn_id, exp, sleeper_id
    from numbered
   where k <= room
  on conflict do nothing;
  get diagnostics n = row_count;

  if n > 0 then
    perform _chat_house(p_league_id,
      'The commissioner added ' || n || ' player' || case when n = 1 then '' else 's' end
        || ' to the pool. They''re free agents now.',
      jsonb_build_object('kind', 'pool_top_up', 'added', n));
  end if;
  return jsonb_build_object('ok', true, 'added', n, 'pool', have + n,
    'full', (have + n) >= 3000);
end $$;
revoke all on function commish_top_up_pool(uuid, jsonb) from public, anon;
grant execute on function commish_top_up_pool(uuid, jsonb) to authenticated;
