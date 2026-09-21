# Competitor gap analysis — what nine platforms have that Drip doesn't

_Written 2026-09-21 against `main` at v0.435.0 (migrations through 0319).
Platforms: Fantrax, Fleaflicker, MyFantasyLeague (MFL), Reality Sports Online
(RSO), League Tycoon, Yahoo, ESPN, Sleeper, FFPC. Part 1 is the gap list;
Part 2 is a condensed per-platform reference with sources so this doc can be
reused without re-researching._

_The Trades row's "Drip today" cells were updated for v0.437.0–v0.438.0
(`0321`, `0322`), which closed all five of its migration-blocking gaps, and
the Waivers row's first cell for v0.439.0 (`0323`), the league-history row
for v0.440.0 (`0324`), the awards row for v0.441.0 (`0325`), the read-API row for v0.442.0–v0.443.0
(`0326`, `0327`), the trade-grade and trade-reversal rows for v0.444.0
(`0328`) and the projections row for v0.445.0 (`0329`); every other cell is
as first written._

Sourcing caveats: Fantrax's site is a blank SPA to fetchers, so its feature
copy was pulled from its JS bundles and FantraxHQ's official guides. Reddit
was unreachable, so user complaints come from app-store reviews, Trustpilot
and forums (Footballguys, DLF, Sleeper community). Every "Drip today" cell
was checked against the migrations, not the docs.

---

## Part 1 — the gap list

### Where Drip already matches or beats them

- **Formats.** Native and imported leagues (Sleeper, ESPN, MFL, Fleaflicker;
  Yahoo partial), classic and drip modes, best ball, guillotine, vampire,
  golf, dynasty, contracts, IDP, superflex, auction, public pods, showdowns,
  window pot, divisions, up to 32 teams. Only MFL and Fantrax cover more
  formats; none has anything like drip mode or the power-up economy.
- **Contracts.** Franchise tag, extensions, RFA tenders, dead money, salary
  retention, cap-dollar trading, rookie scale, weighted draft lottery
  (`0217`–`0220`, `0231`, `0189`). Only League Tycoon has RFA tenders.
  Fantrax and MFL have no native tag or RFA.
- **Waivers.** Rolling, reverse standings, FAAB, minimum bid, hold days,
  free-agency days and windows, no drops after kickoff, agent seats that
  transact through the same RPCs (`0072`, `0126`, `0213`, `0316`–`0319`).
  Sleeper parity; past ESPN and Yahoo.
- **Commissioner console and admin.** Audit trail, co-commish, browse-as,
  force and undo picks, player flags, scoped bonuses. Comparable to Sleeper
  and Fantrax; deeper than ESPN, which has no co-commissioner.
- **Accessibility.** Two validated colorblind themes. Nobody else documents
  this.

### Trades

The most-cited reason a league refuses to move platforms.

| Feature | Who has it | Drip today |
|---|---|---|
| League-vote veto with configurable threshold and window | Sleeper, Yahoo, ESPN, Fleaflicker, MFL, Fantrax, League Tycoon | **Shipped v0.437.0** — `trade_review` = none \| commish \| league, with `trade_review_hours` and `trade_veto_votes` (`0321`) |
| Multi-team trades | Sleeper, Fleaflicker (unlimited), MFL, Fantrax, RSO | **Shipped v0.438.0** — 3–8 seats as `trade_leg` rows, every asset addressed to a seat in the deal (`0322`) |
| Counter-offers and offer expiry | Sleeper (exploding offers), Fleaflicker (1h–14d), MFL | **Shipped v0.437.0** — `counter_trade`, and an offer clock per offer or per league (`0321`) |
| Trading FAAB dollars | Sleeper, MFL, Fantrax, FFPC dynasty | **Shipped v0.437.0** — `faab_dollars` behind the commissioner's `faab_trading` switch (`0321`) |
| Trade analyzer or grades | ESPN (IBM watsonx), Yahoo Plus Trade Hub | **Shipped v0.444.0** — projected points over replacement in the league's own scoring, per player, shown live as the offer is built (`tradeGrade.ts`). Theirs is a letter; ours is arithmetic you can argue with |
| Trade auctions with anti-snipe | League Tycoon | None |
| Reverse a completed trade | Sleeper, Fantrax | **Shipped v0.444.0** — `commish_reverse_trade` runs every leg backwards in one transaction, and refuses rather than half-undoing (`0328`) |

### Waivers

| Feature | Who has it | Drip today |
|---|---|---|
| Conditional / contingency claim groups | Fleaflicker, Fantrax, MFL, Yahoo, FFPC | **Shipped v0.439.0** — ordered claim groups with a ceiling on how many land (`0323`) |
| Vickrey second-price FAAB | Fantrax | First-price only |
| Suggested FAAB bid ranges | Sleeper (2025) | None |
| Weekly and seasonal add limits | Fleaflicker, MFL, Fantrax, Yahoo | Not found in migrations |
| Can't-cut list | Yahoo, Fantrax, FFPC (top-48 ADP lock) | Flags cover no_trade / no_add / no_start, not no_drop |
| Show highest pending bids and bidders | Fantrax | Bids hidden |

### Scoring and schedule

Classic scoring is at Sleeper depth (~140 keys, `0160` → `0209`). The
schedule layer is where the gap is.

| Feature | Who has it | Drip today |
|---|---|---|
| Extra weekly matchup vs league median or average | Sleeper, Yahoo, Fleaflicker, Fantrax, MFL | None |
| All-play, victory points, double-headers | MFL, FFPC (Victory Points leagues) | None |
| Total points, rotisserie, H2H categories | Fantrax, Fleaflicker, MFL | H2H points only |
| Configurable tiebreakers | Fleaflicker (drag and drop), MFL | Fixed: wins → points-for → seat |
| Two-week championship round | Sleeper, ESPN, Yahoo | Single-week rounds |
| Custom or prebuilt schedules, schedule editing | MFL (600+), Fleaflicker | Generated only |
| Formula / conditional scoring rules, per-position overrides | MFL, Fantrax | Per-position first downs and TE premium only |
| Retroactive recompute when scoring changes mid-season | ESPN | Not verified |
| Third-round reversal draft | Sleeper, MFL, Fantrax | Snake, linear, auction |
| Supplemental, dispersal, expansion drafts | Sleeper, MFL, Fleaflicker, League Tycoon | One startup or rookie draft |
| Draft grades, recap, in-draft video, big-screen cast | Yahoo, ESPN, Sleeper | None |

### Dynasty and contracts

Ahead of everyone except the two specialists. What RSO and League Tycoon add:

- **Agent-chosen offers.** RSO's patented auction has an algorithm pick
  between competing 1–4-year offers rather than highest dollar. League Tycoon
  normalizes salary-plus-years bids with length discounts (8/16/24/32%).
- **Performance-priced extensions.** Both reprice extension offers from
  league-specific scoring; RSO recalculates every Tuesday.
- **Cap lifecycle.** RSO tracks the real NFL cap with per-game proration and
  NFL-style guarantee acceleration. League Tycoon has cap rollover (up to
  $25/season), a locked holdback, and a rookie option.
- **Practice-squad poaching with right to match** (RSO); **compensatory
  picks** as tradeable assets (League Tycoon).
- **Auto-generated salaries** from real cap hits or a formula, spreadsheet
  import, salary floor (Fantrax).
- **History import.** League Tycoon pulls 20 seasons plus traded picks and
  contract years from Sleeper, ESPN, CBS, MFL and Fantrax. Sleeper's Chrome
  extension and ESPN's NFL.com importer do similar. Drip imports current
  rosters only.

### League life and money

| Feature | Who has it | Drip today |
|---|---|---|
| Dues collection and payouts with escrow | Sleeper (SleeperSafe), Fantrax (Treasurer), MFL accounting, Yahoo, League Tycoon | Free-text dues field (`0223`); Stripe only for premium |
| League history, record book, hall of fame, past champions | Sleeper, Yahoo (2026 Record Book), League Tycoon, MFL (back to 1980) | **Shipped v0.440.0** — champions, all-time manager table and a record book across every rolled-over season (`0324`) |
| Weekly awards, achievements, badges | Sleeper, Yahoo, ESPN (2026) | **Shipped v0.441.0** — league-defined awards (metric × direction × win/loss filter, optional coin prize) and commissioner badges (`0325`). Ahead of all three: theirs are a fixed set |
| GIFs and stickers in chat | Sleeper, Yahoo, ESPN | Six fixed reactions (`0210`) |
| Group chats, matchup chat, player chat rooms | Sleeper, ESPN | League chat + DMs |
| Email notifications and digests | Fleaflicker, MFL, RSO | Invites only |
| Per-manager privilege locks | MFL abilities, Fantrax, Sleeper Roster Lock | Player-level flags only |
| Backups / restore-to-any-date, retroactive transactions | Fantrax | Undo tools only |
| Constitution / bylaws page, custom league site | Fantrax, MFL | League note banner (`0141`) |
| Peer cash side bets, prize leagues, prediction markets | FFPC Side Action, Yahoo prize leagues, Sleeper Picks/Markets | Coin-only window pot |

### Distribution and data

The widest gaps relative to the big three.

| Feature | Who has it | Drip today |
|---|---|---|
| App Store and Play Store listings | All nine | Sideloaded Android APK, web PWA. **v0.446.0** prepared the half that is code — production build + submit profiles, listing copy, a live privacy policy and support page, and the data-safety answers derived from what the app does (docs/store-listing.md). The accounts, screenshots and forms are human work |
| Lock-screen Live Activities or watch app | Yahoo, ESPN | Android home widget only |
| Public read API | Sleeper, Fleaflicker, MFL, Yahoo | **Shipped v0.442.0** — anonymous, read-only, 13 endpoints; open by default with a one-tap opt-out since v0.443.0 (`0326`, `0327`, docs/public-api.md) |
| Write API | MFL, Yahoo | None |
| Data export | Fantrax (CSV), MFL | None |
| Win probability | MFL, ESPN | None |
| Weekly-refreshed consensus projections and player news | Yahoo (FTN etc.), ESPN, Sleeper, MFL partners | **Shipped v0.445.0** — hourly weekly projections (with the raw stat line, decoded and checked against the source) and player-tagged headlines, keyed on the ESPN crosswalk (`0329`) |
| AI insights, lineup optimizer, start-sit | ESPN watsonx, Yahoo Assistant GM / Research Assistant, RSO roadmap | None |
| AutoSubs / late-scratch auto-substitution | Sleeper, Fantrax, Yahoo | None |
| Per-stat push alerts | Fantrax (2025) | Event-level push |
| Licensed stats feed | MFL (Genius), FFPC and RSO (Sportradar, Elias) | Unofficial ESPN endpoints |
| Multi-sport, college fantasy, devy pool | Fantrax, Yahoo (college 2026), Sleeper | NFL only |
| Pick'em, survivor, playoff one-and-done contests | Yahoo, ESPN, FFPC, RSO | None |
| Ranked ladder, managed public leagues | League Tycoon, Sleeper | Public pods |

### Suggested priority

Ordered by what blocks a league from migrating next August, then retention.

1. ~~**Trade parity** — league-vote review, multi-team trades, expiry and
   counters, FAAB trading.~~ **Done** in v0.437.0 (`0321`: the vote, expiry,
   counters, FAAB) and v0.438.0 (`0322`: 3–8-team trades). What is still
   missing from this row: trade auctions with anti-snipe (League Tycoon's,
   and the only one of these nobody else has either). Grades and reversal
   shipped in v0.444.0 (`0328`).
2. ~~**Conditional waiver claims and a median matchup**~~ — **Done**: the
   median game in v0.436.0 (`0320`), conditional claim groups in v0.439.0
   (`0323`). Still open on the waivers row: Vickrey second-price FAAB,
   suggested bid ranges, weekly/seasonal add limits, a can't-cut list, and
   showing the highest pending bids.
3. ~~**A history surface** — past champions, records, awards.~~ **Done** in
   v0.440.0 (`0324`): champions, the all-time manager table and the record
   book, on both hosts, and weekly awards and badges in v0.441.0 (`0325`).
4. **Store distribution** ~~and a read API~~ — the read API shipped in
   v0.442.0 (`0326`). Store listings: everything that is code is ready as of
   v0.446.0; what remains is two developer accounts, screenshots and the
   store questionnaires (docs/store-listing.md).
5. **Dues** — Stripe checkout + webhook exist; a SleeperSafe-style pot with a
   veto window reuses most of it.
6. ~~**Weekly projections and news**~~ — **Done** in v0.445.0 (`0329`): the
   week's number and the headlines, refreshed hourly. The baked season set
   stays as the fallback and the draft-room ranking.

---

## Part 2 — per-platform reference

### Sleeper (free, ad-free)

- **Formats:** redraft, keeper, dynasty, Chopped (native guillotine with
  automated elimination), best ball (H2H only, no IR/taxi), IDP, superflex,
  auction, median extra game, 4–32 teams, Managed Leagues (curated public
  commissioners). Side products: Picks, PicksVS, Daily Draft, Survivor,
  Team Picks / Markets (Kalshi-backed, Feb 2026).
- **Scoring:** fully custom incl. Position PPR (native TE premium), reception
  distance buckets, 3-and-outs, full IDP.
- **Draft:** snake, linear, 3RR, auction; supplemental drafts (≤10 rounds);
  dispersal; offline entry; timer seconds→24h with overnight pause; pick
  trading mid-draft; big-screen cast; unlimited human mocks.
- **Roster:** IR 0–10 (Out/Doubtful/Susp/PUP/NA/DNR/IR), taxi 0–10 with
  experience limit and deadline, AutoSubs (mobile-only config).
- **Waivers:** rolling, reverse standings, FAAB (ties by rolling); after-game
  waivers; custom daily modes (FA / Waivers / Locked / Waivers→FA); suggested
  FAAB bids (2025).
- **Trades:** multi-team, picks + FAAB, counters, exploding offers, trade
  block posts to chat, review period → midnight PT, league or commish veto,
  commish can reverse a completed trade, pinned polls for votes.
- **Commish:** co-commish, force/reverse trades, adjust scores after week
  ends, custom seeding + reseed toggle, Toilet Bowl, two-week championship,
  Roster Lock, League History Editor, Dues Tracker, **SleeperSafe** (AeroPay
  0% dues collection, proposed payouts with 24/48/72h veto).
- **Live:** SleeperZone play feed, TD moments, field PBP viz, Roster%/Start%,
  weekly projections (2026). Projections widely called weakest of big three.
- **Social:** GIFs, reactions, polls, @mentions, DMs, group chats, player and
  team rooms, weekly awards to chat, nicknames, player notes, blocking. No
  email alerts.
- **API:** read-only, no auth, ~1000 calls/min; leagues, rosters, matchups,
  brackets, transactions, traded_picks, drafts, players (5 MB), trending. No
  writes, projections, stats, or export. League Import Chrome extension.
- **Weaknesses:** Picks promotion in-app, Android draft-room bugs, weak
  projections, no email, no export, mascots removed 2022, mobile-only features.
- Sources: https://docs.sleeper.com/, https://support.sleeper.com/ (articles
  12005468, 3998131, 1876072, 3242468, 3188802, 3200544, 3971182, 15364522).

### ESPN (free, Official Fantasy Game of the NFL 2026)

- **Formats:** public 10-team, LM leagues 4–20 teams / 30 slots, Knockout
  (total-points elimination), Gridiron Gauntlet, keeper, salary cap, IDP, HC,
  P, TQB, OP superflex, League Bundles presets. NFL.com league migration. No
  best ball, no prize leagues.
- **Scoring:** H2H points only, all categories to hundredths, mid-season
  changes recompute retroactively. Playoffs 4-team default, 2-week rounds,
  byes, divisions.
- **Draft:** autopick, live snake, offline, salary cap ($200); mock lobby;
  draft grade; pick trading only until 1h pre-draft, no future picks.
- **Waivers:** standard, FAB standard, FAB continuous, none; daily 3–5am ET.
- **Trades:** LM review or none; 1/2/3-day windows; 50% uninvolved veto in
  standard leagues; IBM Trade Analyzer / grades. No trade block.
- **Commish:** single LM (no co-LM), edit rosters after lock, LM Actions log,
  Previous Leagues history.
- **Live / AI:** Matchup Moments, win probability charts, Live Activities,
  in-app highlights; Fantasy Insights on IBM watsonx (Buy Low / Sell High,
  Diamond in the Rough), waiver and trade grades with Granite explanations.
- **Social:** league chat (LM only), matchup chat, 1:1, GIFs, stickers,
  reactions, Achievements badges (2026).
- **API:** none official; community v3 endpoint with espn_s2 + SWID.
- **Weaknesses:** repeated outages (2025 W1/W2/W15), overnight-only waivers,
  no co-LM, no dynasty tooling, no prize leagues, ad clutter, lost pre-2017
  history.
- Sources: https://support.espn.com/ (articles 115003927611, 18378552635156,
  38507824929300, 360003914032, 360000041152, 360000071412, 360000976992),
  IBM newsroom 2025-09-24, espnpressroom.com.

### Yahoo (free; Plus $39.99/yr; Ultra $79.99/yr)

- **Formats:** public, private, Public Prize Leagues ($20–$5,000, Prestige
  skill-gated), Death Leagues (guillotine, cash tiers, 2025/26), keeper (no
  dynasty tooling), best ball, IDP, superflex, auction, Team Offense position
  (2026), College Fantasy (2026), Survival, Pick'em, Yahoo Cup, Draft With
  Friends.
- **Scoring:** custom per position and stat (2026), 60+ FG tier, split KR/PR,
  TE premium toggle, Custom Recipes presets, median matchup, second weekly
  opponent, 7-team playoffs with bye, reseeding, consolation — Commissioner
  Plus features now free.
- **Draft:** 2026 rewritten client with real-time grades, Draft Scout,
  shareable recap, Draft Together video chat, Instant Mocks (Plus), Cameo
  order reveal; keeper pick trading (next season only).
- **Roster:** default 15 + 2 IR; per-player lock; Assistant GM auto-optimizer
  (Plus).
- **Waivers:** standard or continuous, 0–7 day period, FAB to $999,999,999,
  conditional claims.
- **Trades:** league vote (default 1/3) or commissioner; Trade Hub (Plus). No
  trade block.
- **Commish:** co-commish, notes, custom URL, league history link, reverse
  transactions, dues, Record Book (2026).
- **Live:** StatTracker, Fantasy Feed play-by-play with reactions and
  Moments, iOS Live Activities (≤5 matchups), SiriusXM audio, FAST channel;
  Plus: consensus projections (FTN/Blitz/ATC), Min/Max, Research Assistant.
- **API:** official OAuth 2.0 REST, read and write; access now gated behind
  manual app approval (see `multi-league-integration-research.md`).
- **Weaknesses:** no dynasty, no slow drafts, paywalled optimizer and mocks,
  ads, half-PPR default, iOS-first rollout, thinner social.
- Sources: https://help.yahoo.com/kb/fantasy-football/ (SLN36403, SLN6811,
  SLN7223, SLN6111, SLN37119, SLN36451), sports.yahoo.com "29 Days of
  Fantasy" posts, https://sports.yahoo.com/developer/docs/.

### Fantrax (free with ads; Premium Commissioner League $129.95/season)

- **Formats:** redraft, keeper, dynasty, best ball ("count best n"), auction,
  IDP, multi-sport (NFL/MLB/NBA/NHL/NCAA/NASCAR/F1/PGA/EPL), college pool
  (devy / C2C home), salary cap and contracts [premium], multi-copy players,
  up to 2,000 teams, multiple teams per manager.
- **Scoring:** points, roto, H2H points / most categories / each category;
  per-position overrides; point ranges per category; median-opponent and
  double-header weeks; min/max category requirements.
- **Draft:** live, slow (8h timers, freeze windows, sleep timer), live auction
  with Vickrey/proxy bidding, automated, offline; draft reversal at a round;
  reserve/secondary draft; team-building screen; future picks up to 10 years.
- **Roster:** fully custom, min-active per position, min/max rookies, IR with
  advanced removal rules, two-way players, per-player lock offset, custom
  period lengths, illegal-roster policy.
- **Waivers:** FFA, priority, FAAB (Vickrey option); contingency groups with
  max-successful-per-group; show highest pending bids; churn prevention;
  FAAB budget trading; commish processes early.
- **Trades:** none / managers vote / commissioner / both; max trades; multi-
  team; trade block; tradeable picks, FAAB, cap space; contracts travel.
- **Contracts [premium]:** auto salary generation (real cap hits or formula),
  spreadsheet import, salary floor, option year, extensions, renewals,
  per-type dead cap, converter; no native tag or RFA.
- **Commish:** co-commish, lock individual owner privileges, one-click undo,
  retroactive transactions to any date, nightly backups restorable to any
  date, constitution box, Treasurer (free dues, 100% payout), pay premium 3
  weeks late.
- **Live:** real-time stats, configurable stat-correction windows (1–24h or
  freeze), per-scoring-category push alerts (2025). No play-by-play.
- **API:** none official; community `fantraxapi`; CSV export.
- **Weaknesses:** steep learning curve, pop-up ads on free tier, dated mobile
  (Android is a TWA wrapper), delayed draft notifications, small football
  community.
- Sources: fantrax.com JS bundles (premium-league-features, feature
  comparison), https://fantraxhq.com/ setup guides parts 1–3 and FAAB guide,
  https://www.fantrax.com/treasurer, Trustpilot.

### Fleaflicker (free with ads; ad-free and Competitive Edge paid, prices unpublished)

- **Formats:** H2H points, total points, true rotisserie; 4–24 teams; roster
  5–55; IDP; keeper/dynasty (40 keepers, rookie and supplemental drafts,
  taxi 1–30, picks 3 years out); superflex via custom flex. **Unsupported:**
  auction (offline import only), best ball, contracts, all-play, toilet
  bowl, two-week championship, finance tracking, keeper-to-pick assignment.
- **Scoring:** ~130 categories, presets, decimal, tiers, yardage bonuses,
  median or average extra matchup, copy rules from another league.
- **Draft:** live snake (30s–15m), email/slow, offline, un-snake to linear,
  multiple drafts per season, generic and league mocks. Pick trading in slow
  drafts only.
- **Waivers:** reverse standings or FAAB; always-on waivers; conditional
  claims; 40 claims/cycle; weekly and seasonal transaction limits.
- **Trades:** league vote (half of uninvolved), commissioner, or Commish
  Execute; multi-team unlimited; offer expiry 1h–14d; trade block. No FAAB
  or cash trading.
- **Commish:** edit box scores / seeds / waiver order, ghost commissioner,
  multiple co-commish, 4 co-owners per team, drag-and-drop tiebreakers,
  1-click ESPN/Yahoo import. No audit log, polls, or dues.
- **Live:** up-to-the-second scoring, free projections, Optimum PF. Provider
  undisclosed.
- **Social:** message board, DMs, email-league; no live chat, weak push.
- **API:** public unauthenticated read-only JSON (FetchLeagueScoreboard,
  Rosters, Standings, Transactions, DraftBoard, Trades, UserLeagues…).
- **Weaknesses:** dated UI, one What's New entry since 2021, weak push, small
  community, unresponsive support.
- Sources: https://www.fleaflicker.com/help/ (supported-and-unsupported-
  features, waivers, trading, ir-and-taxi-squad, commissioner-options),
  https://www.fleaflicker.com/api-docs/index.html.

### MyFantasyLeague (Custom $109.95; Deluxe $219.90; Chop $44.95; DFS $49.95; best ball free)

- **Formats:** redraft, keeper, dynasty, auction, best ball, Chop
  (guillotine), DFS-style ($60K weekly cap, ≤100 teams), Start'em Once,
  victory points, all-play, total points, NFL playoff leagues; 28 positions
  incl. team positions; Deluxe ≤100 teams, 24 divisions, 6 conferences,
  separate player pools. No roto.
- **Scoring:** formula/conditional rules, decimals to 3 places, position-
  specific, home-field advantage, score floors, non-starter % points, rule
  testing tool; median, league-average opponent, all-play, unlimited double/
  triple-headers, victory points, 600–700 prebuilt schedules, text schedule
  import.
- **Draft:** live room with audio, email/slow with overnight suspend, offline,
  live and slow auctions with proxy bidding, 3RR, rookie/vet filters,
  supplemental drafts, autodraft preferences, free mocks, ADP/AAV.
- **Roster:** up to 90 spots, 3 lock modes, lineup carryover, tiebreaker
  players; IR with statuses and deactivation windows; taxi with cooldown.
- **Waivers:** 6 modes (FCFS / request / hybrid / blind bid / hybrid / none);
  priority fixed, snake, weekly rolling, season rolling, custom sort; blind
  bid conditional groups, increments, carry-over, **FAAB trading**; calendar
  events; per-week/season add limits; rookie acquisition restrictions.
- **Trades:** immediate, commissioner, or league poll with auto-reject
  threshold; deadline events; future picks and FAAB; trade bait page; commish
  impersonation; multi-team.
- **Contracts:** salaries (default/custom/DFS/blind-bid-set), multi-year with
  manual rollover, hard or soft cap, auto escalation, adjustments, rookie
  salaries, keepers with pick cost, expansion drafts. No native tag/RFA.
- **Commish:** per-franchise Abilities Setup, co-commish, co-owners, league
  accounting (fees, per-transaction fees, LeagueSafe/PayPal), polls,
  newsletters, articles, calendar, custom HTML/CSS/JS skins, history to 1980.
- **Live:** Genius Sports feed, 40s refresh, win probability (H2H), Elias
  corrections Thursday 10am ET, GameDay Windows app; partners 4for4, RotoWire,
  FTN.
- **Mobile:** all third-party apps (MFL Mobile, Platinum, Lite, Modern).
- **API:** REST export ~60 types (league, rules, rosters, transactions,
  liveScoring, projectedScores, salaries, futureDraftPicks, accounting,
  tradeBait, adp, aav…) and ~25 **import/write** types (lineup, waivers,
  trade proposals, IR, taxi, keepers, salaries, live_draft controls). IP
  rate limits, 429s, registered clients get ~2.5×.
- **Weaknesses:** "looks like 1998," steep learning curve, no official app,
  manual contract rollover, no native tag/RFA, per-league fee.
- Sources: https://home.myfantasyleague.com/features.html, /wp-new/purchase/,
  https://api.myfantasyleague.com/2026/api_info?STATE=details,
  http://www03.myfantasyleague.com/2026/support.

### Reality Sports Online (Intern $12.99 / Executive $24 / GM $36 / Owner $99.99 per user per year)

- Acquired by Mobile Global Esports (MGAM) Oct/Nov 2025; ~7,000 payers;
  roadmap: War Room, AI valuation / contract optimization / trade analysis.
- **Format:** one core — dynasty contract league with rookie draft + free-
  agency auction; up to 32 teams / 8 divisions, rosters 4–53 + IR + practice
  squad; superflex, IDP, total points. No best ball or redraft.
- **Cap model (patent 11247133):** cap = real NFL cap (customizable), grows
  with the NFL; salary prorated 1/17 per game; contracts 1–4 yrs with
  per-length allotments; 22/24/26/28% escalating split; 100% year-1 and 50%
  future guarantees; dead-money acceleration on cuts (none on trades); rookie
  scale by pick (inequity across league sizes); rookie option; franchise tag
  (top-5 avg or 120%, third tag 144%); extensions via an agent algorithm
  repriced every Tuesday from league scoring.
- **Auction room:** nominated player "fields offers" via agent algorithm
  weighing total, guarantee, APY, length; UI auto-computes next acceptable
  offer per length; slow auctions (2022) with concurrent per-team auctions;
  mock auctions vs AI (stale projections).
- **Rookie draft:** 1–5 rounds serpentine, up to 24h clock, in-draft trading
  executes immediately, offline import; picks 2 years out.
- **Roster:** IR at 50% salary (any player, all season), IR-DFR; practice
  squad ≤2 NFL seasons, poaching with owner right-to-match.
- **Waivers:** dropped player + contract claimable 1 day by standings; FAAB
  blind bids Tuesday, min $500K, bid-amount-first processing; FCFS after.
- **Trades:** players, picks, multi-team; league vote or commissioner; locks
  3 days before rookie draft.
- **Commish:** full scoring/roster/contract-slot config, Edit Contracts,
  import existing contracts, expansion/contraction, dues split through site,
  public league listing.
- **Data:** Sportradar; Week 1 2025 outage under new ownership.
- **Mobile:** iOS 2.3★ / Android 2.2★ — "doesn't replace the website."
- **API/export:** none. No push notifications documented.
- Sources: https://realitysportsonline.com/Content.aspx?articleID=how-it-works,
  rookie-contract-values, additional-extension-details;
  https://cms.realitysportsonline.com/contract-extension-details/;
  https://www.footballguys.com/article/harstad_rso_review; March 16 2026
  pricing post on X.

### League Tycoon (standard dynasty free, ad-free; contract dynasty $11.99/team/season)

- Figment Labs; iOS 4.8★ (2.3K), Android 4.8★; weekly releases; Discord
  ~3,100.
- **Formats:** Standard Dynasty, Contract Dynasty, Graveyard (no draft, each
  NFL player usable once, weekly eliminations, up to 2,000 teams), Gambit
  (draft a "coach" that alters scoring), Ranked ladder (6 tiers, rating
  decay). Up to 32 teams, superflex, auction startups. No IDP, best ball, or
  redraft found.
- **Cap model:** $250 default with $50 holdback locked until drafts complete;
  rollover ≤$25/season; yearly salary increase %; contracts 1–5 yrs with
  allocations; rookie scale by slot % (1.01 = 100% of ~$12); rookie option;
  extensions stable or performance-based (adjusted PPG over 30 games ×
  positional salary pool × 85%); franchise tag (top-8 avg, once per player);
  **RFA tenders** with commissioner-defined levels pairing salary with pick
  compensation and right-to-match; dead money 100% current + 25% × remaining
  years next season, none on trades; cap-space trading on by default; Apr 1
  rollover.
- **Drafts:** live auction (30s/30s/10s) and slow auction (12h nominate, 24h
  bid, 16h anti-snipe, 20 simultaneous nominations, proxy bids); contract
  bidding normalized by length discounts 8/16/24/32%; rookie draft linear/
  snake/offline with weighted lottery (100/80/60/45/30/15 balls, live
  animated ceremony); supplemental drafts; commissioner-assigned comp picks.
- **Roster:** practice squad 7 slots at 25% cap (rookies), IR 1 slot at 100%
  cap, traditional or full-season mode; co-managers.
- **Waivers:** FAAB where the budget is your cap space; Wednesday 10am CST;
  1-day waivers; FCFS $1 after; pickups 1-yr only.
- **Trades:** commissioner (2-day), league veto (default 4), or auto;
  deadline default Week 9; **trade auctions** (seller picks any offer, 12h
  anti-snipe); trade block; full history.
- **Commish:** every cap/allocation/discount/dead-money/tag/RFA knob; pause,
  nominate-for, undo; Hall of Fame editor; per-manager fee via tokens;
  linked-account cheating detection visible to all.
- **Import:** Sleeper, ESPN, CBS, MFL, Fantrax — rosters, taxi/IR, traded
  picks, scoring, logos, salaries/contract years, up to 20 seasons → Hall of
  Fame. No Yahoo. No public API or export.
- **Weaknesses:** dated visuals vs Sleeper, news lag and no in-app player
  stats, undisclosed data provider, abstract dollars, simplified dead money,
  no IDP/best ball.
- Sources: https://leaguetycoon.com/rules/contract-league-rules/, /formats/,
  /features/league-import/, /compare/league-tycoon-vs-myfantasyleague/,
  app-store listings.

### FFPC (entry fees $5–$10,000; no free hosting product)

- **Contests (2026):** Main Event $2,200 (4,500 cap, $1M grand, $6.57M pool,
  Vegas live drafts Sept 10–12), Footballguys Players Championship $350,
  Big Gorilla $350 ($1M grand), Baby Gorilla $125, FantasyPros Championship,
  Best Ball Tournament $125 (28 rounds, weeks 1–14 + single-elim 15–17),
  Superflex Best Ball, Terminator (26 rounds, drop one weekly), Chop Classic
  (guillotine), Classic / Satellite ($35–$1,000), Victory Points cash
  leagues, Live Auction ($1,000–$5,000, in person), Dynasty (Standard /
  Superflex / TriFlex / Best Ball, $100–$5,000/yr), Empire (50% of pot banks
  until back-to-back champ), Player One (instant best ball vs CPU), Weekly
  Challenge, Playoff Challenge (one-and-done, Super Bowl doubled), Super
  Bracket, Pros vs Joes.
- **Scoring:** fixed per contest. FFPC standard: 0.05/pass yd, 4/pass TD,
  0.1/rush-rec yd, 6/TD, 1 PPR, **1.5 PPR TE**, dual flex. Victory Points:
  win 2 VP + weekly rank 1–4 = 2, 5–8 = 1, 9–12 = 0.
- **Draft:** 20-round serpentine live 60s; slow drafts 1/2/4/6h paused
  2–8am ET; dynasty rookie drafts 7 rounds straight with 8h clock; Draft
  Pilot rankings tool; no pick trading in redraft; dynasty picks next year
  only.
- **Roster:** 20 spots; dynasty + 3 IR (must activate within 3 days); no
  taxi; per-player lock; non-playoff rosters lock after Week 12.
- **Waivers:** $1,000 blind bidding, $1 min, conditional grouped bids, runs
  Wednesday ~10pm ET and Sunday 10am ET, no FCFS; collusion guards (top-48
  ADP drops locked, Week 11+ cuts removed from pool).
- **Trades:** prohibited in all redraft; dynasty with FFPC staff review, two
  protests trigger investigation. **Side Action** peer H2H wagers $10–$1,000
  with spreads, 10% rake.
- **Commish:** FFPC staff commission all house contests; "Create Your Own
  League" spins up a paid private league with no live commissioner.
- **Data:** Sportradar + Elias, scores FINAL Thursday 6pm ET, STAT APPEAL by
  email. No projections, news, or play-by-play on site.
- **Social:** message boards, Footballguys forums, YouTube draft streams; no
  in-app chat/GIF/poll layer.
- **Mobile:** iOS 4.7★ (2,200); complaints about draft crashes and missed
  on-the-clock notifications. No API or export.
- **Weaknesses:** all-play week and Weeks 13–14 playoffs collide with byes,
  seeds 3–4 must win twice, no trading in redraft, no taxi, dated UI, thin
  dynasty player data.
- Sources: https://myffpc.com/cms/public/play/main-event-2026,
  main-event-official-rules, ffpc-victory-points-cash-leagues-official-rules,
  side-action-rules, terminator-tourney-official-rules,
  https://www.footballguys.com/article/fpc-overview, SI May 2026 critique.
