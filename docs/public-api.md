# The Drip public read API (v1)

Anonymous, read-only access to leagues that have opted in. No key, no login,
CORS open — the same bargain that made Sleeper's tooling ecosystem exist.

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

## Turning it on

Off for a full league until its commissioner flips **PUBLIC READ API** in the
commissioner's console (⚑ Manage league → 🏅 AWARDS & BADGES on the web,
ENGAGE → AWARDS & BADGES in the app). On by default for the public formats —
pods, weekly showdowns, DFS — which anyone with the link can already open.

A league that has not opted in returns **404**, byte-identical to one that does
not exist, so the API cannot be used to test whether a league id is real.

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
| `/v1/league/{id}/trades?limit=` | Completed trades, multi-team legs, the league vote |
| `/v1/league/{id}/draft` | Draft state and every pick, with auction prices |
| `/v1/league/{id}/picks` | Tradeable future picks and who owns them |
| `/v1/league/{id}/players` | The league's pool, with crosswalk ids (`espn_id`) |
| `/v1/league/{id}/history` | Champions, the record book, all-time manager lines |
| `/v1/league/{id}/awards` | Award definitions, weekly winners, badges |

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
- **Anything that writes.** A write API needs per-user consent; it is a
  different project.

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
