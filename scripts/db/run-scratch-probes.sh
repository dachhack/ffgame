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

$PSQL -d postgres -c 'select 1' >/dev/null 2>&1 || start_cluster
stub_http_ext
$PSQL -d postgres -q -c "drop database if exists scratch" -c "create database scratch"

RUN="$PSQL -d scratch -v ON_ERROR_STOP=1 -q"
$RUN -f scripts/db/supabase-shim.sql 2>/dev/null
$RUN -c "create schema if not exists extensions;"
for f in supabase/migrations/*.sql; do
  $RUN -f "$f" >/dev/null || { echo "MIGRATION FAILED: $f"; exit 1; }
done
echo "all migrations applied"

$RUN -f scripts/db/native-league-probes.sql | grep -E "PROBE FAIL|ALL PROBES" || { echo "PROBES FAILED"; exit 1; }
