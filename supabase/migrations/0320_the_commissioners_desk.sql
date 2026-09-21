-- 0320 — THE COMMISSIONER'S DESK (v0.436.0).
--
-- Founder, holding Sleeper's Commish tab against ours: "build the gaps in
-- that order." Six, in his order:
--
--   1. CO-COMMISSIONERS.  league_commish — more than one commissioner, and a
--      hand-over. is_league_commish / is_matchup_commish read the table, so
--      every commissioner RPC in the schema admits a co-commissioner at once.
--      Adding, removing and handing over stay with the PRIMARY commissioner
--      (league.commissioner_id), as does deleting the league (0188).
--   2. TWO LOCKS.  settings_json.wire_lock — every free-agent and waiver move
--      in the league, shut; league_membership.wire_locked — one team's roster
--      transactions (adds, drops, claims, trades), shut. Both answered by
--      wire_block_reason, which every wire RPC already asks; the commissioner's
--      own force-moves (commish_move_player) are not on the wire and still work.
--   3. THE WAIVER ORDER, and LINEUPS.  commish_set_waiver_priority takes the
--      whole order at once. A commissioner may write a CLASSIC team's lineup
--      (sealed_pick policies) — classic only: a drip league's picks are
--      hidden, and that is the game.
--   4. THE MEDIAN GAME.  settings_json.median_game — every regular-season week
--      each team also plays the league median: above it a win, below a loss,
--      on it a tie. Wins and losses only; points for/against stay real.
--   5. SCORE EDITS.  commish_set_matchup_score on a final matchup; standings
--      are computed from the finals, so records follow at once.
--   6. DUES.  settings_json.dues_amount / dues_note and league_dues (paid per
--      seat), readable by the whole league.

-- ═══ 1. co-commissioners ═════════════════════════════════════════════════════
create table if not exists league_commish (
  league_id   uuid not null references league(id) on delete cascade,
  app_user_id uuid not null references app_user(id) on delete cascade,
  added_by    uuid,
  created_at  timestamptz not null default now(),
  primary key (league_id, app_user_id)
);
alter table league_commish enable row level security;

create or replace function is_league_commish(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league where id = l and commissioner_id = auth.uid())
      or exists (select 1 from league_commish c where c.league_id = l and c.app_user_id = auth.uid());
$$;
create or replace function is_matchup_commish(m uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from matchup mt where mt.id = m and is_league_commish(mt.league_id));
$$;
-- The PRIMARY commissioner: the seat that can change who the commissioners are.
create or replace function is_primary_commish(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league where id = l and commissioner_id = auth.uid());
$$;
grant execute on function is_primary_commish(uuid) to authenticated;

create or replace function league_commissioners(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'primary', (select jsonb_build_object('app_user_id', u.id, 'email', u.email, 'name', coalesce(nullif(u.display_name, ''), u.email))
                  from league l join app_user u on u.id = l.commissioner_id where l.id = p_league_id),
    'you_are_primary', is_primary_commish(p_league_id),
    'co', coalesce((select jsonb_agg(jsonb_build_object('app_user_id', u.id, 'email', u.email,
                        'name', coalesce(nullif(u.display_name, ''), u.email), 'since', c.created_at) order by c.created_at)
                    from league_commish c join app_user u on u.id = c.app_user_id where c.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function league_commissioners(uuid) to authenticated;

create or replace function add_commissioner(p_league_id uuid, p_email text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not (is_primary_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'only the league''s commissioner can add commissioners');
  end if;
  select id into uid from app_user where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then return jsonb_build_object('ok', false, 'error', 'no account with that email — they need to sign up first'); end if;
  if exists (select 1 from league where id = p_league_id and commissioner_id = uid) then
    return jsonb_build_object('ok', false, 'error', 'already the commissioner');
  end if;
  insert into league_commish (league_id, app_user_id, added_by) values (p_league_id, uid, auth.uid())
    on conflict do nothing;
  return jsonb_build_object('ok', true, 'app_user_id', uid);
end $$;
grant execute on function add_commissioner(uuid, text) to authenticated;

create or replace function remove_commissioner(p_league_id uuid, p_app_user_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  -- A co-commissioner may step down; only the primary removes another.
  if not (is_primary_commish(p_league_id) or is_admin() or p_app_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'only the league''s commissioner can remove commissioners');
  end if;
  delete from league_commish where league_id = p_league_id and app_user_id = p_app_user_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a co-commissioner'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function remove_commissioner(uuid, uuid) to authenticated;

-- Hand the league over. The old primary stays on as a co-commissioner — a
-- hand-over is a change of who holds the keys, not an exit; step down after
-- if that is what you meant.
create or replace function transfer_commissioner(p_league_id uuid, p_app_user_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare old uuid;
begin
  if not (is_primary_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'only the league''s commissioner can hand the league over');
  end if;
  if not exists (select 1 from app_user where id = p_app_user_id) then
    return jsonb_build_object('ok', false, 'error', 'no such account');
  end if;
  select commissioner_id into old from league where id = p_league_id;
  if old = p_app_user_id then return jsonb_build_object('ok', false, 'error', 'already the commissioner'); end if;
  update league set commissioner_id = p_app_user_id where id = p_league_id;
  delete from league_commish where league_id = p_league_id and app_user_id = p_app_user_id;
  if old is not null then
    insert into league_commish (league_id, app_user_id, added_by) values (p_league_id, old, auth.uid()) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function transfer_commissioner(uuid, uuid) to authenticated;

-- ── commish_overview: 0110's body, co-commissioners see their leagues ─────
create or replace function commish_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider, 'avatar_url', l.avatar_url,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true, 'lineup_policy', l.lineup_policy,
      'primary', l.commissioner_id = auth.uid(),   -- 0320: false for a co-commissioner
      'weekly_budget', l.weekly_budget,
      'test_live_at', l.test_live_at,
      'preseason_at', l.preseason_at,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l
    where l.commissioner_id = auth.uid()
       or exists (select 1 from league_commish c where c.league_id = l.id and c.app_user_id = auth.uid())   -- 0320
    order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function commish_overview() to authenticated;


-- ═══ 2. two locks ════════════════════════════════════════════════════════════
alter table league_membership add column if not exists wire_locked boolean not null default false;

create or replace function league_wire_lock(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'wire_lock')::boolean, false) from league where id = p_league_id;
$$;
grant execute on function league_wire_lock(uuid) to authenticated;

-- Why THIS team may not transact right now (its own lock), or NULL. Asked by
-- trades too, where the league-wide wire lock does not apply — Sleeper's
-- "lock all free agent and waiver moves" is about the wire, and a locked TEAM
-- is about the team.
create or replace function team_lock_reason(p_league_id uuid, p_roster_id int) returns text
  language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from league_membership
                            where league_id = p_league_id and sleeper_roster_id = p_roster_id and wire_locked)
              then 'the commissioner has locked this team''s roster moves' end;
$$;
grant execute on function team_lock_reason(uuid, int) to authenticated;

-- ── wire_block_reason: 0272's body, the commissioner's locks first ────────
create or replace function wire_block_reason(p_league_id uuid, p_roster_id int) returns text
  language plpgsql stable security definer set search_path = public as $$
declare f text;
begin
  -- 0320: THE COMMISSIONER'S LOCKS come first — the league-wide wire lock,
  -- then this team's own. Every wire RPC asks here, so both hold everywhere
  -- at once, the worker's seat wire included.
  if league_wire_lock(p_league_id) then
    return 'the commissioner has locked all free agent and waiver moves';
  end if;
  if team_lock_reason(p_league_id, p_roster_id) is not null then
    return team_lock_reason(p_league_id, p_roster_id);
  end if;
  f := league_format(p_league_id);
  if f = 'guillotine' then
    if exists (select 1 from league_membership
               where league_id = p_league_id and sleeper_roster_id = p_roster_id
                 and eliminated_week is not null) then
      return 'this team fell to the guillotine — its season is over';
    end if;
  elsif f = 'vampire' then
    if vampire_wire_lock_on(p_league_id)
       and coalesce(array_length(vampire_seats(p_league_id), 1), 0) > 0
       and not is_vampire_seat(p_league_id, p_roster_id) then
      return 'the wire belongs to the vampire — this league locks pickups to the coven';
    end if;
  end if;
  return null;
end $$;
grant execute on function wire_block_reason(uuid, int) to authenticated;


create or replace function commish_set_wire_lock(p_league_id uuid, p_on boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('wire_lock', coalesce(p_on, false)) where id = p_league_id;
  perform _chat_house(p_league_id,
    case when p_on then '🔒 The commissioner locked all free agent and waiver moves' else '🔓 The commissioner reopened free agent and waiver moves' end,
    jsonb_build_object('kind', 'wire_lock', 'on', coalesce(p_on, false)));
  return jsonb_build_object('ok', true, 'wire_lock', coalesce(p_on, false));
end $$;
grant execute on function commish_set_wire_lock(uuid, boolean) to authenticated;

create or replace function commish_lock_team(p_league_id uuid, p_roster_id int, p_locked boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  update league_membership set wire_locked = coalesce(p_locked, false)
   where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such team'); end if;
  return jsonb_build_object('ok', true, 'roster_id', p_roster_id, 'locked', coalesce(p_locked, false));
end $$;
grant execute on function commish_lock_team(uuid, int, boolean) to authenticated;

-- ── drop_player: 0317's body, asking the wire ────────────────────────────
create or replace function drop_player(p_league_id uuid, p_roster_id int, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare err text;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 0320: a drop is a wire move too. The vampire's lock and the guillotine
  -- reached it through the seat-guard trigger (a raise); the commissioner's
  -- locks answer here, the way every other refusal does.
  err := wire_block_reason(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'complete') then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0317: NOT ONCE HIS GAME HAS STARTED. Answered, not thrown (0272), and
  -- for every format — the classic trigger still raises behind this.
  err := drop_lock_reason(p_league_id, p_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'player not on this roster'); end if;
  update league_pool set waived_until = waiver_hold_until(p_league_id)
    where league_id = p_league_id and slug = p_slug;
  -- 0290: and the league hears about it. Named from league_pool, which still
  -- holds him now that the roster does not.
  perform _chat_house(p_league_id,
    '🔻 ' || _txn_team(p_league_id, p_roster_id) || ' dropped ' || _txn_player(p_league_id, p_slug),
    jsonb_build_object('kind', 'drop', 'roster_id', p_roster_id, 'drop', p_slug));
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function drop_player(uuid, int, text) to authenticated;

-- ── propose_trade: 0319's body, a locked team stays out ──────────────────
create or replace function propose_trade(
  p_league_id uuid, p_from_roster int, p_to_roster int,
  p_give jsonb, p_get jsonb, p_note text default null,
  p_give_picks jsonb default null, p_get_picks jsonb default null,
  p_retain jsonb default null, p_cap_dollars int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; gp jsonb; tp jsonb; err text; el jsonb;
        rt jsonb := '[]'::jsonb; rslug text; ramt int; rtr int; c contract%rowtype; already int;
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
      + jsonb_array_length(gp) + jsonb_array_length(tp) < 1 and coalesce(p_cap_dollars, 0) = 0) then
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
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, give_picks, get_picks, note, created_by, retain, cap_dollars)
    values (p_league_id, p_from_roster, p_to_roster, p_give, p_get, gp, tp,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
            case when jsonb_array_length(rt) > 0 then rt else null end, nullif(coalesce(p_cap_dollars, 0), 0))
    returning id into tid;
  return jsonb_build_object('ok', true, 'trade_id', tid);
end $$;
grant execute on function propose_trade(uuid, int, int, jsonb, jsonb, text, jsonb, jsonb, jsonb, int) to authenticated;

-- ── respond_trade: 0319's body, a locked team stays out ──────────────────
create or replace function respond_trade(p_trade_id uuid, p_accept boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; r jsonb; err text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (owns_roster(t.league_id, t.to_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your trade to answer');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;   -- re-read under the lock
  if t.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status); end if;
  if not p_accept then
    update trade_proposal set status = 'rejected', responded_at = now(), resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  -- 0319: an offer made before the deadline cannot be accepted after it.
  err := trade_deadline_error(t.league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := coalesce(team_lock_reason(t.league_id, t.to_roster), team_lock_reason(t.league_id, t.from_roster));   -- 0320
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if league_trade_review(t.league_id) = 'commish' then
    update trade_proposal set status = 'accepted', responded_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'accepted', 'awaiting', 'commissioner approval');
  end if;
  r := execute_trade(p_trade_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;   -- stays pending, error surfaced
  update trade_proposal set responded_at = now() where id = p_trade_id;
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;
grant execute on function respond_trade(uuid, boolean) to authenticated;


-- ═══ 3. the waiver order, and a classic team's lineup ════════════════════════
-- The whole order at once: p_order is every roster id, first pick first.
create or replace function commish_set_waiver_priority(p_league_id uuid, p_order jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int; i int := 0; rid int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  if p_order is null or jsonb_typeof(p_order) <> 'array' then return jsonb_build_object('ok', false, 'error', 'the order is a list of teams'); end if;
  select count(*) into n from league_membership where league_id = p_league_id;
  if jsonb_array_length(p_order) <> n
     or (select count(distinct (e)::int) from jsonb_array_elements_text(p_order) e) <> n
     or exists (select 1 from jsonb_array_elements_text(p_order) e
                 where not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = (e)::int)) then
    return jsonb_build_object('ok', false, 'error', 'the order must name every team exactly once');
  end if;
  for rid in select (e)::int from jsonb_array_elements_text(p_order) e loop
    i := i + 1;
    update league_membership set waiver_priority = i where league_id = p_league_id and sleeper_roster_id = rid;
  end loop;
  return jsonb_build_object('ok', true, 'teams', n);
end $$;
grant execute on function commish_set_waiver_priority(uuid, jsonb) to authenticated;

-- A commissioner may set a CLASSIC team's lineup — the same rows a co-manager
-- writes, under the same kickoff lock. Classic only: a drip league's picks are
-- hidden until kickoff, and a commissioner reading them would be the exploit
-- 0178 fenced off.
drop policy if exists sealed_insert_commish on sealed_pick;
create policy sealed_insert_commish on sealed_pick for insert
  with check (locked = false and matchup_is_classic(matchup_id) and is_matchup_commish(matchup_id));
drop policy if exists sealed_update_commish on sealed_pick;
create policy sealed_update_commish on sealed_pick for update
  using (locked = false and matchup_is_classic(matchup_id) and is_matchup_commish(matchup_id))
  with check (locked = false and matchup_is_classic(matchup_id) and is_matchup_commish(matchup_id));
drop policy if exists sealed_delete_commish on sealed_pick;
create policy sealed_delete_commish on sealed_pick for delete
  using (locked = false and matchup_is_classic(matchup_id) and is_matchup_commish(matchup_id));

-- ═══ 4. the median game ══════════════════════════════════════════════════════
create or replace function league_median_game(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'median_game')::boolean, false) from league where id = p_league_id;
$$;
grant execute on function league_median_game(uuid) to authenticated;

create or replace function commish_set_median_game(p_league_id uuid, p_on boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('median_game', coalesce(p_on, false)) where id = p_league_id;
  return jsonb_build_object('ok', true, 'median_game', coalesce(p_on, false));
end $$;
grant execute on function commish_set_median_game(uuid, boolean) to authenticated;

-- league_standings: 0272's body, with the median game. Each final
-- regular-season matchup still yields two rows (us/them, points counted);
-- with the median game on, each team-week also yields a row against that
-- week's median of every team's score (win/loss/tie counted, points not).
create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'roster_id', z.rid, 'team', z.team_name, 'division', z.division,
        'wins', z.w, 'losses', z.l, 'ties', z.t, 'pf', z.pf, 'pa', z.pa,
        'median_w', z.mw, 'median_l', z.ml,
        'vampire', league_format(p_league_id) = 'vampire' and is_vampire_seat(p_league_id, z.rid),
        'eliminated', z.eliminated)
      order by z.w desc, case when league_golf(p_league_id) then -z.pf else z.pf end desc, z.rid)
    from (
      select m.sleeper_roster_id as rid, m.team_name, m.division, m.eliminated_week as eliminated,
             coalesce(s.w, 0) as w, coalesce(s.l, 0) as l, coalesce(s.t, 0) as t,
             coalesce(s.pf, 0) as pf, coalesce(s.pa, 0) as pa,
             coalesce(s.mw, 0) as mw, coalesce(s.ml, 0) as ml
      from league_membership m
      left join (
        select x.rid, count(*) filter (where golf_beats(p_league_id, x.us, x.them)) as w,
               count(*) filter (where golf_beats(p_league_id, x.them, x.us)) as l,
               count(*) filter (where x.us = x.them) as t,
               count(*) filter (where not x.pts and golf_beats(p_league_id, x.us, x.them)) as mw,
               count(*) filter (where not x.pts and golf_beats(p_league_id, x.them, x.us)) as ml,
               sum(x.us) filter (where x.pts) as pf, sum(x.them) filter (where x.pts) as pa
        from (
          with fin as (
            select mu.week, mu.home_roster_id as rid, mu.home_final as us, mu.away_final as them
            from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
              and not is_practice_week(mu.week)
              and mu.home_final is not null and mu.away_final is not null
            union all
            select mu.week, mu.away_roster_id, mu.away_final, mu.home_final
            from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
              and not is_practice_week(mu.week)
              and mu.home_final is not null and mu.away_final is not null
          ),
          med as (select week, (percentile_cont(0.5) within group (order by us))::numeric as med from fin group by week)
          select fin.rid, fin.us, fin.them, true as pts from fin
          union all
          select fin.rid, fin.us, med.med, false from fin join med on med.week = fin.week
          where league_median_game(p_league_id)
        ) x group by x.rid
      ) s on s.rid = m.sleeper_roster_id
      where m.league_id = p_league_id
    ) z), '[]'::jsonb);
end $$;
grant execute on function league_standings(uuid) to authenticated;

-- ═══ 5. score edits ══════════════════════════════════════════════════════════
create or replace function commish_week_scores(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  return jsonb_build_object('ok', true, 'week', p_week, 'matchups', coalesce((
    select jsonb_agg(jsonb_build_object(
        'matchup_id', mu.id, 'status', mu.status, 'is_playoff', mu.is_playoff,
        'home_roster_id', mu.home_roster_id, 'home', h.team_name, 'home_final', mu.home_final,
        'away_roster_id', mu.away_roster_id, 'away', a.team_name, 'away_final', mu.away_final)
      order by mu.id)
    from matchup mu
    left join league_membership h on h.league_id = mu.league_id and h.sleeper_roster_id = mu.home_roster_id
    left join league_membership a on a.league_id = mu.league_id and a.sleeper_roster_id = mu.away_roster_id
    where mu.league_id = p_league_id and mu.week = p_week), '[]'::jsonb),
    'weeks', (select coalesce(jsonb_agg(distinct week order by week), '[]'::jsonb) from matchup where league_id = p_league_id));
end $$;
grant execute on function commish_week_scores(uuid, int) to authenticated;

-- A final matchup's score, set by hand. Standings read the finals, so the
-- records follow at once; a playoff round already advanced does not re-pair.
create or replace function commish_set_matchup_score(p_matchup_id uuid, p_home numeric, p_away numeric) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such matchup'); end if;
  if not (is_admin() or is_league_commish(m.league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  if m.status <> 'final' then return jsonb_build_object('ok', false, 'error', 'a score can be edited once the week is final'); end if;
  if p_home is null or p_away is null or p_home < 0 or p_away < 0 or p_home > 10000 or p_away > 10000 then
    return jsonb_build_object('ok', false, 'error', 'scores are numbers, 0 or more');
  end if;
  update matchup set home_final = p_home, away_final = p_away where id = p_matchup_id;
  perform _chat_house(m.league_id,
    '📝 The commissioner set week ' || m.week || ': ' || _txn_team(m.league_id, m.home_roster_id) || ' ' || p_home
      || ' – ' || _txn_team(m.league_id, m.away_roster_id) || ' ' || p_away,
    jsonb_build_object('kind', 'score_edit', 'matchup_id', p_matchup_id, 'week', m.week, 'home', p_home, 'away', p_away));
  return jsonb_build_object('ok', true, 'matchup_id', p_matchup_id, 'home_final', p_home, 'away_final', p_away);
end $$;
grant execute on function commish_set_matchup_score(uuid, numeric, numeric) to authenticated;

-- ═══ 6. dues ═════════════════════════════════════════════════════════════════
create table if not exists league_dues (
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int not null,
  paid       boolean not null default false,
  paid_at    timestamptz,
  note       text,
  primary key (league_id, roster_id)
);
alter table league_dues enable row level security;

create or replace function set_league_dues(p_league_id uuid, p_amount int, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 100000) then return jsonb_build_object('ok', false, 'error', 'dues are $0–$100000'); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('dues_amount', p_amount)
      || case when p_note is null then '{}'::jsonb else jsonb_build_object('dues_note', nullif(trim(p_note), '')) end
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'amount', p_amount);
end $$;
grant execute on function set_league_dues(uuid, int, text) to authenticated;

create or replace function commish_set_dues_paid(p_league_id uuid, p_roster_id int, p_paid boolean, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  if not exists (select 1 from league_membership where league_id = p_league_id and sleeper_roster_id = p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'no such team');
  end if;
  insert into league_dues (league_id, roster_id, paid, paid_at, note)
    values (p_league_id, p_roster_id, coalesce(p_paid, false), case when p_paid then now() end, nullif(trim(coalesce(p_note, '')), ''))
    on conflict (league_id, roster_id) do update
      set paid = excluded.paid, paid_at = excluded.paid_at, note = coalesce(excluded.note, league_dues.note);
  return jsonb_build_object('ok', true, 'roster_id', p_roster_id, 'paid', coalesce(p_paid, false));
end $$;
grant execute on function commish_set_dues_paid(uuid, int, boolean, text) to authenticated;

-- The whole league may read the tracker: who has paid is the point of one.
create or replace function league_dues(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'amount', (select nullif(settings_json ->> 'dues_amount', '')::int from league where id = p_league_id),
    'note', (select settings_json ->> 'dues_note' from league where id = p_league_id),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'enrolled', m.enrolled,
        'paid', coalesce(d.paid, false), 'paid_at', d.paid_at, 'note', d.note)
      order by m.sleeper_roster_id)
      from league_membership m left join league_dues d on d.league_id = m.league_id and d.roster_id = m.sleeper_roster_id
      where m.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function league_dues(uuid) to authenticated;

-- ── roster_rules: 0319's body, reporting the desk ────────────────────────
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
    'pos_caps', league_pos_caps(p_league_id),
    'fa_mode', league_fa_mode(p_league_id),   -- 0287
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'waiver_clear_min', (select nullif(settings_json ->> 'waiver_clear_min', '')::int from league where id = p_league_id),
    'waiver_clear_dow', (select settings_json -> 'waiver_clear_dow' from league where id = p_league_id),
    'fa_after_waivers_dow', (select settings_json -> 'fa_after_waivers_dow' from league where id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1) from league where id = p_league_id),
    'fa_start_min', (select nullif(settings_json ->> 'fa_start_min', '')::int from league where id = p_league_id),
    'fa_end_min', (select nullif(settings_json ->> 'fa_end_min', '')::int from league where id = p_league_id),
    -- The taxi squad's own rules (0196), and whether it is shut right now.
    'taxi_max_exp', (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id),
    'taxi_lock', league_taxi_lock(p_league_id),
    'taxi_locked_now', taxi_is_locked(p_league_id),
    'taxi_lock_at', league_week1_kickoff(p_league_id),
    -- Which designations qualify for an IR spot (0198), so a screen can gate
    -- the button instead of discovering the rule from a red error.
    'ir_tags', to_jsonb(league_ir_tags(p_league_id)),
    -- …and for an OUT spot (0307), the week-to-week sibling.
    'out_tags', to_jsonb(league_out_tags(p_league_id)),
    -- 0213: may unclaimed seats work the wire? The screen needs the CURRENT
    -- value to render the switch, and absent means on, so it cannot be read
    -- off settings_json directly without duplicating that default.
    'agent_waivers', league_agent_waivers(p_league_id),
    -- 0319: the Sleeper parity knobs.
    'faab_min_bid', league_faab_min_bid(p_league_id),
    'fa_dow', (select settings_json -> 'fa_dow' from league where id = p_league_id),
    'trade_deadline_week', league_trade_deadline_week(p_league_id),
    'trade_deadline_passed', trade_deadline_error(p_league_id) is not null,
    -- 0320: the commissioner's desk.
    'wire_lock', league_wire_lock(p_league_id),
    'locked_rosters', (select coalesce(jsonb_agg(sleeper_roster_id order by sleeper_roster_id), '[]'::jsonb)
                         from league_membership where league_id = p_league_id and wire_locked),
    'median_game', league_median_game(p_league_id),
    'dues_amount', (select nullif(settings_json ->> 'dues_amount', '')::int from league where id = p_league_id),
    'dues_note', (select settings_json ->> 'dues_note' from league where id = p_league_id));
end $$;
grant execute on function roster_rules(uuid) to authenticated;

-- ── _native_team_state_for: 0306's body, saying why the wire is shut ─────
create or replace function _native_team_state_for(p_league_id uuid, p_uid uuid, p_commish boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_roster int; d draft%rowtype; mode text;
begin
  select sleeper_roster_id into my_roster from league_membership
    where league_id = p_league_id and app_user_id = p_uid and enrolled
    order by sleeper_roster_id limit 1;
  select * into d from draft where league_id = p_league_id;
  mode := league_waiver_mode(p_league_id);
  return jsonb_build_object(
    'my_roster_id', my_roster,
    -- 0272: the week the guillotine took THIS seat (null while it lives) —
    -- the team desk's own copy, so the wire can say why it is closed.
    'eliminated', (select eliminated_week from league_membership
      where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_team', (select team_name from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_avatar', (select avatar_url from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'league_avatar', (select avatar_url from league l where l.id = p_league_id),
    'is_commish', p_commish,
    -- 0320: why the wire is shut for this seat (a commissioner's lock, the
    -- format's), so the team screen can say so instead of failing an add.
    'wire_block', case when my_roster is not null then wire_block_reason(p_league_id, my_roster) end,
    'draft_status', coalesce(d.status, 'none'),
    'roster_cap', d.rounds,
    -- ACTIVE SEATS (0199): what an ADD is actually bounded by. `roster_cap` is
    -- still the whole roster, stash places included, because that is what the
    -- "MY ROSTER (n/m)" line counts.
    'active_seats', league_active_seats(p_league_id),
    'active_held', case when my_roster is not null then
        (select count(*) from native_roster nr where nr.league_id = p_league_id
           and nr.roster_id = my_roster and nr.spot = 'active') end,
    'pos_caps', league_pos_caps(p_league_id),
    'waiver_mode', mode,
    'trade_review', league_trade_review(p_league_id),
    'my_faab', case when mode = 'faab' and my_roster is not null then member_faab(p_league_id, my_roster) end,
    'roster_issue', case when my_roster is not null then roster_illegal_reason(p_league_id, my_roster) end,
    'fa_open', fa_window_open(p_league_id),
    'fa_start_min', (select nullif(l.settings_json ->> 'fa_start_min', '')::int from league l where l.id = p_league_id),
    'fa_end_min', (select nullif(l.settings_json ->> 'fa_end_min', '')::int from league l where l.id = p_league_id),
    'waiver_clear_min', (select nullif(l.settings_json ->> 'waiver_clear_min', '')::int from league l where l.id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(l.settings_json ->> 'waiver_hold_days', '')::int, 1) from league l where l.id = p_league_id),
    'next_waiver_run', next_waiver_run(p_league_id),   -- 0291
    'waiver_clear_dow', (select l.settings_json -> 'waiver_clear_dow' from league l where l.id = p_league_id),
    'server_now', now(),
    'waiver_order', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'priority', m.waiver_priority,
        'avatar', m.avatar_url,
        'faab', case when mode = 'faab' then member_faab(p_league_id, m.sleeper_roster_id) end)
        order by m.waiver_priority nulls last, m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id),
    'my_claims', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'add_slug', c.add_slug, 'drop_slug', c.drop_slug, 'status', c.status,
        'note', c.note, 'bid', c.bid, 'created_at', c.created_at,
        -- 0289: when this row settles — its own clock if 0288 admitted it,
        -- else the pool hold it is queued behind.
        'clears_at', coalesce(c.clears_at, (select lp.waived_until from league_pool lp
           where lp.league_id = c.league_id and lp.slug = c.add_slug))) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;
