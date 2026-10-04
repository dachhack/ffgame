-- ═══════════════════════════════════════════════════════════════════════════
-- 0410 · CUSTOM COLLEGE PLAYERS — the commissioner adds one the directory
-- doesn't have.
--
-- The college directory is every FBS roster (and FCS, for the market). A devy
-- league sometimes wants a player outside it: a D2 star, a JUCO transfer, a
-- signed recruit who isn't on a roster yet. The commissioner types him in.
--
-- HE IS A COLLEGE PLAYER LIKE ANY OTHER, by his slug: `c-<id>` with an id from
-- a reserved range (990000001 up — ESPN's athlete ids are seven digits), so
-- isCollegeSlug, league_pool.level, the devy landing trigger and every devy
-- cap treat him exactly as they treat an FBS player. He lives in
-- college_custom, NOT college_player, so nothing global sees him: not the devy
-- market, not college_directory (what seeds every league's pool), not the
-- sweep's retirement or the prices. The league-facing reads below union him
-- in. He has no ESPN feed, so he scores nothing — a stash. He never graduates
-- on his own: no crosswalk will ever name him.
--
-- Spots leagues only: a shares league's players come from the market.
-- ═══════════════════════════════════════════════════════════════════════════

create sequence if not exists college_custom_seq start with 990000001;

create table if not exists college_custom (
  espn_id      text primary key default nextval('college_custom_seq')::text,
  full_name    text not null,
  pos          text not null check (pos in ('QB', 'RB', 'WR', 'TE', 'K')),
  school       text,
  class_year   int check (class_year between 1 and 5),
  level        text not null default 'D2' check (level in ('FBS', 'FCS', 'D2', 'D3', 'NAIA', 'JUCO', 'HS')),
  league_id    uuid references league(id) on delete set null,   -- where it was entered
  created_by   uuid,
  created_at   timestamptz not null default now()
);
alter table college_custom enable row level security;
-- No policies: read through the functions below.

create or replace function _class_label(p_year int) returns text
  language sql immutable as $$
  select case when p_year is null then null when p_year <= 1 then 'FR' when p_year = 2 then 'SO'
              when p_year = 3 then 'JR' else 'SR' end
$$;

create or replace function commish_add_custom_college(
  p_league_id uuid, p_name text, p_pos text, p_school text default null,
  p_class int default null, p_level text default 'D2'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text; sc text; lv text; new_id text; st jsonb; rk int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  select settings_json into st from league where id = p_league_id;
  if not _league_has_college(st) then
    return jsonb_build_object('ok', false, 'error', 'college players are off in this league');
  end if;
  if coalesce(st ->> 'devy_mode', 'spots') = 'shares' then
    return jsonb_build_object('ok', false, 'error', 'a devy market league buys shares in players it can price — custom players are for devy spots');
  end if;
  nm := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  if length(nm) < 3 or length(nm) > 40 then
    return jsonb_build_object('ok', false, 'error', 'a name of 3–40 characters');
  end if;
  if upper(coalesce(p_pos, '')) not in ('QB', 'RB', 'WR', 'TE', 'K') then
    return jsonb_build_object('ok', false, 'error', 'position must be QB, RB, WR, TE or K');
  end if;
  sc := nullif(left(btrim(regexp_replace(coalesce(p_school, ''), '[[:cntrl:]]', '', 'g')), 40), '');
  lv := upper(coalesce(nullif(btrim(p_level), ''), 'D2'));
  if lv not in ('FBS', 'FCS', 'D2', 'D3', 'NAIA', 'JUCO', 'HS') then
    return jsonb_build_object('ok', false, 'error', 'level must be FBS, FCS, D2, D3, NAIA, JUCO or HS');
  end if;
  if p_class is not null and (p_class < 1 or p_class > 5) then
    return jsonb_build_object('ok', false, 'error', 'class is 1 (FR) to 5');
  end if;
  if exists (select 1 from league_pool lp join college_custom cc on 'c-' || cc.espn_id = lp.slug
             where lp.league_id = p_league_id and lower(cc.full_name) = lower(nm)) then
    return jsonb_build_object('ok', false, 'error', nm || ' is already in this league''s pool');
  end if;
  insert into college_custom (full_name, pos, school, class_year, level, league_id, created_by)
  values (nm, upper(p_pos), sc, p_class, lv, p_league_id, auth.uid())
  returning espn_id into new_id;
  select coalesce(max(rank), 0) + 1 into rk from league_pool where league_id = p_league_id;
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id)
  values (p_league_id, 'c-' || new_id, nm, upper(p_pos), '', rk, new_id);
  return jsonb_build_object('ok', true, 'slug', 'c-' || new_id, 'name', nm);
end $$;
grant execute on function commish_add_custom_college(uuid, text, text, text, int, text) to authenticated;

create or replace function commish_remove_custom_college(p_league_id uuid, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not exists (select 1 from college_custom cc join league_pool lp on lp.slug = 'c-' || cc.espn_id
                 where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'not a custom player in this league');
  end if;
  if exists (select 1 from native_roster where league_id = p_league_id and slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'a team has him — he has to be dropped first');
  end if;
  delete from league_pool where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function commish_remove_custom_college(uuid, text) to authenticated;

-- The commissioner's list: this league's custom players and who has each.
create or replace function league_custom_college(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'slug', lp.slug, 'name', cc.full_name, 'pos', cc.pos, 'school', cc.school,
        'class_year', cc.class_year, 'level', cc.level,
        'roster_id', (select nr.roster_id from native_roster nr where nr.league_id = p_league_id and nr.slug = lp.slug))
        order by cc.created_at)
      from league_pool lp join college_custom cc on 'c-' || cc.espn_id = lp.slug
     where lp.league_id = p_league_id), '[]'::jsonb)
  end
$$;
grant execute on function league_custom_college(uuid) to authenticated;

-- ── seed_league_pool — 0365's body; a re-seed keeps custom players ──
create or replace function seed_league_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; college boolean;
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
  college := _league_has_college((select settings_json from league where id = p_league_id));

  delete from league_pool lp where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr
                    where nr.league_id = lp.league_id and nr.slug = lp.slug)
    -- 0410: a commissioner's custom college player is no directory's to drop
    and not exists (select 1 from college_custom cc where 'c-' || cc.espn_id = lp.slug);
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
  select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
         -- 0365: a college row's ESPN id IS its slug's number; take it from
         -- there so the two can never disagree.
         case when (p ->> 'slug') ~ '^c-[0-9]+$' then substr(p ->> 'slug', 3)
              else nullif(btrim(coalesce(p ->> 'espn_id', '')), '') end,
         case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
              then least(30, greatest(0, (p ->> 'exp')::int)) end,
         -- Blank becomes NULL rather than '': the unique index is partial, and
         -- a pool full of empty strings would collide with itself on the first
         -- two team units.
         nullif(btrim(coalesce(p ->> 'sleeper_id', '')), '')
  from jsonb_array_elements(p_players) with ordinality as t(p, ord)
  where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
    and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
    -- 0365: college rows only where the admin turned COLLEGE on.
    and (college or (p ->> 'slug') !~ '^c-[0-9]+$')
  on conflict (league_id, slug) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n);
end $$;

-- ── league_pool_college — 0409's body, plus custom players ──
create or replace function league_pool_college(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'players', coalesce(
    (select jsonb_object_agg(lp.slug, jsonb_build_object(
        'espn_id', substr(lp.slug, 3),
        -- 0410: a custom player's facts come from the commissioner's entry
        'school', coalesce(cp.school, cc.school), 'school_abbr', coalesce(cp.school_abbr, cc.school),
        'class_label', coalesce(cp.class_label, _class_label(cc.class_year)),
        'class_year', coalesce(cp.class_year, cc.class_year), 'active', coalesce(cp.active, cc.espn_id is not null),
        'custom', cc.espn_id is not null, 'level', cc.level,
        'conference', cs.conference, 'tier', cs.tier,
        'declared', _college_declared(cp.espn_id)))   -- 0409
       from league_pool lp
       left join college_player cp on cp.espn_id = substr(lp.slug, 3)
       left join college_school cs on cs.school_id = cp.school_id
       left join college_custom cc on cc.espn_id = substr(lp.slug, 3)
      where lp.league_id = p_league_id and lp.level = 'college'), '{}'::jsonb));
end $$;

-- ── college_meta_for — 0383's, plus custom players' class ──
create or replace function college_meta_for(p_slugs text[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(x.slug, x.m), '{}'::jsonb) from (
    select 'c-' || cp.espn_id as slug, jsonb_build_object('conf', cs.conference, 'tier', cs.tier, 'cls', cp.class_year) as m
      from college_player cp
      left join college_school cs on cs.school_id = cp.school_id
     where 'c-' || cp.espn_id = any(p_slugs)
    union all
    -- 0410: a custom player has a class and no conference
    select 'c-' || cc.espn_id, jsonb_build_object('conf', null, 'tier', null, 'cls', cc.class_year)
      from college_custom cc
     where 'c-' || cc.espn_id = any(p_slugs)
       and not exists (select 1 from college_player cp where cp.espn_id = cc.espn_id)) x
$$;
grant execute on function college_meta_for(text[]) to authenticated, service_role;

-- ── college_player_card — 0409's body, plus custom players ──
create or replace function college_player_card(p_espn_id text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then jsonb_build_object('ok', false, 'error', 'sign in')
    -- 0410: a commissioner's custom player — what was entered, nothing more
    when not exists (select 1 from college_player where espn_id = p_espn_id)
     and exists (select 1 from college_custom where espn_id = p_espn_id)
      then (select jsonb_build_object('ok', true, 'custom', true, 'level', cc.level,
              'espn_id', cc.espn_id, 'slug', 'c-' || cc.espn_id, 'name', cc.full_name, 'pos', cc.pos,
              'school', cc.school, 'school_abbr', cc.school, 'class_year', cc.class_year,
              'class_label', _class_label(cc.class_year), 'active', true, 'seasons', '[]'::jsonb)
              from college_custom cc where cc.espn_id = p_espn_id)
    when not exists (select 1 from college_player where espn_id = p_espn_id)
      then jsonb_build_object('ok', false, 'error', 'no such college player')
    else (select jsonb_build_object('ok', true,
      'espn_id', cp.espn_id, 'slug', 'c-' || cp.espn_id, 'name', cp.full_name, 'pos', cp.pos,
      'school', cp.school, 'school_abbr', cp.school_abbr, 'class_year', cp.class_year, 'class_label', cp.class_label,
      'jersey', cp.jersey, 'active', cp.active, 'division', cp.division,
      'conference', cs.conference, 'tier', cs.tier,
      'declared', _college_declared(cp.espn_id),   -- 0409
      'graduated_to', (select a.new_slug from player_alias a where a.old_slug = 'c-' || cp.espn_id),
      'market', case when p.espn_id is null then jsonb_build_object('price', _devy_price(null, 'c-' || cp.espn_id), 'rank', null)
                     else jsonb_build_object('price', _devy_price(null, 'c-' || cp.espn_id), 'rank', p.rank,
                       'youth', p.youth = 1, 'as_of', p.as_of) end
                 || jsonb_build_object('frozen', _college_prices_frozen()),
      'stathead', case when s.espn_id is null then null
                       else jsonb_build_object('rank_1qb', s.rank_1qb, 'rank_sf', s.rank_sf,
                         'value_1qb', s.value_1qb, 'value_sf', s.value_sf, 'draft_year', s.draft_year,
                         'as_of', s.as_of, 'card', s.card) end,
      'seasons', coalesce((select jsonb_agg(to_jsonb(st) - 'espn_id' - 'updated_at' order by st.season desc)
                             from college_player_stats st where st.espn_id = cp.espn_id), '[]'::jsonb))
      from college_player cp
      left join college_school cs on cs.school_id = cp.school_id
      left join college_price p on p.espn_id = cp.espn_id
      left join stathead_devy s on s.espn_id = cp.espn_id
     where cp.espn_id = p_espn_id)
  end
$$;
