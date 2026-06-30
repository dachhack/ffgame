# Multi-League Integration — Research & Plan

> **Question:** what, if anything, is stopping us from importing a user's
> fantasy league from **ESPN, Yahoo, NFL.com, Fleaflicker, and MyFantasyLeague**
> the way we import from **Sleeper** today?
>
> **Short answer:** nothing *technically* blocks ESPN, Yahoo, Fleaflicker, or
> MyFantasyLeague — each has a usable league-read API. The cost is the same
> three things for all of them, and they're exactly what Sleeper lets us skip:
> a **server-side proxy** (CORS + secret handling), **auth** (cookies or OAuth),
> and a **per-platform player-ID crosswalk**. **NFL.com is the one real
> blocker** — there is no usable league-import API anymore.

---

## 0. A distinction that matters

ESPN already appears throughout this codebase — but **only as the NFL
play-by-play / scoreboard / injury stats source** (`scripts/espn/`,
`server/src/poll/`, `docs/espn-pbp-handoff.md`). That is a *completely separate*
concern from importing a **user's fantasy league** (their rosters, managers,
scoring rules, standings, weekly matchups).

The **only league-import provider today is Sleeper**:

- `src/data/sleeper.ts` — browser client (resolve user → leagues → standings).
- `src/data/buildLeague.ts` — `buildSleeperLeague()` turns a Sleeper league into
  the engine's `League`/`BuiltLeague` so the sim runs on it unchanged.
- `src/data/sleeperPlayers.ts` — the ~5 MB Sleeper player directory.
- `server/src/sleeper.js` — Node mirror for the live pilot worker.

Everything below is about that **league-import** surface.

---

## 1. Why Sleeper was the easy one (the bar the others must clear)

Sleeper is called **straight from the browser** (`src/data/sleeper.ts:6`). That
works only because Sleeper's read API is uniquely friendly on three axes:

| Property | Sleeper | Consequence for us |
|---|---|---|
| **Auth** | None — public read by username / league id | No login UX, no secrets |
| **CORS** | Enabled — browser may call it cross-origin | No backend needed; static site Just Works |
| **Player crosswalk** | `/players/nfl` carries `espn_id`, `yahoo_id`, `sportradar_id`, … | One directory maps players onto our baked PBP slugs |

We already exploit the crosswalk: `src/data/sleeperPlayers.ts:70` parses
`espn_id`, and `scripts/pbp/genRealPbp.mjs` bakes `SLEEPER_SLUG`
(`src/data/sleeperSlug.ts`) — a Sleeper-id → baked-PBP-slug map — so players we
have real play-by-play for reuse it, and everyone else gets synthesized texture
scaled to their real weekly total (`buildLeague.ts`).

**Each of the three properties above is something every other platform makes us
work for.**

---

## 2. The deployment reality

The demo deploys as a **pure static site — "no backend required"**
(`README.md:40`, `:53`). Sleeper is the only provider that survives in that
model, because every other platform fails at least one of:

- **CORS** — none of ESPN / Yahoo / NFL / MFL / Fleaflicker send permissive CORS
  headers for arbitrary browser origins, so a static client can't call them.
- **Secrets** — OAuth client secrets (Yahoo) and per-user cookies (ESPN private,
  MFL private) **cannot live in a browser bundle**.

⇒ **Every non-Sleeper provider requires a server-side proxy.** The good news:
the `server/` Node worker and Supabase **already exist** for the 2026 live
pilot, so the proxy host is partly built — this is incremental, not greenfield.

---

## 3. Per-provider verdict

| Platform | Usable league API? | Auth to read *your* league | Browser-callable? | Legal / ToS | Effort |
|---|---|---|---|---|---|
| **Sleeper** (today) | ✅ open | None | ✅ Yes | Low risk | — |
| **ESPN** | ✅ unofficial v3 | `espn_s2` + `SWID` cookies (private) | ❌ proxy | Unofficial; can break | **Medium** |
| **Yahoo** | ✅ official, supported | OAuth 2.0 (app reg + 3-legged) | ❌ proxy | Lowest risk; attribution required | **High** |
| **Fleaflicker** | ✅ official, documented | None for public leagues | ❌ proxy | Documented / allowed | **Low–Med** |
| **MyFantasyLeague** | ✅ official, documented | API key / login cookie (private) | ❌ proxy | Documented; rate-limited | **Low–Med** |
| **NFL.com** | ❌ effectively none | n/a | n/a | Dev program defunct | **Blocked** |

### ESPN
Unofficial JSON API at
`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{leagueId}`
(host changed from `fantasy.espn.com` in 2024). Public leagues read with no
auth; **private** leagues need the user's `espn_s2` + `SWID` cookies, which a
browser can't send cross-site → Node proxy required. No official support means
it can break without notice. Biggest user base, cheapest API. **Medium effort.**

### Yahoo
The **only officially supported** option: Yahoo Fantasy Sports API, OAuth 2.0.
Most durable legally, heaviest to build — register an app (consumer key/secret),
run a 3-legged OAuth flow, refresh tokens server-side, parse JSON. Yahoo
**requires attribution** ("Fantasy data provided by Yahoo").

> **⚠️ Access is now gated (confirmed live, 2026).** Yahoo moved the Fantasy
> Sports API behind an **application + manual approval** process
> ("Application Submission → Review → Access"). A self-serve OAuth app no longer
> gets a Fantasy permission — the API Permissions list is empty, and any Fantasy
> call with such a token returns `oauth_problem="additional_authorization_required"`
> (verified: even `game/nfl` fails). So Yahoo is **not** plug-and-play like it
> used to be — it requires an approved developer application before any league
> data is reachable. **High effort + an approval gate, lowest legal risk.**

### Fleaflicker
Documented public read API (`https://www.fleaflicker.com/api/...`, e.g.
`FetchLeagueScoreboard`, `FetchLeagueRosters`), JSON, no auth for public
leagues. Friendliest of the non-Sleeper four; smaller user base. **Low–Med.**

### MyFantasyLeague (MFL)
Long-standing documented developer API
(`https://api.myfantasyleague.com/{year}/export?TYPE=...&L={id}&JSON=1`). Public
data open; private needs an API key / login cookie. Rate-limited (429s) and
heavy users should register in the MFL Developers Program. **Dynasty-heavy user
base — a strong fit** since this app is dynasty-flavored. **Low–Med.**

### NFL.com — the genuine blocker
The legacy `apidocs.fantasy.nfl.com` page still exists, but the developer
program is effectively defunct, access requires login cookies, and it's
undocumented and unreliable. The tell: **ffscrapr** — the de-facto
multi-platform fantasy library — supports Sleeper, MFL, Fleaflicker, and ESPN
but has **no NFL.com support**. Realistically NFL.com means brittle scraping,
not an integration. **Recommend dropping it** (or revisiting only on user
demand).

---

## 4. What actually has to change in *our* code

Three coupling points hardcode Sleeper today:

1. **Store** (`src/app/store.tsx`) — a `sleeperUser: SleeperUser | null` field
   (`:57`), persisted under `SLEEPER_KEY` (`:132`), and a `sleeperLeague` route
   (`:36`).
2. **Builder** (`src/data/buildLeague.ts`) — `buildSleeperLeague()` calls
   `https://api.sleeper.app/v1/...` inline and resolves players via the Sleeper
   directory + `SLEEPER_SLUG`.
3. **Screens** — `Leagues.tsx`, `LeagueHub.tsx`, `SleeperLeague.tsx` read
   `sleeperUser` and render "VIA SLEEPER" copy.

The **good news**: `buildLeague.ts` already normalizes everything into the
engine's `League`/`BuiltLeague` types. The engine, sim, and screens consume that
shape and **don't care where it came from**. So the seam is narrow — it's the
**fetch + crosswalk layer**, not the engine.

---

## 5. Proposed architecture — a `LeagueProvider` abstraction

Introduce one interface that each platform implements. Everything downstream of
`NormalizedLeague` stays unchanged.

```ts
// src/data/providers/types.ts
export type ProviderId = 'sleeper' | 'espn' | 'yahoo' | 'fleaflicker' | 'mfl';

export interface ProviderUser {
  provider: ProviderId;
  userId: string;
  displayName: string;
  avatar: string | null;
}

export interface ProviderLeague {
  provider: ProviderId;
  leagueId: string;
  name: string;
  season: string;
  totalRosters: number;
  format: string;   // "Dynasty · Superflex"
  scoring: string;  // "PPR" | "Half-PPR" | "Standard"
}

/** Platform-agnostic shape buildLeague consumes. Each provider maps its native
 *  payloads into this; players carry whatever cross-ids the platform exposes so
 *  the crosswalk can resolve them to baked slugs. */
export interface NormalizedLeague {
  detail: { name: string; season: string; playoffWeekStart: number; rosterSlots: number };
  teams: { rosterId: string; teamName: string; owner: string; avatar: string | null }[];
  // playerRef carries every id the platform gives us (espnId, yahooId, sleeperId,
  // gsisId, name) so resolvePlayer() can pick the best crosswalk key available.
  rosters: Record<string /*rosterId*/, PlayerRef[]>;
  weeklyPoints: { week: number; rosterId: string; points: Record<string /*playerRef key*/, number> }[];
  schedule: { week: number; home: string; away: string }[];
}

export interface LeagueProvider {
  id: ProviderId;
  /** True if this provider can run entirely client-side (Sleeper only today). */
  clientSide: boolean;
  resolveUser(handle: string, auth?: ProviderAuth): Promise<ProviderUser | null>;
  getLeagues(user: ProviderUser, season: string, auth?: ProviderAuth): Promise<ProviderLeague[]>;
  getLeague(leagueId: string, season: string, auth?: ProviderAuth): Promise<NormalizedLeague>;
}
```

```ts
// src/data/buildLeague.ts — generalized entry point
export async function buildLeague(
  provider: LeagueProvider,
  leagueId: string,
  youUserId: string,
  season: string,
  auth?: ProviderAuth,
  onProgress?: (note: string) => void,
): Promise<{ built: BuiltLeague; youTeamId: string }> {
  const norm = provider.clientSide
    ? await provider.getLeague(leagueId, season, auth)        // Sleeper: direct
    : await fetchViaProxy(provider.id, leagueId, season, auth); // others: /api/league
  // ...existing slug-resolution + synth-texture logic, but keyed off
  // norm.rosters[*].playerRef instead of raw Sleeper ids.
}
```

### The proxy (for every non-Sleeper provider)

A thin `server/` route — e.g. `GET /api/league?provider=espn&leagueId=…&season=…`
(plus an auth-handoff endpoint) — that:

1. Holds OAuth secrets (Yahoo) / forwards user cookies (ESPN, MFL private).
2. Calls the platform's API server-side (no CORS problem).
3. Returns a `NormalizedLeague` so the client is provider-agnostic.

`provider.clientSide === true` (Sleeper) bypasses the proxy and calls directly,
exactly as today — **zero regression for the existing path**.

### The crosswalk hub

We already pull `espn_id` from the Sleeper directory. Extend
`src/data/sleeperPlayers.ts` to also keep `yahoo_id` and `gsis_id`, and build the
inverse maps (`espnId → slug`, `yahooId → slug`) once. Then `resolvePlayer()`
tries, in order: native cross-id → name-normalized match → synthesize.
**Sleeper's directory becomes the universal id hub**, so each new provider needs
only to *emit whichever ids it has*, not its own full crosswalk.

---

## 6. Recommended order & phasing

Effort-to-payoff ordering:

1. **Phase A — Abstraction (no new provider).** Land `LeagueProvider` +
   `NormalizedLeague`; refactor Sleeper to implement it. Pure refactor, ships
   with zero behavior change. *This is the unblocker for everything else.*
2. **Phase B — ESPN.** Biggest audience, cheapest API. Build the proxy +
   cookie-handoff UX + `espnId` crosswalk (mostly already present).
3. **Phase C — MFL + Fleaflicker.** Documented, low-effort, dynasty fit. Mostly
   new fetch adapters on the Phase-B proxy.
4. **Phase D — Yahoo.** Most work (OAuth + attribution) but most durable.
5. **Drop NFL.com** unless users specifically demand it.

---

## 7. Implementation status

**Phase A — landed.** The provider seam exists and Sleeper runs through it, with
zero behavior change (same `gc-sleeper` persistence, same Sleeper public API):

- `src/data/providers/types.ts` — `LeagueProvider` interface + the
  platform-agnostic `ProviderUser` / `ProviderLeague` / `ProviderStanding` /
  `ProviderAuth` types.
- `src/data/providers/sleeper.ts` — the Sleeper provider, delegating to the
  existing `src/data/sleeper.ts` driver + `buildSleeperLeague`. `clientSide:
  true`, `auth: 'handle'`.
- `src/data/providers/index.ts` — the registry (`getProvider`,
  `AVAILABLE_PROVIDERS`, `DEFAULT_PROVIDER_ID`); ESPN/Yahoo/Fleaflicker/MFL are
  registered as `undefined` placeholders.
- Call sites routed through `getProvider(...)`: `store.tsx` (`sleeperUser` is now
  a generic `ProviderUser`, tagged `provider:'sleeper'`, backfilled on load),
  `Splash.tsx`, `SleeperHandoff.tsx`, `Leagues.tsx`, `SleeperLeague.tsx`.

> **Deliberately deferred to Phase B:** the internal `NormalizedLeague`
> fetch→normalize→build split sketched in §5. Today each provider returns the
> engine's `BuiltLeague` directly via `buildLeague()`. The shared normalizer is
> best introduced alongside **ESPN**, where a *second* provider validates that
> the build step is genuinely platform-agnostic — extracting it now, against a
> single Sleeper-shaped consumer, would be a guess with no way to verify it
> preserves the sim output. The interface boundary (`buildLeague`) is already in
> place, so that refactor is internal and non-breaking when it lands.

**Phase B keystone — landed.** `buildLeague.ts` is split into the shared,
provider-agnostic `buildFromNormalized()` + a per-provider fetch
(`sleeperNormalize()`), bridged by `NormalizedLeague` (`src/data/normalized.ts`).
The crosswalk resolver is generalized to consume cross-ids; Sleeper behavior is
preserved (its `sleeperId` still drives the baked-slug lookup), and ESPN players
reuse the same path by joining their athlete id to a Sleeper id via the
directory hub (`loadDirectoryByEspn()` in `sleeperPlayers.ts`).

**Phase B ESPN — landed + validated end-to-end** against a real private league
(`1606063852`, 2024, cookie auth): PPR detected via position overrides, correct
records/rosters/schedule, and 153/170 players resolved to baked PBP via the
espnId→Sleeper-id directory join. The cookie round-trip works.

- `supabase/functions/espn-league/index.ts` — anonymous CORS proxy to ESPN's v3
  read API; attaches the caller's `espn_s2`/`SWID` cookies server-side, returns
  the league + per-week boxscores. Holds no secrets of its own.
- `src/data/espn.ts` — `espnNormalize()` maps ESPN's v3 JSON → `NormalizedLeague`
  (position/pro-team maps, member/owner join, schedule pairing, per-week boxscore
  player points), crosswalking athlete ids via the directory.
- `src/data/providers/espn.ts` — `espnProvider` (`clientSide: false`,
  `auth: 'cookie'`), registered in the provider registry.
- `src/screens/EspnConnect.tsx` — league-id-centric connect form (id + season +
  optional cookies), reachable from the Splash Sleeper card.

> **Before this works in production, two steps remain — both require things this
> environment can't do:**
> 1. **Deploy the proxy:** `supabase functions deploy espn-league --no-verify-jwt`
>    (it must allow anonymous invocation — demo visitors aren't signed in).
> 2. **Validate against a real league:** the ESPN v3 field paths — especially the
>    per-week boxscore player points (`rosterForCurrentScoringPeriod` /
>    `appliedStatTotal`) and the private-league cookie round-trip — are mapped to
>    ESPN's documented shape but have not been run against a live league. The
>    mapping degrades gracefully (missing data → less synth texture, baked
>    players still use real PBP), so it won't crash, but the per-player weekly
>    numbers need a real-league check.

**Phase C — Fleaflicker + MFL — landed.** Both reuse the shared
`buildFromNormalized()` pipeline through a single generic proxy:

- `supabase/functions/fantasy-proxy/index.ts` — anonymous CORS GET proxy with a
  host allowlist (Fleaflicker + the whole `myfantasyleague.com` domain, since MFL
  league calls 302-redirect to per-league `www##` servers).
- `src/data/fleaflicker.ts` + `providers/fleaflicker.ts` — **validated
  end-to-end against a real public league** (NFL Legends Lounge, 174892): 12
  teams, correct records/points/schedule, 162/187 players resolved to baked PBP
  by name-match. Found + fixed a real bug (the boxscore endpoint 400s on a
  `season` param).
- `src/data/mfl.ts` + `providers/mfl.ts` — **validated end-to-end against a real
  public league** (Masters Copper Dynasty, 10005): 10 teams with correct
  records/points/schedule, 179/207 players resolved to baked PBP by name-match,
  "Last, First" names flipped, non-standard team codes mapped. Found + fixed a
  real bug (weeklyResults per-player scores are under `franchise.player`, not
  `franchise.players.player`).
- `src/screens/ProviderConnect.tsx` — one provider-parameterized connect screen
  (replaces the ESPN-specific one); Splash links ESPN / Fleaflicker / MFL.

Crosswalk note confirmed in practice: providers with no Sleeper/ESPN id
(Fleaflicker, MFL) resolve to baked play-by-play purely by **name-match**, and on
a real Fleaflicker league that still mapped ~87% of players to real PBP.

**Phase D — Yahoo — landed (code-complete; needs an app + live validation).**
Yahoo is the only official API, and the only one needing OAuth 2.0:

- `supabase/functions/yahoo-oauth/index.ts` — holds the app client id/secret and
  does token `exchange` / `refresh` plus authenticated API `get`s. The browser
  only ever holds the user's own tokens.
- `src/data/providers/yahooClient.ts` — the redirect/exchange/refresh glue +
  token cache; `src/data/yahoo.ts` — `yahooNormalize()` with helpers that tame
  Yahoo's awkward JSON (lists keyed "0","1",…,"count"; team/player metadata as
  arrays of single-key fragments).
- `src/data/providers/yahoo.ts` — the provider (`clientSide:false`,
  `auth:'oauth'`); `src/screens/YahooConnect.tsx` — sign-in → league-picker; the
  `?code` callback is exchanged in `App.tsx`.

> **Yahoo status (tested live, 2026):** the **OAuth handshake is validated** —
> a real auth-code → access/refresh-token exchange via the exact flow the
> `yahoo-oauth` function uses (200, tokens returned). But the **Fantasy API is
> now gated**: Yahoo moved Fantasy access behind a manual application/approval
> (§3), so a self-serve app's token can't read any league
> (`additional_authorization_required` on every Fantasy call, incl. `game/nfl`).
> The league/roster mapping in `yahoo.ts` is therefore built-to-spec but
> **unvalidated** — it needs (1) an approved Yahoo developer application, then
> (2) a real-league check (Yahoo's JSON is the most surprise-prone, so expect
> field-path fixes), plus `YAHOO_CLIENT_ID`/`SECRET` as function secrets +
> `VITE_YAHOO_CLIENT_ID` in the build. The "Fantasy data provided by Yahoo"
> attribution is on the connect screen per Yahoo's terms.

### Final status — all five platforms

| Platform | State |
|---|---|
| **Sleeper** | ✅ live (client-side, unchanged) |
| **Fleaflicker** | ✅ built + **validated end-to-end** vs. a real league |
| **MFL** | ✅ built + **validated end-to-end** vs. a real league |
| **ESPN** | ✅ built + **validated end-to-end** vs. a real private league (cookie auth) |
| **Yahoo** | ✅ built; **OAuth token exchange validated live**; Fantasy data unreachable — Yahoo now gates the Fantasy API behind a manual application/approval (confirmed 2026) |
| **NFL.com** | ❌ dropped — no usable league API (the original blocker) |

**Deploy checklist** (can't be done from this environment):
`supabase functions deploy espn-league --no-verify-jwt`,
`fantasy-proxy --no-verify-jwt`, `yahoo-oauth --no-verify-jwt`; set the Yahoo
secrets; add `VITE_YAHOO_CLIENT_ID` to the build.

### What's genuinely *stopping* us, in one line each

- **All four viable providers:** need the Phase-A abstraction + a server proxy
  (CORS/secrets) — the static-only model is the structural blocker, and the
  pilot's `server/`+Supabase already softens it.
- **ESPN / MFL / Yahoo private leagues:** an auth-handoff UX (cookie capture or
  OAuth) we don't have yet.
- **Each provider:** emitting its player ids into the shared crosswalk (cheap,
  since Sleeper's directory already carries the foreign ids).
- **NFL.com:** no usable API — the only hard "no."

---

## Sources

- ESPN v3 API (host change, cookies): <https://stmorse.github.io/journal/espn-fantasy-v3.html>, <https://github.com/cwendt94/espn-api>
- Yahoo Fantasy Sports API (OAuth, attribution): <https://developer.yahoo.com/fantasysports/guide/>
- Fleaflicker API docs: <https://www.fleaflicker.com/api-docs/index.html>
- MyFantasyLeague API (export TYPE, JSON, rate limits): <https://ffscrapr.ffverse.com/articles/mfl_getendpoint.html>
- ffscrapr platform coverage (Sleeper/MFL/Fleaflicker/ESPN — no NFL.com): <https://ffscrapr.ffverse.com/>
- NFL Fantasy legacy API docs: <https://apidocs.fantasy.nfl.com/>
