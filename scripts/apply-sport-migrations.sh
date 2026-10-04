#!/usr/bin/env bash
# Apply the multi-sport migrations (0424 → 0432) to a Supabase project, in
# order, stopping at the first error. Needs the project's Postgres connection
# string (Supabase dashboard → Project Settings → Database → Connection string,
# the "session" URI; use the pooler URI on port 6543 if 5432 is closed).
#
#   DATABASE_URL='postgresql://postgres.<ref>:<password>@...pooler.supabase.com:5432/postgres' \
#     scripts/apply-sport-migrations.sh
#
# Idempotent: every migration uses `create or replace` / `if not exists`, and
# the two that alter a key or backfill guard themselves, so re-running after a
# partial apply is safe. The optional first argument is the first file to
# apply (e.g. 0426 to skip ones already run).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL to the Postgres connection string of the project}"
from="${1:-0424}"
for f in supabase/migrations/0424_sports.sql \
         supabase/migrations/0425_sport_directory.sql \
         supabase/migrations/0426_sport_leagues.sql \
         supabase/migrations/0427_sport_roto.sql \
         supabase/migrations/0428_sport_settings.sql \
         supabase/migrations/0429_sport_no_playoffs_yet.sql \
         supabase/migrations/0430_sport_locks_per_game.sql \
         supabase/migrations/0431_sport_lineup_and_card.sql \
         supabase/migrations/0432_sports_flag.sql; do
  n=$(basename "$f" | cut -c1-4)
  if [[ "$n" < "$from" ]]; then echo "skip    $f"; continue; fi
  echo "apply   $f"
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
echo "done: sport tables, RPCs and the sports flag are in place."
echo "grant the flag to a non-admin tester with:"
cat <<'SQL'
  select admin_set_feature('email@example.com', 'sports', true);
SQL
