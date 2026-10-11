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

## 7. The tie-breaker (v0.660.1)

Founder: "the CPU picks one spot per team either WR or RB and sets a target
(keeping in mind the overall target and typical contribution of the spot) for
that spot for that team … Distance from this spot target is used for tie
breakers only and is known to the manager before they build their team."

- Per (league, week, seat), seeded: one of RB1 RB2 WR1 WR2 WR3, and a number
  1–4 points either side of that slot's own card target (the card's targets
  are each slot's share of the total, in both variants), never below 3. So
  one team may have RB2 → 12 while its opponent has WR1 → 7.
- Shown to its own manager on the squad screen from the start (⚖️ beside the
  slot), with the live distance once that player has played.
- The distance it lands at is stored with the finals (`home_tb`/`away_tb`).
  A zero there is the target plus the radius. Lower wins.
- Head to head: when two teams' ring totals are equal, the closer tie-break is
  put 0.01 ahead in its final, so every standings, playoff and report reader —
  all of which compare finals — settles it the same way. An equal tie-break
  leaves the tie standing.
- The open contest's standings rank ring total, then tie-break distance.

## 8. Sealed squads (v0.660.1)

"Opposing team picks need to be sealed."

- In a Bullseye contest league a member reads only their own seat's squad
  (`sleeper_lineup` policy); before this any league member could read every
  seat's row — in the open contest, everyone's.
- An opponent's squad comes through `dfs_bullseye_state` one player at a time:
  each shows once his own game locks (an hour before kickoff), the rest are
  their slot and 🔒.
- The scorer writes no row, and scores no zero, for a player whose game hasn't
  kicked off yet, so `matchup_state` (which both sides of a matchup read)
  never names him early.

## 9. Bullseye leagues (v0.661.0, 0463)

Founder: "Let's have it follow more of the league setup pattern though. It's a
league you can create as a commish with 32 max people. I (or people I delegate
to) can create up to 50,000 people leagues. Commish then posts it to the board
for finding. It appears in the listing of my leagues." And: "let's make sure we
have all the league features with bullseye dfs leagues, matchup, league, chat,
team, settings, commish settings". Chosen: the commish picks ONE WEEK or THE
SEASON per league; anyone signed in may start one; the automatic weekly open
contest is retired.

- **Making one.** `create_bullseye_league(name, span, max, variant, radius,
  team)`: kind `bullseye` with a commissioner, an invite code and
  `settings_json { dfs_bullseye, bullseye, bullseye_radius, max_seats, span }`.
  `span = 'week'` sets `contest_week` to the week about to be played;
  `'season'` leaves it null. The creator takes seat 1.
- **Size.** 2–32 for anyone. Up to 50,000 for an admin or an account with the
  `bullseye_host` feature (`admin_set_feature(email, 'bullseye_host', true)`),
  which is how the founder delegates. `set_bullseye_size` changes it, never
  below the people already in.
- **Getting in.** By code (`join_bullseye`, or the link `?bullseye=CODE`), or
  from the league board. Seats are made as people join, so the board counts
  open spots as `max_seats` less the seats taken (`_league_seats_open`), not
  empty seat rows. `join_from_board` takes a Bullseye seat. A one-week league
  leaves the board once its week kicks off.
- **Weeks.** A season league takes a squad for any week from the one in play
  on (`save_bullseye_entry`). Each saved squad is its own scoring row, as in §2.
  The worker builds the salary board for any week a Bullseye league will play.
- **Standings.** `bullseye_league_board(league, week)`: the week ranked by ring
  total then tie-break; a season league also gets the season table, with the
  final ring totals summed (a week without a squad scores nothing).
  `bullseye_my_weeks` is MY TEAM's list.
- **The rooms** (web `src/screens/BullseyeLeague.tsx`, phone
  `apps/mobile/src/screens/BullseyeLeague.tsx`):
  - MATCHUP: the squad screen, with week arrows.
  - LEAGUE: who's in, the invite code, the week's standings and the season's.
  - MY TEAM: my weeks, and my team's name.
  - CHAT: league chat.
  - SETTINGS: the rules, and leaving.
  - COMMISH: the card (variant and radius), the size, the board post (blurb and
    dues), renaming, and deleting.

  On the phone they ride the app's room bar, with ⚙ SETTINGS by the name.
- **The open contest, retired.** `_ensure_bullseye_contest` now only finds a
  contest and never makes one. The week already running finishes as it is;
  after it, `bullseye_contest` answers `retired` and the card is gone.

## 10. The dev room for everyone (v0.661.0, 0463)

- "Let me turn it on for platform registered users": a room admin flips a room
  to EVERYONE (`dev_room_set_open`). Every signed-in account is then in it, and
  is seated the first time it reads its rooms. Anyone who leaves or is removed
  stays out (`dev_room_left`) until an invite brings them back.
- "Dev chat live as a bar at the bottom of the my leagues page": `DevRoomBar`
  on web and phone. Folded, it shows the newest line or the unread count. Tap it
  and the room opens in place; ⤢ opens the full room.
- "Accessible as a chip in league chats": 🛠 DEV beside LEAGUE / DIRECT, for
  anyone in a room.

## 11. The roster, the chip, and weekly listings (v0.662.0, 0464)

- "Pull up the list of registered site users and toggle them in the dev chat.
  No other form of invite." The room's PEOPLE tab gives an admin every account
  (`dev_room_users`, newest first, searchable by name or email), with an IN/OUT
  switch each (`dev_room_set_member`). OUT is remembered, so an EVERYONE room
  doesn't seat them again. Invite codes are retired: all are revoked and none
  can be made. The EVERYONE switch stays.
- "Make it actually a floating chip pinned to the bottom left": 🛠 DEV floats
  over the leagues page on web and phone. Tap it and the room opens in a panel
  above it; ⤢ opens the full room.
- "Get rid of the weekly bullseye banner … findable and accessible like any
  other league listing. Maybe have another filter for weekly draft leagues."
  The banner is gone. My Leagues and the league board have a WEEKLY filter
  (`isWeeklyKind`: pods, showdowns, DFS and Bullseye leagues).

## 12. Every chat tool in the dev room; @computer for everyone (v0.663.0, 0465)

- "Let's have all chat tools in the dev chat, pics, gifs, polls, reactions, @,
  etc." The dev room now has the league chat thread itself.
  - Web `src/app/chat.tsx` and phone `apps/mobile/src/ui/Chat.tsx`:
    `LeagueChat` takes a `ChatBackend`. League chat's backend is the default,
    and `devChatBackend` / `DevChat` provide the dev room's.
  - The dev room gets pictures with captions, GIFs, polls (any member may post
    one), the league's six reactions, @mentions (including @all, with a push),
    edits, admin pins and the "N new" catch-up pill.
  - Pictures go to the `chat-image` bucket under `dev/<room>/<author>/…`.
- "Let's not have the chat/bug/suggestion distinction. Just a chat window.
  Allow at computer for everyone in dev chat."
  - The 💡/🐞 tag chips are gone.
  - A dev room line that says @computer, from ANY member, is filed by the
    @computer worker (`server/src/computer.js`, source `dev`). COMPUTER_USERS
    still gates league chat and DMs.
  - Computer's reply, and when the issue closes, its fix card, post back into
    the room as kind `computer`.

## 13. Contest leagues: DFS, golf and Bullseye, with every classic option (v0.664.0, 0466)

Founder: "Let's get more commish options in for bullseye leagues — Rosters,
budget, full scoped bonuses, lists, and eligible players, scoped positions, HC,
FB, etc. all the classic league options. … In fact this is just a version of
dfs, but with a target. Let's build regular highest score dfs and golf dfs while
we are at it." Chosen: golf is the classic golf rule (lowest total wins, a
spot's `zero_pts` pricing a scoreless spot); the commissioner picks
head-to-head or leaderboard per league; COMMISH is the classic console,
trimmed, with a CONTEST card.

- **One league type.** A contest league is a classic league (`game_mode
  classic`, kind `dfs` — `bullseye` for the ones made before 0466) whose squads
  are rebuilt every week from the salary board. Its settings carry
  `contest` (`high` | `golf` | `bullseye`), `contest_format` (`h2h` | `board`),
  `budget` ($10,000–$500,000), `span`, `max_seats`, and `roster_slots` — the
  classic roster builder's spot list (the DFS nine by default). A golf league
  carries `golf: true`; a Bullseye one `dfs_bullseye`, `bullseye`,
  `bullseye_radius`. Every league from before is backfilled.
- **The engine is `packages/core/src/engine/contest.ts`.** `contestConfigOf`
  reads the settings; `contestCard` deals the week's card over the league's
  spots, anchored to its scoring catalog; `scoreContest` scores a week (HIGH
  sums, GOLF sums with the zero-fill, BULLSEYE darts; a SOLO row scores both
  sides alike); `contestTiebreak` picks one RB/WR spot; `contestAutoBuild`
  fills a seat spot by spot under the budget, reserving the $3,000 minimum per
  spot still to fill. Spots are `S1…Sn`; a squad saved before 0466 (DFS names)
  fills them in order by position.
- **Every classic option applies.** The roster builder (any spot: FLEX, HC,
  FB, P, RET, IDP where the admin enables them; team, tenure and flag filters;
  `zero_pts`), the scoring catalog and by-position scoring, scoped bonuses in
  the commissioner's kit, the pool filter and seat rules. `save_contest_entry`
  checks each spot (`_contest_spot_error`: position, the spot's filter, the
  pool filter, the seat's rule), duplicates, the budget and per-player locks.
  The salary board (`pod_salary`) now prices every position a spot can take,
  with `exp` for tenure rules.
- **Formats.** HEAD-TO-HEAD makes every seat at creation (an even count, at
  most 32; the CPU plays a seat until someone takes it) and the worker pairs
  them each week. LEADERBOARD seats people as they join (32, or 50,000 for a
  host) and each squad is its own row. The format is set only before the
  first week; the contest and budget change from the next week.
- **Standings.** `contest_board(league, week)` ranks the way the contest ranks
  — highest first, lowest first for golf, closest with the tie-break for
  Bullseye — and sums a season league's finals. `bullseye_my_weeks` carries
  the opponent and their score in a head-to-head league.
- **The screens.** `ContestSquad` (web `src/screens/ContestSquad.tsx`, phone
  `apps/mobile/src/screens/ContestSquad.tsx`) draws the league's own spots,
  the budget and the card; the pick sheet filters by `contestSlotAllows` and
  sorts the way the contest scores. The creation form picks the contest, the
  format, the span, the budget, the size and (Bullseye) the card. COMMISH is
  the classic console — web `CommishDash` with a CONTEST panel
  (`src/screens/ContestCommish.tsx`), phone `CommishTools` with the CONTEST
  card — trimmed of draft, waivers, trades, playoffs, contracts and coin.
- **RPCs.** `create_contest_league`, `join_contest`, `contest_league`,
  `contest_state`, `save_contest_entry`, `contest_board`, `set_contest_rules`;
  the 0463 names (`create_bullseye_league`, `join_bullseye`, `bullseye_league`,
  `bullseye_league_board`) are wrappers. `commish_overview` carries the kind.
- **Next.** The rich squad builder on web and phone (position tabs, team
  filter, value sort, a budget bar) is PR 2.

## 14. The squad builder (v0.665.0)

Founder: "We want the budget and player selection to be a rich, interactive,
fun experience on web and app." The pure half is
`packages/core/src/engine/contestBuilder.ts`; the screens are
`src/screens/ContestSquad.tsx` and `apps/mobile/src/screens/ContestSquad.tsx`.

- **The budget bar.** Fills a segment per pick; says what's left, how many
  spots are open and what each can have (`budgetLine`); turns red over the
  budget. Under it the squad's projection (against the card's total for a
  TOTAL Bullseye) and its value (points per $1k).
- **Spot cards.** The league's spots in a grid: label, the card's number or
  the spot's `0 →` penalty, the tie-break mark; the player's face, injury tag
  (`loadLiveInjuries` / `injuryFor`), `vs KC · Sun 1:00p` from the week's
  slate (`weekSlateByTeam`), salary, projection and value; ✕ clears; a changed
  spot wears the accent until saved. An empty spot says what it takes (team,
  tenure, FLEX positions) or what it can spend.
- **The pick sheet.** Spot chips (ANY SPOT lands a player in the tightest
  open spot that takes him — `openSpotFor`), position tabs from the league's
  own spots (`builderTabs`), search, a team filter, sort by PROJ / VALUE /
  SALARY / A–Z (CLOSEST for a SLOTS Bullseye), and ELIGIBLE ONLY. Every
  player who can't be taken says why (`spotWhyNot`: not the position, the
  spot's team/tenure/flag filter, the league's pool filter, your seat's rule,
  already in another spot, his game locked, over budget by $X).
  `rankCandidates` puts the takeable first.
- **FILL FOR ME.** `fillOpenSpots` runs the auto-build (`contestAutoBuild`
  with `keep`) over the open spots only, inside what's left of the budget and
  never offering a player the pool filter or seat rule refuses. The build now
  reserves each remaining spot's cheapest candidate, so a one-candidate spot
  can't be starved by a pricey pick before it.
- **Saving** is unchanged: `save_contest_entry` re-checks everything.

## 15. Pricing the board, and the injury rule (v0.666.0, 0467)

Founder: "What's the process for updating the prices to make sure they align
with how every position is likely to score? What's dfs best practice for
injured players and changes in projections when team mates get injured?"

- **One price sheet, priced on scarcity.** `engine/salaryPricing.ts`. A
  player's salary is the floor ($3,000) plus a rate × his projection OVER
  THE REPLACEMENT at his position — the body after a 12-team league's
  starters (QB13, RB25, WR37, TE13, K13, DEF13). The rate is calibrated per
  board so the all-studs default nine lands at 108% of $50,000: fillable,
  never free of trade-offs. HC, P, FB and IDP have no weekly feed and sit at
  the floor. The board is shared by every league that week (as a DFS site's
  salary sheet is); the league's own scoring is its edge, below.
- **The price freezes; the projection moves.** `pod_salary.priced_proj` is
  the number the salary was set from, frozen with it. `proj` is refreshed
  from the weekly feed every six hours (`refreshBoardProj`), so a teammate's
  injury shows up as value on the sheet. The builder prints `proj 18.1 ↑2.7`
  when the feed has moved half a point since pricing.
- **The league's own projection.** `contestBuilder.leagueWeekProj` scales the
  board's PPR number by the season projection under the league's catalog over
  the same under stock PPR (bounded ½–2×), and for a body the feed does not
  price (HC, P) uses the catalog's per-week number outright. Sorting by PROJ
  and VALUE and the squad's projection all read the league's number.
- **Injuries.** O or IR on the report: not a new pick — the builder says
  "ruled out this week", FILL FOR ME skips him, and `save_contest_entry`
  refuses him; one already in a saved squad stays, swappable until his game
  locks (the DFS rule). After lock a human gets what the site gives: nothing.
  A CPU seat gets the swap made for it (`ensurePods`): an Out/IR player whose
  game has not locked is replaced by the best affordable body for the spot,
  the rest of the squad kept. CPU builds never start from a ruled-out man.
- **The weekly audit.** `node src/cli.js salary-audit <week>` (ops mode
  `salary-audit`, read-only): per position the bodies, the replacement level,
  the price range and $/point over replacement; the all-studs nine against
  the budget; who moved since pricing; and once the week is final, realized
  points per $1k and salary↔points correlation by position from the contest
  leagues' stamped slot scores. Run it Tuesday on the new board and after the
  finals; a position that systematically out-earns its price is the signal to
  revisit its starters count.
- Applies from the next board built; a frozen board keeps its prices.

## 16. The coach by name (v0.667.0, 0468)

A HEAD COACH spot is a team unit (`jax-hc`): the projection and the scoring
are the team's, so a firing never touches a stored lineup. Only the name was
ever stale — hand-typed once in `projTeamRoles2026.ts` and shown nowhere, so
the board read "JAX Head Coach".

`server/src/poll/coaches.js` scans ESPN's team directory (the 32 teams, then
the season's coach record for each) on the worker's daily directory refresh
and stores the result in `team_role`; `sync_team_role_names()` then renames
the stored rows in every league pool (`league_pool.full_name`) and every
frozen salary board (`pod_salary.name`). A read of fewer than 16 names is
refused, so an outage keeps last week's names. New boards take the name from
the table at build time; a pool built on the phone starts from the season
list and is renamed by the next scan.

## 17. A coach's week, and the squad's total (v0.667.2)

The board stores a head coach at projection 0 (there is no league-free
coach catalog), and the builder used to price him at a flat seventeenth of
the season line under the league's catalog — every week the same. Now
`leagueWeekProj` takes his game from the week's slate: `hcWeekPoints`
turns both teams' projected margins per game (plus a 1.5-point home edge)
into an expected margin, a win chance (normal CDF at the NFL's 13.5-point
game SD) and a margin-bracket ladder, and pays them under the catalog the
way `classicScorePlay` would; points and downs ride the season rate. A bye
is 0; no slate falls back to the flat number.

The builder's card header shows PROJECTS — the picks' projected sum — and,
in a Bullseye league, the card's total with the gap.

## 18. The cap is optional; golf gets a floor (v0.668.0, 0469)

Founder: "Any reason to have a budget in bullseye or golf dfs leagues?"
Bullseye earns its cap — without one every seat picks the player projected
closest to each number and the tie-breaker decides the week — but a
commissioner who wants pure aim may drop it. Golf's cap never binds: the
lowest-projected players who still play are also the cheapest. Golf's real
constraint is the opposite one, a minimum spend.

Settings: `budget` 0 = no cap; `min_spend` 0 = none, else $5,000–$500,000
and never above a cap. `save_contest_entry` refuses a squad over the cap
(when there is one) or under the floor. New golf leagues start with no cap
and a $45,000 floor; HIGH and BULLSEYE keep the $50k cap with NO CAP on the
menu. The commissioner adjusts both under CONTEST RULES.

The auto-build (CPU seats, no-shows, FILL FOR ME) reserves the floor the
way it reserves the cap: a pick is forced up only when the spots still to
fill could not reach the minimum on their own, and a floor nobody on the
board can meet is dropped rather than leaving a spot empty. The builder's
bar reads SPEND under no cap and says how far short of the minimum the
squad is; SAVE waits until it is over.

