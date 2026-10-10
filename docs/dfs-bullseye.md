# DFS Bullseye (v0.660.0)

Founder: "we need to build a dfs-style version of bullseye." Chosen:

- **Both formats**: one open weekly contest anyone signed in can enter, ranked
  on one leaderboard; and a Bullseye switch for private salary-cap (`dfs`)
  leagues, which keep their head-to-head weeks and standings.
- **Variant per contest**: SLOTS (a target per squad slot) or TOTAL (one
  target for the squad). The admin picks the open contest's each week; a
  commissioner picks their league's.
- **The $50k cap stays**, on the same frozen weekly salary board (`pod_salary`).
- **Web and phone.**

Classic Bullseye is docs/bullseye.md; everything about the dart (the ring
curve, the zero rule and penalty, the radius) is that spec, unchanged.

## 1. The squad and the card

A squad is the salary-cap shape every contest league already uses — QB, RB,
RB, WR, WR, WR, TE, K, D/ST, $50,000 — but each player sits in a NAMED slot:
`QB RB1 RB2 WR1 WR2 WR3 TE K DEF`. Under SLOTS that is the game: the card
might say RB1 15 / RB2 5, and which back you aim at which number is the
decision.

The card is dealt per (contest league, week) with classic Bullseye's dealer
(`dealBullseyeCard`) over those nine slots and the stock catalog (contests
score standard full PPR) — seeded, so the worker, both clients and a probe all
deal the same numbers. TOTAL shows only the sum.

## 2. Containers

- **The open contest** is a league of a new kind, `bullseye`, one per
  (season, week): `contest_week` = the week, no seat limit. Joining takes the
  next seat number. Saving a first entry creates that seat's scoring row — a
  matchup row paired with ITSELF (home = away = the seat), which the existing
  lock → live → final lifecycle and resolver drive like any other.
- **A private contest league** (`dfs`, 0094) turns it on with
  `settings_json.dfs_bullseye`. Its weekly head-to-head pairing, AI seats and
  no-show auto-builds are unchanged — except that an auto-build AIMS at the
  card instead of maximising projection.

Both carry `settings_json = { dfs_bullseye: true, bullseye: 'slots'|'total',
bullseye_radius }`.

## 3. Entries

`save_bullseye_entry(league, week, slots)` takes `{QB: slug, RB1: slug, …}`:
the board, the shape (each slot's position), no duplicates, the cap, and the
per-player lock (1 hour before his own game; a locked player can't be added
or removed — 0093's late-swap rule). Stored in `sleeper_lineup.starters_json`
in slot order with the slot NAME on each row. A squad saved the old way
(`save_pod_entry`, numbered slots) is read in position order.

## 4. Scoring

A resolver branch for `dfs_bullseye` leagues, ahead of classic and drip: each
side's squad from `sleeper_lineup`, each player scored with `classicPoints`
under stock PPR, the card applied with `applyBullseye` — ring totals become
the matchup's scores and finals, the dart rides on each slot row (`aim`), as
in classic. Rows are the classic `'wk'` window, so nothing reveals before the
week's first kickoff. Lock's drip auto-lineup skips these leagues.

## 5. Boards

- Open contest: `bullseye_contest_board(league)` — every entrant ranked by
  ring total (live from `matchup_state` while games play, the final after),
  top 100 plus the caller's own row. Open to anyone signed in; entries are
  shown once the week has kicked off.
- Private league: its matchups and standings, as before, in rings.

## 6. Controls

- Admin: `set_bullseye_contest(week, variant, radius)`, until the contest's
  first lock. Default SLOTS, radius 10.
- Commissioner: `set_dfs_bullseye(league, variant|null, radius)` — off, SLOTS
  or TOTAL; refused while any of the league's matchups is live.
