# The Taco Locker — a commissioner's time-out for one team

> **Status: BUILT, v0.647.0** (migration `0451_the_taco_locker.sql`,
> `server/src/taco.js`). Founder: "Let's add a Taco Locker feature. A commish
> can lock a team from making trades or dropping players. We also leverage
> the AI team rules to auto-set the best lineup for that team on Thursday AM
> est."

## 1. What it is

A commissioner puts one team in the Taco Locker. While it is in:

- **No trades.** It cannot offer a trade and nobody can offer it one; a
  trade already accepted is re-checked by the review sweep and settles as
  refused.
- **No drops.** It cannot drop a player, add with a drop, or file a waiver
  claim with a drop. (0320's per-team lock also shuts plain adds and claims;
  that rule stands — the locker is that lock, named.)
- **Its lineup is set for it.** Once a week, from **Thursday 9:00 AM
  Eastern**, the worker sets the team's best lineup exactly as it sets an AI
  team's: every spot whose game has not started is re-planned at the AI's
  values (projection, injuries, byes, the league's own scoring); a player
  whose game has started stays put. The manager may still move players
  afterwards — the locker takes the roster moves away, not the lineup.
- **The league hears it.** A chat card when a team goes in, one when it
  comes out, and one each Thursday the lineup is set.

The commissioner's own force-moves (move, remove, reverse a trade) still
work, as they do under every lock.

## 2. Where it lives

- **Commissioner desk**, LOCKS: web `LocksPanel` (`src/screens/CommishDesk.tsx`),
  app `LocksCard` (`apps/mobile/src/ui/CommishDesk.tsx`). The league-wide
  wire lock stays above; the 🌮 TACO LOCKER row lists every team, 🌮 on the
  ones inside. Tap to put in or let out.
- **The lock**: `league_membership.wire_locked` (0320). `team_lock_reason`
  reads "🌮 Taco Locker: the commissioner has locked this team's trades and
  drops" — every refusal on the wire, the trade sheet and the team screen's
  wire-block line carries it. `commish_lock_team(league, roster, on)` is the
  setter; it posts the card only when the state changes.
- **The clock**: `server/src/taco.js`. `tacoDue(now, week, taco_set_week)` is
  true from Thursday 09:00 ET through Monday, once per board week; Tuesday
  and Wednesday are the manager's (waivers run Wednesday). A worker that was
  down at nine sets the lineup on its first tick back.
- **The set**: `server/src/lock.js` `autoSlotClassicLineups`. A locked human
  seat that is due takes the AGENT branch for that tick (aiValueOf, every
  unlocked spot, writing under the manager's own uid), then
  `league_membership.taco_set_week` is stamped with the week and the card is
  posted (`tacoLine`). Classic leagues: that is where the worker sets
  lineups; a drip league's locked team keeps the lock without the Thursday
  set.

## 3. Pinned

- `scripts/db/taco-locker-probes.sql` (scratch runner): in → one card by
  name, a repeat tap posts nothing, the reader lists it, no stamp yet; a
  member cannot lock; the locked team cannot drop, add with a drop, add, or
  offer a trade, and nobody can offer it one — every refusal says "Taco
  Locker"; the team screen says so; out → one card, the moves return.
- `server/test/taco.mjs`: the Eastern clock across the DST month, due at
  nine and not before, never twice, never Tuesday or Wednesday, catch-up
  Friday through Monday, due again the next Thursday after the week rolls.
- The commish-desk and drop-lock suites stay green (the old refusal text is
  inside the new one).

## 4. Open

- A lineup set on Sunday by a worker that missed Thursday fills only the
  spots still open; fine, and said in the clock's docblock.
- Drip leagues: the Thursday set is classic-only today (the worker's lineup
  fill is). If a drip league wants it, `materializeAutoLineups` is the hook.
