# Scratch Postgres for the contest-league SQL (v0.664 → v0.670)

A throwaway cluster that loads the contest migrations over stubs, so a
migration's functions can be exercised before it ships. Nothing here is
run by CI.

```sh
# a cluster on port 5499, socket /tmp (postgres 16 at /usr/lib/postgresql/16/bin)
mkdir -p /tmp/pg5499 && chown postgres:postgres /tmp/pg5499
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pg5499 -A trust -U postgres"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg5499 -o '-p 5499 -k /tmp' -l /tmp/pg.log -w start"
for r in anon authenticated service_role; do psql -h /tmp -p 5499 -U postgres -qc "create role $r"; done

# a database with the chain loaded (add newer migrations at the end)
psql -h /tmp -p 5499 -U postgres -qc "drop database if exists t" -c "create database t"
psql -h /tmp -p 5499 -U postgres -d t -q -v ON_ERROR_STOP=1 \
  -f scripts/db/scratch/stub6.sql -f scripts/db/scratch/stub7.sql \
  -f supabase/migrations/0459_the_dev_room.sql -f supabase/migrations/0462_dfs_bullseye.sql \
  -f supabase/migrations/0463_bullseye_leagues.sql -f supabase/migrations/0464_dev_room_roster.sql \
  -f supabase/migrations/0465_dev_room_chat_tools.sql -f scripts/db/scratch/stub8.sql \
  -f supabase/migrations/0466_contest_leagues.sql -f scripts/db/scratch/stub9.sql \
  -f supabase/migrations/0467_salary_pricing.sql -f supabase/migrations/0469_contest_cap_and_floor.sql \
  -f supabase/migrations/0470_contest_kickoff_lock.sql -f supabase/migrations/0471_h2h_records.sql \
  -f supabase/migrations/0472_hc_scoring_preset.sql

# the flows (each \i's flow10's setup; run one per fresh database)
psql -h /tmp -p 5499 -U postgres -d t -q -v ON_ERROR_STOP=1 -f scripts/db/scratch/flow14.sql
```

- `stub6–9.sql` — the tables and functions the chain needs (auth.uid() reads
  `t.uid` via set_config; `is_admin`, `is_league_commish`, the slate, the
  injury table, …).
- `flow10` creates leagues H (4-seat head-to-head), G (golf board) and Bull,
  joins, saves squads, exercises the spot rules. `flow11` the injury rule
  (0467); `flow12` cap/floor (0469); `flow13` auto-sub + kickoff lock
  (0470); `flow14` head-to-head records (0471).
- The cluster is not persistent across sessions: re-run the recipe.
