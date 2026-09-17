-- 0292: THE HOLD IS ON THE SAME SCHEDULE (v0.406.0).
--
-- Founder, looking at the pool after 0291 shipped: "still has jax kicker
-- clearing at 4am."
--
-- Different 4am. 0291 re-dated the CLAIM's own clock and said, in as many
-- words, that a claim queued behind a real pool hold follows that hold "as it
-- always has". That sentence was the bug. There are two stamps in this system
-- and I moved one:
--
--   waiver_claim.clears_at   — set when a claim is made   (0291 re-stamps it)
--   league_pool.waived_until — set when a player is DROPPED (nothing re-stamps it)
--
-- JAX Kicker was dropped by somebody while the league cleared at 4am, so his
-- pool row carries a 4am hold. The ⏳ in the player list counts down to it, the
-- claim behind it inherits it through coalesce(clears_at, waived_until), and
-- changing the league's clear time moved neither. The founder's league now
-- clears at 2pm Thursday and still had a queue of players clearing at 4am.
--
-- EVERY FANTASY PLATFORM MEANS ONE THING BY A WAIVER TIME: there is a run, and
-- everybody on waivers clears at it. The per-player stamp is an implementation
-- detail of that, not a separate promise made to each player at drop time. So
-- when the schedule moves, the holds move.
--
-- The rule, stated plainly because it is the kind of thing that surprises
-- somebody later: changing the waiver schedule re-dates every LIVE hold
-- against the new schedule, through the same waiver_hold_until() that set it.
-- With the default one-day hold that is exactly "everyone clears at the next
-- run", which is what a commissioner means. With a longer hold it restarts
-- that hold against the new clock rather than trying to credit days already
-- served — moving the schedule mid-hold is a rare, deliberate act, and a rule
-- you can say in one sentence beats an accounting nobody can predict.
--
-- Expired holds are left alone. A player who already cleared is a free agent,
-- and re-dating him would put him back on waivers.

-- ── re-stamping, in one place ─────────────────────────────────────────────
-- Both callers below want the same thing, and a league whose holds and claims
-- disagreed about the schedule would be the same bug one layer down.
create or replace function _restamp_waiver_clocks(p_league_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  -- Only a league that HAS a run. In a rolling league (no clear time set)
  -- waiver_hold_until() answers now() + 24h, so re-stamping would push every
  -- live hold a full day further out every time a commissioner saved any
  -- setting at all — a rule that punishes opening the settings screen.
  if next_waiver_run(p_league_id) is null then return; end if;
  update league_pool lp set waived_until = waiver_hold_until(p_league_id)
   where lp.league_id = p_league_id and lp.waived_until > now();
  update waiver_claim c set clears_at = claim_clears_at(p_league_id)
   where c.league_id = p_league_id and c.status = 'pending' and c.clears_at is not null;
end $$;
revoke all on function _restamp_waiver_clocks(uuid) from public, anon, authenticated;

-- ── set_transaction_rules: 0291's body, re-stamping BOTH clocks ──────────
create or replace function set_transaction_rules(
  p_league_id uuid, p_waiver_mode text default null,
  p_faab_budget int default null, p_trade_review text default null,
  p_waiver_clear_min int default null, p_waiver_hold_days int default null,
  p_fa_start_min int default null, p_fa_end_min int default null,
  p_waiver_clear_dow jsonb default null,      -- [] clears (= every day); [0..6] sets
  p_fa_after_waivers_dow jsonb default null,  -- [] clears (= never wait); [0..6] sets
  p_agent_waivers boolean default null,       -- 0213: agent seats may transact
  p_fa_mode text default null                 -- 0287: open | window | off
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
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
  if p_trade_review is not null and p_trade_review not in ('none', 'commish') then
    return jsonb_build_object('ok', false, 'error', 'trade review must be none or commish');
  end if;
  if p_waiver_clear_min is not null and (p_waiver_clear_min < -1 or p_waiver_clear_min > 1439) then
    return jsonb_build_object('ok', false, 'error', 'waiver clear time must be a time of day');
  end if;
  if p_waiver_hold_days is not null and (p_waiver_hold_days < 1 or p_waiver_hold_days > 7) then
    return jsonb_build_object('ok', false, 'error', 'waiver hold must be 1–7 days');
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
  return jsonb_build_object('ok', true,
    'fa_mode', league_fa_mode(p_league_id),
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;
grant execute on function set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb, boolean, text) to authenticated;

-- ── the leagues already out of step ───────────────────────────────────────
-- The founder changed his clear time BEFORE the rule above existed, so his
-- league is carrying holds dated against a schedule it no longer runs; so is
-- any other league whose commissioner has ever moved the time. Re-date them
-- all once, against each league's own current schedule, skipping the rolling
-- leagues that have no run to be out of step with.
do $$
declare l record;
begin
  for l in select id from league where next_waiver_run(id) is not null loop
    perform _restamp_waiver_clocks(l.id);
  end loop;
end $$;
