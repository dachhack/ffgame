-- 0308 — A SEAT ON 🤖 AUTO-PILOT WORKS THE WIRE TOO (v0.432.3)
--
-- Founder, Sunday morning: "Steelers is on AI control. … Heidenreich in a
-- starting RB spot is not optimal. There are like 20 better options on
-- waivers. Steelers should have added an RB on waivers."
--
-- 0298 admitted the worker to a seat when nobody was at it: an agent row, or
-- controller 'ai' — AND league_membership.app_user_id null. The null was
-- 0213's guarantee kept in place: a manager who flipped THEIR OWN team to
-- auto-pilot (0022) kept their roster, their drops and their FAAB, and the AI
-- composed only their lineup. The Steelers are that seat — an account, on
-- 🤖 — so the wire never acted for them, the IR shelf never took their
-- injured, and a bot vampire in the same shape would never bite.
--
-- The founder's rule now: a seat on AI control is the AI's to manage, roster
-- included. The gate admits controller = 'ai' whether or not an account is
-- at the seat. The agent-row branch keeps its null — an unclaimed seat a
-- human then claims is the human's the moment they sit down, and the claim
-- trigger (0180) retires the row anyway. Flipping the controller back to
-- 'human' closes the gate the same tick.
--
-- Same helper, same callers (submit_waiver_claim, add_free_agent,
-- set_roster_spot, vampire_steal), same commissioner switch
-- (league_agent_waivers). Nothing else moves.
create or replace function agent_wire_seat(p_league_id uuid, p_roster_id int)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from league_membership m
    left join seat_agent sa
      on sa.league_id = m.league_id and sa.roster_id = m.sleeper_roster_id
    where m.league_id = p_league_id and m.sleeper_roster_id = p_roster_id
      and ((sa.roster_id is not null and m.app_user_id is null) or m.controller = 'ai')
  );
$$;
revoke all on function agent_wire_seat(uuid, int) from public;
