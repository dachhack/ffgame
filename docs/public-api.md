# The Drip league API (v1)

Two halves on one base URL. **Reads** are anonymous: no key, no login, CORS
open — the same bargain that made Sleeper's tooling ecosystem exist. **Writes**
(since 0352) need a key, and a key exists only in a league whose commissioner
switched the write API on — see [The write API](#the-write-api) below.

```
GET https://<project>.supabase.co/functions/v1/public-api/v1/league/{league_id}
```

That is the URL that works today — the site itself is GitHub Pages, which
cannot rewrite `/api/*`, so there is no `dripfantasy.com/api` to point at. The
commissioner's console prints the exact base for this deployment beside the
switch. A prettier `api.dripfantasy.com` is a DNS step, not a code one: the
project already has a Supabase custom domain for `auth.dripfantasy.com`
(docs/domain-runbook.md §4), and a second CNAME to the same target serves
these routes unchanged.

## Who is readable

**Every league that lives here is readable by default.** That is the bargain
that makes an ecosystem possible: a tool author can build against what is
reliably there, not against the minority of leagues whose commissioner went
looking for a switch.

Three things keep that defensible:

- **There is no directory.** No endpoint lists public leagues, and there never
  will be. A league is readable only by whoever holds its id — a v4 UUID,
  unguessable, and shared exactly as far as its members share it. "Open by
  default" means *if you have the link*, not indexed, enumerable or
  searchable.
- **The never-list below is the same either way.** Flipping a default cannot
  leak what no endpoint returns.
- **The opt-out is one tap**, in the commissioner's console (⚑ Manage league →
  🏅 AWARDS & BADGES on the web, ENGAGE → AWARDS & BADGES in the app), and
  takes effect on the next request.

**Imported leagues start private.** A league mirrored from Sleeper, ESPN or
Yahoo was pulled in with that manager's own credentials; publishing our own
leagues is a decision we get to make, republishing somebody else's system is
not.

A league that is private returns **404**, byte-identical to one that does not
exist, so the API cannot be used to test whether a league id is real.

## Endpoints

| Route | What it returns |
|---|---|
| `/v1/health` | Heartbeat, and how many leagues are published |
| `/v1/openapi.json` | This list, machine-readable |
| `/v1/league/{id}` | Settings, scoring, rules, current week, roster size, champion |
| `/v1/league/{id}/teams` | Seats: team name, manager display name, avatar, division |
| `/v1/league/{id}/rosters` | Every roster, with contracts in contract leagues |
| `/v1/league/{id}/standings` | Records, points for/against, divisions, median game |
| `/v1/league/{id}/matchups?week=N` | Pairings, status, lock time, scores |
| `/v1/league/{id}/lineups?week=N` | Starters (classic) and **revealed** picks (drip) |
| `/v1/league/{id}/transactions?after=&limit=` | The register, newest first, cursor-paged |
| `/v1/league/{id}/trades?limit=` | Settled trades — executed, vetoed, reversed — with multi-team legs and the league vote; an offer that lapsed unanswered is not a trade and is not here |
| `/v1/league/{id}/draft` | Draft state and every pick, with auction prices |
| `/v1/league/{id}/picks` | Tradeable future picks and who owns them |
| `/v1/league/{id}/players` | The league's pool, with crosswalk ids (`espn_id`, `sleeper_id`, `gsis_id`, `pfr_id`, `yahoo_id`, `sportradar_id`) |
| `/v1/league/{id}/history` | Champions, the record book, all-time manager lines |
| `/v1/league/{id}/awards` | Award definitions, weekly winners, badges |

## Joining a league to anything else

`/players` carries every public id we can resolve for a player, so nothing
downstream has to match on a name: `gsis_id` (nflverse, and the key in
play-by-play), `sleeper_id`, `espn_id`, `pfr_id`, `yahoo_id` and
`sportradar_id`. They come from StatHead's public player crosswalk, refreshed
daily, and a player we cannot place carries no extra ids rather than a
guessed one — our pool reaches the crosswalk by id (espn first, sleeper
second) and never by spelling.

These are public identifiers for public athletes. About a *manager* this API
publishes what the league's own board shows — the team name, the display
name the account chose and its avatar, per seat — and never an account id,
an email or a claim email; the all-time manager line carries an opaque
handle instead. See below.

## What is never served

Not "not yet" — by design, and enforced in the SQL that builds each response
(`supabase/migrations/0326_the_public_api.sql`), pinned by
`scripts/check-public-api.mjs`:

- **Sealed picks before their window reveals.** Drip's whole game is hidden
  picks; `/lineups` asks `window_revealed()`, the same question the app asks
  before it shows you an opponent's pick.
- **Pending waiver claims and their bids.** Blind bidding stops being blind the
  moment an outsider can poll it. Settled claims only, with the winning bid.
- **Trade offers in flight.** Members see negotiations; the internet doesn't.
- **Email addresses, claim emails, invite codes, chat, DMs, dues.** The
  all-time manager line carries an opaque handle, never an account id.
- **Anything that writes, without a key.** Writes are the keyed half below;
  the anonymous half never changes anything.

## Manners

- **Rate limit** 600 requests a minute per IP, bursting to 120. Over it: `429`
  with `Retry-After`.
- **Caching** every response carries `Cache-Control` and a weak `ETag` — send
  `If-None-Match` and a poller gets a `304` with no body.
- **Paging** `/transactions` returns `next_after`; pass it as `?after=`.
- **Errors** `{ "error": { "code", "message" } }` with a real status code.
- **Stability** `v1` only grows. New fields may appear; existing ones keep
  their meaning. A breaking change would be `/v2`.

## Example

```bash
API=https://<project>.supabase.co/functions/v1/public-api/v1
curl -s "$API/league/$LEAGUE/standings" | jq '.standings[0]'
curl -s "$API/league/$LEAGUE/transactions?limit=5" | jq '.transactions[].kind'
```

## The write API

Keyed control of a league from outside the app — the thing ESPN's API is used
for: lineup optimisers, waiver bots, a Discord command that answers a trade.

### Who can use it

- **The commissioner opts the league in.** ⚑ Manage league → 🏅 AWARDS &
  BADGES → WRITE API on the web, Commissioner → AWARDS & BADGES → WRITE API in
  the app. Off by default for every league. Switching it off stops every key
  in the league on its next call; switching it back on restores them.
- **Each manager makes their own key**, under the league menu → 🔑 API keys.
  A key belongs to one league and one person, and it is **shown once**: the
  database keeps only its SHA-256, so there is nothing to show again and
  nothing a leaked table could hand out. Ten live keys per person per league.
- **A key acts as its owner, with exactly their powers.** Every write ends in
  the same function the app calls, which asks its own permission question.
  - `team` scope (anyone with a seat): the seats you own or co-manage, and
    nothing else — even if you are the commissioner.
  - `league` scope (the commissioner only): every seat, plus the
    commissioner's tools. A lineup bot does not need to veto trades, so a
    commissioner who builds one does not have to hand it that power.
- **A key is never a platform admin**, whoever made it.
- **Every write is logged** — key, action, seat, and why it failed if it
  did. The commissioner reads the whole league's log; a manager reads their own.
  The 🔑 sheet shows the latest, and any key can be revoked there.

### Calling it

```
Authorization: Bearer drip_sk_<64 hex>
```

| Method & route | Body | Scope |
|---|---|---|
| `GET /v1/me` · `GET /v1/league/{id}/me` | — | any |
| `GET /v1/league/{id}/lineup?roster_id=&week=` | — | any |
| `PUT /v1/league/{id}/lineup` | `{roster_id, week, picks:[{game_window, roster_slot, player_slug, metric_id?}]}` | any |
| `POST /v1/league/{id}/add` | `{roster_id, add, drop?}` | any |
| `POST /v1/league/{id}/drop` | `{roster_id, player}` | any |
| `POST /v1/league/{id}/claims` | `{roster_id, add, drop?, bid?}` | any |
| `DELETE /v1/league/{id}/claims/{claim_id}` | — | any |
| `POST /v1/league/{id}/roster-spot` | `{player, spot: active\|ir\|out\|taxi}` | any |
| `POST /v1/league/{id}/trades` | `{roster_id, to_roster, give:[], get:[], note?, give_picks?, get_picks?, faab_dollars?, expires_hours?}` | any |
| `POST /v1/league/{id}/trades/{trade_id}/accept` · `/decline` · `/cancel` | — | any |
| `POST /v1/league/{id}/trades/{trade_id}/approve` · `/veto` | — | league |
| `POST /v1/league/{id}/waivers/process` | — | league |
| `POST /v1/league/{id}/players/{slug}/move` | `{to_roster}` | league |
| `POST /v1/league/{id}/players/{slug}/remove` | `{waive?}` | league |
| `PUT /v1/league/{id}/waiver-priority` | `{order:[roster ids]}` | league |

Players are named by the league's `slug`, as `/players` lists them. A lineup
`PUT` replaces the **unlocked** picks in each window it names and leaves every
other window alone; a pick whose game has kicked off is never touched. Classic
lineups use the one window `wk`. A league-scope key may set another team's
lineup in a classic league only — drip picks are hidden until kickoff, and a
commissioner reading them would be the exploit 0178 fenced off.

### Answers

`200` with the league's own answer on success. Otherwise
`{ "ok": false, "error": { "code", "message" } }`:

| Status | Means |
|---|---|
| `400` | Malformed: no `roster_id`, a body that is not a JSON object |
| `401` | No key, or an unknown or revoked one |
| `403` | Write API off; a key pointed at another league; a seat the key cannot act for; a commissioner route with a team key; an owner no longer in the league |
| `404` | No such route, or no such claim or trade **in this league** |
| `409` | A league rule stopped it mid-write — a kickoff lock, an illegal roster. Nothing changed |
| `422` | The league said no, in its own words: `free agent — add him directly`, `bid exceeds your FAAB balance of $12` |
| `429` | 60 writes a minute per key, one a second sustained |

Keyed answers are `Cache-Control: no-store`. A keyed `GET` of a read section
(`/rosters`, `/players`) is simply a read — send the header on everything if
that is easier.

### Example

```bash
API=https://<project>.supabase.co/functions/v1/public-api/v1
KEY=drip_sk_…
curl -s -H "Authorization: Bearer $KEY" "$API/me" | jq '{league_id, rosters, key}'
curl -s -X POST -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"roster_id": 3, "add": "jaylen-warren", "drop": "zamir-white"}' "$API/league/$LEAGUE/add"
```

### How it is built

One SQL function, `api_write` (migration 0352), is the only door: granted to
the service role alone, it hashes the key, checks the league's switch, then
sets the request's JWT claims to the key's owner for the rest of the
transaction — so `owns_roster`, `is_league_commish` and every RPC's own guard
answer exactly as they would in the app. It always passes the **key's**
league, never the caller's, and checks that a claim or trade named by id
belongs to it. Lineups are written by `_api_set_lineup`, which asks the
`sealed_pick` policies' questions out loud (RLS does not apply to a function
running as its owner); the kickoff, legality, slot-cap, flag and stash
triggers fire for every writer regardless.

Pinned by `scripts/check-write-api.mjs` (router and whitelist agree; the door
is the service role's; the claims carry no email; off by default),
`scripts/db/write-api-probes.sql` (scopes, isolation, revocation, the log,
the admin check) and `scripts/db/write-api-e2e.mjs` (the real router against
the real SQL).
