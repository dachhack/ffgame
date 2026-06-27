#!/usr/bin/env bash
# Deploy the 2026 pilot WORKER (server/) to Fly.io. Wraps the steps in
# server/DEPLOY.md with preflight checks + a key-rotation reminder, so a deploy
# is one command. The static Pages site is unaffected (it ignores Dockerfile/fly.toml).
#
# Usage (from the repo ROOT — the Docker build context needs src/ + scripts/ + server/):
#   server/scripts/deploy.sh
#
# Env overrides:
#   APP=drip-pilot-worker   Fly app name (must match `app` in fly.toml)
#   SKIP_SECRETS=1          don't prompt to set Supabase secrets (already set)
set -euo pipefail

APP="${APP:-drip-pilot-worker}"

# ── Preflight ────────────────────────────────────────────────────────────────
command -v fly >/dev/null 2>&1 || command -v flyctl >/dev/null 2>&1 || {
  echo "✗ flyctl not found. Install: curl -L https://fly.io/install.sh | sh" >&2; exit 1; }
FLY="$(command -v fly || command -v flyctl)"

[ -f fly.toml ] || { echo "✗ run from the repo ROOT (fly.toml not found here)." >&2; exit 1; }
[ -f Dockerfile ] || { echo "✗ Dockerfile not found at repo root." >&2; exit 1; }

"$FLY" auth whoami >/dev/null 2>&1 || { echo "✗ not logged in. Run: $FLY auth login" >&2; exit 1; }

# ── App ──────────────────────────────────────────────────────────────────────
if "$FLY" apps list 2>/dev/null | awk '{print $1}' | grep -qx "$APP"; then
  echo "✓ app '$APP' exists"
else
  echo "→ creating app '$APP'"
  "$FLY" apps create "$APP"
fi

# ── Secrets (the service-role key bypasses RLS — Fly secret only, never git) ──
if [ "${SKIP_SECRETS:-0}" != "1" ]; then
  cat <<'EOF'

⚠  Before the first deploy, set the worker's secrets with the ROTATED
   service-role key (the old one was shared in chat during setup — rotate it
   in Supabase → Project Settings → API first):

     fly secrets set \
       SUPABASE_URL="https://kaoitimdsftclykhqaqx.supabase.co" \
       SUPABASE_SERVICE_ROLE_KEY="<rotated service_role / sb_secret_ key>"
     # optional: leagues for the weekly auto-sync loop
     # fly secrets set PILOT_LEAGUE_IDS="<sleeperLeagueId>,<...>"

   Already set them? Re-run with SKIP_SECRETS=1 to skip this prompt.
EOF
  read -r -p "Secrets are set with the rotated key — continue to deploy? [y/N] " ok
  [ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "aborted."; exit 1; }
fi

# ── Deploy + verify ──────────────────────────────────────────────────────────
echo "→ deploying $APP"
"$FLY" deploy --app "$APP"

echo
echo "✓ deployed. Tailing logs — you should see the scheduler tick"
echo "  (player index built → injuries → lock → poll → resolve). Ctrl-C to stop."
echo "  Offseason: with no live games this exercises injuries/scoreboard/lock/"
echo "  data-model only — not live scoring (that needs preseason, Phase 1)."
echo
exec "$FLY" logs --app "$APP"
