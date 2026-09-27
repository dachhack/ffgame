-- 0388 · A PLAYER WHO CAN'T BE MOVED CAN'T MAKE THE ROSTER ILLEGAL (v0.558.1)
--
-- Kickoff League, Friday night (#1028): "what is going on with Mooney's
-- starting line up? Any reason he can't make moves?"
--
-- roster_illegal_reason (0366) calls a roster illegal when a player on IR (or
-- in an OUT spot) is no longer designated for it — Friday's injury report
-- upgrades him, or his row leaves injury_status. An illegal roster locks
-- every lineup write (enforce_legal_roster, 0128) until it is fixed, and the
-- fix it names is "move him off IR or drop him".
--
-- In a classic league neither is possible once that player's game has kicked
-- off: enforce_classic_roster_lock (0179/0279) refuses any add, drop or move
-- of him for the rest of the week. So a Thursday player whose designation
-- lapsed on Friday froze his manager's whole lineup until the week went final,
-- with nothing the manager could do about it.
--
-- The fix is on the legality side, not the lock: the lock stays, because
-- letting a player who already played come off IR could hand his points to a
-- best-ball spot (the resolver reads native_roster). Instead a stashed player
-- whose game has already started is not counted against the roster this
-- week. He stays where he is, scores nothing, and the check comes back the
-- moment the next week goes live — then he's movable and the manager has to
-- act on him.
--
-- Body is 0366's with `and not classic_slug_started(...)` on the IR and OUT
-- queries. classic_slug_started is false outside classic leagues, so drip is
-- unchanged.

-- ── roster_illegal_reason — 0366's body, a locked stash excused ──
create or replace function roster_illegal_reason(p_league_id uuid, p_roster_id integer) returns text
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; cnt int; rec record; cap int; sh jsonb; seats int; tags text[]; mx int; feed boolean; dv int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return null; end if;
  sh := _roster_shape(p_league_id);
  dv := coalesce((sh ->> 'devy')::int, 0);

  -- ── 0366: a college player outside the devy spots ──
  if dv > 0 then
    select lp.full_name into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id
       and nr.slug ~ '^c-[0-9]+$' and nr.spot <> 'devy'
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is a college player outside the devy spots — move him to devy or drop him';
    end if;
  end if;

  -- ── a stashed player who no longer belongs there ──
  feed := exists (select 1 from injury_status limit 1);
  if feed then
    tags := league_ir_tags(p_league_id);
    select lp.full_name, coalesce(upper(i.status), '') as st into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      left join injury_status i on i.player_slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'ir'
       and not classic_slug_started(p_league_id, nr.slug)   -- 0388: can't be moved this week
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
       and not classic_slug_started(p_league_id, nr.slug)   -- 0388
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
    for rec in select s.spot, s.label from (values ('taxi', 'taxi squad'), ('ir', 'IR'), ('out', 'OUT'), ('devy', 'devy squad')) s(spot, label) loop
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
    where nr.league_id = p_league_id and nr.roster_id = p_roster_id
      and (dv = 0 or nr.spot <> 'devy') group by lp.pos
  loop
    cap := league_pos_cap(p_league_id, rec.pos);
    if cap is not null and rec.n > cap then
      return 'over the ' || pos_label(rec.pos) || ' limit (' || rec.n || '/' || cap || ') — drop ' || (rec.n - cap);
    end if;
  end loop;
  return null;
end $$;

