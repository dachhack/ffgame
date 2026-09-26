-- ═══════════════════════════════════════════════════════════════════════════
-- 0382 · COLLEGE CONFERENCES, FOR THE DRAFT'S FILTERS.
--
-- Founder: "let's get division and conference filters on the devy enabled
-- drafts." NFL players already carry their team, and core knows the eight
-- divisions (kdst.ts NFL_DIVISIONS), so AFC/NFC and "AFC East" are a client
-- matter. A college player carried only his school: nothing knew that
-- Alabama plays in the SEC.
--
-- college_school: one row per FBS school, its conference and tier —
--   P4  = ACC, Big 12, Big Ten, SEC;
--   G5  = American, Conference USA, MAC, Mountain West, Pac-12, Sun Belt;
--   IND = FBS independents.
-- Written by the worker's college sweep from ESPN's FBS standings (one
-- request names every conference and its teams), service role only.
-- league_pool_college (0365) returns `conference` and `tier` beside the school.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists college_school (
  school_id   text primary key,          -- ESPN team id (college_player.school_id)
  school_abbr text,
  conference  text not null,             -- short name: SEC, Big Ten, …
  conf_id     int,
  tier        text not null check (tier in ('P4', 'G5', 'IND')),
  updated_at  timestamptz not null default now()
);
alter table college_school enable row level security;
drop policy if exists college_school_read on college_school;
create policy college_school_read on college_school for select using (auth.uid() is not null);

create or replace function upsert_college_schools(p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  insert into college_school (school_id, school_abbr, conference, conf_id, tier, updated_at)
  select r ->> 'school_id', r ->> 'school_abbr', r ->> 'conference', (r ->> 'conf_id')::int, r ->> 'tier', now()
    from jsonb_array_elements(p_rows) r
   where coalesce(r ->> 'school_id', '') <> '' and coalesce(r ->> 'conference', '') <> ''
     and r ->> 'tier' in ('P4', 'G5', 'IND')
  on conflict (school_id) do update set school_abbr = excluded.school_abbr, conference = excluded.conference,
    conf_id = excluded.conf_id, tier = excluded.tier, updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n);
end $$;
revoke all on function upsert_college_schools(jsonb) from public, anon, authenticated;
grant execute on function upsert_college_schools(jsonb) to service_role;

-- ── league_pool_college — 0365's body, plus the conference ──
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
        'conference', cs.conference, 'tier', cs.tier))
       from league_pool lp
       left join college_player cp on cp.espn_id = substr(lp.slug, 3)
       left join college_school cs on cs.school_id = cp.school_id
      where lp.league_id = p_league_id and lp.level = 'college'), '{}'::jsonb));
end $$;
grant execute on function league_pool_college(uuid) to authenticated;
