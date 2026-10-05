-- ═══════════════════════════════════════════════════════════════════════════
-- 0438 · COLLEGE ON FILLS THE POOL.
--
-- Founder, from a mixed NFL + college league after its draft: "Started a
-- league with mixed college and NFL. There were no college players in the
-- draft or on waivers."
--
-- A mixed league (0372) is made in two moves after the league exists:
-- COLLEGE on under the admin's EXTRA POSITIONS, then college spots in the
-- roster builder. Neither move put a college player in the pool. The pool is
-- seeded once, when the league is made — NFL players only, COLLEGE being off
-- then — and the toggle changed a setting and left a note to refresh the
-- pool. 0386's ADD NEW PLAYERS can top it up by hand, but nothing did it on
-- its own, so the draft room and the wire listed NFL players under spots
-- that take nobody but college players. (Devy spots chosen at creation, 0398,
-- seed college players themselves; the devy market keeps them out of the
-- pool on purpose.)
--
--   · _league_pool_add_college(league, limit): the college players the pool
--     lacks, from the directory in its own ranking (college_directory), under
--     the league's positions (IDP, FB) and its pool filter (conferences,
--     tiers, classes; a level of 'nfl' or the devy market means none).
--     Ranked after everyone already there, as free agents — 0386's rules
--     without a caller's list. Nothing is removed or re-ranked.
--   · set_league_position_access: COLLEGE switched ON fills the pool at
--     once, before or after the draft, and the league hears it in chat.
--     Switched OFF, the college players nobody holds leave the pool, as a
--     re-seed would have dropped them. The reply carries both counts.
--   · Backfill: every native league with COLLEGE on and not one college
--     player in its pool gets them now.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _league_pool_add_college(p_league_id uuid, p_limit int default 600)
  returns int language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; positions text[] := array['QB', 'RB', 'WR', 'TE']; flt jsonb; n int; have int; room int; top int;
begin
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then return 0; end if;
  if not _league_has_college(lg.settings_json) then return 0; end if;
  -- The devy market (0387): college players are bought, never drafted.
  if coalesce(lg.settings_json ->> 'devy_mode', 'spots') = 'shares' then return 0; end if;
  flt := coalesce(lg.settings_json -> 'pool_filter', '{}'::jsonb);
  if coalesce(flt ->> 'level', '') = 'nfl' then return 0; end if;
  -- The same positions the client's seed asks the directory for.
  if coalesce(lg.settings_json -> 'positions_extra', '[]'::jsonb) @> '["IDP"]'::jsonb then positions := positions || array['DL', 'LB', 'DB']; end if;
  if coalesce(lg.settings_json -> 'positions_extra', '[]'::jsonb) @> '["FB"]'::jsonb then positions := positions || array['FB']; end if;
  select count(*), coalesce(max(rank), 0) into have, top from league_pool where league_id = p_league_id;
  room := greatest(0, 3000 - have);

  with dir as (
    select p ->> 'espn_id' as espn_id, p ->> 'full' as full_name, p ->> 'pos' as pos,
           p ->> 'conference' as conference, p ->> 'tier' as tier,
           nullif(p ->> 'class_year', '')::int as class_year, ord
      from jsonb_array_elements(college_directory(positions, least(greatest(coalesce(p_limit, 600), 1), 2000)))
           with ordinality as t(p, ord)
  ), allowed as (
    -- The league's college rule (0383), as set_league_pool_filter stores it
    -- and as the client's seed applies it.
    select d.* from dir d
     where (coalesce(jsonb_array_length(case when jsonb_typeof(flt -> 'confs') = 'array' then flt -> 'confs' end), 0) = 0
            or (d.tier is not null and ((flt -> 'confs') ? 'FBS' or (flt -> 'confs') ? d.tier))
            or (d.conference is not null and (flt -> 'confs') ? d.conference))
       and (coalesce(jsonb_array_length(case when jsonb_typeof(flt -> 'classes') = 'array' then flt -> 'classes' end), 0) = 0
            or (d.class_year is not null and (flt -> 'classes') @> to_jsonb(least(4, greatest(1, d.class_year)))))
  ), fresh as (
    select a.*, 'c-' || a.espn_id as slug from allowed a
     where a.espn_id ~ '^[0-9]+$'
       and not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = 'c-' || a.espn_id)
       and not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.espn_id = a.espn_id)
       -- a graduated devy player is one man under two slugs (0386)
       and not exists (select 1 from player_alias al join league_pool lp
                         on lp.league_id = p_league_id and lp.slug in (al.old_slug, al.new_slug)
                        where 'c-' || a.espn_id in (al.old_slug, al.new_slug))
  ), numbered as (
    select f.*, row_number() over (order by f.ord) as k from fresh f
  )
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id)
  select p_league_id, slug, full_name, pos, '', top + k, espn_id
    from numbered
   where k <= room
  on conflict do nothing;
  get diagnostics n = row_count;

  if n > 0 then
    perform _chat_house(p_league_id,
      n || ' college player' || case when n = 1 then ' is' else 's are' end || ' in the player pool now, as free agents.',
      jsonb_build_object('kind', 'pool_top_up', 'added', n, 'college', true));
  end if;
  return n;
end $$;
revoke all on function _league_pool_add_college(uuid, int) from public, anon, authenticated;

-- 0365's body, plus the pool following the COLLEGE switch.
create or replace function set_league_position_access(p_league_id uuid, p_positions jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare allowed text[] := array['HC','P','IDP','FB','RET','COLLEGE']; cleaned jsonb := '[]'::jsonb; ps jsonb; v text;
        was boolean; added int := 0; removed int := 0;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  if p_positions is not null and jsonb_typeof(p_positions) = 'array' then
    for ps in select * from jsonb_array_elements(p_positions) loop
      v := upper(trim(both '"' from ps::text));
      if not (v = any (allowed)) then
        return jsonb_build_object('ok', false, 'error', 'unknown position group: ' || v);
      end if;
      if not cleaned @> to_jsonb(array[v]) then cleaned := cleaned || to_jsonb(array[v]); end if;
    end loop;
  end if;
  -- 0365: college players are classic only.
  if cleaned @> '["COLLEGE"]'::jsonb and coalesce((select settings_json ->> 'game_mode'
      from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'college players need a classic league');
  end if;
  was := _league_has_college((select settings_json from league where id = p_league_id));
  update league set settings_json =
      case when cleaned = '[]'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'positions_extra')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('positions_extra', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  -- 0438: the pool follows the switch. ON fills it from the directory;
  -- OFF drops the college players nobody holds, as a re-seed would.
  if cleaned @> '["COLLEGE"]'::jsonb and not coalesce(was, false) then
    added := _league_pool_add_college(p_league_id);
  elsif coalesce(was, false) and not (cleaned @> '["COLLEGE"]'::jsonb) then
    delete from league_pool lp
     where lp.league_id = p_league_id and lp.level = 'college'
       and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
       and not exists (select 1 from college_custom cc where 'c-' || cc.espn_id = lp.slug);
    get diagnostics removed = row_count;
  end if;
  return jsonb_build_object('ok', true, 'positions', cleaned, 'college_added', added, 'college_removed', removed);
end $$;
grant execute on function set_league_position_access(uuid, jsonb) to authenticated;

-- ── Backfill: the leagues that turned COLLEGE on and never got the players ──
do $$
declare r record; n int; total int := 0; leagues int := 0;
begin
  for r in
    select l.id from league l
     where l.provider = 'native' and not coalesce(l.is_mock, false)
       and _league_has_college(l.settings_json)
       and coalesce(l.settings_json ->> 'devy_mode', 'spots') <> 'shares'
       and coalesce(l.settings_json -> 'pool_filter' ->> 'level', '') <> 'nfl'
       and exists (select 1 from league_pool lp where lp.league_id = l.id)
       and not exists (select 1 from league_pool lp where lp.league_id = l.id and lp.level = 'college')
  loop
    n := _league_pool_add_college(r.id);
    if n > 0 then total := total + n; leagues := leagues + 1; end if;
  end loop;
  raise notice '0438: % college players added across % leagues', total, leagues;
end $$;
