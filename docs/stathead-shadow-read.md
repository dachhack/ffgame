# The Stathead shadow read

Stathead's daily-sport feed is live (2026-10-05): `https://stathead-sports.dachhack.workers.dev`,
every `/v1` route behind `Authorization: Bearer <token>`, contract in the
stathead repo's `docs/daily-sport-service.md`. It covers NHL, MLB, NBA, WNBA,
MLS and the Premier League: schedules by date, season calendars, box-score
lines, directories with injuries and tenure, season lines (five seasons for
NHL and MLB, three for the rest), StatHead ADP and an id crosswalk. Reads of
a date's slate and an in-progress box score go to the feed with a 60-second
cache; everything else is a daily bundle (09:00 ET), injuries hourly.

Before any sport switches provider, a week of shadow reads has to agree with
the public feeds (the acceptance list in the requirements doc). This file is
the runbook.

## What Stathead asked for, and where it is

1. **The fixture days** — `server/test/fixtures/sports/README.md` and
   `days.json`: NHL and MLB 2026-09-29 (a final and a live snapshot each), the
   NBA sample game 2021-01-15 ORL @ BOS, the season reports sampled, the ADP
   pages of 2026-10-04, the ESPN calendars.
2. **The pool key lists per sport** — produced from production, never from a
   checkout:

   ```sh
   # in server/, with the worker's Supabase env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
   npm run cli -- sport-pool-keys --out=/tmp/pool-keys
   # with STATHEAD_TOKEN set too, each file also says which keys the crosswalk resolves
   npm run cli -- sport-pool-keys --out=/tmp/pool-keys --check
   ```

   or, in the Supabase SQL editor:

   ```sql
   select l.sport, lp.slug
     from league_pool lp join league l on l.id = lp.league_id
    where l.sport <> 'nfl' and l.provider = 'native'
    group by l.sport, lp.slug order by 1, 2;
   ```

   A key is `<sport>-<id>`: NHL and MLB keys are the league ids (Stathead's
   `player_id` outright); NBA keys are Sleeper ids and WNBA keys ESPN ids
   (the crosswalk's `sleeper_id` / `espn_id`). `crosswalkCoverage` in
   `server/src/stathead.js` is the rule the `--check` applies.

## Setup

- `STATHEAD_TOKEN` is a Fly secret on the worker (`fly secrets set STATHEAD_TOKEN=…`),
  never a file in the repo. `STATHEAD_URL` defaults to the service above.
- `npm run cli -- stathead-probe` reads `/v1/meta`; `stathead-probe nhl 2026-10-04`
  adds that day's slate and the first game's lines.
- `SPORT_PROVIDER` (fly.toml / env) picks a sport's feed: `stathead` for every
  sport, or per sport `nhl=stathead,mlb=public`. Unset, the four polled sports
  read their public feeds and soccer reads Stathead (it has no other adapter).
  A `stathead` choice without the token falls back to public and the boot log
  says `nhl (public)`.
- `SPORT_SHADOW` names the sports read from Stathead beside their public feed
  and compared in the log (`nhl,mlb` on the pilot worker; `all` for every
  public-provided sport). Needs the token; writes nothing.
- `npm run cli -- sport-shadow nhl 2026-09-29` compares one day by hand;
  `sport-poll nhl 2026-09-29 --provider=stathead` writes a day from Stathead.

## Reading the shadow log

The worker logs one block per day at boot (the fixture days, then
yesterday) and one line per game as it goes final:

```
[shadow] shadow nhl 2026-09-29: slate 2/2 matched by teams (0 only ours, 0 only theirs, 0 status diffs); finals 1: 1 agree, 0 differ
[shadow]   MTL@TOR: 38 lines agree
[shadow] shadow mlb 2026-10-04 final: SD@MIL: 2/26 lines differ (max 1.0 pts: Tatis ours 9.0 theirs 8.0 [sb]), 1 scoring only theirs (Pinch Runner) (theirs stored)
```

- **slate**: both feeds' games for the US Eastern date, matched `AWAY@HOME`
  through each feed's team aliases. "Only ours/theirs" names a game one feed
  lacks; "status diffs" a game one feed calls final and the other live.
- **lines agree**: every player both feeds list has the same stats and the
  same points under the sport's default table. "N/M lines differ" names the
  biggest disagreements with their fields. "Scoring only ours/theirs" is a
  player with a non-zero line that only one feed lists (a scratch with an
  empty line is not counted). NBA lines are matched by team and normalised
  name because the id spaces differ (CDN vs ESPN); the rest by id.
- **Known gaps on our side** are left out: the public NHL box score has no
  faceoff counts (we write 0), Stathead counts them from the play-by-play, so
  `fow`/`fol` are not compared and the day line says so.
- A sport is ready to switch when a week of finals reads "agree" (or the
  differences are explained and Stathead's side is the right one).

## What the contract changes for our adapters

- **NBA and WNBA ids are ESPN's**, not the league CDN's; the crosswalk maps our
  Sleeper (NBA) and ESPN (WNBA) pool keys. Replay works for NBA on day one.
- **Soccer's dictionary is Stathead's**: `min g a sh sot fc fs yc rc og off sv
  ga shf start sub_in cs tga`. Ours (`sports/soccer.ts`) wants `gc` (= their
  `ga`), `cs` (already 60-minute-ruled on their side; ours derives it again,
  harmlessly), `start`, and `posn` from the position code (G/D/M/F → 1–4).
  Key passes, big chances, tackles, interceptions, clearances, blocks,
  penalties and xG are not served; those knobs stay at 0 until they are.
- **Stat corrections** come as `revised_at` on stored finals (NBA, WNBA, soccer,
  NHL finals, the last 30 days of MLB). Our best-ball fill settles a day after
  yesterday; a `revised_at` inside that window re-scores naturally.
- **Team codes**: one canonical set per sport from `/v1/{sport}/teams` with
  aliases; our `TEAM_ALIAS` table in `sportMarket.js` becomes redundant for
  Stathead-served sports.

## The week

1. Set the token; `stathead-probe` for each sport.
2. Run `sport-pool-keys --check`; hand the files to Stathead; every key must
   resolve before a sport switches.
3. ✓ The Stathead adapter (`server/src/sports/statheadAdapter.js`, v0.634.0)
   sits behind the registry, selectable per sport by `SPORT_PROVIDER`.
4. ✓ The fixture days run through both adapters at every boot and
   `sport-shadow <sport> <date>` runs any day by hand, compared under each
   sport's default table (`server/src/poll/sportShadow.js`).
5. Seven live game days per sport in shadow (`SPORT_SHADOW=nhl,mlb` on the
   pilot worker, each final compared once as it lands), then the acceptance
   list; flip `SPORT_PROVIDER=nhl=stathead` (and so on) per sport that passes.
