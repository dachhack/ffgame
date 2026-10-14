-- 0500: COPIES OF EVERY PLAYER (v0.709.0), part 1 — the database.
--
-- Founder: "Let's build multiple copies of all players as an option. 1-4
-- copies." Decided with the founder:
--   • up to N DIFFERENT teams may roster the same player (stacking copies on
--     one team is a commissioner option that comes next, off by default);
--   • the commissioner sets N before the draft and it locks when the draft
--     starts;
--   • a league with copies leaves out, for now, the features that assume one
--     owner per player: contracts / salary cap, college players (devy),
--     guillotine, vampire, shotgun wedding, and auction drafts.
--
-- With copies = 1 — every league today — every check below reads exactly as
-- it did: `_copy_open` is "nobody owns him", `_copy_refusal` keeps each old
-- message, and the roster key moves from (league, player) to (league, team,
-- player) without a row changing.
--
-- What changes:
--   • native_roster's key → (league_id, roster_id, slug), plus a lookup index
--     on (league_id, slug); keeper_pick follows (two teams may keep their own
--     copy) and its foreign key points at the new key.
--   • league_copies / _copy_open / _copy_refusal / _copy_holder — the one
--     vocabulary every "is he available" question now asks.
--   • set_league_copies (commissioner, before the draft), and the league
--     backstop trigger refusing a NEW combination of copies with a feature
--     that assumes one owner.
--   • 28 functions whose "already rostered" / "who owns him" / per-player
--     lookups count copies (bodies copied from their live definitions, one
--     marked change each — see each block), and four that now take the team:
--     set_roster_spot, swap_roster_spot, commish_move_player,
--     commish_remove_player (the old signatures dropped, so the API has one
--     function to choose; without the team they act on the caller's own copy,
--     or the only holder, or refuse when it is ambiguous).

-- ══ the vocabulary ═══════════════════════════════════════════════════════════
create or replace function league_copies(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select greatest(1, least(4, coalesce(nullif(settings_json ->> 'copies', '')::int, 1))) from league where id = p_league_id;
$$;
grant execute on function league_copies(uuid) to authenticated;

-- A copy left, and (given a team) not one that team already holds.
create or replace function _copy_open(p_league_id uuid, p_slug text, p_roster_id int default null) returns boolean
  language sql stable security definer set search_path = public as $$
  select (select count(*) from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug)
           < coalesce(league_copies(p_league_id), 1)
     and (p_roster_id is null or not exists (select 1 from native_roster nr
            where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.slug = p_slug));
$$;

-- Why not: the old words in a one-copy league, the copy words otherwise.
create or replace function _copy_refusal(p_league_id uuid, p_slug text, p_roster_id int, p_one text) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when coalesce(league_copies(p_league_id), 1) = 1 then p_one
    when p_roster_id is not null and exists (select 1 from native_roster nr
           where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.slug = p_slug)
      then 'that team already has ' || _txn_player(p_league_id, p_slug)
    else 'every copy of ' || _txn_player(p_league_id, p_slug) || ' is taken (' || league_copies(p_league_id) || ' copies)' end;
$$;

-- Which team's copy a player-only call means: the team asked for; else the
-- caller's own copy (p_mine); else the only holder; else null (none, or ambiguous).
create or replace function _copy_holder(p_league_id uuid, p_slug text, p_want int default null, p_mine boolean default true) returns int
  language plpgsql stable security definer set search_path = public as $$
declare r int; n int;
begin
  if p_want is not null then
    return (select nr.roster_id from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug and nr.roster_id = p_want);
  end if;
  select count(*), min(nr.roster_id) into n, r from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug;
  if n <= 1 then return r; end if;
  if p_mine then
    select nr.roster_id into r from native_roster nr
     where nr.league_id = p_league_id and nr.slug = p_slug and owns_roster(p_league_id, nr.roster_id)
     order by nr.roster_id limit 1;
    return r;
  end if;
  return null;
end $$;
revoke all on function _copy_open(uuid, text, int), _copy_refusal(uuid, text, int, text), _copy_holder(uuid, text, int, boolean) from public, anon, authenticated;

-- What a league with copies can't have yet, or null.
create or replace function _copies_conflict(p_settings jsonb) returns text
  language sql immutable as $$
  select case
    when p_settings ->> 'salary_cap' is not null then 'contracts and the salary cap'
    when _league_has_college(p_settings) then 'college players'
    when coalesce(p_settings ->> 'format', 'standard') in ('guillotine', 'vampire') then (p_settings ->> 'format') || ' leagues'
    when coalesce((p_settings ->> 'shotgun_wedding')::boolean, false) then 'shotgun wedding'
  end;
$$;
revoke all on function _copies_conflict(jsonb) from public, anon, authenticated;

-- ══ the commissioner's setting ═══════════════════════════════════════════════
create or replace function set_league_copies(p_league_id uuid, p_copies int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; d draft%rowtype; why text;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or coalesce(lg.provider, '') <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'copies are for leagues drafted here');
  end if;
  if p_copies is null or p_copies < 1 or p_copies > 4 then
    return jsonb_build_object('ok', false, 'error', 'copies are 1 to 4');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'copies are set before the draft starts — they lock with it');
  end if;
  if p_copies > 1 then
    if d.mode = 'auction' then
      return jsonb_build_object('ok', false, 'error', 'copies need a snake or linear draft — an auction holds one lot per player');
    end if;
    why := _copies_conflict(coalesce(lg.settings_json, '{}'::jsonb));
    if why is not null then
      return jsonb_build_object('ok', false, 'error', 'copies can''t be combined with ' || why || ' yet');
    end if;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('copies', p_copies)
   where id = p_league_id;
  return jsonb_build_object('ok', true, 'copies', p_copies);
end $$;
revoke all on function set_league_copies(uuid, int) from public, anon;
grant execute on function set_league_copies(uuid, int) to authenticated;

-- ══ the keys ═════════════════════════════════════════════════════════════════
alter table keeper_pick drop constraint if exists keeper_pick_league_id_slug_fkey;
alter table keeper_pick drop constraint if exists keeper_pick_pkey;
alter table native_roster drop constraint if exists native_roster_pkey;
alter table native_roster add primary key (league_id, roster_id, slug);
create index if not exists native_roster_slug on native_roster(league_id, slug);
alter table keeper_pick add primary key (league_id, roster_id, slug);
alter table keeper_pick add constraint keeper_pick_roster_fkey
  foreign key (league_id, roster_id, slug) references native_roster(league_id, roster_id, slug) on delete cascade;

-- ══ the backstop ═══════════════════════════════════════════════════════════════
create or replace function _league_college_is_classic() returns trigger
  language plpgsql as $$
begin
  if _league_has_college(new.settings_json)
     and coalesce(new.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    raise exception 'a league with college players must be classic (0365)';
  end if;
  -- 0371: the college calendar needs college players, and has no devy spots
  -- (devy is an NFL league's shelf).
  if coalesce(new.settings_json ->> 'calendar', 'nfl') = 'college' then
    if not _league_has_college(new.settings_json) then
      raise exception 'a college-calendar league needs college players turned on (0371)';
    end if;
    if coalesce((new.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0 then
      raise exception 'a college-calendar league has no devy spots (0371)';
    end if;
  end if;
  -- 0372/0440: a spot with a level belongs to a league where college players
  -- score on the NFL calendar. The college calendar or COLLEGE off would
  -- leave it meaningless; devy spots no longer would.
  if jsonb_path_exists(coalesce(new.settings_json -> 'roster_slots', '[]'::jsonb), '$[*] ? (exists(@.level))')
     and not (_league_has_college(new.settings_json)
              and coalesce(new.settings_json ->> 'calendar', 'nfl') = 'nfl') then
    raise exception 'NFL/college spots need college players on and the NFL calendar (0372)';
  end if;
  -- 0442: the seasons rule, as a backstop for every writer. Only a NEW
  -- violation raises — a league already in the state keeps working.
  -- 0496: not for a practice room. A mock never sees a second season, so
  -- "starts over every season" has nothing to protect, and a room opened from
  -- a keeper or dynasty league with a taxi squad copies that shape (0282).
  if _league_seasons_rule(new.settings_json) is not null
     and not coalesce(new.is_mock, false)
     and (tg_op = 'INSERT' or _league_seasons_rule(old.settings_json) is null) then
    raise exception '%', _league_seasons_rule(new.settings_json);
  end if;
  -- 0500: copies (2–4) leave out what assumes one owner per player. Only a NEW
  -- combination raises — a league already in the state keeps working.
  if coalesce(nullif(new.settings_json ->> 'copies', '')::int, 1) > 1
     and _copies_conflict(new.settings_json) is not null
     and (tg_op = 'INSERT' or coalesce(nullif(old.settings_json ->> 'copies', '')::int, 1) <= 1
          or _copies_conflict(old.settings_json) is null) then
    raise exception 'a league with copies can''t have % yet (0500)', _copies_conflict(new.settings_json);
  end if;
  return new;
end $$;

-- ══ the functions that count copies ═══════════════════════════════════════════
-- ── _exec_pick_0460 (0411 native_exec_pick) ───────────────────────────────
create or replace function _exec_pick_0460(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int; err text; total int; resv int; in_devy boolean;
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
  if not _copy_open(p_league_id, p_slug, oc) then   -- 0500: a copy left, and not one this seat holds
    return jsonb_build_object('ok', false, 'error', _copy_refusal(p_league_id, p_slug, oc, 'player already rostered'));
  end if;
  -- 0411: THE DEVY BLOCK. Its picks are college players and only college
  -- players; the rounds before it are NFL rounds. A devy pick may land past a
  -- full devy shelf — the same over-limit rule a team that traded for extra
  -- picks lives with: it drops one before its moves unfreeze.
  in_devy := d.devy_from is not null and d.current_overall >= d.devy_from;
  if d.devy_from is not null then
    if in_devy and p_slug !~ '^c-[0-9]+$' then
      return jsonb_build_object('ok', false, 'error', 'this is a devy round — pick a college player');
    end if;
    if not in_devy and p_slug ~ '^c-[0-9]+$' then
      return jsonb_build_object('ok', false, 'error',
        'college players go in the devy rounds — they start at pick ' || d.devy_from);
    end if;
  end if;
  if not p_auto and not in_devy then
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

-- ── _autopick_slug_0460 (0411 native_autopick_slug) ───────────────────────
create or replace function _autopick_slug_0460(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text; lvl text := _draft_pick_level(p_league_id);
begin
  -- 0411: in the devy block, the best college player left.
  if lvl = 'college' then
    select lp.slug into pick from league_pool lp
     where lp.league_id = p_league_id and lp.level = 'college'
       and _copy_open(lp.league_id, lp.slug, p_roster_id)
     order by lp.rank, lp.slug limit 1;
    return pick;
  end if;
  pick := _autopick_slug_0387(p_league_id, p_roster_id, p_rounds);
  -- before it, never a college player (the shelf fills in the block)
  if lvl = 'nfl' and pick ~ '^c-[0-9]+$' then
    select lp.slug into pick from league_pool lp
     where lp.league_id = p_league_id and lp.level = 'nfl'
       and _copy_open(lp.league_id, lp.slug, p_roster_id)
       and coalesce(league_pos_cap(p_league_id, lp.pos), 1) > 0
     order by lp.rank, lp.slug limit 1;
  end if;
  return pick;
end $$;

-- ── native_autopick_slug (0460) ───────────────────────────────────────────
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text; alt text; lvl text := _draft_pick_level(p_league_id);
begin
  pick := _autopick_slug_0460(p_league_id, p_roster_id, p_rounds);
  if not exists (select 1 from seat_player_rule where league_id = p_league_id and roster_id = p_roster_id) then
    return pick;
  end if;
  if pick is not null and seat_rule_error(p_league_id, p_roster_id, pick) is null then return pick; end if;
  select lp.slug into alt from league_pool lp
   where lp.league_id = p_league_id
     and (lvl is null or lp.level = lvl)
     and _copy_open(lp.league_id, lp.slug, p_roster_id)
     and coalesce(league_pos_cap(p_league_id, lp.pos), 1) > 0
     and seat_rule_error(p_league_id, p_roster_id, lp.slug) is null
   order by lp.rank, lp.slug limit 1;
  return coalesce(alt, pick);
end $$;

-- ── _autopick_slug_0387 (0449) ────────────────────────────────────────────
create or replace function _autopick_slug_0387(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  dv int := _devy_slots(p_league_id);
  mixed boolean := league_is_mixed(p_league_id);   -- 0440
  -- 0441: the IR/OUT spots the draft never fills (0193), and the college
  -- starting spots' own depth.
  stash int := coalesce((select d.stash_slots from draft d where d.league_id = p_league_id), 0);
  cspots int := 0; college_held int := 0;
  taken text[];
  held jsonb; caps jsonb; spotn jsonb;
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int; cap_rb int; cap_wr int; cap_te int; cap_k int; cap_def int;
  remaining int; need_k boolean; need_def boolean; forced int; pick text; open jsonb;
begin
  -- Asked once per pick, not once per pool row (0380).
  -- 0500: taken = no copy left for this seat (every copy owned, or it holds one)
  taken := array(select lp.slug from league_pool lp where lp.league_id = p_league_id
                   and not _copy_open(p_league_id, lp.slug, p_roster_id)
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
  -- 0441: a college-only spot (a level, a conference or a class rule) is not
  -- NFL depth — it counts toward the college depth below instead.
  -- 0449: the league's EFFECTIVE lineup — the builder spec, else the 0161
  -- counts, else the default nine — never only the spec.
  select jsonb_object_agg(x.pos, x.n) into spotn from (
    select p.pos, count(*)::int as n
      from jsonb_array_elements(_league_slot_spec(p_league_id)) s(spot)
      cross join lateral jsonb_array_elements_text(s.spot -> 'pos') p(pos)
     where not _spot_takes_college_only(s.spot)
     group by p.pos) x;
  select count(*) into cspots
    from jsonb_array_elements(_league_slot_spec(p_league_id)) s(spot)
   where _spot_takes_college_only(s.spot);
  select count(*) into college_held from native_roster nr
   where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.slug ~ '^c-[0-9]+$' and nr.spot <> 'devy';

  -- 0441: the picks LEFT are the rounds the draft fills — not the IR/OUT
  -- stash it never does (0193). Counted against the full roster size, a
  -- league with IR spots never reached the last-rounds K/DEF fill below.
  remaining := p_rounds - stash - total - dv;
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
      -- 0440: in a mixed league a college player may fill an open COLLEGE
      -- starting spot now (college rows rank after every NFL row, so he is
      -- taken only when no NFL player fits what is open); the bench and the
      -- rank picks below stay NFL, and the devy shelf fills last as before.
      and (dv = 0 or lp.level = 'nfl' or mixed)
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

  -- 0441: COLLEGE DEPTH. In a mixed league a college starting spot earns
  -- the two-deep the NFL positions get (0381); without this the autodraft
  -- took exactly one college player per spot and never another — college
  -- rows rank after every NFL row, so no rank pick ever reached one.
  if mixed and cspots > 0 and college_held < 2 * cspots then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id and lp.level = 'college' and not (lp.slug = any(taken))
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

-- ── _queue_pick_0460 (0411 native_queue_pick) ─────────────────────────────
create or replace function _queue_pick_0460(p_league_id uuid, p_roster_id int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text; lvl text;
begin
  pick := _queue_pick_0387(p_league_id, p_roster_id);
  lvl := _draft_pick_level(p_league_id);
  -- 0411: a queued player this pick can't take is skipped; autopick answers.
  if pick is not null and lvl is not null and (pick ~ '^c-[0-9]+$') <> (lvl = 'college') then
    select q.slug into pick from draft_queue q
      join league_pool lp on lp.league_id = q.league_id and lp.slug = q.slug
     where q.league_id = p_league_id and q.roster_id = p_roster_id and lp.level = lvl
       and _copy_open(q.league_id, q.slug, p_roster_id)
       and (lvl = 'college' or pos_cap_error(p_league_id, p_roster_id, q.slug) is null)
     order by q.pos limit 1;
  end if;
  return pick;
end $$;

-- ── native_queue_pick (0460) ──────────────────────────────────────────────
create or replace function native_queue_pick(p_league_id uuid, p_roster_id int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text; lvl text;
begin
  pick := _queue_pick_0460(p_league_id, p_roster_id);
  if pick is null or seat_rule_error(p_league_id, p_roster_id, pick) is null then return pick; end if;
  lvl := _draft_pick_level(p_league_id);
  select q.slug into pick from draft_queue q
    join league_pool lp on lp.league_id = q.league_id and lp.slug = q.slug
   where q.league_id = p_league_id and q.roster_id = p_roster_id
     and (lvl is null or lp.level = lvl)
     and _copy_open(q.league_id, q.slug, p_roster_id)
     and pos_cap_error(p_league_id, p_roster_id, q.slug) is null
   order by q.pos limit 1;
  return pick;
end $$;

-- ── _queue_pick_0387 (0387 native_queue_pick) ─────────────────────────────
create or replace function _queue_pick_0387(p_league_id uuid, p_roster_id int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text;
begin
  delete from draft_queue q where q.league_id = p_league_id and q.roster_id = p_roster_id
    and not _copy_open(p_league_id, q.slug, p_roster_id);
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

-- ── set_draft_queue (0228) ────────────────────────────────────────────────
create or replace function set_draft_queue(p_league_id uuid, p_roster_id int, p_slugs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; maxes jsonb;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_slugs is null or jsonb_typeof(p_slugs) <> 'array' or jsonb_array_length(p_slugs) > 100 then
    return jsonb_build_object('ok', false, 'error', 'queue must be a list of up to 100 players');
  end if;
  -- 0228: the client replaces the WHOLE queue on every add/remove/reorder —
  -- standing maxes must ride across the replace, not die with the old rows.
  select coalesce(jsonb_object_agg(q.slug, q.max_bid), '{}'::jsonb) into maxes
  from draft_queue q
  where q.league_id = p_league_id and q.roster_id = p_roster_id and q.max_bid is not null;
  delete from draft_queue where league_id = p_league_id and roster_id = p_roster_id;
  insert into draft_queue (league_id, roster_id, slug, pos)
  select p_league_id, p_roster_id, t.slug, min(t.ord)
  from jsonb_array_elements_text(p_slugs) with ordinality as t(slug, ord)
  where exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = t.slug)
    and _copy_open(p_league_id, t.slug, p_roster_id)
  group by t.slug;
  get diagnostics n = row_count;
  update draft_queue set max_bid = (maxes ->> slug)::int
    where league_id = p_league_id and roster_id = p_roster_id and maxes ? slug;
  return jsonb_build_object('ok', true, 'queued', n);
end $$;

-- ── commish_edit_pick (0194) ──────────────────────────────────────────────
create or replace function commish_edit_pick(p_league_id uuid, p_overall int, p_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; pk draft_pick%rowtype; err text; old_slug text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status not in ('live', 'complete') then
    return jsonb_build_object('ok', false, 'error', 'the draft has not started');
  end if;

  select * into pk from draft_pick where league_id = p_league_id and overall = p_overall;
  if not found then return jsonb_build_object('ok', false, 'error', 'no pick at that overall'); end if;
  old_slug := pk.slug;

  -- ── REMOVE ────────────────────────────────────────────────────────────────
  if p_slug is null then
    delete from draft_pick where league_id = p_league_id and overall = p_overall;
    delete from native_roster
      where league_id = p_league_id and roster_id = pk.roster_id and slug = old_slug and acquired = 'draft';
    perform native_materialize(p_league_id);
    return jsonb_build_object('ok', true, 'action', 'removed', 'overall', p_overall,
      'roster_id', pk.roster_id, 'slug', old_slug);
  end if;

  -- ── REPLACE ───────────────────────────────────────────────────────────────
  if p_slug = old_slug then
    return jsonb_build_object('ok', false, 'error', 'that is already the pick');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in this league''s pool');
  end if;
  if not _copy_open(p_league_id, p_slug, pk.roster_id) then
    return jsonb_build_object('ok', false, 'error', _copy_refusal(p_league_id, p_slug, pk.roster_id, 'that player is already on a roster'));
  end if;

  -- The cap check has to see the seat as it WILL be, or swapping a QB for a QB
  -- would fail on a league with a QB limit. `pos_cap_error` already takes the
  -- player being replaced (0071's p_exclude_slug), so nothing has to be deleted
  -- and put back to ask the question — and a refused edit changes nothing.
  err := pos_cap_error(p_league_id, pk.roster_id, p_slug, false, old_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  delete from native_roster
    where league_id = p_league_id and roster_id = pk.roster_id and slug = old_slug and acquired = 'draft';
  insert into native_roster (league_id, roster_id, slug, acquired)
    values (p_league_id, pk.roster_id, p_slug, 'draft');
  update draft_pick set slug = p_slug, auto = false
    where league_id = p_league_id and overall = p_overall;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'action', 'replaced', 'overall', p_overall,
    'roster_id', pk.roster_id, 'slug', p_slug, 'was', old_slug);
end $$;

-- ── _start_draft_now (0411) ───────────────────────────────────────────────
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
  lseas text; owners jsonb := null; total_picks int; maxr int; r int; orig int; snake_kind boolean;
  pool_n int; vamps int[]; v int;
  dvr int; mainr int; dfrom int;   -- 0411
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  -- 0500: an auction holds one lot per player — copies draft snake or linear.
  if d.mode = 'auction' and coalesce(league_copies(p_league_id), 1) > 1 then
    return jsonb_build_object('ok', false, 'error', 'a league with copies drafts snake or linear — set copies to 1 for an auction');
  end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;
  -- 0411: THE DEVY ROUNDS. What this draft runs: its main rounds, then the
  -- devy block (none in an auction).
  select pl.main, pl.devy into mainr, dvr from _draft_plan(p_league_id) pl;
  if mainr < 1 and dvr < 1 then
    return jsonb_build_object('ok', false, 'error',
      'no rounds left to draft — keepers and IR spots fill the whole roster');
  end if;

  -- 0268: vampires appointed before the draft never enter it — they build
  -- from what the drafting teams leave in the pool.
  vamps := case when league_format(p_league_id) = 'vampire'
                then coalesce(vampire_seats(p_league_id), '{}') else '{}'::int[] end;
  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id
      and not (sleeper_roster_id = any(vamps));
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  if p_order is not null then
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v2.x) from (select (jsonb_array_elements_text(p_order))::int as x) v2
        where v2.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  else
    -- a pre-set order (0176), but only if it still covers exactly these seats
    if d.draft_order is not null
      and jsonb_typeof(d.draft_order) = 'array'
      and jsonb_array_length(d.draft_order) = n
      and (select count(distinct v2.x) from (select (jsonb_array_elements_text(d.draft_order))::int as x) v2
           where v2.x = any(ids)) = n
    then
      ord := d.draft_order; preset := true;
    else
      select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
    end if;
  end if;

  -- Owned picks: this league's own season carries assets ⇒ an explicit
  -- per-overall owner list, each pick owned by its asset's holder.
  --
  -- WHICH WAY THE ROUNDS RUN IS THE ASSET'S KIND (0190). A ROOKIE pick means
  -- "round 3, Team X's slot", so its draft runs LINEAR — 0183's rule, and its
  -- reasoning: snaking would relabel that pick every other round. A STARTUP
  -- pick is a slot in a snake that managers already know the shape of, so its
  -- draft snakes. With every asset still at its original owner, the startup
  -- walk below reproduces the plain snake order EXACTLY, which is what lets a
  -- league turn pick trading on without changing how it drafts.
  select season into lseas from league where id = p_league_id;
  if d.mode = 'snake' and exists (select 1 from pick_asset pa
      where pa.league_id = p_league_id and pa.season = lseas and pa.round < 100) then
    -- 0411: the ROOKIE rounds are the assets under 100; devy rounds live at
    -- 101+ and run after them, below.
    select max(round) into maxr from pick_asset
      where league_id = p_league_id and season = lseas and round < 100;
    select bool_or(kind = 'startup') into snake_kind from pick_asset
      where league_id = p_league_id and season = lseas and round < 100;
    owners := '[]'::jsonb;
    for r in 1..maxr loop
      for i in 0..(n - 1) loop
        -- even rounds reverse, but only for a startup draft
        orig := (ord ->> (case when coalesce(snake_kind, false) and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    mainr := maxr;
    -- 0411: the devy block — linear like the rookie rounds, each pick its
    -- asset's owner (round 100 + k), or the slot's own team without one.
    for r in 1..dvr loop
      for i in 0..(n - 1) loop
        orig := (ord ->> (case when coalesce(snake_kind, false) and (maxr + r) % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = 100 + r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  elsif dvr > 0 then
    -- 0411: no assets, but a devy block: the plain order, written out, so the
    -- draft's length and the block's start are explicit.
    owners := '[]'::jsonb;
    for r in 1..(greatest(mainr, 0) + dvr) loop
      for i in 0..(n - 1) loop
        orig := (ord ->> (case when d.mode <> 'linear' and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(orig);
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  else
    total_picks := (d.rounds - d.keeper_slots - d.stash_slots) * n;
  end if;
  dfrom := case when dvr > 0 then greatest(mainr, 0) * n + 1 end;

  -- THE POOL HAS TO FILL THE DRAFT — the check that was already doing the work
  -- the round cap got the credit for. What changes in 0192 is that it SAYS THE
  -- NUMBERS: at 25 rounds "pool smaller than the draft" was a nudge, at 99 it
  -- has to tell you whether to trim one round or forty.
  -- 0500: with copies the pool fills the draft N times over — count the copies left.
  select coalesce(sum(greatest(0, coalesce(league_copies(p_league_id), 1)
           - (select count(*) from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug))), 0)::int
    into pool_n from league_pool lp
    where lp.league_id = p_league_id;
  if pool_n < total_picks then
    return jsonb_build_object('ok', false, 'error',
      format('pool smaller than the draft — it needs %s picks (%s rounds x %s teams) and the pool holds %s players; lower the roster size or re-seed a bigger pool',
             total_picks, total_picks / n, n, pool_n));
  end if;
  -- 0411: the devy block needs college players to take
  if dvr > 0 and (select count(*) from league_pool lp where lp.league_id = p_league_id and lp.level = 'college'
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)) < dvr * n then
    return jsonb_build_object('ok', false, 'error',
      format('the devy rounds need %s college players and the pool has fewer — re-seed with college players on', dvr * n));
  end if;

  update draft set status = 'live', draft_order = ord, pick_owners = owners,
    devy_from = dfrom, devy_rounds = dvr,   -- 0411
    current_overall = 1, nom_idx = 0,
    deadline_at = awake_deadline(now(), d.pick_seconds, d.night_start_min, d.night_end_min),
    started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership m set draft_budget = case
      -- a contract league's carried payroll (rolled-over deals, dead money)
      -- already spent part of this seat's money — the room only gets the rest
      when contracts_on(p_league_id)
        then greatest(1, d.budget - team_payroll(p_league_id, m.sleeper_roster_id))
      else d.budget end
    where m.league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;
  -- The coven queues behind the drafting teams — deterministic, and only
  -- meaningful when the wire is unlocked for everyone anyway.
  i := n;
  foreach v in array vamps loop
    i := i + 1;
    update league_membership set waiver_priority = i
      where league_id = p_league_id and sleeper_roster_id = v;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset,
    'owned_picks', owners is not null, 'devy_rounds', dvr, 'devy_from', dfrom, 'vampires_excluded', coalesce(array_length(vamps, 1), 0));
end $$;

-- ── add_free_agent (0497) ─────────────────────────────────────────────────
create or replace function add_free_agent(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; cnt int; cap int; wu timestamptz; err text;
begin
  -- 0213: the WORKER may also act, but only for a seat nobody holds. The
  -- auth.uid() IS NULL half is what confines this to the service role — a
  -- signed-in user always has a uid, so no human reaches this branch — and
  -- agent_wire_seat re-checks the membership row, so a stale seat_agent
  -- mapping can never let the worker transact over a real manager's roster.
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, p_roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 0272: THE REFUSAL ANSWERS, IT DOES NOT THROW. A dead guillotine seat and
  -- a locked vampire wire were both enforced ONLY by the seat-guard trigger,
  -- which RAISES — so the client got a thrown error where every other refusal
  -- hands back {ok:false, error}. Same rules, said the same way as the rest.
  -- The trigger stays as the last line of defence for every other path.
  err := coalesce(wire_block_reason(p_league_id, p_roster_id), add_limit_reason(p_league_id, p_roster_id));  -- 0358, restored 0497
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  perform _hold_played(p_league_id);   -- 0487: a player whose game has started is on waivers
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0229 (founder: "teams can make roster moves if they 'lock' all their
  -- contracts"): in a contract league the wire opens for a team when it
  -- LOCKS its contract lengths — or at the league deadline, when every
  -- unset deal finalizes at its 1-year default and the gate lifts itself.
  err := _contracts_gate(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := roster_illegal_reason(p_league_id, p_roster_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', 'your roster is over its limits — ' || err);
  end if;
  if not fa_window_open(p_league_id) then
    -- 0287: SAY WHICH CLOSED IT. "open 4:00pm to 4:01pm" is the wrong thing to
    -- tell somebody in a league that has no free agency at all, and it is the
    -- sentence that would send them looking for the window to wait for.
    if league_fa_mode(p_league_id) = 'off' then
      return jsonb_build_object('ok', false, 'error',
        'this league has no free agency — put in a waiver claim instead');
    end if;
    -- 0319: SAY WHEN IT OPENS. The old sentence quoted the window's hours,
    -- and a league shut by its DAYS (or an open league behind the
    -- after-waivers gate) has no hours — the client got an error with no
    -- text. The next opening is one answer for every reason the door is
    -- shut; the hours are implied by it.
    return jsonb_build_object('ok', false, 'error', 'free agency is closed — '
      || coalesce('opens ' || to_char(fa_opens_at(p_league_id) at time zone 'America/New_York', 'Dy FMHH12:MI AM') || ' ET',
                  'put in a claim for the next run'));
  end if;
  -- 0289: DUE CLAIMS SETTLE BEFORE THE DOOR DOES. A claim on a player free
  -- agency could not reach clears the moment it can (fa_opens_at), and the
  -- sweep that settles it runs from the team screen — every fifteen seconds,
  -- but not necessarily in the same second the window opens. A screen that was
  -- already open renders a live ADD on stale state, and without this the first
  -- person to click it beats a claim that was due before they arrived, which
  -- is exactly the sniping the closed window exists to prevent. We hold the
  -- same advisory lock process_waivers takes, so settling here is ordered, not
  -- racing; the 'already rostered' check below then reports the honest result.
  -- 0318: not only the DUE claims — ANY pending claim on him. We are past
  -- fa_window_open, so if he is unheld the run below treats every claim on
  -- him as due (the door is open); if he is held, the 'on waivers' refusal
  -- below answers and the run settles nothing. Either way the claims that
  -- were filed behind a shut door get him before the first hand at the open one.
  if exists (select 1 from waiver_claim wc
              where wc.league_id = p_league_id and wc.add_slug = p_add_slug and wc.status = 'pending') then
    perform process_waivers(p_league_id);
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if not _copy_open(p_league_id, p_add_slug, p_roster_id) then   -- 0500
    return jsonb_build_object('ok', false, 'error', _copy_refusal(p_league_id, p_add_slug, p_roster_id, 'player already rostered'));
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is not null and wu > now() then
    return jsonb_build_object('ok', false, 'error', 'on waivers until '
      || to_char(wu at time zone 'America/New_York', 'Dy FMHH12:MI AM') || ' ET — submit a claim instead');
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, p_add_slug, false, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  -- 0317: THE DROP MAY NOT HAVE KICKED OFF. Asked here rather than left to
  -- the classic trigger so a drip league is held to the same rule and an
  -- agent seat (the worker, exempt from the trigger) cannot cut a man mid-game.
  if p_drop_slug is not null then
    err := drop_lock_reason(p_league_id, p_drop_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end if;
  -- THE SEAT, NOT THE TOTAL (0199). Asked BEFORE the drop executes, with the
  -- drop discounted, so a refusal leaves the roster exactly as it was.
  err := roster_seat_error(p_league_id, p_roster_id, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  if p_drop_slug is not null then
    delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug;
    if not found then return jsonb_build_object('ok', false, 'error', 'drop player not on this roster'); end if;
    update league_pool set waived_until = waiver_hold_until(p_league_id)
      where league_id = p_league_id and slug = p_drop_slug;
  end if;
  insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, p_roster_id, p_add_slug, 'fa');
  -- 0290: ONE LINE FOR ONE MOVE. An add that carries a drop is a single
  -- decision and reads as one; the row trigger behind the register sees two
  -- and cannot know they belong together.
  perform _chat_house(p_league_id,
    '🟢 ' || _txn_team(p_league_id, p_roster_id) || ' added ' || _txn_player(p_league_id, p_add_slug)
      || case when p_drop_slug is null then ''
              else ' · dropped ' || _txn_player(p_league_id, p_drop_slug) end,
    jsonb_build_object('kind', 'add', 'roster_id', p_roster_id,
                       'add', p_add_slug, 'drop', p_drop_slug));
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

-- ── submit_waiver_claim (0497) ────────────────────────────────────────────
create or replace function submit_waiver_claim(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null, p_bid int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wu timestamptz; cnt int; cid uuid; err text; mode text; bid int := coalesce(p_bid, 0); cl timestamptz;
begin
  -- 0213: the WORKER may also act, but only for a seat nobody holds. The
  -- auth.uid() IS NULL half is what confines this to the service role — a
  -- signed-in user always has a uid, so no human reaches this branch — and
  -- agent_wire_seat re-checks the membership row, so a stale seat_agent
  -- mapping can never let the worker transact over a real manager's roster.
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, p_roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 0272: THE REFUSAL ANSWERS, IT DOES NOT THROW. A dead guillotine seat and
  -- a locked vampire wire were both enforced ONLY by the seat-guard trigger,
  -- which RAISES — so the client got a thrown error where every other refusal
  -- hands back {ok:false, error}. Same rules, said the same way as the rest.
  -- The trigger stays as the last line of defence for every other path.
  err := coalesce(wire_block_reason(p_league_id, p_roster_id), add_limit_reason(p_league_id, p_roster_id));  -- 0358, restored 0497
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0229 (founder: "teams can make roster moves if they 'lock' all their
  -- contracts"): in a contract league the wire opens for a team when it
  -- LOCKS its contract lengths — or at the league deadline, when every
  -- unset deal finalizes at its 1-year default and the gate lifts itself.
  err := _contracts_gate(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := roster_illegal_reason(p_league_id, p_roster_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', 'your roster is over its limits — ' || err);
  end if;
  mode := league_waiver_mode(p_league_id);
  if mode <> 'faab' then bid := 0;
  elsif bid < 0 or bid > member_faab(p_league_id, p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'bid exceeds your FAAB balance of $' || member_faab(p_league_id, p_roster_id));
  -- 0319: THE MINIMUM BID. Sleeper's floor; $0 claims exist only where the
  -- commissioner leaves it at zero. The worker's seat wire floors its own
  -- bids to the same number before it files.
  elsif bid < league_faab_min_bid(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the minimum bid is $' || league_faab_min_bid(p_league_id));
  end if;
  if not _copy_open(p_league_id, p_add_slug, p_roster_id) then   -- 0500
    return jsonb_build_object('ok', false, 'error', _copy_refusal(p_league_id, p_add_slug, p_roster_id, 'player already rostered'));
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  perform _hold_played(p_league_id);   -- 0487: a player whose game has started is on waivers
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  -- 0288: the test is whether free agency can reach him RIGHT NOW, not whether
  -- the league has free agency at all. When it can, an unheld player is an add
  -- rather than a claim, and says so.
  if fa_window_open(p_league_id) and (wu is null or wu <= now()) then
    return jsonb_build_object('ok', false, 'error', 'free agent — add him directly');
  end if;
  -- 0291: AND THIS IS WHERE IT CLEARS — the league's own waiver run, which is
  -- what "waivers clear at 2pm Thursday" has always meant everywhere else.
  -- 0289 used the free-agency door instead and left the waiver setting inert. Past this point free agency is shut, so
  -- a player with no live hold is one 0288 admitted, and he has no pool-row
  -- clock to inherit — process_waivers would settle him on its next sweep,
  -- fifteen seconds from now, uncontested. He clears when the door he is
  -- locked behind opens; in a league where it never opens, on the league's own
  -- waiver run, which is the only clock that mode has.
  if wu is null or wu <= now() then
    cl := claim_clears_at(p_league_id);
    -- 0318: THE DOOR IS A CLOCK TOO. He is unheld, so the moment free agency
    -- can reach him anyone may add him outright — a claim still waiting for
    -- a later run would be sniped at the door. Whichever comes first: the
    -- run (0291), or the door (0289). LEAST skips a null, so a league with
    -- no free agency keeps the run alone.
    cl := least(cl, fa_opens_at(p_league_id));
    -- 0316: ONE CLOCK PER PLAYER. In a league with no run time and no free
    -- agency each claim used to clear on its own 24-hour hold — so the first
    -- claim on a player settled alone, before a later, higher bid was due,
    -- and timing beat money. A claim on a player who already has a pending
    -- claim with a clock clears with the EARLIEST of them, so every claim on
    -- him competes in one run. With a league run time all claims already
    -- share it, and this changes nothing.
    select least(cl, min(c2.clears_at)) into cl from waiver_claim c2
      where c2.league_id = p_league_id and c2.add_slug = p_add_slug
        and c2.status = 'pending' and c2.clears_at is not null;
  end if;
  if p_drop_slug is not null and not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug) then
    return jsonb_build_object('ok', false, 'error', 'drop player not on this roster');
  end if;
  -- 0317: a man whose game has started cannot be named as the drop, even for
  -- a claim that will not clear until after the week — he is locked, the
  -- way Sleeper locks him. Name somebody else, or claim into an open seat.
  if p_drop_slug is not null then
    err := drop_lock_reason(p_league_id, p_drop_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end if;
  -- THE SEAT, NOT THE TOTAL (0199): a won claim lands ACTIVE, so a roster with
  -- taxi/IR places still open is not thereby free to take another bench player.
  if p_drop_slug is null then
    err := roster_seat_error(p_league_id, p_roster_id, null);
    if err is not null then
      return jsonb_build_object('ok', false, 'error', err || ' — or include a drop');
    end if;
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, p_add_slug, false, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if exists (select 1 from waiver_claim c where c.league_id = p_league_id and c.roster_id = p_roster_id
             and c.add_slug = p_add_slug and c.status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'claim already pending');
  end if;
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, bid, clears_at)
    values (p_league_id, p_roster_id, p_add_slug, p_drop_slug, bid, cl) returning id into cid;
  return jsonb_build_object('ok', true, 'claim_id', cid, 'bid', bid,
    'clears_at', coalesce(cl, (select waived_until from league_pool where league_id = p_league_id and slug = p_add_slug)));
end $$;

-- ── process_waivers (0497) ────────────────────────────────────────────────
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; d draft%rowtype; won int := 0; lost int := 0; changed boolean := false;
  err text; mode text; took text[]; missed text[]; dnote text; door boolean;
  st text; skipped int;   -- 0323: the group's doing
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  perform _hold_played(p_league_id);   -- 0487: stamp the week's played players before any claim is read
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return jsonb_build_object('ok', true, 'won', 0, 'lost', 0); end if;
  mode := league_waiver_mode(p_league_id);
  -- 0318: is the add market open this minute? Read once for the run.
  door := fa_window_open(p_league_id);

  for c in
    select wc.*, m.waiver_priority,
           case when mode = 'standings' then coalesce(sr.rank, 0) else 0 end as standings_rank
    from waiver_claim wc
    join league_membership m on m.league_id = wc.league_id and m.sleeper_roster_id = wc.roster_id
    join league_pool lp on lp.league_id = wc.league_id and lp.slug = wc.add_slug
    left join lateral (
      -- league_standings is best-first; reverse it so 0 = the worst record
      select (jsonb_array_length(league_standings(p_league_id)) - ord)::int as rank
      from jsonb_array_elements(league_standings(p_league_id)) with ordinality s(e, ord)
      where (s.e ->> 'roster_id')::int = wc.roster_id
    ) sr on mode = 'standings'
    where wc.league_id = p_league_id and wc.status = 'pending'
      -- 0487: AND THE PLAYER'S OWN HOLD HAS ENDED. The claim's stamp is a
      -- forecast made at filing; a hold that arrived after it (his game
      -- kicked off, or the commissioner put him on waivers) is the fact.
      and ((coalesce(wc.clears_at, lp.waived_until, now()) <= now()
            and coalesce(lp.waived_until, now()) <= now())
           -- 0318: AN OPEN DOOR MAKES EVERY CLAIM ON AN UNHELD PLAYER DUE,
           -- whatever its stamp says. The stamp is a forecast made at
           -- filing; the commissioner opening free agency (or a window
           -- arriving, or a data fix flipping the mode) is the fact. Held
           -- players are untouched: the door cannot reach them until their
           -- hold ends, and that hold is on the run's schedule (0292).
           or (door and (lp.waived_until is null or lp.waived_until <= now())))
      -- 0336: A LINKED GROUP RUNS TOGETHER, ON ITS SLOWEST CLOCK. "One of
      -- these, in this order" is decided in one run or it is not a list:
      -- with a rolling 24h hold per drop, a fallback dropped on Monday
      -- morning came due before the first choice dropped that afternoon,
      -- landed, and marked the first choice lost five hours before its own
      -- clock. While any pending member is not yet due, none of them is.
      and not exists (
        select 1 from waiver_claim g
        join league_pool gp on gp.league_id = g.league_id and gp.slug = g.add_slug
       where g.group_id = wc.group_id and g.status = 'pending' and g.id <> wc.id
         and (coalesce(g.clears_at, gp.waived_until, now()) > now()
              or coalesce(gp.waived_until, now()) > now())
         and not (door and (gp.waived_until is null or gp.waived_until <= now())))
    -- 0323: group_seq sits AFTER every league rule and before the filing
    -- time, so a contingency list changes nothing about who beats whom — it
    -- only decides which of a seat's OWN tied claims is tried first.
    order by case when mode = 'faab' then -wc.bid else 0 end,
             case when mode = 'standings' then coalesce(sr.rank, 0) else 0 end,
             m.waiver_priority nulls last, wc.group_seq nulls last, wc.created_at
  loop
    dnote := null;
    -- 0323: THE CURSOR IS A SNAPSHOT. A claim this very run has already taken
    -- off the table (its group filled below) is still in the result set, so
    -- ask the row what it is now before doing anything to it. Costs one index
    -- read per claim and makes every future "settle these too" rule safe.
    select status into st from waiver_claim where id = c.id;
    if st is distinct from 'pending' then continue; end if;
    -- 0144: a commissioner flag set while the claim sat pending kills it with
    -- a clear note — the roster trigger would otherwise abort the whole sweep.
    if flag_rule_blocks(p_league_id, c.add_slug, 'no_add') is not null then
      update waiver_claim set status = 'lost', note = 'player flagged by the commissioner', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    -- 0316: A SEAT THE FORMAT HAS SHUT OUT LOSES, IT DOES NOT ABORT THE RUN.
    -- The seat guard on native_roster RAISES for a seat under the vampire's
    -- wire lock (0268), and a claim filed before the commissioner flipped
    -- the lock would hit it here — aborting the whole run, every sweep,
    -- until somebody cancelled that one claim. Ask the same question the
    -- submit asks and settle it as a loss with the reason.
    err := coalesce(wire_block_reason(p_league_id, c.roster_id), add_limit_reason(p_league_id, c.roster_id));  -- 0358, restored 0497
    if err is not null then
      update waiver_claim set status = 'lost', note = err, processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if not _copy_open(p_league_id, c.add_slug, c.roster_id) then   -- 0500: every copy gone, or this seat holds one
      -- 0316: "outbid" only when a claim in THIS run took him; a man signed
      -- off free agency while the claim sat was simply taken.
      update waiver_claim set status = 'lost',
        note = case when mode = 'faab' and exists (select 1 from waiver_claim w2
                      where w2.league_id = p_league_id and w2.add_slug = c.add_slug
                        and w2.status = 'won' and w2.processed_at = now())
                    then 'outbid' else 'player taken' end,
        processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    -- 0316: THE DROP IS A MEANS, NOT A CONDITION. A claim whose drop already
    -- left the roster — an earlier claim of the same seat spent him, or a
    -- trade moved him — still goes through when the seat has a place open;
    -- it loses only when it would need the drop to make room.
    if c.drop_slug is not null and not exists (select 1 from native_roster
        where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug) then
      if roster_seat_error(p_league_id, c.roster_id, null) is not null then
        update waiver_claim set status = 'lost', note = 'drop player no longer on roster and the active roster is full', processed_at = now() where id = c.id;
        lost := lost + 1; continue;
      end if;
      c.drop_slug := null; dnote := 'drop had already left the roster';
    end if;
    -- 0317: A DROP WHOSE GAME HAS STARTED IS NO DROP. The claim was filed
    -- before he kicked off; the run came after. He stays (his sealed pick
    -- still scores), and the claim goes through only where it did not need
    -- him for room — the same shape as the drop that already left.
    if c.drop_slug is not null and drop_lock_reason(p_league_id, c.drop_slug) is not null then
      if roster_seat_error(p_league_id, c.roster_id, null) is not null then
        update waiver_claim set status = 'lost', note = 'drop player''s game has started and the active roster is full', processed_at = now() where id = c.id;
        lost := lost + 1; continue;
      end if;
      c.drop_slug := null; dnote := 'drop player''s game had started — kept';
    end if;
    -- THE SEAT, NOT THE TOTAL (0199): a won claim lands ACTIVE, so a roster
    -- with taxi/IR places still open is not thereby free to take another
    -- bench player.
    if c.drop_slug is null and roster_seat_error(p_league_id, c.roster_id, null) is not null then
      update waiver_claim set status = 'lost', note = 'active roster full', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if roster_illegal_reason(p_league_id, c.roster_id) is not null then
      update waiver_claim set status = 'lost', note = 'roster over limits', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    err := pos_cap_error(p_league_id, c.roster_id, c.add_slug, false, c.drop_slug);
    if err is not null then
      update waiver_claim set status = 'lost', note = 'position limit', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if mode = 'faab' and c.bid > member_faab(p_league_id, c.roster_id) then
      update waiver_claim set status = 'lost', note = 'insufficient FAAB', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;

    if c.drop_slug is not null then
      delete from native_roster where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug;
      update league_pool set waived_until = waiver_hold_until(p_league_id)
        where league_id = p_league_id and slug = c.drop_slug;
    end if;
    insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, c.roster_id, c.add_slug, 'waiver');
    update waiver_claim set status = 'won', processed_at = now(),
      note = coalesce(dnote, note),
      drop_slug = c.drop_slug where id = c.id;
    if mode = 'faab' and c.bid > 0 then
      update league_membership set faab_budget = member_faab(p_league_id, c.roster_id) - c.bid
        where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    end if;
    if mode <> 'standings' then
      update league_membership set waiver_priority =
          (select coalesce(max(waiver_priority), 0) + 1 from league_membership where league_id = p_league_id)
        where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    end if;
    won := won + 1; changed := true;
    -- 0323: THE CONDITION. The seat wanted ONE of these (or its own ceiling of
    -- them); it has them. The rest settle as losses with the reason, so the
    -- run's report says why they went quiet instead of leaving a manager to
    -- work out that his fallback was never going to fire.
    if c.group_id is not null and _group_is_full(c.group_id) then
      update waiver_claim set status = 'lost', processed_at = now(),
        note = 'conditional — already landed ' || _txn_player(p_league_id, c.add_slug)
       where group_id = c.group_id and status = 'pending' and id <> c.id;
      get diagnostics skipped = row_count;
      lost := lost + skipped;
    end if;
  end loop;

  -- 0290: ONE REPORT FOR THE RUN, founder: "a waiver report when it runs".
  -- Five settled claims are one thing that happened, and five chat lines would
  -- bury the league's actual conversation under the plumbing. Silence when the
  -- sweep settled nothing, which is almost every sweep — the team screen calls
  -- this every fifteen seconds to stay self-driving without a worker, and a
  -- league whose chat filled with "waivers ran, nothing happened" would be a
  -- worse feature than no feature.
  --
  -- Read back from the claims rather than accumulated in the loop above: every
  -- branch stamps processed_at = now(), now() is fixed for the transaction, so
  -- this picks up exactly the rows THIS run settled — including the seven
  -- different ways a claim can lose, none of which had to be touched.
  if won > 0 or lost > 0 then
    select array_agg(_txn_team(p_league_id, wc.roster_id) || ' won ' || _txn_player(p_league_id, wc.add_slug)
             || case when mode = 'faab' then ' ($' || wc.bid || ')' else '' end
             || case when wc.drop_slug is not null
                     then ', dropping ' || _txn_player(p_league_id, wc.drop_slug) else '' end
             order by wc.id)
      into took from waiver_claim wc
     where wc.league_id = p_league_id and wc.status = 'won' and wc.processed_at = now();
    select array_agg(_txn_team(p_league_id, wc.roster_id) || ' on ' || _txn_player(p_league_id, wc.add_slug)
             || ' (' || coalesce(nullif(wc.note, ''), 'lost') || ')' order by wc.id)
      into missed from waiver_claim wc
     where wc.league_id = p_league_id and wc.status = 'lost' and wc.processed_at = now();
    perform _chat_house(p_league_id,
      '📋 Waivers ran — ' || coalesce(array_to_string(took, '; '), 'nothing claimed')
        || case when missed is null then '' else ' · Missed: ' || array_to_string(missed, '; ') end,
      jsonb_build_object('kind', 'waiver', 'won', won, 'lost', lost));
  end if;
  if changed then perform native_materialize(p_league_id); end if;
  return jsonb_build_object('ok', true, 'won', won, 'lost', lost);
end $$;

-- ── _hold_played ──────────────────────────────────────────────────────────
create or replace function _hold_played(p_league_id uuid) returns int
  language plpgsql security definer set search_path = public as $$
declare gh int; cm int; day_local timestamp; last_clear timestamptz; next_clear timestamptz;
        gt timestamptz; i int; seas text; n int;
begin
  if league_sport(p_league_id) <> 'nfl' then return 0; end if;
  gh := waiver_game_hold_dow_effective(p_league_id);
  if gh is null then return 0; end if;
  cm := coalesce(league_waiver_clear_min(p_league_id), 180);
  day_local := date_trunc('day', now() at time zone 'America/New_York');
  last_clear := null; next_clear := null;
  for i in 0..7 loop
    gt := (day_local - make_interval(days => i) + make_interval(mins => cm)) at time zone 'America/New_York';
    if gt <= now() and extract(dow from gt at time zone 'America/New_York')::int = gh then
      last_clear := gt; exit;
    end if;
  end loop;
  for i in 0..7 loop
    gt := (day_local + make_interval(days => i, mins => cm)) at time zone 'America/New_York';
    if gt > now() and extract(dow from gt at time zone 'America/New_York')::int = gh then
      next_clear := gt; exit;
    end if;
  end loop;
  if next_clear is null then return 0; end if;
  select season into seas from league where id = p_league_id;
  update league_pool lp
     set waived_until = next_clear
   where lp.league_id = p_league_id
     and lp.team <> ''
     and (lp.waived_until is null or lp.waived_until < next_clear)
     and _copy_open(lp.league_id, lp.slug)
     and exists (select 1 from nfl_slate s
                  where s.season = coalesce(seas, s.season)
                    and s.week < 200   -- the NFL slate, not the college one (0365)
                    and s.kickoff <= now()
                    and (last_clear is null or s.kickoff > last_clear)
                    and (_nfl_team(s.home) = _nfl_team(lp.team) or _nfl_team(s.away) = _nfl_team(lp.team)));
  get diagnostics n = row_count;
  return n;
end $$;

-- ── _seat_rule_any_left ───────────────────────────────────────────────────
create or replace function _seat_rule_any_left(p_league_id uuid, p_roster_id int, p_level text)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from league_pool lp
     where lp.league_id = p_league_id
       and (p_level is null or lp.level = p_level)
       and _copy_open(lp.league_id, lp.slug)
       and coalesce(league_pos_cap(p_league_id, lp.pos), 1) > 0
       and seat_rule_error(p_league_id, p_roster_id, lp.slug) is null)
$$;

-- ── set_league_position_access ────────────────────────────────────────────
create or replace function set_league_position_access(p_league_id uuid, p_positions jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare allowed text[] := array['HC','P','IDP','FB','RET','COLLEGE']; cleaned jsonb := '[]'::jsonb; ps jsonb; v text;
        was boolean; added int := 0; removed int := 0; preset boolean := false;
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
  -- 0472: THE COACH SCORES SOMETHING. Unlocking HC on a league whose catalog
  -- has never priced a coach installs the preset, so a coach spot pays from
  -- the first week rather than banking zeros until somebody finds the knobs.
  -- A catalog with any coach value set is the commissioner's and is left alone.
  if cleaned @> '["HC"]'::jsonb then
    update league set settings_json = settings_json
        || jsonb_build_object('scoring_classic', coalesce(settings_json -> 'scoring_classic', '{}'::jsonb) || _hc_scoring_preset())
      where id = p_league_id and _hc_scoring_unset(settings_json -> 'scoring_classic');
    preset := found;
  end if;
  -- 0438: the pool follows the switch. ON fills it from the directory;
  -- OFF drops the college players nobody holds, as a re-seed would.
  if cleaned @> '["COLLEGE"]'::jsonb and not coalesce(was, false) then
    added := _league_pool_add_college(p_league_id);
  elsif coalesce(was, false) and not (cleaned @> '["COLLEGE"]'::jsonb) then
    delete from league_pool lp
     where lp.league_id = p_league_id and lp.level = 'college'
       and _copy_open(lp.league_id, lp.slug)
       and not exists (select 1 from college_custom cc where 'c-' || cc.espn_id = lp.slug);
    get diagnostics removed = row_count;
  end if;
  return jsonb_build_object('ok', true, 'positions', cleaned, 'college_added', added, 'college_removed', removed, 'hc_preset', preset);
end $$;

-- ── league_waiver_holds (0354) ────────────────────────────────────────────
create or replace function league_waiver_holds(p_league_id uuid, p_search text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'next_run', waiver_hold_until(p_league_id),
    'held', coalesce((
      select jsonb_agg(jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
               'until', lp.waived_until,
               'claims', (select count(*) from waiver_claim c where c.league_id = lp.league_id
                            and c.add_slug = lp.slug and c.status = 'pending'))
             order by lp.waived_until, lp.rank)
        from league_pool lp
       where lp.league_id = p_league_id and lp.waived_until > now()
         and _copy_open(lp.league_id, lp.slug)), '[]'::jsonb),
    'found', case when q is null then '[]'::jsonb else coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
                 'until', case when lp.waived_until > now() then lp.waived_until end) as x
          from league_pool lp
         where lp.league_id = p_league_id and lp.full_name ilike '%' || q || '%'
           and _copy_open(lp.league_id, lp.slug)
         order by lp.rank limit 12) s), '[]'::jsonb) end);
end $$;

-- ── commish_set_waiver_hold (0354) ────────────────────────────────────────
create or replace function commish_set_waiver_hold(p_league_id uuid, p_slug text, p_mode text, p_until timestamptz default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t timestamptz; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not exists (select 1 from league_pool where league_id = p_league_id and slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in this league''s pool');
  end if;
  if not _copy_open(p_league_id, p_slug) then   -- 0500: a hold is for a player with a copy left
    return jsonb_build_object('ok', false, 'error', _txn_player(p_league_id, p_slug) || ' is on a roster — a hold is for a player nobody has');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  if p_mode = 'free' then
    t := null;
  elsif p_mode = 'next_run' then
    t := waiver_hold_until(p_league_id);
  elsif p_mode = 'until' then
    if p_until is null or p_until <= now() or p_until > now() + interval '14 days' then
      return jsonb_build_object('ok', false, 'error', 'pick a time in the next two weeks');
    end if;
    t := p_until;
  else
    return jsonb_build_object('ok', false, 'error', 'mode is free, next_run or until');
  end if;
  update league_pool set waived_until = t where league_id = p_league_id and slug = p_slug;
  update waiver_claim c set clears_at = case when t is null
      then least(claim_clears_at(p_league_id), coalesce(fa_opens_at(p_league_id), claim_clears_at(p_league_id)))
      else greatest(coalesce(c.clears_at, t), t) end
   where c.league_id = p_league_id and c.add_slug = p_slug and c.status = 'pending';
  line := case when t is null
    then '✅ The commissioner cleared ' || _txn_player(p_league_id, p_slug) || '''s waiver hold — he is a free agent now'
    else '⏳ The commissioner put ' || _txn_player(p_league_id, p_slug) || ' on waivers until '
         || to_char(t at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' ET' end;
  perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'hold', 'slug', p_slug, 'until', t));
  return jsonb_build_object('ok', true, 'slug', p_slug, 'until', t, 'note', line);
end $$;

-- ── _txn_undo_blocker (0354) ──────────────────────────────────────────────
create or replace function _txn_undo_blocker(p jsonb) returns text
  language plpgsql stable security definer set search_path = public as $$
declare lid uuid := (p ->> 'league_id')::uuid; rid int := (p ->> 'roster_id')::int; err text;
begin
  if p ? 'error' then return p ->> 'error'; end if;
  if p ->> 'added' is not null then
    if not exists (select 1 from native_roster where league_id = lid and roster_id = rid and slug = p ->> 'added') then
      return _txn_player(lid, p ->> 'added') || ' is no longer on that team — move him by hand';
    end if;
    err := drop_lock_reason(lid, p ->> 'added');
    if err is not null then return err; end if;
  end if;
  if p ->> 'dropped' is not null
     and not _copy_open(lid, p ->> 'dropped', rid) then   -- 0500
    return _txn_player(lid, p ->> 'dropped') || ' has been picked up since — he can''t come back';
  end if;
  if p ->> 'added' is null and roster_seat_error(lid, rid, null) is not null then
    return 'that team has no open seat for ' || _txn_player(lid, p ->> 'dropped') || ' — make room first';
  end if;
  return null;
end $$;

-- ── propose_trade (0321) ──────────────────────────────────────────────────
create or replace function propose_trade(
  p_league_id uuid, p_from_roster int, p_to_roster int,
  p_give jsonb, p_get jsonb, p_note text default null,
  p_give_picks jsonb default null, p_get_picks jsonb default null,
  p_retain jsonb default null, p_cap_dollars int default null,
  p_faab_dollars int default 0, p_expires_hours int default null   -- 0321
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; gp jsonb; tp jsonb; err text; el jsonb;
        rt jsonb := '[]'::jsonb; rslug text; ramt int; rtr int; c contract%rowtype; already int;
        exp timestamptz; sender int;
begin
  if not (owns_roster(p_league_id, p_from_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  -- 0319: THE TRADE DEADLINE. Asked at the offer and again at the acceptance
  -- (respond_trade); a deal already accepted and waiting on the commissioner
  -- was struck in time and may still be ruled on.
  err := trade_deadline_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  -- 0320: a locked team neither offers nor receives.
  err := coalesce(team_lock_reason(p_league_id, p_from_roster),
                  case when team_lock_reason(p_league_id, p_to_roster) is not null then 'the commissioner has locked that team''s roster moves' end);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_from_roster = p_to_roster
     or not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'pick another team to trade with');
  end if;
  begin
    gp := _clean_trade_picks(p_league_id, p_give_picks);
    tp := _clean_trade_picks(p_league_id, p_get_picks);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  -- The commissioner's switch, checked once for both halves.
  if (jsonb_array_length(gp) > 0 or jsonb_array_length(tp) > 0)
     and not league_pick_trading(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the commissioner has pick trading turned off');
  end if;
  if jsonb_typeof(p_give) <> 'array' or jsonb_typeof(p_get) <> 'array'
     or jsonb_array_length(p_give) > 10 or jsonb_array_length(p_get) > 10
     or jsonb_array_length(gp) > 10 or jsonb_array_length(tp) > 10
     or (jsonb_array_length(p_give) + jsonb_array_length(p_get)
      + jsonb_array_length(gp) + jsonb_array_length(tp) < 1
         and coalesce(p_cap_dollars, 0) = 0 and coalesce(p_faab_dollars, 0) = 0) then
    return jsonb_build_object('ok', false, 'error', 'a trade moves 1–10 players or picks each way');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_give || p_get))
     <> jsonb_array_length(p_give) + jsonb_array_length(p_get) then
    return jsonb_build_object('ok', false, 'error', 'a player can only appear once');
  end if;
  if (select count(distinct value) from jsonb_array_elements(gp || tp))
     <> jsonb_array_length(gp) + jsonb_array_length(tp) then
    return jsonb_build_object('ok', false, 'error', 'a pick can only appear once');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_from_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only offer your own players');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only ask for their players');
  end if;
  -- 0500: COPIES. A team may not receive a player it already holds a copy of.
  if exists (select 1 from jsonb_array_elements_text(p_give) s(slug) join native_roster nr
               on nr.league_id = p_league_id and nr.roster_id = p_to_roster and nr.slug = s.slug)
     or exists (select 1 from jsonb_array_elements_text(p_get) s(slug) join native_roster nr
               on nr.league_id = p_league_id and nr.roster_id = p_from_roster and nr.slug = s.slug) then
    return jsonb_build_object('ok', false, 'error', 'a team in this trade already has one of those players');
  end if;
  err := _pick_ownership_error(p_league_id, p_from_roster, gp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only offer picks you own — ' || err); end if;
  err := _pick_ownership_error(p_league_id, p_to_roster, tp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only ask for picks they own — ' || err); end if;
  -- MID-DRAFT: a pick already used is a player now, and the pick on the clock
  -- is being spent as we speak. Neither is a thing to put in an offer.
  for el in select * from jsonb_array_elements(gp || tp) loop
    err := _pick_locked_error(p_league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end loop;
  -- Salary retention (0219): the sender eats part of a traded deal. Each term
  -- names a player IN the trade; the retainer is whichever side holds him now.
  if p_retain is not null and jsonb_array_length(coalesce(p_retain, '[]'::jsonb)) > 0 then
    if not contracts_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'salary retention needs a contract league');
    end if;
    if not salary_retention_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'the commissioner has salary retention turned off');
    end if;
    for el in select * from jsonb_array_elements(p_retain) loop
      rslug := el ->> 'slug'; ramt := coalesce((el ->> 'amount')::int, 0);
      if p_give ? rslug then rtr := p_from_roster;
      elsif p_get ? rslug then rtr := p_to_roster;
      else return jsonb_build_object('ok', false, 'error', 'retention only applies to players in this trade');
      end if;
      select * into c from contract where league_id = p_league_id and slug = rslug;
      if not found then return jsonb_build_object('ok', false, 'error', 'no contract to retain on ' || rslug); end if;
      select coalesce(sum(amount), 0) into already from salary_retention
        where league_id = p_league_id and slug = rslug;
      if ramt < 1 or already + ramt > c.salary - 1 then
        return jsonb_build_object('ok', false, 'error',
          'retention on ' || rslug || ' must be $1–$' || (c.salary - 1 - already) || ' — the receiver pays at least $1');
      end if;
      rt := rt || jsonb_build_object('slug', rslug, 'amount', ramt, 'roster', rtr);
    end loop;
  end if;
  -- Raw cap-space trading (0219): dollars as an asset. Positive = the proposer
  -- sends cap room; negative asks for it. Behind the commissioner's switch.
  if coalesce(p_cap_dollars, 0) <> 0 then
    if not contracts_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'cap-space trading needs a contract league');
    end if;
    if not cap_trading_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'the commissioner has cap-space trading turned off');
    end if;
    if abs(p_cap_dollars) > 100000 then
      return jsonb_build_object('ok', false, 'error', 'cap dollars must be within $100000');
    end if;
  end if;
  -- FAAB as an asset (0321): + = the proposer sends dollars, − = asks for
  -- them. The budget is checked here for the message and AGAIN at execution,
  -- where it is the one that counts — a waiver run can empty a wallet between
  -- an offer and its acceptance.
  if coalesce(p_faab_dollars, 0) <> 0 then
    if league_waiver_mode(p_league_id) <> 'faab' then
      return jsonb_build_object('ok', false, 'error', 'FAAB dollars only move in a FAAB league');
    end if;
    if not league_faab_trading(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'the commissioner has FAAB trading turned off');
    end if;
    sender := case when p_faab_dollars > 0 then p_from_roster else p_to_roster end;
    if abs(p_faab_dollars) > member_faab(p_league_id, sender) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(p_league_id, sender) || ' has $' || member_faab(p_league_id, sender) || ' of FAAB left');
    end if;
  end if;
  -- THE OFFER'S OWN CLOCK (0321). -1 says "stands until answered" whatever the
  -- league default is; null takes that default; a number is hours.
  if p_expires_hours is not null and p_expires_hours <> -1
     and (p_expires_hours < 1 or p_expires_hours > 720) then
    return jsonb_build_object('ok', false, 'error', 'an offer expires in 1–720 hours');
  end if;
  exp := case when p_expires_hours = -1 then null
              when p_expires_hours is not null then now() + make_interval(hours => p_expires_hours)
              when league_trade_offer_days(p_league_id) > 0
                then now() + make_interval(days => league_trade_offer_days(p_league_id))
         end;
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, give_picks, get_picks, note, created_by, retain, cap_dollars, faab_dollars, expires_at)
    values (p_league_id, p_from_roster, p_to_roster, p_give, p_get, gp, tp,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
            case when jsonb_array_length(rt) > 0 then rt else null end, nullif(coalesce(p_cap_dollars, 0), 0),
            nullif(coalesce(p_faab_dollars, 0), 0), exp)
    returning id into tid;
  return jsonb_build_object('ok', true, 'trade_id', tid, 'expires_at', exp);
end $$;

-- ── execute_trade (0336) ──────────────────────────────────────────────────
create or replace function execute_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; err text; el jsonb; lseas text; ov int; knd text;
        sender int; taker int;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  -- 0322: a deal with legs has no two sides to swap — everything below reads
  -- give/get, so the multi-team executor takes it from here.
  if _trade_is_multi(p_trade_id) then return _execute_multi_trade(p_trade_id); end if;
  if exists (select 1 from jsonb_array_elements_text(t.give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.from_roster and nr.slug = s.slug))
     or exists (select 1 from jsonb_array_elements_text(t.get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
  end if;
  -- 0500: COPIES — nobody receives a player they now hold a copy of.
  if exists (select 1 from jsonb_array_elements_text(t.give) s(slug) join native_roster nr
               on nr.league_id = t.league_id and nr.roster_id = t.to_roster and nr.slug = s.slug)
     or exists (select 1 from jsonb_array_elements_text(t.get) s(slug) join native_roster nr
               on nr.league_id = t.league_id and nr.roster_id = t.from_roster and nr.slug = s.slug) then
    return jsonb_build_object('ok', false, 'error', 'a team in this trade now has one of those players — re-propose');
  end if;
  if _pick_ownership_error(t.league_id, t.from_roster, t.give_picks) is not null
     or _pick_ownership_error(t.league_id, t.to_roster, t.get_picks) is not null then
    return jsonb_build_object('ok', false, 'error', 'picks moved since the deal was struck — re-propose');
  end if;
  -- Re-checked at EXECUTE, not just at propose: an offer made three picks ago
  -- can be accepted after the clock has passed the very pick it moves.
  for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) loop
    err := _pick_locked_error(t.league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
    if err is not null then return jsonb_build_object('ok', false, 'error', err || ' — re-propose'); end if;
  end loop;
  err := coalesce(trade_cap_error(t.league_id, t.from_roster, t.give, t.get),
                  trade_cap_error(t.league_id, t.to_roster, t.get, t.give));
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  -- FAAB dollars (0321): the budget is re-checked at EXECUTE, not just at the
  -- offer — a review window is a day long and a waiver run inside it can
  -- spend the money twice over. CHECKED HERE, BEFORE THE FIRST MOVE (0336):
  -- 0322 asked this after the rosters, picks and cap had already been
  -- rewritten, and answered with a plain `return`, which in plpgsql rolls
  -- nothing back. The players had swapped, the proposal still said pending,
  -- and a second accept read "players moved since the deal was struck". A
  -- refusal now refuses a deal nothing has touched.
  if coalesce(t.faab_dollars, 0) <> 0 then
    sender := case when t.faab_dollars > 0 then t.from_roster else t.to_roster end;
    if abs(t.faab_dollars) > member_faab(t.league_id, sender) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(t.league_id, sender) || ' no longer has $' || abs(t.faab_dollars)
          || ' of FAAB — re-propose');
    end if;
  end if;

  update native_roster nr set roster_id = t.to_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.from_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.give));
  update native_roster nr set roster_id = t.from_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.to_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.get));
  for el in select * from jsonb_array_elements(t.give_picks) loop
    update pick_asset set owner_roster = t.to_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;
  for el in select * from jsonb_array_elements(t.get_picks) loop
    update pick_asset set owner_roster = t.from_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;

  -- Keep the running draft's own copy in step.
  select * into d from draft where league_id = t.league_id;
  select season into lseas from league where id = t.league_id;
  if d.pick_owners is not null then
    for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) loop
      if (el ->> 'season') = lseas then
        select kind into knd from pick_asset where league_id = t.league_id
          and season = el ->> 'season' and round = (el ->> 'round')::int
          and original_roster = (el ->> 'orig')::int;
        ov := _pick_overall(t.league_id, (el ->> 'round')::int, (el ->> 'orig')::int,
                            coalesce(knd, 'startup') = 'startup');
        if ov is not null and ov >= 1 and ov <= jsonb_array_length(d.pick_owners) then
          d.pick_owners := jsonb_set(d.pick_owners, array[(ov - 1)::text],
            to_jsonb((select owner_roster from pick_asset where league_id = t.league_id
                      and season = el ->> 'season' and round = (el ->> 'round')::int
                      and original_roster = (el ->> 'orig')::int)));
        end if;
      end if;
    end loop;
    update draft set pick_owners = d.pick_owners where league_id = t.league_id;
  end if;

  -- Retention lands as ghost lines on the retainer's books (0219).
  for el in select * from jsonb_array_elements(coalesce(t.retain, '[]'::jsonb)) loop
    insert into salary_retention (league_id, slug, roster_id, amount)
      values (t.league_id, el ->> 'slug', (el ->> 'roster')::int, (el ->> 'amount')::int)
      on conflict (league_id, slug, roster_id) do update
        set amount = salary_retention.amount + excluded.amount;
  end loop;
  -- Cap dollars move like a pick (0219). Judged immediately below, so a pure
  -- cash deal cannot slip past the contract trigger (which only watches
  -- contract rows).
  if coalesce(t.cap_dollars, 0) <> 0 then
    update league_membership set cap_adjust = cap_adjust - t.cap_dollars
      where league_id = t.league_id and sleeper_roster_id = t.from_roster;
    update league_membership set cap_adjust = cap_adjust + t.cap_dollars
      where league_id = t.league_id and sleeper_roster_id = t.to_roster;
  end if;
  -- FAAB dollars (0321) — the wallet was re-checked above the first move.
  if coalesce(t.faab_dollars, 0) <> 0 then
    sender := case when t.faab_dollars > 0 then t.from_roster else t.to_roster end;
    taker  := case when t.faab_dollars > 0 then t.to_roster else t.from_roster end;
    update league_membership set faab_budget = member_faab(t.league_id, sender) - abs(t.faab_dollars)
      where league_id = t.league_id and sleeper_roster_id = sender;
    update league_membership set faab_budget = member_faab(t.league_id, taker) + abs(t.faab_dollars)
      where league_id = t.league_id and sleeper_roster_id = taker;
    insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
    values (t.league_id, 'faab', taker, '', sender,
            '$' || abs(t.faab_dollars) || ' of FAAB traded');
  end if;
  if contracts_on(t.league_id) then
    if team_payroll(t.league_id, t.from_roster) > team_cap(t.league_id, t.from_roster) then
      raise exception 'salary cap exceeded — team % at $% of $%', t.from_roster,
        team_payroll(t.league_id, t.from_roster), team_cap(t.league_id, t.from_roster);
    end if;
    if team_payroll(t.league_id, t.to_roster) > team_cap(t.league_id, t.to_roster) then
      raise exception 'salary cap exceeded — team % at $% of $%', t.to_roster,
        team_payroll(t.league_id, t.to_roster), team_cap(t.league_id, t.to_roster);
    end if;
  end if;
  -- the register keeps the money terms (0222): who eats what, and cap moved
  for el in select * from jsonb_array_elements(coalesce(t.retain, '[]'::jsonb)) loop
    insert into league_txn (league_id, kind, roster_id, slug, note)
    values (t.league_id, 'retained', (el ->> 'roster')::int, el ->> 'slug',
            '$' || (el ->> 'amount') || ' retained in trade');
  end loop;
  if coalesce(t.cap_dollars, 0) <> 0 then
    insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
    values (t.league_id, 'cap',
            case when t.cap_dollars > 0 then t.to_roster else t.from_roster end, '',
            case when t.cap_dollars > 0 then t.from_roster else t.to_roster end,
            '$' || abs(t.cap_dollars) || ' of cap room traded');
  end if;
  -- 0290, founder: "a trade report when it happens". One sentence for a deal
  -- that is four roster updates, two pick sweeps and a cap adjustment
  -- underneath. Picks and cash are counted rather than listed — the register
  -- has the full terms, and chat wants the news.
  perform _chat_house(t.league_id,
    '🤝 Trade — ' || _txn_team(t.league_id, t.from_roster)
      || ' sends ' || _txn_players(t.league_id, t.give)
      || ' to ' || _txn_team(t.league_id, t.to_roster)
      || ' for ' || _txn_players(t.league_id, t.get)
      || case when jsonb_array_length(coalesce(t.give_picks, '[]'::jsonb))
                 + jsonb_array_length(coalesce(t.get_picks, '[]'::jsonb)) > 0
              then ' · picks included' else '' end
      || case when coalesce(t.cap_dollars, 0) <> 0
              then ' · $' || abs(t.cap_dollars) || ' cap' else '' end
      || case when coalesce(t.faab_dollars, 0) <> 0
              then ' · $' || abs(t.faab_dollars) || ' FAAB' else '' end,
    jsonb_build_object('kind', 'trade', 'from_roster', t.from_roster, 'to_roster', t.to_roster,
                       'give', t.give, 'get', t.get));
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true);
end $$;

-- ── propose_multi_trade (0397) ────────────────────────────────────────────
create or replace function propose_multi_trade(
  p_league_id uuid, p_legs jsonb, p_note text default null, p_expires_hours int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; leg jsonb; el jsonb; err text; exp timestamptz;
        seats int[] := '{}'; touched int[] := '{}'; mine int; rid int; dest int;
        slugs text[] := '{}'; pkeys text[] := '{}'; amt int; legsum int;
        assets int := 0; cleaned jsonb; second_seat int;
        has_devy boolean; lin text; held int; cash_sum numeric; camt numeric; skeys text[] := '{}';
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  -- 0397: DEVY SHARES travel on legs, so a two-team deal that moves shares
  -- or devy cash is filed here too (the two-seat offer knows nothing of them).
  has_devy := exists (select 1 from jsonb_array_elements(coalesce(p_legs, '[]'::jsonb)) l
                       where jsonb_array_length(coalesce(l -> 'send_shares', '[]'::jsonb)) > 0
                          or jsonb_array_length(coalesce(l -> 'send_devy_cash', '[]'::jsonb)) > 0);
  if p_legs is null or jsonb_typeof(p_legs) <> 'array'
     or jsonb_array_length(p_legs) < (case when has_devy then 2 else 3 end) or jsonb_array_length(p_legs) > 8 then
    return jsonb_build_object('ok', false, 'error', 'a multi-team trade has 3–8 teams (two teams is an ordinary offer)');
  end if;
  if has_devy then
    if not _devy_shares_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'this league doesn''t play devy shares');
    end if;
    if not _devy_is_current(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'that''s last season''s league — trade shares in the current season');
    end if;
    if d.status = 'live' then
      return jsonb_build_object('ok', false, 'error', 'devy shares don''t trade during the draft');
    end if;
    lin := _lineage(p_league_id);
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  -- THE SEATS, first: every later check needs to know who is in the room.
  for leg in select * from jsonb_array_elements(p_legs) loop
    begin rid := (leg ->> 'roster')::int; exception when others then rid := null; end;
    if rid is null then return jsonb_build_object('ok', false, 'error', 'each leg names a team'); end if;
    if rid = any (seats) then return jsonb_build_object('ok', false, 'error', 'a team can only appear once'); end if;
    if not exists (select 1 from league_membership m where m.league_id = p_league_id
                    and m.sleeper_roster_id = rid and m.enrolled) then
      return jsonb_build_object('ok', false, 'error', 'Team ' || rid || ' is not in this league');
    end if;
    seats := seats || rid;
  end loop;
  -- The proposer is one of them. An admin files on the first seat's behalf.
  mine := null;
  foreach rid in array seats loop
    if owns_roster(p_league_id, rid) then mine := rid; exit; end if;
  end loop;
  if mine is null then
    if is_admin() then mine := seats[1];
    else return jsonb_build_object('ok', false, 'error', 'not your seat — you must be in the trade to offer it'); end if;
  end if;
  err := trade_deadline_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  foreach rid in array seats loop
    err := team_lock_reason(p_league_id, rid);
    if err is not null then
      return jsonb_build_object('ok', false, 'error', _txn_team(p_league_id, rid) || ': ' || err);
    end if;
  end loop;

  -- THE ASSETS, leg by leg.
  for leg in select * from jsonb_array_elements(p_legs) loop
    rid := (leg ->> 'roster')::int;
    if jsonb_typeof(coalesce(leg -> 'retain', '[]'::jsonb)) = 'array'
       and jsonb_array_length(coalesce(leg -> 'retain', '[]'::jsonb)) > 0 then
      return jsonb_build_object('ok', false, 'error',
        'salary retention is a two-team term — leave it off a multi-team trade');
    end if;
    -- players
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; exception when others then dest := null; end;
      if dest is null or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'every player must be sent to another team in the trade');
      end if;
      if not exists (select 1 from native_roster nr where nr.league_id = p_league_id
                      and nr.roster_id = rid and nr.slug = el ->> 'slug') then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(p_league_id, rid) || ' does not hold ' || coalesce(el ->> 'slug', '—'));
      end if;
      -- 0500: COPIES — the receiving team may not already hold him.
      if exists (select 1 from native_roster nr where nr.league_id = p_league_id
                  and nr.roster_id = dest and nr.slug = el ->> 'slug') then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(p_league_id, dest) || ' already has ' || _txn_player(p_league_id, el ->> 'slug'));
      end if;
      if (el ->> 'slug') = any (slugs) then
        return jsonb_build_object('ok', false, 'error', 'a player can only appear once');
      end if;
      slugs := slugs || (el ->> 'slug'); touched := touched || rid || dest; assets := assets + 1;
    end loop;
    -- picks: cleaned one at a time so each keeps its own destination
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_picks', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; exception when others then dest := null; end;
      if dest is null or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'every pick must be sent to another team in the trade');
      end if;
      if not league_pick_trading(p_league_id) then
        return jsonb_build_object('ok', false, 'error', 'the commissioner has pick trading turned off');
      end if;
      begin cleaned := _clean_trade_picks(p_league_id, jsonb_build_array(el)) -> 0;
      exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
      err := _pick_ownership_error(p_league_id, rid, jsonb_build_array(cleaned));
      if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
      err := _pick_locked_error(p_league_id, cleaned ->> 'season', (cleaned ->> 'round')::int, (cleaned ->> 'orig')::int);
      if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
      if ((cleaned ->> 'season') || '/' || (cleaned ->> 'round') || '/' || (cleaned ->> 'orig')) = any (pkeys) then
        return jsonb_build_object('ok', false, 'error', 'a pick can only appear once');
      end if;
      pkeys := pkeys || ((cleaned ->> 'season') || '/' || (cleaned ->> 'round') || '/' || (cleaned ->> 'orig'));
      touched := touched || rid || dest; assets := assets + 1;
    end loop;
    -- FAAB dollars
    legsum := 0;
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_faab', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int; exception when others then dest := null; end;
      if dest is null or amt is null or amt < 1 or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'FAAB must be a positive amount sent to another team in the trade');
      end if;
      if league_waiver_mode(p_league_id) <> 'faab' then
        return jsonb_build_object('ok', false, 'error', 'FAAB dollars only move in a FAAB league');
      end if;
      if not league_faab_trading(p_league_id) then
        return jsonb_build_object('ok', false, 'error', 'the commissioner has FAAB trading turned off');
      end if;
      legsum := legsum + amt; touched := touched || rid || dest; assets := assets + 1;
    end loop;
    if legsum > 0 and legsum > member_faab(p_league_id, rid) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(p_league_id, rid) || ' has $' || member_faab(p_league_id, rid) || ' of FAAB left');
    end if;
    -- cap dollars
    legsum := 0;
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_cap', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int; exception when others then dest := null; end;
      if dest is null or amt is null or amt < 1 or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'cap room must be a positive amount sent to another team in the trade');
      end if;
      if not contracts_on(p_league_id) then
        return jsonb_build_object('ok', false, 'error', 'cap-space trading needs a contract league');
      end if;
      if not cap_trading_on(p_league_id) then
        return jsonb_build_object('ok', false, 'error', 'the commissioner has cap-space trading turned off');
      end if;
      legsum := legsum + amt; touched := touched || rid || dest; assets := assets + 1;
    end loop;
    if legsum > 100000 then
      return jsonb_build_object('ok', false, 'error', 'cap dollars must be within $100000');
    end if;
    -- 0397: devy shares — a number of one stake, each to another seat
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_shares', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; amt := (el ->> 'shares')::int; exception when others then dest := null; end;
      if dest is null or amt is null or amt < 1 or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'shares must be a positive number sent to another team in the trade');
      end if;
      if coalesce(el ->> 'slug', '') !~ '^c-[0-9]+$' then
        return jsonb_build_object('ok', false, 'error', 'shares are in college players');
      end if;
      if exists (select 1 from player_alias a where a.old_slug = el ->> 'slug') then
        return jsonb_build_object('ok', false, 'error', 'shares in a player who turned pro settle at the draft — they don''t trade');
      end if;
      if (rid || ':' || (el ->> 'slug')) = any (skeys) then
        return jsonb_build_object('ok', false, 'error', 'a stake can only appear once per team');
      end if;
      select shares into held from devy_share where lineage = lin and roster_id = rid and slug = el ->> 'slug';
      if coalesce(held, 0) < amt then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(p_league_id, rid) || ' holds ' || coalesce(held, 0) || ' shares of ' || coalesce((select full_name from college_player where espn_id = substr(el ->> 'slug', 3)), el ->> 'slug'));
      end if;
      skeys := skeys || (rid || ':' || (el ->> 'slug'));
      touched := touched || rid || dest; assets := assets + 1;
    end loop;
    -- 0397: devy cash
    cash_sum := 0;
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_devy_cash', '[]'::jsonb)) loop
      begin dest := (el ->> 'to')::int; camt := round((el ->> 'amount')::numeric, 2); exception when others then dest := null; end;
      if dest is null or camt is null or camt <= 0 or not (dest = any (seats)) or dest = rid then
        return jsonb_build_object('ok', false, 'error', 'devy cash must be a positive amount sent to another team in the trade');
      end if;
      cash_sum := cash_sum + camt; touched := touched || rid || dest; assets := assets + 1;
    end loop;
    if cash_sum > 0 and cash_sum > _devy_cash(lin, rid) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(p_league_id, rid) || ' has ' || trim(to_char(_devy_cash(lin, rid), 'FM999990.##')) || ' devy cash');
    end if;
  end loop;
  if assets < 1 then
    return jsonb_build_object('ok', false, 'error', 'a trade moves something');
  end if;
  -- A seat nobody sends to and that sends nothing is in the room for nothing.
  foreach rid in array seats loop
    if not (rid = any (touched)) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(p_league_id, rid) || ' neither sends nor receives anything');
    end if;
  end loop;

  if p_expires_hours is not null and p_expires_hours <> -1
     and (p_expires_hours < 1 or p_expires_hours > 720) then
    return jsonb_build_object('ok', false, 'error', 'an offer expires in 1–720 hours');
  end if;
  exp := case when p_expires_hours = -1 then null
              when p_expires_hours is not null then now() + make_interval(hours => p_expires_hours)
              when league_trade_offer_days(p_league_id) > 0
                then now() + make_interval(days => league_trade_offer_days(p_league_id))
         end;
  -- The legacy pair: the proposer, and the next seat along (see the header).
  select min(s) into second_seat from unnest(seats) s where s <> mine;
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, note, created_by, expires_at)
    values (p_league_id, mine, second_seat, '[]'::jsonb, '[]'::jsonb,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), exp)
    returning id into tid;
  for leg in select * from jsonb_array_elements(p_legs) loop
    rid := (leg ->> 'roster')::int;
    cleaned := '[]'::jsonb;
    for el in select * from jsonb_array_elements(coalesce(leg -> 'send_picks', '[]'::jsonb)) loop
      cleaned := cleaned || jsonb_build_array(
        (_clean_trade_picks(p_league_id, jsonb_build_array(el)) -> 0)
          || jsonb_build_object('to', (el ->> 'to')::int));
    end loop;
    insert into trade_leg (trade_id, league_id, roster_id, send, send_picks, send_faab, send_cap, send_shares, send_devy_cash, accepted, accepted_at)
      values (tid, p_league_id, rid,
              coalesce(leg -> 'send', '[]'::jsonb), cleaned,
              coalesce(leg -> 'send_faab', '[]'::jsonb), coalesce(leg -> 'send_cap', '[]'::jsonb),
              -- 0397
              coalesce((select jsonb_agg(jsonb_build_object('slug', e ->> 'slug', 'shares', (e ->> 'shares')::int, 'to', (e ->> 'to')::int))
                          from jsonb_array_elements(coalesce(leg -> 'send_shares', '[]'::jsonb)) e), '[]'::jsonb),
              coalesce((select jsonb_agg(jsonb_build_object('amount', round((e ->> 'amount')::numeric, 2), 'to', (e ->> 'to')::int))
                          from jsonb_array_elements(coalesce(leg -> 'send_devy_cash', '[]'::jsonb)) e), '[]'::jsonb),
              rid = mine, case when rid = mine then now() end);
  end loop;
  return jsonb_build_object('ok', true, 'trade_id', tid, 'teams', array_length(seats, 1), 'expires_at', exp);
end $$;

-- ── _execute_multi_trade (0397) ───────────────────────────────────────────
create or replace function _execute_multi_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; lseas text; err text;
        leg record; el jsonb; seats int[]; seat int; dest int; amt int;
        v_out jsonb; v_in jsonb; ov int; knd text; owner int;
        lin text; held int; incash numeric; outcash numeric; recv int; camt numeric;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  seats := _trade_seats(p_trade_id);

  -- 1. IS EVERY PIECE STILL WHERE THE DEAL SAID IT WAS? A multi-team offer
  --    can sit through a waiver run and a week of drops like any other.
  for leg in select * from trade_leg where trade_id = p_trade_id loop
    for el in select * from jsonb_array_elements(leg.send) loop
      if not exists (select 1 from native_roster nr where nr.league_id = t.league_id
                      and nr.roster_id = leg.roster_id and nr.slug = el ->> 'slug') then
        return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
      end if;
      -- 0500: COPIES
      if exists (select 1 from native_roster nr where nr.league_id = t.league_id
                  and nr.roster_id = (el ->> 'to')::int and nr.slug = el ->> 'slug') then
        return jsonb_build_object('ok', false, 'error', 'a team in this trade now has one of those players — re-propose');
      end if;
    end loop;
    if _pick_ownership_error(t.league_id, leg.roster_id, leg.send_picks) is not null then
      return jsonb_build_object('ok', false, 'error', 'picks moved since the deal was struck — re-propose');
    end if;
    for el in select * from jsonb_array_elements(leg.send_picks) loop
      err := _pick_locked_error(t.league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
      if err is not null then return jsonb_build_object('ok', false, 'error', err || ' — re-propose'); end if;
    end loop;
    -- the wallet, re-read at execution the way 0321 re-reads a two-seat one
    if jsonb_array_length(leg.send_faab) > 0 then
      select sum((e ->> 'amount')::int) into amt from jsonb_array_elements(leg.send_faab) e;
      if amt > member_faab(t.league_id, leg.roster_id) then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(t.league_id, leg.roster_id) || ' no longer has $' || amt || ' of FAAB — re-propose');
      end if;
    end if;
  end loop;

  -- 1b. 0397: DEVY SHARES AND CASH, re-read at execution.
  if exists (select 1 from trade_leg where trade_id = p_trade_id
              and (jsonb_array_length(send_shares) > 0 or jsonb_array_length(send_devy_cash) > 0)) then
    if not _devy_shares_on(t.league_id) then
      return jsonb_build_object('ok', false, 'error', 'the league isn''t playing devy shares any more — re-propose');
    end if;
    if exists (select 1 from draft where league_id = t.league_id and status = 'live') then
      return jsonb_build_object('ok', false, 'error', 'devy shares don''t trade during the draft — accept it after');
    end if;
    lin := _lineage(t.league_id);
    perform pg_advisory_xact_lock(hashtext('devy_share:' || lin));
    for leg in select * from trade_leg where trade_id = p_trade_id loop
      for el in select * from jsonb_array_elements(leg.send_shares) loop
        select shares into held from devy_share where lineage = lin and roster_id = leg.roster_id and slug = el ->> 'slug';
        if coalesce(held, 0) < (el ->> 'shares')::int then
          return jsonb_build_object('ok', false, 'error', 'devy shares moved since the deal was struck — re-propose');
        end if;
        if exists (select 1 from player_alias a where a.old_slug = el ->> 'slug') then
          return jsonb_build_object('ok', false, 'error', 'a player in the deal turned pro — his shares settle at the draft');
        end if;
      end loop;
    end loop;
    -- every receiving stake stays within 20 shares; every seat's cash within 200 and above 0
    for recv, el in select (e ->> 'to')::int, e from trade_leg l, jsonb_array_elements(l.send_shares) e where l.trade_id = p_trade_id loop
      if coalesce((select shares from devy_share where lineage = lin and roster_id = recv and slug = el ->> 'slug'), 0)
         + (select coalesce(sum((x ->> 'shares')::int), 0) from trade_leg l2, jsonb_array_elements(l2.send_shares) x
             where l2.trade_id = p_trade_id and (x ->> 'to')::int = recv and x ->> 'slug' = el ->> 'slug')
         > (_devy_share_rules() ->> 'max')::int then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(t.league_id, recv) || ' would hold more than ' || (_devy_share_rules() ->> 'max') || ' shares of one player');
      end if;
    end loop;
    foreach seat in array seats loop
      select coalesce(sum((e ->> 'amount')::numeric), 0) into outcash from trade_leg l, jsonb_array_elements(l.send_devy_cash) e
       where l.trade_id = p_trade_id and l.roster_id = seat;
      select coalesce(sum((e ->> 'amount')::numeric), 0) into incash from trade_leg l, jsonb_array_elements(l.send_devy_cash) e
       where l.trade_id = p_trade_id and (e ->> 'to')::int = seat;
      if outcash > _devy_cash(lin, seat) then
        return jsonb_build_object('ok', false, 'error', _txn_team(t.league_id, seat) || ' no longer has that devy cash — re-propose');
      end if;
      if incash > 0 and _devy_cash(lin, seat) - outcash + incash > (_devy_share_rules() ->> 'cash_cap')::numeric then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(t.league_id, seat) || ' would pass ' || (_devy_share_rules() ->> 'cash_cap') || ' devy cash');
      end if;
    end loop;
  end if;

  -- 2. EVERY seat has to land legal, not just the two ends of a swap.
  foreach seat in array seats loop
    select coalesce(jsonb_agg(e ->> 'slug'), '[]'::jsonb) into v_out
      from trade_leg l, jsonb_array_elements(l.send) e
     where l.trade_id = p_trade_id and l.roster_id = seat;
    select coalesce(jsonb_agg(e ->> 'slug'), '[]'::jsonb) into v_in
      from trade_leg l, jsonb_array_elements(l.send) e
     where l.trade_id = p_trade_id and (e ->> 'to')::int = seat;
    err := trade_cap_error(t.league_id, seat, v_out, v_in);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end loop;

  -- 3. THE MOVES. Players first, each to the seat its own line named.
  for leg in select * from trade_leg where trade_id = p_trade_id loop
    for el in select * from jsonb_array_elements(leg.send) loop
      update native_roster nr set roster_id = (el ->> 'to')::int, acquired = 'trade'
        where nr.league_id = t.league_id and nr.roster_id = leg.roster_id and nr.slug = el ->> 'slug';
    end loop;
    for el in select * from jsonb_array_elements(leg.send_picks) loop
      update pick_asset set owner_roster = (el ->> 'to')::int
        where league_id = t.league_id and season = el ->> 'season'
          and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
    end loop;
  end loop;

  -- Keep the running draft's own copy of ownership in step (0190).
  select * into d from draft where league_id = t.league_id;
  select season into lseas from league where id = t.league_id;
  if d.pick_owners is not null then
    for el in select e from trade_leg l, jsonb_array_elements(l.send_picks) e where l.trade_id = p_trade_id loop
      if (el ->> 'season') = lseas then
        select kind, owner_roster into knd, owner from pick_asset where league_id = t.league_id
          and season = el ->> 'season' and round = (el ->> 'round')::int
          and original_roster = (el ->> 'orig')::int;
        ov := _pick_overall(t.league_id, (el ->> 'round')::int, (el ->> 'orig')::int,
                            coalesce(knd, 'startup') = 'startup');
        if ov is not null and ov >= 1 and ov <= jsonb_array_length(d.pick_owners) then
          d.pick_owners := jsonb_set(d.pick_owners, array[(ov - 1)::text], to_jsonb(owner));
        end if;
      end if;
    end loop;
    update draft set pick_owners = d.pick_owners where league_id = t.league_id;
  end if;

  -- 4. THE DOLLARS, addressed like everything else.
  for leg in select * from trade_leg where trade_id = p_trade_id loop
    for el in select * from jsonb_array_elements(leg.send_faab) loop
      dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int;
      update league_membership set faab_budget = member_faab(t.league_id, leg.roster_id) - amt
        where league_id = t.league_id and sleeper_roster_id = leg.roster_id;
      update league_membership set faab_budget = member_faab(t.league_id, dest) + amt
        where league_id = t.league_id and sleeper_roster_id = dest;
      insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
      values (t.league_id, 'faab', dest, '', leg.roster_id, '$' || amt || ' of FAAB traded');
    end loop;
    for el in select * from jsonb_array_elements(leg.send_cap) loop
      dest := (el ->> 'to')::int; amt := (el ->> 'amount')::int;
      update league_membership set cap_adjust = cap_adjust - amt
        where league_id = t.league_id and sleeper_roster_id = leg.roster_id;
      update league_membership set cap_adjust = cap_adjust + amt
        where league_id = t.league_id and sleeper_roster_id = dest;
      insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
      values (t.league_id, 'cap', dest, '', leg.roster_id, '$' || amt || ' of cap room traded');
    end loop;
  end loop;
  -- 4b. 0397: the shares (with their cost, and a whole stake's place in line) and the devy cash.
  if lin is not null then
    for leg in select * from trade_leg where trade_id = p_trade_id loop
      for el in select * from jsonb_array_elements(leg.send_shares) loop
        perform _devy_move_shares(lin, leg.roster_id, (el ->> 'to')::int, el ->> 'slug', (el ->> 'shares')::int);
      end loop;
      for el in select * from jsonb_array_elements(leg.send_devy_cash) loop
        camt := (el ->> 'amount')::numeric;
        perform _devy_cash_add(lin, leg.roster_id, -camt);
        perform _devy_cash_add(lin, (el ->> 'to')::int, camt);
      end loop;
    end loop;
  end if;
  if contracts_on(t.league_id) then
    foreach seat in array seats loop
      if team_payroll(t.league_id, seat) > team_cap(t.league_id, seat) then
        raise exception 'salary cap exceeded — team % at $% of $%', seat,
          team_payroll(t.league_id, seat), team_cap(t.league_id, seat);
      end if;
    end loop;
  end if;

  perform _chat_house(t.league_id,
    '🤝 ' || array_length(seats, 1) || '-team trade — ' || coalesce(_trade_summary(p_trade_id), ''),
    jsonb_build_object('kind', 'trade', 'multi', true, 'trade_id', p_trade_id,
                       'seats', to_jsonb(seats)));
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true, 'teams', array_length(seats, 1));
end $$;

-- ── trade_cap_error (0366) — each player counted once, whatever his copies ────
create or replace function trade_cap_error(p_league_id uuid, p_roster_id int, p_out jsonb, p_in jsonb)
  returns text language plpgsql stable security definer set search_path = public as $$
declare rec record; cap int; cur int; rounds int; new_n int; dv int;
begin
  dv := _devy_slots(p_league_id);
  select d.rounds into rounds from draft d where d.league_id = p_league_id;
  select count(*) into cur from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  new_n := cur - jsonb_array_length(p_out) + jsonb_array_length(p_in);
  if new_n > rounds then
    return 'trade would overfill Team ' || p_roster_id || '''s roster (' || rounds || ' spots)';
  end if;
  -- 0366: devy spots and the rest fill separately. A traded row keeps its
  -- spot, so count by spot on both sides of the deal.
  if dv > 0 then
    select count(*) filter (where spot = 'devy'), count(*) filter (where spot <> 'devy') into cur, new_n
      from native_roster where league_id = p_league_id and roster_id = p_roster_id;
    cur := cur
      - (select count(*) from jsonb_array_elements_text(p_out) s(slug) join lateral (select 1 from native_roster x
           where x.league_id = p_league_id and x.slug = s.slug and x.spot = 'devy' limit 1) x on true)
      + (select count(*) from jsonb_array_elements_text(p_in) s(slug) join lateral (select 1 from native_roster x
           where x.league_id = p_league_id and x.slug = s.slug and x.spot = 'devy' limit 1) x on true);
    if cur > dv then
      return 'trade would overfill Team ' || p_roster_id || '''s devy spots (' || dv || ')';
    end if;
    new_n := new_n
      - (select count(*) from jsonb_array_elements_text(p_out) s(slug) join lateral (select 1 from native_roster x
           where x.league_id = p_league_id and x.slug = s.slug and x.spot <> 'devy' limit 1) x on true)
      + (select count(*) from jsonb_array_elements_text(p_in) s(slug) join lateral (select 1 from native_roster x
           where x.league_id = p_league_id and x.slug = s.slug and x.spot <> 'devy' limit 1) x on true);
    if new_n > rounds - dv then
      return 'trade would overfill Team ' || p_roster_id || '''s NFL roster (' || (rounds - dv) || ' spots)';
    end if;
  end if;
  for rec in
    select t.pos, sum(t.inc)::int as inc, sum(t.outc)::int as outc from (
      select lp.pos, 1 as inc, 0 as outc from jsonb_array_elements_text(p_in) s(slug)
        join league_pool lp on lp.league_id = p_league_id and lp.slug = s.slug
        join lateral (select 1 from native_roster x where x.league_id = p_league_id and x.slug = s.slug and (dv = 0 or x.spot <> 'devy') limit 1) x on true
      union all
      select lp.pos, 0, 1 from jsonb_array_elements_text(p_out) s(slug)
        join league_pool lp on lp.league_id = p_league_id and lp.slug = s.slug
        join lateral (select 1 from native_roster x where x.league_id = p_league_id and x.slug = s.slug and (dv = 0 or x.spot <> 'devy') limit 1) x on true
    ) t group by t.pos
  loop
    cap := league_pos_cap(p_league_id, rec.pos);
    if cap is not null then
      select count(*) into cur
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      where nr.league_id = p_league_id and nr.roster_id = p_roster_id and lp.pos = rec.pos
        and (dv = 0 or nr.spot <> 'devy');
      new_n := cur - rec.outc + rec.inc;
      if new_n > cap then
        return 'position limit — Team ' || p_roster_id || ' would hold more than ' || cap || ' ' || pos_label(rec.pos);
      end if;
    end if;
  end loop;
  return null;
end $$;

-- ── set_trade_signal (0140) ───────────────────────────────────────────────
create or replace function set_trade_signal(p_league_id uuid, p_roster_id int, p_slug text, p_kind text, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare holder int;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  if p_kind not in ('block', 'want') then
    return jsonb_build_object('ok', false, 'error', 'kind must be block or want');
  end if;
  if not p_on then
    delete from trade_signal
      where league_id = p_league_id and roster_id = p_roster_id and slug = p_slug and kind = p_kind;
    return jsonb_build_object('ok', true, 'on', false);
  end if;
  -- 0500: COPIES — your own copy is the holder that matters; else any other team's.
  select nr.roster_id into holder from native_roster nr
    where nr.league_id = p_league_id and nr.slug = p_slug
    order by (nr.roster_id = p_roster_id) desc, nr.roster_id limit 1;
  if holder is null then
    return jsonb_build_object('ok', false, 'error', 'player is not on a roster in this league');
  end if;
  if p_kind = 'block' and holder <> p_roster_id then
    return jsonb_build_object('ok', false, 'error', 'you can only put your own players on the block');
  end if;
  if p_kind = 'want' and holder = p_roster_id then
    return jsonb_build_object('ok', false, 'error', 'that player is already on your roster');
  end if;
  insert into trade_signal (league_id, roster_id, slug, kind)
    values (p_league_id, p_roster_id, p_slug, p_kind)
    on conflict do nothing;
  return jsonb_build_object('ok', true, 'on', true);
end $$;

-- ── api_players (0331) ────────────────────────────────────────────────────
create or replace function api_players(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
        'rank', lp.rank, 'exp', lp.exp, 'espn_id', lp.espn_id,
        'sleeper_id', lp.sleeper_id,
        'gsis_id', x.gsis_id, 'pfr_id', x.pfr_id, 'yahoo_id', x.yahoo_id,
        'sportradar_id', x.sportradar_id,
        'roster_id', (select min(nr.roster_id) from native_roster nr
                       where nr.league_id = p_league_id and nr.slug = lp.slug),
        -- 0500: with copies, every team that holds him
        'roster_ids', coalesce((select jsonb_agg(nr.roster_id order by nr.roster_id) from native_roster nr
                       where nr.league_id = p_league_id and nr.slug = lp.slug), '[]'::jsonb))
        order by lp.rank nulls last, lp.full_name)
      from league_pool lp
      left join lateral _xref_for(lp.espn_id, lp.sleeper_id) x on true
     where lp.league_id = p_league_id), '[]'::jsonb));
end $$;

-- ── league_player_adjustments (0493) ──────────────────────────────────────
create or replace function league_player_adjustments(p_league_id uuid, p_week int default null, p_search text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), ''); lg league; wk int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'adjustments', coalesce((
    select jsonb_agg(jsonb_build_object('week', a.week, 'slug', a.slug, 'name', _txn_player(a.league_id, a.slug),
             'points', a.points, 'note', a.note, 'set_at', a.set_at, 'hurt', a.hurt) order by a.week desc, a.set_at desc)
      from player_adjustment a
     where a.league_id = p_league_id and (p_week is null or a.week = p_week)), '[]'::jsonb),
    'found', case when q is null or not (is_league_commish(p_league_id) or is_admin()) then '[]'::jsonb
      when _is_contest(lg) then coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('slug', ps.slug, 'name', ps.name, 'pos', ps.pos, 'team', ps.team,
                   'owner', case when h.n > 0 then 'in ' || h.n || ' squad' || case when h.n = 1 then '' else 's' end end) as x
            from pod_salary ps
            left join lateral (select count(*) as n from sleeper_lineup sl
                                where sl.league_id = p_league_id and sl.week = ps.week
                                  and exists (select 1 from jsonb_array_elements(sl.starters_json) e where e ->> 'player_slug' = ps.slug)) h on true
           where ps.season = lg.season and ps.week = coalesce(p_week, lg.contest_week, _contest_week(lg.season))
             and ps.name ilike '%' || q || '%'
           order by (h.n = 0), ps.salary desc limit 12) s), '[]'::jsonb)
      else coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
                   'owner', nr.owners) as x
            from league_pool lp
            left join lateral (select min(n.roster_id) as roster_id, string_agg(_txn_team(p_league_id, n.roster_id), ', ' order by n.roster_id) as owners
                                 from native_roster n where n.league_id = lp.league_id and n.slug = lp.slug) nr on true
           where lp.league_id = p_league_id and lp.full_name ilike '%' || q || '%'
           order by (nr.roster_id is null), lp.rank limit 12) s), '[]'::jsonb) end);
end $$;

-- ── convert_league_to_native (0263) ───────────────────────────────────────
create or replace function convert_league_to_native(
  p_league_id uuid, p_pool jsonb default null, p_dry_run boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lg league%rowtype;
  snap_wk int; teams int; cap int; next_rank int;
  e record; tgt_slug text; sid text; sl text; spot_v text;
  matched_id int := 0; matched_slug int := 0; added int := 0; dups int := 0;
  skipped jsonb := '[]'::jsonb; skipped_n int := 0;
  pool_n int := 0; rostered int := 0; weeks int := 0; unclaimed int := 0;
  seats jsonb; sc jsonb; sj jsonb; new_key text; summary jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not has_native() then
    return jsonb_build_object('ok', false, 'error', 'native leagues are invite-only — ask the pilot owner for access');
  end if;

  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if lg.provider = 'native' then
    return jsonb_build_object('ok', false, 'error', 'already a native league');
  end if;
  if coalesce(lg.provider, 'sleeper') not in ('sleeper', 'espn') then
    return jsonb_build_object('ok', false, 'error', 'unknown provider — only imported sleeper/espn leagues convert');
  end if;
  if lg.commissioner_id is null then
    return jsonb_build_object('ok', false, 'error', 'league needs a commissioner — redeem the commish code first');
  end if;
  -- Same gate, same words as native_generate_schedule (0064): a converted
  -- league is born pre-season or between seasons, never mid-week.
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'season already underway — schedule is locked');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'league already has a draft row');
  end if;
  if p_pool is not null and jsonb_typeof(p_pool) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'pool must be an array');
  end if;
  if p_pool is not null and jsonb_array_length(p_pool) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large (max 2000)');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_league_id::text));

  select max(week) into snap_wk from sleeper_lineup where league_id = p_league_id;
  if snap_wk is null then
    return jsonb_build_object('ok', false, 'error', 'no synced rosters — run ⟳ sync season first');
  end if;
  select count(*)::int into teams from league_membership where league_id = p_league_id;
  if teams < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  begin  -- ← the dry-run savepoint: everything below rolls back on the sentinel
    -- 1 · Pool. Filter and shape are seed_league_pool's (0205), verbatim —
    -- position whitelist, blank-to-null ids, ordinality as rank.
    delete from league_pool where league_id = p_league_id;  -- imported leagues have none; be exact anyway
    if p_pool is not null then
      insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
      select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
             nullif(btrim(coalesce(p ->> 'espn_id', '')), ''),
             case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
                  then least(30, greatest(0, (p ->> 'exp')::int)) end,
             nullif(btrim(coalesce(p ->> 'sleeper_id', '')), '')
      from jsonb_array_elements(p_pool) with ordinality as t(p, ord)
      where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
        and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
      on conflict (league_id, slug) do nothing;
      get diagnostics pool_n = row_count;
    end if;
    select coalesce(max(rank), 0) + 1 into next_rank from league_pool where league_id = p_league_id;

    -- 2 · Rosters, from the snapshot week. Sleeper entries carry player_slug +
    -- sleeper_id (server/src/sync.js); ESPN entries carry slug only
    -- (providerAdmin.ts); native_materialize writes both — coalesce reads all.
    for e in
      select l.roster_id,
             ent.value as entry
      from sleeper_lineup l, jsonb_array_elements(l.starters_json) as ent
      where l.league_id = p_league_id and l.week = snap_wk
      order by l.roster_id, (ent.value ->> 'slot')::numeric nulls last
    loop
      sid := nullif(btrim(coalesce(e.entry ->> 'sleeper_id', '')), '');
      sl  := nullif(btrim(coalesce(e.entry ->> 'player_slug', e.entry ->> 'slug', '')), '');
      tgt_slug := null;
      if sid is not null then
        select slug into tgt_slug from league_pool
          where league_id = p_league_id and sleeper_id = sid;
        if tgt_slug is not null then matched_id := matched_id + 1; end if;
      end if;
      if tgt_slug is null and sl is not null then
        if exists (select 1 from league_pool where league_id = p_league_id and slug = sl) then
          tgt_slug := sl; matched_slug := matched_slug + 1;
        end if;
      end if;
      if tgt_slug is null then
        -- Not in the pool: append rather than drop — unless the entry can't
        -- be a pool row at all (no slug, or a position the game doesn't hold).
        if sl is not null
           and coalesce(e.entry ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P') then
          insert into league_pool (league_id, slug, full_name, pos, team, rank, sleeper_id)
          values (p_league_id, sl,
                  coalesce(nullif(btrim(coalesce(e.entry ->> 'full', '')), ''), sl),
                  e.entry ->> 'pos', coalesce(e.entry ->> 'team', ''), next_rank, sid)
          on conflict (league_id, slug) do nothing;
          if found then
            next_rank := next_rank + 1; added := added + 1; tgt_slug := sl;
          end if;
        end if;
      end if;
      if tgt_slug is null then
        skipped_n := skipped_n + 1;
        if jsonb_array_length(skipped) < 40 then
          skipped := skipped || jsonb_build_object(
            'roster_id', e.roster_id,
            'full', coalesce(e.entry ->> 'full', sl, sid, '?'),
            'pos', coalesce(e.entry ->> 'pos', '?'));
        end if;
        continue;
      end if;
      spot_v := case coalesce(e.entry ->> 'grp', 'start')
                  when 'ir' then 'ir' when 'taxi' then 'taxi' else 'active' end;
      -- 0500: the roster key is per team now; one team per player is this path's own rule.
      insert into native_roster (league_id, roster_id, slug, acquired, spot)
        select p_league_id, e.roster_id, tgt_slug, 'draft', spot_v
         where not exists (select 1 from native_roster x where x.league_id = p_league_id and x.slug = tgt_slug);
      if not found then dups := dups + 1; end if;
    end loop;

    select count(*)::int into rostered from native_roster where league_id = p_league_id;
    if rostered = 0 then
      -- Same rollback trick as the dry run: nothing above survives.
      raise exception 'no rostered players' using errcode = 'PD264';
    end if;

    -- 3 · Roster cap = the biggest converted ACTIVE roster (0064: rounds IS
    -- the cap; 0164: taxi/IR ride above it), inside the draft's own bounds.
    select greatest(5, least(99, coalesce(max(n), 5)))::int into cap from (
      select count(*) as n from native_roster
      where league_id = p_league_id and spot = 'active' group by roster_id
    ) t;

    -- 4 · Waiver order: seat order. An imported league has no draft order to
    -- reverse and no standings yet; the commissioner inherits a deterministic
    -- baseline and the first won claim starts the rotation (0064).
    update league_membership m set waiver_priority = r.rn
    from (select sleeper_roster_id, row_number() over (order by sleeper_roster_id)::int as rn
          from league_membership where league_id = p_league_id) r
    where m.league_id = p_league_id and m.sleeper_roster_id = r.sleeper_roster_id;

    -- 5 · The flip: settings surgery, provider, key.
    sj := coalesce(lg.settings_json, '{}'::jsonb);
    sc := sj -> 'scoring';
    if sc is not null and jsonb_typeof(sc) = 'object' and not (sc ? 'td_bonus') then
      sj := (sj - 'scoring') || jsonb_build_object('imported_scoring', sc);
    end if;
    sj := sj || jsonb_build_object('teams', teams, 'rounds', cap, 'mode', 'snake',
      'converted_from', jsonb_build_object(
        'provider', coalesce(lg.provider, 'sleeper'),
        'key', lg.sleeper_league_id, 'at', now()));
    new_key := 'native-' || replace(gen_random_uuid()::text, '-', '');
    update league set provider = 'native', sleeper_league_id = new_key,
        settings_json = sj, synced_at = now()
      where id = p_league_id;

    -- 6 · The completed draft — AFTER the rosters (see header: 0186's log
    -- gate). current_overall mirrors where native_exec_pick leaves it.
    select jsonb_agg(to_jsonb(sleeper_roster_id) order by sleeper_roster_id) into seats
      from league_membership where league_id = p_league_id;
    insert into draft (league_id, status, rounds, pick_seconds, mode, draft_order,
                       current_overall, started_at, completed_at)
    values (p_league_id, 'complete', cap, 86400, 'snake', seats,
            cap * teams + 1, now(), now());

    -- 7 · Materialize every (all-scheduled, i.e. every) week from the rosters.
    weeks := native_materialize(p_league_id);

    select count(*)::int into unclaimed from league_membership
      where league_id = p_league_id and app_user_id is null;

    summary := jsonb_build_object('ok', true,
      'teams', teams, 'rounds', cap, 'pool', pool_n + added, 'rostered', rostered,
      'matched_by_id', matched_id, 'matched_by_slug', matched_slug,
      'added_to_pool', added, 'skipped', skipped, 'skipped_n', skipped_n,
      'dups', dups, 'weeks_materialized', weeks, 'snapshot_week', snap_wk,
      'unclaimed_seats', unclaimed);

    if p_dry_run then
      raise exception 'dry run' using errcode = 'PD263';
    end if;
  exception
    when sqlstate 'PD263' then
      return summary || jsonb_build_object('dry_run', true);
    when sqlstate 'PD264' then
      return jsonb_build_object('ok', false,
        'error', 'no rostered players could be converted — sync the league, then try again');
  end;

  return summary;
end $$;

-- ══ the functions that now take the team ═════════════════════════════════════════
-- ── set_roster_spot (0440) + the team ─────────────────────────────────────
drop function if exists set_roster_spot(uuid, text, text);
create or replace function set_roster_spot(p_league_id uuid, p_slug text, p_spot text, p_roster_id int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; sh jsonb; cnt int; cap int; ist text; mx int; pexp int; tags text[];
begin
  if p_spot not in ('active', 'taxi', 'ir', 'out', 'devy') then
    return jsonb_build_object('ok', false, 'error', 'spot must be active, taxi, ir, out, or devy');
  end if;
  -- 0500: whose copy — the team named, else the caller's own, else the only holder.
  rid := _copy_holder(p_league_id, p_slug, p_roster_id);
  if rid is null then
    return jsonb_build_object('ok', false, 'error', case
      when p_roster_id is null and exists (select 1 from native_roster where league_id = p_league_id and slug = p_slug)
        then 'more than one team holds him — say which team' else 'player not rostered' end);
  end if;
  -- 0299: the WORKER may also act, for a seat nobody holds (0213's terms).
  if not (owns_roster(p_league_id, rid) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, rid))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  sh := _roster_shape(p_league_id);
  -- ── DEVY (0366) ────────────────────────────────────────────────────────
  -- Devy spots hold college players, and a college player holds nothing
  -- else. A graduated player may stay in his devy spot until moved OUT of
  -- it, but nobody moves an NFL player IN.
  if p_spot = 'devy' then
    cap := coalesce((sh ->> 'devy')::int, 0);
    if cap = 0 then return jsonb_build_object('ok', false, 'error', 'this league has no devy spots'); end if;
    if p_slug !~ '^c-[0-9]+$' then
      return jsonb_build_object('ok', false, 'error', 'devy spots hold college players');
    end if;
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'devy' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'devy is full — ' || cap || ' spots'); end if;
  elsif p_slug ~ '^c-[0-9]+$' and coalesce((sh ->> 'devy')::int, 0) > 0 and not league_is_mixed(p_league_id) then
    -- 0440: in a mixed league (college starting spots) he comes off the
    -- shelf like a taxi player; elsewhere a college player is held.
    return jsonb_build_object('ok', false, 'error', 'a college player stays in a devy spot until he reaches the NFL');
  elsif p_spot = 'taxi' then
    cap := coalesce((sh ->> 'taxi')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'taxi' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'taxi is full — ' || cap || ' spots'); end if;
    -- ── WHO MAY RIDE IT (0196) ───────────────────────────────────────────
    -- The commissioner names a tenure ceiling — "rookies only" is max_exp 0,
    -- "first and second year" is 1. A player whose experience Sleeper doesn't
    -- know cannot prove he qualifies, which is the same answer the pool's
    -- tenure filter gives (0171/0172): unknown is not eligible.
    mx := (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id);
    if mx is not null then
      select lp.exp into pexp from league_pool lp
        where lp.league_id = p_league_id and lp.slug = p_slug;
      if pexp is null then
        return jsonb_build_object('ok', false, 'error',
          'the taxi squad is for players with ' || mx || ' or fewer years — this one''s experience isn''t known');
      end if;
      if pexp > mx then
        return jsonb_build_object('ok', false, 'error',
          'the taxi squad is for players with ' || mx || ' or fewer years — he has ' || pexp);
      end if;
    end if;
    -- ── AND WHEN (0196) ──────────────────────────────────────────────────
    -- Taxi squads shut at the season's first kickoff so nobody stashes a
    -- starter once games are being played. It bites on ADDING only: taking a
    -- player OFF the taxi is always allowed, which is the whole point of
    -- having him there. The COMMISSIONER moves players either way at any time.
    if taxi_is_locked(p_league_id) and not (is_league_commish(p_league_id) or is_admin()) then
      return jsonb_build_object('ok', false, 'error',
        'the taxi squad locked at the season''s first kickoff — you can still take players OFF it');
    end if;
  elsif p_spot = 'ir' then
    cap := coalesce((sh ->> 'ir')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'ir' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'IR is full — ' || cap || ' spots'); end if;
    -- ── ONLY INJURED GUYS (0164, and now the LEAGUE'S OWN LIST — 0198) ────
    -- The commissioner picks which designations qualify; the default is the
    -- pair 0164 hardcoded. The refusal NAMES the list, because "not eligible"
    -- without it sends a manager to the settings page to find out what is.
    -- No exemption for the commissioner here, unlike the taxi lock: the taxi
    -- lock is a DEADLINE (someone has to be able to fix a mistake after it),
    -- while this is a statement about the player, and it is just as true for
    -- the commissioner's own roster as for anyone else's.
    tags := league_ir_tags(p_league_id);
    select status into ist from injury_status where player_slug = p_slug;
    if ist is null or not (upper(ist) = any(tags)) then
      return jsonb_build_object('ok', false, 'error',
        'IR is for players designated ' || array_to_string(tags, '/') ||
        coalesce(' — this one is ' || nullif(upper(ist), ''), ' — this one has no designation'));
    end if;
  elsif p_spot = 'out' then
    -- ── THE SECOND INJURED PLACE (0307) ──────────────────────────────────
    -- OUT is IR's week-to-week sibling: its own count in the shape, its own
    -- list of designations (league_out_tags — O and D by default), the same
    -- rules otherwise. No exemption for the commissioner, for 0198's reason.
    cap := coalesce((sh ->> 'out')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'out' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'OUT is full — ' || cap || ' spots'); end if;
    tags := league_out_tags(p_league_id);
    select status into ist from injury_status where player_slug = p_slug;
    if ist is null or not (upper(ist) = any(tags)) then
      return jsonb_build_object('ok', false, 'error',
        'OUT is for players designated ' || array_to_string(tags, '/') ||
        coalesce(' — this one is ' || nullif(upper(ist), ''), ' — this one has no designation'));
    end if;
  else
    -- Back to active: there must be an active seat open (starters + bench).
    cap := _classic_starters(p_league_id) + coalesce((sh ->> 'bench')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'active' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'active roster is full — stash or drop someone first'); end if;
  end if;
  update native_roster set spot = p_spot where league_id = p_league_id and roster_id = rid and slug = p_slug;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'spot', p_spot);
end $$;
grant execute on function set_roster_spot(uuid, text, text, int) to authenticated;

-- ── swap_roster_spot (0461) + the team ────────────────────────────────────
drop function if exists swap_roster_spot(uuid, text, text);
create or replace function swap_roster_spot(p_league_id uuid, p_out_slug text, p_in_slug text, p_roster_id int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare a native_roster; b native_roster; r jsonb;
begin
  -- 0500: one team's two copies — the team named, else the caller's own, else the only holder.
  select * into a from native_roster where league_id = p_league_id and slug = p_out_slug
     and roster_id = _copy_holder(p_league_id, p_out_slug, p_roster_id);
  select * into b from native_roster where league_id = p_league_id and slug = p_in_slug
     and roster_id = coalesce(a.roster_id, _copy_holder(p_league_id, p_in_slug, p_roster_id));
  if a.slug is null or b.slug is null then return jsonb_build_object('ok', false, 'error', 'player not rostered'); end if;
  if a.roster_id <> b.roster_id then return jsonb_build_object('ok', false, 'error', 'both players must be on the same team'); end if;
  -- set_roster_spot's own door, checked BEFORE anything moves.
  if not (owns_roster(p_league_id, a.roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, a.roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if a.spot not in ('ir', 'out', 'taxi', 'devy') then
    return jsonb_build_object('ok', false, 'error', 'the first player must be in IR, OUT, the taxi squad or a devy spot');
  end if;
  if b.spot <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'the second player must be on the active roster');
  end if;
  begin
    -- 1. the player in the spot steps out (his seat is the one the other leaves)
    update native_roster set spot = 'active' where league_id = p_league_id and roster_id = a.roster_id and slug = p_out_slug;
    -- 2. the active player takes the spot, under every rule a single move obeys
    r := set_roster_spot(p_league_id, p_in_slug, a.spot, a.roster_id);
    if not coalesce((r ->> 'ok')::boolean, false) then raise exception '%', r ->> 'error'; end if;
    -- 3. and the one coming out must be allowed on the active roster
    --    (a college player in a devy league, say) — asked the same way
    r := set_roster_spot(p_league_id, p_out_slug, 'active', a.roster_id);
    if not coalesce((r ->> 'ok')::boolean, false) then raise exception '%', r ->> 'error'; end if;
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'out', p_out_slug, 'in', p_in_slug, 'spot', a.spot);
end $$;
revoke all on function swap_roster_spot(uuid, text, text, int) from public, anon;
grant execute on function swap_roster_spot(uuid, text, text, int) to authenticated;

-- ── commish_move_player (0072) + the team giving him up ───────────────────
drop function if exists commish_move_player(uuid, text, int);
create or replace function commish_move_player(p_league_id uuid, p_slug text, p_to_roster int, p_from_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; fromr int := p_from_roster;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'no such roster');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug and nr.roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'already on that roster');
  end if;
  -- off wherever he is (rostered or free), onto the target, no waiver hold.
  -- 0500: with copies, off ONE team — the team named, or the only holder when
  -- every copy is taken; a free copy needs nobody to give him up.
  if fromr is null and not _copy_open(p_league_id, p_slug) then
    fromr := _copy_holder(p_league_id, p_slug, null, false);
    if fromr is null then
      return jsonb_build_object('ok', false, 'error', 'every copy is taken — say which team gives him up');
    end if;
  end if;
  if fromr is not null then
    delete from native_roster where league_id = p_league_id and roster_id = fromr and slug = p_slug;
    if not found then return jsonb_build_object('ok', false, 'error', 'that team doesn''t have him'); end if;
  end if;
  insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, p_to_roster, p_slug, 'commish');
  update league_pool set waived_until = null where league_id = p_league_id and slug = p_slug;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true,
    'roster_issue', roster_illegal_reason(p_league_id, p_to_roster));
end $$;
grant execute on function commish_move_player(uuid, text, int, int) to authenticated;

-- ── commish_remove_player (0072) + the team ───────────────────────────────
drop function if exists commish_remove_player(uuid, text, boolean);
create or replace function commish_remove_player(p_league_id uuid, p_slug text, p_waive boolean default true, p_roster_id int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; rid int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0500: one team's copy — the team named, or the only holder.
  rid := _copy_holder(p_league_id, p_slug, p_roster_id, false);
  if rid is null then
    return jsonb_build_object('ok', false, 'error', case
      when p_roster_id is null and exists (select 1 from native_roster where league_id = p_league_id and slug = p_slug)
        then 'more than one team holds him — say which team' else 'player not on a roster' end);
  end if;
  delete from native_roster where league_id = p_league_id and roster_id = rid and slug = p_slug;
  update league_pool set waived_until = case when p_waive then waiver_hold_until(p_league_id) end
    where league_id = p_league_id and slug = p_slug;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'waived', coalesce(p_waive, true));
end $$;
grant execute on function commish_remove_player(uuid, text, boolean, int) to authenticated;

-- ── enforce_stash_start (0356) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_stash_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sp text; lid uuid; m matchup%rowtype; rid int;
begin
  -- 0356: the commissioner's lineup fix, and nothing else, passes.
  if _commish_lineup_override() then return new; end if;
  if new.player_slug is null then return new; end if;
  -- 0500: the copy that counts is the one held by the team this lineup belongs to.
  select * into m from matchup where id = new.matchup_id;
  lid := m.league_id;
  select lm.sleeper_roster_id into rid from league_membership lm
   where lm.league_id = lid and lm.app_user_id = new.app_user_id
     and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id) limit 1;
  select nr.spot into sp from native_roster nr
   where nr.league_id = lid and nr.slug = new.player_slug
     and (case when rid is not null then nr.roster_id = rid else nr.roster_id in (m.home_roster_id, m.away_roster_id) end)
   order by (nr.spot in ('taxi', 'ir')) limit 1;
  if sp in ('taxi', 'ir') then
    raise exception '% is stashed on %', new.player_slug, upper(sp)
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

-- ── api_write (0352) ──────────────────────────────────────────────────────
create or replace function api_write(p_key text, p_action text, p_args jsonb default '{}'::jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k api_key%rowtype; lid uuid; a jsonb := coalesce(p_args, '{}'::jsonb);
  rid int; r jsonb; writes boolean := true; tid uuid; t trade_proposal%rowtype;
  cid uuid; owner_rid int; err text;
  commish_only constant text[] := array['process_waivers', 'rule_trade', 'move_player',
                                        'remove_player', 'set_waiver_priority'];
begin
  select * into k from api_key
   where secret_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  if not found or k.revoked_at is not null then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'invalid or revoked key');
  end if;
  lid := k.league_id;
  -- A path that names a league must name THIS key's league.
  if nullif(a ->> 'league_id', '') is not null and lower(a ->> 'league_id') <> lid::text then
    return jsonb_build_object('ok', false, 'status', 403, 'error', 'this key belongs to a different league');
  end if;
  if not league_write_api(lid) then
    return jsonb_build_object('ok', false, 'status', 403,
      'error', 'the commissioner has not turned on the write API for this league');
  end if;

  -- FROM HERE ON, THIS TRANSACTION IS THE KEY'S OWNER. No email in the
  -- claims, so is_admin() is false whoever minted the key.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', k.app_user_id, 'role', 'authenticated', 'api_key', k.id)::text, true);
  perform set_config('request.jwt.claim.sub', k.app_user_id::text, true);

  if not (_holds_a_seat(lid) or is_league_commish(lid)) then
    return jsonb_build_object('ok', false, 'status', 403, 'error', 'you are no longer in this league');
  end if;
  if k.scope = 'league' and not is_league_commish(lid) then
    return jsonb_build_object('ok', false, 'status', 403,
      'error', 'this is a league-scope key and you are no longer the commissioner');
  end if;
  if p_action = any(commish_only) and k.scope <> 'league' then
    return jsonb_build_object('ok', false, 'status', 403,
      'error', 'commissioner actions need a league-scope key');
  end if;
  update api_key set last_used_at = now() where id = k.id;

  begin
    -- Inside the block: a roster_id that is not a number is a 400, not a crash.
    rid := nullif(a ->> 'roster_id', '')::int;
    -- WHICH SEAT. A team-scope key acts for the seats its owner owns or
    -- co-manages — nothing else, commissioner or not. A league-scope key may
    -- name any seat, and the RPC behind the action still decides whether the
    -- commissioner may do that thing.
    if p_action in ('lineup', 'set_lineup', 'add', 'drop', 'claim', 'propose_trade') then
      if rid is null then
        r := jsonb_build_object('ok', false, 'status', 400, 'error', 'roster_id required');
      elsif not (owns_roster(lid, rid) or (k.scope = 'league' and is_league_commish(lid))) then
        r := jsonb_build_object('ok', false, 'status', 403, 'error', 'this key cannot act for roster ' || rid);
      end if;
    end if;

    if r is null then
      case p_action
      -- ── reads (not logged) ──────────────────────────────────────────────
      when 'me' then
        writes := false;
        r := jsonb_build_object('ok', true, 'league_id', lid,
          'key', jsonb_build_object('id', k.id, 'prefix', k.prefix, 'label', k.label, 'scope', k.scope),
          'is_commish', is_league_commish(lid),
          'rosters', coalesce((select jsonb_agg(x.rid order by x.rid) from (
              select m.sleeper_roster_id as rid from league_membership m
               where m.league_id = lid and m.app_user_id = auth.uid() and m.enrolled
              union
              select tm.roster_id from team_manager tm
               where tm.league_id = lid and tm.app_user_id = auth.uid()) x), '[]'::jsonb),
          'team', native_team_state(lid));
      when 'lineup' then
        writes := false;
        -- ANOTHER SEAT'S DRIP PICKS ARE NOBODY'S BUSINESS until they reveal —
        -- the commissioner's included (0178's fence). A league-scope key
        -- reads other lineups in a classic league only; the revealed ones of
        -- a drip league are the read API's /lineups, like everybody else's.
        if not owns_roster(lid, rid) and exists (select 1 from league l where l.id = lid
             and coalesce(l.settings_json ->> 'game_mode', 'drip') <> 'classic') then
          r := jsonb_build_object('ok', false, 'status', 403,
            'error', 'another team''s drip picks stay hidden until they reveal — see /lineups');
        else
        r := jsonb_build_object('ok', true, 'roster_id', rid, 'week', (a ->> 'week')::int,
          'picks', coalesce((
            select jsonb_agg(jsonb_build_object('game_window', s.game_window, 'roster_slot', s.roster_slot,
                     'player_slug', s.player_slug, 'metric_id', s.metric_id, 'locked', s.locked)
                     order by s.game_window, s.roster_slot)
              from sealed_pick s
              join matchup mu on mu.id = s.matchup_id
              join league_membership m on m.league_id = mu.league_id and m.sleeper_roster_id = rid and m.enrolled
             where mu.league_id = lid and mu.week = (a ->> 'week')::int
               and (mu.home_roster_id = rid or mu.away_roster_id = rid)
               and s.app_user_id = m.app_user_id), '[]'::jsonb));
        end if;

      -- ── a team ──────────────────────────────────────────────────────────
      when 'set_lineup' then
        r := _api_set_lineup(lid, rid, (a ->> 'week')::int, a -> 'picks', k.scope);
      when 'add' then
        r := add_free_agent(lid, rid, a ->> 'add', nullif(a ->> 'drop', ''));
      when 'drop' then
        r := drop_player(lid, rid, a ->> 'player');
      when 'claim' then
        r := submit_waiver_claim(lid, rid, a ->> 'add', nullif(a ->> 'drop', ''),
                                 coalesce(nullif(a ->> 'bid', '')::int, 0));
      when 'cancel_claim' then
        cid := nullif(a ->> 'claim_id', '')::uuid;
        select roster_id into owner_rid from waiver_claim where id = cid and league_id = lid;
        if owner_rid is null then
          r := jsonb_build_object('ok', false, 'status', 404, 'error', 'no such claim in this league');
        elsif not (owns_roster(lid, owner_rid) or (k.scope = 'league' and is_league_commish(lid))) then
          r := jsonb_build_object('ok', false, 'status', 403, 'error', 'not your claim');
        else
          rid := owner_rid;
          r := cancel_waiver_claim(cid);
        end if;
      when 'roster_spot' then
        owner_rid := _copy_holder(lid, a ->> 'player', null);   -- 0500: the key holder's own copy first
        if owner_rid is null then
          r := jsonb_build_object('ok', false, 'status', 404, 'error', 'that player is on no roster here');
        elsif not (owns_roster(lid, owner_rid) or (k.scope = 'league' and is_league_commish(lid))) then
          r := jsonb_build_object('ok', false, 'status', 403, 'error', 'not your player');
        else
          rid := owner_rid;
          r := set_roster_spot(lid, a ->> 'player', a ->> 'spot', owner_rid);
        end if;
      when 'propose_trade' then
        r := propose_trade(lid, rid, nullif(a ->> 'to_roster', '')::int,
               coalesce(a -> 'give', '[]'::jsonb), coalesce(a -> 'get', '[]'::jsonb), a ->> 'note',
               a -> 'give_picks', a -> 'get_picks', a -> 'retain',
               nullif(a ->> 'cap_dollars', '')::int, coalesce(nullif(a ->> 'faab_dollars', '')::int, 0),
               nullif(a ->> 'expires_hours', '')::int);
      when 'respond_trade', 'cancel_trade', 'rule_trade' then
        tid := nullif(a ->> 'trade_id', '')::uuid;
        select * into t from trade_proposal where id = tid and league_id = lid;
        if not found then
          r := jsonb_build_object('ok', false, 'status', 404, 'error', 'no such trade in this league');
        elsif p_action = 'respond_trade' then
          -- respond_trade asks owns_roster itself, on the right seat for a
          -- two-team deal and on the caller's own leg for a multi-team one;
          -- it has no commissioner bypass, so neither scope can answer for
          -- somebody else.
          rid := t.to_roster;
          r := respond_trade(tid, coalesce((a ->> 'accept')::boolean, false));
        elsif p_action = 'cancel_trade' then
          -- cancel_trade lets the COMMISSIONER withdraw anybody's offer, so a
          -- team-scope key has to be held to the proposer's own seat here.
          rid := t.from_roster;
          if not (owns_roster(lid, t.from_roster) or k.scope = 'league') then
            r := jsonb_build_object('ok', false, 'status', 403, 'error', 'only the proposer can withdraw this offer');
          else
            r := cancel_trade(tid);
          end if;
        else
          r := commish_rule_trade(tid, coalesce((a ->> 'approve')::boolean, false));
        end if;

      -- ── the commissioner (league scope, checked above) ───────────────────
      when 'process_waivers' then
        r := process_waivers(lid);
      when 'move_player' then
        r := commish_move_player(lid, a ->> 'player', nullif(a ->> 'to_roster', '')::int);
      when 'remove_player' then
        r := commish_remove_player(lid, a ->> 'player', coalesce((a ->> 'waive')::boolean, true));
      when 'set_waiver_priority' then
        r := commish_set_waiver_priority(lid, a -> 'order');
      else
        writes := false;
        r := jsonb_build_object('ok', false, 'status', 404, 'error', 'unknown action ' || coalesce(p_action, ''));
      end case;
    end if;
  exception when others then
    -- A trigger's refusal (the kickoff lock, an illegal roster) is an answer,
    -- not a crash. This block is a savepoint, so whatever the action half-did
    -- is undone before the log line below is written.
    -- Class 22 is bad data (a claim_id that is not a uuid, a week that is
    -- not a number): the caller's to fix, a 400. Anything else is the league
    -- refusing mid-write: a 409.
    err := sqlerrm;
    r := jsonb_build_object('ok', false, 'status', case when sqlstate like '22%' then 400 else 409 end, 'error', err);
  end;

  r := coalesce(r, jsonb_build_object('ok', false, 'error', 'no answer'));
  if writes then
    insert into api_write_log (league_id, key_id, app_user_id, action, roster_id, ok, error)
    values (lid, k.id, k.app_user_id, p_action, rid,
            coalesce((r ->> 'ok')::boolean, false), r ->> 'error');
  end if;
  -- Every refusal carries a status the edge function can send as-is. A plain
  -- {ok:false} from an RPC is the league saying no: 422.
  if not coalesce((r ->> 'ok')::boolean, false) and not (r ? 'status') then
    r := r || jsonb_build_object('status', 422);
  end if;
  return r;
end $$;
