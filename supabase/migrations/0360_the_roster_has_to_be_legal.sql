-- ═══════════════════════════════════════════════════════════════════════════
-- 0360 · THE ROSTER HAS TO BE LEGAL
--
-- Founder: "We need to confirm roster movement limits when over the limit or
-- players in taxi or IR outside of the allowed designations. You should not be
-- able to pick up players or change your lineup outside of moving unallowed
-- players to an allowed spot. Best ball positions shouldn't do their magic if
-- a team has too many players on their roster. Warnings for these are good to
-- have."
--
-- ── ONE QUESTION, ASKED EVERYWHERE ─────────────────────────────────────────
-- roster_illegal_reason is already the gate on every add (add_free_agent,
-- submit_waiver_claim, process_waivers), on every lineup write
-- (enforce_legal_roster, 0072), and the warning on MY TEAM (roster_issue).
-- It only knew two illegal shapes, too many players and a position over its
-- cap. It now knows the rest, cheapest fix first:
--   • a player on IR or OUT who no longer carries one of that spot's
--     designations (league_ir_tags / league_out_tags). He healed, so he comes
--     off or goes. Only judged while the injury feed has rows: the poller
--     deletes a healed player's row and refuses to empty the table on a bad
--     poll, so no row means healthy, and an empty table means no feed;
--   • a taxi player past the league's experience ceiling (0196), e.g. a
--     rookie-only taxi after the season rolls over. Unknown experience isn't
--     held against him here, since that is a question for putting him on;
--   • a shelf holding more than its spots, after a commissioner shrank it;
--   • more active players than active seats (starters + bench) plus the
--     taxi spots still open;
--   • the two it always knew.
--
-- ── WHAT STILL WORKS ───────────────────────────────────────────────────────
-- Drops, and set_roster_spot, which never asked this question. Moving a healed
-- player back to active, or a veteran off the taxi, is the fix and is never
-- blocked by the problem it fixes. Each move still obeys its own spot's rules
-- (a full active roster still needs a drop first).
--
-- ── BEST BALL ──────────────────────────────────────────────────────────────
-- A best-ball spot fills itself from the roster, which is exactly the thing an
-- illegal roster gets too much of. While a team is illegal its best-ball spots
-- stay empty. The worker asks league_illegal_rosters once per tick (resolve.js)
-- and the boards ask league_roster_issues, so what they draw is what scores.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function roster_illegal_reason(p_league_id uuid, p_roster_id integer) returns text
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; cnt int; rec record; cap int; sh jsonb; seats int; tags text[]; mx int; feed boolean;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return null; end if;
  sh := _roster_shape(p_league_id);

  -- ── a stashed player who no longer belongs there ──
  feed := exists (select 1 from injury_status limit 1);
  if feed then
    tags := league_ir_tags(p_league_id);
    select lp.full_name, coalesce(upper(i.status), '') as st into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      left join injury_status i on i.player_slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'ir'
       and not (coalesce(upper(i.status), '') = any(tags))
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is on IR but isn''t designated ' || array_to_string(tags, '/')
        || coalesce(' (he''s ' || nullif(rec.st, '') || ')', ' any more') || ' — move him off IR or drop him';
    end if;
    tags := league_out_tags(p_league_id);
    select lp.full_name, coalesce(upper(i.status), '') as st into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      left join injury_status i on i.player_slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'out'
       and not (coalesce(upper(i.status), '') = any(tags))
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is in an OUT spot but isn''t designated ' || array_to_string(tags, '/')
        || coalesce(' (he''s ' || nullif(rec.st, '') || ')', ' any more') || ' — move him out of it or drop him';
    end if;
  end if;
  mx := (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id);
  if mx is not null then
    select lp.full_name, lp.exp into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'taxi' and lp.exp > mx
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is on the taxi squad with ' || rec.exp || case when rec.exp = 1 then ' year' else ' years' end || ' (the limit is ' || mx
        || ') — move him to your active roster or drop him';
    end if;
  end if;

  -- ── a shelf, or the active roster, over its size ──
  if sh <> '{}'::jsonb then
    for rec in select s.spot, s.label from (values ('taxi', 'taxi squad'), ('ir', 'IR'), ('out', 'OUT')) s(spot, label) loop
      cap := coalesce((sh ->> rec.spot)::int, 0);
      select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = rec.spot;
      if cnt > cap then
        return 'the ' || rec.label || ' holds ' || cnt || ' (limit ' || cap || ') — move or drop ' || (cnt - cap);
      end if;
    end loop;
  end if;
  -- The active roster may run over its seats by the taxi spots still open: a
  -- draft fills the taxi's share of the roster as ACTIVE players (seat-cap
  -- probes, sc2), and they stay legal until the taxi has room they won't use.
  -- Beyond that, there's nowhere for them to be.
  seats := league_active_seats(p_league_id);
  if seats is not null and sh <> '{}'::jsonb then
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = 'active';
    cap := seats + greatest(coalesce((sh ->> 'taxi')::int, 0)
             - (select count(*)::int from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = 'taxi'), 0);
    if cnt > cap then
      return 'the active roster holds ' || cnt || ' (room for ' || cap || ') — drop or stash ' || (cnt - cap);
    end if;
  end if;

  -- ── the two it always knew ──
  select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  if cnt > d.rounds then
    return 'roster holds ' || cnt || ' players (limit ' || d.rounds || ') — drop ' || (cnt - d.rounds);
  end if;
  for rec in
    select lp.pos, count(*)::int as n
    from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = p_league_id and nr.roster_id = p_roster_id group by lp.pos
  loop
    cap := league_pos_cap(p_league_id, rec.pos);
    if cap is not null and rec.n > cap then
      return 'over the ' || pos_label(rec.pos) || ' limit (' || rec.n || '/' || cap || ') — drop ' || (rec.n - cap);
    end if;
  end loop;
  return null;
end $$;

-- Every team's problem in one league, for the boards (any member).
create or replace function league_roster_issues(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'issues', coalesce((
    select jsonb_object_agg(m.sleeper_roster_id::text, r)
      from league_membership m, lateral roster_illegal_reason(p_league_id, m.sleeper_roster_id) r
     where m.league_id = p_league_id and m.sleeper_roster_id is not null and r is not null), '{}'::jsonb));
end $$;
grant execute on function league_roster_issues(uuid) to authenticated;

-- The worker's once-a-tick read: every illegal seat in these leagues.
create or replace function league_illegal_rosters(p_league_ids uuid[]) returns table (league_id uuid, roster_id int, reason text)
  language sql stable security definer set search_path = public as $$
  select m.league_id, m.sleeper_roster_id, r
    from league_membership m, lateral roster_illegal_reason(m.league_id, m.sleeper_roster_id) r
   where m.league_id = any(p_league_ids) and m.sleeper_roster_id is not null and r is not null;
$$;
revoke all on function league_illegal_rosters(uuid[]) from public, anon, authenticated;
grant execute on function league_illegal_rosters(uuid[]) to service_role;
