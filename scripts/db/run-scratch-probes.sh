#!/usr/bin/env bash
# Scratch-DB probe runner: spins up a throwaway Postgres 16 cluster, applies the
# Supabase shim + EVERY migration in order, then runs the probe suites. This is
# the harness behind the "N scratch-DB probes pass" notes in HANDOFF.md — before
# this file it was rebuilt by hand each session.
#
# Usage: scripts/db/run-scratch-probes.sh   (needs postgresql-16 installed; run
# as a user that may `su postgres` if root, e.g. inside the dev container)
set -euo pipefail
cd "$(dirname "$0")/../.."

DIR=${SCRATCH_PG_DIR:-/tmp/pgscratch}
PORT=${SCRATCH_PG_PORT:-54329}
BIN=/usr/lib/postgresql/16/bin
PSQL="psql -h $DIR -p $PORT -U postgres"

start_cluster() {
  rm -rf "$DIR"; mkdir -p "$DIR"
  if [ "$(id -u)" = 0 ]; then
    chown postgres:postgres "$DIR"
    su postgres -s /bin/bash -c "$BIN/initdb -D $DIR/data -U postgres -A trust >/dev/null && $BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start"
  else
    "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
    "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" start
  fi
  sleep 1
}

# The pgsql-http extension isn't packaged locally; 0003 only needs http_get to
# exist (Sleeper verification is never exercised in probes) — install a stub.
stub_http_ext() {
  local extdir=/usr/share/postgresql/16/extension
  [ -w "$extdir" ] || { echo "warn: cannot write $extdir — 0003 will fail without the http extension"; return 0; }
  cat > "$extdir/http.control" <<'EOF'
comment = 'stub http for scratch probes'
default_version = '0'
relocatable = false
schema = 'extensions'
EOF
  cat > "$extdir/http--0.sql" <<'EOF'
create type @extschema@.http_response as (status int, content_type text, content text);
create function @extschema@.http_get(uri text) returns @extschema@.http_response
  language sql as 'select (0, null, null)::@extschema@.http_response';
EOF
}

# Same story for pg_net (0091's lead-alert poke): not packaged locally, and the
# probes never fire an HTTP call. Stub net.http_post so the migration applies —
# without it the run dies at 0091 and every later migration goes unchecked.
# (Signature matches pg_net's real one: 0091 calls it with named arguments.)
stub_pg_net_ext() {
  local extdir=/usr/share/postgresql/16/extension
  [ -w "$extdir" ] || { echo "warn: cannot write $extdir — 0091 will fail without pg_net"; return 0; }
  cat > "$extdir/pg_net.control" <<'EOF'
comment = 'stub pg_net for scratch probes'
default_version = '0'
relocatable = false
schema = 'net'
EOF
  cat > "$extdir/pg_net--0.sql" <<'EOF'
create function @extschema@.http_post(url text, body jsonb default '{}'::jsonb,
    params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language sql as 'select 0::bigint';
EOF
}

$PSQL -d postgres -c 'select 1' >/dev/null 2>&1 || start_cluster
stub_http_ext
stub_pg_net_ext
$PSQL -d postgres -q -c "drop database if exists scratch" -c "create database scratch"

RUN="$PSQL -d scratch -v ON_ERROR_STOP=1 -q"
$RUN -f scripts/db/supabase-shim.sql 2>/dev/null
$RUN -c "create schema if not exists extensions;" -c "create schema if not exists net;"
for f in supabase/migrations/*.sql; do
  $RUN -f "$f" >/dev/null || { echo "MIGRATION FAILED: $f"; exit 1; }
done
echo "all migrations applied"

$RUN -f scripts/db/native-league-probes.sql | grep -E "PROBE FAIL|ALL PROBES" || { echo "PROBES FAILED"; exit 1; }
$RUN -f scripts/db/preseason-practice-probes.sql | grep -E "PROBE FAIL|PROBES PASS" || { echo "PRESEASON PROBES FAILED"; exit 1; }
$RUN -f scripts/db/window-pot-probes.sql | grep -E "PROBE FAIL|ALL POT PROBES" || { echo "POT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/league-board-probes.sql | grep -E "PROBE FAIL|ALL BOARD PROBES" || { echo "BOARD PROBES FAILED"; exit 1; }
$RUN -f scripts/db/team-manager-probes.sql | grep -E "PROBE FAIL|ALL TEAM-MANAGER PROBES" || { echo "TEAM-MANAGER PROBES FAILED"; exit 1; }
$RUN -f scripts/db/waiver-rules-probes.sql | grep -E "PROBE FAIL|ALL WAIVER-RULES PROBES" || { echo "WAIVER-RULES PROBES FAILED"; exit 1; }
$RUN -f scripts/db/code-request-email-probes.sql | grep -E "PROBE FAIL|ALL CODE-REQUEST-EMAIL PROBES" || { echo "CODE-REQUEST-EMAIL PROBES FAILED"; exit 1; }
$RUN -f scripts/db/member-sync-probes.sql | grep -E "PROBE FAIL|ALL MEMBER-SYNC PROBES" || { echo "MEMBER-SYNC PROBES FAILED"; exit 1; }
$RUN -f scripts/db/lock-hold-probes.sql | grep -E "PROBE FAIL|ALL LOCK-HOLD PROBES" || { echo "LOCK-HOLD PROBES FAILED"; exit 1; }
$RUN -f scripts/db/backup-assign-probes.sql | grep -E "PROBE FAIL|ALL BACKUP-ASSIGN PROBES" || { echo "BACKUP-ASSIGN PROBES FAILED"; exit 1; }
$RUN -f scripts/db/favorites-probes.sql | grep -E "PROBE FAIL|ALL FAVORITES PROBES" || { echo "FAVORITES PROBES FAILED"; exit 1; }
$RUN -f scripts/db/trade-signal-probes.sql | grep -E "PROBE FAIL|ALL TRADE-SIGNAL PROBES" || { echo "TRADE-SIGNAL PROBES FAILED"; exit 1; }
$RUN -f scripts/db/commish-kit-probes.sql | grep -E "PROBE FAIL|ALL COMMISH-KIT PROBES" || { echo "COMMISH-KIT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/player-team-probes.sql | grep -E "PROBE FAIL|ALL PLAYER-TEAM PROBES" || { echo "PLAYER-TEAM PROBES FAILED"; exit 1; }
$RUN -f scripts/db/league-scoring-probes.sql | grep -E "PROBE FAIL|ALL LEAGUE-SCORING PROBES" || { echo "LEAGUE-SCORING PROBES FAILED"; exit 1; }
$RUN -f scripts/db/flag-rules-probes.sql | grep -E "PROBE FAIL|ALL FLAG-RULES PROBES" || { echo "FLAG-RULES PROBES FAILED"; exit 1; }
$RUN -f scripts/db/chat-probes.sql | grep -E "PROBE FAIL|ALL CHAT PROBES" || { echo "CHAT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/browse-as-probes.sql | grep -E "PROBE FAIL|ALL BROWSE-AS PROBES" || { echo "BROWSE-AS PROBES FAILED"; exit 1; }
$RUN -f scripts/db/push-probes.sql | grep -E "PROBE FAIL|ALL PUSH PROBES" || { echo "PUSH PROBES FAILED"; exit 1; }
$RUN -f scripts/db/league-seen-probes.sql | grep -E "PROBE FAIL|ALL LEAGUE-SEEN PROBES" || { echo "LEAGUE-SEEN PROBES FAILED"; exit 1; }
$RUN -f scripts/db/draft-night-probes.sql | grep -E "PROBE FAIL|ALL DRAFT-NIGHT PROBES" || { echo "DRAFT-NIGHT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/league-signals-probes.sql | grep -E "PROBE FAIL|ALL LEAGUE-SIGNALS PROBES" || { echo "LEAGUE-SIGNALS PROBES FAILED"; exit 1; }
$RUN -f scripts/db/live-buffs-probes.sql | grep -E "PROBE FAIL|ALL LIVE-BUFFS PROBES" || { echo "LIVE-BUFFS PROBES FAILED"; exit 1; }
$RUN -f scripts/db/league-preview-probes.sql | grep -E "PROBE FAIL|ALL LEAGUE-PREVIEW PROBES" || { echo "LEAGUE-PREVIEW PROBES FAILED"; exit 1; }
$RUN -f scripts/db/game-mode-probes.sql | grep -E "PROBE FAIL|ALL GAME-MODE PROBES" || { echo "GAME-MODE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/auto-playoffs-probes.sql | grep -E "PROBE FAIL|ALL AUTO-PLAYOFFS PROBES" || { echo "AUTO-PLAYOFFS PROBES FAILED"; exit 1; }
$RUN -f scripts/db/roster-builder-probes.sql | grep -E "PROBE FAIL|ALL ROSTER-BUILDER PROBES" || { echo "ROSTER-BUILDER PROBES FAILED"; exit 1; }
$RUN -f scripts/db/taxi-ir-probes.sql | grep -E "PROBE FAIL|ALL TAXI-IR PROBES" || { echo "TAXI-IR PROBES FAILED"; exit 1; }
$RUN -f scripts/db/faab-grant-probes.sql | grep -E "PROBE FAIL|ALL FAAB-GRANT PROBES" || { echo "FAAB-GRANT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/draft-setup-probes.sql | grep -E "PROBE FAIL|ALL DRAFT-SETUP PROBES" || { echo "DRAFT-SETUP PROBES FAILED"; exit 1; }
$RUN -f scripts/db/draft-schedule-probes.sql | grep -E "PROBE FAIL|ALL DRAFT-SCHEDULE PROBES" || { echo "DRAFT-SCHEDULE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/classic-open-lineups-probes.sql | grep -E "PROBE FAIL|ALL CLASSIC-OPEN-LINEUP PROBES" || { echo "CLASSIC-OPEN-LINEUP PROBES FAILED"; exit 1; }
$RUN -f scripts/db/seat-agent-probes.sql | grep -E "PROBE FAIL|ALL SEAT-AGENT PROBES" || { echo "SEAT-AGENT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/dynasty-probes.sql | grep -E "PROBE FAIL|ALL DYNASTY PROBES" || { echo "DYNASTY PROBES FAILED"; exit 1; }
$RUN -f scripts/db/pick-asset-probes.sql | grep -E "PROBE FAIL|ALL PICK-ASSET PROBES" || { echo "PICK-ASSET PROBES FAILED"; exit 1; }
$RUN -f scripts/db/register-probes.sql | grep -E "PROBE FAIL|ALL REGISTER PROBES" || { echo "REGISTER PROBES FAILED"; exit 1; }
$RUN -f scripts/db/league-name-probes.sql | grep -E "PROBE FAIL|ALL LEAGUE-NAME PROBES" || { echo "LEAGUE-NAME PROBES FAILED"; exit 1; }
$RUN -f scripts/db/leave-delete-probes.sql | grep -E "PROBE FAIL|ALL LEAVE-DELETE PROBES" || { echo "LEAVE-DELETE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/lottery-probes.sql | grep -E "PROBE FAIL|ALL LOTTERY PROBES" || { echo "LOTTERY PROBES FAILED"; exit 1; }
$RUN -f scripts/db/draft-trading-probes.sql | grep -E "PROBE FAIL|ALL DRAFT-TRADING PROBES" || { echo "DRAFT-TRADING PROBES FAILED"; exit 1; }
$RUN -f scripts/db/draft-controls-probes.sql | grep -E "PROBE FAIL|ALL DRAFT-CONTROLS PROBES" || { echo "DRAFT-CONTROLS PROBES FAILED"; exit 1; }
$RUN -f scripts/db/roster-size-probes.sql | grep -E "PROBE FAIL|ALL ROSTER-SIZE PROBES" || { echo "ROSTER-SIZE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/ir-rounds-probes.sql | grep -E "PROBE FAIL|ALL IR-ROUNDS PROBES" || { echo "IR-ROUNDS PROBES FAILED"; exit 1; }
