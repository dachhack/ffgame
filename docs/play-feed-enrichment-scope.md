# Play-feed enrichment — scope (2026-08-16)

The follow-through on the upstream audit (espn-scoring-notes.md): extend the
play feed so the remaining Sleeper/ESPN scoring categories become honest
knobs. The audit's verdict stands — every category exists upstream; this is
a reduction-widening project across the four layers that touch a play:

    bake (Stathead/nflverse) ─┐
                              ├─→ RawPlay stream → engine scorers → knobs
    live (ESPN adapter) ──────┘         (worker + web + app score the SAME stream)

Design rule throughout: **additive only.** New optional fields and new play
kinds — existing scorers ignore unknown kinds and default new knobs to 0, so
drip mode and every live league score identically until a commissioner turns
a new knob. No data migration of stored picks/rosters; the 2025 re-bake is
regenerated, not mutated.

## The shape change (core, shared by all phases)

`RealPlay`/`RawPlay` grow optional fields:

| field | on kinds | meaning | unlocks |
|-------|----------|---------|---------|
| `fd`  | pass/rush/rec | first down gained | 1st-down knobs, per-position via existing `pos` |
| `cp`  | pass | completed (vs incompletion — today both are 0-yd rows) | completions / incompletions / attempts / 25+ comp game |
| `sk`  | pass | QB was sacked on this dropback | QB-sacked knob; excludes sacks from attempts |
| `tp`  | pass/rush/rec | 2-pt conversion (scores 2-pt knob, not TD) | 2-pt pass/rush/rec |
| `rk`  | return | `'kr'` \| `'pr'` | separate kick-return vs punt-return yardage |
| `tt`  | tackle | `'s'` \| `'a'` | solo/assist splits |

New kinds (rows existing scorers skip): `tfl`, `qbhit`, `pd`, `ff` (IDP);
`blk` (DEF blocked kick); `pa`, `ya` (DEF game-summary rows, `y` = points /
yards allowed — brackets map in the scorer); `punt` (punter row, `y` =
distance — groundwork for position P).

## Phase 1 — Offense truth flags (`fd` `cp` `sk` `tp`)

The biggest normie payoff on the smallest surface, and the live layer is
**already branch-aware**: the ESPN adapter knows completion vs incompletion
vs sack at parse time (it's three different typeText branches) — it just
doesn't emit the distinction. First downs derive from `start.down/distance`
(already parsed for the drive builder) + statYardage; 2-pt from play text.
Bake side reads `first_down*`, `complete_pass`, `sack`, `two_point_*`
straight off the raw pbp columns (verified present).

New knobs (~12): pass/rush/rec first-down bonuses (per-position free — the
scorer knows `pos`), pass completed / incomplete / attempts, 25+ completion
game, QB sacked, 2-pt pass/rush/rec.

Ships as: core shape + scorer + bake regen + adapter + migration (sanitizer
whitelist) + probes + unit suite + parity + APK. **~1 session.**

## Phase 2 — Special teams + team brackets (`rk` `blk` `pa` `ya` `punt`)

- KR/PR yardage split (`rk` flag; today one combined `return`).
- Blocked kicks → DEF `blk` rows (ESPN types them; bake has the columns).
- **Points-allowed + yardage-allowed brackets**: worker emits one `pa`/`ya`
  summary row per DEF at game final (live: from the per-play score already
  in the ESPN summary; bake: `get_fantasy_pbp` ships a ready-made
  points_allowed per team-game). Sleeper's 8 PA brackets + 10 YA brackets
  become one scorer mapping each.
- `punt` rows land as groundwork (knobs stay hidden until position P
  exists). OPEN: punter attribution in the slim upstream columns — confirm
  `punter_player_id` or request it before building position P.

**~1 session.** Coach scoring (HC pseudo-player scoring off the same
game-summary pattern: result + margin) is cataloged and deliberately NOT in
scope until HC is a draftable position.

## Phase 3 — IDP fidelity (`tt` + `tfl` `qbhit` `pd` `ff`, halves, yards)

Bake side is exact: `get_fantasy_pbp idp=true` emits every event
per-defender with gsis ids (verified: one sack play fanned out to
solo-tackle + TFL + sack + QB-hit on the same defender). Live side is the
honest constraint: ESPN play text lists tacklers (solo = one name, assist =
list) and TFL derives from negative yards, but **QB hits and passes
defended are not reliably in live text.**

DECISION NEEDED before build: live-approximate then true-up from nflverse
when the week's data lands (the worker already has a diff-sync pattern), or
score only what live carries and let the exact bake govern finished weeks.
True-up means a player's IDP points can tick up ~a day after the game;
live-only means QB-hit/PD knobs read 0 until the true-up exists anyway.
Recommend: ship `tt`/`tfl` (live-derivable) first, hold `qbhit`/`pd` knobs
until the true-up loop exists.

**~1–2 sessions** after the decision.

## Costs and risks (all phases)

- **Re-bake churn**: 2025 + preseason weeks regenerate with new fields.
  Flags are additive → drip totals and existing classic totals are
  byte-identical (parity suite is the proof gate on every phase).
- **Payload**: flags are ~free; Phase 3 adds defensive event rows
  (~+30% rows on defensive streams). Watch baked bundle + live_play sizes;
  the 31.35MB APK margin is thin (~97KB) — may force splitting baked data
  or trimming demo weeks.
- **Live-vs-bake fidelity skew** (Phase 3): the same play can carry less
  detail live than baked — the true-up decision governs.
- **Knob sprawl**: catalog goes 60 → ~80. Editors auto-render; add a MISC
  section and keep bands collapsed like Sleeper does.

## Order

Phase 1 → 2 → 3, each behind the normal ship ritual, each independently
shippable. Nothing blocks on external data except the punter-attribution
confirm (Phase 2, punters only) — everything else was verified present in
this session's pulls.
