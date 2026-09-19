-- 0298 — AN AI SEAT WORKS THE WIRE TOO (v0.425.0)
--
-- Founder: "It's essential that the AI makes waiver moves in the vampire
-- league. How is our AI team waiver system?"
--
-- WHAT IT WAS. 0213 let the WORKER call submit_waiver_claim / add_free_agent
-- for a seat nobody holds — and "nobody holds" was spelled as "has a
-- seat_agent row and no app_user". Seat agents (0180) are minted only for
-- unclaimed seats whose controller is 'human'; a seat whose controller is
-- 'ai' (🤖 — the wizard's AI teams, a test league's bots, the coven's
-- vampire when it is a bot) is DELIBERATELY never agented, because its
-- lineup is composed at resolve by aiSide and an agent's sealed rows would
-- override that. The side effect nobody measured: an AI seat could never
-- transact. It drafted, it fielded a lineup every week, and it never once
-- touched the wire — no injury answered, no bye covered, and in a vampire
-- league a bot vampire (which does not draft, 0268) sat with an EMPTY
-- roster all season, because the pool was its only cradle and the only
-- hand that could reach in was never allowed to.
--
-- THE CHANGE. `agent_wire_seat` admits a seat the worker may act for when
-- EITHER holds, and nobody is at the seat in both cases:
--
--   • a seat_agent row exists (0213, unchanged), or
--   • league_membership.controller = 'ai'
--
-- …and league_membership.app_user_id IS NULL. The second condition keeps
-- 0213's guarantee exactly where it was: a seat a human holds is never
-- transacted over by the worker, even one the human flipped to 🤖 auto-pilot
-- (0022's self-serve flag). Auto-pilot composes their LINEUP; their roster,
-- their drops and their FAAB stay theirs. If that is ever wanted it is one
-- clause here, but it is a different promise and not this one.
--
-- Still the same two functions, the same guard shape (`auth.uid() is null
-- and agent_wire_seat(...)`), the same commissioner switch
-- (league_agent_waivers) and every rule those functions enforce. Nothing
-- forks. The sweep that ASKS lives in server/src/seatWire.js and now walks
-- AI seats beside agent seats.
create or replace function agent_wire_seat(p_league_id uuid, p_roster_id int)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from league_membership m
    left join seat_agent sa
      on sa.league_id = m.league_id and sa.roster_id = m.sleeper_roster_id
    where m.league_id = p_league_id and m.sleeper_roster_id = p_roster_id
      and m.app_user_id is null
      and (sa.roster_id is not null or m.controller = 'ai')
  );
$$;
-- Deliberately NOT granted to authenticated (0213): this answers a question
-- only the worker's own guard needs, and exposing it would leak which seats
-- are bots.
revoke all on function agent_wire_seat(uuid, int) from public;
