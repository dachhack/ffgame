# Stathead (MCP) data requests

Tracking play-by-play fields the game needs that aren't exposed yet. Each leaves
a wired-but-dormant mechanic in the app that activates once the data lands.

## 1. Per-player turnovers (interceptions thrown / fumbles lost)

**Why:** the turnover drip-coin transfer — a player who throws an INT or loses a
fumble forfeits coin to the opponent (10, or 25 with the **Ball Hawk** powerup).

**What we have today:** `get_play_by_play` attributes `int` and `fumrec` only to
the **defense/special teams** (takeaways forced). Offensive players carry only
`pass` / `rush` / `rec` / `incomplete` — there is no signal for *who* threw the
pick or lost the fumble.

**What we need:** turnovers attributed to the **committing offensive player**, as
either:
- new play kinds on that player's feed — e.g. `int_thrown` (QB) and
  `fumble_lost` (any ball-carrier/receiver), or
- a boolean `to` / `turnover` flag on the existing offensive play.

**Where it plugs in:** `turnoversCommitted(player, week)` in `src/engine/sim.ts`
(currently returns 0). Once the field exists, count those plays there and the
turnover line in `weekEarnings` (`src/engine/matchup.ts`) goes live.

## 2. Return yards + returner ids (kick / punt returns)

**Why:** the **Return Yards** powerup (0.1/yd banked + a 0.003 drip multiplier).

**What we have today:** PBP exposes `return_touchdown` but not return yardage or
the returning player's id.

**What we need:** `return_yards` and the kick/punt `returner` id per return play.
