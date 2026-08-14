# Functional player flags (0144)

Founder spec (2026-08-14): flags stop being labels and start being RULES —
"we want the flags to function in the league for roster and scoring
actions/bonuses/gating", set individually or in bulk with a filter.

## The rules

Stored per flag in `player_flag.rules` (jsonb), any combination:

| key          | type    | effect                                                                 | enforced at |
|--------------|---------|------------------------------------------------------------------------|-------------|
| `no_trade`   | bool    | player cannot be included in a trade                                    | propose_trade + execute_trade (server) |
| `no_add`     | bool    | player cannot be added from FA or claimed off waivers                   | add_free_agent + submit_waiver_claim + process_waivers (server) |
| `no_start`   | bool    | player cannot be fielded in a weekly lineup                             | sealed_pick trigger (manager writes only; server/admin exempt) + client pickers grey him + worker auto-fill excludes him |
| `no_powerups`| bool    | no powerup/battle-play effect may target the slot he occupies           | engine (extras filtered at resolve, both resolvers) + client apply UI grey |
| `immune`     | bool    | opponent denial (nuke wipe / erase / reset / compression trim / clock stop / steal) does not touch his bank or drip | engine, both resolvers — the TE-drip immunity precedent, generalized |
| `bonus_mult` | number  | his per-play points score × mult (0.5..3, step 0.1; 1 = off)            | engine scorePlay wrapper |
| `bonus_pts`  | number  | flat points added to his bank at game end (-10..+10, int; 0 = off)      | engine end-of-game |

`label` stays the human reason ("suspended", "league winner bonus") and renders
in the ⚑ chip; rules add compact glyphs to the chip title.

## Who reads the rules where

- **Server SQL** (trade/add/start gates): reads `player_flag` directly in the
  gated RPCs/trigger — no client trust.
- **Engine** (bonus / immunity / no-powerups): core commish cache grows rules
  (`flagRulesFor(slug)`); the WEB board loads it with the commish-kit effect;
  the WORKER prefetches `player_flag` rows per league in `prefetchTick` and
  installs them SYNCHRONOUSLY immediately before each resolve, exactly like
  the 0143 scoring knobs and for the same reason (20-way Promise.all — an
  install separated from its resolve by an await can be overwritten by a
  sibling matchup).
- **Worker auto-fill** (`lock.js` materializer): excludes `no_start` slugs
  from the pool it fills from, else the system fields a banned player.

## Bulk editing

The filter lives client-side: the flags editor grows a BULK mode — search +
position chips + NFL team filter over the directory, multi-select, one label +
one rule set applied to all selected via `set_player_flags_bulk(league,
slugs[], label, rules)` (server re-validates every slug's rules bounds).

## Non-goals (v1)

- Rules on Sleeper-league *roster* actions (trades/adds happen on Sleeper) —
  no_trade/no_add only bite native leagues; no_start/no_powerups/immune/bonus
  bite everywhere.
- Retroactive re-scoring: a rules change applies from the next tick, like the
  scoring knobs.
