# Shotgun Wedding — a forced, fair trade between every week's opponents

> **Status: BUILT, v0.653.0; house rules v0.654.0** (migrations `0453_shotgun_wedding.sql`, `0454_shotgun_wedding_house_rules.sql`,
> `server/src/shotgun.js`, core `engine/shotgunWedding.ts`). Founder: "a
> fantasy mode like vampire where after each weekly matchup early AM Tuesday
> the CPU creates a fair, 4 total player trade from opposing teams. The trade
> is auto accepted by both teams by 8 pm EST unless the team that won the
> matchup declines the trade. Teams can negotiate the trade but unless they
> come to an agreement, the original trade goes through. Players chosen for
> the original trade are locked from all roster movement until after the
> deadline." Named Shotgun Wedding; "build it for redraft classic only."

## 1. The week

| When (Eastern) | What happens |
|---|---|
| Monday night | The week's games finish. Finals keep being re-stamped for stat corrections until the 4 AM report release. |
| **Tuesday 5 AM** | The worker files one wedding per matchup: a 2-for-2 between the two opponents. A chat card names all four players, the deadline and who may call it off. Any open trade offer naming one of the four is cancelled. |
| Tuesday, all day | The four players are locked. The winner may **call it off**. Either team may **propose new vows**, and if the other says yes, that trade happens at once and replaces the original. |
| **Tuesday 8 PM** | Whatever is still pending goes through. If a player moved anyway (a commissioner's force-move), it fails cleanly and nobody trades. |

**House rules (v0.654.0, migration 0454).** The commissioner picks two things,
read when each wedding is filed, so a change starts the following Tuesday:

| Setting | Options | Default |
|---|---|---|
| Who can call it off (`shotgun_veto`) | **Winner** (winning earns the veto) · **Loser** (a mercy rule) · **Nobody** (only new vows both sides agree to change it) | Winner |
| Deadline (`shotgun_deadline`) | **Tue 8 PM ET** · **Wed 8 PM ET** · **Thu noon ET** | Tue 8 PM |

- A deadline after the Wednesday waiver run works: a claim that would drop
  one of the four is refused at the run, like any locked drop. The "on" card
  says so when a later deadline is set.
- Whatever the setting, the deadline never lands inside the hour before the
  next week's first kickoff (it is pulled forward to that hour).
- The wedding row keeps its own `veto_seat` and `veto_rule`, so the card and
  the decline follow the rule it was announced under.
- `ops/run` mode `shotgun-preview` prints what the CPU would file for a
  league, read-only, seats by number.

- **A tie has no winner**, so nobody can call it off. The two can still agree on new vows.
- **Golf leagues**: the winner is the low score (`golf_beats`), the same rule the standings use. Bullseye leagues read the same way.
- **Playoff weeks, practice weeks and anything after the trade deadline** get no wedding.
- A worker that was down Tuesday morning files on its first tick back. After 6 PM it files nothing for that week: a wedding needs time to talk.

## 2. What "fair" means

The CPU's pick is core's `weddingPlan`. It is pure: two active rosters in, one 2-for-2 out.

- Each player is valued in **season points over replacement** in the league's own scoring. That is the trade grader's number (`data/tradeGrade`), so a wedding the CPU calls fair is one the app's trade grade prints as "Close to even".
- The two sides must sit inside the grader's **even band**: 12 points or 12% of the deal, whichever is wider (`evenBand`).
- Every player in it is worth something over replacement. Only when a side has fewer than two such players does it fall back to raw season points for both sides.
- It never leaves a team unable to fill a starting spot it could fill before. Nobody's only quarterback gets traded.
- Among the fair pairs it draws from the **weightiest quarter**, with a seed of league, week and matchup. The same inputs always give the same wedding; different weeks don't repeat the same shape.

## 3. The lock

Until the wedding settles, the four players cannot move:

- **Drops, add-with-drop, waiver claims and the waiver run** ask `drop_lock_reason`, which now asks `_wedding_lock` first. The refusal reads "💍 *Name* is in a Shotgun Wedding — he stays put until it's settled (8 PM ET Tuesday)".
- **Trade offers** naming one of them are refused when made (a trigger on `trade_proposal` and `trade_leg`).
- **Everything else**, including IR, taxi and out moves, hits the row guard on `native_roster`.
- The **commissioner's force-moves** still work, as under every lock. The wedding's own execution passes via the `app.wedding` setting.

## 4. Where it lives

- **Switch**: commissioner settings, under Bullseye. Web `CommishDash` LeagueSettings; app `CommishTools` GameModeCard. `set_league_shotgun(league, on)` refuses anything but a classic, redraft, head-to-head (format standard) NFL league, and says why. Turning it off annuls the pending weddings with a chat card.
- **Card**: `ShotgunWeddingCard` on both hosts, on the trades tab and the league home. Your wedding first with CALL IT OFF, PROPOSE NEW VOWS and SAY YES. Everyone else's are one line each.
- **SQL** (`0453`): table `shotgun_wedding`; `shotgun_propose` and `shotgun_sweep` (service role); `shotgun_decline`, `shotgun_counter`, `shotgun_accept_counter`, `shotgun_state`, `set_league_shotgun`. A wedding executes through `execute_trade`, so the cap check, txn register, lineup reset and the "🤝 Trade" chat line are the trade system's own.
- **Worker**: `sweepShotgun` in `tick()`. `shotgun_sweep` runs once a minute; proposing runs every ten minutes inside Tuesday 5 AM to 6 PM ET.

## 5. Pinned

- `scripts/db/shotgun-wedding-probes.sql`: the switch and its refusals, filing rules, golf-aware winner, tie, cancelled offers, every lock path, decline rights, new vows, the deadline, a failed wedding, annul on off.
- `scripts/check-shotgun-wedding.mjs` (in `check:parity`): fairness against the grader's band, shape, the lineup rail, seed stability, the thin-roster fallback, no wedding rather than an unfair one.
- `server/test/shotgun.mjs`: the Tuesday window and the week picker.

## 6. Not yet

- Push notifications for a new wedding or new vows; the chat card is the notice today.
- A 💍 badge on locked players in roster lists; the refusal names the wedding.
- Not confirmed against a live league yet: the first real Tuesday is the test.
