-- 0290: THE LEAGUE HEARS ABOUT IT (v0.405.0).
--
-- Founder: "we need an add/drop log that also includes a waiver report when
-- it runs and a trade report when it happens. All this goes in chat."
--
-- The log itself already exists. league_txn (0186) has recorded every roster
-- movement since the register went in — add, drop, waiver, trade, commish,
-- and a dozen narrower kinds — written by one trigger on native_roster, and
-- league_register reads it back. What it has never done is SAY anything. A
-- register is a thing you go and look at; chat is where a league actually
-- lives, and a trade nobody mentions may as well not have happened.
--
-- So this posts. Not a second log: the same events, announced.
--
-- WHY NOT THE TRIGGER. The obvious move is to hang this off the same
-- native_roster trigger that feeds the register, and it is wrong, because the
-- trigger fires per ROW and the founder asked for per EVENT. A waiver run
-- that settles five claims is one report, not five lines. A trade is one
-- sentence, not four roster updates. An add that carries a drop is "added X,
-- dropped Y" on one line, not two lines that read like two separate moves.
-- Only the RPC knows where an event begins and ends, so the announcements are
-- posted from the four places that know: add_free_agent, drop_player,
-- process_waivers and execute_trade.
--
-- THE HOUSE VOICE already exists too. 0275 taught league_message that a null
-- author_id is "Drip Fantasy" so the weekly report could post, but only the
-- Node worker ever used it, with the service role and a direct insert. There
-- has never been a SQL-side way to post as the house. _chat_house is that,
-- and it is revoked from everyone so only a definer function can reach it.

-- ── the column and the kind ───────────────────────────────────────────────
-- Same shape 0275 used for the weekly report: a kind, a paired payload column,
-- and a check that keeps the two honest with each other.
alter table league_message add column if not exists txn jsonb;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'league_message'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table league_message drop constraint %I', c.conname);
  end loop;
end $$;
alter table league_message add constraint league_message_kind_check
  check (kind in ('text', 'poll', 'report', 'txn'));
-- AND PUT BACK WHAT THE SWEEP TOOK WITH IT. That loop drops every check whose
-- definition mentions `kind`, which is how 0275 widened the kinds — but 0275's
-- OWN paired check, ((kind = 'report') = (report_week is not null)), says
-- `kind` too, so the sweep eats it. Re-added here rather than left to a later
-- migration to notice: without it a report line could go in with no week and a
-- text line could carry one, and the week-report probe is what caught it.
alter table league_message drop constraint if exists league_message_report_week_check;
alter table league_message add constraint league_message_report_week_check
  check ((kind = 'report') = (report_week is not null));
alter table league_message drop constraint if exists league_message_txn_check;
alter table league_message add constraint league_message_txn_check
  check ((kind = 'txn') = (txn is not null));

-- ── posting as the house ──────────────────────────────────────────────────
-- The 500-character cap is the one chat_post enforces through _chat_clean_body
-- (0147); a trade between two deep rosters is the line most likely to test it,
-- and a truncated sentence beats a failed transaction. An empty body posts
-- nothing rather than an empty bubble.
create or replace function _chat_house(p_league_id uuid, p_body text, p_txn jsonb)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if p_body is null or btrim(p_body) = '' then return; end if;
  insert into league_message (league_id, author_id, kind, body, txn, mentions)
  values (p_league_id, null, 'txn', left(btrim(p_body), 500), coalesce(p_txn, '{}'::jsonb), '{}');
end $$;
revoke all on function _chat_house(uuid, text, jsonb) from public, anon, authenticated;

-- ── names, not slugs ──────────────────────────────────────────────────────
-- Read from league_pool and league_membership rather than from the roster, so
-- a line still names a player who has just been dropped or traded away, and a
-- seat nobody has named still reads as something ("Team 4", not "null").
create or replace function _txn_player(p_league_id uuid, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(full_name, '') from league_pool
                    where league_id = p_league_id and slug = p_slug), p_slug);
$$;
create or replace function _txn_team(p_league_id uuid, p_roster int) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(team_name, '') from league_membership
                    where league_id = p_league_id and sleeper_roster_id = p_roster),
                  'Team ' || p_roster);
$$;
create or replace function _txn_players(p_league_id uuid, p_slugs jsonb) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(_txn_player(p_league_id, s.value), ', '), 'nobody')
  from jsonb_array_elements_text(coalesce(p_slugs, '[]'::jsonb)) s;
$$;
grant execute on function _txn_player(uuid, text) to authenticated;
grant execute on function _txn_team(uuid, int) to authenticated;
grant execute on function _txn_players(uuid, jsonb) to authenticated;

-- ── _chat_message_json v4: a transaction carries its payload ──────────────
-- Body is 0275's with one branch added, so the pins strip and every other
-- caller pick it up unchanged.
create or replace function _chat_message_json(m league_message, me uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'body', m.body, 'at', m.created_at,
    'author', case when m.author_id is null then 'Drip Fantasy' else _chat_display_name(m.league_id, m.author_id) end,
    'author_id', m.author_id,
    'mine', coalesce(m.author_id = me, false),
    'kind', m.kind,
    'pinned', m.pinned,
    'mentions_me', coalesce(me = any(m.mentions), false),
    'reactions', _chat_reactions_json(m.id, me))
  || case when m.kind = 'poll' then jsonb_build_object('poll', jsonb_build_object(
       'options', (select coalesce(jsonb_agg(jsonb_build_object(
                      'text', o.opt,
                      'votes', (select count(*) from poll_vote v where v.message_id = m.id and v.choice = o.i)
                    ) order by o.i), '[]'::jsonb)
                    from (select opt, (row_number() over ()) - 1 as i
                            from jsonb_array_elements_text(m.poll) opt) o),
       'total', (select count(*) from poll_vote v where v.message_id = m.id),
       'mine', (select v.choice from poll_vote v where v.message_id = m.id and v.app_user_id = me)))
     when m.kind = 'report' then jsonb_build_object('report', jsonb_build_object('week', m.report_week))
     when m.kind = 'txn' then jsonb_build_object('txn', m.txn)
     else '{}'::jsonb end;
$$;

-- ── drop_player: 0072's body, with the announcement ──────────────────────
create or replace function drop_player(p_league_id uuid, p_roster_id int, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'complete') then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
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

-- ── add_free_agent: 0289's body, with the announcement ───────────────────
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
  err := wire_block_reason(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
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
    return jsonb_build_object('ok', false, 'error', 'free agency is closed — open '
      || fmt_et_min((select (settings_json ->> 'fa_start_min')::int from league where id = p_league_id)) || ' to '
      || fmt_et_min((select (settings_json ->> 'fa_end_min')::int from league where id = p_league_id)));
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
  if exists (select 1 from waiver_claim wc
               left join league_pool lp2 on lp2.league_id = wc.league_id and lp2.slug = wc.add_slug
              where wc.league_id = p_league_id and wc.add_slug = p_add_slug and wc.status = 'pending'
                and coalesce(wc.clears_at, lp2.waived_until, now()) <= now()) then
    perform process_waivers(p_league_id);
  end if;
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
grant execute on function add_free_agent(uuid, int, text, text) to authenticated;

-- ── process_waivers: 0289's body, with the run's report ──────────────────
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; d draft%rowtype; won int := 0; lost int := 0; changed boolean := false;
  err text; mode text; took text[]; missed text[];
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return jsonb_build_object('ok', true, 'won', 0, 'lost', 0); end if;
  mode := league_waiver_mode(p_league_id);

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
      and coalesce(wc.clears_at, lp.waived_until, now()) <= now()
    order by case when mode = 'faab' then -wc.bid else 0 end,
             case when mode = 'standings' then coalesce(sr.rank, 0) else 0 end,
             m.waiver_priority nulls last, wc.created_at
  loop
    -- 0144: a commissioner flag set while the claim sat pending kills it with
    -- a clear note — the roster trigger would otherwise abort the whole sweep.
    if flag_rule_blocks(p_league_id, c.add_slug, 'no_add') is not null then
      update waiver_claim set status = 'lost', note = 'player flagged by the commissioner', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = c.add_slug) then
      update waiver_claim set status = 'lost', note = case when mode = 'faab' then 'outbid' else 'player taken' end,
        processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if c.drop_slug is not null and not exists (select 1 from native_roster
        where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug) then
      update waiver_claim set status = 'lost', note = 'drop player no longer on roster', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
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
    update waiver_claim set status = 'won', processed_at = now() where id = c.id;
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
grant execute on function process_waivers(uuid) to authenticated;

-- ── execute_trade: 0222's body, with the trade report ────────────────────
create or replace function execute_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; err text; el jsonb; lseas text; ov int; knd text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if exists (select 1 from jsonb_array_elements_text(t.give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.from_roster and nr.slug = s.slug))
     or exists (select 1 from jsonb_array_elements_text(t.get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
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
              then ' · $' || abs(t.cap_dollars) || ' cap' else '' end,
    jsonb_build_object('kind', 'trade', 'from_roster', t.from_roster, 'to_roster', t.to_roster,
                       'give', t.give, 'get', t.get));
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true);
end $$;
grant execute on function execute_trade(uuid) to authenticated;
