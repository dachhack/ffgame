-- 0453: SHOTGUN WEDDING (v0.653.0) — docs/shotgun-wedding.md.
--
-- Founder: "a fantasy mode like vampire where after each weekly matchup early
-- AM Tuesday the CPU creates a fair, 4 total player trade from opposing
-- teams. The trade is auto accepted by both teams by 8 pm EST unless the team
-- that won the matchup declines the trade. Teams can negotiate the trade but
-- unless they come to an agreement, the original trade goes through. Players
-- chosen for the original trade are locked from all roster movement until
-- after the deadline." Then: "Shotgun wedding. Let's build it for redraft
-- classic only."
--
-- THE SHAPE
--   · The worker (server/src/shotgun.js) picks the 2-for-2 — core's
--     weddingPlan, fair by the trade grader's own "close to even" band — and
--     files it here with shotgun_propose. One wedding per matchup per week.
--   · Until the deadline (8 PM Eastern, the same Tuesday) the four players
--     cannot move: no drop, no trade, no waiver drop, no IR or taxi move. The
--     commissioner's force-moves still work, as under every lock.
--   · The WINNER may call it off (shotgun_decline). A tie has no winner, so
--     nobody can.
--   · Either team may propose new vows (shotgun_counter); if the other says
--     yes (shotgun_accept_counter) that trade happens at once and replaces
--     the original. Without an agreement the original goes through at the
--     deadline (shotgun_sweep, from the worker).
--   · Every step posts a card to the league chat.
--
-- WHERE IT MAY BE ON: a classic, redraft, head-to-head (format standard) NFL
-- league. set_league_shotgun refuses anything else, and the proposer checks
-- again every week, so a league that changes underneath it simply stops
-- getting weddings.

-- ── the record ─────────────────────────────────────────────────────────────
create table if not exists shotgun_wedding (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references league(id) on delete cascade,
  week          int  not null,
  home_roster   int  not null,
  away_roster   int  not null,
  home_score    numeric,
  away_score    numeric,
  -- The seat that may call it off; null on a tie.
  winner        int,
  home_gives    jsonb not null,
  away_gives    jsonb not null,
  deadline      timestamptz not null,
  status        text not null default 'pending'
                check (status in ('pending', 'declined', 'married', 'renegotiated', 'failed', 'annulled')),
  -- The latest new vows on the table, and who offered them.
  counter_from        int,
  counter_home_gives  jsonb,
  counter_away_gives  jsonb,
  counter_at          timestamptz,
  trade_id      uuid references trade_proposal(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  settled_at    timestamptz,
  unique (league_id, week, home_roster)
);
create index if not exists shotgun_wedding_open on shotgun_wedding(status, deadline);
-- The lock is asked on every roster move in every league; this keeps it one
-- index probe (and an empty one in any league with nothing pending).
create index if not exists shotgun_wedding_pending on shotgun_wedding(league_id) where status = 'pending';
alter table shotgun_wedding enable row level security;
-- No policies: read through shotgun_state, written through the RPCs below.

-- ── the switch ─────────────────────────────────────────────────────────────
create or replace function league_shotgun(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select (settings_json ->> 'shotgun_wedding')::boolean from league where id = p_league_id), false);
$$;
grant execute on function league_shotgun(uuid) to authenticated;

/** Why this league can't hold weddings, or null when it can. */
create or replace function _shotgun_ineligible(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic'
      then 'Shotgun Wedding is a classic-league mode'
    when league_sport(p_league_id) <> 'nfl' then 'Shotgun Wedding is a football mode'
    when league_continuity(p_league_id) <> 'redraft' then 'Shotgun Wedding is for redraft leagues — a forced trade has no place in a keeper or dynasty build'
    when league_format(p_league_id) <> 'standard' then 'Shotgun Wedding needs head-to-head matchups — not guillotine or vampire'
  end;
$$;

-- ── names for the cards ────────────────────────────────────────────────────
create or replace function _wedding_side(p_league_id uuid, p_roster int, p_slugs jsonb) returns text
  language sql stable security definer set search_path = public as $$
  select _txn_team(p_league_id, p_roster) || ' sends ' || _txn_players(p_league_id, p_slugs);
$$;
create or replace function _wedding_players_json(p_league_id uuid, p_slugs jsonb) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', s.value, 'name', coalesce(lp.full_name, s.value),
                                               'pos', lp.pos, 'team', lp.team) order by s.ord), '[]'::jsonb)
    from jsonb_array_elements_text(coalesce(p_slugs, '[]'::jsonb)) with ordinality s(value, ord)
    left join league_pool lp on lp.league_id = p_league_id and lp.slug = s.value;
$$;

-- ── the lock ───────────────────────────────────────────────────────────────
/** Why this player can't move because of a wedding, or null. */
create or replace function _wedding_lock(p_league_id uuid, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select '💍 ' || _txn_player(p_league_id, p_slug) || ' is in a Shotgun Wedding — he stays put until it''s settled ('
         || to_char(w.deadline at time zone 'America/New_York', 'FMHH12 AM') || ' ET ' || trim(to_char(w.deadline at time zone 'America/New_York', 'Day')) || ')'
    from shotgun_wedding w
   where w.league_id = p_league_id and w.status = 'pending'
     and (w.home_gives ? p_slug or w.away_gives ? p_slug)
   limit 1;
$$;
grant execute on function _wedding_lock(uuid, text) to authenticated;

-- drop_lock_reason (0433) is what drop_player, add_free_agent, the waiver
-- claim and the waiver run ask before a player leaves a roster. The wedding
-- is asked first; the rest is 0433's body unchanged.
create or replace function drop_lock_reason(p_league_id uuid, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(_wedding_lock(p_league_id, p_slug), case
    when league_sport(p_league_id) <> 'nfl' then
      case when sport_slug_started(p_league_id, p_slug)
           then _txn_player(p_league_id, p_slug) || '''s game has started — he can''t be dropped until tomorrow' end
    when coalesce(classic_kickoff_for(p_league_id, league_live_week(p_league_id), p_slug) <= now(), false)
      then _txn_player(p_league_id, p_slug) || '''s game has started — he can''t be dropped until the week ends'
  end);
$$;

-- The catch-all: whatever path tries to move a wedded player off his roster
-- or into another spot (IR, taxi, out) is refused at the row. The wedding's
-- own execution sets app.wedding; the commissioner's force-moves pass, as
-- they do under every lock; a league being deleted passes.
create or replace function _wedding_roster_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare why text;
begin
  if coalesce(current_setting('app.wedding', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.roster_id = old.roster_id and new.spot is not distinct from old.spot then return new; end if;
  -- The wedding first (one index probe); the exemptions only when it bites.
  why := _wedding_lock(old.league_id, old.slug);
  if why is null then return coalesce(new, old); end if;
  if not exists (select 1 from league where id = old.league_id) then return coalesce(new, old); end if;
  if auth.uid() is not null and (is_league_commish(old.league_id) or is_admin()) then return coalesce(new, old); end if;
  raise exception '%', why using errcode = 'P0001';
end $$;
drop trigger if exists wedding_roster_guard on native_roster;
create trigger wedding_roster_guard before update of roster_id, spot or delete on native_roster
  for each row execute function _wedding_roster_guard();

-- An offer naming a wedded player is refused when it is made — not left to
-- fail at accept with "players moved".
create or replace function _wedding_trade_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare why text;
begin
  if coalesce(current_setting('app.wedding', true), '') = 'on' then return new; end if;
  if tg_table_name = 'trade_proposal' then
    if new.status not in ('pending', 'accepted', 'review') then return new; end if;
    select _wedding_lock(new.league_id, s.value) into why
      from jsonb_array_elements_text(coalesce(new.give, '[]'::jsonb) || coalesce(new.get, '[]'::jsonb)) s
     where _wedding_lock(new.league_id, s.value) is not null limit 1;
  else
    select _wedding_lock(new.league_id, e ->> 'slug') into why
      from jsonb_array_elements(coalesce(new.send, '[]'::jsonb)) e
     where _wedding_lock(new.league_id, e ->> 'slug') is not null limit 1;
  end if;
  if why is not null then raise exception '%', why using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists wedding_trade_guard on trade_proposal;
create trigger wedding_trade_guard before insert on trade_proposal
  for each row execute function _wedding_trade_guard();
drop trigger if exists wedding_leg_guard on trade_leg;
create trigger wedding_leg_guard before insert on trade_leg
  for each row execute function _wedding_trade_guard();

-- ── carrying out a trade the wedding agreed ────────────────────────────────
-- Files the trade as an accepted proposal and hands it to execute_trade
-- (0336), so the roster move, the cap check, the txn register, the lineup
-- reset and the "🤝 Trade" chat line are the trade system's own.
create or replace function _wedding_execute(p_wedding uuid, p_home_gives jsonb, p_away_gives jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype; tid uuid; res jsonb;
begin
  select * into w from shotgun_wedding where id = p_wedding;
  perform set_config('app.wedding', 'on', true);
  begin
    insert into trade_proposal (league_id, from_roster, to_roster, give, get, status, note, created_by, responded_at)
      values (w.league_id, w.home_roster, w.away_roster, p_home_gives, p_away_gives, 'accepted',
              '💍 Shotgun Wedding', auth.uid(), now())
      returning id into tid;
    res := execute_trade(tid);
    if coalesce((res ->> 'ok')::boolean, false) is not true then
      raise exception '%', coalesce(res ->> 'error', 'the trade could not go through');
    end if;
  exception when others then
    perform set_config('app.wedding', '', true);
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  perform set_config('app.wedding', '', true);
  return jsonb_build_object('ok', true, 'trade_id', tid);
end $$;
revoke all on function _wedding_execute(uuid, jsonb, jsonb) from public, anon, authenticated;

-- ── the worker files a wedding ─────────────────────────────────────────────
create or replace function shotgun_propose(p_league_id uuid, p_week int, p_home int, p_away int,
                                           p_home_gives jsonb, p_away_gives jsonb, p_deadline timestamptz default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare mu matchup%rowtype; why text; dl timestamptz; win int; wid uuid; s text; cancelled int := 0;
        slugs text[];
begin
  if not league_shotgun(p_league_id) then return jsonb_build_object('ok', false, 'error', 'shotgun wedding is off'); end if;
  why := coalesce(_shotgun_ineligible(p_league_id), trade_deadline_error(p_league_id));
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  select * into mu from matchup where league_id = p_league_id and week = p_week
     and home_roster_id = p_home and away_roster_id = p_away;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such matchup'); end if;
  if mu.status <> 'final' or mu.home_final is null or mu.away_final is null then
    return jsonb_build_object('ok', false, 'error', 'that matchup is not final yet');
  end if;
  if coalesce(mu.is_playoff, false) or is_practice_week(p_week) then
    return jsonb_build_object('ok', false, 'error', 'weddings are for regular-season weeks');
  end if;
  if jsonb_typeof(p_home_gives) <> 'array' or jsonb_typeof(p_away_gives) <> 'array'
     or jsonb_array_length(p_home_gives) <> 2 or jsonb_array_length(p_away_gives) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'a wedding is two players each way');
  end if;
  for s in select value from jsonb_array_elements_text(p_home_gives) loop
    if not exists (select 1 from native_roster where league_id = p_league_id and roster_id = p_home and slug = s and spot = 'active') then
      return jsonb_build_object('ok', false, 'error', s || ' is not on the home active roster');
    end if;
  end loop;
  for s in select value from jsonb_array_elements_text(p_away_gives) loop
    if not exists (select 1 from native_roster where league_id = p_league_id and roster_id = p_away and slug = s and spot = 'active') then
      return jsonb_build_object('ok', false, 'error', s || ' is not on the away active roster');
    end if;
  end loop;
  if exists (select 1 from shotgun_wedding where league_id = p_league_id and week = p_week and home_roster = p_home) then
    return jsonb_build_object('ok', false, 'error', 'already married this week');
  end if;
  -- 8 PM Eastern, the day it is filed (the worker files it Tuesday morning).
  dl := coalesce(p_deadline,
        ((now() at time zone 'America/New_York')::date + time '20:00') at time zone 'America/New_York');
  if dl < now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'error', 'too late in the day — a wedding needs time to talk');
  end if;
  win := case when golf_beats(p_league_id, mu.home_final, mu.away_final) then p_home
              when golf_beats(p_league_id, mu.away_final, mu.home_final) then p_away end;
  insert into shotgun_wedding (league_id, week, home_roster, away_roster, home_score, away_score, winner,
                               home_gives, away_gives, deadline)
    values (p_league_id, p_week, p_home, p_away, mu.home_final, mu.away_final, win,
            p_home_gives, p_away_gives, dl)
    returning id into wid;

  -- Any open offer naming one of the four is off: they are spoken for.
  slugs := array(select value from jsonb_array_elements_text(p_home_gives || p_away_gives));
  with gone as (
    update trade_proposal t set status = 'cancelled', resolved_at = now()
     where t.league_id = p_league_id and t.status in ('pending', 'accepted', 'review')
       and (t.give ?| slugs or t.get ?| slugs
            or exists (select 1 from trade_leg l, jsonb_array_elements(l.send) e
                        where l.trade_id = t.id and e ->> 'slug' = any (slugs)))
    returning 1)
  select count(*) into cancelled from gone;

  perform _chat_house(p_league_id,
    '💍 Shotgun Wedding — ' || _wedding_side(p_league_id, p_home, p_home_gives) || '; '
      || _wedding_side(p_league_id, p_away, p_away_gives) || '. It goes through at '
      || to_char(dl at time zone 'America/New_York', 'FMHH12 AM') || ' ET '
      || case when win is null then 'unless they agree on new vows — it was a tie, so nobody can call it off.'
              else 'unless ' || _txn_team(p_league_id, win) || ', who won, calls it off.' end
      || case when cancelled > 0 then ' Open offers naming these players were cancelled.' else '' end,
    jsonb_build_object('kind', 'wedding', 'wedding_id', wid, 'week', p_week));
  return jsonb_build_object('ok', true, 'wedding_id', wid, 'winner', win, 'deadline', dl, 'cancelled', cancelled);
end $$;
revoke all on function shotgun_propose(uuid, int, int, int, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function shotgun_propose(uuid, int, int, int, jsonb, jsonb, timestamptz) to service_role;

-- ── the winner calls it off ────────────────────────────────────────────────
create or replace function shotgun_decline(p_wedding_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype; loser int;
begin
  select * into w from shotgun_wedding where id = p_wedding_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such wedding'); end if;
  if w.winner is null then return jsonb_build_object('ok', false, 'error', 'it was a tie — nobody can call this one off'); end if;
  if not owns_roster(w.league_id, w.winner) then
    return jsonb_build_object('ok', false, 'error', 'only the team that won can call it off');
  end if;
  if w.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'this wedding is already settled'); end if;
  if w.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'too late — the deadline has passed'); end if;
  update shotgun_wedding set status = 'declined', settled_at = now() where id = w.id;
  loser := case when w.winner = w.home_roster then w.away_roster else w.home_roster end;
  perform _chat_house(w.league_id,
    '💔 ' || _txn_team(w.league_id, w.winner) || ' called off the wedding with ' || _txn_team(w.league_id, loser)
      || '. Everyone keeps their players.',
    jsonb_build_object('kind', 'wedding', 'wedding_id', w.id, 'week', w.week));
  return jsonb_build_object('ok', true, 'status', 'declined');
end $$;
grant execute on function shotgun_decline(uuid) to authenticated;

-- ── new vows ───────────────────────────────────────────────────────────────
-- Either team may put a different trade on the table. It replaces any vows
-- already there (so a reply to a reply is just another call). One to three
-- players each way, from the two active rosters.
create or replace function shotgun_counter(p_wedding_id uuid, p_home_gives jsonb, p_away_gives jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype; me int; other int; s text; nh int; na int;
begin
  select * into w from shotgun_wedding where id = p_wedding_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such wedding'); end if;
  me := case when owns_roster(w.league_id, w.home_roster) then w.home_roster
             when owns_roster(w.league_id, w.away_roster) then w.away_roster end;
  if me is null then return jsonb_build_object('ok', false, 'error', 'only the two teams in this wedding can talk terms'); end if;
  if w.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'this wedding is already settled'); end if;
  if w.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'too late — the deadline has passed'); end if;
  nh := case when jsonb_typeof(p_home_gives) = 'array' then jsonb_array_length(p_home_gives) else 0 end;
  na := case when jsonb_typeof(p_away_gives) = 'array' then jsonb_array_length(p_away_gives) else 0 end;
  if nh < 1 or nh > 3 or na < 1 or na > 3 then
    return jsonb_build_object('ok', false, 'error', 'new vows are one to three players each way');
  end if;
  if p_home_gives @> w.home_gives and w.home_gives @> p_home_gives
     and p_away_gives @> w.away_gives and w.away_gives @> p_away_gives then
    return jsonb_build_object('ok', false, 'error', 'that is the original trade — it goes through on its own');
  end if;
  for s in select value from jsonb_array_elements_text(p_home_gives) loop
    if not exists (select 1 from native_roster where league_id = w.league_id and roster_id = w.home_roster and slug = s and spot = 'active') then
      return jsonb_build_object('ok', false, 'error', _txn_player(w.league_id, s) || ' is not on ' || _txn_team(w.league_id, w.home_roster) || '''s active roster');
    end if;
  end loop;
  for s in select value from jsonb_array_elements_text(p_away_gives) loop
    if not exists (select 1 from native_roster where league_id = w.league_id and roster_id = w.away_roster and slug = s and spot = 'active') then
      return jsonb_build_object('ok', false, 'error', _txn_player(w.league_id, s) || ' is not on ' || _txn_team(w.league_id, w.away_roster) || '''s active roster');
    end if;
  end loop;
  update shotgun_wedding set counter_from = me, counter_home_gives = p_home_gives, counter_away_gives = p_away_gives,
                             counter_at = now()
   where id = w.id;
  other := case when me = w.home_roster then w.away_roster else w.home_roster end;
  perform _chat_house(w.league_id,
    '💍 ' || _txn_team(w.league_id, me) || ' proposed new vows to ' || _txn_team(w.league_id, other) || ': '
      || _wedding_side(w.league_id, w.home_roster, p_home_gives) || '; '
      || _wedding_side(w.league_id, w.away_roster, p_away_gives) || '. If '
      || _txn_team(w.league_id, other) || ' says yes, it replaces the original.',
    jsonb_build_object('kind', 'wedding', 'wedding_id', w.id, 'week', w.week));
  return jsonb_build_object('ok', true, 'counter_from', me);
end $$;
grant execute on function shotgun_counter(uuid, jsonb, jsonb) to authenticated;

create or replace function shotgun_accept_counter(p_wedding_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype; me int; res jsonb;
begin
  select * into w from shotgun_wedding where id = p_wedding_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such wedding'); end if;
  if w.counter_from is null then return jsonb_build_object('ok', false, 'error', 'no new vows on the table'); end if;
  me := case when w.counter_from = w.home_roster then w.away_roster else w.home_roster end;
  if not owns_roster(w.league_id, me) then
    return jsonb_build_object('ok', false, 'error', 'only ' || _txn_team(w.league_id, me) || ' can say yes to these vows');
  end if;
  if w.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'this wedding is already settled'); end if;
  if w.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'too late — the deadline has passed'); end if;
  res := _wedding_execute(w.id, w.counter_home_gives, w.counter_away_gives);
  if coalesce((res ->> 'ok')::boolean, false) is not true then
    -- The original still stands; tell them why the new vows didn't work.
    return jsonb_build_object('ok', false, 'error', res ->> 'error');
  end if;
  update shotgun_wedding set status = 'renegotiated', settled_at = now(), trade_id = (res ->> 'trade_id')::uuid
   where id = w.id;
  perform _chat_house(w.league_id,
    '💍 ' || _txn_team(w.league_id, w.home_roster) || ' and ' || _txn_team(w.league_id, w.away_roster)
      || ' agreed on their own vows — the original is off.',
    jsonb_build_object('kind', 'wedding', 'wedding_id', w.id, 'week', w.week));
  return jsonb_build_object('ok', true, 'status', 'renegotiated', 'trade_id', res ->> 'trade_id');
end $$;
grant execute on function shotgun_accept_counter(uuid) to authenticated;

-- ── the deadline ───────────────────────────────────────────────────────────
create or replace function shotgun_sweep() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare w shotgun_wedding%rowtype; res jsonb; married int := 0; failed int := 0;
begin
  for w in select * from shotgun_wedding where status = 'pending' and deadline <= now() order by deadline for update skip locked loop
    res := _wedding_execute(w.id, w.home_gives, w.away_gives);
    if coalesce((res ->> 'ok')::boolean, false) then
      update shotgun_wedding set status = 'married', settled_at = now(), trade_id = (res ->> 'trade_id')::uuid where id = w.id;
      perform _chat_house(w.league_id,
        '💍 Just married — ' || _txn_team(w.league_id, w.home_roster) || ' and ' || _txn_team(w.league_id, w.away_roster)
          || '''s Shotgun Wedding went through.',
        jsonb_build_object('kind', 'wedding', 'wedding_id', w.id, 'week', w.week));
      married := married + 1;
    else
      update shotgun_wedding set status = 'failed', settled_at = now(), note = res ->> 'error' where id = w.id;
      perform _chat_house(w.league_id,
        '💍 The wedding between ' || _txn_team(w.league_id, w.home_roster) || ' and ' || _txn_team(w.league_id, w.away_roster)
          || ' couldn''t go through (' || coalesce(res ->> 'error', 'unknown') || '). Everyone keeps their players.',
        jsonb_build_object('kind', 'wedding', 'wedding_id', w.id, 'week', w.week));
      failed := failed + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'married', married, 'failed', failed);
end $$;
revoke all on function shotgun_sweep() from public, anon, authenticated;
grant execute on function shotgun_sweep() to service_role;

-- ── the commissioner's switch ──────────────────────────────────────────────
create or replace function set_league_shotgun(p_league_id uuid, p_on boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare why text; was boolean; n int := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  was := league_shotgun(p_league_id);
  if coalesce(p_on, false) then
    why := _shotgun_ineligible(p_league_id);
    if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('shotgun_wedding', coalesce(p_on, false))
   where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if coalesce(p_on, false) and not was then
    perform _chat_house(p_league_id,
      '💍 Shotgun Wedding is on. Every Tuesday morning each matchup''s two teams are handed a fair 2-for-2 trade. '
        || 'It goes through at 8 PM ET unless the winner calls it off or the two agree on new vows. '
        || 'The four players can''t move until then.',
      jsonb_build_object('kind', 'wedding'));
  elsif not coalesce(p_on, false) and was then
    with off as (update shotgun_wedding set status = 'annulled', settled_at = now()
                  where league_id = p_league_id and status = 'pending' returning 1)
    select count(*) into n from off;
    perform _chat_house(p_league_id,
      '💍 Shotgun Wedding is off.' || case when n > 0 then ' This week''s weddings are annulled — everyone keeps their players.' else '' end,
      jsonb_build_object('kind', 'wedding'));
  end if;
  return jsonb_build_object('ok', true, 'shotgun_wedding', coalesce(p_on, false), 'annulled', n);
end $$;
grant execute on function set_league_shotgun(uuid, boolean) to authenticated;

-- ── the reader ─────────────────────────────────────────────────────────────
-- The latest week that has weddings (or the week asked), every wedding in
-- it, and for the caller's own: which seat is theirs, what they may do, and
-- both active rosters so the app can compose new vows.
create or replace function shotgun_state(p_league_id uuid, p_week int default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare wk int; out jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  wk := coalesce(p_week, (select max(week) from shotgun_wedding where league_id = p_league_id));
  select coalesce(jsonb_agg(x.j order by x.mine desc, x.home_roster), '[]'::jsonb) into out from (
    select w.home_roster,
           (owns_roster(w.league_id, w.home_roster) or owns_roster(w.league_id, w.away_roster)) as mine,
           jsonb_build_object(
             'id', w.id, 'week', w.week, 'status', w.status, 'deadline', w.deadline, 'note', w.note,
             'home', jsonb_build_object('roster', w.home_roster, 'team', _txn_team(w.league_id, w.home_roster),
                                        'score', w.home_score, 'gives', _wedding_players_json(w.league_id, w.home_gives)),
             'away', jsonb_build_object('roster', w.away_roster, 'team', _txn_team(w.league_id, w.away_roster),
                                        'score', w.away_score, 'gives', _wedding_players_json(w.league_id, w.away_gives)),
             'winner', w.winner,
             'counter', case when w.counter_from is null then null else jsonb_build_object(
                 'from', w.counter_from, 'at', w.counter_at,
                 'home_gives', _wedding_players_json(w.league_id, w.counter_home_gives),
                 'away_gives', _wedding_players_json(w.league_id, w.counter_away_gives)) end,
             'my_seat', case when owns_roster(w.league_id, w.home_roster) then w.home_roster
                             when owns_roster(w.league_id, w.away_roster) then w.away_roster end,
             'can_decline', w.status = 'pending' and w.deadline > now() and w.winner is not null
                            and owns_roster(w.league_id, w.winner),
             'can_counter', w.status = 'pending' and w.deadline > now()
                            and (owns_roster(w.league_id, w.home_roster) or owns_roster(w.league_id, w.away_roster)),
             'can_accept', w.status = 'pending' and w.deadline > now() and w.counter_from is not null
                           and owns_roster(w.league_id, case when w.counter_from = w.home_roster then w.away_roster else w.home_roster end),
             'rosters', case when w.status = 'pending'
                              and (owns_roster(w.league_id, w.home_roster) or owns_roster(w.league_id, w.away_roster))
               then jsonb_build_object(
                 'home', (select coalesce(jsonb_agg(jsonb_build_object('slug', nr.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team)
                                                    order by lp.rank), '[]'::jsonb)
                            from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
                           where nr.league_id = w.league_id and nr.roster_id = w.home_roster and nr.spot = 'active'),
                 'away', (select coalesce(jsonb_agg(jsonb_build_object('slug', nr.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team)
                                                    order by lp.rank), '[]'::jsonb)
                            from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
                           where nr.league_id = w.league_id and nr.roster_id = w.away_roster and nr.spot = 'active'))
               end) as j
      from shotgun_wedding w where w.league_id = p_league_id and w.week = wk) x;
  return jsonb_build_object('ok', true, 'on', league_shotgun(p_league_id),
    'eligible', _shotgun_ineligible(p_league_id) is null, 'why_not', _shotgun_ineligible(p_league_id),
    'week', wk, 'weddings', out);
end $$;
grant execute on function shotgun_state(uuid, int) to authenticated, service_role;
