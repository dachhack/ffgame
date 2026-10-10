-- 0460: WHO EACH TEAM MAY TAKE (v0.659.0).
--
-- Founder: "Let's add commish scoped rules to allow only certain players to be
-- selected in drafts and from waivers by certain managers. So like team 1 can
-- only select TEs. Team 2 can only select NFC players. Team 3 can only select
-- players from the bears." Then, choosing: positions, NFL teams (conference
-- and division as shortcuts) and experience; draft and waivers only — TRADES
-- STAY OPEN; and the commissioner may change a rule at any time.
--
-- A SEAT RULE is one row per seat that has one: any of
--   positions  — e.g. {TE}
--   teams      — NFL codes, e.g. the sixteen NFC teams, or {CHI}
--   min_exp / max_exp — years in the league (0 = rookies)
-- and a player must pass every part that is set ("Bears TEs").
--
-- WHERE IT BITES. pos_cap_error (0366) is already the one question every
-- acquisition asks about a player and a seat — the human draft pick, the
-- queue, an auction bid, nomination and proxies, a free-agent add, a waiver
-- claim when filed AND when the run processes it, a commissioner's pick edit
-- — and nothing on the trade or keeper path asks it. So the seat rule is
-- asked there first, and every one of those refuses an ineligible player with
-- the rule spelled out, while trades and keepers stay untouched, as asked.
--
-- THE AUTODRAFT. An automatic pick never asked pos_cap_error, so it gets its
-- own: autopick and the queue take the best ELIGIBLE player left. If none is
-- left (a Bears-only seat in round 16), the auto pick goes ahead anyway — a
-- draft that stalls for ever on one seat is worse than one off-rule pick, and
-- the house line says the rule ran dry.
--
-- RULES ARE PUBLIC to the league (every member can read every seat's rule —
-- the draft room shows them), and each change is said in league chat.
--
-- Team and experience rules are NFL facts: a college player (devy, 0365) is
-- held to the positions part only. A rule with a team or experience part
-- refuses a player whose team or tenure is unknown, the same way the
-- league-wide pool filter does (buildDraftPool's tenureOk).

create table if not exists seat_player_rule (
  league_id   uuid not null references league(id) on delete cascade,
  roster_id   int  not null,
  positions   text[],
  teams       text[],
  teams_label text,          -- how the commissioner picked them ("NFC", "NFC North"), for messages
  min_exp     int check (min_exp is null or min_exp between 0 and 30),
  max_exp     int check (max_exp is null or max_exp between 0 and 30),
  updated_by  uuid references app_user(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (league_id, roster_id)
);
alter table seat_player_rule enable row level security;   -- no policies: RPC-only

-- One spelling per team on both sides of every comparison: the feeds disagree
-- about the Rams (LA/LAR, #1095), Washington, Jacksonville and Las Vegas.
create or replace function _nfl_team_norm(p text) returns text
  language sql immutable as $$
  select case upper(btrim(coalesce(p, '')))
           when 'LAR' then 'LA' when 'WSH' then 'WAS' when 'JAC' then 'JAX' when 'LVR' then 'LV'
           else upper(btrim(coalesce(p, ''))) end
$$;

-- "TE · NFC · rookies" — the rule in a few words.
create or replace function _seat_rule_text(r seat_player_rule) returns text
  language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(' · ',
    case when coalesce(cardinality(r.positions), 0) > 0
         then (select string_agg(pos_label(p), '/' order by ord) from unnest(r.positions) with ordinality u(p, ord)) end,
    case when coalesce(cardinality(r.teams), 0) > 0
         then coalesce(nullif(btrim(r.teams_label), ''),
                case when cardinality(r.teams) <= 4 then array_to_string(r.teams, '/')
                     else cardinality(r.teams) || ' NFL teams' end) end,
    case when r.min_exp is not null and r.max_exp is not null and r.min_exp = 0 and r.max_exp = 0 then 'rookies'
         when r.min_exp is not null and r.max_exp is not null then r.min_exp || '–' || r.max_exp || ' yrs'
         when r.min_exp is not null then r.min_exp || '+ yrs'
         when r.max_exp is not null then 'up to ' || r.max_exp || ' yrs' end
  ), '')
$$;

-- Why this seat may not take this player, or null. Null too when the seat has
-- no rule, or the player isn't in the pool (that is the caller's own error).
create or replace function seat_rule_error(p_league_id uuid, p_roster_id int, p_slug text)
  returns text language plpgsql stable security definer set search_path = public as $$
declare r seat_player_rule; lp league_pool; ok boolean := true; nm text;
begin
  if p_roster_id is null or p_slug is null then return null; end if;
  select * into r from seat_player_rule where league_id = p_league_id and roster_id = p_roster_id;
  if not found then return null; end if;
  select * into lp from league_pool where league_id = p_league_id and slug = p_slug;
  if not found then return null; end if;
  if coalesce(cardinality(r.positions), 0) > 0 and not (upper(lp.pos) = any (r.positions)) then ok := false; end if;
  if ok and lp.level is distinct from 'college' then
    if coalesce(cardinality(r.teams), 0) > 0
       and not (_nfl_team_norm(lp.team) <> '' and _nfl_team_norm(lp.team) = any (select _nfl_team_norm(t) from unnest(r.teams) t)) then
      ok := false;
    end if;
    if r.min_exp is not null and (lp.exp is null or lp.exp < r.min_exp) then ok := false; end if;
    if r.max_exp is not null and (lp.exp is null or lp.exp > r.max_exp) then ok := false; end if;
  end if;
  if ok then return null; end if;
  select coalesce(nullif(team_name, ''), 'Team ' || p_roster_id) into nm
    from league_membership where league_id = p_league_id and sleeper_roster_id = p_roster_id limit 1;
  return coalesce(nm, 'Team ' || p_roster_id) || ' can only take ' || coalesce(_seat_rule_text(r), 'some players') || ' (commissioner''s rule)';
end $$;

-- Is there anyone left in the pool this seat may take at this level? The
-- autodraft's escape hatch asks this before refusing an automatic pick.
create or replace function _seat_rule_any_left(p_league_id uuid, p_roster_id int, p_level text)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from league_pool lp
     where lp.league_id = p_league_id
       and (p_level is null or lp.level = p_level)
       and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
       and coalesce(league_pos_cap(p_league_id, lp.pos), 1) > 0
       and seat_rule_error(p_league_id, p_roster_id, lp.slug) is null)
$$;

-- ── the rule rides the one question every acquisition asks ─────────────────
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_pos_cap_error_0460') then
    alter function pos_cap_error(uuid, int, text, boolean, text) rename to _pos_cap_error_0460;
  end if;
  if not exists (select 1 from pg_proc where proname = '_exec_pick_0460') then
    alter function native_exec_pick(uuid, text, boolean) rename to _exec_pick_0460;
  end if;
  if not exists (select 1 from pg_proc where proname = '_autopick_slug_0460') then
    alter function native_autopick_slug(uuid, int, int) rename to _autopick_slug_0460;
  end if;
  if not exists (select 1 from pg_proc where proname = '_queue_pick_0460') then
    alter function native_queue_pick(uuid, int) rename to _queue_pick_0460;
  end if;
end $$;

create or replace function pos_cap_error(
  p_league_id uuid, p_roster_id int, p_slug text,
  p_count_lots boolean default false, p_exclude_slug text default null
) returns text language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(seat_rule_error(p_league_id, p_roster_id, p_slug),
                  _pos_cap_error_0460(p_league_id, p_roster_id, p_slug, p_count_lots, p_exclude_slug));
end $$;

-- A pick: the seat on the clock must be allowed the player. A human pick is
-- refused outright (its devy-round picks never asked pos_cap_error, so this is
-- asked here for every pick); an automatic one only while someone eligible is
-- left — see THE AUTODRAFT above.
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; oc int; err text; r jsonb;
begin
  select * into d from draft where league_id = p_league_id;
  if found and d.status = 'live' then
    oc := draft_on_clock(d);
    err := seat_rule_error(p_league_id, oc, p_slug);
    if err is not null and (not coalesce(p_auto, false) or _seat_rule_any_left(p_league_id, oc, _draft_pick_level(p_league_id))) then
      return jsonb_build_object('ok', false, 'error', err);
    end if;
  end if;
  r := _exec_pick_0460(p_league_id, p_slug, p_auto);
  if err is not null and coalesce((r ->> 'ok')::boolean, false) then
    perform _chat_house(p_league_id,
      coalesce((select nullif(team_name, '') from league_membership where league_id = p_league_id and sleeper_roster_id = oc limit 1), 'Team ' || oc)
      || '''s rule ran dry — nobody it may take is left, so the autodraft took the best player available.',
      jsonb_build_object('kind', 'seat_rule', 'roster', oc, 'dry', true));
  end if;
  return r;
end $$;

-- The autodraft: the old choice when the seat may take him; otherwise the best
-- eligible player left at this pick's level; otherwise (rule ran dry) the old
-- choice, which native_exec_pick lets through.
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
     and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
     and coalesce(league_pos_cap(p_league_id, lp.pos), 1) > 0
     and seat_rule_error(p_league_id, p_roster_id, lp.slug) is null
   order by lp.rank, lp.slug limit 1;
  return coalesce(alt, pick);
end $$;

-- The queue: the first queued player the seat may take; none → the autodraft.
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
     and not exists (select 1 from native_roster nr where nr.league_id = q.league_id and nr.slug = q.slug)
     and pos_cap_error(p_league_id, p_roster_id, q.slug) is null
   order by q.pos limit 1;
  return pick;
end $$;

-- ── the commissioner's controls ────────────────────────────────────────────

-- Set (or, with null / {}, clear) one seat's rule. Commissioner or admin, at
-- any time; players already rostered are never touched. Said in league chat.
create or replace function set_seat_player_rule(p_league_id uuid, p_roster_id int, p_rule jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare pos text[]; tms text[]; lbl text; mn int; mx int; bad text; nm text; r seat_player_rule; line text;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'only the commissioner can set team rules');
  end if;
  if not exists (select 1 from league_membership where league_id = p_league_id and sleeper_roster_id = p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'no such team in this league');
  end if;
  select coalesce(nullif(team_name, ''), 'Team ' || p_roster_id) into nm
    from league_membership where league_id = p_league_id and sleeper_roster_id = p_roster_id limit 1;

  select array_agg(distinct upper(btrim(x))) filter (where btrim(x) <> '') into pos
    from jsonb_array_elements_text(coalesce(p_rule -> 'positions', '[]'::jsonb)) x;
  select array_agg(distinct upper(btrim(x))) filter (where btrim(x) <> '') into tms
    from jsonb_array_elements_text(coalesce(p_rule -> 'teams', '[]'::jsonb)) x;
  lbl := nullif(left(btrim(coalesce(p_rule ->> 'teams_label', '')), 40), '');
  mn := nullif(p_rule ->> 'min_exp', '')::int;
  mx := nullif(p_rule ->> 'max_exp', '')::int;

  select string_agg(p, ', ') into bad from unnest(pos) p
   where p not in ('QB','RB','WR','TE','K','DEF','DL','LB','DB','FB','P','HC');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'unknown position: ' || bad); end if;
  if cardinality(tms) > 32 then return jsonb_build_object('ok', false, 'error', 'at most 32 teams'); end if;
  select string_agg(t, ', ') into bad from unnest(tms) t where t !~ '^[A-Z]{2,4}$';
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'unknown team code: ' || bad); end if;
  if (mn is not null and (mn < 0 or mn > 30)) or (mx is not null and (mx < 0 or mx > 30)) then
    return jsonb_build_object('ok', false, 'error', 'experience is 0–30 years');
  end if;
  if mn is not null and mx is not null and mn > mx then
    return jsonb_build_object('ok', false, 'error', 'minimum experience is above the maximum');
  end if;
  if tms is null then lbl := null; end if;

  if pos is null and tms is null and mn is null and mx is null then
    if exists (select 1 from seat_player_rule where league_id = p_league_id and roster_id = p_roster_id) then
      delete from seat_player_rule where league_id = p_league_id and roster_id = p_roster_id;
      perform _chat_house(p_league_id, '⚖️ The commissioner lifted ' || nm || '''s rule — it can take any player again.',
        jsonb_build_object('kind', 'seat_rule', 'roster', p_roster_id, 'rule', null));
    end if;
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;

  insert into seat_player_rule (league_id, roster_id, positions, teams, teams_label, min_exp, max_exp, updated_by, updated_at)
  values (p_league_id, p_roster_id, pos, tms, lbl, mn, mx, auth.uid(), now())
  on conflict (league_id, roster_id) do update set
    positions = excluded.positions, teams = excluded.teams, teams_label = excluded.teams_label,
    min_exp = excluded.min_exp, max_exp = excluded.max_exp,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into r;
  line := '⚖️ Commissioner''s rule: ' || nm || ' can only draft and pick up ' || _seat_rule_text(r)
       || '. Players already on the roster stay; trades are open.';
  perform _chat_house(p_league_id, line,
    jsonb_build_object('kind', 'seat_rule', 'roster', p_roster_id, 'rule', _seat_rule_text(r)));
  return jsonb_build_object('ok', true, 'rule', _seat_rule_text(r));
end $$;

-- Every seat's rule, for the commissioner's editor and the draft room. Any
-- member reads them: a rule nobody can see is a refusal nobody expects.
create or replace function seat_player_rules(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'roster_id', r.roster_id,
           'team', (select coalesce(nullif(team_name, ''), 'Team ' || r.roster_id) from league_membership
                     where league_id = p_league_id and sleeper_roster_id = r.roster_id limit 1),
           'positions', to_jsonb(coalesce(r.positions, '{}')), 'teams', to_jsonb(coalesce(r.teams, '{}')),
           'teams_label', r.teams_label, 'min_exp', r.min_exp, 'max_exp', r.max_exp,
           'text', _seat_rule_text(r), 'updated_at', r.updated_at) order by r.roster_id), '[]'::jsonb)
    into out from seat_player_rule r where r.league_id = p_league_id;
  -- Every seat, ruled or not, so the editor needs no second read.
  return jsonb_build_object('ok', true, 'rules', out,
    'seats', (select coalesce(jsonb_agg(jsonb_build_object('roster_id', m.sleeper_roster_id,
                'team', coalesce(nullif(m.team_name, ''), 'Team ' || m.sleeper_roster_id)) order by m.sleeper_roster_id), '[]'::jsonb)
                from (select distinct on (sleeper_roster_id) sleeper_roster_id, team_name from league_membership
                       where league_id = p_league_id and sleeper_roster_id is not null
                       order by sleeper_roster_id, team_name nulls last) m),
    'mine', (select sleeper_roster_id from league_membership where league_id = p_league_id and app_user_id = auth.uid() limit 1));
end $$;

revoke all on function set_seat_player_rule(uuid, int, jsonb), seat_player_rules(uuid) from public, anon;
grant execute on function set_seat_player_rule(uuid, int, jsonb), seat_player_rules(uuid) to authenticated;
revoke all on function _seat_rule_any_left(uuid, int, text), _seat_rule_text(seat_player_rule) from public, anon, authenticated;

-- The pick machinery is the house's own: make_draft_pick, draft_tick,
-- commish_force_pick and _autodraft_through_pause (all security definer) are
-- the doors, and they keep working. Calling these directly as a signed-in
-- user — which nothing in any client does — used to work too, and could make
-- a pick for whoever was on the clock. Not any more.
revoke all on function native_exec_pick(uuid, text, boolean), _exec_pick_0460(uuid, text, boolean),
  native_autopick_slug(uuid, int, int), _autopick_slug_0460(uuid, int, int),
  native_queue_pick(uuid, int), _queue_pick_0460(uuid, int) from public, anon, authenticated;

-- A waiver claim the run settles as lost because of the seat rule says so.
-- process_waivers (0336) writes every pos_cap_error loss as "position limit";
-- with the rule now inside pos_cap_error, this names the real reason without
-- redefining the run.
create or replace function _waiver_note_seat_rule() returns trigger
  language plpgsql security definer set search_path = public as $$
declare e text;
begin
  if new.status = 'lost' and new.note = 'position limit' then
    e := seat_rule_error(new.league_id, new.roster_id, new.add_slug);
    if e is not null then new.note := e; end if;
  end if;
  return new;
end $$;
drop trigger if exists waiver_note_seat_rule on waiver_claim;
create trigger waiver_note_seat_rule before update of status on waiver_claim
  for each row execute function _waiver_note_seat_rule();
