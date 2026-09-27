-- ═══════════════════════════════════════════════════════════════════════════
-- 0387 · DEVY SHARES — RIGHTS TO A COLLEGE PLAYER, BOUGHT WITH SHARES.
--
-- Founder: "a devy system where players allot shares to college players. If
-- they have 20 shares allotted to a player (the max) or are the only player
-- that has shares allotted to that college player, then they reserve the
-- right to draft that player during the rookie draft at any of their picks.
-- Shares are tradable and clear back to you once the player graduates."
-- Decisions: first to 20 holds the right; 100 shares a team; a sole holder
-- needs 5; allotments lock in January; a league setting.
--
-- ── THE SETTING ────────────────────────────────────────────────────────────
-- settings_json.devy_mode: 'spots' (0366, the default) or 'shares'
-- (set_league_devy_mode). Shares need COLLEGE on, the NFL calendar, no devy
-- spots and no college player on a roster. A shares league's POOL holds no
-- college players (a trigger drops them): they're share targets, read from
-- the college directory, not players anyone rosters.
--
-- ── HOLDINGS ───────────────────────────────────────────────────────────────
-- devy_share(lineage, roster_id, slug, shares, maxed_at). Keyed by the
-- league's LINEAGE (league.sleeper_league_id, which every season of a
-- league shares — 0182), so holdings carry through rollover untouched and
-- the rookie draft, which runs in next season's league row, reads them.
-- allot_devy_shares(league, roster, slug, n) sets one stake: 0..20, a team's
-- stakes total ≤ 100, active college players only, not after he graduates.
-- maxed_at is when the stake reached 20 — the queue for a contested player.
-- Holdings are public to the league: who else is in is the whole game.
--
-- ── THE RIGHT ──────────────────────────────────────────────────────────────
-- devy_share_rights(lineage): per college player, the team whose stake hit
-- 20 first; failing that, the ONLY team holding him, if it holds 5+.
--
-- ── THE LOCK ───────────────────────────────────────────────────────────────
-- From January 15 (Eastern) until the lineage's draft for that year's
-- season is complete, stakes can't change. Before that, allot freely.
--
-- ── THE DRAFT (snake / linear) ─────────────────────────────────────────────
-- A graduated player (player_alias: c-<id> → his NFL slug) in the pool is
-- RESERVED for the right's holder: nobody else may take him, by hand, queue
-- or autopick. The holder takes him with any pick; once the holder's picks
-- left equal his untaken reservations, those picks must be reservations,
-- and autopick makes them. Auction drafts don't reserve.
--
-- ── CLEARING ───────────────────────────────────────────────────────────────
-- When a shares league's draft completes, every stake on a graduated player
-- is deleted: the shares return to their teams' budgets. Chat says so.
-- Bodies copied from 0193 (native_exec_pick), 0067 (native_queue_pick) and
-- 0383 (native_autopick_slug) with only the marked 0387 changes.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists devy_share (
  lineage    text not null,
  roster_id  int  not null,
  slug       text not null check (slug ~ '^c-[0-9]+$'),
  shares     int  not null check (shares between 1 and 20),
  maxed_at   timestamptz,
  updated_at timestamptz not null default now(),
  primary key (lineage, roster_id, slug)
);
create index if not exists devy_share_slug on devy_share (lineage, slug);
alter table devy_share enable row level security;   -- read through devy_shares_state

create or replace function _lineage(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select sleeper_league_id from league where id = p_league_id
$$;

create or replace function _devy_shares_on(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select settings_json ->> 'devy_mode' from league where id = p_league_id), 'spots') = 'shares'
$$;

-- The budget, the cap and the sole-holder floor (the founder's numbers).
create or replace function _devy_share_rules() returns jsonb
  language sql immutable as $$ select '{"budget": 100, "max": 20, "floor": 5}'::jsonb $$;

-- When this year's lock began (Jan 15, Eastern), and whether it still holds.
create or replace function devy_shares_lock_at(p_now timestamptz default now()) returns timestamptz
  language sql stable as $$
  select make_timestamptz(extract(year from (p_now at time zone 'America/New_York'))::int, 1, 15, 0, 0, 0, 'America/New_York')
$$;
create or replace function _devy_shares_locked(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select now() >= devy_shares_lock_at()
     and not exists (
       select 1 from league l join draft d on d.league_id = l.id
        where l.sleeper_league_id = _lineage(p_league_id)
          and l.season = extract(year from (now() at time zone 'America/New_York'))::int::text
          and d.status = 'complete')
$$;

-- ── The rights ──
create or replace function devy_share_rights(p_lineage text)
  returns table (slug text, roster_id int, via text)
  language sql stable security definer set search_path = public as $$
  with maxed as (
    select distinct on (s.slug) s.slug, s.roster_id
      from devy_share s
     where s.lineage = p_lineage and s.shares >= (_devy_share_rules() ->> 'max')::int
     order by s.slug, s.maxed_at nulls last, s.roster_id
  ), sole as (
    select s.slug, min(s.roster_id) as roster_id
      from devy_share s where s.lineage = p_lineage
     group by s.slug
    having count(*) = 1 and max(s.shares) >= (_devy_share_rules() ->> 'floor')::int
  )
  select m.slug, m.roster_id, 'max' from maxed m
  union all
  select so.slug, so.roster_id, 'sole' from sole so where not exists (select 1 from maxed m where m.slug = so.slug)
$$;

-- The NFL players reserved in this league's pool: a right on a graduate.
create or replace function devy_reserved(p_league_id uuid)
  returns table (slug text, roster_id int, college_slug text)
  language sql stable security definer set search_path = public as $$
  select a.new_slug, r.roster_id, r.slug
    from devy_share_rights(_lineage(p_league_id)) r
    join player_alias a on a.old_slug = r.slug
   where _devy_shares_on(p_league_id)
     and exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = a.new_slug)
     and not exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = a.new_slug)
$$;

-- A seat's picks from the one on the clock to the end of the draft.
create or replace function _picks_left(p_d draft, p_roster int) returns int
  language plpgsql stable as $$
declare d2 draft; total int; o int; n int := 0; nteams int;
begin
  nteams := jsonb_array_length(p_d.draft_order);
  total := case when p_d.pick_owners is not null then jsonb_array_length(p_d.pick_owners)
                else (p_d.rounds - p_d.keeper_slots - p_d.stash_slots) * nteams end;
  d2 := p_d;
  for o in p_d.current_overall..coalesce(total, 0) loop
    d2.current_overall := o;
    if draft_on_clock(d2) = p_roster then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Must this seat's pick be one of its reservations? (picks left ≤ untaken)
create or replace function _devy_pick_forced(p_league_id uuid, p_roster int) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; mine int;
begin
  if not _devy_shares_on(p_league_id) then return false; end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.mode = 'auction' then return false; end if;
  select count(*) into mine from devy_reserved(p_league_id) r where r.roster_id = p_roster;
  return mine > 0 and _picks_left(d, p_roster) <= mine;
end $$;

-- ── The setting ──
create or replace function set_league_devy_mode(p_league_id uuid, p_mode text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; gone int := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode not in ('spots', 'shares') then
    return jsonb_build_object('ok', false, 'error', 'devy mode is spots or shares');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if p_mode = 'shares' then
    if not _league_has_college(lg.settings_json) then
      return jsonb_build_object('ok', false, 'error', 'devy shares need college players on in this league');
    end if;
    if league_is_college_calendar(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'devy shares are for leagues on the NFL schedule');
    end if;
    if _devy_slots(p_league_id) > 0 then
      return jsonb_build_object('ok', false, 'error', 'set the devy roster spots to 0 first — shares replace them');
    end if;
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug ~ '^c-[0-9]+$') then
      return jsonb_build_object('ok', false, 'error', 'drop the college players on rosters first — in a shares league nobody rosters them');
    end if;
    delete from league_pool lp where lp.league_id = p_league_id and lp.slug ~ '^c-[0-9]+$';
    get diagnostics gone = row_count;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('devy_mode', p_mode)
   where id = p_league_id;
  if coalesce(lg.settings_json ->> 'devy_mode', 'spots') <> p_mode then
    perform _chat_house(p_league_id,
      case when p_mode = 'shares'
        then 'Devy is now played with shares: every team has 100 to put on college players. Hit 20 first, or be the only one in with 5+, and he''s yours to draft when he turns pro.'
        else 'Devy is back to roster spots. Shares already placed stay put but no longer reserve anyone.' end,
      jsonb_build_object('kind', 'devy_mode', 'mode', p_mode));
  end if;
  return jsonb_build_object('ok', true, 'mode', p_mode, 'college_removed_from_pool', gone);
end $$;
grant execute on function set_league_devy_mode(uuid, text) to authenticated;

-- A shares league's pool never takes a college player (seed, top-up, anything).
create or replace function _pool_no_college_in_shares() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.slug ~ '^c-[0-9]+$' and _devy_shares_on(new.league_id) then return null; end if;
  return new;
end $$;
drop trigger if exists pool_no_college_in_shares on league_pool;
create trigger pool_no_college_in_shares before insert on league_pool
  for each row execute function _pool_no_college_in_shares();

-- ── Allotting ──
create or replace function allot_devy_shares(p_league_id uuid, p_roster_id int, p_slug text, p_shares int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lin text; cur int; others int; rules jsonb := _devy_share_rules(); n int := coalesce(p_shares, 0);
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your team');
  end if;
  if not _devy_shares_on(p_league_id) then return jsonb_build_object('ok', false, 'error', 'this league doesn''t play devy shares'); end if;
  if _devy_shares_locked(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'shares are locked from January 15 until the rookie draft is done — trade them instead');
  end if;
  if n < 0 or n > (rules ->> 'max')::int then
    return jsonb_build_object('ok', false, 'error', 'a stake is 0 to ' || (rules ->> 'max') || ' shares');
  end if;
  if p_slug !~ '^c-[0-9]+$' or not exists (select 1 from college_player cp where cp.espn_id = substr(p_slug, 3) and cp.active) then
    return jsonb_build_object('ok', false, 'error', 'shares go on active college players');
  end if;
  if n > 0 and exists (select 1 from player_alias a where a.old_slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'he''s turned pro — his rights are settled at the draft');
  end if;
  lin := _lineage(p_league_id);
  perform pg_advisory_xact_lock(hashtext('devy_share:' || lin));
  select coalesce(sum(shares), 0) into others from devy_share
   where lineage = lin and roster_id = p_roster_id and slug <> p_slug;
  if others + n > (rules ->> 'budget')::int then
    return jsonb_build_object('ok', false, 'error',
      'that''s ' || (others + n) || ' shares — a team has ' || (rules ->> 'budget') || ' (' || ((rules ->> 'budget')::int - others) || ' free for him)');
  end if;
  select shares into cur from devy_share where lineage = lin and roster_id = p_roster_id and slug = p_slug;
  if n = 0 then
    delete from devy_share where lineage = lin and roster_id = p_roster_id and slug = p_slug;
  else
    insert into devy_share (lineage, roster_id, slug, shares, maxed_at, updated_at)
    values (lin, p_roster_id, p_slug, n, case when n >= (rules ->> 'max')::int then clock_timestamp() end, now())
    on conflict (lineage, roster_id, slug) do update set
      shares = excluded.shares,
      -- the place in line is kept while the stake stays at the max
      maxed_at = case when excluded.shares >= (rules ->> 'max')::int then coalesce(devy_share.maxed_at, clock_timestamp()) end,
      updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'shares', n, 'used', others + n, 'budget', (rules ->> 'budget')::int,
    'right', (select to_jsonb(r) from devy_share_rights(lin) r where r.slug = p_slug));
end $$;
grant execute on function allot_devy_shares(uuid, int, text, int) to authenticated;

-- ── The read ──
create or replace function devy_shares_state(p_league_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $$
  with lin as (select _lineage(p_league_id) as l),
  rights as (select * from devy_share_rights((select l from lin))),
  held as (
    select s.slug, jsonb_agg(jsonb_build_object('roster_id', s.roster_id, 'shares', s.shares, 'maxed_at', s.maxed_at,
             'team', coalesce(m.team_name, 'Team ' || s.roster_id)) order by s.shares desc, s.maxed_at nulls last, s.roster_id) as holders
      from devy_share s
      left join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = s.roster_id
     where s.lineage = (select l from lin)
     group by s.slug)
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then jsonb_build_object('ok', false, 'error', 'forbidden')
    else jsonb_build_object('ok', true,
      'on', _devy_shares_on(p_league_id),
      'locked', _devy_shares_locked(p_league_id),
      'lock_at', devy_shares_lock_at(),
      'rules', _devy_share_rules(),
      'used', coalesce((select jsonb_object_agg(u.roster_id::text, u.total) from (
                 select roster_id, sum(shares)::int as total from devy_share where lineage = (select l from lin) group by roster_id) u), '{}'::jsonb),
      'players', coalesce((select jsonb_agg(jsonb_build_object(
          'slug', h.slug, 'name', cp.full_name, 'pos', cp.pos, 'school', cp.school_abbr, 'class_year', cp.class_year,
          'graduated_to', (select a.new_slug from player_alias a where a.old_slug = h.slug),
          'holders', h.holders,
          'right', (select jsonb_build_object('roster_id', r.roster_id, 'via', r.via) from rights r where r.slug = h.slug))
          order by cp.full_name)
        from held h left join college_player cp on cp.espn_id = substr(h.slug, 3)), '[]'::jsonb),
      'reserved', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'roster_id', r.roster_id, 'college_slug', r.college_slug))
        from devy_reserved(p_league_id) r), '[]'::jsonb))
  end
$$;
grant execute on function devy_shares_state(uuid) to authenticated;

-- ── Clearing: the shares come home once the draft is done ──
create or replace function _devy_shares_clear_on_draft() returns trigger
  language plpgsql security definer set search_path = public as $$
declare n int; k int;
begin
  if new.status = 'complete' and old.status is distinct from 'complete' and _devy_shares_on(new.league_id) then
    select count(distinct s.slug), coalesce(sum(s.shares), 0) into k, n from devy_share s
     where s.lineage = _lineage(new.league_id) and exists (select 1 from player_alias a where a.old_slug = s.slug);
    delete from devy_share s
     where s.lineage = _lineage(new.league_id) and exists (select 1 from player_alias a where a.old_slug = s.slug);
    if k > 0 then
      perform _chat_house(new.league_id,
        'The draft is done: ' || n || ' shares on ' || k || ' player' || case when k = 1 then '' else 's' end
          || ' who turned pro went back to their teams.',
        jsonb_build_object('kind', 'devy_shares_cleared', 'players', k, 'shares', n));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists devy_shares_clear_on_draft on draft;
create trigger devy_shares_clear_on_draft after update of status on draft
  for each row execute function _devy_shares_clear_on_draft();

-- ── native_exec_pick — 0193's body, plus the reservations ──
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int; err text; total int; resv int;
begin
  select * into d from draft where league_id = p_league_id;
  if d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  n := jsonb_array_length(d.draft_order);
  rnd := ((d.current_overall - 1) / n) + 1;
  total := case when d.pick_owners is not null then jsonb_array_length(d.pick_owners)
                else (d.rounds - d.keeper_slots - d.stash_slots) * n end;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  if not p_auto then
    err := pos_cap_error(p_league_id, oc, p_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end if;
  -- 0387: DEVY SHARES. A reserved player is his right-holder's alone, and a
  -- holder whose picks left equal his untaken reservations must take them.
  if d.mode <> 'auction' and _devy_shares_on(p_league_id) then
    select r.roster_id into resv from devy_reserved(p_league_id) r where r.slug = p_slug;
    if resv is not null and resv <> oc then
      return jsonb_build_object('ok', false, 'error',
        'reserved: ' || coalesce((select team_name from league_membership where league_id = p_league_id and sleeper_roster_id = resv), 'Team ' || resv)
        || ' holds his devy rights');
    end if;
    if resv is null and _devy_pick_forced(p_league_id, oc) then
      return jsonb_build_object('ok', false, 'error',
        'your remaining picks go to your reserved players: ' || coalesce((select string_agg(lp.full_name, ', ' order by lp.rank)
          from devy_reserved(p_league_id) r join league_pool lp on lp.league_id = p_league_id and lp.slug = r.slug
          where r.roster_id = oc), ''));
    end if;
  end if;

  insert into draft_pick (league_id, overall, round, roster_id, slug, auto)
  values (p_league_id, d.current_overall, rnd, oc, p_slug, p_auto);
  insert into native_roster (league_id, roster_id, slug, acquired)
  values (p_league_id, oc, p_slug, 'draft');

  if d.current_overall >= total then
    update draft set status = 'complete', completed_at = now(), deadline_at = null,
      current_overall = d.current_overall + 1
      where league_id = p_league_id;
    perform native_materialize(p_league_id);
    return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc,
      'slug', p_slug, 'complete', true);
  end if;

  update draft set current_overall = d.current_overall + 1,
    deadline_at = draft_deadline(d, d.pick_seconds)
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc, 'slug', p_slug);
end $$;

-- ── native_queue_pick — 0067's body: a queue never names someone else's
-- reservation, and a seat that must take its own leaves it to autopick ──
create or replace function native_queue_pick(p_league_id uuid, p_roster_id int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text;
begin
  delete from draft_queue q where q.league_id = p_league_id and q.roster_id = p_roster_id
    and exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = q.slug);
  -- 0387
  if _devy_pick_forced(p_league_id, p_roster_id) then return null; end if;
  select q.slug into pick from draft_queue q
    where q.league_id = p_league_id and q.roster_id = p_roster_id
      and not exists (select 1 from auction_lot al where al.league_id = p_league_id and al.slug = q.slug)
      and pos_cap_error(p_league_id, p_roster_id, q.slug) is null
      -- 0387: not another team's reserved player
      and not exists (select 1 from devy_reserved(p_league_id) r where r.slug = q.slug and r.roster_id <> p_roster_id)
    order by q.pos limit 1;
  return pick;
end $$;

-- ── native_autopick_slug — 0383's body, plus the reservations ──
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  dv int := _devy_slots(p_league_id);
  taken text[];
  held jsonb; caps jsonb; spotn jsonb;
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int; cap_rb int; cap_wr int; cap_te int; cap_k int; cap_def int;
  remaining int; need_k boolean; need_def boolean; forced int; pick text; open jsonb;
begin
  -- Asked once per pick, not once per pool row (0380).
  taken := array(select nr.slug from native_roster nr where nr.league_id = p_league_id
                 union all select al.slug from auction_lot al where al.league_id = p_league_id);
  -- 0387: DEVY SHARES. A seat whose picks left equal its untaken
  -- reservations takes the best of them; nobody takes another's.
  if _devy_shares_on(p_league_id) then
    if _devy_pick_forced(p_league_id, p_roster_id) then
      select r.slug into pick from devy_reserved(p_league_id) r
        join league_pool lp on lp.league_id = p_league_id and lp.slug = r.slug
       where r.roster_id = p_roster_id order by lp.rank limit 1;
      if pick is not null then return pick; end if;
    end if;
    taken := taken || array(select r.slug from devy_reserved(p_league_id) r where r.roster_id <> p_roster_id);
  end if;
  select coalesce(jsonb_object_agg(p.pos, league_pos_cap(p_league_id, p.pos)), '{}'::jsonb) into caps
    from (select distinct lp.pos from league_pool lp where lp.league_id = p_league_id) p;
  select coalesce(jsonb_object_agg(h.pos, h.n), '{}'::jsonb), coalesce(sum(h.n), 0)::int into held, total from (
    select lp.pos, count(*)::int as n from native_roster nr
      join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id
       and (dv = 0 or nr.spot <> 'devy')
     group by lp.pos) h;
  qb_n := coalesce((held ->> 'QB')::int, 0); rb_n := coalesce((held ->> 'RB')::int, 0);
  wr_n := coalesce((held ->> 'WR')::int, 0); te_n := coalesce((held ->> 'TE')::int, 0);
  k_n := coalesce((held ->> 'K')::int, 0);   def_n := coalesce((held ->> 'DEF')::int, 0);
  cap_qb := league_pos_cap(p_league_id, 'QB'); cap_rb := league_pos_cap(p_league_id, 'RB');
  cap_wr := league_pos_cap(p_league_id, 'WR'); cap_te := league_pos_cap(p_league_id, 'TE');
  cap_k  := league_pos_cap(p_league_id, 'K');  cap_def := league_pos_cap(p_league_id, 'DEF');

  -- 0381: how many starting spots take each position (a builder league).
  select jsonb_object_agg(x.pos, x.n) into spotn from (
    select p.pos, count(*)::int as n
      from jsonb_array_elements(coalesce((select settings_json -> 'roster_slots' from league where id = p_league_id), '[]'::jsonb)) s(spot)
      cross join lateral jsonb_array_elements_text(s.spot -> 'pos') p(pos)
     group by p.pos) x;

  remaining := p_rounds - total - dv;
  -- 0366: the devy spots are their own shelf, filled once the NFL spots are.
  if remaining <= 0 and _devy_open(p_league_id, p_roster_id) > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id and lp.level = 'college' and not (lp.slug = any(taken))
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;
  need_k   := k_n = 0 and coalesce(cap_k, 1) >= 1;
  need_def := def_n = 0 and coalesce(cap_def, 1) >= 1;
  forced := (case when need_k then 1 else 0 end) + (case when need_def then 1 else 0 end);

  if remaining <= forced and forced > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and lp.pos = (case when need_k then 'K' else 'DEF' end)
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  -- 0377: THE LINEUP BEFORE THE BENCH, within the caps.
  open := _autopick_open_spots(p_league_id, p_roster_id);
  if open is not null and jsonb_array_length(open) > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
      and coalesce((caps ->> lp.pos)::int, 1000) > coalesce((held ->> lp.pos)::int, 0)
      and exists (select 1 from jsonb_array_elements(open) o where _autopick_spot_fits(o.value, lp.pos, lp.level, lp.team, lp.exp, lp.slug))
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  -- 0381: THE BENCH IS A DEPTH CHART, NOT A QUEUE. A position stops at twice
  -- the starting spots that take it (one QB spot → two QBs) while anything
  -- else is on the board — then the rank pick below is free again.
  if spotn is not null then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
      and coalesce((caps ->> lp.pos)::int, 1000) > coalesce((held ->> lp.pos)::int, 0)
      and (spotn ->> lp.pos) is not null
      and coalesce((held ->> lp.pos)::int, 0) < 2 * (spotn ->> lp.pos)::int
      and lp.pos not in ('K', 'DEF')
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not (lp.slug = any(taken))
    and (dv = 0 or lp.level = 'nfl')
    and (   (lp.pos = 'QB'  and (cap_qb  is null or qb_n  < cap_qb))
         or (lp.pos = 'RB'  and (cap_rb  is null or rb_n  < cap_rb))
         or (lp.pos = 'WR'  and (cap_wr  is null or wr_n  < cap_wr))
         or (lp.pos = 'TE'  and (cap_te  is null or te_n  < cap_te))
         or (lp.pos = 'K'   and (cap_k   is null or k_n   < cap_k))
         or (lp.pos = 'DEF' and (cap_def is null or def_n < cap_def))
         -- extras (IDP / FB / HC / P) are uncapped here, as before
         or lp.pos not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF'))
  order by lp.rank limit 1;
  if pick is not null then return pick; end if;

  -- Caps exhausted the board — the best free player, never a banned (cap 0) position (0195).
  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not (lp.slug = any(taken))
    and (dv = 0 or lp.level = 'nfl')
    and coalesce((caps ->> lp.pos)::int, 1) > 0
  order by lp.rank limit 1;
  return pick;
end $$;

-- A shares league is not MIXED (0372): its college players are share targets,
-- never rostered, so nothing about lineups or college scoring applies.
create or replace function league_is_mixed(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select _league_has_college(settings_json)
       and coalesce(settings_json ->> 'calendar', 'nfl') = 'nfl'
       and coalesce((settings_json -> 'roster_shape' ->> 'devy')::int, 0) = 0
       and coalesce(settings_json ->> 'devy_mode', 'spots') <> 'shares'   -- 0387
      from league where id = p_league_id), false)
$$;
