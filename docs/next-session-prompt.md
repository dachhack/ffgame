# Next-session kickoff prompt

_Paste this into a fresh session to continue the Drip Fantasy (dripfantasy.com) H2H pilot._

---

You're continuing the **Drip Fantasy** near-live H2H fantasy pilot (live at
**https://www.dripfantasy.com**).

**First, read `docs/pilot-handoff.md`** — it's the current source of truth (build
v0.37.0). Skim `docs/supabase-polish.md` and `docs/domain-runbook.md` only if you touch
auth/domain.

## This session's focus: onboarding
The founder is iterating on the player onboarding flow. Start in:
- `src/screens/LiveOnboard.tsx` — sign-in (Google / email+password / magic-link OTP),
  invite-code redemption, team confirm, resume. Entry: `src/screens/Splash.tsx`
  ("join the live H2H pilot"); route `'live'` in `App.tsx`.
- `src/data/liveApi.ts` — auth + redemption wrappers (`signInWithProvider`,
  `signUpPassword`/`signInPassword`/`sendPasswordReset`, `sendMagicLink`/`verifyEmailOtp`,
  `previewLeague`/`redeemPreview`/`redeemInvite`, `myEnrollments`, `ensureAppUser`).
- Redemption logic is server-side in migrations 0002/0008 (`redeem_invite`,
  `redeem_preview`, `league_by_invite`) — to change it, add a new migration.
- Likely asks: smoother error states, the closed-signup **email allowlist**, copy/visual
  polish, official Google button styling.

## Branch + deploy model (do this once at the start)
1. You're on a fresh `claude/<...>` branch. **Add it to
   `.github/workflows/migrate.yml`** `push.branches` so your migrations auto-apply
   (it currently lists `claude/admiring-brown-x5limu` + `claude/charming-bardeen-tqeyue`).
   Push that change first. (The Claude GitHub token lacks `actions: write`, so
   `workflow_dispatch` 403s — push-triggered runs are the only way.)
2. **Client changes deploy** by mirroring to the Pages branch (also the repo default):
   ```
   git push origin <your-branch>
   git push origin <your-branch>:claude/youthful-albattani-s9kprl   # to deploy
   ```
   The deploy builds with `VITE_BASE=/`; `public/CNAME` pins `www.dripfantasy.com`.
3. **Bump `src/app/version.ts`** every client change; verify via the version chip.
   **Build gate:** `npm run build` (strict tsc — remove unused vars).
4. **Migrations:** add `supabase/migrations/00NN_*.sql` (next is 0016). On push to a
   watched branch it auto-applies. Confirm via the `migrate.yml` run log showing
   `── applying …NN_*.sql ──` (a no-op run also "succeeds", so check the log line).
5. Commit trailers: `Co-Authored-By: Claude …` + `Claude-Session:`. No PRs unless asked.

## Verify your work
- You **can't** test live auth/DB/site from the sandbox by default (egress blocks
  `*.dripfantasy.com` / `*.supabase.co` unless the founder allowlists them + restarts the
  session). The founder tests on a phone.
- You **can** check DNS via Node (`require('dns').resolveTxt/resolveCname`), run the engine
  + `npm run validate [wk]`, build, and read CI runs via the GitHub MCP (use `actions_get`
  / single-run `list_workflow_jobs` — the full `actions_list` overflows; it auto-saves to a
  file, `python`/`grep` that).
- Engine sanity-checks run under `tsx` from `server/` against baked weeks in
  `public/pbp/wN.json` (see how this session tested `liveResolve.ts`).

## State of the pilot (all shipped, verified)
Slate-gated lineups · shared `liveResolve.ts` resolver (FG + best-ball backups + TE-TD
nuke + DEF suppress + K banker + drip coin) · coin persisted/on-board/editable/audited ·
commish+admin audit with actor · validation gate (CI) · Supabase polish · custom domain.
**Only non-onboarding open item:** deploy the worker to Fly (`server/DEPLOY.md`,
offseason-gated, needs the rotated service-role key).
