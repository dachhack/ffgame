# ESPN scoring categories we don't carry yet (founder's notes, 2026-08-16)

Captured from the founder's ESPN league-settings screenshots during the
Sleeper-parity pass (v0.204.0). Two whole categories exist on ESPN that
neither Sleeper nor Drip classic carries today. Recorded verbatim so the
rules are ready the day we add the positions.

**Targets shipped** (the third item from the same ask): ESPN scores
per-target and Sleeper doesn't — Drip classic now has it (`targetPt`,
RECEIVING → TARGET), paying on every target, caught or not.

## Punting — for if/when we add punters (position P)

ESPN's full punting category list:

| Code  | Category                  |
|-------|---------------------------|
| PT    | Net Punts                 |
| PTY   | Punt Yards                |
| PT10  | Punts Inside the 10       |
| PT20  | Punts Inside the 20       |
| PTB   | Blocked Punts             |
| PTR   | Punts Returned            |
| PTRY  | Punt Return Yards         |
| PTTB  | Touchbacks                |
| PTFC  | Fair Catches              |
| PTA44 | Punt Average 44.0+        |
| PTA42 | Punt Average 42.0–43.9    |
| PTA40 | Punt Average 40.0–41.9    |
| PTA38 | Punt Average 38.0–39.9    |
| PTA36 | Punt Average 36.0–37.9    |
| PTA34 | Punt Average 34.0–35.9    |
| PTA33 | Punt Average 33.9 or less |

Data note: our play feed has no punt play kinds today — adding punters
needs new `RealPlayKind`s (punt, punt distance/result) end to end
(bake + ESPN adapter + worker poll), plus a P position in the pools.

## Head Coach — ESPN "coach scoring" (position HC)

| Code | Category               |
|------|------------------------|
| TW   | Team Win               |
| TL   | Team Loss              |
| TIE  | Team Tie               |
| PTS  | Points Scored          |
| WM25 | 25+ point Win Margin   |
| WM20 | 20–24 point Win Margin |
| WM15 | 15–19 point Win Margin |
| WM10 | 10–14 point Win Margin |
| WM5  | 5–9 point Win Margin   |
| WM1  | 1–4 point Win Margin   |
| LM1  | 1–4 point Loss Margin  |
| LM5  | 5–9 point Loss Margin  |
| LM10 | 10–14 point Loss Margin|
| LM15 | 15–19 point Loss Margin|
| LM20 | 20–24 point Loss Margin|
| LM25 | 25+ point Loss Margin  |

Data note: needs final team scores / margins, which the play stream
doesn't carry per-player today — an HC pseudo-player would score off the
game result the way DEF scores off defensive events.

## Sleeper categories the play feed can't support yet (same pass)

First downs (pass/rush/rec, per-position bonuses), 2-pt conversions,
pass completed/incomplete/attempts + 25+ completions (QB incompletions,
sacks and 0-yd completions are identical 0-yd `pass` rows in the feed),
QB sacked, pick-6 thrown, points/yardage-allowed brackets, blocked kicks,
forced fumbles, fumble (not lost) + offensive fumble-recovery TD,
solo/assist tackle splits, TFL, QB hits, pass defended, sack yards,
INT/fumble return yards, ST player stats, 3-and-out/4th-down-stop/forced
punt. Each needs richer play-feed fields before an honest knob can exist.

## Upstream audit (2026-08-16): the data EXISTS — the gap is our reduction

The founder asked whether the feed has the data or it can be found
upstream. Checked both layers against live 2025 pulls. Verdict: nearly
every "unsupportable" category above is present upstream; our
`RealPlay` reduction (`{kind, yards, td, catch, target, turnover}`) is
what drops it.

**Stathead MCP (nflverse pbp — the bake + 2025 season source), verified
by projection on real week-1 2025 rows:**

- `get_fantasy_pbp idp=true` already emits, per credited defender with
  gsis ids: `tackle` (tackle_type **solo|assist**), `tfl`, `sack`
  (incl. 0.5 halves), `qb_hit`, `pd` (pass defended), `int`, `ff`, `fr`,
  `def_td` — watched an ARI/NO sack play fan out to
  solo-tackle + TFL + sack + QB-hit events on one defender. Plus `kr`/`pr`
  return events with yards, `two_point` + `two_point_result` on offensive
  events, `int_thrown`/`fumble_lost`, kicker `fg`/`xp` with distance and
  result, team-defense events, and a **points_allowed summary per
  team-game** (the PA brackets knob, ready-made).
- `get_play_by_play` slim columns add: `down`, `ydstogo`, `yards_gained`
  (⇒ **first downs** derive exactly), `complete_pass`
  (⇒ **completions / incompletions / attempts** distinguishable, unlike
  our 0-yd rows), `two_point_attempt`/`two_point_conv_result`,
  `kick_distance`, `fair_catch`, `total_home/away_score` (per-play score
  ⇒ PA/yardage-allowed brackets, coach win margins), and
  `play_type=punt` rows (punt yards via kick_distance + return columns).
  Punter ATTRIBUTION (punter_player_id) did not come back in the slim
  projection — the one thing to confirm before a punter position.

**Live ESPN feed (worker poll):** richer than the adapter keeps —
`start.down`/`start.distance` are already parsed (drive builder),
`Punt` typeText arrives and is currently skipped, per-play score is in
the summary (PA brackets live), tackler names ride the play text, and
2-pt attempts are typed/texted. Solo/assist splits and QB hits are the
weak spot live (text parsing, lower fidelity than nflverse).

**So the path**: extend `RealPlay` with the missing fields/kinds
(first-down flag, complete/incomplete distinction, 2-pt, punt kinds,
defender-attributed splash detail, per-play score), widen the bake from
`get_fantasy_pbp`+`get_play_by_play`, widen the ESPN adapter for the
live layer, then the scoring knobs above become honest. Engineering
project, not a data hunt — no category is blocked on missing data
except punter attribution (confirm) and coach scoring's HC pseudo-player
(needs the per-game result, which the score columns carry).
