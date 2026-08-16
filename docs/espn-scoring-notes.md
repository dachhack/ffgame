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
