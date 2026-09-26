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

# ── THE REGULAR-SEASON SLATE IS PUSHED OUT OF THE REAL CALENDAR ─────────────
# Probe fixtures write week-1..5 lineups, and the 0178/0058 window locks read
# the REAL slate for that week — so those suites began failing by CALENDAR
# rather than by code on the day the baked 2026 season kicked off (10 Sep
# 2026). The scratch DB is throwaway, so the fix belongs here rather than in a
# dozen fixtures: shift the regular season a decade out.
#
# REGULAR WEEKS ONLY (1..18). Preseason weeks (101+) are deliberately left
# where they are — preseason-practice-probes asserts which practice weeks are
# PLAYABLE, which is a question about the real clock, and shifting those turned
# its "3 playable" into 4. Relative order inside the regular season, which is
# all any week logic depends on, is untouched; a suite that wants a kickoff in
# the PAST still plants its own row and still wins the MIN the trigger reads.
$RUN -c "update nfl_slate set kickoff = kickoff + interval '10 years' where week between 1 and 18 and kickoff is not null;" >/dev/null
echo "regular-season slate shifted +10y (fixtures are calendar-independent)"

# ── EACH SUITE STARTS FROM THE SAME SLATE ────────────────────────────────────
# Suites plant their own games — "BUF kicked off two hours ago" is how a lock
# gets tested — and most leave them behind. Left behind, a game that kicked off
# an hour ago is a game in progress for every suite that runs after it, and
# the after-games waiver hold (0337) reads exactly that: waiver-rules w20 and
# waiver-schedule ws10 failed or passed by which suites happened to run
# first. So the slate is snapshotted here and put back before every suite. A
# suite's plants still hold for the whole of that suite; they just end with it.
$RUN -c "create table _probe_slate as select * from nfl_slate;" \
     -c "create procedure _probe_reset_slate() language sql as \$\$ delete from nfl_slate; insert into nfl_slate select * from _probe_slate; \$\$;" >/dev/null
probe_run() { $PSQL -d scratch -v ON_ERROR_STOP=1 -q -c "call _probe_reset_slate()" "$@"; }
RUN=probe_run

$RUN -f scripts/db/native-league-probes.sql | grep -E "PROBE FAIL|ALL PROBES" || { echo "PROBES FAILED"; exit 1; }
$RUN -f scripts/db/auction-engine-probes.sql | grep -E "PROBE FAIL|ALL AUCTION-ENGINE PROBES" || { echo "AUCTION-ENGINE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/division-probes.sql | grep -E "PROBE FAIL|ALL DIVISION PROBES" || { echo "DIVISION PROBES FAILED"; exit 1; }
$RUN -f scripts/db/contract-probes.sql | grep -E "PROBE FAIL|ALL CONTRACT PROBES" || { echo "CONTRACT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/format-probes.sql | grep -E "PROBE FAIL|ALL FORMAT PROBES" || { echo "FORMAT PROBES FAILED"; exit 1; }
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
$RUN -f scripts/db/edit-pick-probes.sql | grep -E "PROBE FAIL|ALL EDIT-PICK PROBES" || { echo "EDIT-PICK PROBES FAILED"; exit 1; }
$RUN -f scripts/db/pos-default-probes.sql | grep -E "PROBE FAIL|ALL POS-DEFAULT PROBES" || { echo "POS-DEFAULT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/taxi-rules-probes.sql | grep -E "PROBE FAIL|ALL TAXI-RULES PROBES" || { echo "TAXI-RULES PROBES FAILED"; exit 1; }
$RUN -f scripts/db/scoped-scope-probes.sql | grep -E "PROBE FAIL|ALL SCOPED-SCOPE PROBES" || { echo "SCOPED-SCOPE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/ir-eligibility-probes.sql | grep -E "PROBE FAIL|ALL IR-ELIGIBILITY PROBES" || { echo "IR-ELIGIBILITY PROBES FAILED"; exit 1; }
$RUN -f scripts/db/ir-after-draft-probes.sql | grep -E "PROBE FAIL|ALL IR-AFTER-DRAFT PROBES" || { echo "IR-AFTER-DRAFT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/seat-cap-probes.sql | grep -E "PROBE FAIL|ALL SEAT-CAP PROBES" || { echo "SEAT-CAP PROBES FAILED"; exit 1; }
$RUN -f scripts/db/golf-mode-probes.sql | grep -E "PROBE FAIL|ALL GOLF-MODE PROBES" || { echo "GOLF-MODE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/rename-spot-probes.sql | grep -E "PROBE FAIL|ALL RENAME-SPOT PROBES" || { echo "RENAME-SPOT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/market-probes.sql | grep -E "PROBE FAIL|ALL MARKET PROBES" || { echo "MARKET PROBES FAILED"; exit 1; }
$RUN -f scripts/db/manual-sync-probes.sql | grep -E "PROBE FAIL|ALL MANUAL-SYNC PROBES" || { echo "MANUAL-SYNC PROBES FAILED"; exit 1; }
$RUN -f scripts/db/identity-probes.sql | grep -E "PROBE FAIL|ALL IDENTITY PROBES" || { echo "IDENTITY PROBES FAILED"; exit 1; }
$RUN -f scripts/db/invite-preview-probes.sql | grep -E "PROBE FAIL|ALL INVITE-PREVIEW PROBES" || { echo "INVITE-PREVIEW PROBES FAILED"; exit 1; }
$RUN -f scripts/db/waitlist-door-probes.sql | grep -E "PROBE FAIL|ALL WAITLIST-DOOR PROBES" || { echo "WAITLIST-DOOR PROBES FAILED"; exit 1; }
$RUN -f scripts/db/reception-scoring-probes.sql | grep -E "PROBE FAIL|ALL RECEPTION-SCORING PROBES" || { echo "RECEPTION-SCORING PROBES FAILED"; exit 1; }
$RUN -f scripts/db/chat-reaction-probes.sql | grep -E "PROBE FAIL|ALL CHAT-REACTION PROBES" || { echo "CHAT-REACTION PROBES FAILED"; exit 1; }
$RUN -f scripts/db/metricless-audit-probes.sql | grep -E "PROBE FAIL|ALL METRICLESS-AUDIT PROBES" || { echo "METRICLESS-AUDIT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/agent-wire-probes.sql | grep -E "PROBE FAIL|ALL AGENT-WIRE PROBES" || { echo "AGENT-WIRE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/drip-agent-probes.sql | grep -E "PROBE FAIL|ALL DRIP-AGENT PROBES" || { echo "DRIP-AGENT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/team-cap-probes.sql | grep -E "PROBE FAIL|ALL TEAM-CAP PROBES" || { echo "TEAM-CAP PROBES FAILED"; exit 1; }
$RUN -f scripts/db/guillotine-weeks-probes.sql | grep -E "PROBE FAIL|ALL GUILLOTINE-WEEKS PROBES" || { echo "GUILLOTINE-WEEKS PROBES FAILED"; exit 1; }
$RUN -f scripts/db/playoffs-off-probes.sql | grep -E "PROBE FAIL|ALL PLAYOFFS-OFF PROBES" || { echo "PLAYOFFS-OFF PROBES FAILED"; exit 1; }
$RUN -f scripts/db/bye-week-probes.sql | grep -E "PROBE FAIL|ALL BYE-WEEK PROBES" || { echo "BYE-WEEK PROBES FAILED"; exit 1; }
$RUN -f scripts/db/season-sim-probes.sql | grep -E "SIM .* FAIL|PROBE FAIL|ALL SEASON-SIM PROBES" || { echo "SEASON-SIM PROBES FAILED"; exit 1; }
$RUN -f scripts/db/coin-mint-probes.sql | grep -E "PROBE FAIL|ALL COIN-MINT PROBES" || { echo "COIN-MINT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/worker-progression-probes.sql | grep -E "PROBE FAIL|ALL WORKER-PROGRESSION PROBES" || { echo "WORKER-PROGRESSION PROBES FAILED"; exit 1; }
$RUN -f scripts/db/stamp-week-probes.sql | grep -E "SW. FAIL|PROBE FAIL|ALL STAMP-WEEK PROBES" || { echo "STAMP-WEEK PROBES FAILED"; exit 1; }
$RUN -f scripts/db/sim-run-probes.sql | grep -E "SR. FAIL|PROBE FAIL|ALL SIM-RUN PROBES" || { echo "SIM-RUN PROBES FAILED"; exit 1; }
$RUN -f scripts/db/convert-league-probes.sql | grep -E "PROBE FAIL|ALL CONVERT-LEAGUE PROBES" || { echo "CONVERT-LEAGUE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/pool-twin-repair-probes.sql | grep -E "PROBE FAIL|ALL POOL-TWIN-REPAIR PROBES" || { echo "POOL-TWIN-REPAIR PROBES FAILED"; exit 1; }
$RUN -f scripts/db/pool-doctor-probes.sql | grep -E "PROBE FAIL|ALL POOL-DOCTOR PROBES" || { echo "POOL-DOCTOR PROBES FAILED"; exit 1; }
$RUN -f scripts/db/sim-percent-probes.sql | grep -E "PROBE FAIL|ALL SIM-PERCENT PROBES" || { echo "SIM-PERCENT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/chopping-block-probes.sql | grep -E "PROBE FAIL|ALL CHOPPING-BLOCK PROBES" || { echo "CHOPPING-BLOCK PROBES FAILED"; exit 1; }
$RUN -f scripts/db/vampire-coven-probes.sql | grep -E "PROBE FAIL|ALL VAMPIRE-COVEN PROBES" || { echo "VAMPIRE-COVEN PROBES FAILED"; exit 1; }
$RUN -f scripts/db/block-history-probes.sql | grep -E "PROBE FAIL|ALL BLOCK-HISTORY PROBES" || { echo "BLOCK-HISTORY PROBES FAILED"; exit 1; }
$RUN -f scripts/db/tell-the-chopped-probes.sql | grep -E "PROBE FAIL|ALL TELL-THE-CHOPPED PROBES" || { echo "TELL-THE-CHOPPED PROBES FAILED"; exit 1; }
$RUN -f scripts/db/vampire-rules-probes.sql | grep -E "PROBE FAIL|ALL VAMPIRE-RULES PROBES" || { echo "VAMPIRE-RULES PROBES FAILED"; exit 1; }
$RUN -f scripts/db/invite-landing-probes.sql | grep -E "PROBE FAIL|ALL INVITE-LANDING PROBES" || { echo "INVITE-LANDING PROBES FAILED"; exit 1; }
$RUN -f scripts/db/week-report-probes.sql | grep -E "PROBE FAIL|ALL WEEK-REPORT PROBES" || { echo "WEEK-REPORT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/dropped-pick-probes.sql | grep -E "PROBE FAIL|ALL DROPPED-PICK PROBES" || { echo "DROPPED-PICK PROBES FAILED"; exit 1; }
$RUN -f scripts/db/draft-midseason-probes.sql | grep -E "PROBE FAIL|ALL DRAFT-MIDSEASON PROBES" || { echo "DRAFT-MIDSEASON PROBES FAILED"; exit 1; }
$RUN -f scripts/db/schedule-start-probes.sql | grep -E "PROBE FAIL|ALL SCHEDULE-START PROBES" || { echo "SCHEDULE-START PROBES FAILED"; exit 1; }
$RUN -f scripts/db/practice-room-probes.sql | grep -E "PROBE FAIL|ALL PRACTICE-ROOM PROBES" || { echo "PRACTICE-ROOM PROBES FAILED"; exit 1; }
$RUN -f scripts/db/draft-log-probes.sql | grep -E "PROBE FAIL|ALL DRAFT-LOG PROBES" || { echo "DRAFT-LOG PROBES FAILED"; exit 1; }
$RUN -f scripts/db/presence-probes.sql | grep -E "PROBE FAIL|ALL PRESENCE PROBES" || { echo "PRESENCE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/fa-off-probes.sql | grep -E "PROBE FAIL|ALL FA-OFF PROBES" || { echo "FA-OFF PROBES FAILED"; exit 1; }
$RUN -f scripts/db/txn-chat-probes.sql | grep -E "PROBE FAIL|ALL TXN-CHAT PROBES" || { echo "TXN-CHAT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/player-depth-probes.sql | grep -E "PROBE FAIL|ALL PLAYER-DEPTH PROBES" || { echo "PLAYER-DEPTH PROBES FAILED"; exit 1; }
$RUN -f scripts/db/week-audit-probes.sql | grep -E "PROBE FAIL|ALL WEEK-AUDIT PROBES" || { echo "WEEK-AUDIT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/extra-slot-card-probes.sql | grep -E "PROBE FAIL|ALL EXTRA-SLOT-CARD PROBES" || { echo "EXTRA-SLOT-CARD PROBES FAILED"; exit 1; }
$RUN -f scripts/db/browse-as-team-probes.sql | grep -E "PROBE FAIL|ALL BROWSE-AS-TEAM PROBES" || { echo "BROWSE-AS-TEAM PROBES FAILED"; exit 1; }
$RUN -f scripts/db/out-spot-probes.sql | grep -E "PROBE FAIL|ALL OUT-SPOT PROBES" || { echo "OUT-SPOT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/trade-floor-probes.sql | grep -E "PROBE FAIL|ALL TRADE-FLOOR PROBES" || { echo "TRADE-FLOOR PROBES FAILED"; exit 1; }
$RUN -f scripts/db/multi-trade-probes.sql | grep -E "PROBE FAIL|ALL MULTI-TRADE PROBES" || { echo "MULTI-TRADE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/conditional-claim-probes.sql | grep -E "PROBE FAIL|ALL CONDITIONAL-CLAIM PROBES" || { echo "CONDITIONAL-CLAIM PROBES FAILED"; exit 1; }
$RUN -f scripts/db/history-probes.sql | grep -E "PROBE FAIL|ALL HISTORY PROBES" || { echo "HISTORY PROBES FAILED"; exit 1; }
$RUN -f scripts/db/award-probes.sql | grep -E "PROBE FAIL|ALL AWARD PROBES" || { echo "AWARD PROBES FAILED"; exit 1; }
$RUN -f scripts/db/public-api-probes.sql | grep -E "PROBE FAIL|ALL PUBLIC-API PROBES" || { echo "PUBLIC-API PROBES FAILED"; exit 1; }
$RUN -f scripts/db/trade-undo-probes.sql | grep -E "PROBE FAIL|ALL TRADE-UNDO PROBES" || { echo "TRADE-UNDO PROBES FAILED"; exit 1; }
$RUN -f scripts/db/week-proj-probes.sql | grep -E "PROBE FAIL|ALL WEEK-PROJ PROBES" || { echo "WEEK-PROJ PROBES FAILED"; exit 1; }
$RUN -f scripts/db/matchup-mult-probes.sql | grep -E "PROBE FAIL|ALL MATCHUP-MULT PROBES" || { echo "MATCHUP-MULT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/xref-probes.sql | grep -E "PROBE FAIL|ALL XREF PROBES" || { echo "XREF PROBES FAILED"; exit 1; }
$RUN -f scripts/db/adp-board-probes.sql | grep -E "PROBE FAIL|ALL ADP-BOARD PROBES" || { echo "ADP-BOARD PROBES FAILED"; exit 1; }
$RUN -f scripts/db/board-refresh-probes.sql | grep -E "PROBE FAIL|ALL BOARD-REFRESH PROBES" || { echo "BOARD-REFRESH PROBES FAILED"; exit 1; }
$RUN -f scripts/db/round-audit-probes.sql | grep -E "PROBE FAIL|ALL ROUND-AUDIT PROBES" || { echo "ROUND-AUDIT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/waiver-schedule-probes.sql | grep -E "PROBE FAIL|ALL WAIVER-SCHEDULE PROBES" || { echo "WAIVER-SCHEDULE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/report-regen-probes.sql | grep -E "PROBE FAIL|ALL REPORT-REGEN PROBES" || { echo "REPORT-REGEN PROBES FAILED"; exit 1; }
$RUN -f scripts/db/trend-board-probes.sql | grep -E "PROBE FAIL|ALL TREND-BOARD PROBES" || { echo "TREND-BOARD PROBES FAILED"; exit 1; }
$RUN -f scripts/db/league-tab-probes.sql | grep -E "PROBE FAIL|ALL LEAGUE-TAB PROBES" || { echo "LEAGUE-TAB PROBES FAILED"; exit 1; }
$RUN -f scripts/db/waiver-run-probes.sql | grep -E "PROBE FAIL|ALL WAIVER-RUN PROBES" || { echo "WAIVER-RUN PROBES FAILED"; exit 1; }
$RUN -f scripts/db/stale-final-probes.sql | grep -E "PROBE FAIL|ALL STALE-FINAL PROBES" || { echo "STALE-FINAL PROBES FAILED"; exit 1; }
$RUN -f scripts/db/shelf-probes.sql | grep -E "PROBE FAIL|ALL SHELF PROBES" || { echo "SHELF PROBES FAILED"; exit 1; }
$RUN -f scripts/db/write-api-probes.sql | grep -E "PROBE FAIL|ALL WRITE-API PROBES" || { echo "WRITE-API PROBES FAILED"; exit 1; }
SCRATCH_PG_DIR=$DIR SCRATCH_PG_PORT=$PORT npx tsx scripts/db/write-api-e2e.mjs | grep -E "^FAIL|ALL WRITE-API E2E PASS" || { echo "WRITE-API E2E FAILED"; exit 1; }
$RUN -f scripts/db/rescore-probes.sql | grep -E "PROBE FAIL|ALL RESCORE PROBES" || { echo "RESCORE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/undo-hold-probes.sql | grep -E "PROBE FAIL|ALL UNDO-HOLD PROBES" || { echo "UNDO-HOLD PROBES FAILED"; exit 1; }
$RUN -f scripts/db/adjust-probes.sql | grep -E "PROBE FAIL|ALL ADJUST PROBES" || { echo "ADJUST PROBES FAILED"; exit 1; }
$RUN -f scripts/db/lineup-fix-probes.sql | grep -E "PROBE FAIL|ALL LINEUP-FIX PROBES" || { echo "LINEUP-FIX PROBES FAILED"; exit 1; }
$RUN -f scripts/db/redraw-probes.sql | grep -E "PROBE FAIL|ALL REDRAW PROBES" || { echo "REDRAW PROBES FAILED"; exit 1; }
$RUN -f scripts/db/txn-limit-probes.sql | grep -E "PROBE FAIL|ALL TXN-LIMIT PROBES" || { echo "TXN-LIMIT PROBES FAILED"; exit 1; }
$RUN -f scripts/db/seed-override-probes.sql | grep -E "PROBE FAIL|ALL SEED-OVERRIDE PROBES" || { echo "SEED-OVERRIDE PROBES FAILED"; exit 1; }
$RUN -f scripts/db/roster-legal-probes.sql | grep -E "PROBE FAIL|ALL ROSTER-LEGAL PROBES" || { echo "ROSTER-LEGAL PROBES FAILED"; exit 1; }
$RUN -f scripts/db/college-probes.sql | grep -E "PROBE FAIL|ALL COLLEGE PROBES" || { echo "COLLEGE PROBES FAILED"; exit 1; }
