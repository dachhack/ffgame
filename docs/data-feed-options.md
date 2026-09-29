# Data-feed options — replacing ESPN

> _Researched 2026-09-29. Vendor pricing and tiers change often; figures marked
> "rough" are from memory, not quotes. Rows marked "verified" were checked
> against the vendor's own pages that day._

ESPN's free `site.api.espn.com` endpoints are unofficial and not licensed for
commercial use (`scale-2026-2027-plan.md` §3). The `RealPlay`/`GamePlay`
adapter (`scripts/espn/espnAdapter.mjs`) is the swap point. This sheet tracks
candidate replacements.

## What ESPN supplies today

A replacement has to cover all of this, not just play-by-play.

- **NFL live** — `scoreboard`, `summary` (plays, drives, down/yardline, YAC),
  preseason weeks included (`server/src/poll/scoreboard.js`, `plays.js`).
- **NFL reference** — injuries (`scripts/espn/injuries.mjs`), team rosters,
  athlete lookups (`graduate.js`), news, and ESPN ids used to match players
  across sources (`xref.js`).
- **College** — rosters, stats, standings, scores, weekly slate
  (`college.js`, `collegeScores.js`, `collegeSlate.js`).
- **Images** — headshots and team logos from `a.espncdn.com`.

## Options

| Source | Live PBP | College | Cross-platform ids | Commercial licence | Rough cost | Notes |
|---|---|---|---|---|---|---|
| **Sportradar** | ✅ real-time, official NFL data | ✅ NCAAFB | ✅ | ✅ | $$$$ (five to six figures/yr) | Strongest option. Official NFL distribution rights are split with Genius — confirm which rights cover fantasy/media use |
| **Genius Sports** | ✅ official | limited | ✅ | ✅ | $$$$ | Built mainly for betting and broadcast; likely overkill |
| **SportsDataIO** (FantasyData) | ✅ live PBP and box scores | ✅ CFB | ✅ | ✅ | $$ (~$500/mo, `unit-economics.md`) | Best fit for a licensed feed. Fantasy-shaped: projections, injuries, depth charts, headshots (licensed add-on) |
| **Stats Perform** (Opta) | ✅ | ✅ | ✅ | ✅ | $$$ | Enterprise sales process |
| **Tank01** (RapidAPI) — verified | ✅ box scores + play-by-play | ❌ none found | ✅ `espnID`, `sleeperBotID`, Yahoo, RotoWire, FantasyPros, CBS | ⚠️ upstream undisclosed | $ ($0 / $10 / $25 / $100 per mo, per sport) | See section below |
| **MySportsFeeds** | ✅ near-live | ❌ | partial | ✅ paid tiers | $ | Cheap, fantasy-focused; check latency and PBP depth |
| **Rolling Insights** (DataFeeds) | ✅ | ✅ | partial | ✅ | $–$$ | Mid-market; verify PBP detail |
| **BALLDONTLIE / API-Sports** | scores, limited PBP | ❌ / partial | ❌ | ✅ | $ | Probably too thin for play-level scoring |
| **NFLMeta** — verified | provisional only | ❌ | ❌ (ids removed from public responses) | ✅ paid ($12–99/mo) | $ | Live source undisclosed; ~15–20s target, best-effort. Non-live data is nflverse |
| **nflverse** | ❌ post-game only (overnight) | ❌ | ✅ player-id table | ✅ CC BY 4.0 | free | Already our replay/bake source. Good for historical, injuries, rosters, depth charts; can't run live scoring |
| **CollegeFootballData.com** | scoreboard; plays on paid Patreon tiers | ✅ | partial | check terms | free–$ | Substitute for the college pollers specifically |
| **Sleeper API** | stats endpoints undocumented | ❌ | ✅ | ⚠️ same unofficial-use risk as ESPN | free | Doesn't solve the licensing problem |

## Tank01

A small fantasy-focused API sold through RapidAPI: separate NFL, MLB, NBA,
NHL and WNBA products.

**Good for us**

- **Very cheap.** Basic free (1,000 requests/mo), Pro $10/mo (1,000/day),
  Ultra $25/mo (15,000/day), Mega $100/mo (500,000/day), $0.01 per request
  over the cap; each plan covers one league.
- **Fantasy-shaped.** Box scores with play-by-play (`getNFLBoxScore`),
  schedules/weeks, rosters, injuries, news, projections, DFS salaries,
  betting odds.
- **Id crosswalk on players.** `espnID` and `sleeperBotID` are on every
  player, plus Yahoo, RotoWire, FantasyPros and CBS ids. That maps directly
  onto `league_pool.espn_id` and the Sleeper sync, the gap NFLMeta can't fill.
- Other fantasy apps run on it (Tailgate Fantasy Sports announced moving to
  it as their provider).

**Concerns**

- **Probably doesn't fix licensing.** Tank01 doesn't publish where its live
  data comes from, and its heavy use of ESPN ids suggests ESPN-derived data.
  Reselling data through RapidAPI doesn't grant rights the upstream never
  had. Treat it like ESPN for legal risk until they say otherwise in writing.
- **Small operator, no SLA.** Fine as a backup or cheap bridge; risky as the
  only feed for a paid product.
- **PBP depth unverified.** Confirm it carries what `GamePlay` needs (down,
  distance, yardline, start/end situation, play text, YAC, per-play player
  attribution). Also check latency and preseason coverage.
- **No college.** The college pollers would still need ESPN or
  CollegeFootballData.
- **Quota.** At our 25s poll cadence a full Sunday is ~2k summary calls plus
  scoreboard/injuries, so Ultra ($25/mo, 15k/day) likely covers game days.

**Verdict:** a strong candidate for a *cheap second feed and id crosswalk*,
and a reasonable ESPN fallback if ESPN's shape drifts or blocks us. It is not
the licensed feed the 2027 plan needs.

**Questions for support@tank01.com**

1. What is the upstream source for live NFL play-by-play?
2. Do paid plans permit displaying live data in a paid fantasy product?
3. Do plays include down, distance, yardline and per-play player ids?
4. Typical latency from snap to API?
5. Is preseason covered?

## Team logos and player images

Images aren't a data-feed problem; they're a rights problem. Today every image
is hotlinked from ESPN's CDN (`packages/core/src/data/media.ts`: `teamLogo`,
`collegeLogo`, `espnHeadshot`; the baked `headshots.ts` map of 607 ESPN URLs;
the NFL crests in `src/app/AvatarPicker.tsx`). Switching data vendors doesn't
change what we're allowed to show. Three separate rights are involved:

| Right | Covers | Who grants it | Rough cost (`unit-economics.md`) |
|---|---|---|---|
| **NFL marks** | Team logos, wordmarks | NFL Properties | Fixed minimums or rev-share; may not license a product our size at all |
| **NFLPA group licence** | Player likeness in photos (names + stats for fantasy are fine without it) | OneTeam Partners | Rev-share ~5–15%, or $10k–50k+/yr minimums |
| **Photo copyright** | The actual headshot files | The photographer / agency (Getty, AP, Imagn/USA Today), often resold by data vendors | Bundled with a vendor, or per-image licence |
| **College marks** | School logos | Each school, mostly through Learfield/CLC | Per-school; impractical at our scale |

A licensed headshot pack from a data vendor (SportsDataIO, Sportradar) only
covers the photo copyright. It doesn't grant NFLPA likeness or NFL marks.
Headshot URLs from Tank01, Sleeper (`sleepercdn.com`) or nflverse point at
someone else's CDN and carry no licence at all, same as ESPN's.

**Options**

1. **Launch mark-free (recommended, already built).** `VITE_MARK_FREE=true`
   nulls every resolver in `media.ts`; the UI falls back to team-abbreviation
   badges, team colours, position pills and initials. Zero licence cost.
2. **Own art.** Drip-branded team badges (abbreviation + colours, not
   lookalike logos) and non-likeness player art (position/number cards,
   Drip avatars). Cheap, on-brand, and removes the "looks broken" feel of
   plain initials. Avoid anything recognisable as a real player or logo.
3. **License at scale, as rev-share.** Once revenue justifies it: NFLPA via
   OneTeam + a licensed headshot pack from the data vendor, then host the
   images on our own CDN per the licence (no hotlinking). NFL marks last,
   if at all.

**Fixed:** `AvatarPicker.avatarOptions()` used to build ESPN NFL logo URLs
directly, so team crests were still offered as avatars in mark-free mode. It
now goes through `teamLogo()` and drops them. Avatars already saved as an NFL
crest still render; clearing those is a separate data change.

## Recommendation

1. **Licensed primary: SportsDataIO.** Cheapest licensed option covering live
   PBP, injuries, rosters, college and cross-platform ids in one contract.
   Trial key → write a `sportsdataAdapter` emitting `RealPlay`/`GamePlay` →
   run it through `scripts/espn/validate.mjs` against 2025 at the 99.58% bar.
   Check latency on a live game before signing.
2. **Cheap secondary: Tank01.** Id crosswalk now; hot-standby feed if ESPN
   fails mid-season. Validate it through the same harness.
3. **Upgrade later: Sportradar**, if official data or lower latency is needed
   once revenue justifies it.
4. **Free where enough:** nflverse for historical, ids and reference tables;
   CollegeFootballData for college if the primary's CFB add-on is priced badly.
5. **Images:** see [Team logos and player images](#team-logos-and-player-images).
   Launch mark-free, add own art, license likeness only at scale.

## Sources

- NFLMeta: [API docs](https://nflmeta.org/api-docs), [FAQ](https://nflmeta.org/faq),
  [pricing](https://nflmeta.org/pricing), [data sources](https://nflmeta.org/data-sources)
- Tank01: [site](https://www.tank01.com/),
  [NFL API on RapidAPI](https://rapidapi.com/tank01/api/tank01-nfl-live-in-game-real-time-statistics-nfl),
  [roster guide](https://www.tank01.com/Guides_Team_Rosters_NFL.html),
  [id discussion](https://rapidapi.com/tank01/api/tank01-nfl-live-in-game-real-time-statistics-nfl/discussions/108111),
  [Tailgate Fantasy Sports provider update](https://www.tailgatefantasysports.com/product-updates/product-update-new-api-provider)
