-- ═══════════════════════════════════════════════════════════════════════════
-- 0409 · DECLARED — a college player headed to this year's NFL draft.
--
-- Devy leagues watch the early-entry list: a declared player is gone from
-- college at season's end and converts at the draft. ESPN keeps a per-season
-- NFL draft prospect pool (sports.core …/seasons/<Y>/draft/athletes — 689
-- players for 2026), each entry pointing at the player's COLLEGE athlete id,
-- which is our espn_id. The worker (poll/declared.js) loads it into
-- nfl_prospect between the bowls and the draft.
--
-- WHEN IT MEANS "DECLARED". Before the NFL's early-entry deadline (mid-January)
-- that pool is a big board that lists underclassmen who may yet go back to
-- school, so it is not shown. From Jan 16 of the draft year it is the class
-- that is actually going: _college_declared says so until Aug 1, by which
-- time a drafted or signed player has graduated to his NFL slug and an
-- unsigned one is no longer news. It is a tag — no roster rule changes; a
-- declared player stays in his devy spot until he graduates (0367).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists nfl_prospect (
  draft_year int  not null,
  draft_id   text not null,            -- ESPN's draft-athlete id (not the athlete id)
  espn_id    text,                     -- his COLLEGE athlete id; null if the entry had none
  name       text,
  seen_at    timestamptz not null default now(),
  primary key (draft_year, draft_id)
);
create index if not exists nfl_prospect_espn on nfl_prospect(espn_id);
alter table nfl_prospect enable row level security;
-- No policies: read through the functions below; written by the service role.

-- p_at is for the probes; every caller passes nothing.
create or replace function _college_declared(p_espn_id text, p_at timestamptz default now()) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from nfl_prospect np
    where np.espn_id = p_espn_id
      and p_at >= make_timestamptz(np.draft_year, 1, 16, 0, 0, 0, 'America/New_York')
      and p_at <  make_timestamptz(np.draft_year, 8, 1, 0, 0, 0, 'America/New_York'))
$$;

-- The worker asks which draft ids it already knows, so a daily pass fetches
-- only new entries.
create or replace function nfl_prospect_known(p_year int) returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(draft_id), '{}') from nfl_prospect where draft_year = p_year
$$;
revoke all on function nfl_prospect_known(int) from public;
grant execute on function nfl_prospect_known(int) to service_role;

-- [{draft_id, espn_id, name}] for one draft year. Upsert; never deletes (an
-- entry ESPN drops after the deadline stays declared — withdrawals are rare
-- and a stale tag is safer than a flapping one).
create or replace function upsert_nfl_prospects(p_year int, p_rows jsonb) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into nfl_prospect (draft_year, draft_id, espn_id, name, seen_at)
  select p_year, r ->> 'draft_id', nullif(r ->> 'espn_id', ''), r ->> 'name', now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(r ->> 'draft_id', '') ~ '^[0-9]+$'
     and (r ->> 'espn_id' is null or r ->> 'espn_id' ~ '^[0-9]*$')
  on conflict (draft_year, draft_id) do update
    set espn_id = coalesce(excluded.espn_id, nfl_prospect.espn_id),
        name = coalesce(excluded.name, nfl_prospect.name), seen_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function upsert_nfl_prospects(int, jsonb) from public;
grant execute on function upsert_nfl_prospects(int, jsonb) to service_role;

-- ── devy_market — 0405's body, plus 'declared' ──
create or replace function devy_market(p_league_id uuid, p_limit int default 1000, p_query text default null)
  returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select nullif(trim(coalesce(p_query, '')), '') as needle)
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'slug', 'c-' || t.espn_id, 'name', t.full_name, 'pos', t.pos, 'school', t.school_abbr,
        'class_year', t.class_year, 'fcs', t.division = 'FCS', 'rank', t.rank, 'sh_rank', t.sh_rank, 'youth', coalesce(t.youth = 1, false),
        'price', _devy_price(null, 'c-' || t.espn_id),
        'declared', _college_declared(t.espn_id)) order by t.ord)
      from (
        select cp.espn_id, cp.full_name, cp.pos, cp.school_abbr, cp.class_year, cp.division, p.rank, p.youth, s.rank_1qb as sh_rank,
               row_number() over (order by p.rank nulls last, s.rank_1qb nulls last, cp.full_name) as ord
          from college_player cp
          left join college_price p on p.espn_id = cp.espn_id
          left join stathead_devy s on s.espn_id = cp.espn_id
         where cp.active and cp.pos in ('QB', 'RB', 'WR', 'TE')
           and ((select needle from q) is null
                or cp.full_name ilike '%' || (select needle from q) || '%'
                or cp.school_abbr ilike (select needle from q) || '%'
                or cp.school ilike '%' || (select needle from q) || '%')
         order by ord
         limit least(greatest(coalesce(p_limit, 1000), 1), 5000)) t), '[]'::jsonb)
  end
$$;

-- ── college_player_card — 0406's body, plus 'declared' ──
create or replace function college_player_card(p_espn_id text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then jsonb_build_object('ok', false, 'error', 'sign in')
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

-- ── league_pool_college — 0382's body, plus 'declared' ──
create or replace function league_pool_college(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'players', coalesce(
    (select jsonb_object_agg(lp.slug, jsonb_build_object(
        'espn_id', substr(lp.slug, 3), 'school', cp.school, 'school_abbr', cp.school_abbr,
        'class_label', cp.class_label, 'class_year', cp.class_year, 'active', cp.active,
        'conference', cs.conference, 'tier', cs.tier,
        'declared', _college_declared(cp.espn_id)))   -- 0409
       from league_pool lp
       left join college_player cp on cp.espn_id = substr(lp.slug, 3)
       left join college_school cs on cs.school_id = cp.school_id
      where lp.league_id = p_league_id and lp.level = 'college'), '{}'::jsonb));
end $$;
