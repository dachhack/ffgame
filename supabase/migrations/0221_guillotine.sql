-- 0221 — 🔪 GUILLOTINE LEAGUES + the register grows a memory for events.
--
-- THE FORMAT. No head-to-head stakes: each week the lowest-scoring SURVIVING
-- team is eliminated and its entire roster is released to waivers (the
-- frenzy); the last team standing wins. The schedule still exists — matchup
-- rows are how the platform scores a week — but W-L is decoration; the only
-- standing that matters is "alive, and how far from the floor".
--
-- THE BLADE FALLS ITSELF. guillotine_tick is idempotent and safe to poke from
-- any member's league load (the autoGeneratePlayoffs pattern): for every
-- completed week that hasn't had its elimination yet, it finds the lowest
-- total among the teams still alive AT THAT POINT (season PF, then seat
-- number, breaks a tie at the floor — the weaker season dies), marks the seat
-- eliminated, cancels its pending waiver claims, releases every player to
-- waivers on the league's own clearing clock, and writes the whole event to
-- the register. When one team remains, guillotine_state names the champion.
--
-- THE REGISTER GROWS UP (the founder: "capture major automated league
-- movements, waiver actions, and commish actions in the league register").
-- league_txn gains a `note`, and the trigger learns two things: a GUC
-- (app.txn_kind / app.txn_note) that engines set so their roster writes log
-- as the EVENT they belong to ('release' with "guillotine week N", not a
-- pile of anonymous drops), and the 'steal' kind (0222's vampire moves are
-- roster_id updates that would otherwise print as trades). Event kinds that
-- are not roster movement at all — 'elimination', 'tag', 'extension', 'rfa',
-- 'retained', 'cap' — are inserted directly by their engines.
--
-- SEAT LAW, AS A TRIGGER. One BEFORE guard on native_roster enforces both
-- formats' restrictions at the only door that matters: an eliminated seat
-- never gains a player (any path — FA, waiver, trade, commish), and 0222's
-- vampire never signs from the street or the wire (it feeds on wins). RPC
-- bodies stay untouched — no lineage risk, and paths added later inherit the
-- law for free.

-- ── The format axis ──────────────────────────────────────────────────────────
create or replace function league_format(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when settings_json ->> 'format' in ('guillotine', 'vampire')
              then settings_json ->> 'format' else 'standard' end
  from league where id = p_league_id;
$$;

-- Commissioner (pre-draft for guillotine — the format decides how a season
-- SCORES, and half a season can't switch): standard | guillotine | vampire.
-- Guillotine presets the market it lives on: FAAB waivers, $1000 budget.
create or replace function set_league_format(p_league_id uuid, p_format text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; f text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  f := lower(btrim(coalesce(p_format, 'standard')));
  if f not in ('standard', 'guillotine', 'vampire') then
    return jsonb_build_object('ok', false, 'error', 'format must be standard, guillotine or vampire');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if f = 'guillotine' and d.status <> 'pending'
     and league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', false, 'error', 'guillotine must be chosen before the draft — it changes how the season scores');
  end if;
  if exists (select 1 from league_membership where league_id = p_league_id and eliminated_week is not null) then
    return jsonb_build_object('ok', false, 'error', 'the blade has already fallen — the format is locked for the season');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('format', f)
      || case when f = 'guillotine'
           then jsonb_build_object('waiver_mode', 'faab',
                  'faab_budget', coalesce(nullif(settings_json ->> 'faab_budget', '')::int, 1000))
           else '{}'::jsonb end
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'format', f);
end $$;
grant execute on function set_league_format(uuid, text) to authenticated;

-- ── Elimination state ────────────────────────────────────────────────────────
alter table league_membership add column if not exists eliminated_week int;

-- ── The register's new memory ────────────────────────────────────────────────
alter table league_txn add column if not exists note text;

-- Trigger v2 (0186 body + the GUC context + 'steal'). Engines that release or
-- move players as part of a larger EVENT set app.txn_kind/app.txn_note
-- (transaction-local) so their legs log as that event.
create or replace function log_native_roster_txn() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lg uuid; rid int; sl text; knd text; frm int; st text; ctx text; nt text;
begin
  if tg_op = 'DELETE' then lg := old.league_id; rid := old.roster_id; sl := old.slug;
  else lg := new.league_id; rid := new.roster_id; sl := new.slug; end if;

  select status into st from draft where league_id = lg;
  if st is distinct from 'complete' then return null; end if;

  ctx := nullif(current_setting('app.txn_kind', true), '');
  nt  := nullif(current_setting('app.txn_note', true), '');

  if tg_op = 'INSERT' then
    knd := case when new.acquired in ('waiver', 'trade', 'commish') then new.acquired else 'add' end;
  elsif tg_op = 'UPDATE' then
    if new.roster_id is not distinct from old.roster_id then return null; end if;
    knd := case when new.acquired = 'commish' then 'commish'
                when new.acquired = 'steal' then 'steal' else 'trade' end;
    frm := old.roster_id;
  else
    knd := 'drop';
  end if;
  -- an engine's context wins over the mechanical reading
  if ctx is not null then knd := ctx; end if;

  insert into league_txn (league_id, kind, roster_id, slug, from_roster, actor, note)
  values (lg, knd, rid, sl, frm, auth.uid(), nt);
  return null;
end $$;

-- league_register v2 (0186 body + note in the payload)
create or replace function league_register(p_league_id uuid, p_limit int default 100)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out_rows jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(r order by r.at desc, r.id desc), '[]'::jsonb) into out_rows
  from (
    select t.id, t.at, t.kind, t.slug, t.roster_id, t.from_roster, t.note,
           m.team_name  as team,
           fm.team_name as from_team,
           case when t.kind = 'waiver' then (
             select w.bid from waiver_claim w
              where w.league_id = t.league_id and w.roster_id = t.roster_id
                and w.add_slug = t.slug and w.status = 'won'
              order by w.processed_at desc nulls last limit 1
           ) end as bid
      from league_txn t
      left join league_membership m
        on m.league_id = t.league_id and m.sleeper_roster_id = t.roster_id
      left join league_membership fm
        on fm.league_id = t.league_id and fm.sleeper_roster_id = t.from_roster
     where t.league_id = p_league_id
       and not (t.kind = 'drop' and exists (
             select 1 from league_txn t2
              where t2.league_id = t.league_id and t2.slug = t.slug
                and t2.at = t.at and t2.kind <> 'drop'))
     order by t.at desc, t.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) r;
  return jsonb_build_object('ok', true, 'rows', out_rows);
end $$;

-- ── Seat law: the format guard ───────────────────────────────────────────────
create or replace function _format_seat_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare f text; vr int;
begin
  f := league_format(new.league_id);
  if f = 'standard' then return new; end if;
  if f = 'guillotine' then
    -- a dead seat never gains a player, by any path
    if exists (select 1 from league_membership
               where league_id = new.league_id and sleeper_roster_id = new.roster_id
                 and eliminated_week is not null) then
      raise exception 'this team fell to the guillotine — its season is over';
    end if;
  elsif f = 'vampire' and tg_op = 'INSERT' and new.acquired in ('fa', 'waiver') then
    vr := nullif((select settings_json ->> 'vampire_roster' from league where id = new.league_id), '')::int;
    if vr is not null and new.roster_id = vr then
      raise exception 'the vampire feeds on wins, not waivers — beat a team and steal a starter';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists format_seat_guard on native_roster;
create trigger format_seat_guard
  before insert or update of roster_id on native_roster
  for each row execute function _format_seat_guard();

-- ── The blade ────────────────────────────────────────────────────────────────
create or replace function guillotine_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; last_done int; victim int; vt numeric; alive int; done int := 0;
        sl record; nt text;
begin
  if league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', true, 'eliminated', 0);
  end if;
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':guillotine'));

  -- the last fully-final week of the regular season
  select max(week) into last_done from matchup m
  where m.league_id = p_league_id
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if last_done is null then return jsonb_build_object('ok', true, 'eliminated', 0); end if;

  for wk in 1..last_done loop
    select count(*) into alive from league_membership
      where league_id = p_league_id and eliminated_week is null;
    exit when alive <= 1;
    continue when exists (select 1 from league_membership
      where league_id = p_league_id and eliminated_week = wk);

    -- the floor: lowest weekly total among teams alive right now; a tie dies
    -- by the weaker season (PF), then the higher seat number
    select t.rid, t.pts into victim, vt from (
      select m.sleeper_roster_id as rid,
             coalesce((select case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end
               from matchup mu where mu.league_id = p_league_id and mu.week = wk
                 and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
               limit 1), 0) as pts,
             (select coalesce(sum(case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end), 0)
               from matchup mu where mu.league_id = p_league_id and mu.week <= wk and mu.status = 'final'
                 and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)) as season_pf
      from league_membership m
      where m.league_id = p_league_id and m.eliminated_week is null
    ) t order by t.pts asc, t.season_pf asc, t.rid desc limit 1;
    exit when victim is null;

    update league_membership set eliminated_week = wk
      where league_id = p_league_id and sleeper_roster_id = victim;
    -- a dead seat's pending claims die with it (a win after death would trip
    -- the seat guard mid-waiver-run)
    update waiver_claim set status = 'lost', note = 'team eliminated'
      where league_id = p_league_id and roster_id = victim and status = 'pending';

    -- the event itself, then the releases logged AS releases
    insert into league_txn (league_id, kind, roster_id, slug, note)
    values (p_league_id, 'elimination', victim, '', 'week ' || wk || ' — lowest score, ' || round(vt, 1));
    nt := 'guillotine week ' || wk;
    perform set_config('app.txn_kind', 'release', true);
    perform set_config('app.txn_note', nt, true);
    for sl in select slug from native_roster where league_id = p_league_id and roster_id = victim loop
      update league_pool set waived_until = waiver_hold_until(p_league_id)
        where league_id = p_league_id and slug = sl.slug;
      delete from native_roster where league_id = p_league_id and slug = sl.slug;
    end loop;
    perform set_config('app.txn_kind', '', true);
    perform set_config('app.txn_note', '', true);
    done := done + 1;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'eliminated', done);
end $$;
grant execute on function guillotine_tick(uuid) to authenticated;

-- ── The cutline, for the UI ──────────────────────────────────────────────────
create or replace function guillotine_state(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare cur_wk int; champ int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('guillotine', false);
  end if;
  -- the week in progress: first week not yet fully final
  select min(week) into cur_wk from matchup m
  where m.league_id = p_league_id
    and exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if (select count(*) from league_membership
      where league_id = p_league_id and eliminated_week is null) = 1 then
    select sleeper_roster_id into champ from league_membership
      where league_id = p_league_id and eliminated_week is null;
  end if;
  return jsonb_build_object(
    'guillotine', true,
    'week', cur_wk,
    'champion', champ,
    'alive', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', a.rid, 'team', a.team, 'pts', a.pts) order by a.pts asc, a.rid)
      from (
        select m.sleeper_roster_id as rid, m.team_name as team,
               coalesce((select case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end
                 from matchup mu where mu.league_id = p_league_id and mu.week = cur_wk
                   and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id) limit 1), 0) as pts
        from league_membership m
        where m.league_id = p_league_id and m.eliminated_week is null
      ) a), '[]'::jsonb),
    'fallen', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'week', m.eliminated_week)
        order by m.eliminated_week)
      from league_membership m
      where m.league_id = p_league_id and m.eliminated_week is not null), '[]'::jsonb),
    'frenzy', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', lp.slug, 'full_name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
        'rank', lp.rank, 'clears_at', lp.waived_until) order by lp.rank)
      from league_pool lp
      where lp.league_id = p_league_id and lp.waived_until > now()
        and not exists (select 1 from native_roster nr
          where nr.league_id = p_league_id and nr.slug = lp.slug)), '[]'::jsonb));
end $$;
grant execute on function guillotine_state(uuid) to authenticated;
