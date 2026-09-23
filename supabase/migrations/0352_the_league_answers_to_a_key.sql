-- ═══════════════════════════════════════════════════════════════════════════
-- 0352 · THE LEAGUE ANSWERS TO A KEY — the write API
--
-- Founder: "Let's do an API for external league and team control like ESPN.
-- Commish has to opt in."
--
-- 0326 built the read half and wrote down why it stopped there: "A write API
-- needs per-user consent; it is a different project." This is that project.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────
-- • THE COMMISSIONER OPTS THE LEAGUE IN. settings_json.write_api, off unless
--   switched on, for every league whatever its provider. Off means every key
--   in the league is refused on its next call — kept, not deleted, so switching
--   it back on restores the tools people built rather than breaking them twice.
-- • A MANAGER MINTS A KEY for ONE league, for themselves. The key is shown
--   once; the database keeps a SHA-256 of it and a short prefix to list it by.
--   It acts AS its owner, with exactly the powers that person has in the app —
--   no more, because every action below ends in the same RPC the app calls,
--   and that RPC asks its own permission question.
-- • TWO SCOPES. `team` (anyone with a seat): the seats you own or co-manage,
--   and nothing else — even when you are the commissioner. `league` (the
--   commissioner only): every seat, plus the commissioner's tools. A lineup
--   bot does not need to be able to veto trades, so a commissioner who builds
--   one does not have to hand it that power.
-- • ONE DOOR. `api_write` is the only function the edge function calls, it is
--   granted to the service role alone, and it is a WHITELIST: an action that
--   is not in its CASE does not exist.
--
-- ── ACTING AS THE OWNER ────────────────────────────────────────────────────
-- Every permission in this schema is a question about `auth.uid()`, which
-- reads the request's JWT claims. Once the key checks out, `api_write` sets
-- those claims — transaction-local — to the key's owner, and from then on
-- `owns_roster`, `is_league_commish` and every RPC's own guard answer for that
-- person exactly as they would in the app. The claims carry no email, so
-- `is_admin()` (which reads the email) is false: a key never inherits the
-- platform admin's powers, whoever minted it.
--
-- THE LEAGUE IS THE KEY'S, NEVER THE CALLER'S. A key's owner may sit in other
-- leagues too, and as far as `auth.uid()` is concerned they are the same
-- person there. So every action passes the KEY's league id, and every action
-- that names an object by its own id (a claim, a trade) checks that object
-- belongs to the key's league before anything is called.
--
-- ── WHAT THE TABLE RULES WOULD HAVE SAID ───────────────────────────────────
-- A lineup is rows in `sealed_pick`, which the app writes directly under RLS.
-- This function runs as the owner and RLS does not apply to it — so
-- `set_lineup` asks the policies' questions itself, in the policies' words:
-- the pick owner is the seat's owner, you own or co-manage the seat (or you
-- are a league-scope commissioner in a CLASSIC league, 0320's rule — never a
-- drip league, whose picks are hidden until kickoff), and `locked` stays
-- false. The TRIGGERS — the kickoff lock, the legal roster, the slot cap, the
-- flag and stash rules — fire for every writer and needed nothing.
--
-- ── WHAT IS WRITTEN DOWN ───────────────────────────────────────────────────
-- Every write through a key is logged: which key, which action, which seat,
-- whether it worked and why not. The commissioner reads the league's log; a
-- manager reads their own. A move made by a bot at 3am is exactly the move a
-- league will want to be able to ask about.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. the switch ══════════════════════════════════════════════════════════
create or replace function league_write_api(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  -- coalesce: an absent key is SQL NULL, and NULL must read as OFF (0343, 0348).
  select coalesce((select (l.settings_json ->> 'write_api')::boolean
                     from league l where l.id = p_league_id), false);
$$;
grant execute on function league_write_api(uuid) to authenticated;

create or replace function commish_set_write_api(p_league_id uuid, p_on boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('write_api', coalesce(p_on, false))
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'write_api', league_write_api(p_league_id));
end $$;
grant execute on function commish_set_write_api(uuid, boolean) to authenticated;

-- ═══ 2. keys and the log ════════════════════════════════════════════════════
create table if not exists api_key (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references league(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  label        text not null default '',
  scope        text not null check (scope in ('team', 'league')),
  -- 'drip_sk_' + six characters: enough to tell your keys apart in a list,
  -- nowhere near enough to guess the other 58.
  prefix       text not null,
  -- SHA-256 of the whole key, hex. The key itself is never stored.
  secret_hash  text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists api_key_league on api_key(league_id, app_user_id);
-- No policies: every read and write goes through the functions below.
alter table api_key enable row level security;

create table if not exists api_write_log (
  id          bigserial primary key,
  league_id   uuid not null references league(id) on delete cascade,
  key_id      uuid references api_key(id) on delete set null,
  app_user_id uuid,
  action      text not null,
  roster_id   int,
  ok          boolean not null,
  error       text,
  at          timestamptz not null default now()
);
create index if not exists api_write_log_league on api_write_log(league_id, at desc);
alter table api_write_log enable row level security;

/** Does the caller hold a seat here — owned or co-managed? */
create or replace function _holds_a_seat(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_membership m
                  where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled)
      or exists (select 1 from team_manager tm
                  where tm.league_id = p_league_id and tm.app_user_id = auth.uid());
$$;

-- ═══ 3. minting, listing, revoking ══════════════════════════════════════════
create or replace function api_key_create(p_league_id uuid, p_label text default null, p_scope text default 'team')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; kid uuid; sc text := lower(coalesce(nullif(btrim(p_scope), ''), 'team'));
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if sc not in ('team', 'league') then
    return jsonb_build_object('ok', false, 'error', 'scope is team or league');
  end if;
  if not league_write_api(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the commissioner has not turned on the write API for this league');
  end if;
  if sc = 'league' and not is_league_commish(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'only the commissioner can make a league-scope key');
  end if;
  if sc = 'team' and not _holds_a_seat(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'you have no team in this league to give a key to');
  end if;
  if (select count(*) from api_key where league_id = p_league_id and app_user_id = auth.uid()
        and revoked_at is null) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'ten live keys per league is the limit — revoke one first');
  end if;
  -- Two v4 UUIDs of hex: 244 random bits, from the same generator that
  -- makes every id in this schema. No extension needed.
  k := 'drip_sk_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into api_key (league_id, app_user_id, label, scope, prefix, secret_hash)
  values (p_league_id, auth.uid(), left(coalesce(btrim(p_label), ''), 60), sc, left(k, 14),
          encode(sha256(convert_to(k, 'UTF8')), 'hex'))
  returning id into kid;
  return jsonb_build_object('ok', true, 'id', kid, 'key', k, 'prefix', left(k, 14), 'scope', sc,
    'note', 'Copy this key now — it is shown once and cannot be recovered.');
end $$;
grant execute on function api_key_create(uuid, text, text) to authenticated;

-- Your own keys; and for the commissioner, everybody's — never a hash, never
-- a whole key, because neither exists anywhere a list could read it.
create or replace function api_keys(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare commish boolean := is_league_commish(p_league_id) or is_admin();
begin
  if not (commish or _holds_a_seat(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'write_api', league_write_api(p_league_id),
    'is_commish', commish,
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'label', k.label, 'scope', k.scope, 'prefix', k.prefix,
        'created_at', k.created_at, 'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at,
        'mine', k.app_user_id = auth.uid(),
        -- The owner's seat name for the commissioner's list; their own list
        -- does not need telling whose it is.
        'owner', (select coalesce(nullif(m.team_name, ''), 'Team ' || m.sleeper_roster_id)
                    from league_membership m
                   where m.league_id = k.league_id and m.app_user_id = k.app_user_id and m.enrolled
                   order by m.sleeper_roster_id limit 1))
        order by k.revoked_at nulls first, k.created_at desc)
      from api_key k
      where k.league_id = p_league_id and (commish or k.app_user_id = auth.uid())), '[]'::jsonb));
end $$;
grant execute on function api_keys(uuid) to authenticated;

create or replace function api_key_revoke(p_key_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare k api_key%rowtype;
begin
  select * into k from api_key where id = p_key_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such key'); end if;
  if not (k.app_user_id = auth.uid() or is_league_commish(k.league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update api_key set revoked_at = coalesce(revoked_at, now()) where id = p_key_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function api_key_revoke(uuid) to authenticated;

create or replace function api_write_log_list(p_league_id uuid, p_limit int default 100) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare commish boolean := is_league_commish(p_league_id) or is_admin();
begin
  if not (commish or _holds_a_seat(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'entries', coalesce((
    select jsonb_agg(e order by (e ->> 'id')::bigint desc) from (
      select jsonb_build_object('id', l.id, 'at', l.at, 'action', l.action, 'roster_id', l.roster_id,
               'ok', l.ok, 'error', l.error, 'prefix', k.prefix, 'label', k.label,
               'mine', l.app_user_id = auth.uid()) as e
        from api_write_log l left join api_key k on k.id = l.key_id
       where l.league_id = p_league_id and (commish or l.app_user_id = auth.uid())
       order by l.id desc
       limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb));
end $$;
grant execute on function api_write_log_list(uuid, int) to authenticated;

-- ═══ 4. a lineup, with the policies' questions asked out loud ═══════════════
create or replace function _api_set_lineup(p_league_id uuid, p_roster_id int, p_week int,
                                           p_picks jsonb, p_scope text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare mid uuid; owner uuid; wins text[]; saved int := 0; skipped int := 0; n int; p jsonb;
begin
  if p_week is null then return jsonb_build_object('ok', false, 'error', 'week required'); end if;
  if jsonb_typeof(p_picks) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'picks must be an array');
  end if;
  select id into mid from matchup
   where league_id = p_league_id and week = p_week
     and (home_roster_id = p_roster_id or away_roster_id = p_roster_id)
   order by created_at limit 1;
  if mid is null then return jsonb_build_object('ok', false, 'error', 'that team has no matchup in week ' || p_week); end if;
  select app_user_id into owner from league_membership
   where league_id = p_league_id and sleeper_roster_id = p_roster_id and enrolled;
  if owner is null then return jsonb_build_object('ok', false, 'error', 'that seat has no owner to field a lineup for'); end if;
  -- THE POLICIES (0001, 0125, 0320): your own seat, a seat you co-manage, or
  -- — league scope only — a commissioner setting a CLASSIC lineup.
  if not (owns_roster(p_league_id, p_roster_id)
          or (p_scope = 'league' and is_league_commish(p_league_id) and matchup_is_classic(mid))) then
    return jsonb_build_object('ok', false, 'error', 'you cannot set that team''s lineup');
  end if;
  for p in select * from jsonb_array_elements(p_picks) loop
    if coalesce(p ->> 'game_window', '') = '' or coalesce(p ->> 'roster_slot', '') = '' then
      return jsonb_build_object('ok', false, 'error', 'every pick needs game_window and roster_slot');
    end if;
  end loop;
  -- REPLACE, WINDOW BY WINDOW: the windows the payload names are what the
  -- caller is setting. An unlocked row in one of them that the payload does
  -- not name is a spot being emptied (the stranded-row bug of v0.394.3). A
  -- window the payload does not name is left exactly as it is, and a locked
  -- row is never touched — the kickoff trigger would refuse it anyway.
  select array_agg(distinct x ->> 'game_window') into wins from jsonb_array_elements(p_picks) x;
  delete from sealed_pick s
   where s.matchup_id = mid and s.app_user_id = owner and not s.locked
     and s.game_window = any(coalesce(wins, '{}'))
     and not exists (select 1 from jsonb_array_elements(p_picks) x
                      where x ->> 'game_window' = s.game_window and x ->> 'roster_slot' = s.roster_slot);
  for p in select * from jsonb_array_elements(p_picks) loop
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id)
    values (mid, owner, p ->> 'game_window', p ->> 'roster_slot',
            nullif(p ->> 'player_slug', ''), nullif(p ->> 'metric_id', ''))
    on conflict (matchup_id, app_user_id, game_window, roster_slot) do update
      set player_slug = excluded.player_slug, metric_id = excluded.metric_id
      where not sealed_pick.locked;
    get diagnostics n = row_count;
    if n > 0 then saved := saved + 1; else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'matchup_id', mid, 'saved', saved,
    'skipped_locked', skipped);
end $$;
revoke all on function _api_set_lineup(uuid, int, int, jsonb, text) from public, anon, authenticated;

-- ═══ 5. the one door ════════════════════════════════════════════════════════
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
        select roster_id into owner_rid from native_roster where league_id = lid and slug = a ->> 'player';
        if owner_rid is null then
          r := jsonb_build_object('ok', false, 'status', 404, 'error', 'that player is on no roster here');
        elsif not (owns_roster(lid, owner_rid) or (k.scope = 'league' and is_league_commish(lid))) then
          r := jsonb_build_object('ok', false, 'status', 403, 'error', 'not your player');
        else
          rid := owner_rid;
          r := set_roster_spot(lid, a ->> 'player', a ->> 'spot');
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
-- THE SERVICE ROLE ONLY. Anybody else calling this could set their own claims.
revoke all on function api_write(text, text, jsonb) from public, anon, authenticated;
grant execute on function api_write(text, text, jsonb) to service_role;
