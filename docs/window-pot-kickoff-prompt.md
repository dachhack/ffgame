# Kickoff prompt — build the Window Pot v1

> Copy everything below the rule into a fresh Claude session on this repo.
> Companion docs: `docs/window-pot.md` (the spec — authoritative),
> `HANDOFF.md` "First live-fire" (current system state), `STATUS.md`.

---

Build **Window Pot v1** — poker-style drip-coin betting on game windows —
exactly as specified in `docs/window-pot.md`, feature-flagged OFF by default.

## Read first (in this order)

1. `docs/window-pot.md` — the spec. §6's fifteen scenarios are acceptance
   criteria, not suggestions. v1 scope = S1–S9 and S12–S15 (ante + blind
   street + standing policy + settlement). The reveal/live streets (S10) and
   AI bidding (§8) are **v2/v3 — do not build them**, but leave seams.
2. `HANDOFF.md` top entry ("First live-fire") — how the live pipeline
   actually behaves, and the write-error / idempotency lessons this feature
   must be born knowing.
3. Patterns to copy, not reinvent:
   - `supabase/migrations/0064_native_leagues.sql` — RPC style: SECURITY
     DEFINER, per-league/matchup **advisory locks**, RLS member-read +
     RPC-only writes, and the committed probes harness.
   - `supabase/migrations/0025_*` / `0035_*` — the wallet:
     `spend_from_wallet` / `credit_wallet` **with idempotency keys**. Every
     pot mutation goes through these; never touch balances directly.
   - `supabase/migrations/0069_*` — committed-money budget rules and
     night-aware deadlines (`awake_deadline`) for the response clocks.
   - `supabase/migrations/0094_feature_gates.sql` — how per-league/account
     gating is done here.
   - `server/src/lock.js` + `server/src/index.js` tick — where `pot_ante_all`
     (at matchup lock) and `pot_sweep` (clock expiry, street close at window
     kickoff, settlement at window final) hook in. Settlement must ride the
     same resolve pass that pays the window bonus, with idem keys — the
     worker re-resolves every 25s and after restarts; replays must be no-ops.
   - `src/screens/Matchup.tsx` `WindowBattleBar` — the pot chip + action
     sheet lives here; the `★ window + bonus = week` equation line shows how
     final-state explanations are phrased.
   - `scripts/db/run-scratch-probes.sh` + `native-league-probes.sql` — write
     `window-pot-probes.sql` in the same style and wire it into the script.

## Deliverables

1. **Migration `0104_window_pot.sql`** (or next free number): `window_pot`,
   `pot_action`, `league_membership.pot_auto_call` (default 10, owner-only
   read), `league.pot_ante` (default **0 = feature OFF**); RPCs `pot_raise`,
   `pot_respond`, `pot_state`, and service-role `pot_ante_all` / `pot_sweep`
   per the spec §7. DB is the authority (triggers/RPC checks), never the
   sweep cadence.
2. **Worker hooks**: ante at lock, sweep each tick, settle at window final —
   all idempotent, all write errors surfaced loudly (the halftime-freeze
   lesson: check every supabase-js result; it does not throw).
3. **Client**: pot chip on the battle bar (felt-chip art in card theme),
   action sheet (raise slider capped at the **effective stack** — S6/S7 —
   call / fold, street + response clock), `pot_auto_call` setting beside the
   slow-auction max-bid setting, pot lines in the duel feed ("They raised ◎15
   on SNF"), settlement rendering next to the bonus equation line.
4. **Probes**: every §6 scenario in v1 scope asserted in
   `window-pot-probes.sql` — S3's uncalled-raise refund, S4's per-window
   policy allowance, S6's table-stakes cap, S7's short ante, S9's forced
   street close, S12's tie split, S13's replay idempotency, S11's
   ante-only-vs-empty-chair rule.
5. **Docs**: prepend a HANDOFF.md entry; flip `docs/window-pot.md` status to
   "v1 built — flagged off"; note the flag flip procedure (AdminPage or SQL:
   `update league set pot_ante = 5 where …`).

## Hard rules

- **Coin in, coin out — pots never pay points.** If any design question
  arises that would breach this, stop and ask instead of improvising.
- Feature ships **OFF** (`pot_ante = 0` everywhere); the founder flips it on
  for the test league by hand.
- Don't touch the demo/sim board paths (`liveCtx == null`) — this is a
  live-board feature only in v1.
- The static demo deploy (Pages on merge to `main`) must not break; backend
  bits live in `supabase/` + `server/` as always.
- Migrations auto-apply on merge (`migrate.yml`); worker changes need the
  founder's `fly deploy` — say so in the handoff, don't assume.
- Commit trailers per repo convention; work on your designated branch; no
  PRs unless asked.
- `npx tsc --noEmit` clean; `node --check` on touched server files; run the
  scratch-DB probes before calling it done.

## Definition of done

A two-account test league with `pot_ante = 5` can: see antes appear at lock;
raise from account A within the blind street; watch B's standing policy
auto-call (and a beyond-policy raise start a quiet-hours-aware clock that
auto-folds per S3/S5 on expiry); fold and see immediate settlement; finish
the window and see the pot pay the winner exactly once (re-resolve twice to
prove it); and a league with `pot_ante = 0` sees no trace of any of this.
Target: built and flag-flipped on the test league before the **Aug 13
preseason slate**, which is its live-fire.
