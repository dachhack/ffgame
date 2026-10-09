# Drip Fantasy — notes for Claude sessions

## @computer issues (asked from in-app chat)

An issue whose body starts "Asked from chat" came from a league chat or DM via
`server/src/computer.js`. The chat lines before the ask are in the body (other
members appear as "Member A/B"; the repo is public, so keep them that way).

When you fix one:

1. **Confirm the cause, not just a cause.** Tie the fix to what the member
   actually saw (their messages, the player, the week) and to data where you
   can (an ops read-only mode, a probe, a test that fails on the old code). A
   plausible code path is not a confirmed cause: #1028 shipped two real but
   wrong fixes for a frozen lineup, was closed, and the real cause (#1095,
   the Rams' LA/LAR codes) struck again the next week.
2. **Unconfirmed → keep it open.** If you couldn't confirm against live data,
   say so in the fix note, label the issue `unconfirmed`, link the PR with
   "Refs #N" (not "Fixes #N", which closes it on merge), and check back after
   the next game that would show it (for lineup locks: the next kickoff, with
   ops `seal-audit`). Close it only once it's seen to hold.
3. **Write the chat card.** The closing note (or the closing PR's body) carries
   two hidden lines that become the card in the league chat:
   `<!-- chat-summary: one sentence on what was wrong -->` and
   `<!-- chat-report: What was wrong: … How it was fixed: … -->`, written for
   league members, not engineers. Never put "@computer" in a fix note: the
   relay skips notes that contain it.

## iPhone builds: say when one is needed

iPhone builds go through Apple's review, so the founder wants to know whenever
a change needs one, and would rather avoid it. Updates reach iPhones over the
air only while the app's iOS native fingerprint matches the newest TestFlight
build (`apps/mobile/ios-build-runtime.txt`).

- Any change under `apps/mobile/` (above all `app.json`, `app.config.js`,
  plugins, `package.json`) or to `package-lock.json`: run
  `npm run check:ios-runtime` before merging. The PR check "iPhone build
  needed?" runs the same script.
- If it says **iPHONE BUILD NEEDED**, tell the founder in plain words before
  merging, and why. If the change isn't native on iOS (an Android-only
  `app.json` edit, like the Oct 4 widget text), bridge it instead of building:
  list the current build's runtime in `apps/mobile/ios-legacy-runtimes.txt`.
- When an iPhone build is requested (`apps/mobile/ios-build-request.txt`),
  record its runtime in `ios-build-runtime.txt` in the same change.
- Plain JavaScript and SQL changes never need one; don't mention it then.

