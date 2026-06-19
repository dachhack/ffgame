# Stathead (MCP) data requests

Tracking play-by-play fields the game needs that aren't exposed yet. Each leaves
a wired-but-dormant mechanic in the app that activates once the data lands.

## 1. Per-player turnovers (interceptions thrown / fumbles lost) — ✅ DONE

`get_play_by_play` now exposes `interception` and `fumble_lost` per play. The
baker (`scripts/pbp/genRealPbp.mjs`) attributes them to the committing player —
INT → passer; fumble lost → rusher (run) / receiver (caught) / passer (sack) —
and writes a `to: 1` flag on that player's play in `public/pbp/wN.json`.
`turnoversCommitted(player, week)` (`src/engine/sim.ts`) counts them and the
turnover line in `weekEarnings` is live. (Fumbles use play-role attribution
since the dumps don't carry a `fumbled_1_player_id`; if that ever lands we can
attribute multi-player fumbles exactly.)

## 2. Return yards + returner ids (kick / punt returns)

**Why:** the **Return Yards** powerup (0.1/yd banked + a 0.003 drip multiplier).

**What we have today:** PBP exposes `return_touchdown` but not return yardage or
the returning player's id.

**What we need:** `return_yards` and the kick/punt `returner` id per return play.
