-- 0071: ROSTER RULES (per-position limits, commish-editable) + LEAGUE CRESTS
-- (random default at creation, platform avatar on import).
--
-- ROSTER RULES. Drip has no positional starting lineup — the weekly board
-- fields 8 time-window slots and any position can fill any slot — so the
-- roster levers that are REAL are: total roster size (draft.rounds, already
-- configurable) and per-position roster limits. Until now the limits
-- (QB≤3, TE≤3, K≤1, DEF≤1) were hard-coded and bound ONLY the AI: a human
-- could draft 12 kickers. This migration makes them configuration:
--   • league.settings_json->'pos_caps' = {"QB":3,"TE":3,"K":1,"DEF":1,…} —
--     missing/null value = uncapped; absent blob = the legacy defaults, so
--     existing leagues behave exactly as before;
--   • humans are now enforced everywhere they acquire a player: snake picks,
--     auction nominations/bids/hidden maxes, free agency, waiver claims (at
--     submit AND at resolution);
--   • the AI (autopick + auction willingness) reads the same config;
--   • set_roster_rules lets the commissioner edit caps any time and roster
--     size while the draft is still pending;
--   • K/D-ST remain REQUIRED (endgame force-fill) whenever their cap ≥ 1;
--     a cap of 0 bans the position outright (and drops the requirement).
-- Lowering a cap below a roster's current count is allowed and grandfathers
-- the existing roster — it only blocks NEW acquisitions at that position.
--
-- LEAGUE CRESTS. league.avatar_url existed (0066) but nothing set a default:
--   • random_drip_avatar() picks from the 72 first-party tiles;
--   • create_native_league (and therefore mocks) stamps one at creation;
--   • admin_upsert_league gains p_avatar: imports store the platform's crest
--     (Sleeper CDN URL) when it exists, else a random tile — but ONLY when
--     the league has no crest yet, so a commissioner's choice (or a previous
--     import's) is never clobbered by a re-sync;
--   • existing native leagues with no crest are backfilled.

-- ─────────────────────────────────────────────────────────────────────────────
-- Random first-party crest (the 72 public/avatars tiles; list mirrors
-- src/data/dripAvatars.ts — regenerate together).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function random_drip_avatar() returns text
  language sql volatile as $$
  select 'https://dripfantasy.com/avatars/' || (array[
    'hero-chronos.webp','hero-cyber-gauntlet.webp','hero-eclipse.webp','hero-ghost-morer.webp',
    'hero-ghost-walker.webp','hero-hope.webp','hero-infinity-gard.webp','hero-iron-claw.webp',
    'hero-kinetic.webp','hero-neon-blitz.webp','hero-nexus.webp','hero-nova.webp',
    'hero-phase.webp','hero-plasma.webp','hero-pulse.webp','hero-puofib.webp',
    'hero-quantum-leap.webp','hero-rift.webp','hero-steelheart.webp','hero-storm-strike.webp',
    'hero-titan-x.webp','hero-vector-prime.webp','hero-void.webp','hero-volta.webp',
    'action-chronos-grip.webp','action-cyber-gauntlet.webp','action-eclipse-defense.webp','action-ghost-morer.webp',
    'action-ghost-walker.webp','action-iron-claw-2.webp','action-iron-claw.webp','action-kinetic-strike.webp',
    'action-neon-blitz-pool.webp','action-nexus-runner.webp','action-nova-profile-2.webp','action-nova-profile.webp',
    'action-phase-shift-2.webp','action-phase-shift.webp','action-plasma-mechanic.webp','action-pulse-power.webp',
    'action-puofid-jump.webp','action-rift-triumph.webp','action-steelheart-armor.webp','action-storm-strike.webp',
    'action-titan-x-visage.webp','action-vector-prime.webp','action-void-data.webp','action-volta-impact.webp',
    'gear-battle-worn-helm.webp','gear-command-helm.webp','gear-cyber-hash-hub.webp','gear-draft-field-detail.webp',
    'gear-drip-classic-helm.webp','gear-drip-fantasy-collectible.webp','gear-drip-field-hub.webp','gear-drip-mini-ball.webp',
    'gear-drip-quantum-ball.webp','gear-elite-visor-helm.webp','gear-end-zone-complex.webp','gear-field-master-view.webp',
    'gear-game-ball-prime.webp','gear-hydro-drip-ball.webp','gear-midfield-nexus.webp','gear-practice-field-zone.webp',
    'gear-quantum-helm.webp','gear-sideline-zone.webp','gear-special-event-ball.webp','gear-special-ops-helm.webp',
    'gear-team-alpha-helm.webp','gear-training-ball.webp','gear-vintage-cyber-ball.webp','gear-vintage-cyber-helm.webp'
  ])[floor(random() * 72)::int + 1];
$$;
grant execute on function random_drip_avatar() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Position-cap primitives
-- ─────────────────────────────────────────────────────────────────────────────

-- The effective cap for one position (null = uncapped). A league with no
-- pos_caps blob gets the legacy defaults; a league WITH the blob is read
-- verbatim (missing key = uncapped).
create or replace function league_pos_cap(p_league_id uuid, p_pos text) returns int
  language sql stable security definer set search_path = public as $$
  select case
    when s.caps is null then
      case p_pos when 'QB' then 3 when 'TE' then 3 when 'K' then 1 when 'DEF' then 1 else null end
    when jsonb_typeof(s.caps -> p_pos) = 'number' then (s.caps ->> p_pos)::int
    else null
  end
  from (select settings_json -> 'pos_caps' as caps from league where id = p_league_id) s;
$$;

-- All six effective caps as one object (null values = uncapped) — the shape
-- surfaced to the client via draft_state / native_team_state / roster_rules.
create or replace function league_pos_caps(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'QB', league_pos_cap(p_league_id, 'QB'), 'RB', league_pos_cap(p_league_id, 'RB'),
    'WR', league_pos_cap(p_league_id, 'WR'), 'TE', league_pos_cap(p_league_id, 'TE'),
    'K',  league_pos_cap(p_league_id, 'K'),  'DEF', league_pos_cap(p_league_id, 'DEF'));
$$;

create or replace function pos_label(p_pos text) returns text
  language sql immutable as $$ select case p_pos when 'DEF' then 'D/ST' else p_pos end; $$;

-- Would acquiring p_slug bust p_roster_id's position cap? Returns the error
-- text, or null when legal. p_count_lots also counts auction lots the seat
-- currently holds (it may win them all); p_exclude_slug discounts a player
-- being dropped in the same move.
create or replace function pos_cap_error(
  p_league_id uuid, p_roster_id int, p_slug text,
  p_count_lots boolean default false, p_exclude_slug text default null
) returns text language plpgsql stable security definer set search_path = public as $$
declare ppos text; cap int; n int;
begin
  select lp.pos into ppos from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug;
  if ppos is null then return null; end if;   -- "not in pool" is the caller's error
  cap := league_pos_cap(p_league_id, ppos);
  if cap is null then return null; end if;
  select count(*) into n
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id and lp.pos = ppos
    and (p_exclude_slug is null or nr.slug <> p_exclude_slug);
  if p_count_lots then
    n := n + (select count(*) from auction_lot al
              join league_pool lp on lp.league_id = al.league_id and lp.slug = al.slug
              where al.league_id = p_league_id and al.roster_id = p_roster_id
                and lp.pos = ppos and al.slug <> p_slug);
  end if;
  if n + 1 > cap then
    return case when cap = 0 then 'this league does not roster ' || pos_label(ppos)
                else 'position limit — this league rosters at most ' || cap || ' ' || pos_label(ppos) end;
  end if;
  return null;
end $$;

-- Caps must leave the roster fillable: with null = "as big as the roster",
-- the six caps together must cover p_rounds spots.
create or replace function validate_pos_caps(p_caps jsonb, p_rounds int) returns text
  language plpgsql immutable as $$
declare k text; v jsonb; total int := 0;
begin
  if p_caps is null then return null; end if;
  if jsonb_typeof(p_caps) <> 'object' then return 'position limits must be an object'; end if;
  for k, v in select * from jsonb_each(p_caps) loop
    if k not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF') then
      return 'unknown position ' || k;
    end if;
    if jsonb_typeof(v) not in ('number', 'null') then
      return 'limit for ' || k || ' must be a number or null';
    end if;
    if jsonb_typeof(v) = 'number' and ((v::text)::numeric <> floor((v::text)::numeric)
        or (v::text)::int < 0 or (v::text)::int > 30) then
      return 'limit for ' || k || ' must be 0–30';
    end if;
  end loop;
  select sum(case when jsonb_typeof(p_caps -> p) = 'number' then least((p_caps ->> p)::int, p_rounds) else p_rounds end)
    into total
  from unnest(array['QB','RB','WR','TE','K','DEF']) as p;
  if total < p_rounds then
    return 'limits too tight — they leave roster spots impossible to fill';
  end if;
  return null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Commissioner editor: caps any time; roster size only while the draft is
-- still pending (it IS the draft length).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_roster_rules(p_league_id uuid, p_rounds int default null, p_pos_caps jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; err text; eff_rounds int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  eff_rounds := coalesce(p_rounds, d.rounds);

  if p_rounds is not null and p_rounds <> d.rounds then
    if d.status <> 'pending' then
      return jsonb_build_object('ok', false, 'error', 'roster size is locked once the draft starts');
    end if;
    if p_rounds < 5 or p_rounds > 25 then
      return jsonb_build_object('ok', false, 'error', 'roster size must be 5–25');
    end if;
    if d.mode = 'auction' and d.budget < p_rounds then
      return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
    end if;
    update draft set rounds = p_rounds where league_id = p_league_id;
    update league set settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{rounds}', to_jsonb(p_rounds))
      where id = p_league_id;
  end if;

  if p_pos_caps is not null then
    err := validate_pos_caps(p_pos_caps, eff_rounds);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
    update league set settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{pos_caps}', p_pos_caps)
      where id = p_league_id;
  end if;

  return jsonb_build_object('ok', true, 'rounds', eff_rounds, 'pos_caps', league_pos_caps(p_league_id));
end $$;

-- The current rules, for the commish editor + any curious member.
create or replace function roster_rules(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'not a native league'); end if;
  return jsonb_build_object('ok', true, 'rounds', d.rounds, 'draft_status', d.status,
    'pos_caps', league_pos_caps(p_league_id));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN enforcement — every path that puts a player on a roster.
-- ─────────────────────────────────────────────────────────────────────────────

-- native_exec_pick v3: chosen picks (human or commish-picked) respect caps.
-- AUTO picks are trusted — native_autopick_slug is cap-aware, and its final
-- tiny-pool fallback deliberately ignores caps rather than freeze a draft.
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int; err text;
begin
  select * into d from draft where league_id = p_league_id;
  if d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  n := jsonb_array_length(d.draft_order);
  rnd := ((d.current_overall - 1) / n) + 1;

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

  insert into draft_pick (league_id, overall, round, roster_id, slug, auto)
  values (p_league_id, d.current_overall, rnd, oc, p_slug, p_auto);
  insert into native_roster (league_id, roster_id, slug, acquired)
  values (p_league_id, oc, p_slug, 'draft');

  if d.current_overall >= d.rounds * n then
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

-- nominate v4: the nominator may win the lot, so it must fit their caps
-- (counting the other lots they already hold).
create or replace function nominate(p_league_id uuid, p_slug text, p_bid int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; nom int; lid uuid; err text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' then
    return jsonb_build_object('ok', false, 'error', 'no live auction');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  if (select count(*) from auction_lot where league_id = p_league_id) >= d.max_lots then
    return jsonb_build_object('ok', false, 'error', 'all ' || d.max_lots || ' lots are open — wait for a bell');
  end if;
  nom := auction_nominator(d);
  if nom is null then return jsonb_build_object('ok', false, 'error', 'no seat can nominate'); end if;
  if not (owns_roster(p_league_id, nom) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your nomination');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug)
     or exists (select 1 from auction_lot al where al.league_id = p_league_id and al.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered or on the block');
  end if;
  err := pos_cap_error(p_league_id, nom, p_slug, true);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if p_bid is null or p_bid < 1 or p_bid > auction_lot_max(p_league_id, nom, d.rounds, null) then
    return jsonb_build_object('ok', false, 'error', 'opening bid exceeds your max');
  end if;
  insert into auction_lot (league_id, slug, bid, roster_id, nominator, deadline)
  values (p_league_id, p_slug, p_bid, nom, nom, draft_deadline(d, d.lot_seconds))
  returning id into lid;
  update draft set nom_idx = d.nom_idx + 1,
    deadline_at = case when (select count(*) from auction_lot where league_id = p_league_id) < d.max_lots
                       then draft_deadline(d, d.pick_seconds) end
    where league_id = p_league_id;
  perform resolve_lot_proxies(p_league_id, lid);
  return jsonb_build_object('ok', true, 'lot_id', lid, 'lot', p_slug, 'bid', p_bid, 'roster_id', nom);
end $$;

-- place_bid v5: a bid is a commitment to roster the player — cap-checked.
create or replace function place_bid(p_league_id uuid, p_roster_id int, p_amount int, p_lot_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; lot auction_lot%rowtype; lid uuid; err text;
begin
  if not (owns_roster(p_league_id, p_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' then
    return jsonb_build_object('ok', false, 'error', 'no live auction');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  lid := coalesce(p_lot_id, default_lot(p_league_id));
  select * into lot from auction_lot where id = lid and league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no open lot'); end if;
  if lot.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'lot closed'); end if;
  if lot.roster_id = p_roster_id then return jsonb_build_object('ok', false, 'error', 'you are the high bidder'); end if;
  err := pos_cap_error(p_league_id, p_roster_id, lot.slug, true);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if p_amount is null or p_amount <= lot.bid then
    return jsonb_build_object('ok', false, 'error', 'bid must beat $' || lot.bid);
  end if;
  if p_amount > auction_lot_max(p_league_id, p_roster_id, d.rounds, lid) then
    return jsonb_build_object('ok', false, 'error', 'over your max bid of $' || auction_lot_max(p_league_id, p_roster_id, d.rounds, lid));
  end if;
  update auction_lot set bid = p_amount, roster_id = p_roster_id,
    deadline = draft_deadline(d, d.lot_seconds)
    where id = lid;
  perform resolve_lot_proxies(p_league_id, lid);
  select * into lot from auction_lot where id = lid;
  return jsonb_build_object('ok', true, 'bid', lot.bid, 'roster_id', lot.roster_id,
    'outbid', lot.roster_id <> p_roster_id);
end $$;

-- set_lot_proxy v4: a hidden max is a commitment too.
create or replace function set_lot_proxy(p_league_id uuid, p_roster_id int, p_max int, p_lot_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; lid uuid; err text; lslug text;
begin
  if not owns_roster(p_league_id, p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' then
    return jsonb_build_object('ok', false, 'error', 'no open lot');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  lid := coalesce(p_lot_id, default_lot(p_league_id));
  select slug into lslug from auction_lot where id = lid and league_id = p_league_id;
  if lslug is null then return jsonb_build_object('ok', false, 'error', 'no open lot'); end if;
  if p_max is null or p_max < 1 then
    delete from lot_proxy where lot_id = lid and roster_id = p_roster_id;
    return jsonb_build_object('ok', true, 'max', null);
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, lslug, true);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if p_max > auction_lot_max(p_league_id, p_roster_id, d.rounds, lid) then
    return jsonb_build_object('ok', false, 'error', 'over your max bid of $' || auction_lot_max(p_league_id, p_roster_id, d.rounds, lid));
  end if;
  insert into lot_proxy (lot_id, league_id, roster_id, max_amount) values (lid, p_league_id, p_roster_id, p_max)
    on conflict (lot_id, roster_id) do update set max_amount = excluded.max_amount, created_at = now();
  perform resolve_lot_proxies(p_league_id, lid);
  return jsonb_build_object('ok', true, 'max', p_max);
end $$;

-- resolve_lot_proxies v3: a seat at its cap (counting the OTHER lots it
-- holds) can't be a challenger — its willingness is zeroed. The current
-- holder keeps its floor (the standing bid) regardless.
create or replace function resolve_lot_proxies(p_league_id uuid, p_lot_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; lot auction_lot%rowtype; win_r int; win_w int; second_w int; price int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.paused then return false; end if;
  select * into lot from auction_lot where id = p_lot_id and league_id = p_league_id;
  if not found then return false; end if;

  with cand as (
    select m.sleeper_roster_id as rid,
      least(
        greatest(
          case when m.sleeper_roster_id = lot.roster_id then lot.bid else 0 end,
          case when m.sleeper_roster_id <> lot.roster_id
                    and pos_cap_error(p_league_id, m.sleeper_roster_id, lot.slug, true) is not null then 0
               when seat_is_live_human(p_league_id, m.sleeper_roster_id)
            then coalesce((select px.max_amount from lot_proxy px
                           where px.lot_id = p_lot_id and px.roster_id = m.sleeper_roster_id), 0)
            else ai_lot_willingness(p_league_id, m.sleeper_roster_id, lot.slug, d.rounds, d.budget) end
        ),
        greatest(case when m.sleeper_roster_id = lot.roster_id then lot.bid else 0 end,
                 auction_lot_max(p_league_id, m.sleeper_roster_id, d.rounds, p_lot_id))
      ) as willing
    from league_membership m
    where m.league_id = p_league_id
  ),
  ranked as (
    select rid, willing,
      row_number() over (order by willing desc, (rid <> lot.roster_id)::int, rid) as rn
    from cand where willing > 0
  )
  select r1.rid, r1.willing, coalesce(r2.willing, 0)
    into win_r, win_w, second_w
  from ranked r1 left join ranked r2 on r2.rn = 2
  where r1.rn = 1;

  if win_r is null then return false; end if;
  price := least(win_w, greatest(lot.bid, second_w + 1));
  if win_r = lot.roster_id and price <= lot.bid then return false; end if;
  price := greatest(price, lot.bid + case when win_r = lot.roster_id then 0 else 1 end);
  if price > win_w then return false; end if;

  update auction_lot set bid = price, roster_id = win_r,
    deadline = draft_deadline(d, d.lot_seconds)
    where id = p_lot_id;
  return true;
end $$;

-- add_free_agent v2: cap-checked (after the same-move drop applies, so
-- swapping a QB for a QB is always legal).
create or replace function add_free_agent(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; cnt int; cap int; wu timestamptz; err text;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  cap := d.rounds;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is not null and wu > now() then
    return jsonb_build_object('ok', false, 'error', 'on waivers — submit a claim instead');
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, p_add_slug, false, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  if p_drop_slug is not null then
    delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug;
    if not found then return jsonb_build_object('ok', false, 'error', 'drop player not on this roster'); end if;
    update league_pool set waived_until = now() + interval '24 hours'
      where league_id = p_league_id and slug = p_drop_slug;
  end if;
  select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'roster full — drop someone'); end if;

  insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, p_roster_id, p_add_slug, 'fa');
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

-- submit_waiver_claim v2: cap-checked at submission (net of the drop)…
create or replace function submit_waiver_claim(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wu timestamptz; cnt int; cid uuid; err text;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is null then return jsonb_build_object('ok', false, 'error', 'player not in pool'); end if;
  if wu <= now() then return jsonb_build_object('ok', false, 'error', 'free agent — add directly'); end if;
  if p_drop_slug is not null and not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug) then
    return jsonb_build_object('ok', false, 'error', 'drop player not on this roster');
  end if;
  if p_drop_slug is null then
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
    if cnt >= d.rounds then return jsonb_build_object('ok', false, 'error', 'roster full — include a drop'); end if;
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, p_add_slug, false, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if exists (select 1 from waiver_claim c where c.league_id = p_league_id and c.roster_id = p_roster_id
             and c.add_slug = p_add_slug and c.status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'claim already pending');
  end if;
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug)
    values (p_league_id, p_roster_id, p_add_slug, p_drop_slug) returning id into cid;
  return jsonb_build_object('ok', true, 'claim_id', cid,
    'clears_at', (select waived_until from league_pool where league_id = p_league_id and slug = p_add_slug));
end $$;

-- …and process_waivers v2 re-checks at resolution (the roster may have
-- changed while the claim sat pending).
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; d draft%rowtype; cnt int; won int := 0; lost int := 0; changed boolean := false; err text;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return jsonb_build_object('ok', true, 'won', 0, 'lost', 0); end if;

  for c in
    select wc.*, m.waiver_priority
    from waiver_claim wc
    join league_membership m on m.league_id = wc.league_id and m.sleeper_roster_id = wc.roster_id
    join league_pool lp on lp.league_id = wc.league_id and lp.slug = wc.add_slug
    where wc.league_id = p_league_id and wc.status = 'pending'
      and (lp.waived_until is null or lp.waived_until <= now())
    order by m.waiver_priority nulls last, wc.created_at
  loop
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = c.add_slug) then
      update waiver_claim set status = 'lost', note = 'player taken', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if c.drop_slug is not null and not exists (select 1 from native_roster
        where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug) then
      update waiver_claim set status = 'lost', note = 'drop player no longer on roster', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = c.roster_id;
    if c.drop_slug is null and cnt >= d.rounds then
      update waiver_claim set status = 'lost', note = 'roster full', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    err := pos_cap_error(p_league_id, c.roster_id, c.add_slug, false, c.drop_slug);
    if err is not null then
      update waiver_claim set status = 'lost', note = 'position limit', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;

    if c.drop_slug is not null then
      delete from native_roster where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug;
      update league_pool set waived_until = now() + interval '24 hours'
        where league_id = p_league_id and slug = c.drop_slug;
    end if;
    insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, c.roster_id, c.add_slug, 'waiver');
    update waiver_claim set status = 'won', processed_at = now() where id = c.id;
    update league_membership set waiver_priority =
        (select coalesce(max(waiver_priority), 0) + 1 from league_membership where league_id = p_league_id)
      where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    won := won + 1; changed := true;
  end loop;

  if changed then perform native_materialize(p_league_id); end if;
  return jsonb_build_object('ok', true, 'won', won, 'lost', lost);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- AI reads the same config
-- ─────────────────────────────────────────────────────────────────────────────

-- native_autopick_slug v4: dynamic caps. K/D-ST are force-filled in the
-- endgame only while ALLOWED (cap ≥ 1 or uncapped). The tiny-pool fallback
-- stays uncapped on purpose — a stuck draft is worse than a bent cap.
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int := league_pos_cap(p_league_id, 'QB'); cap_rb int := league_pos_cap(p_league_id, 'RB');
  cap_wr int := league_pos_cap(p_league_id, 'WR'); cap_te int := league_pos_cap(p_league_id, 'TE');
  cap_k  int := league_pos_cap(p_league_id, 'K');  cap_def int := league_pos_cap(p_league_id, 'DEF');
  remaining int; need_k boolean; need_def boolean; forced int; pick text;
begin
  select count(*) filter (where lp.pos = 'QB'), count(*) filter (where lp.pos = 'RB'),
         count(*) filter (where lp.pos = 'WR'), count(*) filter (where lp.pos = 'TE'),
         count(*) filter (where lp.pos = 'K'),  count(*) filter (where lp.pos = 'DEF'),
         count(*)
    into qb_n, rb_n, wr_n, te_n, k_n, def_n, total
  from native_roster nr join league_pool lp
    on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id;

  remaining := p_rounds - total;
  need_k   := k_n = 0 and coalesce(cap_k, 1) >= 1;
  need_def := def_n = 0 and coalesce(cap_def, 1) >= 1;
  forced := (case when need_k then 1 else 0 end) + (case when need_def then 1 else 0 end);

  if remaining <= forced and forced > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and lp.pos = (case when need_k then 'K' else 'DEF' end)
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
      and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    and (   (lp.pos = 'QB'  and (cap_qb  is null or qb_n  < cap_qb))
         or (lp.pos = 'RB'  and (cap_rb  is null or rb_n  < cap_rb))
         or (lp.pos = 'WR'  and (cap_wr  is null or wr_n  < cap_wr))
         or (lp.pos = 'TE'  and (cap_te  is null or te_n  < cap_te))
         or (lp.pos = 'K'   and (cap_k   is null or k_n   < cap_k))
         or (lp.pos = 'DEF' and (cap_def is null or def_n < cap_def)))
  order by lp.rank limit 1;
  if pick is not null then return pick; end if;

  -- Caps exhausted the board (tiny pools) — take the best free player outright.
  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
  order by lp.rank limit 1;
  return pick;
end $$;

-- ai_lot_willingness v4: dynamic caps (mirrors autopick's rules).
create or replace function ai_lot_willingness(p_league_id uuid, p_roster_id int, p_slug text, p_rounds int, p_budget int)
  returns int language plpgsql stable security definer set search_path = public as $$
declare
  ppos text; pos_n int; cap int; k_n int; def_n int; total int;
  cap_k int := league_pos_cap(p_league_id, 'K'); cap_def int := league_pos_cap(p_league_id, 'DEF');
  remaining int; forced int; v numeric;
begin
  select lp.pos into ppos from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug;
  if ppos is null then return 0; end if;
  cap := league_pos_cap(p_league_id, ppos);
  select count(*) filter (where lp.pos = ppos),
         count(*) filter (where lp.pos = 'K'), count(*) filter (where lp.pos = 'DEF'), count(*)
    into pos_n, k_n, def_n, total
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id;
  if cap is not null and pos_n >= cap then return 0; end if;
  remaining := p_rounds - total;
  forced := (case when k_n = 0 and coalesce(cap_k, 1) >= 1 then 1 else 0 end)
          + (case when def_n = 0 and coalesce(cap_def, 1) >= 1 then 1 else 0 end);
  if remaining <= forced and forced > 0
     and not (ppos = 'K' and k_n = 0 and coalesce(cap_k, 1) >= 1)
     and not (ppos = 'DEF' and def_n = 0 and coalesce(cap_def, 1) >= 1) then
    return 0;
  end if;
  v := ai_player_value(p_league_id, p_slug, p_budget)
       * (0.85 + (abs(hashtext(p_league_id::text || ':' || p_roster_id || ':' || p_slug)) % 31) / 100.0);
  return greatest(1, round(v)::int);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Creation v5/v3: pos-caps param + a random crest at birth
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists create_native_league(text, text, int, int, int, text, int, int, int, int, int);
create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15, p_max_lots int default 1,
  p_night_start_min int default null, p_night_end_min int default null,
  p_pos_caps jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; e text; nm text; i int; err text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'native leagues are in closed testing'); end if;
  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league needs a name'); end if;
  if p_teams is null or p_teams < 2 or p_teams > 14 then
    return jsonb_build_object('ok', false, 'error', 'team count must be 2–14');
  end if;
  if p_rounds is null or p_rounds < 5 or p_rounds > 25 then
    return jsonb_build_object('ok', false, 'error', 'roster size must be 5–25');
  end if;
  if p_pick_seconds is null or p_pick_seconds < 15 or p_pick_seconds > 172800 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–48h');
  end if;
  if coalesce(p_mode, 'snake') not in ('snake', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake or auction');
  end if;
  if p_mode = 'auction' and (p_budget is null or p_budget < p_rounds or p_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
  end if;
  if p_mode = 'auction' and (p_lot_seconds is null or p_lot_seconds < 10 or p_lot_seconds > 172800) then
    return jsonb_build_object('ok', false, 'error', 'bid clock must be 10s–48h');
  end if;
  if p_mode = 'auction' and (p_max_lots is null or p_max_lots < 1 or p_max_lots > 4) then
    return jsonb_build_object('ok', false, 'error', 'lots at once must be 1–4');
  end if;
  if (p_night_start_min is null) <> (p_night_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'overnight pause needs both a start and an end');
  end if;
  if p_night_start_min is not null and (
       p_night_start_min < 0 or p_night_start_min > 1439
    or p_night_end_min < 0 or p_night_end_min > 1439
    or p_night_start_min = p_night_end_min) then
    return jsonb_build_object('ok', false, 'error', 'overnight hours must be two different times of day');
  end if;
  err := validate_pos_caps(p_pos_caps, p_rounds);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  insert into league (sleeper_league_id, season, name, provider, settings_json, commissioner_id, synced_at, avatar_url)
  values ('native-' || replace(gen_random_uuid()::text, '-', ''), coalesce(nullif(btrim(p_season), ''), '2026'),
          nm, 'native',
          jsonb_build_object('teams', p_teams, 'rounds', p_rounds, 'mode', coalesce(p_mode, 'snake'))
            || case when p_pos_caps is not null then jsonb_build_object('pos_caps', p_pos_caps) else '{}'::jsonb end,
          auth.uid(), now(), random_drip_avatar())
  returning id into lid;

  for i in 1..p_teams loop
    insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled)
    values (lid, i, 'Team ' || i, false);
  end loop;
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e
    where league_id = lid and sleeper_roster_id = 1;

  insert into draft (league_id, rounds, pick_seconds, mode, budget, lot_seconds, max_lots, night_start_min, night_end_min)
  values (lid, p_rounds, p_pick_seconds, coalesce(p_mode, 'snake'), coalesce(p_budget, 200),
          coalesce(p_lot_seconds, 15), coalesce(p_max_lots, 1), p_night_start_min, p_night_end_min);

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1,
    'invite_code', (select invite_code from league where id = lid));
end $$;
grant execute on function create_native_league(text, text, int, int, int, text, int, int, int, int, int, jsonb) to authenticated;

drop function if exists create_mock_draft(int, int, int, text, int, int, int);
create or replace function create_mock_draft(
  p_teams int, p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15, p_max_lots int default 1,
  p_pos_caps jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; lid uuid;
  bots text[] := array['Otto Pick','Max Bid','Al Gorithm','Robo Rodgers',
    'Data Drip','Neural Nate','Circuit Chase','Binary Barkley','Cache Kupp',
    'Vector Vick','Pixel Prescott','Tensor Tucker','Logic Lamb'];
begin
  r := create_native_league(
    'Mock ' || to_char(now() at time zone 'America/New_York', 'Mon FMDD, FMHH12:MI am'),
    '2026', p_teams, p_rounds, p_pick_seconds, p_mode, p_budget,
    p_lot_seconds, p_max_lots, null, null, p_pos_caps);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  lid := (r ->> 'league_id')::uuid;
  update league set is_mock = true where id = lid;
  update league_membership m
    set controller = 'ai', team_name = bots[m.sleeper_roster_id - 1]
    where m.league_id = lid and m.sleeper_roster_id > 1;
  return r || jsonb_build_object('is_mock', true);
end $$;
grant execute on function create_mock_draft(int, int, int, text, int, int, int, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Imports: platform crest when the platform has one, random tile otherwise —
-- and NEVER overwrite an existing crest (commish choice survives re-syncs).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists admin_upsert_league(text, text, text, jsonb, text);
create or replace function admin_upsert_league(
  p_sleeper_id text, p_season text, p_name text, p_settings jsonb,
  p_provider text default 'sleeper', p_avatar text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; u text;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into league (sleeper_league_id, season, name, settings_json, provider, synced_at)
  values (p_sleeper_id, p_season, coalesce(p_name, 'League'), p_settings, coalesce(p_provider, 'sleeper'), now())
  on conflict (sleeper_league_id, season) do update
    set name = excluded.name, settings_json = excluded.settings_json, provider = excluded.provider, synced_at = now()
  returning id into lid;
  u := clean_avatar_url(p_avatar);
  if u = '!invalid' then u := null; end if;
  update league set avatar_url = coalesce(u, random_drip_avatar())
    where id = lid and avatar_url is null;
  return jsonb_build_object('ok', true, 'league_id', lid);
end $$;
grant execute on function admin_upsert_league(text, text, text, jsonb, text, text) to authenticated;

-- Backfill: native leagues born before crests existed get one now. Imported
-- leagues stay null so their next sync can prefer the platform's crest.
update league set avatar_url = random_drip_avatar()
where avatar_url is null and provider = 'native';

-- ─────────────────────────────────────────────────────────────────────────────
-- Surface the rules to the client
-- ─────────────────────────────────────────────────────────────────────────────

-- native_team_state v3: + pos_caps.
create or replace function native_team_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_roster int; d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select sleeper_roster_id into my_roster from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select * into d from draft where league_id = p_league_id;
  return jsonb_build_object(
    'my_roster_id', my_roster,
    'my_team', (select team_name from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_avatar', (select avatar_url from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'league_avatar', (select avatar_url from league l where l.id = p_league_id),
    'is_commish', is_league_commish(p_league_id) or is_admin(),
    'draft_status', coalesce(d.status, 'none'),
    'roster_cap', d.rounds,
    'pos_caps', league_pos_caps(p_league_id),
    'server_now', now(),
    'waiver_order', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'priority', m.waiver_priority,
        'avatar', m.avatar_url)
        order by m.waiver_priority nulls last, m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id),
    'my_claims', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'add_slug', c.add_slug, 'drop_slug', c.drop_slug, 'status', c.status,
        'note', c.note, 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;

-- draft_state v8: + pos_caps (the room greys out at-cap picks client-side).
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int; lots jsonb; open_lots int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'no draft'); end if;
  select sleeper_roster_id into my_r from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select count(*)::int into open_lots from auction_lot where league_id = p_league_id;
  oc := case when d.status = 'live' then
    case when d.mode = 'auction'
      then (case when open_lots < d.max_lots then auction_nominator(d) end)
      else draft_on_clock(d) end end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'overall', dp.overall, 'round', dp.round, 'roster_id', dp.roster_id,
      'slug', dp.slug, 'auto', dp.auto, 'price', dp.price) order by dp.overall), '[]'::jsonb)
    into picks from draft_pick dp where dp.league_id = p_league_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', al.id, 'slug', al.slug, 'bid', al.bid, 'roster_id', al.roster_id,
      'deadline_at', al.deadline,
      'my_proxy', case when my_r is not null then
        (select px.max_amount from lot_proxy px where px.lot_id = al.id and px.roster_id = my_r) end,
      'my_max', case when my_r is not null then auction_lot_max(p_league_id, my_r, d.rounds, al.id) end
    ) order by al.created_at), '[]'::jsonb)
    into lots from auction_lot al where al.league_id = p_league_id;
  return jsonb_build_object(
    'status', d.status, 'mode', d.mode, 'rounds', d.rounds, 'pick_seconds', d.pick_seconds,
    'lot_seconds', d.lot_seconds, 'max_lots', d.max_lots, 'paused', d.paused,
    'is_mock', coalesce((select l.is_mock from league l where l.id = p_league_id), false),
    'pos_caps', league_pos_caps(p_league_id),
    'night', case when d.night_start_min is not null then jsonb_build_object(
      'start_min', d.night_start_min, 'end_min', d.night_end_min,
      'is_night', is_night_minute(et_minutes(now()), d.night_start_min, d.night_end_min)) end,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', oc,
    'on_clock_auto', case when d.status = 'live' and oc is not null then not seat_is_live_human(p_league_id, oc) end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks,
    'budget', case when d.mode = 'auction' then d.budget end,
    'lots', lots,
    'budgets', case when d.mode = 'auction' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'budget', m.draft_budget,
        'committed', auction_committed(p_league_id, m.sleeper_roster_id),
        'spots_left', auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds),
        'max_bid', auction_lot_max(p_league_id, m.sleeper_roster_id, d.rounds, null))
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id) end,
    'my_autodraft', coalesce((select m.autodraft from league_membership m
      where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
      order by m.sleeper_roster_id limit 1), false));
end $$;

grant execute on function set_roster_rules(uuid, int, jsonb) to authenticated;
grant execute on function roster_rules(uuid) to authenticated;
