# Deploying the worker to Fly.io

The worker (`server/`) is a background scheduler — it polls ESPN, runs the engine,
and writes to Supabase. No inbound HTTP, so it's a single always-on machine.
Deploy artifacts live at the repo root: `Dockerfile` + `fly.toml`.

## One-time
```bash
# 1. Install flyctl + sign in
curl -L https://fly.io/install.sh | sh      # or: brew install flyctl
fly auth login

# 2. Create the app (matches `app` in fly.toml; pick another name if taken)
fly apps create drip-pilot-worker

# 3. Set secrets (NOT committed). Use the ROTATED service-role key.
fly secrets set \
  SUPABASE_URL="https://kaoitimdsftclykhqaqx.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<your service_role / sb_secret_ key>"
#  optional: a default league to operate on
#  fly secrets set PILOT_LEAGUE_IDS="1181483840740397056"
```

> The **service-role** key here is the real secret (bypasses RLS). It lives only in
> Fly secrets — never in git or the client. (The browser uses the publishable key.)

## Deploy
```bash
# from the repo ROOT (build context needs src/ + scripts/ + server/)
fly deploy
```

## Operate
```bash
fly logs                       # watch the scheduler tick (injuries, polls, resolves)

# Import a league once (creates the league + memberships + invite/commish codes):
fly ssh console -C "sh -lc 'cd /app/server && npx tsx src/cli.js sync <sleeperLeagueId>'"

# Mirror a week's schedule + lineups (run weekly, or script it):
fly ssh console -C "sh -lc 'cd /app/server && npx tsx src/cli.js sync-week <leagueId> <week>'"

# One-off injury / play poll (the scheduler also does these automatically):
fly ssh console -C "sh -lc 'cd /app/server && npx tsx src/cli.js inj-once'"
```

## What the running worker does (src/index.js)
Every tick (~25s): poll injuries (daily, hourly near games) → lock matchups whose
kickoff passed (reveals sealed picks) → poll live ESPN games → resolve live
matchups through the engine → write `matchup_state` (Realtime pushes to clients).
It does **not** auto-import leagues or auto-mirror schedules yet — those are the
`sync` / `sync-week` CLI commands above (a small enhancement could run them on a
schedule).

## Cost
One `shared-cpu-1x` / 512 MB machine ≈ a few dollars/month. Scale memory in
`fly.toml` if tsx needs more headroom under Sunday load.

## Notes
- This is separate from the GitHub Pages site (that deploys from the static
  branch and ignores `Dockerfile`/`fly.toml`).
- Offseason caveat: there are no live games until September, so until then the
  worker mainly exercises the injury feed, scoreboard, lock/reveal, and (via SQL
  or `sync`) the data model — not live scoring.
