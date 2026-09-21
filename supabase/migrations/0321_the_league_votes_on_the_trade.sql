-- 0321: THE TRADE FLOOR — the league votes, an offer expires, a counter comes
-- back, and FAAB moves like a pick.
--
-- docs/competitor-gap-analysis.md put trade parity first: "Every platform
-- except FFPC has the first two." Four of that list land here; multi-team
-- trades are the fifth and a round of their own.
--
--   1. THE LEAGUE VOTE. trade_review joins a third mode, 'league'. An accepted
--      trade goes to 'review' for trade_review_hours, every UNINVOLVED seat may
--      cast a veto or an allow, and the trade dies the moment the vetoes reach
--      trade_veto_votes (default: a majority of the uninvolved seats). Nobody
--      objecting enough by the deadline — or everyone having voted and the
--      veto no longer reachable — executes it. The commissioner may still rule
--      over the top of a vote in progress.
--   2. EXPIRY. An offer may carry its own clock (p_expires_hours), or take the
--      league's default (trade_offer_days). An expired offer cannot be
--      accepted, and the sweep marks it so the list says why it went quiet.
--   3. COUNTERS. counter_trade answers an offer with an offer: the original
--      goes to 'countered' and the mirrored proposal is filed from the other
--      seat in the same transaction, carrying `counters` back to the first so
--      a negotiation reads as a thread instead of two unrelated rows.
--   4. FAAB AS AN ASSET. faab_dollars rides a proposal the way cap dollars
--      have since 0219 (+ = the proposer sends, − = the proposer asks). FAAB
--      leagues only, behind the commissioner's faab_trading switch, checked
--      against the sender's remaining budget at the offer AND at execution —
--      a week of waivers can run between the two.
--
-- The worker calls trade_sweep() (server/src/native.js): a review window that
-- closed and an offer that expired both need a clock nobody is watching.

-- ═══ 1. the columns ══════════════════════════════════════════════════════════
alter table trade_proposal add column if not exists faab_dollars int;
alter table trade_proposal add column if not exists expires_at   timestamptz;
alter table trade_proposal add column if not exists review_until timestamptz;
-- The offer this one answers. `on delete set null` rather than cascade: a
-- counter outlives the offer it replaced even if that row is ever swept.
alter table trade_proposal add column if not exists counters uuid references trade_proposal(id) on delete set null;

-- Three new resting places: out for a vote, timed out, answered with an offer.
alter table trade_proposal drop constraint if exists trade_proposal_status_check;
alter table trade_proposal add constraint trade_proposal_status_check
  check (status in ('pending', 'accepted', 'review', 'executed', 'rejected',
                    'cancelled', 'vetoed', 'expired', 'countered'));
create index if not exists trade_proposal_clock on trade_proposal(status, expires_at, review_until);

-- One vote per seat per trade; veto = true is against. Kept after the ruling so
-- the league can see who stood where.
create table if not exists trade_vote (
  trade_id   uuid not null references trade_proposal(id) on delete cascade,
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  veto       boolean not null,
  created_at timestamptz not null default now(),
  primary key (trade_id, roster_id)
);
alter table trade_vote enable row level security;
drop policy if exists trade_vote_read on trade_vote;
create policy trade_vote_read on trade_vote for select using (is_league_member(league_id));

-- ═══ 2. the rules ════════════════════════════════════════════════════════════
create or replace function league_trade_review_hours(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'trade_review_hours', '')::int, 24) from league where id = p_league_id;
$$;
grant execute on function league_trade_review_hours(uuid) to authenticated;

-- How many vetoes kill a trade. Unset = a majority of the seats that are NOT
-- in it, which is the number every platform's default lands on and the only
-- one that stays right when a league grows or shrinks.
create or replace function league_trade_veto_votes(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select settings_json ->> 'trade_veto_votes' from league where id = p_league_id), '')::int,
                  greatest(1, ((select count(*) from league_membership
                                 where league_id = p_league_id and enrolled)::int - 2) / 2 + 1));
$$;
grant execute on function league_trade_veto_votes(uuid) to authenticated;

-- 0 = an offer stands until it is answered or withdrawn (the old behaviour,
-- and still the default).
create or replace function league_trade_offer_days(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'trade_offer_days', '')::int, 0) from league where id = p_league_id;
$$;
grant execute on function league_trade_offer_days(uuid) to authenticated;

-- Absent = on, like every other switch of this shape (0213's agent_waivers).
create or replace function league_faab_trading(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'faab_trading')::boolean, true) from league where id = p_league_id;
$$;
grant execute on function league_faab_trading(uuid) to authenticated;

-- The whole trade floor in one commissioner call. -1 clears a number back to
-- its default; null leaves a knob alone.
create or replace function commish_set_trade_rules(
  p_league_id uuid, p_review text default null, p_review_hours int default null,
  p_veto_votes int default null, p_offer_days int default null,
  p_faab_trading boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare seats int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if p_review is not null and p_review not in ('none', 'commish', 'league') then
    return jsonb_build_object('ok', false, 'error', 'trade review must be none, commish or league');
  end if;
  if p_review_hours is not null and p_review_hours <> -1 and (p_review_hours < 1 or p_review_hours > 168) then
    return jsonb_build_object('ok', false, 'error', 'the review window is 1–168 hours');
  end if;
  select count(*) into seats from league_membership where league_id = p_league_id and enrolled;
  if p_veto_votes is not null and p_veto_votes <> -1 and (p_veto_votes < 1 or p_veto_votes > greatest(1, seats - 2)) then
    return jsonb_build_object('ok', false, 'error',
      'the vetoes needed are 1–' || greatest(1, seats - 2) || ' — only the teams outside a trade vote on it');
  end if;
  if p_offer_days is not null and (p_offer_days < 0 or p_offer_days > 14) then
    return jsonb_build_object('ok', false, 'error', 'an offer stands 0–14 days (0 = until it is answered)');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_review is not null then jsonb_build_object('trade_review', p_review) else '{}'::jsonb end
      || case when p_review_hours is null then '{}'::jsonb
              when p_review_hours = -1 then jsonb_build_object('trade_review_hours', null)
              else jsonb_build_object('trade_review_hours', p_review_hours) end
      || case when p_veto_votes is null then '{}'::jsonb
              when p_veto_votes = -1 then jsonb_build_object('trade_veto_votes', null)
              else jsonb_build_object('trade_veto_votes', p_veto_votes) end
      || case when p_offer_days is not null then jsonb_build_object('trade_offer_days', p_offer_days) else '{}'::jsonb end
      || case when p_faab_trading is not null then jsonb_build_object('faab_trading', p_faab_trading) else '{}'::jsonb end
    where id = p_league_id;
  return jsonb_build_object('ok', true,
    'trade_review', league_trade_review(p_league_id),
    'trade_review_hours', league_trade_review_hours(p_league_id),
    'trade_veto_votes', league_trade_veto_votes(p_league_id),
    'trade_offer_days', league_trade_offer_days(p_league_id),
    'faab_trading', league_faab_trading(p_league_id));
end $$;
grant execute on function commish_set_trade_rules(uuid, text, int, int, int, boolean) to authenticated;


-- ═══ 3. the old settings call learns the third word ══════════════════════════
-- ── set_transaction_rules: 0319's body, one word wider ───────────────────
-- Only the trade-review check changes. It is re-emitted whole rather than
-- left refusing 'league', because a commissioner saving an unrelated waiver
-- knob passes the CURRENT review mode back in — a league that had turned the
-- vote on could not have saved anything else.
create or replace function set_transaction_rules(
  p_league_id uuid, p_waiver_mode text default null,
  p_faab_budget int default null, p_trade_review text default null,
  p_waiver_clear_min int default null, p_waiver_hold_days int default null,
  p_fa_start_min int default null, p_fa_end_min int default null,
  p_waiver_clear_dow jsonb default null,      -- [] clears (= every day); [0..6] sets
  p_fa_after_waivers_dow jsonb default null,  -- [] clears (= never wait); [0..6] sets
  p_agent_waivers boolean default null,       -- 0213: agent seats may transact
  p_fa_mode text default null,                -- 0287: open | window | off
  p_faab_min_bid int default null,            -- 0319: -1 clears (= $0)
  p_fa_dow jsonb default null,                -- 0319: days free agency may open; [] clears (= every day)
  p_trade_deadline_week int default null      -- 0319: -1 clears (= no deadline)
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if p_waiver_mode is not null and p_waiver_mode not in ('rolling', 'standings', 'faab') then
    return jsonb_build_object('ok', false, 'error', 'waiver mode must be rolling, standings, or faab');
  end if;
  if p_faab_budget is not null and (p_faab_budget < 1 or p_faab_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'FAAB budget must be $1–$100000');
  end if;
  if p_fa_mode is not null and p_fa_mode not in ('open', 'window', 'off') then
    return jsonb_build_object('ok', false, 'error', 'free agency must be open, window or off');
  end if;
  -- 0321: 'league' joins them — an accepted trade goes to the floor for a vote.
  if p_trade_review is not null and p_trade_review not in ('none', 'commish', 'league') then
    return jsonb_build_object('ok', false, 'error', 'trade review must be none, commish or league');
  end if;
  if p_waiver_clear_min is not null and (p_waiver_clear_min < -1 or p_waiver_clear_min > 1439) then
    return jsonb_build_object('ok', false, 'error', 'waiver clear time must be a time of day');
  end if;
  if p_waiver_hold_days is not null and (p_waiver_hold_days < 0 or p_waiver_hold_days > 7) then
    return jsonb_build_object('ok', false, 'error', 'waiver hold must be 0–7 days');
  end if;
  if p_faab_min_bid is not null and (p_faab_min_bid < -1 or p_faab_min_bid > 100000) then
    return jsonb_build_object('ok', false, 'error', 'the minimum bid must be $0–$100000');
  end if;
  if p_trade_deadline_week is not null and (p_trade_deadline_week < -1 or p_trade_deadline_week = 0 or p_trade_deadline_week > 18) then
    return jsonb_build_object('ok', false, 'error', 'the trade deadline is a week, 1–18');
  end if;
  if p_fa_dow is not null then
    if jsonb_typeof(p_fa_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'free-agency days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_fa_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'free-agency days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;
  if (p_fa_start_min is null) <> (p_fa_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'the free-agency window needs both a start and an end');
  end if;
  if p_fa_start_min is not null and p_fa_start_min <> -1 and (
       p_fa_start_min < 0 or p_fa_start_min > 1439
    or p_fa_end_min < 0 or p_fa_end_min > 1439
    or p_fa_start_min = p_fa_end_min) then
    return jsonb_build_object('ok', false, 'error', 'free-agency hours must be two different times of day');
  end if;
  if p_waiver_clear_dow is not null then
    if jsonb_typeof(p_waiver_clear_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'clear days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_waiver_clear_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'clear days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;
  if p_fa_after_waivers_dow is not null then
    if jsonb_typeof(p_fa_after_waivers_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'FA-after-waivers days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_fa_after_waivers_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'FA-after-waivers days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;

  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_waiver_mode is not null then jsonb_build_object('waiver_mode', p_waiver_mode) else '{}'::jsonb end
      || case when p_faab_budget is not null then jsonb_build_object('faab_budget', p_faab_budget) else '{}'::jsonb end
      || case when p_trade_review is not null then jsonb_build_object('trade_review', p_trade_review) else '{}'::jsonb end
      || case when p_waiver_clear_min is null then '{}'::jsonb
              when p_waiver_clear_min = -1 then jsonb_build_object('waiver_clear_min', null)
              else jsonb_build_object('waiver_clear_min', p_waiver_clear_min) end
      || case when p_waiver_hold_days is not null then jsonb_build_object('waiver_hold_days', p_waiver_hold_days) else '{}'::jsonb end
      || case when p_fa_mode is not null then jsonb_build_object('fa_mode', p_fa_mode) else '{}'::jsonb end
      || case when p_fa_start_min is null then '{}'::jsonb
              when p_fa_start_min = -1 then jsonb_build_object('fa_start_min', null, 'fa_end_min', null)
              else jsonb_build_object('fa_start_min', p_fa_start_min, 'fa_end_min', p_fa_end_min) end
      || case when p_waiver_clear_dow is null then '{}'::jsonb
              when jsonb_array_length(p_waiver_clear_dow) = 0 then jsonb_build_object('waiver_clear_dow', null)
              else jsonb_build_object('waiver_clear_dow', p_waiver_clear_dow) end
      || case when p_fa_after_waivers_dow is null then '{}'::jsonb
              when jsonb_array_length(p_fa_after_waivers_dow) = 0 then jsonb_build_object('fa_after_waivers_dow', null)
              else jsonb_build_object('fa_after_waivers_dow', p_fa_after_waivers_dow) end
      || case when p_agent_waivers is not null then jsonb_build_object('agent_waivers', p_agent_waivers) else '{}'::jsonb end
      || case when p_faab_min_bid is null then '{}'::jsonb
              when p_faab_min_bid = -1 then jsonb_build_object('faab_min_bid', null)
              else jsonb_build_object('faab_min_bid', p_faab_min_bid) end
      || case when p_fa_dow is null then '{}'::jsonb
              when jsonb_array_length(p_fa_dow) = 0 then jsonb_build_object('fa_dow', null)
              else jsonb_build_object('fa_dow', p_fa_dow) end
      || case when p_trade_deadline_week is null then '{}'::jsonb
              when p_trade_deadline_week = -1 then jsonb_build_object('trade_deadline_week', null)
              else jsonb_build_object('trade_deadline_week', p_trade_deadline_week) end
    where id = p_league_id;
  if p_waiver_mode is not null or p_faab_budget is not null then
    update league_membership set faab_budget = null where league_id = p_league_id;
  end if;
  -- 0291/0292: A DEADLINE THE COMMISSIONER MOVED HAS TO MOVE — BOTH OF THEM.
  -- There are two stamps: a claim's own clears_at, and the waived_until a DROP
  -- puts on the pool row. 0291 moved the first and left the second, so the
  -- founder's league switched to 2pm Thursday while a queue of dropped players
  -- went on clearing at 4am, taking the claims behind them along. One call
  -- now, so the two can never again disagree about what day it is.
  perform _restamp_waiver_clocks(p_league_id);
  -- 0318: THE BOTS STAND DOWN WHEN TOLD TO. Turning agent waivers off stops
  -- the worker filing, but the claims it had already filed would still win
  -- at the run — the opposite of what the switch says. Cancel them; a human
  -- seat's claims are its own.
  if p_agent_waivers is false then
    update waiver_claim c set status = 'cancelled', note = 'agent waivers turned off', processed_at = now()
     where c.league_id = p_league_id and c.status = 'pending' and agent_wire_seat(p_league_id, c.roster_id);
  end if;
  -- 0318: AND WHAT THE CHANGE MADE DUE SETTLES NOW, in the same transaction
  -- as the change — opening free agency makes every claim on an unheld
  -- player due (process_waivers, this migration), and the run is the only
  -- thing that should hand him out. Idempotent; a save that made nothing
  -- due settles nothing and says nothing.
  perform process_waivers(p_league_id);
  return jsonb_build_object('ok', true,
    'fa_mode', league_fa_mode(p_league_id),
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;

grant execute on function set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb, boolean, text, int, jsonb, int) to authenticated;


-- ═══ 4. the offer: FAAB dollars, and a clock ═════════════════════════════════
-- 0320's body with two assets added. The old ten-argument signature is dropped
-- rather than left beside this one: an overload resolved by argument count is
-- how a caller silently keeps the old rules.
drop function if exists propose_trade(uuid, int, int, jsonb, jsonb, text, jsonb, jsonb, jsonb, int);
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
grant execute on function propose_trade(uuid, int, int, jsonb, jsonb, text, jsonb, jsonb, jsonb, int, int, int) to authenticated;

-- ═══ 5. the answer: expired, countered, or out to the league ═════════════════
-- respond_trade: 0320's body, plus the clock and the third review mode.
create or replace function respond_trade(p_trade_id uuid, p_accept boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; r jsonb; err text; mode text; until timestamptz; need int;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (owns_roster(t.league_id, t.to_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your trade to answer');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;   -- re-read under the lock
  if t.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status); end if;
  -- 0321: AN OFFER THAT RAN OUT. Marked here rather than left pending, so the
  -- list says what happened the moment somebody tries to take it — the sweep
  -- is a safety net, not the thing the manager waits on.
  if t.expires_at is not null and t.expires_at <= now() then
    update trade_proposal set status = 'expired', resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', false, 'error', 'this offer expired');
  end if;
  if not p_accept then
    update trade_proposal set status = 'rejected', responded_at = now(), resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  -- 0319: an offer made before the deadline cannot be accepted after it.
  err := trade_deadline_error(t.league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := coalesce(team_lock_reason(t.league_id, t.to_roster), team_lock_reason(t.league_id, t.from_roster));   -- 0320
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  mode := league_trade_review(t.league_id);
  if mode = 'commish' then
    update trade_proposal set status = 'accepted', responded_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'accepted', 'awaiting', 'commissioner approval');
  end if;
  -- 0321: THE LEAGUE VOTE. The deal is struck; now it sits on the floor. The
  -- window and the bar are both league settings, and both ride the chat line —
  -- a vote nobody knows about is a delay, not a review.
  -- A two-team league (or one where everybody else has left) has no floor to
  -- put a deal on: with nobody eligible to vote, a review window is a day of
  -- waiting for a result that cannot change. It executes like 'none'.
  if mode = 'league' and _trade_electorate(p_trade_id) > 0 then
    until := now() + make_interval(hours => league_trade_review_hours(t.league_id));
    need := league_trade_veto_votes(t.league_id);
    update trade_proposal set status = 'review', responded_at = now(), review_until = until where id = p_trade_id;
    perform _chat_house(t.league_id,
      '🗳 Trade to the floor — ' || _txn_team(t.league_id, t.from_roster) || ' and '
        || _txn_team(t.league_id, t.to_roster) || ' have a deal. ' || need
        || ' veto' || case when need = 1 then '' else 's' end || ' block'
        || case when need = 1 then 's' else '' end || ' it; the vote closes in '
        || league_trade_review_hours(t.league_id) || 'h.',
      jsonb_build_object('kind', 'vote', 'trade_id', p_trade_id, 'from_roster', t.from_roster,
                         'to_roster', t.to_roster, 'need', need));
    return jsonb_build_object('ok', true, 'status', 'review', 'awaiting', 'the league vote',
                              'review_until', until, 'veto_votes', need);
  end if;
  r := execute_trade(p_trade_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;   -- stays pending, error surfaced
  update trade_proposal set responded_at = now() where id = p_trade_id;
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;
grant execute on function respond_trade(uuid, boolean) to authenticated;

-- ── counter_trade: an offer answered with an offer ───────────────────────
-- The receiving seat's one call: the original goes to 'countered' and the
-- mirrored proposal is filed FROM them in the same transaction, pointing back
-- at what it answers. Everything a proposal may carry carries here too, so a
-- counter is a real offer and not a reply with a shopping list in it.
create or replace function counter_trade(
  p_trade_id uuid, p_give jsonb, p_get jsonb, p_note text default null,
  p_give_picks jsonb default null, p_get_picks jsonb default null,
  p_retain jsonb default null, p_cap_dollars int default null,
  p_faab_dollars int default 0, p_expires_hours int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (owns_roster(t.league_id, t.to_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your trade to answer');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;
  if t.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status); end if;
  -- The counter is filed under the ORIGINAL's seats, swapped: give is what the
  -- countering team sends. propose_trade re-validates all of it from scratch,
  -- so a counter cannot smuggle in a player who has since moved.
  r := propose_trade(t.league_id, t.to_roster, t.from_roster, p_give, p_get, p_note,
                     p_give_picks, p_get_picks, p_retain, p_cap_dollars, p_faab_dollars, p_expires_hours);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  update trade_proposal set counters = p_trade_id where id = (r ->> 'trade_id')::uuid;
  update trade_proposal set status = 'countered', responded_at = now(), resolved_at = now()
   where id = p_trade_id;
  return r || jsonb_build_object('status', 'countered', 'counters', p_trade_id);
end $$;
grant execute on function counter_trade(uuid, jsonb, jsonb, text, jsonb, jsonb, jsonb, int, int, int) to authenticated;

-- ═══ 6. the floor ════════════════════════════════════════════════════════════
-- How many seats may vote on this one: every enrolled seat that is not in it.
create or replace function _trade_electorate(p_trade_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from league_membership m
   join trade_proposal t on t.league_id = m.league_id
   where t.id = p_trade_id and m.enrolled
     and m.sleeper_roster_id not in (t.from_roster, t.to_roster);
$$;

-- Settle a trade that is out for a vote, if it can be settled yet. Called by
-- every vote (a trade blocked at the ninth vote should not wait for the
-- deadline) and by the sweep (a deadline nobody is watching).
create or replace function _settle_trade_review(p_trade_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; need int; vetoes int; cast_ int; seats int; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found or t.status <> 'review' then
    return jsonb_build_object('ok', true, 'status', coalesce(t.status, 'gone'));
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  need := league_trade_veto_votes(t.league_id);
  select count(*) filter (where veto), count(*) into vetoes, cast_ from trade_vote where trade_id = p_trade_id;
  seats := _trade_electorate(p_trade_id);
  if vetoes >= need then
    update trade_proposal set status = 'vetoed', resolved_at = now() where id = p_trade_id;
    perform _chat_house(t.league_id,
      '🗳 Trade vetoed by the league — ' || vetoes || ' of ' || seats || ' voted it down ('
        || _txn_team(t.league_id, t.from_roster) || ' / ' || _txn_team(t.league_id, t.to_roster) || ').',
      jsonb_build_object('kind', 'vote', 'trade_id', p_trade_id, 'vetoed', true,
                         'vetoes', vetoes, 'need', need));
    return jsonb_build_object('ok', true, 'status', 'vetoed', 'vetoes', vetoes, 'need', need);
  end if;
  -- Not yet: the window is open AND enough unvoted seats remain to still
  -- reach the bar. Either of those failing settles it now — a vote whose
  -- outcome is arithmetic has already happened.
  if now() < coalesce(t.review_until, now()) and (seats - cast_) + vetoes >= need then
    return jsonb_build_object('ok', true, 'status', 'review', 'vetoes', vetoes, 'need', need,
                              'voted', cast_, 'seats', seats);
  end if;
  -- 0320's locks are asked again here, not just at the acceptance: a
  -- commissioner who locks a team while the vote runs has shut its roster
  -- moves, and this is one.
  r := coalesce(
    case when coalesce(team_lock_reason(t.league_id, t.from_roster),
                       team_lock_reason(t.league_id, t.to_roster)) is not null
         then jsonb_build_object('ok', false, 'error',
                coalesce(team_lock_reason(t.league_id, t.from_roster),
                         team_lock_reason(t.league_id, t.to_roster))) end,
    execute_trade(p_trade_id));
  if not coalesce((r ->> 'ok')::boolean, false) then
    -- The deal no longer applies (a player moved, a cap broke). Leave it while
    -- the window is open — the managers can still re-propose — and close it
    -- once the clock is past, rather than retrying forever every sweep.
    if now() >= coalesce(t.review_until, now()) then
      update trade_proposal set status = 'expired', resolved_at = now() where id = p_trade_id;
      perform _chat_house(t.league_id,
        '🗳 Trade could not be completed — ' || coalesce(r ->> 'error', 'the rosters moved') || '.',
        jsonb_build_object('kind', 'vote', 'trade_id', p_trade_id, 'failed', true));
    end if;
    return r;
  end if;
  return jsonb_build_object('ok', true, 'status', 'executed', 'vetoes', vetoes, 'need', need);
end $$;
revoke all on function _trade_electorate(uuid) from public, anon;
revoke all on function _settle_trade_review(uuid) from public, anon, authenticated;
grant execute on function _trade_electorate(uuid) to authenticated;

-- One seat's vote. Veto = against; an allow is recorded too, because a vote
-- that can no longer be blocked should not sit out its whole window.
create or replace function cast_trade_vote(p_trade_id uuid, p_veto boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; rid int; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  select sleeper_roster_id into rid from league_membership
   where league_id = t.league_id and app_user_id = auth.uid() and enrolled
   order by sleeper_roster_id limit 1;
  if rid is null then return jsonb_build_object('ok', false, 'error', 'you have no seat in this league'); end if;
  if rid in (t.from_roster, t.to_roster) then
    return jsonb_build_object('ok', false, 'error', 'a team in the trade does not vote on it');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;
  if t.status <> 'review' then return jsonb_build_object('ok', false, 'error', 'this trade is not out for a vote'); end if;
  if t.review_until is not null and t.review_until <= now() then
    return jsonb_build_object('ok', false, 'error', 'the vote has closed');
  end if;
  insert into trade_vote (trade_id, league_id, roster_id, veto)
    values (p_trade_id, t.league_id, rid, coalesce(p_veto, false))
    on conflict (trade_id, roster_id) do update set veto = excluded.veto, created_at = now();
  r := _settle_trade_review(p_trade_id);
  return jsonb_build_object('ok', true, 'veto', coalesce(p_veto, false)) || coalesce(r - 'ok', '{}'::jsonb);
end $$;
grant execute on function cast_trade_vote(uuid, boolean) to authenticated;

-- The worker's clock (server/src/native.js): offers that ran out, votes that
-- closed. Both are league-rule decisions with nobody in the room, and both are
-- idempotent — a second sweep in the same minute settles nothing twice.
create or replace function trade_sweep() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r record; res jsonb; expired int := 0; executed int := 0; vetoed int := 0; stuck int := 0;
begin
  for r in select id from trade_proposal
            where status = 'pending' and expires_at is not null and expires_at <= now() loop
    update trade_proposal set status = 'expired', resolved_at = now()
     where id = r.id and status = 'pending';
    if found then expired := expired + 1; end if;
  end loop;
  for r in select id from trade_proposal where status = 'review' and review_until <= now() loop
    begin
      res := _settle_trade_review(r.id);
      if res ->> 'status' = 'executed' then executed := executed + 1;
      elsif res ->> 'status' = 'vetoed' then vetoed := vetoed + 1;
      else stuck := stuck + 1; end if;
    exception when others then stuck := stuck + 1;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'expired', expired, 'executed', executed,
                            'vetoed', vetoed, 'stuck', stuck);
end $$;
-- The worker's call, so the worker's grant (0177's draft_autostart_sweep set
-- the shape): it sweeps EVERY league, which is nobody's seat to trigger.
revoke all on function trade_sweep() from public, anon, authenticated;
grant execute on function trade_sweep() to service_role;

-- ── commish_rule_trade: 0072's body, ruling over a vote too ──────────────
-- The commissioner outranks the floor in both directions: a veto kills a trade
-- that is still collecting votes, and an approval executes it early.
create or replace function commish_rule_trade(p_trade_id uuid, p_approve boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (is_admin() or is_league_commish(t.league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;
  if not p_approve then
    if t.status not in ('pending', 'accepted', 'review') then
      return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status);
    end if;
    update trade_proposal set status = 'vetoed', resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'vetoed');
  end if;
  if t.status not in ('accepted', 'review') then
    return jsonb_build_object('ok', false, 'error', 'both managers must agree first');
  end if;
  r := execute_trade(p_trade_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;
grant execute on function commish_rule_trade(uuid, boolean) to authenticated;


-- ═══ 7. execution: the dollars move with the players ═════════════════════════
-- 0290's body with the FAAB leg. Note where it sits: after the roster and pick
-- updates, beside the cap-dollar move, and before the chat line that reports
-- the deal — so a refused wallet backs the whole thing out.
create or replace function execute_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; err text; el jsonb; lseas text; ov int; knd text;
        sender int; taker int;
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
  -- FAAB dollars (0321). The budget is re-checked HERE, not just at the offer:
  -- a review window is a day long and a waiver run inside it can spend the
  -- money twice over. A wallet that went short refuses the trade rather than
  -- handing out dollars nobody has.
  if coalesce(t.faab_dollars, 0) <> 0 then
    sender := case when t.faab_dollars > 0 then t.from_roster else t.to_roster end;
    taker  := case when t.faab_dollars > 0 then t.to_roster else t.from_roster end;
    if abs(t.faab_dollars) > member_faab(t.league_id, sender) then
      return jsonb_build_object('ok', false, 'error',
        _txn_team(t.league_id, sender) || ' no longer has $' || abs(t.faab_dollars)
          || ' of FAAB — re-propose');
    end if;
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
grant execute on function execute_trade(uuid) to authenticated;

-- ═══ 8. what the screens read ════════════════════════════════════════════════
-- league_trades v4 (0220's body + the floor). Every new term rides the row the
-- accepting manager is looking at: the clock on the offer, the vote and who
-- cast it, the FAAB, and the offer this one answers.
create or replace function league_trades(p_league_id uuid, p_limit int default 30)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare need int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  need := league_trade_veto_votes(p_league_id);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'from_roster', t.from_roster, 'to_roster', t.to_roster,
      'give', t.give, 'get', t.get,
      'give_picks', t.give_picks, 'get_picks', t.get_picks,
      'retain', t.retain, 'cap_dollars', t.cap_dollars,
      'faab_dollars', t.faab_dollars,
      'status', t.status, 'note', t.note,
      'created_at', t.created_at, 'resolved_at', t.resolved_at,
      'expires_at', t.expires_at, 'review_until', t.review_until,
      'counters', t.counters,
      -- The vote is public: a league that can see the deal can see who tried
      -- to stop it. `veto_need` is the bar as it stands now, so a screen can
      -- print "2 of 3" without a second call.
      'veto_need', need,
      'votes', coalesce((select jsonb_agg(jsonb_build_object('roster_id', v.roster_id, 'veto', v.veto)
                                  order by v.created_at)
                           from trade_vote v where v.trade_id = t.id), '[]'::jsonb))
      order by t.created_at desc)
    from (select * from trade_proposal where league_id = p_league_id
          order by created_at desc limit least(p_limit, 100)) t), '[]'::jsonb);
end $$;
grant execute on function league_trades(uuid, int) to authenticated;


-- ── roster_rules: 0320's body, reporting the floor ───────────────────────
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
    'dues_note', (select settings_json ->> 'dues_note' from league where id = p_league_id),
    -- 0321: the trade floor. veto_votes is the EFFECTIVE bar (the stored
    -- number, or the majority it falls back to), and veto_votes_set says
    -- which of the two the console is looking at.
    'trade_review_hours', league_trade_review_hours(p_league_id),
    'trade_veto_votes', league_trade_veto_votes(p_league_id),
    'trade_veto_votes_set', (select nullif(settings_json ->> 'trade_veto_votes', '')::int from league where id = p_league_id),
    'trade_offer_days', league_trade_offer_days(p_league_id),
    'faab_trading', league_faab_trading(p_league_id));
end $$;
grant execute on function roster_rules(uuid) to authenticated;

-- ── _native_team_state_for: 0320's body, the trade knobs a seat needs ────
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
    -- 0321: what the trade screen needs to draw an offer before it is sent —
    -- the vote's window and bar, the default life of an offer, and whether
    -- FAAB may ride one at all.
    'trade_review_hours', league_trade_review_hours(p_league_id),
    'trade_veto_votes', league_trade_veto_votes(p_league_id),
    'trade_offer_days', league_trade_offer_days(p_league_id),
    'faab_trading', mode = 'faab' and league_faab_trading(p_league_id),
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
