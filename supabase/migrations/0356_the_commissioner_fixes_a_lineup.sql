-- ═══════════════════════════════════════════════════════════════════════════
-- 0356 · THE COMMISSIONER FIXES A LINEUP
--
-- Item 4 of the commissioner list (founder: "Change lineups (and IR/Taxi) for
-- previous weeks and restamp?"): the commissioner sets one seat's CLASSIC
-- lineup for a week whose players have already kicked off, for the manager
-- whose app died at 12:58, or the start the league agreed to honour.
--
-- ── THE LOCKS STAND FOR EVERYONE ELSE ──────────────────────────────────────
-- A classic lineup locks player by player at kickoff (0178), and the table's
-- triggers refuse a started player, an illegal roster (0072), a stashed
-- player (0164) and a flagged one (0144). This function steps past those four,
-- and only for its own writes: it sets a transaction-local switch
-- (`drip.commish_lineup`) that each of the four checks first, and nothing
-- else in the app can set it. PostgREST exposes only `public`'s functions, and
-- set_config is not one of them. The slot cap still applies.
--
-- ── WHO CAN BE STARTED ─────────────────────────────────────────────────────
-- A player the seat has now (any spot, since IR and taxi are exactly what a
-- fix like this corrects), a player already in its lineup that week, or one
-- who left the seat after the week's first kickoff. Anyone else was on
-- somebody else's team. Which SPOT a player fits is the console's job, with
-- core's slotAllows, the same rule every lineup screen uses. The table never
-- checked it for anyone.
--
-- ── WHAT THE LEAGUE SEES ───────────────────────────────────────────────────
-- A reason is required. The old and new lineups are written to
-- `lineup_edit_log`, and one chat line says who came in and who went out. A
-- week already stamped keeps its old finals until it is re-scored, and the
-- answer (`rescore`) says so. The console holds this box inside ⟳ RE-SCORE.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _commish_lineup_override() returns boolean
  language sql stable as $$
  select coalesce(current_setting('drip.commish_lineup', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION public.enforce_window_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k timestamptz; k_new timestamptz; k_old timestamptz; wkk timestamptz;
        wk int; lg uuid; rec sealed_pick;
begin
  -- 0356: the commissioner's lineup fix, and nothing else, passes.
  if _commish_lineup_override() then return coalesce(new, old); end if;
  if auth.uid() is null then return coalesce(new, old); end if;
  rec := coalesce(new, old);
  if tg_op = 'UPDATE'
     and new.player_slug  is not distinct from old.player_slug
     and new.metric_id    is not distinct from old.metric_id
     and new.game_window  is not distinct from old.game_window
     and new.roster_slot  is not distinct from old.roster_slot then
    return new;
  end if;
  select week, league_id into wk, lg from matchup where id = rec.matchup_id;
  if exists (select 1 from week_lock_hold where league_id = lg and week = wk) then return coalesce(new, old); end if;

  -- ── CLASSIC: per player, at his own kickoff, with no lead (0178) ──────────
  if rec.game_window = 'wk' then
    wkk := window_kickoff(wk, 'wk');
    k_new := case when tg_op = 'DELETE' then null else classic_pick_lock(new.matchup_id, new.player_slug, wkk) end;
    -- The OUTGOING player is checked too. Without this a manager could pull a
    -- running back at half time once he'd fumbled — the exact move late swap
    -- exists to forbid — and a DELETE would be a swap with the second half
    -- missing, dropping someone who has already played.
    k_old := case when tg_op in ('UPDATE', 'DELETE') then classic_pick_lock(old.matchup_id, old.player_slug, wkk) end;
    -- EITHER side having kicked off locks the write, so this is the EARLIER of
    -- the two, not the later. (A greatest() here reads plausibly and is wrong:
    -- swapping a kicked-off player for one who plays Sunday would take the
    -- Sunday kickoff and wave the whole thing through.)
    k := least(coalesce(k_new, 'infinity'::timestamptz), coalesce(k_old, 'infinity'::timestamptz));
    -- NO 1-hour lead here, deliberately: "nothing locks before kick off".
    if k <> 'infinity'::timestamptz and k <= now() then
      raise exception 'that player has already kicked off (%) — classic lineups lock player by player',
        k using errcode = 'check_violation';
    end if;
    return coalesce(new, old);
  end if;

  k := window_kickoff(wk, rec.game_window);
  if k is not null and k - interval '1 hour' <= now() then
    raise exception 'window % is locked — lineups lock 1h before its % kickoff', rec.game_window, k
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_legal_roster()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare lg uuid; rid int; reason text;
begin
  -- 0356: the commissioner's lineup fix, and nothing else, passes.
  if _commish_lineup_override() then return new; end if;
  if auth.uid() is null or is_admin() then return new; end if;
  select m.league_id into lg from matchup m where m.id = new.matchup_id;
  if lg is null or not is_native_league(lg) then return new; end if;
  select sleeper_roster_id into rid from league_membership
    where league_id = lg and app_user_id = new.app_user_id and enrolled
    order by sleeper_roster_id limit 1;
  if rid is null then return new; end if;
  reason := roster_illegal_reason(lg, rid);
  if reason is not null then
    raise exception 'Roster over its limits — %. Picks and power-ups are locked until it''s legal; drops always work (MY TEAM).', reason;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_stash_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sp text; lid uuid;
begin
  -- 0356: the commissioner's lineup fix, and nothing else, passes.
  if _commish_lineup_override() then return new; end if;
  if new.player_slug is null then return new; end if;
  select m.league_id into lid from matchup m where m.id = new.matchup_id;
  select nr.spot into sp from native_roster nr where nr.league_id = lid and nr.slug = new.player_slug;
  if sp in ('taxi', 'ir') then
    raise exception '% is stashed on %', new.player_slug, upper(sp)
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_flag_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare lg uuid; lbl text;
begin
  -- 0356: the commissioner's lineup fix, and nothing else, passes.
  if _commish_lineup_override() then return new; end if;
  if auth.uid() is null or is_admin() then return new; end if;   -- server + admin tools exempt
  if new.player_slug is null then return new; end if;
  select m.league_id into lg from matchup m where m.id = new.matchup_id;
  if lg is null then return new; end if;
  lbl := flag_rule_blocks(lg, new.player_slug, 'no_start');
  if lbl is not null then
    raise exception 'the commissioner has flagged % as not startable — %', new.player_slug, lbl;
  end if;
  return new;
end $function$;


create table if not exists lineup_edit_log (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references league(id) on delete cascade,
  week       int  not null,
  roster_id  int  not null,
  before     jsonb not null,
  after      jsonb not null,
  note       text not null,
  set_by     uuid,
  set_at     timestamptz not null default now()
);
create index if not exists lineup_edit_log_week on lineup_edit_log(league_id, week);
alter table lineup_edit_log enable row level security;
drop policy if exists lineup_edit_log_read on lineup_edit_log;
create policy lineup_edit_log_read on lineup_edit_log for select using (is_league_member(league_id));

-- The seat's lineup author: its manager, or the agent that holds an unclaimed
-- classic seat (0180). The resolver reads a seat's rows by exactly this uid.
create or replace function _seat_author(p_league_id uuid, p_roster_id int) returns uuid
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select app_user_id from league_membership where league_id = p_league_id and sleeper_roster_id = p_roster_id
        and app_user_id is not null order by enrolled desc limit 1),
    (select agent_user_id from seat_agent where league_id = p_league_id and roster_id = p_roster_id));
$$;
revoke all on function _seat_author(uuid, int) from public, anon, authenticated;

-- Who may start for this seat this week (see the header).
create or replace function _lineup_fix_candidates(p_league_id uuid, p_week int, p_roster_id int, p_mid uuid, p_author uuid)
  returns table (slug text, why text)
  language sql stable security definer set search_path = public as $$
  select distinct on (c.slug) c.slug, c.why from (
    select nr.slug, 'roster'::text as why, 1 as o from native_roster nr
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id
    union all
    select sp.player_slug, 'lineup', 2 from sealed_pick sp
     where sp.matchup_id = p_mid and sp.app_user_id = p_author and sp.game_window = 'wk' and sp.player_slug is not null
    union all
    select t.slug, 'left', 3 from league_txn t
     where t.league_id = p_league_id and t.slug is not null
       and (t.from_roster = p_roster_id or (t.roster_id = p_roster_id and t.kind = 'drop'))
       and t.at >= coalesce(window_kickoff(p_week, 'wk'), 'infinity'::timestamptz)
  ) c
  where exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = c.slug)
  order by c.slug, c.o;
$$;
revoke all on function _lineup_fix_candidates(uuid, int, int, uuid, uuid) from public, anon, authenticated;

-- The console's read: with no seat, the week's seats; with one, its stored
-- lineup and who may start.
create or replace function commish_week_lineup(p_league_id uuid, p_week int, p_roster_id int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare mid uuid; author uuid;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if (select coalesce(settings_json ->> 'game_mode', 'drip') from league where id = p_league_id) <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'lineup fixes are for classic leagues — a drip week was played live and can''t be rebuilt');
  end if;
  if p_roster_id is null then
    return jsonb_build_object('ok', true, 'teams', coalesce((
      select jsonb_agg(jsonb_build_object('roster_id', r, 'name', _txn_team(p_league_id, r)) order by r)
        from (select home_roster_id r from matchup where league_id = p_league_id and week = p_week
              union select away_roster_id from matchup where league_id = p_league_id and week = p_week) s
       where r is not null), '[]'::jsonb));
  end if;
  select id into mid from matchup where league_id = p_league_id and week = p_week
     and (home_roster_id = p_roster_id or away_roster_id = p_roster_id) order by created_at limit 1;
  if mid is null then return jsonb_build_object('ok', false, 'error', 'that team has no matchup in week ' || p_week); end if;
  author := _seat_author(p_league_id, p_roster_id);
  return jsonb_build_object('ok', true, 'team', _txn_team(p_league_id, p_roster_id), 'has_author', author is not null,
    'stored', coalesce((
      select jsonb_agg(jsonb_build_object('slot', sp.roster_slot, 'slug', sp.player_slug) order by sp.roster_slot)
        from sealed_pick sp where sp.matchup_id = mid and sp.app_user_id = author and sp.game_window = 'wk'), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('slug', c.slug, 'why', c.why, 'name', lp.full_name, 'pos', lp.pos,
               'team', lp.team, 'exp', lp.exp, 'spot', nr.spot) order by lp.pos, lp.rank)
        from _lineup_fix_candidates(p_league_id, p_week, p_roster_id, mid, author) c
        join league_pool lp on lp.league_id = p_league_id and lp.slug = c.slug
        left join native_roster nr on nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.slug = c.slug),
      '[]'::jsonb));
end $$;
grant execute on function commish_week_lineup(uuid, int, int) to authenticated;

-- p_picks: [{slot, slug|null}], the WHOLE lineup. A spot left out is emptied.
create or replace function commish_set_week_lineup(p_league_id uuid, p_week int, p_roster_id int, p_picks jsonb, p_note text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare mid uuid; author uuid; why text := nullif(btrim(coalesce(p_note, '')), ''); p jsonb;
        before jsonb; after jsonb; ins text[]; outs text[]; locked_now boolean; stamped boolean; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if (select coalesce(settings_json ->> 'game_mode', 'drip') from league where id = p_league_id) <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'lineup fixes are for classic leagues — a drip week was played live and can''t be rebuilt');
  end if;
  if why is null then return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason'); end if;
  if jsonb_typeof(p_picks) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'picks must be a list of {slot, slug}');
  end if;
  select id into mid from matchup where league_id = p_league_id and week = p_week
     and (home_roster_id = p_roster_id or away_roster_id = p_roster_id) order by created_at limit 1;
  if mid is null then return jsonb_build_object('ok', false, 'error', 'that team has no matchup in week ' || coalesce(p_week::text, '?')); end if;
  author := _seat_author(p_league_id, p_roster_id);
  if author is null then
    return jsonb_build_object('ok', false, 'error', 'that seat has nobody to field a lineup for — its lineup is computed from its roster');
  end if;
  for p in select * from jsonb_array_elements(p_picks) loop
    if coalesce(p ->> 'slot', '') !~ '^[A-Za-z0-9_/]{1,16}$' then
      return jsonb_build_object('ok', false, 'error', 'every pick needs a spot');
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_picks) x) <> (select count(distinct x ->> 'slot') from jsonb_array_elements(p_picks) x) then
    return jsonb_build_object('ok', false, 'error', 'a spot is named twice');
  end if;
  if exists (select x ->> 'slug' from jsonb_array_elements(p_picks) x where nullif(x ->> 'slug', '') is not null
              group by 1 having count(*) > 1) then
    return jsonb_build_object('ok', false, 'error', 'a player can start in one spot only');
  end if;
  select string_agg(x ->> 'slug', ', ') into line from jsonb_array_elements(p_picks) x
   where nullif(x ->> 'slug', '') is not null
     and not exists (select 1 from _lineup_fix_candidates(p_league_id, p_week, p_roster_id, mid, author) c where c.slug = x ->> 'slug');
  if line is not null then
    return jsonb_build_object('ok', false, 'error', 'not this team''s to start that week: ' || line);
  end if;

  perform pg_advisory_xact_lock(hashtext('lineupfix:' || mid::text || ':' || author::text));
  select coalesce(jsonb_agg(jsonb_build_object('slot', roster_slot, 'slug', player_slug) order by roster_slot), '[]'::jsonb)
    into before from sealed_pick where matchup_id = mid and app_user_id = author and game_window = 'wk';
  -- Locked as the rest of the week is: a row written after the week's first
  -- kickoff is sealed and revealed at once, which is what the resolver scores.
  locked_now := coalesce(window_kickoff(p_week, 'wk') <= now(), false);

  perform set_config('drip.commish_lineup', 'on', true);
  delete from sealed_pick s where s.matchup_id = mid and s.app_user_id = author and s.game_window = 'wk'
     and not exists (select 1 from jsonb_array_elements(p_picks) x where x ->> 'slot' = s.roster_slot);
  for p in select * from jsonb_array_elements(p_picks) loop
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, locked, revealed_at)
    values (mid, author, 'wk', p ->> 'slot', nullif(p ->> 'slug', ''), locked_now, case when locked_now then now() end)
    on conflict (matchup_id, app_user_id, game_window, roster_slot) do update
      set player_slug = excluded.player_slug,
          locked = sealed_pick.locked or excluded.locked,
          revealed_at = coalesce(sealed_pick.revealed_at, excluded.revealed_at);
  end loop;
  perform set_config('drip.commish_lineup', '', true);

  select coalesce(jsonb_agg(jsonb_build_object('slot', roster_slot, 'slug', player_slug) order by roster_slot), '[]'::jsonb)
    into after from sealed_pick where matchup_id = mid and app_user_id = author and game_window = 'wk';
  insert into lineup_edit_log (league_id, week, roster_id, before, after, note, set_by)
  values (p_league_id, p_week, p_roster_id, before, after, left(why, 200), auth.uid());

  select array_agg(_txn_player(p_league_id, s) order by s) into ins from (
    select x ->> 'slug' s from jsonb_array_elements(after) x where x ->> 'slug' is not null
    except select x ->> 'slug' from jsonb_array_elements(before) x where x ->> 'slug' is not null) a;
  select array_agg(_txn_player(p_league_id, s) order by s) into outs from (
    select x ->> 'slug' s from jsonb_array_elements(before) x where x ->> 'slug' is not null
    except select x ->> 'slug' from jsonb_array_elements(after) x where x ->> 'slug' is not null) a;
  select exists (select 1 from matchup where id = mid and home_final is not null and away_final is not null) into stamped;
  if ins is not null or outs is not null then
    perform _chat_house(p_league_id,
      '🧾 The commissioner changed ' || _txn_team(p_league_id, p_roster_id) || '''s week ' || p_week || ' lineup: '
      || concat_ws('; ', 'in ' || array_to_string(ins, ', '), 'out ' || array_to_string(outs, ', '))
      || ' — ' || left(why, 200),
      jsonb_build_object('kind', 'lineup_fix', 'week', p_week, 'roster_id', p_roster_id));
  end if;
  return jsonb_build_object('ok', true, 'in', coalesce(to_jsonb(ins), '[]'::jsonb), 'out', coalesce(to_jsonb(outs), '[]'::jsonb),
    'rescore', stamped);
end $$;
grant execute on function commish_set_week_lineup(uuid, int, int, jsonb, text) to authenticated;
