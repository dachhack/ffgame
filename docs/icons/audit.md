# Icon audit — what's custom, what's still emoji

_Snapshot taken at v0.292.0._

## How icons work today

`src/app/gameIcons.tsx` is the whole icon system. It exposes an **icon set**
switcher (Settings, persisted like the theme) over three skins:

| set | status | assets |
|---|---|---|
| `emoji` | default | none — raw glyphs |
| `factory` | **the custom set** | `public/icons/factory/*.png` (31 files, complete) |
| `pixel` | parked — hidden from the picker | `public/icons/pixel/` (empty, README only) |

Art is addressed by basename: `${BASE_URL}icons/${set}/${name}.png`. Sets share
filenames, and `GameIcon` falls back to the emoji at runtime via `onError`, so a
new set can be filled in piecemeal.

Three components consume it:

- `PuIcon({ id })` — looks the power-up id up in `PU_ART`
- `FxIcon({ k })` — looks a narration-beat key up in `FX_ART`
- `GameIcon({ name })` — direct, used for `COIN_GOLD`, `COIN_SILVER`, `BRAND_MARK`, `UI_ART`

**Anything that does not go through those three components is a hardcoded emoji
string and is unaffected by the icon-set switcher.** That is the bulk of the app.

## The numbers

Scanning `src/`, `apps/`, `packages/`, `server/`, `index.html` for pictographic
characters:

| category | distinct | occurrences |
|---|---|---|
| Routed through the icon system (has custom art) | 15 | 18 |
| Power-up data `icon:` fields | 36 | 40 |
| **Raw, hardcoded in UI** | **106** | **674** |
| In comments only | 23 | 52 |

So: **31 custom assets cover the icon system; ~674 emoji occurrences across
~106 distinct glyphs are not custom.**

---

## 1. Power-ups — 20 of 40 have art

`POWERUPS` in `packages/core/src/data/powerups.ts` defines 40 power-ups, each
with an `icon` emoji. `PU_ART` in `gameIcons.tsx` maps 20 of them to factory art.
The other 20 render their emoji in every icon set.

### Missing art (20)

| emoji | id | name | timing | what it does |
|---|---|---|---|---|
| 🐕 | `unlock-underdog` | Underdog | pre | metric unlock — flat yardage, scores count double when trailing |
| 🔊 | `amp-2` | Second Amp | pre | run a 2nd amplifier this week |
| 📢 | `amp-3` | Third Amp | pre | run a 3rd amplifier this week |
| 🌊 | `floodgates` | Floodgates | pre | drips immune to opponent pauses/erases |
| 🎖️ | `fg-stack` | Twin Generals | pre | two Field General QBs stack multipliers |
| ↩️ | `counter-nuke` | Counter-Nuke | pre | first incoming nuke reflects back |
| ⚔️ | `rivalry` | Rivalry | pre | siphon 30% from same-position opponents |
| 🔀 | `lead-change` | Lead Change | pre | bonus each time you seize a head-to-head lead |
| 🥊 | `grudge` | Grudge Match | pre | win a slot by 10+ for +25, lose it and you're penalised |
| 🧿 | `jinx` | Jinx | pre | negate an opponent's first TD (blind) |
| 🎣 | `red-herring` | Red Herring | pre | cap opposing same-position players in a window |
| 🪂 | `bye-steal` | Bye Steal | pre | field a bye player for a flat projected score |
| 👻 | `ghost` | Ghost Player | pre | conjure a phantom into an open slot for a flat 14 |
| ⚡ | `surge` | Surge | live | your slot scores double for 10 game-minutes |
| 🧊 | `cold-snap` | Cold Snap | live | freeze an opponent slot's scoring for 10 game-minutes |
| 🔥 | `napalm` | Napalm | live | opponent's hot drip burns instead of accruing |
| 🛡️ | `bunker` | Bunker | live | your slot goes immune to nukes/erases |
| 🎰 | `clutch-don` | Halftime Gamble | live | CLUTCH — double or nothing on a halftime lead |
| 🎬 | `clutch-encore` | Encore | live | CLUTCH — bonus on a second-half TD |
| 🪃 | `clutch-counter` | Counter-Wipe | live | CLUTCH — negate a nuke just after it lands |

Note ⚡, 🔥, 🧊, ⚔️ and 🔀 are **reused elsewhere** in the UI for unrelated things
(Field General multiplier, HOT chip, cold streak, window battle, metric swap) —
distinct art removes that collision.

### Already has art (20)

`metric-swap` `player-swap` `extra-slot` `unlock-return` `unlock-carries-wipe`
`unlock-combo-drip` `unlock-pass-td10` `trick-play` `pick-six` `hail-mary`
`momentum` `garbage-time` `overtime` `ot-shield` `insurance` `double-or-nothing`
`spy` `mulligan` `emp` `turnover-boost`

---

## 2. Live events & recap moments — 5 of 20 have art

`FX_ART` covers `nuke`, `erase`, `power`, `coin`, `freeze`. Two other icon maps
have no art at all.

### `packages/core/src/data/demoNarration.ts` — narration beats

| emoji | key | beat |
|---|---|---|
| 🔥 | `hot` | drip rate doubled on an unanswered streak |
| 🧊 | `cold` | hot streak cooled back down |
| 💧 | `drip` | points trickling in while the team has the ball |
| ↺ | `reset` | opponent's drip rate zeroed |
| ⏸ | `stop` | drip clock frozen — denial, no erase |
| 🗜️ | `compression` | carry streak trimming the opponent's last score |
| ⚡ | `mult` | Field General QB multiplying his skill players |
| 🛟 | `backup` | unopposed slot banks as backup (`DemoBoard.tsx:439`) |

### `packages/core/src/engine/moments.ts` — end-of-game recap moments

| emoji | kind |
|---|---|
| ↩️ | `counter` |
| ✕ | `shutdown` |
| 💥 | `carrywipe` |
| 📉 | `tenuke` |
| ⇄ | `flip` |
| 🚨 | `walkoff` |
| 📸 | `photo` |

---

## 3. UI chrome — none of it is custom

`UI_ART` covers exactly four: `rulebook`, `admin`, `scout`, `liveboard`.
Everything else below is a hardcoded emoji in JSX. Web (`src/`) and native
(`apps/mobile/`) mostly duplicate the same glyph.

### Navigation & league hub

| emoji | used for | e.g. |
|---|---|---|
| 🏠 | LEAGUE tab | `src/app/LeagueStrip.tsx:74` |
| 💬 | chat tab, chat sheet header, DM list | `src/app/chat.tsx:162` |
| ⛏ | DRAFT tab, draft room header, "to the draft room", pick labels | `src/app/LeagueStrip.tsx:76` |
| 👥 | SEATS tab, "Teams & rosters" tile | `src/screens/LeagueHubPage.tsx:287` |
| 📜 | League register tile | `src/screens/LeagueHubPage.tsx:295` |
| 📣 | Recruit tile, league board | `src/screens/LeagueHubPage.tsx:302` |
| 🔔 | Alerts tile, enable-push buttons | `src/screens/LeagueHubPage.tsx:298` |
| 🧢 | Roster settings tile | `src/screens/LeagueHubPage.tsx:297` |
| 🏆 | PLAYOFFS tab, champion banner, generate bracket | `src/screens/AdminPage.tsx:1114` |
| 👑 | league champion | `apps/mobile/src/ui/LeagueExtras.tsx:172` |
| 📅 | ALL MATCHUPS | `src/screens/LeagueOverview.tsx:72` |
| 📺 | GAME LOG header | `src/screens/Matchup.tsx:2692` |
| 🛒 | POWER-UP SHOP | `src/screens/Matchup.tsx:1577` |
| 📖 | "how scoring works" — the Rulebook entry does use `UI_ART.rulebook`, this button doesn't | `src/screens/Matchup.tsx:1465` |
| ❓ | FAQ | `src/app/ui.tsx:338` |

### Commissioner & admin

| emoji | used for | e.g. |
|---|---|---|
| ⚙ | super admin header, ADMIN MODES tab, DRAFT SETUP | `src/screens/AdminPage.tsx:209` |
| ⚖ | SCORING panel, scoring label, score-diff debug | `src/app/commishKit.tsx:123` |
| 🧩 | ROSTER tab, roster builder, extra positions | `src/screens/CommishDash.tsx:466` |
| 🎮 | MODE & SEASON tab, classic availability | `src/screens/AdminPage.tsx:1095` |
| 🏰 | DYNASTY continuity chip | `src/screens/NativeLeague.tsx:274` |
| 🔁 | NEXT SEASON tab, TRADE BLOCK, auto-subbed backups | `src/screens/AdminPage.tsx:1115` |
| 💰 | FAAB wallets, FAAB mode toggle | `src/screens/AdminPage.tsx:394` |
| 🪙 | window pot toggle, coin swing chip | `src/screens/AdminPage.tsx:2324` |
| ⏳ | waiver wire, waiver hold countdown | `src/screens/AdminPage.tsx:717` |
| 🌙 | overnight pause / quiet hours | `src/screens/NativeLeague.tsx:865` |
| 🕒 | daily-at-a-set-time, daily FA window | `src/screens/AdminPage.tsx:555` |
| 🧪 | live-test mode chip and toggle | `src/screens/AdminPage.tsx:2104` |
| 🧬 | re-seed rosters | `src/screens/AdminPage.tsx:2223` |
| 👁 | ACTIVITY tab, "VIEWING AS … READ ONLY" | `src/screens/AdminPage.tsx:2517` |
| 🌐 | "browse as them" | `src/screens/AdminPage.tsx:2530` |
| ⛓ | copy invite link | `src/screens/LiveOnboard.tsx:1620` |
| ✉ | send invite / send link | `src/screens/AdminPage.tsx:1822` |
| 🗑 | delete mock, delete league | `src/screens/NativeLeague.tsx:1042` |
| ✂ | cut player to free agency | `apps/mobile/src/ui/LeagueExtras.tsx:308` |
| ✏️ | name a lineup spot | `apps/mobile/src/screens/CommishTools.tsx:1702` |
| 🏷 | NAME & CREST tab | `apps/mobile/src/screens/CommishTools.tsx:57` |
| 🖼 | team art / "pick a crest", GIF in chat | `apps/mobile/src/screens/Team.tsx:463` |
| 🧑 | PLAYERS tab | `apps/mobile/src/screens/CommishTools.tsx:67` |
| 🤖 | MOCK DRAFT, autopick marker, AI-controlled seat | `src/screens/NativeLeague.tsx:245` |
| 👤 | human-controlled seat | `apps/mobile/src/screens/CommishTools.tsx:1004` |
| 💾 | SAVE ENTRY | `src/screens/PodBuilder.tsx:196` |
| 🚫 | roster restriction flags (no trade / add / start / powerups) | `src/app/commishKit.tsx:331` |
| 🛡 | "immune" roster flag | `src/app/commishKit.tsx:335` |

### Draft room

| emoji | used for | e.g. |
|---|---|---|
| ⏱ | on the clock, draft countdown | `src/screens/NativeLeague.tsx:894` |
| 🎲 | randomize draft order | `src/screens/NativeLeague.tsx:619` |
| 🐢 | SLOW pace chip | `src/screens/NativeLeague.tsx:318` |
| 🕶 | MAX pace chip | `src/screens/NativeLeague.tsx:958` |

### Board & matchup

| emoji | used for | e.g. |
|---|---|---|
| 🏈 | has-the-ball marker, NORMAL/classic mode chip | `src/app/FieldView.tsx:324` |
| 🔒 | lineup locked, SEALED PICK, premium gate | `src/app/cardTable.tsx:609` |
| 🔓 | picks revealed, unlock week | `src/screens/DemoBoard.tsx:584` |
| 🃏 | CARDS view toggle, empty hand | `src/app/cardTable.tsx:806` |
| ☠ | nuked slot | `src/app/cardTable.tsx:604` |
| 🔥 | HOT chip on a live card | `src/app/cardTable.tsx:612` |
| ⚡ | Field General multiplier chip | `src/app/cardTable.tsx:732` |
| 🎯 | BEST BALL spot | `src/screens/ClassicBoard.tsx:850` |
| ⚔ | WINDOW BATTLE header | `src/screens/Matchup.tsx:2756` |
| ⭐ | window MVP / final MVP | `src/screens/MatchupFinal.tsx:184` |
| 🛟 | unopposed — banks as backup | `src/screens/DemoBoard.tsx:985` |
| ⚠ | lineup-lock warning, roster over limits, save errors | `src/screens/NativeLeague.tsx:1759` |
| 🏟 | stadium roof indicator | `src/screens/ClassicBoard.tsx:67` |
| 👁️ | SPY INTEL banner | `src/screens/Matchup.tsx:2273` |

### Chat & social

| emoji | used for | e.g. |
|---|---|---|
| 📊 | poll message, vote count, create-poll button | `src/app/chat.tsx:314` |
| 📌 | pinned messages header and per-message pin | `src/app/chat.tsx:280` |
| 👀 | trade-block interest marker and count | `src/screens/NativeLeague.tsx:2274` |
| 🔎 | lineup-spot eligibility filter | `src/screens/CommishDash.tsx:506` |
| 🔍 | SCOUT — **web routes this through `UI_ART.scout`; the native app hardcodes it** | `apps/mobile/src/ui/SetupRow.tsx:109` |
| ⬆ | new-version reload banner | `src/app/UpdateBanner.tsx:44` |
| ✨ | autofill best lineup | `src/screens/Matchup.tsx:1464` |

### Recommend leaving as text glyphs

These already match the app's geometric mark language (◈ ◇ ★ ▤ ⠿ ▾ ▸) and read
better as type than as raster art — they're aligned to the baseline, they inherit
`color`, and they scale with `font-size`:

`▶` `◀` `⏸` `⏭` `⏩` `↩` `⤴` `↗` `➕` `➖` `☑` `☐` `✕` `⇄` `↺` `↔`

---

## 4. The native app has no icon system at all

`apps/mobile/` does not import `gameIcons.tsx` — no `GameIcon`, no `PuIcon`, no
`iconSet`. There is no React Native equivalent. Every glyph there is a literal
inside a `<Text>`:

| | occurrences | distinct |
|---|---|---|
| `src/` (web) | 423 | 92 |
| `apps/mobile/` (native) | 272 | 62 |

So even the 31 assets that exist today only ship on web. Bringing the custom set
to native means porting `GameIcon` to an RN `<Image>` (the art is plain PNG, so
this is small) and adding the icon-set toggle to the native settings — and it
should happen before or alongside the Tier 3 refactor, or the two codebases
diverge further.

---

## What it takes to actually adopt Tier 3

Tiers 1 and 2 are **data-only**: drop the PNGs in `public/icons/<set>/` and add
the entries to `PU_ART` / `FX_ART`. No component changes.

Tier 3 is **not** wired up. Each of those ~674 occurrences is a literal in a
string or JSX. Adopting them means adding the names to `UI_ART` and replacing
each literal with `<GameIcon name={UI_ART.x} emoji="…" />`. That is a real
refactor and worth doing incrementally, highest-traffic screens first
(`LeagueStrip`, `LeagueHubPage`, `cardTable`, `chat`, `AdminPage` tabs).

Also worth noting: several glyphs are load-bearing inside template strings and
`title=` attributes, where a React element can't go. Those need a small helper
or a text-only fallback.
