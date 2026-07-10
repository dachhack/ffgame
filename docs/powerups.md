# Drip Fantasy — Power-Up Handbook

The complete guide to every power-up: what it does, when you can play it, what it
targets, and how to use it. There are **38** power-ups across the classes below.

> Costs and effect text are the source of truth in `src/data/powerups.ts` (and the
> auto-generated tables in the [Rulebook §8](./rulebook.md)). This handbook adds the
> *class*, *targeting*, and *strategy* context. If a number here disagrees with the
> game, the game wins.

## How power-ups work

You earn **drip-coin** (◎) each week and spend it on power-ups — bought into your
inventory, then applied when you want them. Two mechanical kinds:

- **action** — a one-time tactical effect (a swap, a stake, a freeze…).
- **metric** — unlocks an extra, normally-locked metric for the current week only.

And two **timings** that gate *when* you can apply one:

- **pre** — arm during setup; locks the moment the week's **first** window kicks off.
- **live** — fire only while a window is **live**, and only *going forward* (never
  retroactive). A subset of live plays are **clutch** — they don't even appear until
  a live game-state trigger unlocks them, and then only for a short window.

Targeting: some power-ups are whole-lineup arms (one click), some point at **a
window**, some at **one of your slots**, and some at **an opponent slot** (often
blind, before you can see their pick).

---

## 1. Amplifiers & week-long buffs
*pre · whole-lineup · shape how your whole week scores*

| Power-up | ◎ | Effect | Strategy |
|---|---|---|---|
| 📈 **Momentum** | 70 | Your drips run **×3 when hot** instead of ×2, all week. | Best on rosters built around one or two high-ceiling drips you expect to go hot. |
| 🗑️ **Garbage Time** | 75 | Any points in the **final 5 game-minutes count double**. | Rewards late-game volume — comeback rosters and shootout scripts. |
| ⏱️ **Overtime** | 60 | Your Field General multiplier and drips **carry into overtime** (they reset at regulation otherwise). | Only worth it when you expect OT value — pairs with drip-heavy lineups. |
| 🧊 **Overtime Shield** | 70 | Any points your **opponent** scores in overtime are **negated**. | A defensive OT hedge — denies their late swing. |
| 🌊 **Floodgates** | 85 | Your drips are **immune to opponent pauses and erases** all week (TD wipes still apply). | The hard counter to an eraser-heavy opponent; protects fragile WR/RB drips. |
| 🦅 **Ball Hawk** | 55 | Raises the **turnover coin swing 10 → 25** all week — your giveaways cost more, theirs pay more. | An economy play; leans on clean-ball rosters. |

**Amplifier capacity.** Momentum, Overtime, and Garbage Time are **amplifiers** and
you may run **one per week** by default. The two below raise the cap:

| Power-up | ◎ | Effect |
|---|---|---|
| 🔊 **Second Amp** | 40 | Run a **second** amplifier alongside the first. |
| 📢 **Third Amp** | 60 | With Second Amp armed, unlock a **third** — the full Momentum + Overtime + Garbage stack. |

---

## 2. Coordination & protection
*pre · whole-lineup · reactive and stacking effects*

| Power-up | ◎ | Effect | Strategy |
|---|---|---|---|
| 🎖️ **Twin Generals** | 85 | A second **Field General** QB in the same window **stacks** — the top two multipliers multiply together instead of you taking the higher one. | For 2-QB / superflex rosters running a Field-General window. |
| ↩️ **Counter-Nuke** | 95 | The **first** time an opponent nukes one of your slots, it's **reflected** — their player is wiped instead. | A trap for a nuke-heavy opponent; the priciest arm, but it can swing a slot twice over. |
| 🛟 **Insurance** | 80 | The first time one of your slots is nuked, **half** its banked score is refunded instead of zeroed. | The softer counter to nukes — cheaper, always pays something. |

---

## 3. Flat-bonus arms
*pre · whole-lineup · a lump payout if a condition hits*

| Power-up | ◎ | Pays | Condition |
|---|---|---|---|
| 🎺 **Trick Play** | 90 | **+50** | Any **non-QB** in your starting spots throws a TD pass this week. |
| 🛡️ **Pick Six** | 45 | **+25** | Any of your **DST** starters returns an INT/fumble for a TD. |
| 🙏 **Hail Mary** | 35 | **+15** | A **QB** in your starting spots throws a **40+ yard** TD. |

Longshot lottery tickets — cheap-ish, but they whiff if the trigger doesn't happen.

---

## 4. Metric unlocks
*pre · metric · enable a normally-locked metric for the week*

| Power-up | ◎ | Unlocks |
|---|---|---|
| 🚀 **Air Raid** | 40 | A QB metric where passing TDs are worth **10** (plus 0.04/yd). Flat. |
| 🌀 **Combo Drip** | 65 | A **Rush + Receiving** combo drip for ONE player (carries *and* catches feed one rate). One slot per purchase — buy again to field another. |
| 🏈 **Return Yards** | 60 | The **Return Yards** drip for a returner (position yardage *and* kick/punt returns feed one rate). |
| 💥 **WR/TE Carries** | 70 | All week, **every carry by a WR or TE** in your starting spots **wipes its matched opponent to 0** — on top of whatever that slot is scoring. |

---

## 5. Roster & info plays
*pre · bend the board before kickoff*

| Power-up | ◎ | Target | Effect |
|---|---|---|---|
| ➕ **Extra Slot** | 80 | window | Add a slot to any window — **for you AND your opponent**. Must be applied before any window starts. |
| 🪂 **Bye Steal** | 55 | empty slot | Field one of your **bye-week** players in an open slot for a flat projected score. |
| 👻 **Ghost Player** | 75 | empty slot | Conjure a **phantom** into any open slot — **no bench player needed**. It banks a flat **set 14 points**, guaranteed. Pricier than a Bye Steal, but its floor is certain and it works even when you have nobody on bye. |
| 👁️ **Spy** | 40 | opponent slot | Pick any slate slot (blind) and reveal the opponent's current sealed pick there — their **player OR metric**. Re-checking is free; they can still change it. |

---

## 6. Targeted bets (pre-kickoff)
*pre · point at a slot before kickoff · high-risk, high-reward*

These are blind or semi-blind gambles you place before the lineups reveal — the
core of the "every slot is a battle" layer.

| Power-up | ◎ | Target | Effect | The risk |
|---|---|---|---|---|
| ⚖️ **Double or Nothing** | 80 | your slot | At final the slot scores **×2 if it wins** its head-to-head, **0 if it loses**. | A coin-flip on one slot's fight. |
| 🥊 **Grudge Match** | 60 | your slot | **Win by 10+ → +25**; **lose → −25**; win by <10 → nothing. | Double-or-Nothing with a real downside — you need a *decisive* win. |
| 🔀 **Lead Change** | 45 | your slot | **+2** every time you **seize the lead** in that slot (overtake after trailing). | Pays in a dogfight; a wire-to-wire blowout you never trailed in earns nothing. |
| ⚔️ **Rivalry** | 70 | window (blind) | For every slot where the opponent fields the **same position** as you, **siphon 50%** of their slot score to you at window's end. | Whiffs entirely if they don't mirror your position — a bet on how they build the window (and they can dodge it). |
| 🎣 **Red Herring** | 90 | your slot (decoy) | Every **opposing player of the same position** anywhere in that window is **capped to your player's total**. | Field a low decoy to cap their studs — but you waste the slot, and it whiffs if they field nobody at that position. |
| 🧿 **Jinx** | 55 | opponent slot (blind) | The **first touchdown** the player there scores is **negated** — no points, and if it was a nuke, no nuke. | Whiffs if they don't score a TD there — a bet on reading their stud. |

---

## 7. Live tactical plays
*live · fire mid-window, reacting to the game*

| Power-up | ◎ | Target | Effect | When to fire |
|---|---|---|---|---|
| ⚡ **Surge** | 55 | your slot | Everything the slot scores for the next **10 game-minutes counts double**. | When your player catches fire. |
| 🧊 **Cold Snap** | 60 | opponent slot | **Freeze ALL** of that player's scoring — points and drip — for 10 game-minutes. | Shut a hot rival down cold. |
| 🔥 **Napalm** | 60 | opponent slot | For 10 game-minutes, any time their drip runs **HOT it BURNS** — the hot accrual goes **negative** and bleeds their bank instead of doubling it. | Punish a rival running too hot; does nothing while they stay cool. |
| 🛡️ **Bunker** | 65 | your slot | The slot goes **immune to every nuke and erase** for the rest of the game from the moment you fire. | Lock in a lead before they can wipe it. |
| 💥 **EMP** | 65 | window | **Freeze every opponent drip** in that window for 10 game-minutes. | Blanket the whole window when several rivals are dripping. |

### Live swaps

| Power-up | ◎ | Effect |
|---|---|---|
| 🔀 **Metric Swap** | 30 | Change a slot's effective metric — applies going forward, not retroactive. |
| 🔁 **Player Swap** | 50 | Swap a slotted player for one on your bench, even mid-game. |
| 🎲 **Mulligan** | 30 | Re-roll one slot's metric mid-game **for free** — doesn't spend a Metric Swap. |

---

## 8. Clutch plays (conditional)
*live · unlock only from a live trigger, arm-able for a short window*

The newest class: these **don't appear** until a specific thing happens in a live
slot, and you can only arm them for a limited window after. Buy them in advance so
they're ready when the moment comes — a pulsing **CLUTCH** offer appears right on
the slot when the trigger fires.

| Power-up | ◎ | Unlocks when… | Effect |
|---|---|---|---|
| 🎰 **Halftime Gamble** | 50 | one of your slots leads by **10+ at halftime** (arm before Q3 develops) | That slot scores **×2 if it wins**, **0 if it loses**. |
| 🎬 **Encore** | 45 | your player scores a **first-half TD** (arm any time before the end) | His **next touchdown banks a bonus +12**. |
| 🪃 **Counter-Wipe** | 55 | an opponent **nukes one of your slots** (arm in the short window after) | The **wipe is negated** — your bank is restored as if it never landed. |

---

## Quick reference — all 38, cheapest first

| ◎ | Power-up | Timing | Class |
|---|---|---|---|
| 30 | Metric Swap · Mulligan | live | swap |
| 35 | Hail Mary | pre | flat-bonus |
| 40 | Air Raid · Spy · Second Amp | pre | unlock / info / amp |
| 45 | Pick Six · Lead Change · Encore | pre / clutch | bonus / bet / clutch |
| 50 | Player Swap · Halftime Gamble | live | swap / clutch |
| 55 | Ball Hawk · Bye Steal · Jinx · Surge · Counter-Wipe | pre / live | various |
| 60 | Overtime · Return Yards · Third Amp · Grudge Match · Cold Snap · Napalm | pre / live | various |
| 65 | Combo Drip · EMP · Bunker | pre / live | unlock / live |
| 70 | Momentum · Overtime Shield · WR/TE Carries · Rivalry | pre | various |
| 75 | Garbage Time · Ghost Player | pre | amp / bet |
| 80 | Extra Slot · Insurance · Double or Nothing | pre | various |
| 85 | Floodgates · Twin Generals | pre | buff / coordination |
| 90 | Trick Play · Red Herring | pre | bonus / bet |
| 95 | Counter-Nuke | pre | protection |

---

*Companion to the [Scoring Rulebook](./rulebook.md). Regenerate the rulebook's
auto tables with `npm run gen:rulebook`.*
