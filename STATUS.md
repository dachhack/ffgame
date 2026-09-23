# STATUS

> Orchestrator-facing status. Keep this short and current — `meta`'s
> `/standup` reads it. In-repo WIP details belong in HANDOFF.md.
> Goal / Phase / Cadence are mirrored into `meta/projects.md`.

## Goal

Drip Fantasy (dripfantasy.com): a live head-to-head fantasy football game where lineups play out as real-time battles — drips, nukes, power-ups — on top of real NFL play-by-play. Enter the 2026 NFL season (first lock Sep 9) with pilot leagues, solo/DFS-style play, and a small paid-ads funnel that converts.

## Current phase

Pre-season pilot hardening + acquisition: engine and league infra are launch-ready; current work is solo onboarding (public pods, weekly showdowns), drama presentation, and the Reddit-ads funnel with attribution.

## Cadence

Near-daily (git shows daily bursts; season launch Sep 9 is the forcing function).

## Last worked (superseded entries below)

### v0.492.0 — the commissioner can take it back

Founder, on the list of finer commissioner controls: "Merge and apk, then build
1 and 2. Then the rest of the list. These are all good."

1. ↩ UNDO AN ADD, A DROP OR A WAIVER CLAIM, from its line in the league
   register, web and app, for the commissioner only. Trades could be reversed
   since 0328, but a pickup could not.
   - The player who came in goes back ON WAIVERS on the league's normal hold,
     not straight to free agency, where the fastest phone would have him
     before the league knew. The player who went out comes back to the same
     seat. A FAAB bid is refunded.
   - The waiver order is put back only if nothing has moved it since. 0354
     logs every waiver-priority change, and the seat's old place is restored
     only while exactly one change sits at the run's instant and the seat
     still holds the place the run gave it. Otherwise the order is left alone,
     and the chat line says so.
   - A drop that rode an add undoes the whole move from either line.
   - The original register lines are marked undone. The undo's own lines are
     labelled and can't be undone themselves. One house line tells the league.
   - REFUSED, WITH THE REASON: the pickup has moved on, the drop has been picked
     up, the pickup's game has kicked off (0317's rule), a lone drop has no seat
     to come back to, or the line is a trade. The register offers ↩ UNDO only
     where the undo would accept it, because both use the same plan function.
   - The undo takes the rows it will mark BEFORE it changes anything, rather
     than recognising them by timestamp. The probes found that out: inside one
     transaction every row shares one `at`.
2. WAIVER HOLDS, BY HAND, in the commissioner console next to the waiver order.
   A held player can be freed now, sent back to waivers until the next run, or
   held until a chosen time within two weeks. A search finds free agents to put
   on waivers. Pending claims on him are re-dated with the hold: a claim never
   clears before the hold does. Each change is posted in chat. The app has no
   date picker, so it offers +1/+2/+3/+7 days; the web takes any time.

Migration 0354. Probes: scripts/db/undo-hold-probes.sql, which runs each step
in its own transaction the way production does.

### v0.491.0 — the commissioner re-scores a week

Founder, on commissioner tools: "Change scoring for previous weeks? Change
lineups for previous weeks and restamp? Change scoring for a player and
restamp?", then: "Build the re-score button first."

All three end in one step: re-resolve a finished week and write what comes
out. That step existed only as restamp.yml, an operator's GitHub workflow. 0345
taught the console to SEE a week that needs it ("⚠ scored before the last
play") and then had to say "only a re-stamp (admin) recomputes them". Now the
commissioner has the button, for their own league.

⟳ RE-SCORE sits on each finished week in the WEEKLY REPORT panel, web and app,
in classic leagues only.
- PREVIEW changes nothing. The worker re-resolves the week with
  `resolveMatchup`'s dry run, the same code the week was stamped with, and the
  box lists every matchup that would move, before → after, and which results
  would change hands. It also names seats that saved no lineup, because a
  re-score fields those from TODAY's roster and injury report.
- APPLY confirms that preview. It is refused unless a preview of the same week
  finished in the last 30 minutes and found a change. It runs
  `stampFinals(restamp)` for that one league, exactly what restamp.yml runs,
  rebuilds the week's report and replaces its chat line, and posts one house
  line naming the results that moved and any that changed hands.
- DRIP IS REFUSED, in the SQL and again in the worker. A drip week was played
  against power-ups and window state no later pass can rebuild; the week-1
  run of 2026-09-22 moved two drip leagues by −69.1 and +105.4.

The re-score reads today's scoring settings, so it is also how a settings
change reaches a past week. That is the first of the founder's three asks.
Per-player adjustments and past-week lineup edits are the next two, and both
will end in this button.

Pieces: migration 0353 (rescore_request queue, commish_request_rescore,
league_rescore_state, rescore_finish, which is service role only); worker
server/src/rescore.js, swept every tick; core data/rescore.ts, holding the
moved/flipped rule and wording both screens share. Tests: server/test/rescore.mjs
(the errand, fake db), scripts/db/rescore-probes.sql (the gates and the chat
line, on the scratch db), check:rescore in check:parity.

h2h-verify prints one "✗ FAIL coin totals are positive" line and still exits
0. That predates this change; it happens on main too.

Migration 0353. The worker redeploys on merge.

### v0.490.1 — the chip opens the picker

Founder, asked what tapping the IR chip does: "Let's have the chip open the
picker and always open the picker. Make sure this is the same on the web and
app and for both types of IR spots."

Two chips that looked alike did opposite things. A FILLED IR/OUT/taxi chip
("IR ↩") moved its player straight back to active on one tap, with no
confirmation, and failed with a red error when the active roster was full. An
EMPTY chip did nothing; only the "＋ move someone" text beside it opened the
picker.

Now every stash chip opens that place's picker, filled or empty, on IR, OUT and
the taxi squad, web and app. The shared row component draws all three shelves,
so IR alone would have been the odd one out:
- From a filled place, the sheet leads with the player in it and a ↩ BACK TO
  ACTIVE button, then offers the active roster to move in.
- From an empty place, it is the picker it always was.
- A shelf already at its limit greys every move-in with the reason ("IR is full
  (3/3) — move someone back to active first"), instead of letting the tap find
  out.

The ↩ glyph is gone from the chip, since the chip no longer does that on its
own. No swap in one step: moving a man out and another in are still two moves,
each one the server answers for.

No migration.

### v0.490.0 — the league answers to a key

Founder: "Let's do an API for external league and team control like ESPN.
Commish has to opt in."

0326 built the read half and wrote down why it stopped: "A write API needs
per-user consent; it is a different project." This is that project, on the
same base URL, documented in docs/public-api.md.

THE SHAPE. The commissioner switches the league in (WRITE API, beside PUBLIC
READ API in the console; off by default for every league). Each manager then
mints their own key under 🔑 API keys in the league menu, web and app. A key
belongs to one league and one person, is shown once, and is stored only as a
SHA-256. It acts as its owner with exactly their powers, because every route
ends in the same RPC the app calls. TEAM scope reaches only your own seats,
even for the commissioner. LEAGUE scope is the commissioner's alone and adds
every seat plus the commissioner's tools. A lineup bot does not need to be able
to veto trades.

Routes: me, lineup (read and set), add, drop, claims (file and cancel),
roster-spot, trades (propose, accept, decline, cancel), and for league scope
trades approve/veto, waivers/process, players move/remove, waiver-priority.

THE ONE DOOR. `api_write` (0352) is granted to the service role alone. It
hashes the key, checks the switch, then sets the request's JWT claims to the
key's owner for the rest of the transaction. From there `owns_roster`,
`is_league_commish` and every RPC's own guard answer as they would in the app.
The claims carry no email, so `is_admin()` is false: a key is never a platform
admin, whoever made it. It always passes the KEY's league, and checks that a
claim or trade named by id belongs to it, because the owner may sit in other
leagues and to `auth.uid()` they are the same person there.

LINEUPS ASK THE POLICIES OUT LOUD. A lineup is `sealed_pick` rows the app
writes under RLS, and RLS does not apply to a function running as its owner. So
`_api_set_lineup` asks the policies' questions itself: your seat or one you
co-manage, or a league-scope commissioner in a CLASSIC league only (0320),
never a drip league. The kickoff, legality, slot-cap, flag and stash triggers
fire for every writer. A trigger's refusal comes back as a 409 with nothing
half-done.

Every write is logged (key, action, seat, why it failed). The commissioner
reads the league's log and can revoke any key; a manager reads their own.

TESTED FOR REAL THIS TIME. `scripts/db/write-api-probes.sql` holds the SQL:
scopes, isolation, revocation, the switch, the admin check, the log.
`scripts/db/write-api-e2e.mjs` loads the actual Deno router under Node and
answers its PostgREST calls from the scratch database, as the service role —
routing, status codes, body parsing, cache headers. `check:writeapi` pins the
router's actions to the SQL whitelist and the four properties above.

THE HARNESS WAS BROKEN, AND IS FIXED. run-scratch-probes.sh had died at 0349
since the chat-image migration: the shim had no storage schema. It has one now.
The shim's auth.uid() also reads the request claims first, as Supabase's does.
Existing suites never set claims, and the failing set is identical before and
after that change. Five suites fail on today's date for reasons that predate
this work and are unchanged: waiver-rules, classic-open-lineup, dropped-pick,
draft-midseason and waiver-schedule.

DEPLOY. The migration applies on merge. The edge function does NOT: run
deploy-functions.yml with `public-api` (it deploys with --no-verify-jwt, which
a drip_sk_ bearer needs).

### v0.489.5 — any pickup can name a drop

Founder: "Even if you have empty spots on your roster, you should have the
option to designate a drop with your pickup."

Until now the drop picker appeared only when the roster was full, so a manager
with an open seat had no way to say "take him, and cut this one" in one move.
The add and the cut had to be two moves. On a claim that means dropping
someone today for a player who might not arrive until the run, or at all.

Every ADD, CLAIM and BID now opens the picker, web and app alike:
- NO OPEN SEAT: unchanged. The drop is required, and only active players are
  offered, because dropping a taxi or IR player frees no seat.
- AN OPEN SEAT: the drop is a choice. The picker leads with "ADD / CLAIM / BID
  WITHOUT A DROP" and lists the whole roster, taxi and IR included and tagged,
  because with a seat free any drop is legal.

A FAAB claim still goes on to the bid box, which names the drop. The server has
accepted a drop on both `add_free_agent` and `submit_waiver_claim` whether or
not the roster was full, and process_waivers carries a claim's drop out at the
run. So this is a client change only.

No migration.

### v0.489.4 — a thousand rows was the whole report

v0.489.3 found the league pool being read 1,000 rows at a time — PostgREST's
max-rows, applied silently — and paged past it. The same cap was on every read
of injury_status, in both the client and the worker, and nobody had noticed for
the same reason: a truncated report does not look truncated. It looks like the
players past the cap are fit, on every card that asks and to the lock's
auto-fill that seats them.

And this table was the worst place for it. Until 0489 nothing ever pruned it, so
it accumulated every designation the poller had ever seen — comfortably past a
thousand — which means these reads have been partial for as long as they have
existed, and partial in an arbitrary way that shifts with physical row order.

All four now page on the primary key: loadLiveInjuries and the roster gate's
map in core, ruledOutSlugs and injuryStatusMap in the worker. 0489's prune keeps
the table around 350 rows, so this is belt and braces today — but the prune is
exactly what stops working first (it refuses a short feed, a failed write, a
malformed record), and this is the failure that would follow it, unseen.

check:injurymerge pins all four, including the ORDER: two pages of an unordered
select can overlap or skip, which is a truncation that moves around rather than
holding still.

No migration.

### v0.489.3 — a full roster asks for a drop

Founder, on a FAAB claim: "My roster is full but it doesn't force me to select
a player to drop when waivering."

Both team screens decide FULL by counting the roster, and they counted it
through the league POOL — the roster joined to `league_pool` by slug. That pool
is 1,200 players by default (POOL_CAP) and up to 2,000 with extras, and it was
fetched with `.range(0, 1999)`, which PostgREST answers with at most its
max-rows: 1,000. So every player ranked past 1,000 was missing from the screen
— off the wire, and off his own manager's roster count. Roster one such
pickup and you read a seat short of full: BID goes straight to the bid box, no
drop asked for, and the server (which counts `native_roster` itself) refuses
the claim with an error telling you to include one.

THREE FIXES, the first being the cause:
- `leaguePool`, `leaguePoolExp` and `nativeRosters` page past the cap, on a
  total order (rank then slug) so no row sits on a page boundary. The same
  shape `weekLivePlays` has used for a year for the same limit.
- FULL counts the raw roster rows, never below the server's own
  `active_held` — no pool join between the question and the answer.
- THE SERVER HAS THE LAST WORD. A move with no drop refused for a full active
  roster (0199's `roster_seat_error`) now opens the drop picker instead of
  printing the refusal, and a FAAB bid already typed rides into the bid box
  again once the drop is chosen. `seatFullError` in core decides what counts
  as that refusal; check:seatfull reads the deployed `roster_seat_error` out of
  the migrations and holds the match to its wording, and to nothing else.

And the picker offers ACTIVE players only, web and app. A signing lands active,
so dropping a taxi or IR player frees no seat and the server refuses it — the
picker was offering drops that could not work.

NOT VERIFIED AGAINST THE LIVE LEAGUE: no database access in this session, so
which of the founder's players fell past rank 1,000 is inferred, not seen. The
safety net covers any other way the count could lag.

No migration.

### v0.489.2 — the fix that did not reach him

Founder, after v0.489.1 shipped: "Pierce is still D in my app."

He was, and the reason was mine. `playerIndex.sleeper(sid)` answers with a META
OBJECT — { slug, full, pos, team, espnId } — and v0.489.0 read it as a slug. So
every Sleeper designation was keyed by an object no ESPN slug could equal and no
text column could take: the merge saw nothing at all from Sleeper, and Alec
Pierce stayed Doubtful right through the release built to correct him. Every
other caller in the worker writes `?.slug`. This one now does too.

THE WORSE HALF WAS THE PRUNE. Those object-keyed records went into the same
upsert as the good ones, which fails a text primary key — and nothing read the
error, so a poll could write NOTHING and then delete on the strength of it.
Subtraction with no addition is the one shape of this job that loses data. The
prune now requires the write confirmed, every record well-formed, a whole ESPN
report and a Sleeper snapshot; malformed records never reach the database at
all; and the log line says "N MALFORMED, prune skipped" rather than looking
clean.

check:injurymerge now builds a fake index of the REAL shape and asserts every
key it produces is a string slug — the contract asserted instead of remembered,
which is what would have caught this before it shipped.

THE TABLE SELF-HEALS on the next poll: a poll writes the whole picture from both
sources, so designations lost while this was broken come back with it.

No migration.

### v0.489.1 — and the log says which

v0.489.0's poll returns what it did — how many designations stand, from which
source, how many it cleared, and whether the prune was allowed to run at all —
and the tick threw all of it away and logged a bare count. A poll that cleared
forty designations and one that could not clear any read identically, which is
exactly backwards: the second is the one worth noticing. The line now says both
sources and either "— N cleared" or "— prune SKIPPED, feed incomplete", and
check:injurymerge holds it, because a delete nobody can see is a delete nobody
will question.

Two smaller things in the same poll: a Sleeper-only designation now keeps its
TEAM (it was reading a field the row never carried, so those rows stored null),
and where ESPN has written no sentence about an injury, Sleeper's body part
stands in — "Heel" beats a blank in the detail sheet.

AND A WAY TO ASK, next time. scripts/db/injury-status-diag.sql (read-only, via
dbquery.yml) prints how fresh the table is, which feed decided the designations
standing now, every pooled player carrying one worst-first, one player by name
for "is X really out?", and the count that would reveal the prune having
silently stopped. Answering the Alec Pierce question took pulling both feeds by
hand — fine once, poor the second time.

No migration.

### v0.489.0 — two sources for who is hurt

Founder: "I think Alec Pierce is out but he's listed as D in the platform."

He was. ESPN's report had Pierce DOUBTFUL, stamped 01:03Z; Sleeper had him OUT,
stamped 18:00Z the same day. The platform polled ESPN and only ESPN, so it
faithfully showed a designation seventeen hours behind the one his managers were
looking at in Sleeper.

NOT ONE PLAYER. Comparing both feeds that day: of the 51 players BOTH sources
designate, 23 disagreed — Sleeper more severe in all but three — and 174 of
Sleeper's designations ESPN's report never mentions at all. And not cosmetic:
injury_status is what 0333 discounts a projection by (O or IR to zero, D to a
quarter), what the lock's auto-fill treats as ruled out, and what IR eligibility
reads. Shown D instead of O, Pierce was valued at a quarter of a player nobody
could start.

SO THE POLLER READS BOTH, and the rule for disagreement lives in core
(data/injuryMerge.ts) where check:injurymerge holds it. Freshness first — each
source is stale in its own direction, ESPN lagging mid-week news and Sleeper
holding an Out after a player is cleared, and both carry a timestamp. The
league's own platform breaks a tie no clock can. And ESPN's 630-odd ACTIVE
entries, which this poller used to drop on the floor, now count as what they are:
a dated statement that a man is available, which on the day would have cleared 24
players Sleeper still had flagged. Sleeper's directory is fetched on its own slow
clock (6h, SLEEPER_INJURY_MS) because it is 15 MB and they ask for once a day;
staleness costs nothing, since merging compares the timestamps INSIDE each
statement rather than when we fetched them.

AND THE OLDER BUG, found while wiring the first: THE TABLE COULD NEVER FORGET.
This poller has only ever UPSERT-ed, and nothing else in the codebase deletes
from injury_status — not the worker, not a migration, not a cron. A player hurt
in October and cleared in November stayed Out for ever unless some later report
happened to name him again. A poll now writes the whole picture and prunes
everyone neither source designates any more, guarded so a short feed cannot
un-injure the league: it prunes only with a healthy ESPN report (40+ entries) and
a Sleeper snapshot in hand, and says in its log line when it skipped.

Expect designations to MOVE on the first poll after deploy, in both directions —
that is the correction, not a regression.

No migration.

### v0.488.0 — the comment can be corrected

Founder: "Let's have long press on a comment to edit it if you are the author or
the league commish. The comment adds an edited note with the name of who edited
it."

Until now the only way to fix a typo was to delete the message and say it again,
which costs its reactions, its pin and its place in the conversation. Now the
app's long press offers ✎ Edit above Pin and Delete, the web grows a ✎ beside
the ✕ it already had, and either one opens the words in place — in the thread,
not in the composer, because a correction belongs where the sentence is.

THE NOTE IS THE POINT, not a footnote to it. Every edit is stamped with WHO, in
the same statement as the new text. Founder: "Just plain edited for self edits"
— so your own correction reads "edited" and somebody else's reads "edited by
<them>". The row always records who; the server simply sends no name when the
editor is the author, since a name on every edit is noise a reader learns to
skip, including the one time the name is the whole story. An edit that leaves no
mark at all is a commissioner quietly rewriting somebody and that person never
finding out.

AND DMs GET THE SAME LONG PRESS, for the author only — "Self edits only in DMs."
There is no commissioner inside a private thread, so there is nobody else an
edit could come from, no editor name to store, and no note there but "edited".

THREE THINGS AN EDIT CANNOT REACH, each refused by the server and not merely
hidden by the clients. The house's own lines — a weekly report, a waiver run, an
add or a drop — are the league's record of what happened, and the commissioner
is exactly the person with both the motive and the buttons. A poll, because
editing the question after votes are in changes what those votes meant. And a
picture's URL: an edit on an image message rewrites its CAPTION (0350), since
swapping the URL would strand the uploaded file in the bucket and turn "fix a
typo" into "replace the evidence".

Mentions are recomputed from the new text, through the same membership filter
chat_post uses — adding @Allen in an edit has to reach Allen, and removing him
has to stop. No edit window: the author can fix a week-old typo, and what makes
that safe is the record of who touched it, not a clock.

check:chatedit holds who may edit what (channel and DM), which of the two notes
appears, the bare-URL rule in both languages at once (SQL keeps its own copy,
since SQL cannot import TypeScript), and that the note can never come out
empty.

Migration 0351.

### v0.487.0 — one plus, one gear

ONE + IN LEAGUE CHAT. Founder: "Let's do a + button that lets you then select
poll, image, gif." The 📊 / GIF / 📷 row beside the message box is gone; one +
opens POLL (commissioners — the server's rule, unchanged), IMAGE (the v0.485.0
picker and caption draft, unchanged) and GIF, and shows × while anything it
opened is up, so the same button shuts it. The text box gets its width back.
App and web. DM composers keep their single 📷 — one button needs no menu.

THE GEAR IS A MENU. Founder: "the app settings menu. It's huge. Can we make a
tiny pop-up when you hit the gear that allows you to pick categories then
options?" Settings now opens on a short list — Notifications, Colour theme,
Cards, Play-by-play voice (and Rehearsal tools for admins) — each showing what
it is set to, then one-line actions for Admin, What's new, Demo board and Sign
out. Tapping a category shows only its options, with ‹ ALL SETTINGS to go back;
every open starts at the list. The option controls themselves are the same
ones, moved rather than rebuilt. App only; the web gear is already a dropdown.

Checks: check:chatplus and check:settingsmenu in check:parity (the menu guard
fails 15 ways against the old one-scroll sheet).

### v0.486.0 — a picture with something to say

Founder, an hour after 0349 shipped: "it posts instantly after picking. Allow
the user to caption the image so they can QC and add any text."

PICKING NOW OPENS A DRAFT, not a message: the picture at a size you can
actually check, a caption box, SEND or ✕ DISCARD. All three ways in on web (the
📷, a paste, a drop) and the phone's picker land in the same draft, in the
league channel and in DMs alike.

AND NOTHING UPLOADS UNTIL SEND. The bytes sit in the browser or on the phone
while the draft is open, so a picture you changed your mind about never reaches
the bucket at all — which is also why discarding costs nothing and needs no
cleanup. The QC half of the ask is the reason, but it makes the bucket cleaner
than 0349 was.

THE CAPTION GOT A COLUMN, NOT A LINE IN THE BODY (0350). Posting
"<url>\n<caption>" needs no migration and is what 0349 would have predicted —
and it is the one option that breaks every client already installed, the
APK from an hour ago included: inline rendering keys on the body being a bare
image URL (0148), so a second line turns the picture into a link. So the body
stays exactly the URL it has always been, and the words ride beside it.

The honest cost, said out loud: on a build older than this one, a captioned
picture arrives without its caption. The picture is the post and the words are
the annotation, so losing the annotation for a build or two beats losing the
picture. chat_post and dm_send take p_caption as a DEFAULTED argument, which is
what keeps those older builds posting at all — PostgREST resolves an RPC by the
argument names it is given.

Two things came free with a real column. @mentions work in a caption, because
the clients read it for names alongside the body and the server filters them to
real members as always. And a DM thread now previews the caption instead of 80
characters of storage URL — which said nothing even before captions existed.

check:chatimage holds the caption cap against the SQL, the defaulted arguments
that keep old builds sending, the preview rule, and the property the whole
decision rests on: an image body is still a bare URL a 0148 client renders
inline.

Migration 0350.

### v0.485.0 — the picture posts from the phone too

Founder, on v0.484.0's web-only note: "Let's do it."

The app has rendered chat images since 0148 and rendered the new uploads from
the day they existed — it just had no way to make one. Now it does: 📷 beside
the GIF button in the league channel and in a DM, the system photo library, and
the same bucket and the same ordinary URL-bodied message the web posts.

THE ORIGINAL IS PREFERRED. A picture already small enough, at sensible
dimensions, is uploaded exactly as it sits on the phone — no re-encode, no
generation loss. Only an oversized one goes through expo-image-manipulator
(long edge to 1600, JPEG), and a GIF never does: Expo's picker keeps an
animated GIF only at quality 1 with no cropper, and a manipulator pass would
hand back frame one with the animation quietly gone. A GIF is posted as it came
or refused for size — never silently flattened. WHETHER to re-encode is now one
function in core (`shouldShrinkChatImage`), because the web shrinks with a
canvas and the app with a native module, and the failure mode of letting those
drift is the web sending 200 KB where the app sends 4 MB.

No base64 anywhere: expo-file-system's `File.bytes()` hands over the actual
bytes, which is a third less memory than moving a 4 MB photo through a string.
That module already ships inside `expo`, so it is declared rather than added;
the two new native modules are the picker and the manipulator, which means the
app needs a rebuild, not just a bundle.

AND IT ASKS FOR THE PHOTO LIBRARY AND NOTHING ELSE. Left unconfigured,
expo-image-picker's plugin adds android.permission.RECORD_AUDIO and writes both
iOS usage strings — a chat feature would have shipped the app asking for a
microphone. `cameraPermission: false` and `microphonePermission: false` block
them, and check:chatimage now fails if either comes back, along with the shrink
rule and the picker's declared dependencies.

Deleting a message deletes its picture here too, and the pin strip and DM
previews read an upload as one rather than as half a URL — the same four
touches the web got.

No migration.

### v0.484.0 — the league posts a picture

Founder: "I want to allow users to post images in the chat."

Chat has rendered images since 0148, but only ones already hosted somewhere
else: a GIF out of the picker, an imgur link somebody pasted. The screenshot of
the lineup that lost by 0.4, the photo of the trophy, the whiteboard from draft
night — the pictures a league actually wants to show each other — had nowhere to
go. Now there is a 📷 in the composer, and a pasted screenshot or a picture
dragged onto the thread posts the same way, in the league channel and in DMs
alike.

NO NEW MESSAGE KIND AND NO NEW COLUMN. An upload posts as an ordinary message
whose body is one image URL — exactly what a GIF has been since 0148 — so it
pins, previews, reacts, deletes and renders through every path that already
existed, including in an app build that predates it.

THE PATH IS THE PERMISSION. 0349 adds the `chat-image` bucket (public-read, 6 MB,
four types, no SVG) and three storage policies over
`<league_id>/<author_id>/<random>.<ext>`: you may write only into a league you
belong to, under your own id, and deleting is the author's or the commissioner's
— the same two people chat_delete already trusts. Deleting the message deletes
the file, because moderation that takes down the line and leaves the picture on
the internet is not moderation. An upload that lands when its message does not
is removed again rather than left in the bucket.

The browser shrinks anything over 1600px before it goes up (an 8 MB phone photo
becomes ~200 KB; GIFs pass through so the animation survives), and every step of
that falls back to the original file rather than refusing to post.
check:chatimage holds the path shape, the type list and the size cap against the
SQL, and holds the one property that keeps the native app working: an upload URL
still ends in an image extension. Posting is web only for now — the app renders
these already, but picking a file there needs a native picker.

Migration 0349.

### v0.483.0 — a played week stays played

GRIDIRON 3v6 CORRECTED. ops/run/009 wrote 94.3–101.6 → 106.3–96.6 and rebuilt
the Gridiron week-1 report ("Croski22 beat Joeggernaut 71.2–64.1" headline
unchanged; 3v6 now a home win). 0 refused.

WHY DRIP WEEK 2 WAS UNFLIPPABLE: IT WAS NOT FINAL ANY MORE. ops/run/010 printed
all twelve drip week-2 matchups (Turf Warriors, Gridiron Gang — both Sleeper
leagues) as status 'scheduled' WITH their finals stamped. The cause is
syncWeek: Sleeper's state week keeps naming the week just played until its
midweek rollover, and every sync pass in between re-mirrored that week with an
upsert carrying `status: 'scheduled'` and a fresh lock_at. The finals survived
(they are not in the payload) but everything that reads `status = 'final'` —
the standings, the weekly report's post gate, the record book, awards, the
commish desk — dropped the week. Native leagues schedule through pods.js and
were never touched, which is why classic week 2 was final.

FIX: syncWeek reads the week's existing rows first and upserts only the ones
still 'scheduled'; a matchup past that has nothing left for Sleeper to say.
REPAIR: `refinalize-week <week>` flips back exactly the rows with status
'scheduled', BOTH finals stamped and lock_at past — no genuine upcoming game has
finals — and writes no score. ops/run/011 runs it DRY; the real flip follows
once this worker is deployed, since the old one would re-schedule them on its
next pass. check:dryrun asserts both halves (negative-tested against the old
sync).

No migration.

### v0.482.0 — the one it flipped

Founder: "Let's correct it." Of the twelve drip week-1 results, the K/DST
flip list (ops/run/006) found exactly one whose WINNER the bug decided:
Gridiron Gang 3v6. Every seat there has sealed rows and the old rule
reproduces the stored 94.3–101.6 to the point, so the fixed rule's 106.3–96.6
is not an estimate — it is the week that was played, scored correctly: den-dst
`earn` 7.0 plus the contested window it then wins (+12 home, −5 away).
ops/run/009 writes it (restore-week, totals-only breakdown like the rest of
Gridiron week 1) and rebuilds the week-1 report; the before-values are in the
file, so it is one restore to undo. The four that move without changing hands
are left as played. Coins are not re-banked: `credit_wallet` is idempotent per
matchup and restore-week resolves nothing.

WEEK 2 SKIPPED ALL TWELVE WITHOUT SAYING WHY. The --flips skip line now prints
the status and stored finals; ops/run/010 re-runs week 2 read-only to show
them.

No migration.

### v0.481.0 — what would change hands

THE TWO THAT REMAINED HAD NO LINEUP. The v0.480.0 sealed accounting settles
Gridiron 2v5 and 9v10: neither side of either matchup has a single sealed row
for week 1. A re-resolve fields such a side from its roster and injuries AS THEY
STAND NOW, so it is scoring a different team from the one that played — 9v10's
home goes from 166.9 stored to 94.7. The stored finals were computed against
the week's own rosters and are the ones to believe. No third bug.

WHICH RESULTS THE K/DST FIX WOULD FLIP. Founder: "list which matchups would
flip." `diff-week --flips` resolves every drip matchup twice, dry — under the
old WR rule the week was actually scored with, and under the fixed one — and
lays the DIFFERENCE on the stored final: corrected = stored + (fixed − old).
Not the fixed re-resolve itself, for the reason above. `exact` where the old
rule reproduces the stored final; `estimate` where it cannot (no sealed
lineup), because the delta is then measured on today's auto-fill. 0–0 unplayed
weeks and classic leagues are skipped. Run for weeks 1 and 2 by ops/run/006–007.
Writes nothing.

TURF 6v11 TOTALS ONLY. Its final was right all along (the 005 diff reproduces
it), but its slot rows came from the re-stamp, and the rebuilt Turf week-1
report took its MVP from them alone. ops/run/008 gives it the same single
totals row as the other five and rebuilds the report without that line.

No migration.

### v0.480.0 — ten of twelve

THE OLD RULE REPRODUCES TEN OF THE TWELVE. Re-resolved with the pre-v0.474.0
lookup (K and D/ST positioned as WR), all six Turf Warriors week-1 matchups
match their stored finals exactly, and four of Gridiron Gang's — 1v12 within
0.1. So the Field General / banker "gap" was the K/DST position bug in drip
form: in the live drip resolution a DST on `earn` scored nothing and a banker
K granted no XP bonus, because every one of those effects is keyed on
`pos === 'DEF'` or `pos === 'K'` and the server called them wide receivers.
Field General itself was never the problem.

TWO REMAIN, AND THEY ARE SOMETHING ELSE. Gridiron 2v5 (89.3/42.2 stored,
99.7/24.9 re-resolved) and 9v10 (166.9 home stored, 94.7 re-resolved) do not
move under the old rule either, and both resolve with FEWER slots than the
league fields — 9v10 home 7 of 9, 2v5 away 6. diff-week now prints, per
matchup, every sealed row by author (count, locked, no-player, whether the
author is either seat) and what each side had armed in applied_state (counts
and keys only; authors as 6-char hashes, since the log is public). That
splits "the pick is gone from the database" from "the pick is there and the
resolve dropped it". Run by ops/run/005.

A false positive, fixed: check:dryrun's write detector read
`createHash('sha256').update(…)` as a database write, because its pattern ran
on across statements. It stays within one statement now and was re-proven
against a planted multi-line write. And restore-week's "reports still hold
the old numbers" reminder prints only for leagues it did not rebuild or clear.

No migration.

### v0.479.0 — asking the old rule

Founder: "dig into the Field General and banker gaps."

FIELD GENERAL IS PROBABLY NOT THE GAP. A QB on `fg` scores 0 by design — its
value is a clock-driven multiplier on its own side's other slots in that
window — and the matchups whose FG QBs scored non-zero (4v7, 8v11) match their
stored finals exactly. FG behaves the same live and now.

THE LEAD IS THE K/DST BUG AGAIN, IN DRIP FORM. Every DST and K effect in the
drip engine is keyed on position: `earn`/`suppress` scoring and the earn drip
rate on `pos === 'DEF'`, the Marshal shield likewise, banker XP on
`pos === 'K'`. Before v0.474.0 the server gave every team-unit slug the
position WR, so in LIVE drip resolution a DST on earn scored nothing and a
banker K granted no XP bonus. The re-resolve positions them correctly, so it
disagrees with the stored finals — not because it cannot reproduce the week,
but because it is no longer making the week's mistake. Gridiron 3v6 fits to
the point: den-dst earn 7.00 plus one window battle changing hands is +12 on
one side and -5 on the other, exactly the diff.

SO THIS ASKS THE OLD RULE rather than arguing from reading. `diff-week
--legacy-teamunits` re-resolves with the pre-v0.474.0 lookup — index or
nothing, a team unit falls to WR. It is gated on dryRun inside the same
expression as the lookup, so it cannot reach a write. Run by ops/run/004 on
merge. Stored == legacy re-resolve means the gap is the fix; anything left
(Gridiron 9v10 home, 72.2 short with 7 of 9 slots) is a second cause.

check:teamunit gains one assertion. No migration.

### v0.478.0 — what is known, and nothing it is not

The week-1 diff with the 2026 slate installed matched 6 of the 12 drip
matchups to the decimal — including the worst of them (Turf 1v4 was -43.4
under the 2025 calendar and is exact now) — so the slate was most of the
drip drop. Not all: several remaining deltas are exactly ±5, a window battle
flipped by a smaller change; the QB `fg` (Field General) and K `banker` slots,
both cross-window, are where the rest sits; and Gridiron 9v10 home re-resolves
72.2 short with only 7 of 9 slots producing a row. Drip stays off the re-stamp.

AND A CONSEQUENCE OF THE BAD RUN THAT THE RESTORE DID NOT REACH. Run #3 also
overwrote `matchup_state` — the per-window and per-slot rows — for the 11 drip
matchups, and the live breakdown was printed nowhere. The restored finals no
longer summed to their own rows, the console called them drifted, and a repost
would have named an MVP from the wrong breakdown. Founder chose option 2: each
of those matchups gets ONE 'ALL' row carrying the true totals and no slot rows,
and both week-1 reports are rebuilt from the true finals, without an MVP line.
The record says what is known and nothing it is not.

`restore-week` gains `reset_state` and `rebuild_report`. The rebuild is skipped
for any league that had a row refused — a report over half-restored numbers is
the thing the errand exists to undo — and the final is always written before
the breakdown is touched. Run by ops/run/003 on merge.

check:dryrun gains three assertions. No migration.

### v0.477.0 — the request is the commit

Founder, after a day of copying inputs into the Re-stamp form by hand: "Just
add a trigger and run these please."

The integration that writes this repo cannot dispatch a workflow — every
`workflow_dispatch` call returns 403 — but it can merge, and a merge is a push.
So an ops errand is now a small JSON file under `ops/run/`, reviewed in the PR
like any other change, and run once when it lands on main by the new
`ops-run.yml`. `cli ops-run` turns the file into exactly the argv the Re-stamp
form would have produced and runs it as a child of the same CLI, so a request
cannot reach a path the form cannot, and the form's gates hold: a restamp still
needs `"confirm": "RESTAMP"` — in the file, where a reviewer reads it — and
drip still needs `include_drip: true`, strictly.

ONLY NEWLY-ADDED FILES RUN, the migrate.yml rule (`--diff-filter=A`), so an
edited or re-pushed request never fires twice. Files run in name order and the
first failure stops the rest: a restore that refused a row must not be followed
by a diff that pretends it landed. Push-to-main only — a pull_request trigger
would hand the service-role secret to a branch.

The first two ride this merge: 001 puts Kickoff League's week 1 back to the
0-0 ties it was (it drafted after week 1) and removes the report the re-stamp
posted for it; 002 is the read-only week-1 diff that says whether installing
the 2026 slate closes the drip gap.

check:dryrun gains seven assertions. No migration.

### v0.476.0 — a calendar from the wrong year

Founder, on the two loose ends: Kickoff League's week 1 "should be all ties" —
the league drafted after week 1 and never played it — "let's check into the
drip difference."

THE TIES FIRST, BECAUSE THEY ARE A CORRECTION. The v0.474.0 week-1 re-stamp
found 0-0 on all four Kickoff matchups, re-resolved them against whatever the
rosters held, and wrote 15-to-48-point "results" for a week nobody played. A
second restore file puts the zeros back, and `restore-week` gains
`clear_report`, which drops the write-up and chat line that run posted — a
report on a week that was not played is not a report.

THE DRIP DIFFERENCE HAS TWO PARTS, AND ONE OF THEM WAS NEVER A BUG. The
"slots sum 5.00 and 10.00 short of their own side totals" in the week-2 diff is
the WINDOW BATTLE: a flat WINDOW_WIN_BONUS (5) to the side that wins each
contested window, baked into the window's state and never into a slot row.
One window won, +5; two, +10. diff-week now names it instead of flagging it,
and skips a `scheduled` matchup outright — it has no sealed rows, resolves to
an auto-lineup, and the week-2 run printed exactly that as if it were a
finding.

THE OTHER PART IS THE DROP, AND IT IS A CALENDAR. `closeWeek` calls
`setRuntimeSlate` from the ESPN scoreboard before it stamps anything. The CLI
never did. Without a runtime slate, nflSlate.ts falls back — by design, for
the demo — to the BAKED 2025 SCHEDULE, so `windowForTeam`, `windowKickoffMs`
and `windowsForWeek` all answered from last year. Classic never asks about
windows (one weekly lineup), which is why every classic re-stamp landed on the
board's number to the decimal. Drip asks for every pick: which window a game
is in, when it locks, whether a buff armed in time, whether a slot is
unopposed. A 2026 week resolved against 2025's windows is a different week,
and -69.1 is what a different week looks like. Both `restamp` and `diff-week`
install the week's slate from the nfl_slate table first now, and refuse when
there is none to install.

NOT YET PROVEN TO BE THE WHOLE OF IT. `ruledOutSlugs` reads injury_status as it
stands today — the table has no history — so every auto-fill benches whoever is
OUT or IR now, whatever he did that week; a manual sealed pick is unaffected.
And applied_state, seat reassignment and buff arm-stamps are all "as they stand
now" too. So drip stays off the re-stamp by default. The measurement that ends
it is cheap and read-only: `diff` on week 1 for a drip league — stored equal to
re-resolved means the slate was the whole story; a remaining gap names the
next thing.

check:dryrun gains eight assertions. No migration.

### v0.475.0 — a drip week does not come back

WEEK 2 WAS A CLEAN REPAIR. Eight matchups moved and every one landed on the
number the board had been showing all along: 160.40, 127.70, 123.00, 193.10,
232.10, 137.50, 162.50, 160.50. Hewy13 edged Team 2 by 2.0, which is the result
he actually played. Vamp T gained the same way. The K/DST fix did exactly what
it said.

WEEK 1 DID DAMAGE, AND THE INSTRUCTION TO LEAVE THE LEAGUE FIELD BLANK IS WHAT
DID IT. The classic leagues were repaired — Kickoff League's week 1 had never
been stamped at all and went from 0-0 across the board to real scores; Vamp T
gained +1 to +28. But the same pass also re-stamped two DRIP leagues, and a
drip week does not re-resolve faithfully. It was scored live against power-ups
bought and spent at the time, buffs armed in-slot, per-window state and premium
gating, none of which survives in a form a later pass can rebuild. So it did
not recompute those weeks; it invented different ones. Gridiron Gang moved by
-69.1, -47.1, -41.8, -26.3. Turf Warriors moved a seat by +105.4.

THE SIGN WAS ALREADY THERE and went unread: the week-2 diff had printed a drip
matchup whose stored finals were 92.70 / 104.20 and which re-resolved to 48.80
/ 81.40, plus slot rows summing 5.00 and 10.00 short of their own side totals.
That is a league saying out loud that it cannot be re-derived. It was noted as
"a separate, smaller anomaly" and not acted on.

SO THE ERRAND IS CLASSIC-ONLY NOW, and says what it skipped. A classic week is
reproducible — sealed picks, a play store, a scoring catalog — which is the
entire reason the tool exists; a drip week is not, and `--include-drip` exists
so that overriding is a decision rather than a default.

AND THE DAMAGE IS UNDOABLE, because `restamp` prints before AND after for
everything it moves. That audit trail — added on the general principle that a
tool rewriting results owes one — is the only reason the original numbers still
exist. They are committed at scripts/db/restore/2026-wk1-drip.json, and
`restore-week` writes them back: it resolves nothing, addresses matchups by
league and seat so a person can check the file, and refuses any row that does
not match exactly one matchup.

A check that passed by luck, found while adding to it: check:dryrun scanned
from `case 'diff-week'` to `case 'seed-test-users'`, and restore-week landed
between them — so its deliberate writes were being read as diff-week's. It
passed only because the write regex could not span the line break restore-week
happens to wrap on. The slice now ends at restore-week and the pattern spans
newlines; both were negative-tested by planting a write.

check:dryrun gains nine assertions. No migration.

### v0.474.0 — the kicker that was a wide receiver

THE DIFF FOUND IT. Kickoff League, week 2: the resolver fields NINE slots per
side and the board fields eleven. Not zero for the missing two — ABSENT. The
nine that resolve sum to exactly the stored final, so the report and the
standings were faithfully repeating a number that was two players short.

The league's lineup has eleven spots, and the last three fill themselves: K,
D/ST and a rookie-only best-ball spot. The rookie spot filled. K and D/ST never
did.

WHY. The worker's player index is built from Sleeper's directory of real
people. K and D/ST ride synthetic TEAM-UNIT slugs — `bal-k`, `car-dst` — and
the index has never held an entry for one, so `metaForSlug` answered null. And
`makePlayer` defaults a missing position to 'WR'. **Every kicker and every
defense on a native roster was a wide receiver to the resolver.**

Which broke exactly one thing and broke it silently. A MANUAL K or D/ST pick
still scored, because it arrives as a sealed pick and classicPoints reads the
slug — so every league with ordinary K and DEF spots looked perfect, and one of
them is in this same diff, resolving nine-for-nine with `car-dst` and `bal-k`
in it. But a best-ball K spot accepts only K and a best-ball D/ST spot only
DEF, and `bestballFill` judges eligibility by that position. With every
candidate mislabelled WR, those two spots could not find anybody. They stayed
empty and scored nothing — in the stored final, the weekly report, the
standings and the playoff seeding, every week, all season.

AND IT EXPLAINS THE ONE CLUE THAT NEVER FIT. All eight of week 2's deltas were
whole numbers — 12, 12, 13, 16, 17, 22, 24, 35 — against scores carrying
tenths. No scoring rate does that. A kicker and a defense do: field goals are
3/4/5, extra points 1, the points-allowed ladder 10/7/4/1/0/-1/-4, sacks 1,
picks 2, touchdowns 6. Every point a K or a DST scores is an integer. The gap
was never arithmetic; it was two whole players.

Core's `slugMeta` has derived team units from the suffix since it was written.
The server simply never asked it. One fallback, in the helper that was already
importing it.

THE BOARD WAS RIGHT THE WHOLE TIME. Every version this session that treated the
stored finals as the truth and the board as the thing to explain had it exactly
backwards — including the re-stamp, which faithfully reproduced the bug and
reported "0 moved" as if that settled something. It did not; a scorer re-run
against its own defect agrees with itself. The diff is what asked a question
the resolver could not answer by agreeing with itself.

Weeks 1 and 2 need a re-stamp now, which is what the errand is for. NOT week 3
— `stampFinals` only ever touches a matchup whose status is already 'final',
and week 3 has not kicked off, so there is no stored number there to be wrong
yet. A week is repaired after it closes, not before.

check:teamunit, nine assertions. No migration.

### v0.473.0 — whose rules are loaded

Founder, reading the new league summaries: "Are we applying all of the league
scoring adjustments in the report and matchup summary?"

IN THOSE TWO, YES, AND BY CONSTRUCTION. Neither scores anything. The weekly
report is built from `matchup_state.slot_scores` and the stored finals; the
league page and the shelf read `league_week_scoreboard` and `league_standings`.
Every number on them was computed by the resolver with the league's catalog,
its 0143 adjustments, its 0144 flags, its 0145 scoped rules and its golf
setting installed. They inherit the rules rather than re-deriving them, which
is the whole reason they cannot disagree with the resolver.

THE PLACE THAT DOES SCORE IS THE LIVE BOARD, and the question found two real
defects there, both silent.

ONE: THE SCORING CACHE HAD NO OWNER. `setLeagueFlags` has always recorded which
league its rows are for (`flagsLeague`). `setLeagueScoring` recorded nothing —
`active` was a bare module global. Both are filled by fetches that land AFTER
the first paint, so a board opened in one league scored its players under the
PREVIOUS league's tdBonus, ydMult, toPenalty and scoped bonuses until its own
arrived, then settled quietly on a different total. The server was safe by
discipline, re-installing synchronously before every resolve with a comment
explaining why — but discipline only one of two callers knows about is not a
property of the code. The cache names its league now, and both boards wait for
both caches to speak for THIS league before painting a score. A wrong number is
worse than a late one, and this one was wrong with nothing on screen to say so.

It is also, precisely, the shape of the transient in the founder's own
screenshots: the same matchup read 149.20 and then 127.70 a minute apart.

TWO: `ppr` HAS TWO HOMES AND THE SIDES PICKED DIFFERENT WINNERS.
settings_json.ppr and the 0209 scoring catalog both carry it. `leagueCatalogOf`
is the function that decides — the catalog copy exists only if a commissioner
set it deliberately, so it goes last and wins — and the clients have always
asked it. The resolver spread `ppr: gameMode.ppr` last instead, so it preferred
settings_json while the board preferred the catalog. Any league whose two
copies disagree was scored one way and displayed another. Both sides ask the
one function now. Where the copies agree — every league saved since 0209, since
both writers write both — nothing moves.

Neither of these is yet proven to be the 12-to-35-point gap; `diff-week` is
still the measurement that settles that. They are two ways the two sides were
free to disagree, found by looking where the founder pointed.

check:ruleset, twenty assertions. No migration.

### v0.472.0 — show me the slots

The re-stamp ran, re-resolved all sixteen of week 2's matchups across every
league against the complete week — 6,867 plays, 1,118 players, sixteen game
feeds — and moved NOTHING. Every stored final came back identical.

WHICH MEANS THE DIAGNOSIS WAS WRONG. Week 2's finals are not a stamp taken
before the Monday game; they are exactly what the engine produces from the
whole week. v0.457.0 is the right story for what happened then and the wrong
story for what is on screen now, and the screenshots reproducing its numbers to
the decimal was a lead that got treated as a conclusion.

AND IT SETTLES LESS THAN IT LOOKS LIKE. "Nothing moved" proves the stored
finals agree with the resolver. It cannot prove either agrees with the
football, because re-running a scorer reproduces its own bugs faithfully. The
live question is now the opposite one: the matchup board and the server
disagree over the same plays, and every delta is a WHOLE NUMBER — 12, 12, 13,
16, 17, 22, 24, 35 — against scores carrying tenths. Eight of those in a row is
not chance; something integer-valued is counted on one side and not the other.

So: `diff-week`, read-only, in the same workflow behind a `diff` mode that
needs no confirmation because it writes nothing. It prints the server's answer
the way the board prints its own — one line per starter, the slot it filled,
what the engine paid it — plus the line that may end the whole thing: whether a
side's slots ADD UP TO that side's total. A side being paid for something that
is not a slot would explain every symptom at once.

THE READ-ONLY PROMISE IS STRUCTURAL, NOT STATED. `resolveMatchup` gains one
return that sits above every write in the function, so "dry run" cannot degrade
into "wrote slightly less" — there is no path from the exit to a write.
check:dryrun asserts that arrangement rather than trusting it: it finds the
exit, finds every `.upsert(` / `.update(` / `.insert(` / `.delete(` /
`creditWallet(` in the same function, and requires all of them to come after.
Negative-tested by moving a write above the exit, which turns it red.

Run `diff` before `restamp`, and the workflow now says so: a re-stamp that
moves nothing is not a repair, it is a second opinion from the same doctor.

No migration.

### v0.471.0 — the shelf shows the week

Founder, with Sleeper's league list open beside ours: "Matchup summary per
league and a notification for unread chats. Let's also give the commish option
to turn off reports posting in chat."

Sleeper's landing screen answers the only question a list of leagues is ever
opened to ask — AM I WINNING — before you tap anything. Ours answered "what are
these leagues called". A shelf of names is a menu; a shelf of live scores is a
reason to open the app on a Sunday.

Every card now carries this week's fixture: my seat first with the accent
whichever side of the schedule put it on, the opponent under it, both records,
and the verdict in one word. A LIVE game says LEADING, never WINNING — a
35-point first-quarter lead is not a result, and the word and the colour agree
about that because `verdictOf` owns the distinction and both clients ask it.
A week with no fixture draws nothing: a card that prints 0.00 is claiming a
game was played.

ONE CALL FOR THE WHOLE SHELF. 0347 serves every league's fixture AND its unread
counts together, replacing a `chat_unread` fan-out of one RPC per league per
minute — so the scores cost less than the badges did on their own. The unread
badge moves onto the league NAME, where a count reads as a property of that
league rather than as a separate inbox to parse.

AND IT ASKS THE FUNCTIONS THE LEAGUE PAGE ASKS. Scores from
`league_week_scoreboard`, records from `league_standings`, rather than a second
expression computing the same thing. Two surfaces disagreeing about a score is
the bug this session opened on; the cheapest way not to have it is not to have
a second opinion.

THE REPORT CAN STAY OUT OF CHAT (0348), and the switch turns off the
ANNOUNCEMENT rather than the report. Off, the week is still built, still
stored, still opened by the report screen and still rebuildable from the
console — it simply does not interrupt the chat every Tuesday at 4 AM. A
setting that deleted the season because somebody quieted a notification would
be a trap. ↻ REPOST posts regardless: an explicit press is a person asking for
this week, not the standing schedule the setting is about. Default ON, read
through `coalesce` — an absent key is SQL NULL, and 0343 already paid for that
lesson once with a whole fleet's waiver schedule.

Migrations 0347 and 0348; shelf-probes.sql with eight groups; check:slate with
twenty-five assertions on the sentence the card says.

### v0.470.0 — the morning after, actually repaired

Founder, with the report, the league page and the live board open together: "A
lot of discrepancy across the weekly report and the matchup results and summary
views." Three surfaces, one number. The report and the league page's matchups
and standings read `matchup.home_final` / `away_final`; the board reads the live
engine. The screenshots say 127.5–143.5 in two places and 162.50–160.50 in the
third — which is, to the decimal, v0.457.0's own week-2 incident, still on
screen five versions later.

v0.457.0 fixed the CAUSE and said so plainly: "Re-stamping stays an admin
errand." Nobody ever built the errand, so a week frozen mid-Monday-night stayed
frozen — every team 12 to 35 points light, and Hewy13 handed a loss it won by
two. THE ERRAND EXISTS NOW: `cli restamp <week> [--league=…]` and a ⚠ Re-stamp
workflow behind a typed confirmation. It re-resolves the week against the plays
that exist now, prints every matchup it moved by seat (before → after, in a
PUBLIC log, so seats and not names), and rebuilds the weekly report for each
league whose numbers actually changed — a right scoreboard under a wrong
write-up is still a league arguing about the score. A league that did not move
is not touched and its chat is not pinged.

AND THE CHECK THAT COULD NEVER HAVE CAUGHT IT. 0339's `drifted` compares a
stored final against the sum of its own `matchup_state` rows — but ONE pass
writes both, so a week stamped three hours early agrees with itself perfectly
and with the football not at all. It catches a hand-edited score; it is blind
to the exact failure it was written in the aftermath of. 0345 adds the check
that can see it, and it is not arithmetic but the CLOCK: `live_play.ingested_at`
after `matchup_state.updated_at` means the final was computed without plays that
had not arrived yet. Two timestamps in the wrong order. Both consoles now say
which of the two things is wrong, and that a repost repeats the number while
only a re-stamp changes it.

A stat correction weeks later trips it too, and should.

ONE CAVEAT THE OPERATOR OWNS: a seat that stored no lineup is re-fielded from
its roster AS IT STANDS NOW. Managed seats keep their sealed picks and nothing
moves; an abandoned seat re-stamped months later can be fielded by a player it
did not own. Repair the week that is wrong, soon.

AND A SHUFFLE THE PROBES CAUGHT BY BEING FLAKY. 0344's run sheet ordered `by
wc.id`, over a `gen_random_uuid()` primary key — so the same waiver run, opened
twice, listed its winners and losers in two different orders, and wr3 failed on
one assertion on a clean database and a different one on a dirty one. 0346
orders by the bid where there are bids and the filing time where there are not,
with `id` last as a tiebreak rather than as an order — and stops claiming to
replay the run's own walk, two of whose five keys (`waiver_priority`, standings
rank) the run itself rotates as it goes.

Migrations 0345 and 0346; stale-final-probes.sql with eight groups; wr3/wr4
gain the assertions that shuffle could pass by luck.

### v0.469.1 — a door nobody could name

Founder, hunting for the control v0.461.0 shipped: "It's not clear where I go
in the app to republish the weekly report."

Of course it wasn't. 0341 put the WEEKLY REPORT card INSIDE the commissioner's
`EDIT SCORES` section, on the reasoning that both are about a finished week —
which is true and useless, because the NAV ITEM says "EDIT SCORES" and says
nothing about a report. A door nobody can name is a door nobody opens, and no
amount of good content behind it helps.

It gets its own item: RUN THE SEASON → **WEEKLY REPORT**, right under EDIT
SCORES. The card is unchanged; only its address is.

The web is left alone. Its commissioner console is wide enough to show both
panels under one MATCHUPS tab at the same time, and the report panel carries
its own 📋 WEEKLY REPORT heading on the page — so there is nothing there to
hunt for. The app's nav is a list of names you choose BEFORE you see anything,
which is exactly why a wrong name costs more on a phone.

### v0.469.0 — the waiver run opens up

Founder: "can we have the daily waiver report be clickable in chat and open a
detailed report?"

0290 posts one line when the run settles, and that line is
`left(btrim(body), 500)`. A quiet Tuesday fits. A busy FAAB Wednesday does
not — and it truncates at exactly the wrong end, because the losers and their
reasons are LAST in the sentence, and "why didn't I get him" is the only
question a waiver report exists to answer.

So the line stays a line and gains a door. Behind it: every claim the run
settled, who won what and for how much, who did not and WHY — outbid, roster
full, no budget, a linked group that could not complete — and the wire as it
stands afterwards, priority or budget left per seat. A linked group (0316) is
marked, because a loser whose partner failed is not the same story as one who
was outbid.

NO CHANGE TO `process_waivers`, deliberately. The run's instant was already
recoverable: every claim it settles is stamped `processed_at = now()`, the
chat line is inserted in the SAME transaction, and `now()` is fixed for a
transaction — so the message's `created_at` IS the run's `processed_at`.
Re-emitting a function that big to add a key it does not need would have been
the riskier change, not the safer one.

MATCHED ON THE NEAREST INSTANT, not on equality. The two timestamps agree to
the microsecond in the database, but they travel out through PostgREST as text
and back as a parameter, and a rule that depends on that round trip being
byte-exact is one that fails silently into an empty sheet. ±5 seconds, nearest
wins; two runs of one league cannot be five seconds apart.

A bid is a number in a FAAB league and NULL everywhere else, where a 0 would
read as "bid nothing" rather than "this league has no bids". An instant with
no run answers `found: false` rather than drawing an empty sheet that looks
like a run nobody won.

Only the waiver kind gets the button. Every other txn line is the whole story
already, and a button on one would promise a sheet that never arrives.

Migration 0344, waiver-run-probes.sql with five groups, both chats.

### v0.468.0 — words on the web's rail too

Founder, on the web build: "Still have the icons in the rail on web."

He is right, and v0.465.0's note explains exactly why it missed: the app's
bottom rail is `LeagueBottomBar` in apps/mobile/App.tsx, and the web's is
`LeagueStrip` in src/app — different components, different codebases, one
idea. Changing one and saying "the rail" was changed is the kind of claim
that is true of the file and false of the product.

The argument is the same one, and it is written out here rather than pointed
at: a 22px glyph over an 8.5px caption is an icon EXPLAINED BY a label, two
marks saying one thing, and the label is the one being read. The glyph goes
and the label takes the whole rail at 13.5px — the size it could never be as
a footnote to a picture. The rail's own height is unchanged. The unread dot
stays, because it says something no word on the rail does, and rides the
label now.

NOT TOUCHED: the WIDE chip row under the league name, which carries a 15px
icon beside each label. It is a chip row rather than a rail, the icon sits
beside the word rather than over it, and nobody has complained about it —
so it is a separate call, and the founder's to make.

### v0.467.0 — the gear outlives the tab

Founder: "Need a way to go back to the settings. The settings chip only works
on the league tab."

It did, and for a reason that is obvious once said. The ⚙ SETTINGS chip is
rendered in App, beside the league's name, for as long as a league is open —
but the CONTEXT it opens was installed by `LeagueHome` and torn down on its
unmount. So the moment you moved to MATCHUP, MY TEAM or CHAT, the chip was
still drawn and did nothing.

That is worse than not drawing it. An absent control is a missing feature; a
control that does nothing when pressed is a broken app, and you press it twice
before you believe it.

The chip lives as long as the league does, so its context has to as well. App
installs it now — it already holds everything the sheet needs, and it was
passing all of it to LeagueHome one line away — and clears it when the league
closes, so the gear can never open a league you have left. `classic` came out
of the payload on the way past: the menu has always worked that out for
itself, and it was only ever in there because the installer happened to know
it.

THE WEB IS NOT THE SAME BUG. Its chip is inside the hub page rather than in
persistent chrome, so away from the hub it is absent rather than inert —
honest, if less convenient. Left alone deliberately; a chip that is simply not
there does not lie about what it does.

### v0.466.0 — the board turns with the run

Founder, asked whether "Weds AM" meant midnight or the waiver run: "We want it
synced with the waiver run so that when you see the week matchup, you see the
impacts of new rosters from the waiver run."

v0.465.2 turned the board at Wednesday 00:00 ET — the right DAY for the wrong
reason, and three hours early. The run that reshapes every roster for the week
ahead is AFTER GAMES WAIVERS CLEAR (0337), and it lands at the league's own
clear time on the league's own hold day. Turning over at midnight showed next
week's matchup against last week's rosters, which is the one thing that page
must not do.

The boundary stops being a constant and becomes THIS LEAGUE'S RUN. Not a new
rule — a read of two that exist: `waiver_game_hold_dow_effective` (0338) for
the day, rolled forward to one the schedule's run actually visits, and
`league_waiver_clear_min` (0337) for the time. A league that moved its run to
Tuesday 5am turns over Tuesday 5am, three days before the default league does,
and its board and its wire never disagree about what week it is. A rolling
league has no such moment at all, so it falls back to Wednesday 3:00am and
`league_week_turnover` SAYS so in `source` rather than leaving a screen to
guess.

`weekClosesAt` walks to the run's HOUR and adds the leftover minutes there —
never "ET midnight + 3h", because the DST switches happen at 2:00am ET and
that sum is 2am or 4am on those two Sundays.

── AND A NULL THAT WAS READING AS "NO RUN AT ALL" ──────────────────────────

Found while wiring the turnover, and far bigger than the thing that found it.
`league_waiver_day_clears` (0337) falls back, for a league with no explicit
schedule, to: the day is in `waiver_clear_dow`, or there is no
`waiver_clear_dow` and the run visits every day.

That second half never happened. With the key absent the value is SQL NULL, so
`jsonb_typeof(NULL)` is NULL, so `NULL <> 'array'` is NULL — and NULL OR NULL
OR NULL is NULL, not true. The function answered NULL for every league that
had never touched the old key, which is every league created since 0337.

NULL is not true, and every caller reads it as a no:

  · `waiver_hold_until` walked nine days looking for a clearing day, found
    none, and fell through to its "no run to wait for" branch — so a dropped
    player cleared a flat 24 hours after the drop instead of at the league's
    3:00am run. The schedule was being ignored outright.
  · AFTER GAMES WAIVERS CLEAR needs a clearing day to land on, so the rule
    that stops the fastest phone winning every injury did nothing at all.
  · and 0338's `waiver_game_hold_dow_effective` answered null, which is what
    made this visible — the board had no run to turn over on.

The probes never caught it because every waiver suite sets an explicit
schedule or an explicit `waiver_clear_dow` before asserting anything, which is
exactly the branch that worked. ws1 asserted the default league's DAYS and its
DOOR; nothing asserted its RUN. ws10 does now, including the cost in the one
place a manager feels it.

Migration 0343, ten new assertions across check:draftspots, ws10 and lt8.

### v0.465.2 — the board turns on Wednesday

Founder, with the LEAGUE tab on week 3 and the MATCHUP tab on week 2 at the
same moment, on the same phone: "We should move default views to the next
week on Weds AM."

The rule he is asking for already existed and was already right. Core's
`openWeekFrom` (v0.401.0) says a week stays open until the first WEDNESDAY
00:00 ET after its games are done — Tuesday is when you read what just
happened, Wednesday is when you start caring about what is next. The matchup
board has asked it since then.

0341's league page did not. It let `league_week_scoreboard` default, and that
default was "the lowest week that is not final" — which rolls the instant the
last matchup STAMPS, on Tuesday morning. So one league gave two answers about
what week it is, three inches apart.

BOTH CLIENTS NOW ASK CORE, which is the fix that matters: one rule, asked
once, and the two tabs cannot drift apart again.

Migration 0342 fixes the FALLBACK — what the function says when nobody passes
a week — because a default that is quietly wrong is a trap for the next
caller, and there will be one. `nfl_week_closes_at` is a deliberate second
copy of a calendar rule, so it is pinned: lt7 asserts Tuesday 23:59 and
Wednesday 00:01 answer differently, and that a week finishing ON a Wednesday
morning runs to the NEXT one rather than closing during its own run. A change
to one copy that is not made to the other fails the harness.

A HARNESS LESSON, worth the note: this suite passed alone and failed in the
full run. Other suites seed `nfl_slate` rows for high week numbers in the same
season, and 0342 measures a week against its slate — so a stray row turned one
of these "no slate" cases into a measured one. The suite isolates the weeks it
uses now.

### v0.465.1 — the sheet that would not open

Founder, an hour after v0.465.0 shipped: "League settings/info chip needs to
be more prominent. Let's make it labeled as well. It didn't actually pop up
when I hit it. Just a tiny peek at the bottom."

THE SHEET WAS OPENING TO NOTHING. `Overlay`'s card is `maxHeight: '92%'` with
no fixed height — it sizes to its children — and the menu kept `flex: 1` on
its ScrollView from the days it WAS the whole screen. A `flex: 1` child of an
auto-height parent resolves to zero, so the card was exactly as tall as its
header: the peek. Every other Overlay in the app passes `flexShrink: 1`, which
is what this one needed and now has.

Worth naming, because the mistake is invisible in a diff: moving a component
from being a screen to being sheet CONTENT changes what its root flex means,
and nothing type-checks that.

AND THE CHIP LOST TWICE OVER. A bare ⚙ in a hairline pill, in a header that
ALREADY has a gear one row up — the app's own — so an unlabelled second gear
asks you to guess which is which, and grey hairline on grey reads as
decoration rather than a control. It carries the accent and its own word now:
⚙ SETTINGS.

### v0.465.0 — the web hub, the wire, and words on the rail

Three founder asks in one pass: mirror 0341's league page on the web, build
the players screen he photographed, and "ditch the navigation icons at the
bottom in favor of just large text".

THE WEB HUB IS THE APP'S TWIN NOW. Same three sections in the same order —
Matchups, Standings, Activity — off the same `league_week_scoreboard`, with
the twelve tiles behind a ⚙ SETTINGS chip beside the league name. The table
went INLINE: it used to be a tile that opened the results page, which is one
click to learn where you sit in your own league; that page is still behind
"every pairing →". A tile that opens its own sheet closes the menu first,
because two stacked sheets is a place to get lost.

THE WIRE SAYS WHEN, WHO, AND WHAT THE REST OF FOOTBALL IS DOING.

· THE DAY, NOT A COUNTDOWN. Founder: "Waivers in sleeper have the date the
  player clears." Ours printed `⏳ 6h 12m`, which is a worse answer to the
  same question in every way that matters: it has to be read and converted
  before it means anything, it is wrong the moment the screen sleeps, and past
  a day it stops being a duration anybody can picture. `W · Wed` is the answer
  already converted, and it stays true while you look at it. Core's `clearsOn`
  compares CALENDAR days in the viewer's zone rather than elapsed hours —
  a 3am hold read at 11:30pm is still TOMORROW, which an hours reading calls
  today. Today and tomorrow are named rather than dated, because that is how
  the answer gets used.

· WHO HOLDS HIM. "the option to see owned players and if they belong to you
  other teams (button right there to trade)." This needed no server work at
  all: `nativeRosters` is league-wide and both wires already had it — they
  were throwing the answer away with `!rostered.has(slug)`. A SHOW OWNED chip
  lets them through, tagged `→ Team PadreF3`, and an owned row's button is the
  move actually available: ⇄ TRADE, which opens the trade centre on that seat.
  Your own player says "yours" rather than growing a dead button. Off by
  default — the wire's first job is still who you can HAVE.

· AND THE TREND, from 0340's board: `↗1.5M`, drawn only where there is a
  count, because a zero is not news and a column of them is noise.

WORDS ON THE RAIL. The bottom bar ran a 23px glyph over a 9px caption — an
icon explained by a label, two marks saying one thing, and the label was the
one being read. The glyph goes and the label takes the whole rail at 13.5px,
the size it could never be as a footnote to a picture. The rail's own height
is unchanged. The chat dot survives, because it says something no word on the
rail does, and rides the label now. The art stays on disk: deleting binaries
is a separate decision from changing a layout.

Nine new assertions in `check:waiverdays` for `clearsOn`.

### v0.464.0 — the league tab reads like a league

Founder, with Sleeper's LEAGUE tab open beside ours: "Let's follow the sleeper
convention for my league. Matchups summary, rankings, then activity. Put all
the league settings and info that is there now in a chip up by the league
name. Hit the chip, open the settings."

Ours was a MENU: twelve tiles, each a door to a sheet. Sleeper's is a PAGE —
this week's games, the table, what the league just did — with the settings
behind one gear. The second reads as a league; the first reads as a filing
cabinet, and you have to open a drawer before anything tells you what is
happening.

The app's LEAGUE tab is now three sections in the order a person asks about
them: MATCHUPS (this week's games, either side's total, a week pager that
knows its own ends), STANDINGS (the table inline — it used to be a tile
opening a sheet, which is one tap to learn where you are in your own league),
and ACTIVITY (the register, with the full sheet a tap away).

THE GEAR SITS BESIDE THE NAME, which App renders — so the sheet is a
module-level bus, the same shape as `openPlayerCard`: App draws the chip and
calls `openLeagueSettings`, a host mounted once presents it, and every tile
stays exactly where it already lived. Nothing was deleted; the filing cabinet
is fine as long as it is not the first thing you see. The context is cleared
when the league closes, so the chip can never open a league you have left.

AND THE NUMBER THE PAGE NEEDED. `leagueResults` reads
`matchup.home_final/away_final`, and those are null until a week is stamped —
so a league-wide board showed dashes all Sunday, which is the one day anybody
looks at it. Migration 0341's `league_week_scoreboard` serves the stamped
final where there is one and the sum of the worker's published window rows
where there is not. They are the same number at the whistle, so the board does
not jump when a week closes; it stops moving. A matchup with nothing published
reads null rather than a manufactured 0–0.

NOTHING SEALED LEAKS, and it is v0.456.1's argument again: the worker writes a
window's row only once that window has KICKED OFF, which is the same moment
the sealed_select RLS opens the opponent's real picks. It returns TOTALS ONLY
— never `slot_scores` — so it says what the score is, never who is in the
lineup, and a probe asserts a planted slug never leaves the function. The
public API already publishes the same pair of numbers to anonymous callers for
an opted-in league; this serves them to a member, live, which is narrower.

Six probe groups in league-tab-probes.sql. The web hub is NOT yet mirrored —
it is the next piece, and the two hosts are deliberately divergent until then.

### v0.463.0 — what the wire is doing

Founder, holding Sleeper's PLAYERS tab up next to ours: "We can pull trending
from sleeper. That's not one espn or stathead has."

Right on both halves. Sleeper publishes, anonymously and with no key, how many
of its leagues added or dropped each player over a rolling window
(`/v1/players/nfl/trending/add?lookback_hours=24`). It is millions of real
managers acting rather than anybody's model, and it is the one signal neither
of our other sources carries: ESPN gives ownership PERCENT, which is a level,
and StatHead's bakes are weekly. A level says who is owned. This says who is
being grabbed this morning, which is what a waiver wire is actually for.

This is the data layer — the board, the worker and the door. The screen that
draws it is next.

TWO ENDPOINTS, ONE ROW. Adds and drops are served separately and a player can
be high in both. That is churn, not a signal, and a column showing only adds
would read it as a recommendation — so they are merged and the board carries
both directions.

A DEFENSE TRENDS UNDER ITS TEAM. Sleeper keys team defenses by abbreviation
('TB'), not a numeric id; ours are `<team>-dst`, so those place themselves
without troubling the player index. Everything else is id-first like every
other board: a row the index cannot place is stored with a null slug rather
than guessed at by name, and a later pull can claim it — while a pull that has
no slug for a row never erases one already learned.

FRESHNESS IS A DAY, and a stale board serves an empty map rather than
yesterday's "trending now" — the whole claim of the column is that it is
current — while still reporting `trend_as_of`, so a screen can explain the
empty column instead of just showing nothing.

Migration 0340 (`trend_board`, `trend_board_is_fresh`, `upsert_trend_board`
service-role only, `league_market` re-emitted with `trend`), a worker poll on
the hour (`server/src/poll/trending.js`), eleven assertions in
`check:trending` and six probe groups in `trend-board-probes.sql` — including
that a signed-in member cannot write what the whole platform reads as a market
signal, and that every key `league_market` served before 0340 still is.

### v0.462.0 — the league id, copyable

Founder: "Where in the app and web UI can I find and easy copy the league Id?"
Nowhere, was the honest answer, and on the phone it was worse than nowhere.

It appeared in exactly one place: inside the public API URL on the
commissioner's own panel, as plain text, and only while the league was
PUBLISHED. The league route is `#/live` with no id in it — deliberately, so a
reload lands on the leagues list — so the address bar did not have it either.
A member had no way to reach it at all. Anyone pointing a spreadsheet, a
Discord bot or a rankings site at their league was reading 36 hex characters
off a screen.

Now: a LEAGUE ID line with click-to-copy on the commissioner's panel — NOT
gated on the publish switch, because a private league has an id too and a
commissioner about to publish needs it before the URL exists — and the same
line in the rulebook, where any member can reach it, under THIS LEAGUE, with a
sentence saying what it is: not a secret and not a password. It identifies the
league, it does not unlock it, and the API serves only what that page already
shows.

THE APP HAS A CLIPBOARD NOW. `expo-clipboard` is a dependency. It had been
declined on purpose — LeagueInfo's invite link is `selectable` with a note
saying a copy button "would mean pulling in a native module for a button the
platform ships" — and for a LINK that was right: the OS share sheet copies,
and ⇪ SEND was already there. A league id is not a link. It is 36 characters
that nothing shares and nothing opens. Since the module is in, the invite link
gets its copy button too, and both copy paths stay `selectable` so a long
press still works when a clipboard is refused.

AND A LINE THAT WAS LYING. Both rulebooks printed "HOLD AFTER A DROP: 3 days"
straight off the stored number. Hold days count RUNS (0338), so a rolling
league's stored 3 is a flat 24 hours — the rulebook described a league that
does something else, which is the exact mismatch 0337 and 0338 exist to stop.
It reads core's `holdLine` now, the same sentence the settings sheet prints,
and its unset default is 1 rather than the 2 it had invented.

### v0.461.0 — the commissioner reposts a week

Founder: "Maybe have an option for commish to regen any weekly report and post
in chat."

Nearly all of this already existed and was locked to super-admins. 0277 gave
`report_request` a queue, `admin_request_week_report` a way to file one, and
the worker's `sweepRequests` the other end — which builds from whatever finals
are stamped, replaces the stored payload, and REPLACES the chat line rather
than adding a second one. So this is the commissioner's own door onto that,
plus the one guard the admin door deliberately does not have.

THE GUARD IS v0.457.0's LESSON. That week's report read 127.5–143.5 while the
board read 162.50–160.50 with a game still on, because the week was finalised
mid-game and a stamped final never revisits itself. A one-tap "post the
report" button handed to every commissioner is exactly how that gets recreated
on purpose, every Sunday afternoon. So the commissioner's door refuses while
the week is still being played — and says which of the two things is wrong,
because they are different: games still running, or a SHORT feed, which is the
bug's real shape (`games.every(completed)` is vacuously true over a list that
does not contain the game still being played). The super-admin door stays
unguarded: an override that asks permission is not one.

Both consoles render one line per week — stamped count, when it was posted,
and if it cannot be posted, what is standing in the way — with the button live
only when the week can honestly go out. Posting again replaces the chat line,
and the copy says so, because a commissioner who is not sure it took will
press it twice.

NOT A RE-STAMP. If a week's stored finals have drifted from the live scoring,
rebuilding the report faithfully repeats them, so the line counts those
matchups rather than quietly reposting wrong numbers. `drifted`, not `stale`:
a stored final can differ because the stamp was taken early OR because the
commissioner edited that score by hand in SCORES, which is a supported thing
to do. The database cannot tell those apart, so both consoles name both
possibilities instead of accusing anybody of a bug. Re-stamping stays an admin
errand, since it rewrites results.

That drift check also fixes a hole the republish script's own expression has:
a matchup the resolver never published window rows for sums to nothing, and
reading that nothing as 0.0 called every such week stale. It never showed
because that script only ever walked resolved weeks.

Migration 0339 (`nfl_week_complete`, `league_report_weeks`,
`commish_request_week_report`), report-regen-probes.sql with seven groups in
the harness.

### v0.460.0 — the controls around the schedule

Founder, back on the waivers sheet the day after 0337 shipped: "looks like the
three waiver selections can conflict with the daily schedule?"

They could. 0337 stopped three day-pickers contradicting EACH OTHER and left
the controls ABOVE the schedule free to promise a run the schedule never holds
— the same bug, one storey up.

ROLLING 24H means there is no daily run: every dropped player clears on his own
24-hour clock. But a WAIVERS TO FA day still asked "has the run spoken yet?"
and `coalesce(clear_min, 180)` answered it with 3:00am — a time that appears
nowhere in such a league's settings. The wire opened every morning on a run
that had never happened, which is precisely what 0337 was written to make
unsayable. It now reads as WAIVERS, and the mode is not offered at all while
there is no run to clear at: three modes rolling, four daily.

AFTER GAMES, CLEAR <day> is a promise about a run too. Nothing stopped a
commissioner naming a Wednesday his schedule spends as FREE AGENCY, and then
the hold expired at 3:00am Wednesday having decided nobody — the door bug read
backwards. The chosen day now rolls forward to the first one the run actually
visits, and a week with no run anywhere leaves the rule inapplicable rather
than holding players until a morning that clears them on nothing. Both sheets
name the morning it really lands on, and the time.

HOLD counts RUNS. A rolling league has none, so the database gives it a flat
24 hours whatever the number says (0126, unchanged) — and both consoles stopped
offering 2 DAYS and 3 DAYS there, which did nothing. NONE / 24H rolling, the
full stepper daily, and the stored count is left untouched so a league that
goes back to a daily run keeps its 3.

What cannot be made unsayable is named out loud instead: a new HOW THESE READ
TOGETHER block on both sheets prints what each combination actually does — free
agency OFF overruling the days that open a door, a daily window that shuts
before the run, a hold that rolls forward. Nothing blocks a save; every setting
has a defined reading, and the text says which.

A stored WAIVERS TO FA is never rewritten, only read as WAIVERS while it cannot
apply, so switching back to a daily run hands the commissioner his Sunday back.

Migration 0338, `waiver_game_hold_dow_effective` published on `roster_rules`,
two new probe groups (ws8, ws9) and 20 more assertions in `check:waiverdays`.
The word "Sleeper" is gone from the waiver copy — it describes the schedule
most of fantasy football runs, not one site's — and stays only where the app
really does talk to Sleeper.

### v0.459.0 — what the generals were worth

Founder, looking at C. Olave's card on the phone: "the twin generals bonus
doesn't show in the olave card? I'd love to see on the card or somewhere how
much of the score for each player came from field generals."

Two things were wrong and only one of them was the number.

THE CARD WAS PRINTING IT AND CUTTING IT OFF. The boosted chip read `FIELD GEN
BOOSTED +6.2`, and the chip is a one-liner with `text-overflow: ellipsis` at
card width — so the phone rendered `⚡ FG BOOSTED +` and ate the value, which is
the only part of that chip anybody reads. The label now shortens to `FG` on a
narrow screen so the digits always survive: `⚡ FG +6.2` boosted, `⚡ FG ×2.00
+6.2` while the multiplier is still live.

TWIN NEVER MARKED THE CARD IT PAID. The 🎖️ TWIN badge rode the two Field
General QBs — the slots that OWN the buff — and never the receiver whose bank
the second general actually grew. Olave's card was the one carrying Twin
Generals points and was the one card not saying so. A boosted slot in a window
with two linked generals now wears the mark too.

AND THE SOMEWHERE. Per card is a chip; the window bar now carries the whole
window's take — `⚡ FIELD GENERALS · you +12.4 · them +3.1`, with `twin
stacked` when the buff is live — so the answer is one line under the battle
meter instead of six chips added up by hand. Counted INSIDE the totals above
it, not a bonus on top, and the tooltip says so: these are points that exist
only because a general was multiplying, `delta − delta/mult` per banked event,
which is the same arithmetic the card has used since v0.388.11.

`fgBoostTotal` (packages/core) carries the sum, and takes a clock PER SLOT
rather than one for the window: a 1pm game that kicked and a 1pm game still on
the anthem are both in the early window, and one shared clock would credit a
boost from a game that has not started.

### v0.458.0 — one waiver schedule, Sleeper's

Founder, holding Sleeper's settings screen up next to ours: "I think we've got
conflicting logic in waivers." He was right, and it was structural. "Can I add
this player today?" was answered by THREE independent day-pickers, in two
consoles, composing in an order neither of them stated — `waiver_clear_dow`
(the run's days), `fa_dow` (free agency's days) and `fa_after_waivers_dow` (the
days adds wait for the run). Which let a commissioner build states the game
cannot honour:

  · a day that waits for a run that never happens — the door was held shut
    "until the run" and then opened at the clear time on a day the run does not
    visit, having cleared nobody. Sleeper's WAIVERS TO FA promises players
    clear ONCE and then become free agents; ours opened on a promise it had
    not kept;
  · a day in neither picker: no adds, no run, claims sitting — Sleeper's
    LOCKED, arrived at by accident, with nothing in either console saying so;
  · a daily window on top of both, so a "waits for the run" day with a 10am
    window opened at 10am, not at the clear time the copy named;
  · and no per-day LOCKED at all, because `fa_mode: 'off'` is the whole league.

SO THE THREE PICKERS ARE ONE, with Sleeper's four values and Sleeper's own
words under each: FREE AGENCY, WAIVERS, WAIVERS TO FA, LOCKED. The run days
ARE the schedule — a day clears if and only if its mode is one of the two that
say so — which makes the first two conflicts unsayable rather than merely
discouraged.

AND THE ONE SETTING WE NEVER HAD: Sleeper's AFTER GAMES WAIVERS CLEAR, the
orange line on his screenshot ("Players stay on waivers after games until Wed
3am"). A player dropped once the week's games have started is not a free agent
until that morning's run, whatever his own hold says — the rule that stops the
fastest phone winning every injury. Default Wednesday, like Sleeper's.

WHAT EXISTING LEAGUES GET — the founder's call, asked and answered: "sleeper
defaults".
  · A league that configured ANY of the old keys keeps exactly what it had,
    derived day by day. Nothing changes under anyone who made a choice.
  · A league that never said anything — which is most of them, including the
    one that prompted this — gets Sleeper's own schedule: waivers all week,
    Sunday clearing to free agency at the 3am run. THAT IS A CHANGE, and it is
    the point. Unset used to read "open", which made the wire a race and the
    FAAB budget decoration: 694 free agents, every one an instant ADD.

The clock keeps one compatibility clause, because the four modes cannot say
"free agency all day AND the run visits" — Sleeper has no such day, and an old
league could have one. A league with no explicit schedule keeps the run days it
already had; a league with one is read by it alone.

Both consoles lose three pickers and gain one seven-row list, and both
rulebooks now print THE WEEK as a single sentence out of core
(`waiverScheduleLine`), so the app, the web and the settings screen cannot
describe the same league three ways again.

Sixteen probe suites had been leaning on the old default and now say plainly
that their wire is open; the four that test the clocks derive, as a configured
league does. `scripts/db/waiver-schedule-probes.sql` covers the schedule
itself, twelve assertions in `check:waiverdays` cover the reading, and the
harness is back to the same three failures it has on `main`.

### v0.457.0 — the morning after

Founder, over the week-2 report and the live board side by side: "the weekly
report doesn't seem to validate." The board read 162.50–160.50 with the Rams
game still on; the report read 127.5–143.5 and called it "Team 2 by 16.0" —
and the header records and the standings sided with the report, so a manager
who was winning had already been given the loss.

Three surfaces read ONE pair of columns — `matchup.home_final` / `away_final`
— and the board reads the live engine. So the only question was whether those
columns were stale, and THEY CANNOT BECOME UN-STALE: `stampFinals` selects
`.eq('status','final').is('home_final', null)`, which stamps a matchup exactly
once, from whatever plays existed at that instant, and can never revisit it.
The stamp itself is dated by the screenshot: every player cell carried "Final
·" except K. Williams (RB · LA), whose live 17.2 is the away side's entire
17.0 gap.

WHAT CLOSED A WEEK MID-GAME. `finalizeMatchups` is only ever called with
completed = true, guarded at both call sites by `games.every((g) =>
g.completed)` over the scoreboard ESPN returned — and that guard is VACUOUSLY
TRUE OVER A SHORT LIST. A week-2 scoreboard that came back without its Monday
game contained nothing but finished games.

Three changes, each independent:

  · THE SCHEDULE IS THE SECOND OPINION. `closeWeek` now counts the week's
    `nfl_slate` rows and refuses to finalize while it holds fewer games than
    the week has. Whatever the games we DID get say about themselves, a short
    list is not a finished week.
  · UNTIL THE REPORT GOES OUT, THE NUMBERS STAY LIVE. `stampFinals` gained
    `opts.restamp`, and the tick asks for it — throttled to ten minutes —
    between the last whistle and the release. A late correction, or a game the
    feed was slow to hand over, now lands before anyone is told. After release
    the finals freeze, which is what a final is for.
  · THE REPORT WAITS FOR THE MORNING (founder: "the reports shouldn't go out
    until early AM on the day after the week closes (Tuesday like 4AM EST)").
    The gate is the next 4 AM EASTERN after the last game could have ended —
    core's `weekReportRelease`, read off the slate's last kickoff plus four
    hours. Not "Tuesday": a Saturday-ending week reports Sunday morning and
    week 18 reports the day after whatever day it finishes on. One rule, no
    calendar cases. By timezone NAME, because "4AM EST" is 09:00Z in January
    and 08:00Z in September, and the season is played in the half where
    hard-coding the other one puts the report an hour wrong.

The already-broken week is repaired by `scripts/db/republish-week-reports.sql`
— writes, two steps, meant to be run twice: clear the stale stamps, let the
worker re-resolve them, then queue a rebuild for every league whose stored
report still disagrees with its finals. It refuses outright while any of the
week's games is not `post`, because clearing a stamp mid-game is exactly what
put the week wrong. The rebuild rides `report_request`, so the worker replaces
the payload AND the old chat line: the league sees one report, corrected.

`scripts/db/week-report-mismatch-diag.sql` is the read-only companion that
told these four mechanisms apart, and `league-compat-report.sql` now also
prints each league's FREE-AGENCY DOOR — `fa_mode` unset reads OPEN, so a
league that never set a window has every unrostered player as an instant ADD
and a FAAB budget that only decides contested drops. That is the default
rather than a fault, and it is not what Sleeper does, so it is worth seeing.

Ten new assertions in `check:weekreport`, DST both ways. No migration.

### v0.456.1 — the opponent the board could not see

Founder, week 2, over a screenshot with 104.2 on it: "my opponent has zero
players slotted against me. What gives?" Every window read NO PLAYER —
"window left empty, the facing player subs as a backup" — while the WINDOW
BATTLE bar credited that side 32.9 and 30.6.

Both cannot be true, and the board's own arithmetic says which is: had the
window really been empty, the best-ball rule would have made the facing
player a backup and scored him ZERO in place. He posted 13.8 in his own
slot. The engine paired him against somebody.

THAT SOMEBODY IS AN AI-CONTROLLED SEAT, and it writes no `sealed_pick` rows
at all. `sideLineup` builds such a side at resolve time and scores it;
`materializeAutoLineups` declines to write it back on purpose, because the
seat's persona draw and its bought buffs live in `aiSide` and storing rows
would strip them. The cards read `sealed_pick`. So the lineup existed, in
the resolver, and nowhere a client could look.

Except one place: the resolver publishes `slug` AND `metric` beside every
slot score, and it publishes a window's rows only once that window has
KICKED — the same moment the sealed_select RLS opens the opponent's real
rows. Reading them leaks nothing that is still sealed. THE WEB HAS READ THEM
SINCE v0.387.5, for this exact complaint ("the card read NOT MATCHED UP").
The app never got the rule.

So the rule moved to core as `srvSidePicks` and both hosts share it:
  · a sealed row always wins its own slot — a composed pick stands in for
    what could not be read, it never overrides what could;
  · a Ghost's flat 14 and a Bye Steal's projection publish slot rows for
    players nobody fielded, and are never drawn as cards;
  · nothing published means nothing composed, which is exactly the state of
    a window before kickoff.

On the app it is merged ONCE, in the board's `revealedAll`, because four
readers wanted it and the bug wore four faces: the duel cards, the FIELD
under each duel, the ▦ FIELDS list, and the per-duel play log. A window
with a composed pick is no longer called empty, so the facing player stops
being told he is a backup. And a pick the pool cannot name — the resolver
can name a player since dropped — is drawn off its slug (`nameFromSlug`)
rather than as NO PLAYER over a live score.

`scripts/db/opponent-picks-invisible-diag.sql` is the read-only companion:
it decides between this and the three other ways a lineup can score while
staying unreadable (rows never locked, a `window_revealed` clock moved by a
stray future-season slate row, orphaned rows under two authors that
`assignSealedRows` drops). It prints no emails and no account ids, because
that workflow logs in public.

Twelve new assertions in `check:livescore`. No migration, no worker change.

### v0.456.0 — the round, audited

Six audits of v0.437.0–v0.455.1 ran in parallel — web wiring, mobile parity,
trades-and-waivers conflicts, the data overlays, the public API with history
and awards, and seven traced user journeys — plus a set of executed edge
cases on the scratch database. Forty-odd findings; the ones that were bugs
are fixed here, the ones that were gaps are listed at the end, and the ones
that were opinions stayed opinions. Nothing new shipped in this version.

THREE THINGS SHIPPED BROKEN and are the reason the audit was worth running:

  · THE SEASON-RATE OVERLAY WAS DEAD. The worker's season board carried no
    slug, `league_market` keyed its map by slug, so every screen got `{}`
    and quietly kept the August level. The whole projection half of 0335
    was inert, and its probe had planted a hand-written slug. The worker
    resolves the slug now, the SQL keys by id when there is none, and the
    probe plants a row with no slug and expects an answer.
  · HALF A TRADE COULD COMMIT. `execute_trade` re-checked the FAAB wallet
    after the rosters, picks and cap had moved, and refused with a plain
    `return` — which in plpgsql rolls nothing back. Players swapped, the
    proposal still said pending, a second accept said "players moved". The
    wallet is checked beside the cap check now, above the first move.
  · A BADGE MULTIPLIED THE RECORD. `league_history` joined the badge grants
    laterally onto the seat row before summing wins, so two badges made a
    10-3 manager 20-6 with two titles — on the screen and in the public
    API. The badges are their own query now.

THE SERVER, otherwise (0336, every function re-emitted whole):
  · the veto bar for a multi-team trade could exceed its electorate, so the
    vote settled at the first ballot — a veto included; capped at the room
    on routing, settling and the screen's `veto_need`;
  · a raise inside the execute during a league vote (a no-trade flag set
    mid-vote, a cap that broke) left the trade un-settleable and the sweep
    retrying it every tick; caught and settled like any refusal;
  · a commissioner's veto posts to chat, as the league's own does;
  · a linked waiver group runs on its slowest clock — with 24h rolling
    holds, a fallback dropped Monday morning came due before the first
    choice dropped that afternoon, landed, and marked the first choice lost
    five hours early;
  · a private season stayed readable through last year's public row, which
    carried this year's table, champion and managers with it; a non-member
    now reads only the seasons that are individually public;
  · `award_week` was callable by any signed-in account against any league
    (it posts to chat), and a re-run after a score correction paid last
    week's winner a second time; commissioner-or-worker now, and the wallet
    credits new winners only;
  · `award_sweep` would have awarded every final week of every past
    season's league row on its first pass — one house message per
    league-week into chats nobody reads — and never handed a mid-season
    award out for the weeks before it; this season's rows, and any week
    where an active award is still missing;
  · `api_trades` dropped a reversed trade and published expired OFFERS;
    `api_league.scoring` read `{"error":"forbidden"}` for every caller;
  · three superflex rules (0334's SQL, 0237's SQL, the client's) disagreed
    on a lone SFLX spot, the 0161 roster counts and a spec-less classic
    league; `league_is_superflex` is the one rule now, its spec-less branch
    matched to what the client actually does, and the dynasty format is
    read from it rather than from the ADP thin-board fallback.

THE CLIENTS:
  · the four market overlays were installed and never cleared — a slug is
    the same slug in every league, so a superflex league's board priced the
    next league's waiver wire until its own call landed, and forever if that
    call failed; `installLiveMarket`/`clearLiveMarket`, cleared before each
    fetch and on league close, with an alive flag against a late response;
  · the web never set the dynasty format, so every superflex league on the
    web read the 1QB August bake while the app showed the live SF board;
  · draft rows printed the baked ADP while sorting by the live one — 54
    adjacent inversions in the first 120 rows, Josh Allen "23" in a room
    ordered as if he were 3.3; the row prints what it sorts by;
  · the trade grade counted plain QB spots and missed a lone SFLX;
  · the public-API switch read `roster_rules`, which is native-only, so it
    was dead on every imported league — the leagues 0327 says it is for;
    a provider-agnostic `leaguePublicApi` binding, on both platforms; the
    mobile AWARDS tab is no longer native-only either;
  · a seat inside a multi-team trade was offered VETO/ALLOW on its own deal;
  · the player card reused one modal and never reset, so B's card wore A's
    week tile and headlines until B's fetch landed; the week was not a dep;
  · the trade list refreshes every 20s while a deal is pending or in review,
    and shows all trades on a click so ↩ reverse can reach an older one;
  · "this offer expired" was passed through the auth message table and told
    a manager to request a fresh sign-in link;
  · mobile: ↩ REVERSE, retire-award and delete-badge confirm first; the
    propose sheet scrolls with its send button pinned (a three-way ran past
    the sheet and the button was clipped off); the two-way TRADE REVIEW
    chips in settings, which could not show `league` and saved over it on
    a tap, are gone; headlines open; the card gets its league context on
    imported leagues too; the award icon saves on blur, not per keystroke.

EXECUTED EDGE CASES (scratch DB): SQL format detection for null slots /
SFLX / IDP-only / 0.75 / 0.25 PPR; a league vote in a two-team league
(executes — no electorate — while the screen still says "1 veto"; a
labelling nit); history on a fresh and a mock league; `league_market` on an
empty pool and as a stranger; the week projection with no slate rows; a FAAB
leg in a rolling-waiver league (refused, plainly); cancelling one claim
inside a linked group (the group keeps running with a gap in its sequence).

PROBES: `scripts/db/round-audit-probes.sql` — eleven, each written to fail
on the previous body and pass on this one, and run once without 0336 to
prove it. Every existing suite still passes bar the three that fail on main.

STILL OPEN, by choice or size: score corrections do not revisit awards;
`playerNews` and `submitWaiverGroup` are bound and unused (the card pulls
60 league items and filters); ADP provenance is only in the web draft room;
the mobile award editor lacks icon/active; the public API URL is not
copyable on mobile; FAAB in trades and pending bids reserve nothing
against each other; the rate limiter keys on the first XFF hop; the API
publishes `display_name` and `avatar_url` per seat, which docs/public-api.md
should say; the pool RANK is the 1QB PPR bake while the ADP column is the
league's live format (a superflex room's autopick takes QBs 20–40 picks
after the column says they go).

### v0.455.1 — a fresh board answers by silence

Re-running the source audit against v0.455.0 found a bug in v0.455.0, which
is the point of having one.

THE OBVIOUS OVERLAY WAS WRONG. "Live dynasty value, else the baked one" puts
two scales in one column, and the audit measured exactly where: our rescale
of the live board tracks the bake to a median ratio of 0.97 through the top
200, 0.88 by 300, and diverges in the deep tail where baked values fall to 18
and a handful of points is a 20× ratio. The live board is ~416 players and
the bake ~500 — so the players who would fall through are precisely the ones
whose scales disagree most. A DYN column could sort a live 413 against a
baked 18 for two comparable players.

So a fresh board's SILENCE is now an answer, and it is the one dyn2026's own
header already gave: "board depth is the market source's top ~500; a player
absent from the board is a market judgment, not missing data." The bake
answers only when no live board is installed at all.

THE AUDIT ITSELF HAD DRIFTED, too, and is corrected in the same commit:
  · its dynasty section said a value-to-value diff would be "comparing two
    scales" — true until v0.455.0 taught the worker to run the rescale, so it
    now runs that arithmetic and diffs BY ID;
  · it reported a mean absolute move of 56%, which was the METRIC failing
    rather than the data (tail denominators of 18). Median ratio by rank band
    replaces it, and the top-200 mean — 12.2%, a month of market — is what
    the headline number should have been;
  · its season section was still titled "our August bake vs the live board",
    which stopped being what the app shows the moment the live board became
    the level the engine scores off. It now says it is measuring the
    fallback's error, not the app's.

### v0.455.0 — the other two bakes refresh themselves

"Now automate the dynasty and projection rebakes too." Same question as
v0.454.0 — what can the worker actually fetch, keyed by an id — and this time
the two answers are different, which is the whole design.

  1. DYNASTY IS REPRODUCIBLE, SO WE REPRODUCE IT. The value dyn2026.ts holds
     is not a black box: it is KTC's board rescaled onto FantasyCalc's scale
     by a per-player ratio, with a positional median below a value floor of
     500. Both halves are published (`ktc_rankings_1qb.json` — 416 players AND
     the 84 rookie-pick rows — and `dynasty-fc-rescale.json`), and the rule is
     written down in the client StatHead publishes. `server/src/poll/dynasty.js`
     runs it verbatim, including the clause that matters most: UNSUPPORTED
     POSITIONS KEEP THEIR RAW VALUE, which is how the picks come through
     unrescaled. That is running their model, not approximating it.
     `validate:boards` proves it lands on the same scale as the MCP-baked
     board — top value 11,336 against the bake's 11,106, 50th 3,319 against
     3,449, which is a month of market and not a formula error.
  2. AND IT FIXED pickValues2026 FOR FREE: the picks ride in the same file,
     keyed by the market's own label ("2027 Early 1st"), so the trade grade's
     pick prices now refresh with everything else.
  3. THE PROJECTION IS NOT REPRODUCIBLE, so it gets the multiplier trick
     instead. `projectedPoints` scores a BAKED COMPONENT LINE under each
     league's 64-field catalog, and those components are not published —
     dropping a live PPR scalar on top would throw away every league's
     scoring, the exact bug v0.308.0 existed to kill. So the live number
     replaces the LEVEL that ratio multiplies, never the ratio: one line, at
     `const base =`. A TE-premium league still scores its tight end as a
     TE-premium league; it is simply computed off this week's opinion of the
     player rather than August's.
  4. IT COSTS NO NEW FETCH. The weekly feed the worker already pulls daily
     carries `ppg` and `gp` with a sleeper id on every row — the season line
     was in our hands the whole time. 837 lines, 489 joining the bake by id,
     currently a mean 1.00 pts/week away from it.
  5. RESOLUTION IS THE HARD PART, and it is where a name join would have
     undone four versions of work: KTC publishes no cross-id, and a bare name
     match drops Kenneth/Kenny Gainwell (3,487), Travis Hunter (3,116) and
     Chig Okonkwo (2,925) — all top-200 assets. The crosswalk's ALIASES
     resolve 413 of 416; the player index takes most of the rest; anything
     left keeps its value under the source's own id with a null slug, and the
     bake answers for it.
  6. EVERY OVERLAY IS FORMAT-RESOLVED AND SAYS SO. The server hands a league
     one dynasty column, 1QB or superflex, chosen by the same rule as the ADP
     format — and a screen reading the other format falls through to the bake
     rather than being handed the wrong market. Josh Allen is 5,735 in one and
     10,729 in the other; that is not a rounding difference.

`board-refresh-probes.sql` (5 groups), `check:boards` (23 offline assertions,
including that a TE-premium league's number still doubles when the live level
doubles) and `validate:boards`.

### v0.454.0 — the market refreshes itself

Founder: "automate the weekly ADP refresh in the worker." Done, with one
honest boundary and one thing that turned out better than freshness.

  1. WHAT THE WORKER CANNOT HAVE. The consensus blend `adp2026.ts` holds is
     computed inside StatHead's MCP tool and published nowhere — no worker can
     fetch it, and re-implementing somebody else's model to approximate it
     would mean quietly disagreeing with the bake it replaced. Checked, not
     assumed: the repo's published data directory carries the blend's INPUTS
     and no blend.
  2. WHAT IT CAN. One of those inputs is published daily, keyed by sleeper id,
     and is the closest market to this app's own pool:
     `sleeper-adp-<season>.json`, Sleeper's own draft rooms. 2,877 players,
     plain HTTPS, no key. `server/src/poll/adp.js` pulls it daily — daily, not
     weekly, because the source rebuilds daily and a weekly poll would ship a
     number staler than the one available.
  3. AND IT PRICES EACH FORMAT SEPARATELY, which is the part worth more than
     the freshness. A bake has ONE column, so until today a superflex league
     read 1QB prices off it and a half-PPR league read full PPR. 0334's
     `_league_adp_format` reads the league's own slot spec — a lineup starting
     more than one quarterback IS a superflex market, the same question the
     trade grade asks of the same spec — and hands it the right board. Josh
     Allen is pick 23 in 1QB and pick 4 in superflex; 1,108 players are priced
     differently between the two.
  4. A FORMAT THE MARKET BARELY PRICES IS NOT A MARKET. The live feed prices
     ~2,260 players in PPR and ~240 in standard. Serving those 240 and letting
     everyone else fall through to ESPN would put two scales in one column,
     ordered against each other — so a format that cannot fill a 300-pick
     draft board falls back to PPR, and `adp_format` reports what actually
     answered rather than naming a market nobody read.
  5. THE LADDER, per player, the same shape as the weekly projections: the
     published board, then ESPN's rooms for whoever it does not price, then
     the bake client-side. A feed that stops costs freshness, never the
     column. The card's provenance line now says which market is showing
     instead of claiming "consensus" whatever is underneath.

`adp-board-probes.sql` (6 groups, including the superflex and thin-format
cases), `check:adpboard` (18 offline assertions) and `validate:adp` (the live
feed: measured within 96h, every format populated, and the 2QB column proved
to be its own market rather than a copy of PPR).

### v0.453.0 — one week of football, priced

The first ADP rebake since 26 August, and the first one v0.452.0's id column
paid for: the before/after was diffed BY SLEEPER ID, so a player who changed
team or spelling between boards is one row that MOVED rather than one row
dropped beside one added. (Exactly one row did: Kayshon Boutte, NE → HOU.)

  0. WHAT THIS BOARD ACTUALLY KNOWS. Four weeks of CALENDAR, one week of
     FOOTBALL: the feed has 324 players with a week-1 stat line and none with
     a week-2 one — week 1 is final, week 2 was being played while the board
     was drawn (FantasyPros 18 Sep, Sleeper and FFC 21 Sep). Worth stating
     because the moves below read like form and are not: the two furthest
     falls have no week-1 line at all.
  1. WHAT MOVED. 214 players priced on both boards — 95 up, 119 down — with a
     median absolute move of 9.1 picks and a mean of 13.8. The mean is twice
     the median because the tails are AVAILABILITY, not performance: Isiah
     Pacheco 164.8 → 249 is on IR (status RES), Josh Jacobs 35.9 → 115.7 is
     commissioner-exempt (EXE), and the furthest riser, MarShawn Lloyd 183.2
     → 136.7, is the back who inherited Jacobs's job — depth 1 in Green Bay.
  2. WHAT CHANGED SHAPE. 234 rows, up from 221: 20 new (Cade Otton, Michael
     Penix Jr., Ricky Pearsall and the rest of the September waiver-wire
     market) and 7 gone (James Conner, Keon Coleman, Jaydon Blue…). A player
     who leaves the board is not removed from a Drip pool — he loses his
     market price and is ranked by production instead, which is what that
     fallback in the pool builder has always been for.
  3. EVERY ROW IS VALIDATED ON THE WAY IN: a sleeper id, a team, a number, and
     a Sleeper directory row that is active and plays that position. 0
     problems across 234 rows. The 2026 board's tail — retired names and
     unsigned free agents the source carries with no id at all — is dropped
     rather than baked, which is why 300 rows pulled become 234 baked.
  4. WHO SEES IT. This board seeds a NEW pool's rank; leagues that already
     drafted keep the rank stored in their own pool rows. So the change lands
     on leagues created from today, on the live ADP column, and on the draft
     board's sort — not on anybody's existing roster order.

The chart of the whole diff (dumbbell of the movers, the 214-point scatter
against the no-change diagonal, and both tables) is published as an artifact.

### v0.452.0 — the last name join

Founder: "I'd like to fix the ADP name join with sleeper ids. What's the risk
there?" The risk turned out to be worth measuring before answering, and the
measurement is the reason this version is small and boring on purpose.

  1. THE NAME JOIN COSTS NOTHING TODAY. Of 221 rows: 221 mint a distinct
     engine slug, 0 collide with each other, and 221 match a slug a live
     Sleeper-built pool also mints. The one row with no baked counterpart is
     Kenny Gainwell, and that is a bake-to-bake spelling difference
     (`kenneth-` vs `kenny-`), not an ADP failure. So this is INSURANCE, not
     repair — and the real risk was never the join, it was bundling a value
     refresh with it.
  2. SO NO VALUE MOVED. The ids were attached to the EXISTING August board
     from StatHead's public crosswalk by name + position, with every attach
     verified against the Sleeper directory's own position and team. The only
     two that did not line up were team moves the August board predates
     (Boutte NE→HOU, Blue DAL→PHI), not wrong players. `check:adpjoin`
     rebuilds the name map from the CSV and fails if a single slug's number
     differs.
  3. THE SHAPE IS dyn2026's, EXACTLY. One parse mints `ADP_2026` (slug, byte
     for byte what it was) and `ADP_BY_SID` (sleeper id); `adpValue()` reads
     the id first through the pool's slug→id overlay and falls back to the
     name. Away from a pool no overlay exists and it IS the old lookup, which
     is the invariant that makes it safe to ship mid-season.
  4. AND THE ONE PLACE THAT CANNOT USE THE OVERLAY USES THE ID DIRECTLY. The
     pool builder runs before a pool exists, so it reads the sleeper id off
     the directory row it is already holding — which matters more than the
     rest put together, because that number becomes the pool's RANK, and the
     rank is what autopick drafts by.
  5. The audit's own ADP comparison now joins by id too: 41 rows against
     FFC's live board, up from 34 by name.

A refresh of the VALUES is a separate decision and deliberately not taken
here: ADP has moved a mean 8.7 picks since 26 August (Josh Jacobs 35.9 →
109.4), which is a different question from which player a row is about.

### v0.451.0 — where two sources answer the same question

Founder: "can we check where we have the same data from sources and do an
audit of differences." `npm run audit:sources` is the repeatable version and
`docs/source-audit.md` is this run of it. It joins eight facts across Sleeper,
StatHead, FantasyCalc, ESPN and our own bakes — on ids, never on names — and
sorts what it finds into model differences (expected) and FACT differences
(somebody is wrong). It found three of our own bugs.

  1. THE ESPN POLLER HAD NEVER WRITTEN A ROW. `fetchProjections` sent
     `filterStatsForTopScoringPeriodIds`, which returns ACTUAL weekly lines
     and a projected SEASON row and strips every projected WEEKLY row — the
     only row `weekLineFor` reads. 0 of 200 players with the filter, 200 of
     200 without. Six versions green, because `validate:proj` built its own
     request and proved the DECODE rather than the POLL. It now asserts the
     poller's own request too.
  2. AND NOTHING COULD BE WRITTEN ANYWAY. 0330's upsert names twelve columns
     and selects eleven — `updated_at` had no value — so every call raised
     and not one row landed, from either source. The probe suite reported
     PASS the whole time: psql without ON_ERROR_STOP carries on after a
     failed statement and the closing "ALL … PROBES PASS" prints regardless.
     That is the trap v0.450.0 documented one version earlier, walked into
     again the same day. `\set ON_ERROR_STOP on` now heads all 117 suites.
  3. THE WEEK DID NOT KNOW WHO WAS OUT. 73 of 500 players are zero on one
     side and not the other — Burrow, Purdy, Kittle, Rice, Daniels. ESPN
     prices this week's injury report; StatHead's strip zeroes only ROSTER
     status and says a consumer should apply the designations itself. Since
     v0.447.0 made StatHead primary, that was ours. 0333 applies our own ESPN
     report — Out/IR to zero, Doubtful to a quarter, Questionable a flag — to
     the points AND the multiplier, and ONLY for the week being played.
  4. THE POOL'S ESPN IDS WERE MOSTLY MISSING. Sleeper carries one for 213 of
     846 rosterable players and 84 of the top 300; Gibbs, Chase and Bijan all
     come back null. Everything keyed on that id was reaching a quarter of a
     roster. `backfill_pool_ids()` fills it from 0331's crosswalk, both ways,
     after each daily sweep.
  5. AND ONE OF THE IDS WE HELD WAS SOMEBODY ELSE'S. Sleeper's espn_id for
     Tyler Conklin is RYAN IZZO's. The backfill corrects an id only where the
     crosswalk positively identifies the one we hold as another player; a
     mismatch it cannot explain is left alone.

Clean: the 2026 schedule (32/32 team-games agree with ESPN), sportradar,
fantasy_data and yahoo ids (100%), and FantasyCalc against Sleeper (93/93).
Explained rather than fixed: depth charts agree 64% because Sleeper orders
for availability and StatHead for roster depth — both correct, different
questions. Also flagged for whoever wires the weekly number into a board: a
StatHead backup line is a rate CONDITIONAL on playing (Nick Mullens 18.5
against ESPN's 0), now carried as `conditional: true`.

### v0.450.0 — the history is not the account

A leak, found by running the whole probe suite during the StatHead audit
rather than by anything the audit was looking for.

0324 keyed the record book on `app_user_id`, so a seat that changed hands
keeps two honest manager lines, and gated the surface on membership. 0326
needed that gate to admit an anonymous caller — the public API's whole
audience — so `_may_read_history` grew "or the league is public", and 0327
made a native league public by default. `api_history` was careful to strip
the account ids on the way out. **`league_history` is granted to
`authenticated`**, so any signed-in account could call it directly against
any public league and be handed that league's managers' account ids. The
API's redaction was a wrapper around a door that was already open.

  1. THE REDACTION MOVES INTO `league_history` (0332), which is the only
     place that can guarantee it. A member, a commissioner of any season in
     the lineage, or an admin reads the history whole. Anybody else reading
     a public league gets the same document with `app_user_id` dropped, the
     manager key replaced by a stable opaque handle, and `redacted: true`
     saying so. A league that opted out is refused outright, as always.
  2. 0324'S OWN PROBE SAID SO and had been failing since 0326 — "h3 a
     stranger reads nothing". It was missed because a psql suite prints its
     final PASS line whether or not the block above it threw, and a
     by-hand `| tail -4` shows only that line. The harness itself catches it
     (`ON_ERROR_STOP` + `pipefail`); three older suites were failing ahead
     of it and the run never got that far.
  3. THE PROBE IS REWRITTEN to the contract we actually want, which is not
     the one it was written for: a public league's record book IS readable
     by whoever holds its id — that is the point of 0327 — and what must
     never leave is the accounts behind the seats.

Full suite after this: 106 pass, 3 fail — the same three that fail on `main`
(`classic-open-lineups`, `dropped-pick`, `draft-midseason`), still
pre-existing and still not this work's.

### v0.449.0 — one player, every id

The audit's third finding, and the one that was a promise we were not
keeping. v0.442.0 shipped a public read API whose stated point is "readable
by anything", and handed a consumer exactly ONE identifier to join on:
`espn_id`. Everything else they had to recover by matching a name.

This repo has been bitten by that twice and written it down both times —
dyn2026 silently dropped Kenneth/Kenny Gainwell, and still carries a hand-
edit because one board spells a man "Chigoziem Okonkwo" and our index says
"Chig Okonkwo". We went id-first everywhere for ourselves in 0200 and 0205.
Publishing one id and leaving the internet to name-match the rest was handing
our own solved bug to every consumer.

  1. `player_xref` (0331), filled daily by the worker from StatHead's public
     player crosswalk — the same file the Python client reads, 12,264 rows
     trimmed to the ~3,000 that a fantasy roster can still reach.
  2. `api_players` now carries `sleeper_id`, `gsis_id` (the nflverse key, and
     the one in play-by-play), `pfr_id`, `yahoo_id` and `sportradar_id`.
     `espn_id` stays exactly where 0326 put it, so no existing consumer sees
     anything but new keys.
  3. THE JOIN IS BY ID AND ONLY BY ID: espn first, sleeper second, never a
     name. A probe plants a crosswalk row spelled EXACTLY as an unplaceable
     pool player and asserts it is not taken.
  4. `league_player_ids` gives a signed-in client the same set, so the app
     never has to ask the public endpoint for something it is entitled to.
  5. Nothing about a manager is published, and `check:publicapi` now scans
     EVERY migration from 0326 on rather than 0326 alone — a re-emission is
     exactly how the never-list would have been quietly reintroduced.

Also in this version: `docs/stathead-fidelity.md`, the written audit the
founder asked for — every feature of v0.437.0…v0.446.0 against what StatHead
publishes, what was filled in, what was deliberately left with ESPN
(injuries, because ours is the live report; news, because StatHead has none),
and the one-line answer to MCP vs Python vs asking their dev team: the model
outputs are public JSON, so the worker just fetches them.

### v0.448.0 — what a pick is worth, from the market that trades them

The second thing the StatHead audit found, and the smaller of the two only
in line count. v0.444.0's trade grade priced a draft pick at an invented
fraction of a replacement starter — `[0, 0.85, 0.45, 0.22, 0.1, 0.05]` —
with a comment admitting it was blunt. That was the one number in a feature
built entirely on "you can disagree with the arithmetic" that came from
nowhere.

  1. TWO KINDS OF PICK, TWO ANSWERS, NEITHER INVENTED. A STARTUP slot (0190)
     is a pick in a draft of THIS league's players, so it is worth the man
     still on the board when it comes round — which we can read straight off
     the pool and its projections. No market and no curve: in a 12-team
     league a mid-round-1 slot is the sixth-best player left, over
     replacement, and a slot deep enough to draft replacement level is worth
     nothing, which is exactly right.
  2. A ROOKIE PICK is an asset in a draft that has not happened, of players
     who are not in the pool, so what it is worth is what it TRADES for.
     `pickValues2026.ts` bakes the dynasty market's pick board — StatHead's
     `get_dynasty_values` with position RDP, the rows dyn2026 drops — on the
     same scale as the player values, in both 1QB and superflex.
  3. FROM A MARKET VALUE TO THIS LEAGUE'S POINTS, through the pool itself:
     find the players who trade for about the same, and ask what THEY are
     worth over replacement here. A pick that trades for what the 14th
     receiver trades for is worth what the 14th receiver is worth. Nine
     neighbours averaged, because a dynasty value is a long-horizon opinion
     and this season's projection is not.
  4. THE LINEUP PICKS THE MARKET. A league that starts more quarterbacks
     than it has teams reads the superflex board — the same question the
     replacement line already asks, asked once more, with no special case.
  5. The old share table survives as the fallback for a league with no
     dynasty values loaded at all, and the UI still says "estimated": nobody
     knows where a pick will land.

Nine new assertions in `check:tradegrade`, including one that fails if the
market curve is NOT live for this pool — otherwise every other pick test
would be quietly exercising the fallback. A startup 1st now prices at 154
points over replacement against a rookie 1st's 78.2.

### v0.447.0 — the week's number, from the model that made the season one

Founder: "review the work for anything we can fill in with fidelity from
StatHead instead." The audit is in `docs/stathead-fidelity.md`; this is the
biggest thing it found, and it was one version old.

  1. THE BUG THE AUDIT FOUND. v0.445.0 shipped a weekly projection and took
     it from ESPN, because ESPN was the only weekly feed we could reach. But
     `appliedTotal` is a SCALAR IN ESPN'S SCORING. A Drip league paying 6 for
     a passing touchdown or 1.5 per TE reception read a number computed under
     somebody else's rules — the exact bug v0.308.0 spent a version killing
     on the SEASON projection, quietly reintroduced one week at a time.
  2. THE SOURCE WAS ALREADY OURS. StatHead — whose season projections this
     app already ranks, drafts and grades trades with — publishes the same
     model split across the schedule, as one public JSON rebuilt about every
     two hours. No key, no SDK, no API to ask anyone for: the worker fetches
     it over plain HTTPS. It also covers K, team DST and IDP, which ESPN's
     weekly feed could only ever hand us as an undecodable total.
  3. WHAT WE STORE IS THE MULTIPLIER, and that is the whole idea. The weekly
     split scales a player's WHOLE line by one number (the feed is explicit
     that receptions scale with it too). Scoring is linear in the line, so
     **this league's season rate × mult IS this league's week** — not an
     approximation of re-scoring the weekly line, but the same arithmetic.
     `npm run validate:weekmult` proves the premise against the live file:
     the 17 weeks average back to the season line within 0.14%, and the
     ratio is shared by every player on a team at a position to within
     0.0025 (rounding), which is what makes it a MATCHUP term rather than a
     per-player opinion.
  4. TWO SOURCES, ONE TABLE, PER-PLAYER FALLBACK. 0330 re-keys
     `nfl_week_proj` on (season, week, SOURCE, key): StatHead rows by sleeper
     id, ESPN rows by athlete id. The reader prefers StatHead for each player
     and falls back to ESPN for the men it has no line for, so an outage on
     either side degrades instead of blanking. The row now carries the
     opponent, the home flag, the roster/injury status and which source
     answered — a screen that shows a number owes the reader that.
  5. THE CARDS. Web and mobile both show the week in the league's own
     scoring, with the opponent in the label (`WK 5 @ ARI`), and a man on IR
     comes back as a zero WITH the reason rather than as missing data.

`scripts/db/matchup-mult-probes.sql` (5 groups) and `npm run check:weekmult`
(20 assertions, offline) pin the plumbing; the one real bug they caught was
mine — `Number(null)` is 0, so "no multiplier served" was one character away
from silently becoming "projected to score nothing".

### v0.446.0 — ready for the stores, as far as code goes

The last row on the gap list that was still open, and the only one where the
work splits cleanly into "what a repo can do" and "what needs a person with
an account". This is the first half, done properly, and an honest checklist
for the second.

  1. TWO REAL PAGES, live with the site rather than promised: /privacy.html
     and /support.html. Both stores REQUIRE a reachable privacy URL, and
     most apps satisfy it with boilerplate that does not describe the app.
     This one describes what the code actually does — the email, the league
     content, the push token, the analytics where a build has a key, Stripe
     for purchases — plus the thing no template would know to say: that a
     league created here is readable through the public API by whoever holds
     its link, that there is no directory, that a commissioner can shut it
     in one tap, and that hidden picks, pending bids, live offers, emails
     and chat are never served to anybody either way. Static HTML, no JS, so
     a reviewer's browser and a crawler both just get the page.
  2. THE SUBMISSION CONFIG. eas.json grew a real submit.production for both
     platforms, reading every credential from the environment — an App Store
     Connect key and a Play service-account JSON are secrets and a repo is
     not where they live — while the non-secret ids stay in the file, where
     a change to them is a reviewable diff.
  3. THE LISTING COPY, in apps/mobile/store.config.json for
     `eas metadata:push`: title, subtitle, the long description, keywords and
     the three URLs. In the repo for the same reason: a listing change should
     be a diff, not a form somebody edited at midnight.
  4. THE HONEST QUESTIONNAIRE ANSWERS (docs/store-listing.md), derived from
     the code rather than guessed: what is collected and linked to you, what
     is collected and not, what is never collected, who processes it, and why
     simulated gambling is FALSE (drip coin is earned in play, cannot be
     bought and cannot be cashed out — with a note beside the flag saying
     that if that changes, the answer changes with it).

WHAT IS NOT DONE, and cannot be from here: enrolling in the Apple Developer
Program and the Play Console, creating the app in each, screenshots from a
real build, the age rating, reviewer sign-in notes, and — Apple's rule — Sign
in with Apple beside Google sign-in, which is real work and not yet in the
app. The doc says all of it in the order that wastes the least time.

### v0.445.0 — this week's number, and the news

The gap list called the baked projections "the weakest data point vs the big
three", and it was right for a reason that has nothing to do with the model:
proj2026.ts is a SEASON rate, frozen before week 1. It cannot know that a
starter is out, that a back-up has the job, that a bye is this week or that
a man was traded on Tuesday. 0329 plus server/src/poll/projections.js.

  1. THE WEEK'S NUMBER. nfl_week_proj carries one row per player per week
     with BOTH the source's own scored total AND the raw projected stat
     line. The line is the useful half: it can be re-scored in a league's
     own catalog later, rather than leaving a TE-premium league reading
     somebody else's PPR. Keyed on the ESPN athlete id, which
     league_pool.espn_id already holds — no name matching anywhere, because
     names drift between sources and ids do not.
  2. THE DECODE IS CHECKED, NOT ASSUMED. ESPN's stat ids are undocumented,
     so scripts/check-proj-map.mjs (npm run validate:proj, a NETWORK test —
     check:parity stays offline) scores our decoded line under PPR and
     compares it to the total ESPN scored from the same row: 209
     skill-player weeks, mean error 0.007 points, worst case 0.08. Kickers
     and defenses carry the TOTAL and no line, deliberately — their ids are
     a second decoding job for two positions whose number the source
     already scores correctly, and a wrong line is worse than none.
  3. THE NEWS. player_news keeps the headline feed where a story is TAGGED
     with the athletes it is about; an untagged story is about the league,
     not about somebody's flex spot. league_news filters to the players a
     league actually holds, so one story naming two of them appears once
     with both.
  4. THE BAKED SET IS NOT REPLACED. It is the fallback and the draft-room
     ranking and it stays. A player the crosswalk cannot place has no weekly
     number and the season projection still answers for him — absent, never
     zero.

CONSOLES. Both player cards grew a WK n column beside PROJ and a 📰 LATELY
block in the summary tab, which renders nothing at all when the feed has
nothing to say about him. The worker sweeps hourly (sweepProjections, gated
inside itself) over every active week, so Tuesday's poll fills next week
while this one is still being played.

Probes: scripts/db/week-proj-probes.sql (wired into the scratch runner) —
idempotent upserts that update in place, a league reading the week keyed by
ITS slugs through the crosswalk, a player without one absent rather than
zero, the news filtered to this league's players, a corrected headline
replacing itself, and the public-API door deciding who else may read both.
104 suites pass beside it; the three that do not fail identically on main.

### v0.444.0 — what it's worth, and taking it back

Two more of the gap list's trade row, and the last two that are ours to
build: a trade analyzer, and the commissioner's undo.

  1. WHAT IT'S WORTH (packages/core/src/data/tradeGrade.ts). ESPN grades a
     trade with watsonx and Yahoo with its Trade Hub, and both hand back a
     letter from a model you cannot inspect — the wrong shape for the
     argument it lands in the middle of. A manager told "B−" learns nothing.
     So: VALUE OVER REPLACEMENT, in this league's own scoring. A player is
     worth his projected season points minus the projection of the best
     player who would still be in the pool at his position once every team
     filled its starting spots — which is why a QB is worth little in a
     1-QB league and a great deal in a superflex one, with no special case
     anywhere in the code: the league's own lineup spec moves the
     replacement line. Below replacement is worth ZERO, not negative:
     giving away a bench body is not a cost. Picks are a fraction of a
     replacement starter and say "estimated"; FAAB and cap are reported as
     money, because a dollar is not a point. "Even" is a BAND (12 season
     points, about two thirds of a point a week) rather than a point,
     because a projection is not precise to a point. Shown live in both
     propose sheets as the piles change, with every player's number beside
     it and a line saying what it does not know.
  2. TAKING IT BACK (0328). Sleeper and Fantrax both let a commissioner
     reverse a COMPLETED trade; Drip had a veto and a league vote, which
     both happen before the deal lands. What leagues actually hit is the
     Monday-morning case — a compromised account, a misread deal, a
     collusion complaint — and the only tool was moving players back one at
     a time, losing the picks, the dollars and the record.
     commish_reverse_trade runs every leg backwards in one transaction:
     players home, picks home (the running draft's copy too), FAAB home,
     cap home, retained salary un-retained. It REFUSES rather than
     half-undoing when a piece has moved on, when the undo would leave a
     roster illegal, or when the FAAB has already been spent — each with
     the reason. The trade is stamped 'reversed', not deleted: it happened.
     The league hears about it the way it heard about the trade.

CONSOLES. ⚖ WHAT IT'S WORTH in both propose sheets; ↩ reverse on a completed
trade for the commissioner, behind a confirm because it moves other people's
rosters.

Pinned: scripts/check-trade-grade.mjs (in check:parity) — the same player
both ways is dead even, a clearly better player leans the right way, a
below-replacement body costs nothing, a QB prices differently in superflex
with no special case, the band holds, picks count and say so, dollars stay
dollars, and an unprojected player is named rather than silently zeroed.
Probes: scripts/db/trade-undo-probes.sql. 103 suites pass beside it; the
three that do not fail identically on main.

### v0.443.0 — open by default

0326 shipped the read API opt-in. Founder: "let's actually do the opposite.
Open by default with an opt out." That is the Sleeper bargain, and the reason
the gap list put this row on the board in the first place: an ecosystem does
not grow on the leagues whose commissioner went looking for a switch. 0327
changes ONE thing — what the ABSENCE of settings_json.public_api means.

  · ABSENT now means OPEN for a league that lives here (provider = native),
    and still means CLOSED for one imported from Sleeper, ESPN or Yahoo. An
    import is a mirror of somebody else's system, pulled in with that
    manager's own credentials; publishing our leagues is our decision to
    make, republishing theirs is not.
  · AN EXPLICIT FALSE IS UNTOUCHED. The whole risk of flipping a default is
    quietly re-publishing a league that chose to be private, so the opt-out
    is written down rather than inferred, and the probe pins it.
  · A MOCK IS STILL NEVER SERVED.

WHAT MAKES IT DEFENSIBLE, none of which changed: the never-list (sealed picks
before they reveal, pending waiver bids, offers in flight, emails, invite
codes, chat) is the same either way — flipping a default cannot leak what no
endpoint returns; there is NO DIRECTORY endpoint and never will be, so a
league is readable only by whoever holds its v4 UUID, which is "if you have
the link", not indexed or enumerable; and the opt-out is one tap that takes
effect on the next request.

check:parity now pins the default itself (scripts/check-public-api.mjs): an
explicit choice wins either way, absent means open for a native league, a
mock is never served, and no route lists leagues. Both consoles read as an
opt-out ("tap to make this league private") and say plainly that there is no
directory. docs/public-api.md rewritten to match.

Probes: public-api-probes.sql — open by default, the commissioner shutting it
and opening it again, an imported league staying shut, an explicit opt-out
written down and surviving, and every endpoint silent while private. 102
suites pass beside it; the three that do not fail identically on main.

### v0.442.0 — the league, readable by anything

The gap list's fourth priority, and the reason it is on it: the Sleeper
ecosystem — KTC, DynastyProcess, ffscrapr — exists because anyone can read a
Sleeper league without logging in. Nobody builds a valuation tool, a Discord
bot or a spreadsheet against a platform they have to authenticate with
first. 0326 plus supabase/functions/public-api.

  1. THE SHAPE. Thirteen endpoints, each assembled by ONE SQL function
     (api_*), with the edge function as a router and nothing else. That split
     is the point: what the API exposes is a contract written in one file
     rather than an accident of which columns a query happened to select.
     GET only, no key, CORS open, `/v1/openapi.json` describes itself.
     League · teams · rosters · standings · matchups · lineups ·
     transactions · trades · draft · picks · players · history · awards.
  2. OPT-IN, PER LEAGUE. settings_json.public_api, one switch on the
     commissioner's desk. Off for a full league until its commissioner turns
     it on; ON by default for the public formats (pods, weekly showdowns,
     DFS), which anyone with the link can already open. A league that has not
     opted in is a 404 — byte-identical to one that does not exist, so the
     API cannot be used to test whether a league id is real.
  3. WHAT IS NEVER IN IT, enforced where the data is:
     · SEALED PICKS before their window reveals. api_lineups asks
       window_revealed() — the same question the app asks before it shows an
       opponent's pick. An endpoint that served them early would be an
       exploit with a URL.
     · PENDING waiver claims and bids: blind bidding stops being blind the
       moment an outsider can poll it. Settled claims only, with the winning
       bid the league already heard in chat.
     · TRADE OFFERS in flight: members see negotiations, the internet does
       not. Executed, vetoed and expired only.
     · Emails, claim emails, invite codes, chat, dues. The all-time manager
       line carries an opaque handle rather than the account id 0324 keys on.
  4. MANNERS. A token bucket per IP in the database (600/min, burst 120) so
     every instance shares one meter; weak ETags and Cache-Control per
     endpoint, so a poller that sends If-None-Match gets a 304 and no body;
     cursor paging on the register; {error:{code,message}} with real status
     codes.

PINNED. scripts/check-public-api.mjs (in check:parity) asserts every route
the router names exists in 0326, that no api_ function touches a forbidden
column, and specifically that api_lineups still asks window_revealed and
api_trades still serves settled deals only — the two regressions that would
matter and that nothing else would catch.

CONSOLE. PUBLIC READ API under 🏅 AWARDS & BADGES on both hosts: the switch,
the exact base URL for this deployment, and a plain-English list of what is
and is not served. docs/public-api.md is the written version; the deploy
workflow grew a public-api target (--no-verify-jwt, by design).

Probes: scripts/db/public-api-probes.sql (wired into the scratch runner) —
the switch both ways, every endpoint answered ANONYMOUSLY, closed and
nonexistent being the same answer, an unrevealed pick and a pending bid and
a live offer all absent, no email or invite code anywhere in any payload,
and the meter emptying and refilling. 102 suites pass beside it; the three
that do not fail identically on main. Web and mobile typecheck.

### v0.441.0 — the league writes its own trophies

The last piece of the history row. Sleeper posts weekly awards to chat,
Yahoo and ESPN hand out achievement badges — all three with a FIXED set.
Here the set is the league's, because the joke is the point: a league that
calls its low-score award THE BROWN JUG and pays it 50 coins is a league
with an inside joke, and that is the feature. 0325.

  1. THE RULE GRAMMAR. An award is three choices — metric (their score, what
     they gave up, the margin, the game total) × direction (most, least) ×
     only (any week, a win, a loss) — and between them they cover every award
     a league has ever invented. High score is points/most/any. The sad sack
     is points/least/any. "Highest score that still LOST" is
     points/most/loss, the one every league writes into its group chat and no
     platform lets it write down. Ties award everybody tied, because a tie IS
     the story that week. An award may carry a drip-coin prize, paid once.
  2. DEFAULTS THAT ARE NOT SETTINGS. A league with nothing configured runs
     four built-ins (🔥 High Score, 💤 Low Score, 🔨 Biggest Beating, 💔 Tough
     Luck), so this works the week it ships. The first edit MATERIALIZES them
     as rows — renaming one does not delete the other three — and deleting
     them all means no awards, which is a real choice and is honoured.
  3. BADGES. Commissioner-defined (🐐, 🤡, PAID HIS DUES), pinned on a seat
     and stamped with the season, so the same badge can be won again next
     year without erasing this year's. Handed out and taken back by hand,
     announced in chat, and carried on every manager's line in 🏛 League
     history beside their weekly-award count.
  4. WHEN. award_week runs a league-week only once every game in it is
     final — half a week has no high score — is idempotent, and is
     RE-RUNNABLE: an award added in week 9 fills in the weeks behind it
     without disturbing what they already gave. Preseason (101+) hands out
     nothing. The worker sweeps it (award_sweep, server/src/native.js).
     A retired award keeps every trophy it gave: the case is a record of what
     happened, not of what the rules now say.

CONSOLES. 🏅 AWARDS & BADGES under ENGAGE on both — the rule grammar as three
rows of chips per award, an emoji and a name you can type over, a prize
field, and the badge maker with a team picker to pin one
(src/screens/CommishDesk.tsx, apps/mobile/src/ui/CommishDesk.tsx). The
history screen grew an AWARDS block (the last three weeks, plus the season's
trophy count) and puts each manager's badges and 🏅count on their all-time
line.

Probes: scripts/db/award-probes.sql (wired into the scratch runner) — the
built-in four, each corner of the rule grammar, ties, an unfinished week,
preseason, idempotency, a late award filling in an old week, the prize paid
once, the first edit materializing the defaults, a retired award keeping its
wins, badges granted and revoked, and the trophy case in the history. 101
suites pass beside it; the three that do not fail identically on main. Web
and mobile typecheck.

### v0.440.0 — the record book

The gap list's third priority, and the one it called "a screen, not a
schema": Sleeper, Yahoo, League Tycoon and MFL (back to 1980) all show a
league its own past. Drip has stamped a champion since 0073 and rolled
leagues into their next season since 0182, and never showed either. 0324
reads it back.

  1. THE LINEAGE. A native league's seasons share one sleeper_league_id,
     which is how _rollover_target already finds next season — so the
     lineage is every native league row with that key, oldest first, and a
     league that has never rolled over is a lineage of one (with a short
     record book, not no record book). An imported league stands alone and
     still gets its records.
  2. WHAT COUNTS. Regular-season finals decide the tables, the records and
     the manager lines. Playoff finals ride the single-week rows — a
     semi-final is a real 180-point week — but never a W-L. The median game
     (0320) is a standings display, not a game. Preseason weeks (101+) are
     practice and count nowhere.
  3. WHO A MANAGER IS. app_user_id where the seat is claimed, else the seat
     itself — a league whose seats changed hands keeps two honest lines
     rather than one wrong one, and the name shown is the one from that
     manager's latest season.
  4. WHO MAY READ IT. Any member of ANY season in the lineage reads all of
     them: a manager who joined last August should see the seasons he
     missed. A stranger reads nothing.

league_history returns it in one call: the seasons (champion, runner-up from
the title game, the final table, that season's high week), the record book
(biggest weeks, biggest beatings, closest calls, best seasons by points,
best records, quietest weeks) and the all-time manager table ordered
champions-first.

CONSOLES. A 🏛 LEAGUE HISTORY tile on both league menus opens the same four
blocks in the same order — champions, all-time, the record book, then a
season picker (src/screens/LeagueHistory.tsx,
apps/mobile/src/ui/LeagueHistory.tsx). Shown for imported leagues too, where
the champions band is empty and the records are not.

Probes: scripts/db/history-probes.sql (wired into the scratch runner) — a
lineage of one and of two, the champion and the runner-up, preseason
excluded and playoff weeks included, the manager lines across a seat that
changed hands, and who may read it. 100 suites pass beside it; the three
that do not fail identically on main. Web and mobile typecheck.

### v0.439.0 — one of these, in this order

The gap list's second waiver row, and the Wednesday-morning problem every
league knows: you want ONE running back, so you file on three and wake up
holding all three — or you file on one and get nothing. Fleaflicker,
Fantrax, MFL, Yahoo and FFPC all have contingency groups; every Drip claim
settled alone. 0323.

  1. THE GROUP. waiver_claim carries group_id, group_seq (the manager's
     preference order) and group_max (how many of the group may land, 1 by
     default). group_waiver_claims links claims already filed — ticked in the
     order you want them tried — and submit_waiver_group files a whole list
     in one call, ALL OR NOTHING: a list whose third claim is refused files
     none of them. ungroup_waiver_claims and cancel_waiver_group undo it.
  2. THE RUN NEEDS NO NEW PASS. Claims are still ordered by the league's own
     rules — bid, standings, priority — with group_seq as the tiebreaker
     between two of one seat's OWN claims. When a win fills its group, the
     rest settle as losses noting "conditional — already landed X", so the
     waiver report says why a fallback went quiet. A $40 bid on the back you
     want and a $12 fallback still compete at their own prices, and you
     cannot end up with both.
  3. THE GROUP WINS NOTHING BY ITSELF. A member outbid, blocked by a full
     roster, a position cap or a commissioner's flag still loses, and the
     fallback then gets its chance — the group only ever takes claims OFF
     the table.
  4. THE CURSOR IS A SNAPSHOT. process_waivers now re-reads each claim's
     status before settling it, because a group can take rows off the table
     mid-run. One index read per claim, and every future "settle these too"
     rule is safe by construction.

CONSOLES. Both team screens group the pending claims, print "🔗 ONLY 1 OF
THESE 3" over them with each member's place in the order, and grew a LINK
mode that ticks claims in preference order with a stepper for how many may
land — plus unlink and cancel-all (src/screens/NativeLeague.tsx,
apps/mobile/src/screens/Team.tsx).

Probes: scripts/db/conditional-claim-probes.sql (wired into the scratch
runner) — linking's gates, the first choice winning and the rest standing
down with the reason in the league report, an outbid first choice letting
the fallback fire, a ceiling of two, the all-or-nothing list, unlinking and
cancelling. 99 suites pass beside it; the three that do not fail identically
on main. Web and mobile typecheck.

### v0.438.0 — the three-team trade

The last open item on the gap list's trade row, and the one every platform
but FFPC has. Drip's trades have been two seats since 0072; 0322 gives them
LEGS.

  1. THE SHAPE. A multi-team deal is a trade_proposal with one trade_leg per
     seat, and every asset on a leg names WHERE IT GOES rather than who it is
     swapped with. That is what makes a carousel work: A's receiver goes to
     B, B's back goes to C, C's pick goes to A, and no two seats have a trade
     between them at all. 3–8 teams; players, picks, FAAB and cap dollars all
     travel, each addressed to a seat in the room.
  2. ONE ANSWER PER SEAT. The proposer's leg is accepted when it is filed;
     every other seat answers with the same respond_trade a two-seat offer
     takes, which now dispatches on the shape. Nothing moves until the LAST
     yes, and a no from anyone in it kills the whole deal — a three-way minus
     one team is not a smaller trade, it is no trade.
  3. EVERYTHING 0321 BUILT APPLIES. The offer clock, the commissioner's
     ruling, and the league vote, whose electorate is now every seat outside
     the deal however many that is — a team in a three-way cannot vote on it.
     One acceptance path (_trade_route_accepted) serves both shapes, so a
     three-team deal can never take a different route from a two-team one.
  4. WHAT IS REFUSED, and why: salary retention (its terms name a player and
     the seat that keeps eating him — a two-seat sentence), and counters (a
     counter to a three-way is a new three-way). Both say so.

EXECUTION re-validates per seat, not per side: every player still where the
deal said, every pick still owned and unspent, every ROSTER landing legal
(trade_cap_error per seat), every wallet still holding what it promised.

CONSOLES. Both trade screens grew "＋ A THIRD TEAM": adding one turns the two
piles into a per-seat builder where each asset is checked and then pointed at
whoever receives it (the default is the next team round the ring). A
multi-team row reads as one line per seat with a ✓ against the seats that
have said yes, and my seat answers with ACCEPT MY LEG / KILL THE DEAL. The
commissioner's queue on the web renders the legs too.

Probes: scripts/db/multi-trade-probes.sql (wired into the scratch runner) —
the shape's gates, a three-way accepted one seat at a time, a seat killing
it, the league vote over a three-way, picks and FAAB travelling, and a
player who moved between the offer and the last yes. 98 suites pass beside
it; the three that do not fail identically on main. Web and mobile
typecheck.

### v0.437.0 — the trade floor

docs/competitor-gap-analysis.md, written against nine platforms, put trade
parity first: "Every platform except FFPC has the first two." Four of that
list in 0321, both consoles, the worker. Multi-team trades are the fifth and
a round of their own.

  1. THE LEAGUE VOTE. trade_review takes a third word, 'league'. An accepted
     trade goes to 'review' for trade_review_hours (24 by default) and every
     UNINVOLVED seat may veto or allow it. It dies the moment the vetoes
     reach trade_veto_votes — unset, that is a majority of the seats outside
     the trade, so it stays right when the league grows — and goes through
     the moment the bar cannot be reached, rather than sitting out a window
     whose outcome is already arithmetic. Chat is told twice: when the deal
     goes to the floor, and how the floor ruled. The commissioner still
     outranks it in both directions while the vote is open.
  2. EXPIRY. An offer may carry its own clock (6h / 24h / 72h, or the
     league's trade_offer_days default; -1 stands until answered). An
     expired offer refuses the acceptance that finds it and says so, and
     the sweep closes the ones nobody touched.
  3. COUNTERS. counter_trade answers an offer with an offer: the original
     closes as 'countered' and the mirrored proposal is filed from the other
     seat in one transaction, carrying `counters` back to what it answers.
     A counter is a real proposal — propose_trade re-validates every piece,
     so nothing can be smuggled through the reply.
  4. FAAB AS AN ASSET. faab_dollars rides a proposal the way cap dollars
     have since 0219 (+ = the proposer sends). FAAB leagues only, behind the
     commissioner's faab_trading switch, and the wallet is checked at the
     offer AND at execution — a review window is a day long and a waiver run
     inside it can spend the money first.

CONSOLES. Web: TRADE REVIEW under WAIVERS & TRADES (the old two-way toggle
moved there whole, so one panel owns the mode and the vote's numbers);
the trade card grew the vote tally with VETO / ALLOW, an offer's countdown,
⇄ COUNTER, and a FAAB row in the propose modal (src/screens/CommishDesk.tsx,
src/screens/NativeLeague.tsx). Mobile: TRADE FLOOR under RUN THE SEASON, and
the same vote / counter / FAAB / clock controls on the trade card
(apps/mobile/src/ui/CommishDesk.tsx, apps/mobile/src/ui/TradeCenter.tsx).
The commissioner's queue on both hosts now lists a trade out for a vote.

WORKER. sweepNative calls trade_sweep() each pass: offers whose clock ran
out, and votes whose window closed. Idempotent, one statement per sweep.

Probes: scripts/db/trade-floor-probes.sql (wired into the scratch runner).
97 suites pass beside it; the three that do not (classic-open-lineups,
dropped-pick, draft-midseason) fail identically on main. Web and mobile
typecheck; server tests and check:parity pass.

### v0.436.0 — the commissioner's desk

Founder, holding Sleeper's Commish tab against ours: "build the gaps in
that order." Six, in his order, in 0320, both consoles and the API.

  1. CO-COMMISSIONERS. league_commish; is_league_commish and
     is_matchup_commish read it, so every commissioner RPC in the schema
     admits a co-commissioner at once (the probe has one change the rules
     and force-move a player). Adding, removing and handing over stay with
     the PRIMARY commissioner, as does deleting the league; a co may step
     down. A hand-over keeps the old primary on as co. commish_overview
     lists a co-commissioner's leagues, flagged not primary.
  2. TWO LOCKS. settings_json.wire_lock shuts every free-agent and waiver
     move in the league (adds, drops, claims — the worker's too);
     league_membership.wire_locked shuts one team's (adds, drops, claims,
     and offering or accepting a trade). Both answered by wire_block_reason,
     which every wire RPC asks — drop_player now asks it too. The
     commissioner's own force-moves are not on the wire and still work. The
     team screen says why the wire is shut (native_team_state.wire_block).
  3. THE WAIVER ORDER, set at once (commish_set_waiver_priority — every
     roster exactly once, first pick first). LINEUPS: a commissioner may
     write a CLASSIC team's lineup (sealed_pick policies, same kickoff
     lock as the manager); classic only — a drip league's picks are hidden
     and that is the game. The permission is in; the screens do not yet
     offer "edit as commissioner" (a co-manager-style acting seat is the
     path, and a round of its own).
  4. THE MEDIAN GAME. settings_json.median_game: every regular-season week
     each team also plays the league median — above it a win, below a
     loss, on it a tie. Wins and losses only; points for/against stay
     real. Standings carry median_w / median_l beside the record.
  5. SCORE EDITS. commish_set_matchup_score on a FINAL matchup; standings
     read the finals, so records follow at once; the chat is told. A
     playoff round already drawn is not re-drawn. commish_week_scores
     reads a week for the editor.
  6. DUES. settings_json.dues_amount / dues_note and league_dues (paid per
     seat, when); the whole league may read the tracker.

CONSOLES. Web: COMMISSIONERS, LOCKS and DUES under SEATS; WAIVER ORDER and
the MEDIAN GAME under WAIVERS & TRADES; EDIT SCORES under MATCHUPS
(src/screens/CommishDesk.tsx). Mobile: COMMISSIONERS, LOCKS, WAIVER ORDER
and EDIT SCORES under RUN THE SEASON, DUES under MONEY
(apps/mobile/src/ui/CommishDesk.tsx).

Probes: scripts/db/commish-desk-probes.sql; sleeper-parity, door-opens,
waiver-holes, fa-off, agent-wire, waiver-rules, drop-lock and
team-manager still pass beside it. Web and mobile typecheck.

### v0.435.0 — four Sleeper settings

Founder, holding Sleeper's General Settings against ours: "Do we have these
all covered?" Four were not: "build all four gaps." 0319, both consoles,
the worker.

  1. MINIMUM BID. faab_min_bid (default $0). A FAAB claim below it is
     refused ("the minimum bid is $2"); the seat wire floors its own bids
     to it before filing, so an open-seat fill priced at $0 becomes a $1
     claim in a $1-minimum league.
  2. FREE-AGENCY DAYS. fa_dow (0=Sun…6=Sat ET; absent = every day) —
     Sleeper's per-day "Waivers" / "Waivers to FA". On a day outside the
     set every unowned player is a claim; on a day inside it the existing
     after-waivers gate and window hours apply as before. Midnight ET joins
     the boundaries fa_opens_at and fa_open_since walk, so a claim filed on
     a waivers-only day clears at LEAST(the run, the next free-agency
     morning) (0318's rule) and the wire's first-hour courtesy starts at
     midnight. The founder's Sleeper shape — waivers Mon–Sat, waivers-to-FA
     Sunday — is now: run days every day, FA days [Sunday], FA waits for
     the run on Sunday.
  3. TRADE DEADLINE. trade_deadline_week ("through week N"). Offers and
     acceptances go through until week N is final; then both are refused
     with the reason. A deal accepted in time and waiting on the
     commissioner may still be ruled on. roster_rules also says whether it
     has passed, and both consoles show it.
  4. A HOLD OF NONE. waiver_hold_days may be 0: a dropped player is a free
     agent at once (or, with free agency shut, a claim clearing at the next
     run). The web stepper and the mobile chips offer NONE.

Also fixed on the way: add_free_agent's "free agency is closed" answer
quoted the window's hours, and a league shut by something other than
hours (the after-waivers gate in an open league; now the days) sent an
error with no text. It now says when the door next opens.

set_transaction_rules grows three named parameters; the old signature is
dropped so PostgREST has one candidate. Probes:
scripts/db/sleeper-parity-probes.sql; door-opens, waiver-holes, fa-off,
agent-wire, waiver-rules and drop-lock still pass. Web and mobile
typecheck.

### v0.434.8 — the door opening clears the claims

Founder: "I set waivers to run at 2pm then opened free agency but the
waivers still ran at 2pm. Can we sweep for conflicts and changes like that?"

WHAT HAPPENED. With free agency off every add is a claim, stamped with the
league's next run (0291) — 2pm. Opening free agency changed nothing about
those claims: their stamp still said 2pm and the run reads the stamp.
Meanwhile the players they named had become free agents, so until 2pm
anyone could add one outright and the claim behind him — filed first —
would lose 'player taken' at the run. The setting and the pending state
disagreed, and the pending state won. 0318.

THE SWEEP — every commissioner setting that touches the wire, against the
state it leaves behind:
  • run time / run days — 0292 re-dates holds and claims. fine.
  • hold days — same. fine.
  • FREE AGENCY off→open, off→window, window hours, after-waivers days —
    nothing re-dated, nothing settled. FIXED.
  • agent waivers off — the worker stopped filing but its pending claims
    still won at the run. FIXED: they are cancelled with the reason.
  • waiver mode / budget — bids re-checked against the new budget at the
    run. fine. (A budget change resets spending by design; both consoles
    send it only when edited.)
  • roster / position limits — re-checked per claim at the run. fine.
  • vampire lock (0316), guillotine chop (0221), trades moving a claim's
    drop or add (0316 / 'player taken') — fine.

THE RULE, in three places so no path can miss it:
  1. process_waivers: a claim on an UNHELD player is due whenever the add
     market is open, whatever its stamp says. Fixes the founder's league
     for any way the door gets opened — console, data migration, a window
     arriving. Held players are untouched: the door cannot reach them until
     the hold ends, and the hold is on the run's schedule (0292).
  2. submit_waiver_claim and _restamp_waiver_clocks stamp the forecast —
     LEAST(the run, the door) for an unheld player — so the claim screen
     tells the truth. 0291's point stands where it was made: a door later
     than the run never delays the run.
  3. set_transaction_rules settles what its own change made due, in the
     same transaction, and cancels the worker's pending claims when agent
     waivers are switched off. add_free_agent's pre-add sweep now settles
     ANY pending claim on the player, not only the due-by-stamp ones.

ON DEPLOY: any claim sitting in a league whose free agency is open settles
on the next sweep (within 25s) — the ones that waited for 2pm.

Probes: scripts/db/door-opens-probes.sql (console opens the door; a data
fix opens it; an add settles the claim first; a held player untouched; a
window arriving; agents off; a rolling league). fa-off-probes fo24 re-read
for the new rule (door before run → door; door after run → run; no door →
run); waiver-holes, agent-wire, waiver-rules and drop-lock still pass.

### v0.434.7 — no drops after kickoff

Founder, on the audit's open question: "block drops after kickoff too."
A manager could drop a player whose game had already started — in a drip
league outright (0179's kickoff lock is classic-only), and in a classic
league through the waiver run and the agent wire, which act as the server
and pass the trigger. Nothing was won by it (the sealed pick still scored,
the pickup could not play this week), but it is the rule every other
platform has. 0317.

THE RULE, one function: drop_lock_reason(league, slug) — his game in the
league's live week has kicked off and the week is not yet final. Built on
0179's league_pool → nfl_slate join and league_live_week, so he unlocks
the moment the week goes final, exactly when 0179's lock lets go.

ASKED at every manager-facing drop, as an answer, not a raise:
  • drop_player — refused;
  • add_free_agent — refused when the drop has kicked off (adding a started
    player is still fine; his windows are simply locked);
  • submit_waiver_claim — a started player cannot be NAMED as the drop, even
    for a claim that clears after the week (Sleeper's rule: he is locked);
  • process_waivers — a claim filed before he kicked off and settled after:
    he stays, and the claim goes through only where the seat had room
    without him (0316's drop-as-means shape), else loses with the reason.
The classic trigger is untouched, and NOT widened to drip: guillotine_tick
runs from the team screen with a manager's uid, and a raise there would jam
the blade.

Probes: scripts/db/drop-lock-probes.sql (drip: drop, add-with-drop, claim
naming, the run into an open seat and a full one, the week going final;
classic: the worker's agent seat refused). waiver-holes, fa-off,
agent-wire and waiver-rules suites still pass alongside it.

### v0.434.6 — the waiver run's holes

Founder: "So let's check the waiver system for holes." The run read end to
end — submit_waiver_claim, process_waivers, add_free_agent, the clocks
(claim_clears_at, waiver_hold_until, fa_opens_at), the budget, the
priority order, the format guards, the worker's cadence (the tick, every
25s, plus the team screen every 15s). Four holes; three closed in 0316,
the fourth left as the founder's call.

CLOSED.
  1. A SEAT THE FORMAT SHUT OUT ABORTED THE RUN. The native_roster seat
     guard RAISES for a seat under the vampire's wire lock (0268). A claim
     filed before the commissioner flipped the lock hit it inside
     process_waivers, and a raise there rolls back the whole run — every
     sweep, until somebody cancelled that one claim. The run now asks
     wire_block_reason per claim and settles it as a loss with the reason;
     the coven's own claims win in the same run. (The guillotine already
     marked a chopped seat's claims lost at the chop.)
  2. TIMING BEAT MONEY in a league with no run time and no free agency:
     each claim cleared on its own 24-hour hold, so the first claim on a
     player settled alone before a later, higher bid was even due. A claim
     on a player with a pending claim now shares the earliest clock, so
     every claim on him competes in one run. A league with a run time
     already shared it; nothing changes there.
  3. A CLAIM WHOSE DROP HAD ALREADY LEFT THE ROSTER LOST even with a place
     open — an earlier claim of the same seat had spent him. It now goes
     through without the drop when the seat has room, and loses only when
     it would need the drop to make room; the row and the report say which.
  Also: "outbid" only when a claim in this run took the player; one signed
  off free agency while the claim sat is "player taken".

LEFT AS IS, WRITTEN UP.
  4. A PLAYER WHOSE GAME HAS STARTED CAN BE DROPPED. drop_player,
     add_free_agent and a claim's drop have no kickoff check; his sealed
     pick stays and scores for the dropper (0278's rule), and the pickup
     that replaces him cannot play this week (v0.434.4). So no points move:
     the only gain is a roster place a run earlier than waiting for the
     week to end. Sleeper forbids the drop outright until the week is over.
     Adding that rule would also make a Sunday 2pm run refuse every claim
     whose drop played at 1pm, which is most of them in a league run at
     2pm — so it is a rule the founder chooses, not a bug to fix quietly.
  Not holes, noted: a window league whose run is later than its window
  lets a first-come add during the window beat a blind claim not yet due
  (the FA-after-waivers day gate exists for exactly this, and was lifted
  for Kickoff Sundays on request); FAAB ties break by rolling priority
  then filing time (set at the draft, rotating on wins); a human seat has
  no cap on pending claims (each settles or loses on its own, harmlessly).

PROVED. scripts/db/waiver-holes-probes.sql pins the shared clock and the
one-run settlement (the higher bid wins, the lower is outbid), "player
taken", the drop-as-means both with room and without, and the vampire
lock losing a claim without aborting the run. fa-off and agent-wire
probes unchanged and green.

### v0.434.5 — every league's week pools refreshed now (a data migration)

Founder, the morning after 0314: "Can we refresh the week 2 pool now?"

0314 taught native_materialize to refresh a live week add-only, but it
runs when a roster changes, and every native league's live-week pool was
last written at the week's first kickoff — before Sunday's waiver run.
0315 runs the refresh once for every native league, so Coleman (and every
other Sunday pickup, in every league) is in the week-2 pool the boards
read before the week finalizes. Idempotent and safe by construction:
scheduled weeks rewritten from the rosters, live weeks only gain what is
missing, final weeks untouched; a NOTICE per league in the migrate log.

### v0.434.4 — a mid-week pickup joins the live week, and counts from the game he was owned for

Mooney's Rehab Facility, Kickoff League, Sunday night: "confused on why it
doesn't look like Coleman counted for my rookie best ball spot. App is
showing me it counted Chris Bell who had 0 today … waivers look like they
processed at 2 pm so I guess he didn't count on my roster before he
played." Founder: "That's unintended."

TWO READERS, TWO ANSWERS. The boards read the week's pool
(sleeper_lineup.starters_json), which native_materialize (0064) rewrites
from the rosters only for weeks whose every matchup is still 'scheduled'
— so from the first kickoff a Sunday waiver win never reaches the week's
pool, the picker cannot offer him, and the boards' best-ball preview
cannot see him: the app showed Bell. The resolver reads native_roster
directly (active spots, with league_pool.exp for the rookie-only spot's
tenure filter), so the SCORE may already have counted Coleman; the
screens said otherwise. scripts/db/rookie-spot-pickup-diag.sql reads
both — the claim, the roster row, both pool rows (exp: a null is refused
by a tenure-filtered spot), the week pool, the scored slot rows, and the
kickoffs.

THE POOL (0314). native_materialize refreshes a LIVE week ADD-ONLY: every
active player missing from a seat's week row is appended (marked
`added`), nothing already there is removed — a dropped man who already
played stays on a board that holds his sealed pick — and a stashed
pickup is not added. Scheduled weeks are rewritten as before; final weeks
never touched. scripts/db/pickup-live-week-probes.sql pins all of it.

THE RULE (resolver). A pickup counts from the game he was owned for: the
tick hands the resolver the week's kickoffs (opts.teamKicks) and a player
whose native_roster.added_at is after his team's kickoff this week stays
out of the fills. With free agency open, an add after the box score is in
must not let a best-ball spot bank points nobody owned when they were
scored; a 2pm waiver win for a 4:05 game is on the roster like anyone
drafted. Without kickoffs (the sim, a week with no slate) nothing is
excluded. The week's matchups are still live until Monday night, so the
next resolve pass after deploy scores Mooney's week with Coleman where he
belongs.

### v0.434.3 — the field knows halftime, and the play-by-play carries the stoppages

Founder, at halftime of IND–KC with the field frozen on "Q2 00:35": "It's
halftime for this game. Is half time and other clock stoppage events
something we can tell and show on the field and play by play?"

WE COULD TELL AND DID NOT KEEP IT. ESPN's summary header carries the
game's STATUS — STATUS_HALFTIME, STATUS_END_PERIOD, STATUS_DELAYED, the
live period and display clock — and its drives carry the clock-management
plays (timeouts, the two-minute warning, End Period, End of Half, End of
Game, the coin toss) that the field adapter skips because they have no
field situation. 0103 kept one word of the status (pre|in|post) so
halftime would not read as FINAL; the rest was dropped at the poller, and
every clock on screen was the LAST PLAY's snap time.

THE FEED (0313). game_feed gains `status` {name, detail, short, period,
clock} and `events` [{c, ty, txt, tm?}]; the poller writes both from the
adapter's new gameStatus / gameEvents; the client read carries them to
TeamGameFeed. Both are optional: the simulator and the baked replays write
neither and every reader falls back to the last play's clock, as before.

THE WORDS (core gameView). `stoppageLabel` — HALFTIME, END OF Q1 (the end
of the 2nd quarter IS halftime), DELAYED, FINAL; `liveClockLabel` — the
live display clock as "Q3 12:04" while in progress (period 5 is OT);
`clockLabelFor` — the strip's one call: FINAL, a stoppage, the live clock,
or the last play's clock; `shortClockLabel` — the chip's word (HALF, END
Q1, DELAY, Q3); `eventLabel` — TWO-MINUTE WARNING, TIMEOUT · KC, END OF
Q1, HALFTIME, FINAL, COIN TOSS; `gameLog` — plays and stoppages in clock
order, a stoppage AFTER the play at its clock. check:gamestatus pins all
of it (in check:parity).

THE SCREENS (both hosts). The score strip and the game header say
HALFTIME / END OF Q3 / DELAYED, or the live clock between snaps; the
field's situation chip says the stoppage; the LAST PLAY line reads
"● HALFTIME · LAST PLAY"; the all-fields strip chips say HALF / END Q1 /
Q3; and the play-by-play carries the stoppages as dividers at their clock
("— HALFTIME · Q2 00:00 —", "— TIMEOUT · KC · Q2 01:40 —", with ESPN's
sentence under a timeout). The field itself is untouched: a stoppage has
no play to draw.

### v0.434.2 — the app's classic board switches matchups from a list

Founder, on the Kickoff League board in the app: "We need switch between
matchups on the classic matchup view in the app."

The ▸ chip (v0.424.0) stepped the week's ring one pair at a time and said
only where in it you were — "1/4" — which on a phone reads as a counter,
not a control, and reaching the third pair meant two taps past the second.
Now the chip opens THE WEEK'S MATCHUPS as a sheet (the app's Overlay, the
same one the slate and the vampire use): every pair in the ring order both
hosts walk (core matchupBrowse.orderMatchups), each with its home-and-away
names, the score where there is one ("153.5 – 126.9 · LIVE", "FINAL"), and
MY MATCHUP / VIEWING marked. One tap lands the board on that pair; my own
pair clears the browse; ↩ MY MATCHUP sits at the foot while browsing. Team
names for every seat in the week are read once per week (matchupTeams,
the same read the header uses). The bye screen's chip opens the same sheet.
The web board keeps its one-tap ring; nothing in core changed.

### v0.434.1 — the lineup alarm does not page a classic seat

Founder, relaying Farmer Casey in the Kickoff League chat: "why do I keep
getting a message that says I have 2 empty roster spots? But it looks like
I am full." He was full.

The lineup push (server/src/push.js detectLineup, 0150) is a DRIP alarm:
55–65 minutes before a slate window locks it counts a manager's sealed
rows in THAT window against the window's slot count and pages the
difference. It scanned every matchup of the week, classic leagues
included — and a classic seat stores one weekly lineup under the 'wk'
window, never a row per slate window, so the count for 'early' or 'late'
was always zero and every window lock paged "N empty slots" to a full
roster. The detector now reads the league's game mode with the matchup
and skips classic leagues. A classic lineup has no window slots to be
empty; its open spots are the board's and the widget's business
(v0.433.2), and the lock-time fill closes them.

### v0.434.0 — a backup needs a whole empty window, and an empty window reveals an hour before it locks

Founder: "We should have players sub only if every opposing slot in their
window is unopposed. That way, an hour before when the players lock, the
window can reveal and players can do the substitution action." And: "do
it that way" — a slot unopposed inside a partly filled window plays in
place and banks its own points.

THE RULE (core scoringRules.bestBallBackups). Until now ANY of your slots
whose facing seat was empty was a backup: zeroed in place, its would-be
score movable onto your lowest beatable starter, all-or-nothing. That
could only be known at kickoff, when the opponent's sealed picks turned
face-up, so the sub arrived with the game already on. Now a slot is a
backup only when the opponent left its WHOLE window empty (no slot in the
window has an opponent). A slot unopposed in a window the opponent partly
filled is not a backup: it plays against the empty seat and keeps the
points the slot resolver already scored for it. A same-window sub no
longer exists (a window with an opposed starter is not empty); a manual
assignment on a slot that is not a backup does nothing. Both engines
(the boards' and the resolver's) run the one function. check:backupwin
pins the partly filled window (banks in place, no subs), the empty
window (backups as before), the ignored assignment, and the rewritten
same-window case.

THE REVEAL (0312 `opponent_empty_windows`). The opponent's picks stay
sealed until kickoff (0262), but a window they left entirely empty
reveals nothing about any pick — only that there are none — so it can be
shown early. The function lists, for a participant's matchup, the windows
in which the opponent has no filled pick and which are within an hour of
locking (lock is kickoff − 1h, so from kickoff − 2h) or already locked.
"Empty" follows the resolver: a seat with rows scores from its rows (a
window with none is empty); a seat with NO rows is fielded by the resolver
under best_lineup, and an AI, unenrolled or unclaimed seat always, so
nothing reveals for those; under the 'empty' policy a rowless seat is
empty everywhere due. Classic matchups and non-participants get []. The
opponent can still fill a revealed window until it locks; then it drops
off the list, the engine makes no backup, and an assignment made in the
meantime is simply unused. scripts/db/empty-window-probes.sql pins all
of it against kickoffs set around now().

THE BOARDS. The web board polls the list beside the revealed picks; a
pending backup in a revealed-empty window surfaces the sub nudge BEFORE
kickoff — "opponent left SUN 1PM empty — 2 backups can sub · assign →" —
and the existing backup menu assigns it (set_backup_assign already takes
a pre-kick target). The mobile duel's empty seat says which case it is:
"window left empty — the facing player subs as a backup" or "unopposed —
the facing player banks here". The web's slot copy follows the engine
flag and needs no change.

### v0.433.9 — the drip widget deals your cards, with a status chip and a warning on every open slot

Founder: "Can we actually show the images of the cards of your players
picked in the widget for drip scoring leagues? Have a status chip and a
warning for any unfilled slots?"

THE CARDS. The feed's drip summary now carries `cards`: one per slot of
every window in kickoff order, empties included — the headshot (the baked
map, else the league pool's ESPN id, read once a day), the short name, the
position and team, the sealed metric's name, the points and hot streak
from the slot row once the window has kicked, and a STATUS: `empty` (an
open slot with nobody in it — THE WARNING), `missed` (locked with nobody),
`unsealed` (a player without a metric, window open), `set`, `sealed`,
`live` (points so far), `final` (points banked).

THE CARD. The lineup view draws each window as a row: the window's label
and how many slots are still open down the left, its cards across — a
30dp headshot with rounded corners (a position pill when there is no
photo), the name, the metric, and the chip: "⚠ EMPTY" and "NO METRIC" in
amber on an amber-bordered card, "SET ✓", "SEALED", "● 9.1" (🔥 when hot)
on a live-bordered card, "9.1 ✓" at the final, "MISSED" in the quiet
colour. One window on a 4×2, two on a 4×3, four on a 4×4 — the open ones
first (there is something to do), then live, locked, final — drawn back
in kickoff order. The header's right side counts the empties ("⚠ 2 EMPTY
· SUN 1PM LOCKS 12:00 PM ET"); OUT and BYE starters, which a card cannot
show on its own, keep a line each on the taller sizes. The score view is
untouched, and a classic seat has no cards (its spots print as fixes,
v0.433.2).

PROVED. check:widget stands the cards up on the week-3 slate: every window
in order, the live pick's points/hot/name/photo, EMPTY for the open hole,
UNSEALED for a player without a metric, SET with the metric's name, MISSED
once the hole's window locks, SEALED once a pick's window locks, FINAL
with the points, and none for a classic seat.

### v0.433.8 — the Kickoff League's add market does not wait for the run

0310's log: "fa_mode open → open, open now: f, 18 pending claim(s)
re-stamped". Free agency was ALREADY open. What shut it today was the
after-waivers gate (0127, the console's FA AFTER WAIVERS day picker):
fa_after_waivers_dow lists today, so instant adds stay closed until
today's waiver run has cleared. That is the gate the founder is asking to
lift — "I need the turn free agency on … Right now." — so 0311 sets
fa_after_waivers_dow to [] (never wait) on the newest league named
Kickoff…, printing the days it held so the commissioner can restore them
from the console if the gate was wanted on other days. The run itself is
untouched: pending claims still settle there. Idempotent, scoped by name,
a no-op without the league.

### v0.433.7 — free agency on for the Kickoff League (a data migration)

Founder: "I need the turn free agency on for kick off league." Then:
"Right now."

The console does this (FREE AGENCY → ALWAYS OPEN under WAIVERS & TRADES)
and scripts/db/kickoff-free-agency-open.sql does it from psql, but the
session's GitHub integration cannot dispatch dbquery.yml (403), and the
one write path that runs on its own is a migration landing on main. So
0310 carries the same two statements: fa_mode = 'open' on the newest
league named Kickoff…, and its pending claims re-stamped through
claim_clears_at as set_transaction_rules would. Idempotent, scoped by
name, a no-op on a database without the league; it prints what it did
as a NOTICE in the migrate run's log.

### v0.433.6 — the widget says BYE only when it can prove one

Founder, with the widget reading "BYE · WK 2 — On a bye this week —
nothing to sweat" over a team it could not even name: "Looks like it
assumes your team is on a bye if there is no data. Let's not do that.
Let's only say on a bye if actually on a bye."

It did assume. `summarize` read "no matchup row for this seat" as a bye,
and a row is missing for other reasons — the schedule not built yet, an
open week past the schedule, a league that plays elsewhere, a read that
came back empty. A bye is a claim with evidence: the league HAS matchups
this week and this seat is in none of them. The feed now reads the week's
matchups only when the seat has no row (weekMatchups, one small read, and
a failed read is no claim); `summarize` takes `weekScheduled`, says BYE
only when it is true, and otherwise draws a new `idle` phase — "NO
MATCHUP · WK 2 / No matchup scheduled this week yet." — in the quiet
colour. check:widget pins the three cases: scheduled week ⇒ bye; no word
⇒ no matchup; a week with no matchups ⇒ no matchup.

### v0.433.5 — the drip matchup's felt is flat

Founder, on the phone: "Can we get rid of the gradient background on the
drip matchup?"

The hero board's felt layer (`.mx-felt .ct-feltlayers` in cardTable.tsx)
painted three team-colour radial glows — yours top-left, theirs
bottom-right, a third mid-board — and a vignette over the felt tint, which
on a tall phone read as a teal-to-magenta wash down the whole page. The
layer is now the felt tint alone (the skin's `--ct-felt` mixed with the
theme background, as before), with the paper-grain noise kept for texture.
The card faces, backs, window sections and chips are untouched; so is the
card-table demo's drifting glow, which was never on this board.

### v0.433.4 — the notification icon is a drop cut out of a football

Founder, from a sheet of eleven candidates (drops, footballs, helmets, and
mashups of the three, each rendered at 24/36/48/66/96px on the dark bar
and the light one): "Let's try 11 but with the solid drop of 5."

So: the football, plain, with the drop KNOCKED OUT of it. Two shapes, both
of which survive as an alpha mask — the ball one solid lens, the drop one
solid hole — and together a mark nobody else in the status bar wears. No
laces and no end seams: at 24px those thinned to specks that read as
damage on the ball's edge, and the drop is the detail worth keeping. The
drop is 56% of the full droplet, chosen from three sizes so its bulb
clears the ball's edge on every side at every density (a hole that opens
onto the background is a bite, not a drop). Same generator, same two
outputs — the Android small icon and the web push badge — now asserting
the ball opaque, the drop clear at apex and bulb, and white ball between
the drop and the background top, bottom and both sides.

### v0.433.3 — the notification icon is a drop with football laces

Founder: "The notification icon is just a drop of water. I think we can do
better."

A bare droplet in a status bar is a hydration reminder or a weather app;
nothing about it says football and nothing says it is ours. The drop stays
— it is the brand — and wears a football's laces, KNOCKED OUT of the mask:
one seam down the centre and three cross-laces. Laces are the one piece of
football that survives as an alpha mask (Android keeps only the alpha and
tints the shape itself), because they are a few thick strokes rather than a
shape that must keep its proportions: every stroke and every gap is at
least four units in the 96-unit box, so at 24dp on a modern phone (66px
and up) the seam and each lace are two to four pixels of clear space, and
at the 24px floor the drop reads as striped rather than smudged. Three
laces, not four: at 24px four merged into a bar. The clear space never
reaches the drop's edge — a lace that opens onto the background is a notch.

Same generator (`scripts/gen-notification-icon.py`, pure Python, exact
coverage), same two outputs — the app's Android small icon and the web
push badge — so both surfaces still wear one mark. The generator asserts
the corners clear, the body opaque, the seam and top lace clear, the gap
between laces opaque, and the laces short of the edge. Previewed at 24, 36,
48, 66 and 96px on the dark bar and the light one before wiring.

### v0.433.2 — the classic widget projects the final and names the spots that want attention

Founder: "For classic leagues, let's show predicted score rather than
current. There's still a lot of room in the widget. We can show empty
starting spots, starting spots with out/bye players, and starters where a
player that is projected to score 2+ more points is on the bench and could
replace. No need to make this a separate view."

THE NUMBER. A classic seat's score on the card is now the PROJECTED FINAL,
the board's own blend (projectEntry): a starter's points if his game is
done, his projection if it has not started, the larger of the two while he
plays. The widget has no play feed to say a game is final, so a game reads
as done three and three-quarter hours after kickoff, and the matchup's
final closes everything. The "vs" between the scores reads PROJ. The
opponent's lineup is read the way the browse ring reads it (0178's
league-readable classic rows); a seat with no rows is fielded from its
roster exactly as the resolver fields it (classicLineup), and an opponent
whose roster cannot be read keeps their live total, marked PROJ · LIVE.
Golf sums with the spot's zero-fill on an empty or settled-zero spot.

THE SPOTS. Drawn on the score card itself, in the room the window strip
used (a classic week scores as one window, so the strip had nothing to
say). Three passes over the starting spots, in the founder's order, each
bench man promised to one spot: the EMPTY spots take the best bench man
first ("RB 2 · empty · start B. Robinson 22.2"); then the spots whose
starter cannot play — OUT/IR/DOUBTFUL by the injury sheet, or on BYE by the
slate — with the best bench man to start; then the UPGRADES, a bench man
who projects SWAP_MIN_GAIN (2) or more over the starter ("RB 1 · K.
Gainwell 11.9 over E. Heidenreich 0.6"). A starter whose game has kicked
off is locked in and never flagged; a bench man whose game has kicked off
is never suggested. Golf reads "better" as lower-but-not-zero. Two lines
on a 4×2, four on a 4×3, eight on a 4×4, "+N more" past that; a set lineup
says so on the taller sizes. Not a separate view: the classic card has no
⇄ chip, and the lineup view stays a drip feature.

THE READS. The classic paint adds what the classic board reads: the
league's spots and catalog (league_game_mode, cached an hour), my rows and
the opponent's revealed ones (fresh), both rosters (30 min), the shelf —
IR/OUT/taxi can neither start nor be suggested (30 min), tenure when a spot
filters on it (an hour), and the pool's Sleeper ids (an hour) so the bake
answers by id (v0.432.4). The catalog and golf flag are installed for the
projection and cleared after; the headless task shares a module with the
next league's paint.

PROVED. check:widget stands a classic seat up on the week-3 slate and pins
the projected final before kickoff, on Thursday night (a live man's max),
on Sunday (a finished game banks, a live starter is never a swap, a bench
man on the field is never suggested), at the final, with an unreadable
opponent, in golf (the lowest bench man fills the hole; lower is the
swap), and that a drip league is untouched.

### v0.433.1 — the widget's error card is the retry, and a failed read keeps the picture

Founder, with a home screen that said "Couldn't reach the league — Network
error" more often than not: "The widget shows this a lot. If it's not
connected, can we just have a press to reconnect."

WHY IT SHOWED SO OFTEN. The task's own wakes (the timer, the chips) have
kept the remembered picture over a failed read since v0.422.1. The other
two repaint paths did not: the worker's silent push and the app coming to
the foreground both go through `refreshMatchupWidgets`, which drew
WHATEVER THE READ RETURNED. A push that landed while the radio was asleep
(Doze), or a foreground on a dead signal, replaced a good score with the
apology, and there it sat until the next wake — up to Android's 30-minute
timer. That path now follows the same rule as the rest: a failed read
keeps the remembered picture.

THE PRESS. Two of them. On the error card itself — drawn only when there is
no picture to keep — a tap ANYWHERE is a REFRESH click, the card paints
"Reconnecting…" the instant it is tapped so the press is seen before the
read returns, and OPEN → moves to a chip in the corner for whoever wanted
the app instead. On a kept picture the state carries `offline`: the ⟳ chip
reads "⟳ offline · retry" in amber, so the manager knows the score is the
last one read and has the retry under their thumb.

### v0.433.0 — the wire keeps the league's clock, and humans get the first hour

Founder: "We shouldn't be working the wire at times not in line with what
the league has."

WHAT IT DID. The seat wire chose its instrument by one thing: a player
inside his `waived_until` hold was a claim, anyone else an add. The
league's own clock never entered it. 0288 settled what a manager sees at
the pool — a player free agency cannot reach RIGHT NOW (the window shut, a
league with none) is a claim, hold or no hold, clearing at the league's run
(0291) — and the sweep never learned it. In a FAAB league with free agency
off it called add_free_agent on every unheld player, was told "put in a
waiver claim instead", and filed nothing, every hour, all season. In a
windowed league it added only when its hour fell inside the window and was
refused otherwise. And where it could add, it did so on the hour — a
faster hand than any manager's at a first-come door.

THE CLOCK. Per league per sweep, two readings the database already
defines: `fa_window_open` (may an add land this minute) and the new
`fa_open_since` (0309: when did that last become true — the window's
start, or the after-waivers gate lifting at the clear time; null while
shut; "at least two days" for a door that has stood open). core's
`wireInstrument` turns them into the instrument per player:
  • CLAIM for anyone held, or anyone at all while the door is shut — the
    pool screen's own rule, and the claim clears at the league's run;
  • ADD only through an open door;
  • WAIT on a player who became addable within the hour — his hold cleared
    or the window opened (HUMANS_FIRST_MS) — so every human gets the first
    hour on him and the worker takes him next sweep if he is still there.
    Claims settle at the run against everyone, so they need no courtesy.
`WirePlayer.held` now carries the hold itself, apart from the instrument:
replacement level and the frenzy read the players a human could sign for
nothing at the next opening (over zero, every bid in a shut league would
have been the player's whole worth), and a depth body may be CLAIMED for
$0 when the door is shut — an empty bench in a league with no free agency
must still be filled. The claim cap is on SWAPS: a claim into an open
place is bounded by the places, not by two a day, so a bot vampire's bench
fills by $0 claims rather than staying empty into the byes.

PROVED. check:seatwire pins the instrument table (ten cases) and the
depth-claim behind a shut door; agent-wire probes aw11 pin `fa_open_since`
against windows set around the current ET minute (open ten minutes / three
hours ago, opening in ten, the after-waivers gate five minutes past its
run, 'off', 'open'); fa-off probes unchanged and green. The AI-seat
diagnostic's wire section now prints the league's clock: fa_mode, open
now, open since, next opening, next waiver run, and the raw settings.

### v0.432.4 — the bake answers by Sleeper id, so the worker prices "Kenny" as "Kenneth"

Founder's diagnostic run (ai-seat-lineup-diag.sql on the Kickoff League):
the Steelers' backs are McCaffrey (Q), Heidenreich, Gainwell, and Jacobs on
IR. Tuten, Stevenson and Dobbins — the "three better backs on the bench" —
were another pair's bench in the browse ring. So the fill's RB2 choice was
between Gainwell and Heidenreich, and it took the 0.6-point rookie.

WHY. The bake spells him "Kenneth Gainwell" (slug kenneth-gainwell, Sleeper
id 7567); the pool says "Kenny" (kenny-gainwell). `projectedPoints` looked
the scalar up BY SLUG ONLY — `PROJ_2026.get(id)`, then the K/DST base — and
never consulted `PROJ_2026_SID`, which has carried the same number under
the stable id since v0.307.0. The boards install slug → id from the pool
(leaguePoolIds / setSlugSleeperIds) and were still missing him for the same
reason; the worker never installed ids at all. Gainwell priced at nothing
everywhere, and a scratch who projects 0.6 beat a starter who projects 0.

THE FIX. `projectedPoints`: by slug, then by Sleeper id, then the K/DST
base; `hasProjection` answers by the id too. `SpotPlayer` carries
`sleeperId`; `slateAwareProj` hands it on; every worker caller reads
`sleeper_id` off the pool row and attaches it — the lock-time fill, the
seat wire (roster, candidates, the market's history), the bite sweep, and
the resolver's unmanaged lineup (which now reads the pool row for every
classic matchup, not only under a tenure filter). The boards needed no
change beyond core: their id map was already installed.

ALSO, THE WIRE ON A LIVE WEEK. A free agent whose game has already kicked
off is worth nothing THIS week to the sweep — the fill can never seat him
(the late-swap rail), so signing him for a hole wastes the seat. His
rest-of-season value is untouched, so depth adds still see him. Rostered
players keep their weekly value: a starter who already played is locked in
place and must still count.

check-proj-scoring: the bake knows him by its own spelling, not by the
pool's slug alone, the same number with the pool's id, hasProjection by id,
an unknown id still nothing.

Battery: web tsc, mobile tsc, check:projscoring, check:seatwire,
check:golf, check:spots, check:changelog — green. Worker + web + APK; no
migration.

### v0.432.3 — a seat on auto-pilot works the wire, and the bake learns the late signings

Founder, Sunday 7:41: "Diggs should have a projection. Heidenreich in a
starting RB spot is not optimal. There are like 20 better options on
waivers. Steelers should have added an RB on waivers."

THE WIRE (0308 + both sweeps). 0298 admitted the worker to a seat when
nobody was at it: an agent row, or controller 'ai' — AND no account. The
null was 0213's guarantee kept in place: a manager who flipped their own
team to auto-pilot kept their roster, their drops and their FAAB, and the AI
composed only their lineup. The Steelers are that seat — an account, on 🤖 —
so the wire never acted for them, the IR shelf never took their injured,
and a bot vampire in that shape would never bite. The founder's rule now: a
seat on AI control is the AI's to manage, roster included. `agent_wire_seat`
admits controller = 'ai' whether or not an account is at the seat; the
agent-row branch keeps its null (a claimed seat is the human's the moment
they sit down). Same helper, same four callers (submit_waiver_claim,
add_free_agent, set_roster_spot, vampire_steal), same commissioner switch.
The seat wire and the bite sweep walk every 🤖 seat. Flipping back to
'human' closes the gate the same tick. agent-wire-probes aw9m–aw9o3 and
vampire-rules vr7h/vr7i now pin the open gate and the shut one.

THE BAKE. `proj2026.ts` and `projStats2026.ts` were pulled on 26 August and
Stefon Diggs signed after — no row, so the board printed 0.0 and every fill
valued him at nothing. A fresh StatHead pull (2026-09-20) carries 493 skill
players; 120 that the August bake lacked are APPENDED with their September
lines (Diggs, Keenan Allen, Deebo Samuel, Kareem Hunt, Nick Chubb, the
backups and the reserve-list rows), and every existing row stands. Not a
re-bake: the September pull moves every line toward what the player is
actually doing, and a dozen assertions across check:projscoring,
check:golf and check:spots pin the August numbers on purpose (the bake's
own header says so). Refreshing the whole pool is its own change with its
own pins. Kyle Juszczyk stays in the fullback bake rather than joining as
an RB. PROJ_AS_OF unchanged for the same reason.

THE DIAGNOSTIC. `scripts/db/ai-seat-lineup-diag.sql` (read-only, for
dbquery.yml): the seat (controller, account, agent row, the gate's answer,
the wire block, the switch), the week's matchup, the stored rows and who
wrote them, the roster with designations, the seat's claims, the wire's
depth, and the free RBs — everything that decides what the fill and the
wire do. Heidenreich at RB2 over three better backs on the bench is not
explained by the code as read; this is what answers it.

Battery: web tsc, mobile tsc, check:projscoring, check:golf, check:spots,
check:engineparity, check:seatwire, check:faab, check:bite,
check:changelog; scratch DB through 0308: agent-wire, vampire-rules,
taxi-ir — green. Worker + web + APK + migration 0308.

### v0.432.2 — the mascot builder comes off the landing

Founder: "The mascot work in progress is live on the site. It's not ready
for primetime yet. Can we revert that?"

web only, no APK. The landing shows the v0.419.1 menu of switches again
— EVERY SWITCH A COMMISSIONER HAS, one row per question, WHICH GAME
doubling as the demo switch — exactly as it did before v0.420.0 put the
mascot in its place. MascotBuilder, core's mascot.ts, the four cut-out
bodies and the art brief in public/mascot/README.md all stay in the tree,
unmounted, for when the stickers exist; check:mascot still pins the data.
The v0.421.0 squash also carried the Android widget, so this is a
targeted restore of the landing hunk rather than a git revert. The
unmounted builder also learns the blueprint's OUT list, so root tsc is
clean again.

Battery: root tsc, check:parity, vite build.

### v0.432.1 — the AI late-swaps: the fill walks the live week, and the injury poll ramps into kickoff

Founder: "Steelers is on AI control. Are they going to move Jacobs to the
bench?" (Jacobs ruled Out, in RB2, 0.0, Sunday 1:00.) Then: "make that
change and merge it. We need AI to make optimal line up moves regularly
throughout the day and with increasing frequency before games and during
Sundays."

THE ANSWER WAS NO. The lock-time fill re-plans an agent or 🤖 auto-pilot
seat every tick — but only on matchups still `scheduled`, and a week's
matchup goes `live` at the first kickoff, Thursday night. A back ruled Out
on Saturday was never seen. A human could late-swap him (the seal is per
player, 0178); the AI had nobody to.

THE FILL WALKS THE LIVE WEEK. `autoSlotClassicLineups` reads scheduled AND
live matchups. On a live matchup only the seats the worker manages act —
a human's seat is filled at lock and then left to the human — and two
rails keep the move exactly what a human is allowed:
  • a stored player whose game has started STANDS, sealed or not. The
    seal (sealDueClassicPicks) runs after this fill in the same tick, and
    a player benched in the seconds between would forfeit points he scored;
  • a player whose game has started is never newly seated — the trigger
    (classic_player_kickoff) refuses a manager that, and the worker must
    not do what a manager cannot.
"Started" is the seal's own rule: his team's kickoff off the tick's slate,
the week's first when he cannot be placed. So Jacobs leaves RB2 at the
next tick after his Out lands, as long as the Packers have not kicked off,
and the best body whose game is still ahead takes the spot.

THE POLL RAMPS INTO KICKOFF. The fill already re-plans every 25-second
tick; what it re-plans FROM is the injury poll, and that was hourly on a
game day — inactives drop about ninety minutes out, so a scratch could ride
past his own kickoff unseen. `injuryPollEvery`: inside two hours of the
NEXT kickoff, every ten minutes; inside forty-five, every three; keyed on
the next kickoff rather than "a game is on", so the late window's
inactives are caught while the early games play. Four env knobs
(INJURY_RAMP_MS, INJURY_POLL_MS_RAMP, INJURY_RAMP_NEAR_MS,
INJURY_POLL_MS_NEAR), defaults 2h / 10m / 45m / 3m.

Also: the web typecheck was red on main since v0.432.0 — `BlueprintRules`
gained `outTags` and the mascot builder's literal did not. One field added.

Battery: web tsc, node --check on the worker, check:changelog — green.
Worker + web; no migration.

### v0.432.0 — two injured shelves: OUT and IR

Founder: "You know what would be cool? If we could have two types of IR spots
just like the league: Out and IR. Commish can pick the type of injury type
qualifies for each."

THE SECOND SHELF (0307). The NFL keeps two: injured reserve for the long stay,
the weekly OUT for a man who misses a Sunday. The game had one (0164 'ir',
with the commissioner's list of qualifying designations since 0198). OUT is
now a full sibling rather than a flag on IR: native_roster.spot gains 'out'
(a stashed player, never a starter — everything that reads `spot <> 'active'`
needs nothing); roster_shape gains `out`, a count beside bench/taxi/IR that,
like IR since 0193/0296, is not a draft round (extra room, added or removed
after the draft, in draft.stash_slots with IR); settings_json.out.tags is the
OUT list — league_out_tags() reads it, O/D by default, set_out_rules sets it
with the report's vocabulary and nothing else. IR's default (IR/O) is
untouched, so no league moves; a commissioner who opens OUT will usually
narrow IR to IR alone. set_roster_spot takes 'out' with OUT's cap and OUT's
list — a player can be right for one shelf and wrong for the other, and the
refusal names the list either way; roster_rules carries out_tags. The shape
setter grows a fifth argument; the four-argument form stays for older builds
and leaves OUT where it is.

BOTH HOSTS. MY TEAM draws OUT places under IR (empties included), fills them
from the same picker with the greying that names OUT's list, and sends a
player back to active from either shelf. ⚑ COMMISH → ROSTER gets an OUT box
beside IR and, once it is above zero, an OUT ELIGIBILITY row (IR / OUT /
DOUBTFUL / QUESTIONABLE) beside IR's; ROSTER = / DRAFT = subtract both
shelves. The classic boards' injured-shelf marking covers OUT; the admin's
roster counts say "· 2 OUT". The seat wire's IR housekeeping (v0.426.0)
stashes onto IR first and OUT second, and brings a player back from whichever
shelf he no longer qualifies for. The league blueprint copies the OUT list
with the IR list.

Probes: out-spot-probes (wired): the shape takes OUT and the 4-arg setter
leaves it; stash_slots counts both; OUT defaults O/D and its list moves
without touching IR's; an Out player fits OUT and not IR-only, an IR player
fits IR and not OUT, a healthy player fits neither; OUT's own cap; after the
draft OUT grows and a shelf someone stands on cannot be removed; roster_rules
carries both lists. ir-after-draft's shape assertions carry the new key.
Battery: scratch probes, web tsc, mobile tsc, check:parity, vite build,
server tests — green. Migration 0307; both hosts; the APK ships itself.

### v0.431.2 — browse-as sees their team

Founder: "I need to check if Mooney can put a player in IR. If I use the
view as admin feature, it's still viewing my team as me instead of viewing
Mooney's team as Mooney."

The 0125 regression, one screen over. Browse-as (0108/0109/0149) reads the
VIEWED user's data through admin-gated twins wherever a player-path RPC keys
on auth.uid(). MY TEAM's whole desk — the roster with its IR/taxi places,
FAAB, claims, the header's name and crest — comes from native_team_state,
which keys on auth.uid() and had no twin; so "BROWSING AS mooney" drew the
banner and then the ADMIN's own seat in that league ("dachhack"). 0306 moves
the body verbatim into _native_team_state_for(league, uid, commish) and
gives it two callers: native_team_state (unchanged for a manager: same gate,
same is_commish) and admin_user_native_team_state(user, league) — admin-only,
the viewed user's seat, is_commish as THEY would see it. The web's MY TEAM
(TeamManage) and the draft desk read the twin under browse-as, skip the
process_waivers nudge, hide the name editor, and refuse every write with
the read-only line every other browse-as screen uses — set_roster_spot from
a browsing admin would have moved the ADMIN's own player. Now the IR
eligibility Mooney sees is exactly what the founder sees browsing as
Mooney. Probes: browse-as-team-probes (wired) — c sees c, the commissioner
still reads as commissioner, non-admin refused, the admin browsing as c gets
c's roster/name/is_commish, browsing as the commissioner reads as
commissioner, null user refused, the admin's own read unchanged.

Battery: scratch probes, web tsc, check:changelog, vite build — green.
Migration 0306; web only.

### v0.431.1 — the commissioner stashes anyone

Founder: "I need an option as a commissioner to move players in team
lineups. For example move a player to IR or to taxi."

The server has allowed it since 0164 — set_roster_spot answers to the
seat's owner, the commissioner or an admin, and the commissioner is even
exempt from the taxi lock. What was missing was a door: the team screen's
seat selector (v0.424.0) takes the card's controls off for a rival's
roster. For the commissioner they now stay on: the IR and TX badges send a
player back to active, the empty places open the picker, and the picker
lists THAT team's active roster with the same eligibility greying (the IR
tag list, the taxi tenure ceiling). The card says so in one line under the
team name, and the picker's title names the team. Both hosts. Same RPC,
same rules; nothing changed on the server.

Battery: root + mobile tsc, check:parity, vite build. Web + APK.

### v0.431.0 — a played card leaves the hand for good, the app gets the matchup switcher, and Extra Slot is a card you play on a window

Founder, on the app, Sunday morning with Momentum armed: "If I used momentum
it shouldn't be in my hand anymore. It should show on the spots though." And:
"where is the matchup switcher so I can go directly to my other matchups?"
Then, on the first cut's DISARM buttons: "No disarming. If you use a power
up you can't take it back." And: "I don't see the extra slot I added."

THE HAND (app). An armed team buff stayed fanned in the hand, painted ARMED,
because the hand was the only place to disarm it — which read as the card
never having been played. Now the hand deals only what you own and have not
played; a second copy of an armed buff stays hidden too (it cannot be armed
twice this week). The played card shows in two places: on every spot it
applies to — the ⚡ chip now carries each power-up's ICON (📈) where it
carried a count ("1" said something was here, not what) — and in a new
◈ ARMED strip under the week line, by name, which also catches a buff no
fielded spot answers yet (Momentum armed before a drip metric is picked).
Tap either for what it does. NO TAKE-BACKS: there is no disarm anywhere —
the app's hand loses its DISARM tip, the strip and the spot sheet only read,
and the web's ◈ ACTIVE stops offering REMOVE on an armed buff (it reads IN
PLAY). The game's own position auto-refund (a buff whose only eligible
starter was benched) is a correction, not a take-back, and stays. Web
parity otherwise: an armed team buff leaves the web hand as well; it was
already in ◈ ACTIVE and named on its spots.

THE SWITCHER (app). The web board has had "Your matchups" since v0.388.0
(v0.418.1 on a phone); the app never did — the only way between your
leagues was back out to My Leagues. On the drip board's week line the
pairing ("Humans vs Robots ▾") now opens the same sheet: your other seats,
OPEN → hands the seat to the shell, which opens that league on its matchup
(commissioner status looked up on the way so the ⚑ door still hangs off it).
Read from my_teams when the sheet opens, not on the board's hot path.

THE EXTRA SLOT (0305). Two halves that never met: buy_extra_slot (0027)
charges COIN and bumps applied_state.extra — the number enforce_slot_cap
reads — but nobody has called it since the shop started selling Extra Slot
as a CARD. The web played the card by writing its own hero_applied blob and
consuming it, so the board drew a slot the save then refused; the app had
no path at all — its hand offered the card with ARM, which filed
'extra-slot' into the buff list (nothing reads it) and ate the card. That is
the slot the founder could not see. apply_extra_slot(matchup, window) is
the one path now: before the week's first lock (scope 1, 0260), consume one
owned card (0256 model, practice purse on a practice week, row locked),
refuse past extra_slot_cap(), then record it where each reader looks —
applied_state.extra (the cap, the AI fill), applied_state.extraSlots {win:n}
(the app, through my_targeted's row) and hero_applied.extraSlots (the web
board's blob). The app's Extra Slot card now ARMs into a window chooser and
the board widens on ok; the web's tap-a-window apply goes through the RPC
and records locally only on ok (a refusal is loud). Any other AIMED card in
the app's hand (Rivalry, Double or Nothing, Jinx…) had the same ARM bug —
it is not ARMable there now and says "play it on the web for now"; a
phantom targeted id already in a seat's buff list is not shown as ARMED.
Probes: extra-slot-card-probes (wired): the card consumes once and lands in
all three records, stacks a window to +2, the cap refuses a third without
consuming, no card → not owned, outsider → forbidden, a slate that lacks the
window refuses it, the started week refuses, and THE POINT — ten picks save
with two extras played where an eleventh is refused.

Battery: scratch probes, mobile tsc, web tsc, check:changelog, vite build —
green. Migration 0305. The APK ships itself.

### v0.430.2 — in golf a zero banks the fill, and best-ball spots carry one

Founder: "I guess best ball in golf should slot 0 players over players
with more than 10 points."

That sentence is only true if the spot BANKS 10 for a zero — the zero-fill
rule — and two things stood in its way.

THE RULE COULD NOT SIT ON A BEST-BALL SPOT. Refused since v0.303.0 ("it
fills itself, so it is never unfilled"): true of the unfilled half of the
rule, blind to the other half — whoever the fill seats can still score
nothing, and in golf that zero was the best score on the board with no
price on it. 0304 drops the refusal (0201's setter verbatim minus four
lines); classicSlotsFromSpec keeps the rule on a best-ball spot; the
resolver and the board already paid it there (they walk every slot); both
commissioner consoles open the ⛳ field on best-ball spots.

A ZERO WAS AN ABSENCE, NOT A PRICE. v0.429.0's expected golf score
(P + p·Z) priced a man who MIGHT blank, and still returned 0 for a man who
certainly will — ruled out, on bye, projected at nothing — which golfValue
files behind everyone. That is the p = 1 limit of the same formula: he is
worth Z. slateAwareProj now says so in golf (0 on the row and outside
golf), bestballFillBy says so for the LIVE points the resolver ranks by
(zeroFill against the spot's own rule, golf only), and the boards' live-
week fill values a man yet to play by the FILL's number rather than the
row's, which had quietly dropped golf's expected score from the mid-week
ranking. With a 10-point fill a zero beats a 12 and loses to an 8; without
a fill a zero is still a zero.

check-golf: the spec keeps the rule on a best-ball spot; the fill in golf
seats the zero over a twelve and the eight over the zero; no fill → the
zero never fills; outside golf nothing changes; ruled out / bye / no
projection each worth the fill through slateAwareProj, 0 on the row.

Battery: root + mobile tsc, check:parity, vite build. Web + APK +
migration 0304.

### v0.430.1 — the audit counts a bought slot

Founder, reading the week's audit: "I think I added a slot in one of my drip
leagues but they both say x/9 slots filled."

0302 judged every drip seat against the league's base count — the week's
windows, never fewer than eight. A drip league has no league-wide way to add
a slot; a seat adds one by BUYING it (0027 buy_extra_slot), which lands in
that seat's applied_state.payload_json.extra for that matchup, and
enforce_slot_cap has always allowed exactly base + extra. 0303 redefines
admin_week_audit so a seat's expected is the base plus its own extras on its
matchup: a bought-and-filled slot reads 10/10, one left empty 9/10 with one
EMPTY — instead of 10/9 and 9/9. Classic leagues untouched (their spot list
is the cap; no extras exist there). The panel's seat rows now read each
seat's own `lineup.expected` rather than the league average it had been
dividing out. Probes: the human seat buys a slot (applied_state extra 1) and
is judged against nine while its neighbours stay at eight; the league's
expected and empty roll-ups move with it. Battery green. Migration 0303; web.

### v0.430.0 — the weekly matchup audit

Founder: "Let's create a weekly audit of matchups for me. I'd love to know
how active each team and league is. What moves were from the computer vs
player vs AI players. Were slots left empty or out players started. What
waiver pickups were player vs AI. Etc"

ONE READ, NOTHING NEW WRITTEN. `admin_week_audit(week, season)` (0302) reads
the week from rows the game already keeps. The distinction the founder is
asking for has been recorded since 0001: every sealed_pick write is audited
with `actor = auth.uid()` — a person's uid from a browser, NULL from the
worker — and league_txn (0186) carries the same `actor`. So a fielded slot's
SOURCE is: **player** (a human on that seat wrote the player who is in it),
**admin** (another human did — commish/admin tools), **auto** (the computer:
the lock-time fill on a human-held seat, or the resolve-time fallback),
**agent** (the auto-managed unclaimed seat, 0180), or **ai** (a 🤖 seat's
resolver lineup, or an auto-pilot manager's rows). What counts as fielded is
the seat's sealed rows UNION what matchup_state.slot_scores says scored for
that side — the union is what makes an AI seat with no account (whose lineup
is never stored) visible at all. Moves read the same way; a NULL actor on a
HELD seat is the waiver run processing that manager's own claim (0213/0298
never let the worker file for a held seat), and on an agent/AI seat it is the
wire. Waiver claims carry no actor, so a claim's source is whose seat it is.

EMPTY / OUT / BYE. Expected slots per seat are enforce_slot_cap's own rule
(0163): a classic league's spot list, a drip week's week_slot_count; empty is
expected minus fielded, floored at zero. "OUT started" is a fielded player
whose injury_status is O/IR now (the payload carries `injury_as_of`); "bye
started" is a fielded player whose league_pool team is absent from the week's
nfl_slate — a league with no pool row for him is not judged rather than
guessed. Each is named with the source that started him, which is the
question behind the question: the fill never fields a ruled-out player
(v0.341.2), so an OUT starter is a human's call or a post-lock ruling.

THE WINDOW for activity (lineup edits, moves, claims, chat, shop spend) runs
from five hours after the previous week's last kickoff to five hours after
this week's; a season with no slate falls back to lock_at −6d/+1d, and both
ends can be passed explicitly. Week null → the latest week with a stamped
final. A seat is ACTIVE when a human on it did any of those; bots are never
active and never idle. Core `data/weekAudit.ts` holds the shape and its
reading — the grade (ACTIVE / SET & FORGET / IDLE / BOT / OPEN), the source
line, the human share, a text rendering — so the admin panel, the worker's
`cli.js audit [wk] [season] [--json]` and the check say the same thing.

WHERE IT LIVES. Super admin → SYSTEM → **WEEKLY MATCHUP AUDIT**, right under
health: week stepper, the headline ("week 3 · 4 leagues · 21 of 40 humans
active · 58% player-set · 5 empty · 1 OUT started"), eight tiles, then a
card per league (its one-liner, a source bar, seats/moves/claims) with one
compact row per seat — grade, result, source bar, fielded/expected and its
flags — that opens into the detail. Phone-first.

COST. audit_log had no way to find "the rows of THIS pick" (0058 indexed by
time only); a partial index on row_id for sealed_pick rows makes the per-slot
source an index probe. `concurrently`, as 0058 did.

Probes: week-audit-probes (wired; a fixture with a human, an AI, an agent and
an empty seat — each source lands in its own bucket, OUT and bye named, the
window gates activity, week defaults, the audit writes nothing).
check-week-audit pins the reading. Battery: scratch probes, web tsc, mobile
tsc, check:parity, vite build, server tests — green. Migration 0302; worker
CLI; web only otherwise (the app has no admin console).

### v0.429.1 — the resolver prices a Q too

Founder: "Let's fix the resolver so a Q is priced at resolve too."

v0.429.0 left one seam: the unmanaged seat's lineup is computed at resolve
from `ClassicSide.ruledOut`, a boolean set, so a questionable or doubtful
player was priced at no risk there while the lock-time fill priced him.
`ClassicSide` gains `playRisk` — the same predicate shape the fills use —
and `unmanagedStart` hands slateAwareProj "ruled out → out, else the risk".
The resolver reads injury_status beside the ruled-out set (one read, only
when a side looks unmanaged, as before) and passes `playRisk` over it. A
normal league is untouched: a risk short of 1 is full value outside golf.

check-golf 45 → 49: an unmanaged golf seat fields the usage back over the
scratch; with the usage back DOUBTFUL the resolver fields the scratch;
ruled out still means out whatever the risk says; outside golf a doubtful
starter still starts.

Battery: web tsc, mobile tsc, check:golf, check:changelog — green. Worker
only; no migration.

### v0.429.0 — golf: the floor above zero

Founder: "How about golf? Players need to get close to zero without
actually getting zero. Is there a way we can get the AI to pick those
players? A lot of players with like 3 points projected will actually get
zero so it takes a lot of logic to decide who to play that probably has a
floor above zero."

WHAT THE FILLS DID. Golf inverts "best" (v0.303.0): optimalLineup, the
best-ball fill and the unmanaged seat seated the LOWEST projection above
zero. That is exactly the 1-to-3-point body who most often posts nothing —
and a blank takes the spot's zero-fill (usually 10), the worst thing that
can happen to it. The projection is the wrong number; the chance of a blank
is the number.

THE MODEL (core `golfFloor.ts`), fitted rather than guessed. A week is a
blank when a player touches the ball zero times; if touches arrive at a
weekly rate λ the chance is e^(−λ). Checked against 2025 game logs
(StatHead: every WR weeks 1–6, every RB weeks 1–4, 1,135 player-weeks),
binned by each player's mean receptions + carries per week — observed
blank rates .87 / .48 / .31 / .21 / .07 / .05 / .02 / .01 against e^(−λ)
.88 / .49 / .30 / .19 / .09 / .03 / .01 / .00. A least-squares fit gives
c = 1.02 and a floor of 0.01 (the healthy scratch): the Poisson rate IS the
model, and the rate comes from the baked season line (projStats2026:
receptions, and carries read off rushing yards at 4.3 a carry, over 17
games). Quarterbacks count ten attempts as a unit; kickers and defences sit
at 3% and 2%; a player the bake has no line for is priced off his
projection at 2.2 points a touch.

THE EXPECTED GOLF SCORE. The projection is the mean over games played, so
with p the blank chance and Z the zero-fill, the spot expects P + p·Z. A
designation folds in as a chance r of not playing at all: P·(1−r) +
(r + (1−r)·p)·Z. Q (one in five) and D (three in four) are not benched by
rule — v0.252.0's reason stands in a normal league — they are PRICED,
which is the difference golf makes. From the bake: Jacob Saylors, 0.1
projected on a quarter-touch a week, expects 7.7 against a 10 zero-fill;
Kaleb Johnson, 4.2 projected on 3.6 touches, expects 4.6. The fill now
takes Johnson.

WHERE IT LIVES. `slateAwareProj` — the one value every fill ranks by —
returns the expected golf score when golf is on (the projection otherwise,
and always outside golf), reading the spot's zero_pts when it has the spot
and the league's typical zero-fill otherwise: `setLeagueGolf(on, zeroPts)`
now carries it, `leagueGolfZeroPtsOf(mode)` reads the largest zero_pts on
any spot, and every install site (lock-time fill, seat wire, bite sweep,
resolver, both boards) passes it. Its ruled-out predicate may now answer a
FRACTION — the play risk — which the worker reads off injury_status
(`playRisk`) and the boards off the live report; a fraction changes nothing
outside golf. The row on the board still prints the projection (`expected:
false`), never the expected score: the fill's number is the fill's.

Not in this cut: the resolver's unmanaged-seat lineup still passes a
boolean ruled-out set, so at resolve a Q is priced at no risk; the lock-time
fill, which sets the lineup that actually stands, prices it.

Assertions: check-golf 24 → 45 — the curve as fitted, the bake's touch rate,
the quarter-touch back blanking three in four and the 3.6-touch back one in
twenty-five, the expected scores either side of a 10 zero-fill, no zero-fill
→ the projection, Q/D/O/IR risks, a Q raising the expected score by the
arithmetic, the install carrying the zero-fill, the fill ranking the usage
back over the scratch, the board's raw number, a fractional risk priced in
golf and simply out at 1, and nothing changing outside golf.

Battery: web tsc, mobile tsc, check:golf, check:seatwire, check:faab,
check:bite, check:changelog — green. Worker + web + APK; no migration.

### v0.428.1 — the dash is for IR, not the taxi squad

Founder: "Taxi spot players should still get a projection. They could
score this week. IR guys are not going to play so no points."

v0.427.1 blanked the pre-game number on the whole TAXI / IR card, because
the board had only ever known "stashed" — one set for both places. It now
also knows which of them are on IR: a taxi row keeps its projection (he
can be activated and play), an IR row prints the dash, and the row's badge
says TX or IR instead of IR for both. Both hosts.

Battery: root + mobile tsc, check:parity, vite build. Web + APK.

### v0.428.0 — the AI bids against the room: FAAB pricing for the frenzy, and the blade skips practice

Founder: "How about guillotine leagues? Any AI interactions we need for
those? Waiver wire can be a frenzy. We need a good way for AIs to make FAAB
bids with competitive valuations without over bidding as much as possible."

THE AUDIT. A guillotine league needs nothing new of the AI beyond what it
already does — its lineup is set to survive the chop, a chopped seat is shut
off the wire (0272; the sweep asks once and moves on), there is no steal.
What it needed was a BID. The old one (v0.338.0 wireBid) was $3 a point of
THIS WEEK'S lineup gain, capped at a quarter of what was left: fine for a
streamer, hopeless in a frenzy, where the chopped roster lands whole and a
top-12 back goes for half a budget. Worse, the upgrade bar was this week's
gain alone, so a chopped star on his bye added nothing on Sunday and was
passed over for a streamer with a game. And it never looked at the room.

THE PRICE (core `faabMarket`, pure, check:faab), in three parts:
  1. THE MARKET SHARE. What share of a rival's remaining budget a player
     commands, saturating in his SURPLUS — rest-of-season value over the
     best FREE body at his position, since a player anyone can sign for
     nothing is worth nothing on the wire. Half the ceiling at 6 points a
     week, never above 60%: nobody bids it all.
  2. THE ROOM. The expected top rival bid is that share of the rivals'
     money, leaning toward the deepest pocket (the one bidder who can pay
     sets the price), CALIBRATED by the league's own resolved claims: the
     median of what winners actually paid against the curve, clamped to
     0.5–2× so one wild bid does not reprice the season, and trusted only
     from three samples. A league that overpays teaches the AI to pay; a
     thrifty league teaches it not to. Lost bids never calibrate.
  3. THE CEILING. His worth to THIS roster — the share for his rest-of-
     season lineup gain, of the budget left, less a 15% reserve while more
     than three weeks remain (the next chop brings the next star). The bid
     is the expected top rival plus 5% (at least $1), never above the
     ceiling: just enough to win at the price the room has set. A HOLE this
     week still floors at $3 a point so an injury is answered in a quiet
     room; an upgrade in a quiet room bids the minimum.

THE PLANNER (seatWaivers). The upgrade bar is met by EITHER this week's
gain or the rest-of-season lineup gain, and a claim is ranked by the larger,
so the frenzy's prize is the first claim. A free agent costs nothing to
sign; only a held player is priced. Each claim is priced from the running
budget, so a sweep's claims never sum past it.

THE SWEEP. Once per league it reads the room: every living seat's FAAB (a
chopped seat cannot bid), the weeks still to come, the last 200 resolved
claims re-priced at today's surplus against the league's starting budget.
While the wire is DEEP — three or more held players worth two points over
replacement, which is what a chop looks like — a seat may hold four claims
out instead of two: one bid on the star and one consolation is not a bid in
a frenzy.

THE BLADE SKIPS PRACTICE (0301). The same hole 0297 closed for the vampire:
guillotine_tick's last final week was `max(week)` with no practice filter,
so a finaled practice week with a clear loser was a week the blade could
drop on. Practice results are throwaway; nobody loses a season to one.

Assertions: check-faab-market (31): the share curve's shape, richer and
deeper-pocketed rivals raising the price, calibration from three winners
and its clamps, lost bids and no-surplus claims ignored, the bid just over
the room and never above the ceiling or the balance, the reserve spent in
the last weeks, the hole floor in a quiet room, the league's own prices
moving the bid both ways, and through the planner the bye-week star taken
first, priced over the room and under his worth, claims within budget.
check-seat-waivers 55. chopping-block-probes: the practice blade — no
elimination on a finaled practice week, the regular week still chops.

Battery: web tsc, mobile tsc, check:faab, check:seatwire, check:bite,
check:changelog; scratch DB through 0301: format, chopping-block,
block-history, guillotine-weeks — green.

### v0.427.1 — a live week's best-ball fill ranks by projected final, and IR rows drop their projection

Founder, Saturday evening: "I was able to put Tate in but the game swapped
in Washington into the bestball spot despite Sadiq having a higher
projection. Also, Stribling is on IR and has a projection."

THE FILL. Both boards switched the best-ball fill the moment the week's
first game kicked off: before it, bestballFillBy ranked by the projection;
after it, bestballFill ranked by LIVE points. On a Saturday after the
Thursday game that made every man whose game was still to come worth
exactly 0 — Kittle 14.3, Sadiq 12.4, Skattebo 13.8 all tied at nothing —
and the assignment fell to roster order, which is how a 3.2 running back
took the spot. (Before Tate moved out, Tate had been first in that order;
the same bug had been quietly picking him.) The engine was never wrong
about the maths — it was handed the wrong number. The fill now ranks by
the board's own projected final (projectEntry): a finished man is his
points, a man yet to play is his projection, a man on the field the blend.
At the end of the week that is the live score the resolver ranks by, so
the two agree where it counts and the board is honest every day before.
The `effective` memo moved below `entryFor` to reach it. check:board pins
the live-only failure and the projected-final fix (five assertions).

IR ROWS print a dash for the pre-game number on both hosts: a stashed
player cannot score for this side, so a projection there read as a claim
on the total. Live points still print — those are facts about the game.

Battery: root + mobile tsc, check:parity (37 suites), vite build. Web + APK.

### v0.427.0 — the bot vampire bites

Founder: "Let's have the bot vampire take a bite."

The steal was always the vampire's own claim to make — the app's 🩸 card —
so a vampire seat nobody manages (a 🤖 AI seat, or an unclaimed seat tended
by its agent) won its matchups and never fed: a vampire league without a
vampire. v0.425.0 let such a seat work the wire; this lets it bite.

0300. `vampire_steal` gains the wire's worker branch — `auth.uid() is null
and agent_wire_seat(league, seat)`, the service role for a seat nobody
holds, the seat named by p_vampire — and `vampire_state` admits the service
role so the sweep reads the same window the app shows. Every 0297 rule is
intact and binds the bot: the latest fully-final REGULAR week, a win (a tie
is not one), one bite per win, the beaten team's active roster, one of its
own back, the 1-for-1 shape check both ways, and the commissioner's
steal_review parking the bite as pending. A vampire a human holds — on
auto-pilot or not — keeps the bite as their own.

THE JUDGEMENT (core `vampireBitePlan`, pure, check:bite). A bite is a
season-long acquisition, so it is judged by rest-of-season value (the
season projection under the league's catalog, zero for a season-ending
IR), never by this week's slate — a star on his bye is exactly who a
vampire should take. Pairs are ranked by what the bite adds to the best
lineup the vampire can field, then by the raw asset swing (take − give);
one hard rail: NEVER give back a player worth more for the season than
the one taken — a reward is never a downgrade, and such pairs are not
offered at all. A player worth nothing for the season is never taken.
The give-back comes from the ACTIVE roster only, mirroring the rule that
the victim's stash is off the menu.

THE SWEEP (`server/src/vampireBite.js`, on the hourly seat-wire slot — a
win is fresh for a week, and an hour after the finals is soon enough).
Vampire leagues → the seats the settings name → the ones nobody manages
(no human at the seat; 🤖 controller or an agent row) → the commissioner's
"seats nobody manages may transact" switch (0213; a bite moves two players,
it is a transaction) → the window → the two active rosters → the ranked
pairs, offered to the RPC in order until one is accepted. A refusal the
plan cannot see (a position cap, a stash, a roster that moved) tries the
next pair; a refusal about the window itself stops. Push already tells
both sides of a bite (0273), so the victim hears the same way as from a
human vampire.

Assertions: check-vampire-bite (13): the stud taken for the cheapest bench
body, the gain as the lineup delta, no bite when nothing beats what we
have, the flex give-back that lifts the lineup over the RB2 that doesn't,
the bye-week star taken, IR and unpriced players never taken, a
bench-for-bench bite on swing, the bounded and order-independent list.
vampire-rules-probes vr7: the worker reads the window, bites for the 🤖
vampire, is bound by one-bite-per-win and by naming a real vampire seat,
is refused for a human-controlled unagented seat until an agent row
exists, and is refused for a vampire a human holds on auto-pilot.

Battery: web tsc, mobile tsc, check:bite, check:seatwire, check:changelog;
scratch DB through 0300: vampire-rules — green.
### v0.426.1 — a best-ball occupant can be started anywhere he's eligible

Founder: "Carnell Tate was slotted in my rookie bestball spot and I can't
move him into my WR spot. It should be the best ball spots pull from bench
spots and you can slot anyone eligible for a best ball spot in one of your
non bestball spots. They would be ineligible for the best ball calculation
if they were slotted in a starting spot."

That is exactly the rule the engine already ran — bestballFillBy excludes
every manual starter and fills from what is left — and the PICKER broke it
one step earlier. It builds "where is this player starting" from the
EFFECTIVE lineup, fills included, and then drops anyone whose current spot
can't be edited so a locked starter is never offered a move the DB would
refuse. A best-ball spot is never editable, so a player the fill had parked
there was filtered out of every picker on the board: Tate could not be
chosen for WR 1 at all. And had he got through, planSpotMove would have
written a "vacating" row into the best-ball spot — a spot that ignores rows
(0159).

Both hosts' pickers now let a best-ball occupant through (the fill simply
picks someone else once he starts manually), and planSpotMove takes the
best-ball list and treats such a spot as no "from": one write, like the
bench. check:spots pins the plan and the recompute (a rookie started
manually in WR leaves the rookie best-ball spot to the next rookie).

Battery: root + mobile tsc, check:parity (37 suites), vite build. Web + APK.


### v0.426.0 — the AI manager: lineups it revisits, IR it uses, drops it judges by the season

Founder: "This AI team has AJ Brown in despite him on IR. Can the AI teams
set ideal line ups based on projections and injury status? Also put players
in IR? Make FAAB waiver claims and free agency adds? Do we have a good
projections logic for deciding those pick ups would help the team? Like if
the team doesn't have a WR to fill a spot or is light on RBs, the AI
controlled team will make a waiver move (and not drop players that have
more value or score well rest of season)."

THE HONEST AUDIT, question by question, before the fixes:

  • Lineups. An AI seat with NO account has its best healthy lineup computed
    live by the board and the resolver (classicLineup's unmanagedStart,
    O/IR benched since v0.252.0). A human seat FLIPPED to 🤖 (0022) still
    has an account, so the lock-time fill took it for a managed human: rows
    are decisions, filled once, never revisited. AJ Brown went into the flex
    while healthy and stayed there through IR because the one manager who
    could have moved him had handed the team to the AI. Fixed.
  • IR. Nobody the worker acts for could stash: set_roster_spot admitted
    the owner, the commissioner and an admin. Fixed (0299).
  • FAAB claims and free-agent adds. Yes since v0.338.0 for unclaimed
    seats and since v0.425.0 for AI seats — the same two RPCs a manager
    calls, bids proportional to gain and capped at a quarter of what is
    left.
  • The judgement. Holes (a spot nobody legal or nobody scoring is in) on
    any gain, upgrades only past 2 points a week, never a starter dropped —
    all sound. But the DROP was chosen by THIS WEEK'S value, which zeroes a
    bye and a one-game Out: a benched star on his bye was the cheapest body
    on the roster and the first man overboard. Fixed. "Light on RBs" was
    not a consideration at all. Fixed.

THE LINEUP (lock.js). A seat whose controller is 'ai' and has an account is
re-planned like an agent seat: its unlocked rows are the worker's own
answer, rewritten at the current values every tick — a player ruled Out or
IR on Friday drops from Sunday's spots as a careful human would drop him —
and only LOCKED rows stand. The rows still live under the manager's uid, so
the board reads them as before and a flip back to 'human' hands over a
lineup already set. An AI seat with no account is unchanged: it has nowhere
to store rows, and its computed lineup already benches O/IR.

IR (0299 + the sweep). set_roster_spot gains 0213's worker branch —
`auth.uid() is null and agent_wire_seat(league, seat)` — with every 0198
rule intact: the league's own IR list, the cap, the taxi tenure ceiling and
lock, the active count on the way back. Before it plans, the sweep stashes
any active player whose designation is on the league's list (league_ir_tags,
default IR/O) while an IR place is open, and brings back a player on IR
whose designation has cleared while an active place is open. Freeing the
seat is what lets the replacement be signed without a drop. The new
`injuryStatusMap` in injuries.js tells IR from O; ruledOutSlugs still lumps
them for "cannot play this week".

THE JUDGEMENT (core planner, pure). `rosValueOf` — the season projection
under the league's catalog, untouched by this week's bye or a one-game Out,
zero for a season-ending IR — decides every drop: bench bodies are spent
cheapest-for-the-season first, and NO claim drops a player worth more for
the rest of the year than the one it adds. A streamer who fills this
week's hole is still a streamer; if every bench body is worth more for the
season, the hole stays open this week rather than costing the year (an open
seat takes him with no drop). Depth adds go WHERE THE ROSTER IS THIN:
`positionNeed` counts bodies beyond the dedicated starting spots (flex
spots count against nobody; a position no spot accepts is never taken),
the thinnest position is filled first, the best season body within it. The
shortlist ranks by the season too, so a bye-week starter is still on the
list for a depth add while this week's value still decides a hole.

THE NUMBER ON THE ROW (both boards). Founder, next: "AJ Brown is on IR, how
does he have a projection?" Because the bake is a season per-game number
and the row printed it raw: `projectedPoints` never asks about injuries or
byes, so a man on IR read 13.7, was summed into the side's projected total
and moved the win chance — while the board's own fill value (slateAwareProj
with the O/IR predicate, v0.252.0) had already valued him at 0 to decide
who starts. The row now prints the value it is filled by: O/IR and a proven
bye read 0.0; Q and D keep their number, as they keep their spot. One line
on each board; the entry memo already re-ran when the live report landed.

Assertions: check-seat-waivers 45 → 55 — the bye-week star no longer the
first overboard, the hole filled with the cheapest season body, the hole
left open rather than dropping a better player, the open seat taking him
free, the IR body spent first, the starting rail untouched, positionNeed's
arithmetic, light-on-RBs taking the back over the better receiver, and a
no-spot position never taken. agent-wire-probes section 10: the worker
stashes a bot's ruled-out player, a questionable player is refused by the
league's list, another manager's player is not the worker's to move, the
freed place takes a signing without a drop, a healed player stays until an
active place opens, and the seat handed back closes the branch.

Battery: web tsc, mobile tsc, check:seatwire, check:changelog; scratch DB
(every migration through 0299): native-league, taxi-ir, seat-agent,
agent-wire, ir-eligibility, ir-after-draft, vampire-rules, vampire-coven,
format — green.

### v0.425.0 — practice weeks are not fresh blood, and the AI works the wire

Founder: "Looks like the vampire lost but took Amon-Ra. Should have not been
able to take a player. It's essential that the AI makes waiver moves in the
vampire league. How is our AI team waiver system?"

TWO ANSWERS, ONE VERSION. The bite and the wire were separate holes.

THE BITE (0297). `vampire_steal` refuses a loss outright — the founder's
instinct was right that a losing vampire cannot feed — so the question was
which result the window READ. "The latest fully-final week" was `max(week)`
over the league's matchups, and nothing excluded the PRESEASON PRACTICE
weeks (0110: board weeks 101-103). A league that played its practice weeks
carries final rows at 101+ for the rest of the season, so `max(week)`
answered 103 forever: week 1 finaling changed nothing, because 1 < 103. A
vampire that won practice week 103 kept its window open on that win through
a real week-1 loss, naming the practice-week opponent as the victim.
`league_standings` (0269) already skipped practice weeks; the vampire, its
state and its record did not. One filter — `not is_practice_week(week)` —
in the window (vampire_steal, vampire_state) and in the chair's record and
week list (_vampire_seat_state). Bodies are 0268's re-read, only the filter
added. The guillotine's `guillotine_tick` has the same `max(week)` and the
same exposure; noted, left for its own change. A bite already executed on a
practice win is not unwound here — the register printed it, and putting the
player back is the commissioner's call (a trade or commish move does it).
New `scripts/db/vampire-bite-diag.sql` (read-only) says which of four
shapes a given bite was: the practice-week window, finals rewritten under a
stamped sandbox week (admin_stamp_week then the resolver), a plain pool add
by a vampire that never drafted (0268 lets it), or another vampire in a
coven.

THE WIRE (0298 + worker). The honest audit: there was no AI waiver system
for AI seats. `sweepSeatWire` (v0.338.0) walks seat_agent rows, and
`ensureSeatAgents` mints those only for UNCLAIMED seats whose controller is
'human' — a 🤖 seat is deliberately never agented, because its lineup is
composed at resolve by `aiSide` and an agent's sealed rows would override
that. The unmeasured cost: an AI seat had no agent row, so 0213's gate
refused the worker, so the sweep never asked. It drafted, it fielded a
lineup, and it never once touched the wire. In a vampire league that is the
worst possible seat to leave out — a bot vampire does not draft (0268), the
pool is its only cradle, and the one hand that could reach in was never
allowed to. It sat on an EMPTY roster.

  • `agent_wire_seat` (0298) now admits a seat when EITHER a seat_agent row
    exists OR controller = 'ai' — and app_user_id is null in both cases.
    0213's guarantee stays exactly where it was: a seat a human holds is
    never transacted over by the worker, including one the human flipped to
    🤖 auto-pilot (0022). Auto-pilot composes their lineup; their roster,
    their drops and their FAAB stay theirs. Same two RPCs, same guard shape,
    same commissioner switch (league_agent_waivers — its copy in both hosts
    now names AI teams), every rule still binding. Nothing forks.
  • The sweep walks AI seats nobody holds beside the agent seats, re-reads
    the membership row per league so a seat handed back mid-sweep is
    skipped, and asks `wire_block_reason` once per seat so a non-vampire
    under the wire lock (or a chopped guillotine seat) is not refused hourly
    in the log.
  • An EMPTY roster is no longer skipped — it is the most to do.
  • OPEN PLACES FILL. Adds into an open seat are immediate `add_free_agent`
    calls, not pending claims, so the sweep plans `room + open seats` and
    caps only the waiver claims at MAX_OUTSTANDING_CLAIMS. A claim it will
    not file abandons the REST of the plan rather than skipping over it —
    the plan is greedy and sequential, and a later drop assumes the earlier
    add landed. The next hourly sweep replans from the true state.
  • DEPTH, in the planner (core, pure): when the lineup wants nothing but a
    roster place is open, take the best FREE body that projects at all — no
    drop, no bid, free agents only (a held player is a claim to win and a
    priority to spend, and a bench body is worth neither). A full roster
    never reaches it, so the agent seats that drafted are untouched. Without
    it a bot vampire filled its starters and carried an empty bench into the
    byes, needing a fresh hole every week.
  • `shortlistWire` (core): the best 12 per position by projection before
    planning, in pool order. The planner solves a lineup per candidate per
    claim; an empty roster against a 2,000-player pool was tens of
    thousands of solves inside a 25-second tick.

What this does NOT do: a bot vampire still does not BITE — the steal stays
the vampire's own claim to make, and nothing in the worker declares one.
That is a separate decision (which player, which to give back, whether a
bot should feed at all) and is not assumed here.

Assertions: check-seat-waivers grew the empty-roster fill, the claim cap
over a fill, depth on a full lineup with one open place, depth refusing a
held player and a zero, and the shortlist's cut and order (29 → 45).
agent-wire-probes grew section 9: the AI branch of the gate without an
agent row, the idle human seat still refused, the worker signing into an
empty bot roster, a manager on auto-pilot keeping their roster, an outsider
unable to borrow the branch, the flag handed back closing the gate, and the
vampire wire lock binding a bot and admitting a bot vampire.
vampire-rules-probes grew vr6: a finaled practice week is no completed
week, a week-1 loss beneath it is what the window reads, the record and the
week list count the season only, and a real week-2 win still feeds.

Battery: web tsc, mobile tsc, check:seatwire, check:changelog, scratch-DB
agent-wire / vampire-rules / vampire-coven / format probes — green.
### v0.424.0 — every matchup in the league, and the roster with its injuries

Founder: "Let's have a way in web and app for players to see the matchup
view for all match ups in the league for every week. We have a week chip
that changes the week, let's also have a chip that goes to the next matchup
for that week. Let's also have current injury status in the team view and a
selector to see other teams in your league in this view."

▸ THE NEXT MATCHUP (classic boards, both hosts). Beside ‹ WEEK n › there is
now a `▸ 2/6` chip: one tap walks the week's ring — every pair in the
league, yours included — and the chip says where in it you are (`–/6` from
a bye, which also gets the chip). The board draws whatever seat it is
handed on the LEFT: `viewRid` replaces the `rosterId` prop everywhere the
loader, the poll and the side builder read it, so a rival pair renders
through the same code path. A browsed seat's lineup is read from the
league-readable classic picks (0178) keyed by the account in that seat
(`matchupTeams` now carries `user_id`), the poll splits revealed rows by
that account instead of by "me", and editing is off end to end — canEdit,
applyMove and the auto-slot-on-open all refuse while the seat isn't yours.
A "VIEWING X vs Y · ↩ MY MATCHUP" strip sits under the header; stepping
the week returns to your own pair. `weekMatchups(leagueId, week)` is the
one new read (same row, same RLS as leagueResults); the ring order lives in
core's `matchupBrowse.ts` and check:board pins it (ten assertions).

NOT IN THIS CUT: the DRIP board. Its picks are sealed to third parties by
design until… never — 0262's reveal opens a lineup to the OPPONENT at
kickoff, not to the league — and the web drip board runs off the sim store
with one fixed YOU. Browsing drip pairs needs a reveal policy decision and
a board refactor; it is a separate piece of work.

THE TEAM SCREEN (both hosts). Every roster row now wears the NFL report's
designation — O/D/Q/IR — off the same `injuryTags` sheet the IR gate has
read since 0198 (the web gets a status-taking `InjuryTag`; the boards' week-
keyed badge could not drop in). Above MY ROSTER, one chip per seat (MY TEAM
first, lit by default): tap a rival to read their roster laid out the same
way — starting-spot fit, bench, IR, taxi — from the rosters the screen
already held (nativeRosters is league-wide; no new read). The card says
whose it is and takes its controls off: no stash buttons, no empty-place
invitations, and `mine` stays MINE for the wire, trades, keepers and
contracts.

Battery: root + mobile tsc, check:parity (37 suites), vite build. Web + APK.

### v0.423.0 — IR spots after the draft, and the injury feed's new shape

Founder, week 2: "Michael Pittman is out. Can we make sure his injury
status is correct and that players can move him to IR in the classic
leagues?"

THE STATUS WAS RIGHT. ESPN's report has him O (foot, ruled out for Sunday,
designated 17:09Z Saturday); the worker's poll resolves "Michael Pittman
Jr." to `michael-pittman` (one man in the directory with that name, and
his espn id maps too), and O has been on the default IR list since 0164.
The poll runs hourly inside 24h of a kickoff, every three hours otherwise.
`scripts/db/pittman-ir-diag.sql` (dbquery.yml, read-only) prints his row,
the poll's freshness, and every league's IR shape, for anyone who wants to
see it rather than take my word.

WHAT WAS IN THE WAY: THE SHAPE. A classic league that drafted with no IR
spots had none — the team screen shows no IR place when the shape says
zero, and set_roster_spot would have said "IR is full — 0 spots" — and
set_league_roster_shape refused to add any once the draft had started.
That lock is right for the bench and the taxi squad (drafted rounds), and
wrong for IR: since 0193 an IR spot is not a round, it is extra room, so
adding one in September takes nothing from anyone.

0296: after the draft the setter takes the IR number and holds bench and
taxi where they are (the refusal for a bench or taxi tap says so, and says
IR still moves; a stale bench sent beside a real IR change is held, not
refused). A never-shaped league has its bench derived as rounds − starters
so its active seats (0199) do not move. draft.rounds moves by the IR delta,
because roster_illegal_reason still bounds holdings by it and a team that
stashes a player and signs his replacement holds one more than it drafted.
A spot someone is standing in cannot be removed. `ir-after-draft-probes.sql`
(scratch DB, 30 assertions) covers the failure as found, the add, the
stash, the signing into the freed seat, the legal roster at rounds + 1, the
guarded removal, and the never-shaped league. Both commissioner screens'
hint text says which numbers lock and which don't.

AND THE FEED HAD CHANGED UNDER US. ESPN's bulk injuries payload now carries
team entries as `{ id, displayName }` — no abbreviation — and athletes with
no `id`, so every designation reached the resolver as (name, null, '') and
the id-first / team-settled resolution (0200, v0.345.0) had quietly
degraded to the ranked-name guess for all 800 entries, with `team` stored
as '' on every row. The id is still in the player-card link and the team is
ESPN's numeric team id (the same 1..34 the roster poll enumerates): the
normalizer reads both back out (`athleteIdOf`, `teamAbbrOf`), verified
against all 32 names in today's feed; check:injuries pins the new shape,
the old shape, and the "nothing invented" case.

Battery: root + mobile tsc, check:parity (37 suites), vite build; scratch
DB: ir-after-draft, ir-eligibility, ir-rounds, roster-size pass. Web + APK
+ migration 0296.

### v0.422.1 — the widget paints first and fetches second

Founder, on the phone: "There's a lot of lag when you press the buttons.
Almost unusable."

WHY. A chip tap wakes a HEADLESS JS task — a cold JavaScript context when
the app isn't running — and that task made nine network reads (session,
enrollments, the open week's two queries, the matchup row, its state, team
names, the slate, the picks, the pool, the whole injury sheet) before it
drew a single pixel. ⇄ flip, which changes nothing but which half of the
same data is on top, paid the full price. ▸ paid it twice.

PAINT FIRST. The feed now remembers the last picture it drew, per league,
and the leagues list. Every wake draws the remembered frame at once and
only then reads: a ⇄ flip redraws the remembered frame with the other view
and never touches the network; a ▸ draws the next league's remembered
frame (or a one-line "Switching to X…" card) and then reads; ⟳, the timer,
the silent push and a resize draw the frame, read, and draw again. A read
that fails after a good remembered frame keeps the frame rather than
replacing a real score with an apology.

FETCH LESS. The reads that change on the order of hours are cached in the
app's storage with a lifetime each: the leagues you hold (5 min), the
league's open week (10 min), team names and the week's slate (60 min), the
roster and the injury sheet (30 min). Only the matchup row, its state and
the picks — the three that move on a Sunday — are always read fresh. The
app in the foreground bypasses every cache (a league just joined, a lineup
just saved), so what the app knows first the widget knows next. A cached
null is a miss, a cached zero a hit, and an entry from the future (a clock
that went backwards) is not trusted; check-widget pins all of it.

What remains is Android's own cold start of the JS context, which no
caching removes — the frame now lands the moment that finishes rather than
seconds after.

Battery: web tsc, mobile tsc, check:widget, check:changelog — green.

### v0.422.0 — the widget's second view, and the window strip

Founder: "We can include a lot more info in that widget. What else should we
add? Also a lineup assessment widget would be a second add or make it a
selection in the current widget." Then: "Let's go."

A MODE, NOT A SECOND WIDGET. Same seat, same reads, and the two views are
separated by the clock: the assessment matters until the last window locks,
the score matters from the first kickoff, and they are never wanted at the
same moment. The feed says which view LEADS — LINEUP while something needs
fixing and a window is still open to fix it in (and before the first lock
even when READY, since there is nothing to score yet); SCORE otherwise, and
always on a final — and the ⇄ chip flips it, remembered per widget and
forgotten when ▸ changes the league. A classic seat has no sealed picks to
read, so it gets the score view and the strip and no chip.

THE LINEUP VIEW. A verdict — READY ✓, or N FIXES — then the fixes by window:
empty slots (capacity from slotsFor against filled picks), metrics not yet
sealed, starters tagged OUT / IR / DOUBTFUL (QUESTIONABLE is noise on a
Sunday and stays off), starters whose team has no game this week (the
pool's team against windowForTeam, only when the slate has games at all).
Only windows still in SETUP count — a locked window cannot be fixed, so the
card stops nagging window by window as the day goes. The header names the
next lock. Reads: myPicks as the seat OWNER (pick_user_id, else the session
user), myPool for names and teams, injuryTags — the board's own three.

THE SCORE VIEW GAINS. The window strip: one pill per window in kickoff
order, coloured by who leads it (✓ / ✗ / – when final, ● while live, quiet
while sealed). Who is still to play: mine from my picks in sealed and live
windows; theirs revealed where kicked, assumed the window's full complement
where still sealed. How many of my slots are hot, from slot_scores. Height
picks the tier — Android hands the task the widget's dp — so a 4×2 shows
score, state and strip; a 4×3 adds yet-to-play, hot and the empty-slot
alarm; a 4×4 adds a line per window.

check-widget grew to 41 assertions: the strip's order and phases, hot from
each seat, yet-to-play arithmetic, READY, each fix kind by name, the lead
rule at pre-lock, between windows, once everything is locked, and on a
final, and the league helpers carrying game mode and seat owner.

Battery: web tsc, mobile tsc, check:widget, check:changelog — green.

### v0.421.0 — the Android live matchup widget

Founder: "What would it take to add widgets to the app?" then "Let's do the
Android live matchup widget."

THE PICTURE. A 4×2 home-screen card: league and week, my team and score
against theirs, and one state line — "LIVE · SUN 1PM", "Locks Sun, Sep 21
1:00 PM", "TNF locks …" between windows, "FINAL · W 121.4–98.2", "BYE". Tap
the card and the app opens on that seat's board; ▸ walks to the next league
you hold (per-widget choice, so two widgets can watch two leagues); ⟳
repaints now. Signed out, no seats, and a failed read each draw a notice
card that opens the app. react-native-android-widget (0.22.1, Expo ≥54)
renders it to RemoteViews from JSX; the config plugin registers the
provider in prebuild, so CI's release-apk needs nothing new. Fixed dark
palette — a widget has no ThemeCtx and a home screen is not the app.

THE WORDS ARE PURE. `widgetFeed.summarize()` in core turns the rows every
board already reads (myEnrollments, the matchup row, matchup_state, the
slate) into the card's lines, with `nowMs` a parameter; check-widget stands
at each moment of week 3 — pre-lock, in a window, between windows, final as
W/L/T, bye, unknown names — from the home seat and the away seat, and pins
the league helpers (mocks and archived never reach a home screen; a stored
league you left falls forward; ▸ wraps). No new RPC.

WHEN IT REPAINTS. Android's timer (30 min, the floor), the app coming
forward or signing in (App.tsx), a tap on ▸/⟳, and the worker's SILENT push:
push.js's detectWidget enqueues kind 'widget' for both owners while a
matchup's state is being written, once per 3 minutes per seat (the dedupe
key carries the time bucket), sent DATA-ONLY at high priority (no
notification block, web devices skipped) — migration 0295 admits the kind.
expo-task-manager's background task repaints on any message that reaches
it; the push carries no score, so a late one can never paint a stale
number. The deep link is resolved through the enrollments, not trusted
from the URL.

NOT VERIFIED HERE: no Android SDK in this container, so the APK was not
built — CI builds it on merge (prebuild + gradle). Verified: mobile tsc,
check:widget, `expo config --type prebuild` accepts the plugin, the
worker's syntax, and the preview image renders.

Battery: web tsc, mobile tsc, check:widget, check:changelog — green.

### v0.420.1 — the four bodies are real, and the scene changes

Founder picked the mascots from two generated sheets, then: "What are the
variations we need? … Ooooh or the background changes. A golf course, an
actual guillotine, etc." And: "You can keep the white background and I'll
do the alpha channel elsewhere."

THE CUT-OUT. The checkerboard was baked into the composites (a generator's
fake transparency), so the alpha is made here. A "bright, neutral, noisy"
test ate two white jerseys; the one that holds matches only the checker's
7px alternation — opposite tone 7px over in x and y, same tone diagonally
— then closes the 1px seams, treats EVERY matching region as background
(a border flood misses the pockets between legs), opens away specks,
splits characters by the emptiest gap rather than fixed quadrants (feet
cross the midline), keeps each quadrant's main blob, and fills enclosed
holes under 900px (jersey squares that happened to alternate). All eight
cut out; four wired as 1024 WebP bases (~100 KB each), every body scaled
to one height so the head, chest and hand anchors land in the same place.
Rook = the orange shaggy one, Vault = the stone golem, Duke = the horned
bison, Suits = the blue bird. The bench (purple cyclops, blue mohawk,
purple ogre, red cyclops) is a rename away.

THE VARIATIONS, by what they touch. Mode gear that wraps the head and
shoulders is BAKED onto the body as its own render (`base-<type>-<mode>`,
12 files) because a sticker cannot wrap; the chain, finger, snake and gavel
stay body-agnostic overlays; and one SCENE per league mode (`bg-<mode>`,
4 files) sits behind the stage, cover-cropped with the bottom faded. The
layer plan carries fallbacks: a geared body falls back to the plain body,
which falls back to the drawn stand-in; the head sticker and the cape
stand down the moment a baked body loads (or the mascot wears two
visors); a missing scene draws nothing. check-mascot pins the order, the
fallbacks, the stand-down rule and the 28-file inventory. README rewritten
as the brief: generate on PLAIN WHITE (generators fake transparency with a
checkerboard; flat white keys cleanly), alpha afterwards.

Battery: web tsc, check:mascot, check:changelog, vite build — green.

### v0.420.0 — the mascot builder

Founder: "Build a mascot! … Every selection changes the mascot in some way.
So start with four base mascot models. Like a blooper, gritty, etc. Then
maybe put on a flashy gold chain with the drip logo if it's a drip league.
Then something for the draft mode. Then additional features for each of the
league modes. Then hit a button and the mascot slides to the left and you
can interact with dialogues to set the rest of the league up: rosters,
scoring, teams, draft settings, waivers, go → share link."

THE MASCOT. Four questions in the founder's order, each a layer: LEAGUE TYPE
(Redraft | Keeper | Dynasty | Contract Dynasty) is the BODY — Rook, Vault,
Duke and Suits; MATCHUP STYLE (Drip Battle | Classic Fantasy) is the NECK —
the gold chain with the drip mark, or a foam finger; DRAFT TYPE (Snake |
Auction) is the HAND — a snake over the shoulders or a gavel; LEAGUE MODE
(Classic | Golf | Vampire | Guillotine) is the HEAD — nothing, a visor, fangs
and a cape (the cape BEHIND the body), a hood and an axe. Sixty-four builds,
no two wearing the same layers — check-mascot pins that, plus the order and
the names. Stickers are placed by ANCHOR (neck, hand, head, back) over the
body, not pixel-registered, because generated art never lines up across
four bodies; every file falls back to an emoji until it exists, the icon
sets' rule, and the body falls back to a drawn SVG character in the type's
colour so the stage is never empty. Files and prompts: public/mascot/README.
Each choice pops the stage and re-names the mascot ("Duke the Last One
Standing").

WHAT CAN'T EXIST. set_league_golf refuses a drip league (0200), so the Golf
card wears a CLASSIC SCORING tag under Drip Battle and picking it switches
the matchup to Classic Fantasy rather than building a league the server
would refuse. A contract league drafts by auction whatever the draft card
holds — the seed says so and the draft dialogue tells the commissioner.
Guillotine lifts teams to 18 and FAAB to $1000 the moment it's picked, the
create screen's own presets.

THE SLIDE. BUILD THIS LEAGUE → the mascot slides to the left column (on a
phone it shrinks into a header beside its name) and the right side is the
checklist: LEAGUE NAME, ROSTER (classic: the thirteen slot types plus
bench/taxi/IR; drip: roster size and the six position limits; keepers or
rookie rounds where the type asks), SCORING (classic: reception value, pass
TD, TE premium, best ball; drip: the game's own, tunable on the tab later),
TEAMS, DRAFT SETTINGS (pace, clocks, budget, bell, lots, overnight pause),
WAIVERS (FAAB/rolling/standings, budget, clear time and days, hold, free
agents instant or after the run). Each row opens its own dialogue in place
and reads back one line when shut. "Lists" from the founder's note is
folded into ROSTER as the position limits — flagged in chat.

GO. Signs the visitor in WITHOUT leaving the page — email + password, or an
emailed 6-digit code — because a magic-link bounce would land them in the
live app with the builder's state behind them. Then the create screen's own
calls in the create screen's own order: create_native_league with the seed
(continuity, game mode, draft mode, caps), then the dialogues as ONE
blueprint through applyBlueprint (format, PPR, roster, shape, scoring, best
ball, golf, waivers), the pool, the schedule. Refusals from applyBlueprint
don't roll back a league that now exists; the done screen lists them and
points at the tabs. The share link is inviteLink(invite_code) with Copy and
native Share. create_native_league is gated by the `native` flag, so an
account without it lands on "your league is designed, the pilot is
invite-only" and a Request button that opens the invite modal with the
whole design in the note (RequestCodeModal grew `initialNote`). Build and
setup both persist on the device across a reload.

NOT HERE: real art (the README is the spec); "Lists" if it meant something
other than limits; trade review and taxi/IR eligibility rules (defaults;
on the tabs).

Battery: web tsc, check:mascot, check:tagline, check:changelog, vite build —
green.

### v0.419.1 — the league builder

Founder, on the merged landing: "Looking good. Anyway we can make this from
a boring table into something sexy."

The menu was chip rows: a settings form with nothing showing until tapped.
It is now the thing the form builds. A readout at the top assembles as you
tap — "Classic · Guillotine · Dynasty · Auction draft", scoring under it —
with Start this league → beside it. Under that, one card strip per question:
glyph, name, and the one line always visible, so nothing has to be tapped
to be read. Snap-scrolling strips on a phone, a wrapped grid on a desk.
One pick per row; the scoring row takes any mix. A selected card lifts and
glows in the theme's own accent, so all nine themes and the colorblind pair
keep their contrast. The plain shape joined the season row — Head-to-head
beside Guillotine, Vampire and Golf — because a readout with a hole in it
reads as broken.

The two game cards carry ▶ PLAY A WEEK, which opens that game's demo under
the panel as before; selecting a game card only changes the readout. The
"tap one to play a week" nudge is gone with the chips — the button is the
nudge. Nothing here is stored: it is a picture of what the create screen
offers, not a form. Glyphs live on the core notes (`FormatNote.icon`) and
check-tagline requires one on every card.

Battery: web tsc, check:tagline, check:changelog, vite build — green.

### v0.419.0 — the site leads with the league you can build

Founder, strategizing: "Drip fantasy is becoming more of a 'Create your
dream league' playground in a bespoke environment for people with creative
or wild league ideas. Let's lean into that. It's not the place exclusively
for drip-style fantasy." Then, on the name: "I want to keep the name, but
change the site experience to focus on the broader features."

THE GAP. The create screen has been a format builder for months — game ×
continuity × format × draft × pace × scoring × roster, with guillotine,
vampire, golf, contracts and best ball all live — and the landing still
opened on the drip demo's headline ("Your picks are sealed") with the
formats parked UNDER the board, where only a visitor who finished a demo
week ever scrolled. The FAQ's first answer defined the whole product as the
hidden-metric game. The create screen called classic mode NORMAL, which
framed drip as the default and classic as the exception, while the join
card, the blueprint summary and the code all said CLASSIC. A commissioner
with a guillotine idea met one game and never learned about the rest.

THE LANDING. A product-level hero now comes first, in the founder's own
three lines: kicker "Your league, your rules", headline "Create the fantasy
league of your dreams.", and "Anything goes fantasy football" as the title
tag and social-card title. Under the headline, one line naming the
switches, and two doors — Start a league (sign-in) and Request an invite. Under it, the whole menu of
switches as chip rows in the order the create screen asks them: WHICH GAME
· HOW THE SEASON ENDS · WHAT CARRIES OVER · HOW THE ROSTER FILLS · HOW IT
SCORES. Chips, not cards — five groups of one-liners was a wall above the
fold on a phone — so a row shows its names and opens one line on a tap.
The WHICH GAME row is also the demo switch: tapping CLASSIC there is the
band's CLASSIC. Nothing else opens on a bare visit — founder: "have the
landing page show the different types of league options, then the user
can click the drip scoring for a drip demo." Tapping DRIP or CLASSIC in
the WHICH GAME row opens that game's demo week under the menu and scrolls
to it, with the band reading "Two games to try. This board plays DRIP."
and a ✕ to put it away; a recruit link's `?game=` still opens its game on
arrival. The old
"AND OVER A SEASON" section under the boards is gone; its three groups
moved up into the menu, joined by the two games and the scoring options.

The copy lives in core (`leagueTagline.ts`: SITE_PITCH, GAME_NOTES,
SCORING_NOTES, LEAGUE_MENU) beside the join-card wording, and
check-tagline holds it to the same rule: the classic line never borrows
drip vocabulary, both games are named as the create screen names them,
and the menu names guillotine, vampire, golf, dynasty, contract, auction,
best ball and IDP.

THE REST OF THE FRONT DOOR. index.html's title, description and the
social cards lead with the formats. The FAQ's first answer is the product;
a new "What kinds of leagues can I run here?" walks the menu and ends with
the ask — "if your league has a rule we don't have a switch for yet, tell
us"; "How is this different" became "What is Drip mode" and says up front
that it is optional; the own-league and not-on-Sleeper answers both say a
league can be created here with no other platform. NORMAL is CLASSIC on
the web create screen and in the mobile app's create, league info and
commish rollover strings — the word the rest of the product already used.

NOT DONE HERE, deliberately: the signed-in chooser still gates "Start a
fresh league" behind the native flag or admin, and its heading still asks
how you are joining the pilot. Opening create to every account is a
product decision, not copy. The Android app's own recruit landing was not
re-pitched; it does not import the landing copy.

Battery: web tsc, mobile tsc, check:tagline, check:changelog, vite build —
green.

### v0.418.2 — the switcher on the classic board, and HOT says what Momentum makes it

Founder, mobile web: "add the switcher to the classic board too. Is my
momentum power up working with Amon Ra?"

THE SWITCHER. The classic board is an early return from the drip board's
component, and the switcher (chip, "Your matchups" menu, the open prelude)
was built AFTER that return — so a classic league could never have been
handed it, on any width. The block moved above the hand-off (plain values,
no hooks; the state it reads is declared at the top with the rest), and the
classic board takes the chip as a prop and draws it in its header row
beside ← LEAGUE — which on a phone the rail hides, so there the chip is
the row's whole left side. The drip board keeps ownership of the seats
list and the menu, so both boards open the same door and it cannot drift.

MOMENTUM. It was working. minuteGain has read the side's buffs since the
power-up shipped — hot drips accrue at 3× under Momentum, 2× without — and
the live path hands each window's armed buffs through (buffsForWindow →
resolveSlot → youBuffs/theirBuffs). What lied was the LABEL: the streak
badge on a hot drip play was hard-coded "🔥 HOT 2× · rate/m", whatever the
multiplier actually applied. So the one line on the log that names the
multiplier said 2× on a card wearing the Momentum chip, and there was no
way to tell the buff was counting. It reads the same buff set the accrual
reads now: "🔥 HOT 3× · 1.04/m" when Momentum is on. matchup.ts's hot
detection matches on "HOT", not on the digit, so nothing downstream moves.

The minute-by-minute drip ticks have always carried "MOMENTUM 3×" as their
note, but the log's PLAYS view does not show ticks — which is why the
founder had to ask.

Battery: web tsc, mobile tsc, vite build, check:changelog — green.

### v0.418.1 — the switcher on a phone

Founder, mobile web, on the drip board: "We need the switch between your
matchups feature."

The league switcher (v0.388.0) — the header names the league you are in
and opens "Your matchups", a list of your other seats — lived in the
board's own top row of chips. On a phone that row was replaced by the
shared brand rail in v0.356.11 (my leagues · wordmark · gear), and nothing
carried the switcher over. So the one screen the founder actually plays
on, four leagues live, had no way between his matchups but back out to the
leagues list. Wide screens never lost it.

It sits beside the week selector now, where the ◈ DRIP chip was. That chip
is a statement of the mode, not a control, and the row has room for one
chip beside the week and the score; the door between leagues wins it.
Only when there is more than one league to go to — a single-league seat
keeps its mode chip, and the menu already marks a classic league in its
list. Same chip, same menu, same prelude as the desktop: nothing new to
learn between the two.

The classic board has never had the switcher on any width — noted, not
done here.

Battery: web tsc, vite build, check:changelog — green.

### v0.418.0 — the Combo Drip you already fielded is not a second one, and the fields chip before kickoff

Founder, Thursday evening before TNF, over a board with ONE Combo Drip on
it: "Still this error. And what happened to the fields chip?" The error:
"NOT SAVED — SUN 1PM · 1: Combo Drip is one per unlock — you own 1, buy
another to field more."

THE ERROR. The database held one combodrip row, at SUN 1PM · 1. The row
being refused was that same row, sent again. The live boards autosave the
whole lineup after every edit as one upsert — INSERT … ON CONFLICT DO
UPDATE on the slot key — and Postgres fires a row's BEFORE INSERT trigger
on the PROPOSED row before it discovers the conflict, with a freshly
minted id. `enforce_single_combodrip` excluded "the row I am" by `sp.id is
distinct from new.id`, which on that path excludes nothing: the saved row
at the same slot has a different id, so it was counted as a second Combo
Drip, and the manager was told to buy another to keep the one he had.
Every autosave after the first refused it, and v0.394.2's row-by-row retry
refused it again for the same reason.

Reproduced on a scratch Postgres 16 with the 0062 body verbatim: first
save accepted, the identical second save refused. v0.394.3 read this same
banner, found a real orphan row behind it, fixed that and stopped — the
orphan was true and was not the whole story.

Migration 0294: the row a write REPLACES is the one at the same (matchup,
user, window, slot) — the upsert's conflict key — not the one with the
same id. The metric-swap path in apply_targeted has always excluded by
slot for exactly this reason; the trigger now does too. Six probes on the
scratch cluster: the same row re-saved, a whole-lineup batch around it,
moving it to another slot in one batch, and two-owned-two-fielded all
accepted; a second at another slot and an UPDATE into a second both still
refused with the same message. `scripts/db/combodrip-resave-probes.sql`
carries the same six against the real schema.

Also, `savePicksBestEffort` (liveApi) takes ONE MORE pass over the rows it
refused, once every row has had its turn. A cap is counted against what
is already on the server, and a later row in the batch may be the one that
frees it — moving the Combo Drip from slot 2 to slot 1 sends "1: combodrip"
before "2: something else". Refusals that were only about order now go
through; refusals about the rule come back once, with the same words.

THE FIELDS CHIP. The drip board's ▦ was gated on `hasGameFeed(week)`, which
is true only once the worker has ingested a play. So the chip was missing
for the whole of the week before its first whistle — the evening a
manager is setting his lineup — and reappeared mid-game, which read as the
chip having gone somewhere. v0.413.0 taught the overlay to draw a card
from the slate alone (kickoff, no plays) and the CLASSIC board's chip to
open on "fixtures OR feed"; this board never got the same ruling. It now
does: gated on `hasGameFeed(week) || hasSlate(week)`, and the overlay is
handed the week's fixtures through core's new `scheduledGamesFor(week)`,
read back from the slate the live board already installs. The demo board's
copy keeps its feed gate — its weeks are baked and always have one. The
app's chip was never gated and its sheet loads its own slate, so nothing
to do there.

Battery: web tsc, vite build, check:changelog, check:pick-save,
check:fieldboard, scratch-Postgres probes — all green.

### v0.417.0 — Twin Generals on the app's cards

Founder, on the phone, with the buff armed for the 1pm window: "I armed
twin generals for 1pm but I don't see it on the cards."

He could not, and not because anything was mis-saved. The app has never
drawn this card. Its cards ask `buffAppliesToSpot`, which answers per SPOT
— and Twin Generals is the one buff that is a property of a WINDOW: two
Field General QBs in it, or the card is worth nothing. It cannot be a case
in that switch, because a case there would badge a lone Field General as
though it were paired. So it was written inline on the web's own board, and
never anywhere else — which is precisely how one host came to draw it and
the other to deny it existed.

The rule is core's now (twinGeneralKeys), and the web board reads it from
there instead of computing its own: the pairing cannot drift again without
both hosts drifting together. It returns the KEYS of the pair rather than a
boolean, because the useful thing to draw is which two cards are linked.

The app wears it as 🎖️ TWIN ×2 on the card, opposite the ⚡ chip so the two
never collide on a narrow card — and appliedFor counts it too, so the chip's
number is right and tapping "what is on this card" names it. A badge alone
would have left the chip lying by one.

Three Field Generals in a window all link. The engine stacks the top two
multipliers (sim.ts) and which two that turns out to be is a question the
final scores answer, not the setup screen — so the screen says all three are
in it rather than guessing at a pair.

Eleven parity assertions on the shared rule, including that
buffAppliesToSpot still REFUSES fg-stack. That last one is the guard against
the obvious wrong fix: adding a case there would put the badge on a single
Field General, which is the bug wearing a different face.

### v0.416.0 — the depth chart, so the right backup comes on

Founder: "Lock is the QB2 but Darnold is hurt and out this week." Then, on
the plan: "yes build it."

v0.415.0 took the injured man off the sheet and promoted Jalen Milroe,
because the sheet ranked by PROJECTION and Drew Lock has none — a player
the projection set never valued cannot be sorted into view however the list
is ordered. Injury-awareness fixed who comes off. This fixes who comes on.

WHY SLEEPER, out of three checked. ESPN's core API serves a real ranked 2026
chart and it is the SEASON one — it still has Darnold at QB1, so it answers
about role, not about Sunday. StatHead's get_depth_charts has exactly the
right shape and its worker exceeds its resource limit on 2025 and 2026
(2024 answers fine), so it cannot be leaned on today. Sleeper's directory
carries depth_chart_order, is re-ordered for AVAILABILITY week to week —
Lock 1, Darnold 2, already — and the worker pulls that directory daily
already. sync.js has been reading the field since the preseason pool
builder and simply never stored it.

Built on the player_team_override pattern (0142), which is the proven one:
worker writes, any signed-in user reads, no RPC. Difference is that this is
the WHOLE map rather than a drift — there is no baked depth chart to diff
against, and at ~570 rows there needs not be.

THE RULE: rank first, projection second. A ranked man always sorts above an
unranked one, ties and absences fall through to projection, and a player
with neither a rank nor a projection is not a candidate at all. Where
Sleeper has no opinion — about a third of the pool — the sheet is byte for
byte what it was before, which is what makes partial coverage safe. A rank
still loses to being OUT: the injury filter runs first.

NO KICKERS in the chart, deliberately: this game scores kicking as a team
unit (sea-k), so publishing an individual kicker's rank put "Jason Myers —"
where the unit's real projection belongs. Caught by running the whole chain
against the live directory before shipping, which is also how the Lock case
was confirmed end to end: 572 rows published, Seattle's QB1 comes back
drew-lock.

ONE THING TO WATCH, flagged rather than silently accepted: rank-first also
puts George Holani (rank 2, proj 0.4) at RB2 over Zach Charbonnet (rank 5,
proj 7.8). That is what Sleeper says, and trusting it is the whole point —
but a committee backfield is where the chart and the model disagree most,
and it is worth a look before week's end.

Eight parity assertions on the ordering rule and five probes on the table's
RLS — a client that could write here would own every league's idea of who
starts. 94 suites.

### v0.415.0 — a man who is out is not a projected starter

Founder, correcting me on Seattle's quarterbacks: "Lock is the QB2 but
Darnold is hurt and out this week."

He is right, and the data says so plainly — Sleeper's directory has Darnold
at injury_status Out, Lower Body, and has already moved Lock to depth 1 for
the week. I had read Sleeper's chart as WRONG for putting Lock above
Darnold. It is not wrong; it is answering a different question. ESPN's is
the season depth chart (role), Sleeper's is this week's (availability), and
for a sheet shown before kickoff the second one is the one that matters.

The bug that exposes: the projected box had Darnold starting. He
outprojects Lock across a season and will score nothing on Sunday, which is
exactly why projection order alone cannot answer "who starts this week".

So a week can now be handed to projectedStarters, and a man designated 'O'
or 'IR' is off the sheet — the next man takes the spot. Only those two.
Questionable and Doubtful stay, carrying their letter, because a
questionable starter usually plays and swapping him out on a coin flip
would be worse than showing the tag and letting a manager read it. The
screen should not make that judgement for him. Both hosts pass the week and
render the tag.

THE LIMIT THIS EXPOSES, stated because it will be seen: with Darnold out,
the sheet now shows Jalen Milroe — not Drew Lock. Lock is not in PROJ_2026
at all, so no amount of ordering can surface him; the candidate set is
"players the projection knows", and a backup with no projection is
invisible to it. Injury-awareness fixes who comes OFF the sheet. Only a real
depth chart fixes who comes ON.

Which is the answer to the question that started this: Sleeper carries
depth_chart_order, is injury-adjusted weekly, knows Lock, and sync.js
already reads it — transiently, for preseason pools, never stored. That is
the integration to build, and it is not built yet.

Eight parity assertions on the injury rule, including that an injury in
another week leaves this one alone.

### v0.414.0 — the projected box was reading last year's rosters

Founder, asking whether a real depth chart could be had from ESPN or
StatHead. Checking that answer against v0.413.0's output is what turned up
the bug: Seattle's projected starters listed Kenneth Walker, who signed for
Kansas City, and did not list Rashid Shaheed, who is an actual Seahawk.

projectedBox filed candidates by slugMeta's team. That field is a player's
MAJORITY 2025 team, deliberately — the baked play stream's possession gating
is written against it and it must stay that way. It is simply the wrong
question to ask about who plays for a team in 2026, and asking it put every
offseason mover on the team he left.

liveTeamFor is the function this should have used from the start, and its
own comment records the same bug being fixed for the app's picker a while
back: "we still have Doubs as GB". It prefers the worker's override, then
the directory bake, and it NORMALISES — which matters on its own, because
the layer underneath answers LAR where the slate says LA, so even a correct
team could miss.

Asserted as a rule rather than by naming the two players, so a projection
refresh cannot quietly retire the guard: every row on a side must resolve to
that side under the live map, and a player whose baked team differs from his
live one must appear under the new team and not the old. The mover is found
in the data — the run currently reports "kenneth-walker: SEA -> KC" — and
the assertion fails loudly if the data ever stops containing one, because a
guard with nothing to catch proves nothing.

Confirmed to bite by restoring the old filter: both assertions fail.

ON THE DEPTH CHART ITSELF, which was the actual question — the findings are
in the reply, not the code. Short version: ESPN's core API serves real 2026
ranked depth charts and is the best source; StatHead's get_depth_charts has
the right shape but its worker blows its resource limit on 2025 and 2026
(2024 answers fine); Sleeper carries depth_chart_order and the sync already
reads it, but it has Seattle's QB1 as Drew Lock over Sam Darnold, so it is
not trustworthy on its own. Nothing shipped on that yet.

### v0.413.0 — the fields open before kickoff, and the box score projects

Founder: "on a non-existing feed, just open the fields with a kick off time
and no data. The box score can contain projected starters and fantasy
projections until kick off."

A game feed only exists once the worker has ingested a play, so before the
first whistle of a week there was nothing on the screen at all — on the
evening a manager is actually choosing a lineup. v0.412.0 ungated the chip
from the LINEUPS; this ungates the screen from the FEED.

The slate knows the fixtures days ahead, so it seeds the rest.
groupFieldGames takes the week's scheduled games and mints a card for any it
has no feed for: no plays, state 'pre', and the kickoff, which is the only
thing there is to say. A feed that exists always wins — it is the live
truth and must never be overwritten — but a feed carrying no kickoff of its
own borrows the slate's, so every card can show a time. A week with neither
still yields nothing, which is why the chip is gated on "has fixtures OR has
a feed" rather than ungated: a button onto an empty screen reads as broken,
and that was the right instinct behind the original gate.

THE BOX SCORE, BEFORE ANYONE HAS PLAYED. gameBoxScore accumulates from
plays, so an unstarted game showed "— nothing yet —" under both teams. The
new projectedBox answers the other question: who is expected to start, and
what does THIS league's scoring project them for. It runs through projFor,
so a TE-premium league's tight ends project like TE-premium tight ends here
exactly as they do in the pool — and so the kicker and the defence are in
it, since the units are baked separately from the skill positions and
projFor is what knows both.

There is no depth chart in the building. "The highest-projected quarterback
on this roster" stands in for QB1, and it works because the projection
already folds in the job — a backup projects like a backup. The file says
so and the sheet says so: ◷ PROJECTED STARTERS · NOT A STAT LINE, with the
footnote "a projection, not a depth chart". A starter projected below his
backup will be listed second, which is the honest consequence of deriving
depth from value rather than pretending to a depth chart we do not have.

Found on the way: the classic board never called setRuntimeSlate, so
nflSlate derived that week's fixtures from the BAKED 2025 schedule — which
is the wrong games for a 2026 league, in the box score's own game strip.
Every other screen showing a slate installs it; this one never did. Both
hosts now do.

Nineteen parity assertions, verified to bite by breaking one.

### v0.412.0 — the fields chip, on a classic matchup, for that week

Founder: "Let's add the fields chip to the matchup view in classic mode. It
opens the fields for the specific matchup week."

Half of that already existed and could not be reached. The classic board
has had a ▦ FIELDS chip since v0.270.0, already scoped to the right week —
weekGameFeeds(matchup.week), FieldBoard week={matchup.week} — but it was
gated on `fieldEntries.length > 0`, and fieldEntries is built from the two
LINEUPS. So the week a manager most wants to look at, the one he has not set
a lineup for yet, was the one week with no way in. That is the same shape as
v0.411.0's "0 GAMES": a screen counting starters and reporting it as a fact
about the NFL.

The overlay never needed the lineups. groupFieldGames seeds a card from
every game on the week's feed and uses the entries only to tint your own and
sort them first — the founder's own ruling when that rule went into core:
"the screen is called ALL GAMES, and a slate filtered to your matchup reads
as a broken feed". An empty lineup is a full slate with nothing highlighted,
which is exactly right.

So the web chip is gated on the FEED existing instead, and the title stops
promising "every game with a starter" when it always showed every game.

The app needed more than a gate. Its sheet is handed an explicit list, and
that list was built from the starters — a reimplementation of a rule that
already lives in core. It now calls groupFieldGames like the web does, so
the two hosts cannot order the same week differently, and its empty copy no
longer says "no live games with starters yet" about a week whose games have
simply not started.

Still gated on the feed rather than ungated: with no feed there are no
cards, and a chip that opens onto an empty sheet reads as broken — which is
what the original gate was defending against. It was defending the right
thing with the wrong test.

Six parity assertions on the grouping rule, verified to bite by breaking
one: an empty lineup opens onto the whole week, a lineup does not narrow it,
yours sorts first, finished sinks last, and a week with no feed still yields
nothing.

### v0.411.0 — a week nobody set a lineup for is not a week that is over

Founder: "dig into the empty slate."

It was not empty. Queried live, through the same anon key the site uses:
sixteen rows for 2026 week 1, kickoffs and windows intact, and all 272
games of the season seeded since 0051. I had told him the slate looked
missing and that it would probably bite at scoring time. Both wrong.

What the board actually says, in three places that all read as one claim:

  NFL SLATE · 0 GAMES   ← games WITH ONE OF HIS STARTERS in them
  all final             ← starters still playing: zero
  0.00 — 0.00           ← starters, scoring

He had no lineup set for that week. Every one of those lines is counting
his starters, and counting nothing, so a week nobody had touched described
itself as a week that had finished. The zero is not a statement about the
NFL at all, and reading it as one is what sent an investigation after
schedule data that was sitting in the table the whole time.

So the chip now tells the three zeroes apart, because they mean completely
different things:

  no lineup set    → NO LINEUP · nothing set for this week
  no slate loaded  → NO SLATE  · this week's games haven't loaded
  a lineup, no games → 0 GAMES · 3 starters, none with a game

and the side line under the score says "no lineup set" rather than "all
final". BoardSide carries `filled` — how many starter slots hold a player —
because a side cannot tell that story about itself without knowing the
difference between nothing left to play and nothing to play with. A caller
that passes no count keeps the old wording exactly, so nothing else moves.

Eleven parity assertions, verified to run by breaking one. Both hosts.

STILL OPEN, and reported rather than fixed, because the fix deletes
matchups and that is the founder's call: his league really does carry a
dead week 1. 0280 was written to prevent exactly this and could not heal
his, because it refuses any league with a matchup that is not 'scheduled'
— and the worker's closeWeek had already flipped that dead week to final
at 0.00. The guard is tripped by the very condition it exists to repair.
Everyone carries a phantom tie from it; symmetric, so standings order is
unaffected, but 0-0-1 in week one of a league that has played nothing is a
lie the screen tells.

### v0.410.0 — the zip is the Android download

Founder, after testing it: "zip downloaded fine, make it the default for
android."

So every place a download STARTS now points at the zip: the settings menu,
the GET THE ANDROID APP button on the leagues page, the changelog card's
primary button, the FAQ's first link, and — the one that matters most —
the app's own "you are N versions behind" button, which opens a browser on
the phone, which is exactly where the stall happens.

The direct .apk keeps its place on the changelog card, beside the zip and
labelled as what it is: one tap shorter where a browser will take it. That
card is the only surface with room to explain the choice, so it is the only
one that offers it. Everywhere else, a default has to work for somebody who
has never sideloaded anything and will read "Failed" as "this app is
broken".

The copy no longer treats the unzip as an apology. It says the download is
a zip, says to unzip it and tap the APK inside, and says why: a browser
handed a file served as an Android package can leave the download sitting
at 100%, or call it Failed with every byte already there, and none of that
is about the build. GitHub will not serve a file called .apk as anything
else — v0.409.0 tried, and its own build log is quoted in the workflow.

A parity guard holds it, asserted against the source rather than a runtime
value, because this is exactly the kind of default that comes back one
careless import at a time: somebody adds a download button, reaches for the
obvious-looking constant, and a surface nobody re-tests quietly reverts.
Nine assertions — each entry point uses the zip AND does not reference the
raw constant at all, the card offers both, the FAQ names the zip first —
verified to bite by breaking one.

### v0.409.1 — the content-type experiment failed; the zip is the answer

v0.409.0 guessed that the APK's stalled download was down to one header,
and tried to publish it as application/octet-stream through the REST
upload, which lets you name a Content-Type. The build log settles it:

    APK uploaded as application/octet-stream
    drip-fantasy.apk  20243344  application/vnd.android.package-archive

The upload was accepted and GitHub re-typed the asset from its extension
anyway. A file called .apk cannot be served as anything else from a
release, so there is no version of that idea that works, and the machinery
is reverted rather than left in place looking like it does something. The
asset listing it added stays — that log line is what answered the question
— and so does the check that the APK is actually on the release before the
job passes.

Which leaves the zip, and the zip is now a button rather than a sentence.
It sits beside DOWNLOAD APK on the changelog card, because the person who
needs it is the person whose download just hung, and they should not have
to read a paragraph to find it. The paragraph is still there and now says
the true thing: the build is fine, the browser is refusing a file served as
an Android package, take the zip — same build, same signature, byte for
byte, which was verified by sha256 against the direct download before any
of this was claimed.

Two things worth keeping straight, because they were separate problems
wearing the same symptom: 0408 stopped the release being deleted and
recreated on every build, which really was ours and really did break the
link (confirmed fixed — created_at unchanged across three builds now). The
stall at 100% is not ours and cannot be fixed from this side. Both needed
doing; only one of them is a bug we wrote.

### v0.409.0 — the APK goes up as an ordinary binary

Founder, with a screenshot of Chrome's own download list: the APK sat at
"20.24 MB / 20.24 MB" with a pause icon and never finished, while the
identical file handed over in chat installed without complaint. Every byte
had arrived. Chrome simply would not call it done.

Two files on the same release, fetched the same way, answered that. The
zip 0408 added comes back as application/octet-stream and behaves like any
other download; the APK comes back as
application/vnd.android.package-archive, because GitHub types a release
asset from its extension, and that is the type that puts Chrome into its
package-archive handling. One header is the whole difference between the
door that works and the door that hangs.

So the APK goes up as octet-stream too. Same bytes, same signature, same
filename, same URL — Android resolves the installer from the .apk
extension when the file is tapped, not from the type it arrived under. The
zip stays where it is: it is now proven to work, and a fallback you have
tested is worth keeping.

gh release upload cannot set a content type, so this is the REST upload,
which needs the old asset deleted first. Every part of that can fail in a
way the old one-liner could not, so it falls back to gh release upload —
a link serving the awkward type beats a release with no APK on it — and
then asserts the asset is actually there before the job is allowed to pass.
The step also prints every asset with its size and type, so the next time
this question comes up the answer is in the log rather than in a curl.

Verified on 0408 before writing any of this: the release now updates IN
PLACE (created_at unchanged across two builds, so the delete-and-recreate
really is gone), and the zip's contents are byte-identical to the direct
download — same sha256, valid package, right version in the bundle.

A hypothesis about somebody else's browser, though, not a proof. If the
direct link still hangs, the zip is one tap away and the header experiment
costs nothing to reverse.

### v0.408.0 — stop deleting the release out from under the download

Founder: "the app downloads from the link but never finished and says
failed despite showing all the data transferred."

Checked the artifact before touching anything, because "failed" could have
meant a truncated build: the link answers 200, Content-Length 20,240,920,
exactly that many bytes arrive, Content-Type is the Android package type,
the zip passes an integrity test and carries v0.406.0 in its bundle. The
build is sound and the bytes are all there. Whatever fails, fails after
the download.

Two things then, one of them ours.

OURS: release-apk.yml opened with `gh release delete apk-latest
--cleanup-tag`. Every build destroyed the release and its tag and built
them again — so for the seconds in between, the ONE URL every playtester
has, the one the site's download card points at, was a 404. On a quiet week
nobody lands in that window. On the day that produced this report it was
seven windows in ninety minutes, on the exact link the founder keeps being
handed. It now creates the release only when it is missing and replaces the
assets in place. --clobber still drops an asset before re-uploading it, so
the window is not zero, but it is one file for a few seconds instead of the
whole release. The tag stays where it was first cut; the commit is in the
notes, and a stale link on a page beats a dead link in a browser.

NOT OURS, and not fixable by us: a browser that runs its own verification
over a download whose type says "package archive" can report FAILED after
every byte has arrived. So there is a second door now — the same signed
APK, zipped, published beside it. An ordinary zip is an ordinary file to
every browser: download, unzip, tap the APK inside.

And the word is explained where it appears. The changelog's download card
and the FAQ both now say that "Failed" at the end of the bar is the browser
refusing the file rather than a broken build, with the zip link right
there. Somebody staring at that word should not have to conclude the app is
broken.

The app carries the zip link too, through core's changelog module, so the
APK rebuilds with this one.

### v0.407.0 — the board opens on the week being played

Founder, on a classic league matchup: "still opens to week 1."

v0.401.0 answered this question for the app's matchup screen, the leagues
list and the league hub, and missed the one screen a classic league
actually opens: ClassicBoard. Both hosts carried the same line —

    const m = await myMatchup(leagueId, rosterId, weekWanted ?? undefined);

— above a `weekWanted` whose own comment reads "null means whatever week the
league is on". It does not. Undefined goes through to myMatchup, which is
`.order('week').limit(1)`: the league's FIRST week, for ever. The comment
described the intent and the code did the other thing, which is why reading
past it twice did not catch it.

That alone would not have fixed his league, though, and the screenshot says
why: NFL SLATE 0 GAMES, and "all final" under both scores. There are no
slate rows behind that week, and openWeekFrom's rule for a week with no
slate was to return it — "an unscheduled week is the one thing we cannot say
is over". Right for a week that has not been played; wrong for one that
plainly has. A league whose schedule was rebuilt mid-season (his kickoff
league; any converted one) has real, finished weeks with no slate behind
them, and was pinned to week 1 for the rest of the season with no way to say
otherwise.

The matchups' own status is the league's answer to "is this week done", and
it needs no slate at all: every one final ⇒ over. openWeekFrom takes that as
a fourth argument, defaultOpenWeek reads it in the query it was already
making, and where a slate DOES exist it still decides — a week that goes
final on Monday night is still held until Wednesday, which is the rule the
founder asked for in the first place.

defaultOpenWeek's season and preseason flag are now optional, read from the
league row when absent. Needing a season string is the reason the board
never called it: it has a league id and a roster id and nothing else.

Eight new parity assertions, verified by breaking one that they run.

### v0.406.0 — the hold is on the same schedule as the run

Founder, on the pool an hour after 0291 shipped: "still has jax kicker
clearing at 4am."

Different 4am, and my own sentence caused it. 0291 re-dated a claim's own
clock and said, in as many words, that a claim queued behind a real pool
hold "follows that hold, as it always has". There are two stamps in this
system and I moved one:

    waiver_claim.clears_at    set when a claim is made      — 0291 re-stamped
    league_pool.waived_until  set when a player is DROPPED  — nothing did

Somebody dropped JAX Kicker while the league still cleared at 4am, so his
pool row carries a 4am hold. The ⏳ in the player list counts down to it,
and the claim behind it inherits it through coalesce(clears_at,
waived_until). Moving the league to 2pm Thursday moved neither, so the pool
was a queue of players still clearing on a schedule the league no longer
ran.

Every fantasy platform means one thing by a waiver time: there is a run,
and everybody on waivers clears at it. The per-player stamp is an
implementation detail of that, not a separate promise made to each player
at the moment he was dropped. So changing the schedule now re-dates every
live hold and every claim, through one function, because a league whose
holds and claims disagreed about what day it is would be the same bug one
layer down.

Three things it deliberately does not do, each with a probe:

  • an EXPIRED hold stays expired — he already cleared, he is a free agent,
    and re-dating him would put him back on waivers;
  • a ROLLING league (no clear time at all) is left alone — waiver_hold_until
    answers now() + 24h there, so re-stamping would shove every live hold a
    further day out every time a commissioner saved any setting;
  • a longer-than-one-day hold restarts against the new clock rather than
    crediting days already served. Moving the schedule mid-hold is a rare and
    deliberate act, and a rule you can say in one sentence beats an accounting
    nobody can predict.

Leagues already out of step — the founder's among them, since he changed
the time before any of this existed — are re-dated once by the migration.

93 suites pass.

### v0.405.0 — the wire, out loud; and the clear time actually clears

Two asks in one build, both about the same corner of the league.

**"We need an add/drop log that also includes a waiver report when it runs
and a trade report when it happens. All this goes in chat."**

The log already existed and had never said a word. league_txn (0186) has
recorded every roster movement since the register went in, written by one
trigger on native_roster. A register is a thing you go and look at; chat is
where a league lives, and a trade nobody mentions may as well not have
happened. So 0290 posts — not a second log, the same events announced.

Not from that trigger, though, which is the design decision worth keeping:
the trigger fires per ROW and the founder asked for per EVENT. A waiver run
that settles five claims is one report, not five lines. A trade is one
sentence, not four roster updates. An add that carries a drop is one
decision and reads as one line. Only the RPC knows where an event begins,
so the four that do the work post: add_free_agent, drop_player,
process_waivers and execute_trade.

The house voice existed too — 0275 taught league_message that a null author
is "Drip Fantasy" — but only the Node worker had ever used it, through the
service role. _chat_house is the SQL-side version, revoked from everyone so
only a definer function reaches it. A new 'txn' kind carries a payload the
clients render an icon and a rail from, shared so the two hosts cannot
disagree about what colour a trade is.

Two deliberate silences: a sweep that settles nothing says nothing (the
team screen calls process_waivers every fifteen seconds, and a league whose
chat filled with "waivers ran, nothing happened" would be worse than no
feature), and transaction lines never reach the "every message" push door.
That subscription was bought for the conversation, not for a move-by-move
feed.

**"I changed waivers to clear at 2pm tomorrow (thursday) but this still
says they clear at 4am. We need the ability to set a custom time for
waivers to clear each day."**

The custom time has existed since v0.216.1 — any minute, plus a day picker.
He set it. It did nothing, because 0289 had pinned a claim to the wrong
clock: it asked when free agency could next reach the player and used that
as the deadline, which quietly made the FREE AGENCY schedule govern the
WAIVER run. The one setting labelled "waivers clear at…" had no bearing on
when waivers cleared.

He is right and 0289 was wrong. 0291 adds next_waiver_run() — the
configured time on the configured days, with no waiver_hold_days added,
because that is how long a dropped player sits and not when the run happens
— and a claim now clears there. Free agency's door is the fallback for a
rolling league that has no run at all, where 0289's answer was right.

And a deadline the commissioner moves has to move: clears_at is stamped at
submission, so his two standing claims kept the rule they were born under.
set_transaction_rules now re-stamps every pending claim, and the migration
backfills the ones already in flight.

The card said "Waivers clear DAILY at …" whatever the day set was, so a
once-a-week league described itself as a daily one and the question had
nowhere to be answered from. It now names the real days and the next run.

The week-report probe caught 0290 dropping 0275's report_week constraint —
the sweep that widens the kind check eats every check whose definition says
"kind", and 0275's own paired check says it too. 93 suites pass.

### v0.404.0 — a claim needs a clock of its own

Founder, on the claim he put in minutes earlier: "it looks like my bid for
golden went through immediately."

It did. Matthew Golden went undrafted, so his pool row carries no
waived_until — only a DROP sets one — and process_waivers has read a null
hold as DUE NOW since the day it was written:

    and (lp.waived_until is null or lp.waived_until <= now())

That reading was correct when a claim could only exist for a player
somebody had dropped, where null meant "the hold has been cleared". 0288
changed the population: a player free agency cannot reach is claimable
too, and almost none of those have ever been on a hold. The team screen
sweeps every fifteen seconds to stay self-driving without a worker, so the
claim was won within seconds of being made.

That is worse than the bug it came out of. It is an instant add that also
charges FAAB, and it settles UNCONTESTED — nobody else gets the blind-bid
window the closed door exists to create. Whoever is awake takes anyone.

So a claim gets its own clock (0289). clears_at is stamped at submission
for exactly the claims 0288 admitted, and process_waivers prefers it to
the pool row: coalesce(claim, pool, now()), where a claim with neither is
due now and every pre-0289 row behaves exactly as it did. The moment
chosen is when free agency next opens — the deadline the pool header
already promises — which needed fa_window_open() lifted into
fa_window_open_at(ts) and a new fa_opens_at(). The league's own waiver run
would have been wrong here: a league clearing waivers Wednesdays at 3am
would park a Thursday claim for six days while the player sat freely
addable every morning in between. Where free agency never opens at all,
waiver_hold_until() is the only clock there is, and that is the fallback.

One more hole while we were in there: the sweep runs from the team screen,
not from the stroke of ten. A screen already open renders a live ADD on
state up to fifteen seconds stale, and the first click beat a claim that
was due before the clicker arrived. add_free_agent now settles due claims
before adding, under the advisory lock it already holds.

The screen says all of it: each pending claim shows when it clears, from a
shared formatter both hosts print from, and the pool header leads with what
works now — "💸 bids only — free agency opens 10 AM ET" — rather than a
padlock and an hour you cannot use, which the founder read as shut while
standing in front of a board of live BID buttons.

The probe that should have caught this asserted the bug instead: fo13a
read "and the run resolves it". It now asserts the rule, and §3b and the
new §4c cover the off-league fallback, fa_opens_at, and the add-vs-claim
race. 92 suites pass.

### v0.403.0 — the button has to offer the claim

Founder, after 0288 went live: "waivers are still closed and it says FA
starts at 10AM."

They were, because the fix had only a server half. 0288 taught
submit_waiver_claim to take a claim on a player free agency cannot reach
right now — but neither client ever asked it to. Both read the same two
lines, written back when a shut window only ever gated instant adds:

    const onWaivers = waivedFor(p) != null;
    const blocked = !!team.roster_issue || (left == null && team.fa_open === false);

Only a DROP sets waived_until, so ~700 of his 703 players carried no hold.
First line: every one of them routed to add_free_agent, which correctly
refuses outside the window. Second line: the button was disabled anyway.
A greyed-out ADD and a header reading "🔒 FA opens 10 AM ET" is exactly
what "all the waivers are closed" looks like from the outside, and it
stayed true for as long as the client shipped those lines — the migration
underneath was invisible.

So both hosts now ask the server's question. A player is on waivers if he
carries a hold OR free agency is shut; the roster-limit lockout is the only
thing left that disables the button, and the label says which door you are
using — BID in a FAAB league, else CLAIM, else ADD. The pool header
finishes the sentence instead of stopping at the bad news: "🔒 FA opens
10 AM ET — until then, claims only", and in a league with no free agency
at all, "🔒 no free agency — claims only".

Claims on an unheld player do resolve: process_waivers has always taken
`waived_until is null or <= now()`, so they clear on the next run like any
other. Web and app, same three edits each.

### v0.402.0 — a closed window is what waivers are for

Founder, at 11pm ET on a league whose free-agency window opens at 10am:
"all the waivers are closed."

They were. Reproduced before touching anything, in a league shaped like
his — FAAB, a 10:00–11:00 window, the clock outside it:

    ADD   a never-dropped player -> free agency is closed — open 10 AM ET…
    CLAIM the same player        -> player not in pool

Both doors shut on the same man, and there are seven hundred of him: only
a DROP sets waived_until, so every player who went undrafted has none. For
the twenty-three hours a day the window is closed, most of the pool could
be neither added nor bid on.

This is the hole 0287 found and closed one size too small. That migration
asked "does this league have free agency at all?" and exempted only the
'off' mode; the right question is whether free agency can reach the player
RIGHT NOW. fa_window_open() already answers it and subsumes 'off', which
can never be open. A closed window is precisely the state waivers exist to
cover.

The refusal when the window IS open also stopped lying: an unheld player
now reads "free agent — add him directly" rather than "player not in
pool", which was never true — 0287 already refuses a slug that genuinely
is not in the pool, a few lines above.

### v0.401.0 — the matchup screen opens on the week you're about to play

Founder: "When you go to matchup in a classic league you should go to the
current week that is to be played if it is Wednesday or later."

TWO THINGS WERE WRONG and only one was the rule.

The APP never asked the question. Its matchup screen called the week-LESS
myMatchup, which is `.order('week').limit(1)` — the league's FIRST week,
for ever. It would have opened week 1 in December. myMatchupFrom's own
comment records this exact bug being found and fixed for the leagues list
back in v0.364.0; the matchup screen kept the old call. It now asks
defaultOpenWeek, the same rule the web uses.

And the web's rule rolled over too early: a week was held until its last
kickoff + 4 hours, so the screen jumped to next week the moment Monday
Night Football ended, around 00:30 ET Tuesday. Tuesday is when you read
what happened. A week now stays open until the first Wednesday 00:00 ET
after its games are done — which is the founder's line, and the simpler
thing to say.

The rule moved into core as a pure function, because every interesting
case is a calendar edge: Tuesday 23:59 against Wednesday 00:01, a week
with no Monday game, a week with no slate at all, preseason numbering
that sorts by kickoff rather than by integer, and the November DST change
where Wednesday midnight ET is 05:00Z rather than 04:00Z — a fixed −4
offset would turn the page an hour early for exactly the half of the
season that decides seeding. Fifteen parity assertions, each a fixed
instant rather than a day somebody waits for.

Found while writing them: the block ran AFTER check-draft-spots' own
process.exit and never executed — passing silently, proving nothing. The
summary line now prints last, so a block appended below it still runs.

### v0.400.0 — free agency can be turned off

Founder: "how do i turn off free agency and just do faab waivers?" He
couldn't. FAAB was already a waiver mode and three knobs came close —
waiver_hold_days, fa_after_waivers_dow, the fa_start/fa_end window — but
all three miss the same case: a player who was NEVER ROSTERED has no
waived_until, so the moment the window opens he is free, for nothing, to
whoever refreshes first. And the window is a RANGE, not a switch: the
setter refuses a start equal to its end, so "never" was not expressible.
The nearest thing was a one-minute window at 4am.

0287 adds fa_mode — open | window | off — as a MODE rather than a flag,
because the window already encoded two of those three states implicitly
and a bare `fa_off` beside it would leave two settings disagreeing about
one question. Unset reads FROM the window, so nothing needs migrating: a
league with hours reads 'window', one without reads 'open'.

The gate lands in fa_window_open, which every add path already consults —
one place, not a check copied into each caller.

AND THE HOLE THE PROBE FOUND, which would have shipped the feature
broken: submit_waiver_claim refuses a player whose waived_until is null
("player not in pool"), because until now the answer was always "add him
directly." With free agency off there is no directly — so an undrafted
player would have been refused by add_free_agent for having no free
agency AND by the claim for having no hold. Unobtainable by any route,
half the pool frozen. Those two checks now apply only where free agency
exists. A probe runs the whole market the founder asked for: FAAB on, FA
off, a $7 bid on a player nobody drafted, resolved onto the roster and
paid out of the wallet.

Commish UI in both hosts gains a third choice — 🚫 NONE — WAIVERS ONLY —
which says in place what it means, and says to switch the mode to FAAB if
the league is still on priority waivers.

### v0.399.0 — draft straight from your queue

Founder: "and then a way to draft directly from your queue." A DRAFT
button (NOM in an auction) on every queue row, both hosts.

The queue is where you already made the decision. Until now it could only
be reordered and pruned, and taking the man at the top meant going back to
PLAYERS and finding him again in a list of eight hundred while a clock ran
— which is also why people left autodraft on when they were sitting right
there.

It calls the SAME act() the players row calls, with the same guards, so
the two lists cannot disagree about what is legal: the position-cap LIMIT
state, the auction's "the draft is paused" and "it's not your nomination"
answers, and the commissioner's ASSIGN mode all behave exactly as they do
in the list. A player already on the auction block reads UP rather than
offering a nomination that would collide with his open lot.

A drafted player stays in the queue struck through as TAKEN, which is what
already happens when somebody else takes him — the queue is a record of
what you wanted, not a to-do list that empties.

And the queue row now carries everything the PLAYERS row carries —
position pill, team, pool rank, dynasty value, ADP, projection, ownership
and the flag chip, in the same order and the same formatting, with the
name opening the same player card. A queue you have to leave to check a
projection is a queue you check somewhere else. The app's queue row has a
fixed height that the drag-to-reorder also divides a finger's travel by,
so it went 44 → 54 in the one place that governs both.

Client only; no migration, no probe run needed (nothing SQL changed).

### v0.398.0 — a rookie filter on the draft board

Founder: "And a rookie filter on the draft player list." A 🌱 ROOKIES
chip beside the position chips in both draft rooms.

Client only — years_exp already rides league_pool and the waiver wire
already knows what a rookie is (0172's TenureBand). Two things had to
change to reuse that rather than invent a second answer.

The draft room loaded years_exp ONLY when some roster spot filtered on
tenure, which is precisely backwards for this: a league with no
tenure-filtered spot is exactly the league that wants the chip, and its
map would have been empty. It now loads once per room open, and the chip
only appears once the map has arrived — an empty map behind a live filter
hides every player and reads as broken rather than as empty.

And tenureMatches lets a team unit (K/DST/HC/P) pass EVERY band, because
a rookies-only SPOT must still accept a D/ST. A browse filter is the
other question: "show me rookies" is not answered by every kicker and all
thirty-two defenses. Rather than let the two drift — which is the bug
v0.258.0 had to go and fix — the helper takes an explicit
`teamUnits: false`, and only the browse filters pass it.

### v0.397.0 — who is actually in the draft room

Founder, after the draft: "Also need an indicator on the draft board if a
team is active in the draft and not absent in the draft room. And commish
needs a way to set players to auto. And then players can take them selves
off auto."

The last two already existed and neither was findable: the manager's
AUTODRAFT chip lives in the QUEUE tab, the commissioner's per-seat
switches behind CONTROLS ▾. Both are now ALSO on the live draft card,
where the decision actually gets made — same two RPCs, no new
permissions (set_autodraft has always taken the seat's owner, the
commissioner or an admin).

Presence is new (0286). A heartbeat, not a connection: every client
already polls, so draft_here() marks the caller present and hands back
everyone's last beat in the same round trip — one call every 10s, no
extra fetch. It returns a TIMESTAMP rather than a boolean, so the client
decides what stale means (40s, four missed beats, shared in core so the
hosts cannot disagree) and a client that dies fades out instead of lying
"here" forever. Keyed by person, reported by seat: a co-managed seat is
lit while either of them is there.

On the card: a roll-call row — ● in the room, ○ away, 🤖 autodrafting —
and for the commissioner each chip is the autodraft switch for that seat.
On the on-clock line, the thing everyone is staring at: "⚠ NOT IN THE
ROOM — the clock will put them on autodraft". Seats with no manager show
a dot rather than a circle; they cannot be absent.

### v0.396.0 — a timed-out seat goes on autodraft, and the draft has a log

Founder, mid-draft: "We need a way that teams that time out and auto get
set to auto draft. We also need a draft log." Built during the draft,
merged after it, on his call.

TIMEOUT → AUTODRAFT (0285). A clock that ran out used to cost the room one
pick's wait and then the seat was a live human again, so a manager who had
wandered off made everyone sit through every one of their picks. The two
places in draft_tick where a live human's deadline is found behind us — the
snake pick and the auction nomination — now flip the seat to autodraft
first, so the pick that follows is already an autodraft pick and the seat
is not waited for again until the manager turns it off (the AUTODRAFT chip
both hosts already show). The manager gets a push, because the person who
timed out is by definition not looking at the room; mirrors the worker's
on-the-clock push, skipped in a practice room.

THE DRAFT LOG (0284). The board shows what the draft IS; nothing showed
what HAPPENED — an undone pick was simply gone, a forced pick looked like
any other. One append-only table, written by TRIGGERS on the rows the
draft already writes rather than by editing eight RPCs (0179's argument:
a rule on the table cannot be bypassed by the path nobody remembered).
The actor is auth.uid() at write time, so one insert reads "pick",
"forced by the commissioner" or "autopick" from who did it; a single
deleted row is an undo, many at once is a reset and the draft row logs
that one line. Logged: every pick, autopick, award, nomination, removal,
edit, reset, start/pause/resume/complete, every autodraft toggle by a
person, every timeout. Not logged: individual auction bids — the award
carries the price. LOG tab in both draft rooms, newest first, one shared
formatter in core so both hosts say it the same way.

### v0.395.3 — an IR spot is not a round, in a practice room either

Founder, in a room made on the fixed build: "Draft says 21 rounds but
the mock has 24" — then, with a fresh one: "Still 24."

His league is a 24-spot roster with 3 IR spots. IR spots are not drafted
(0193: `rounds` is what a team may hold, `stash_slots` how many of those
the draft does not fill), so its draft is 21 rounds and its lobby says
so. 0281 copied `rounds` = 24 and then forced `stash_slots` to 0 — "so
you draft the whole roster" — which is exactly wrong for IR: three spots
nobody drafts became three extra drafted rounds. Reproduced before the
fix: source lobby 21, room lobby 24.

0283 carries `stash_slots` across as it is. Keepers stay at 0, because a
keeper is a pre-draft designation the room does not have. The probe
fixture now builds its source through the real roster RPCs — three spots,
a bench, a taxi and one IR spot — and asserts the room's `draft_state`
rounds equal the source's: 10 of 11, not 11. It did not catch this
before because it wrote `roster_shape` straight into settings_json,
which skips the sync that sets `stash_slots`; the bug lived exactly in
the gap the shortcut jumped over.

### v0.395.2 — you can delete a practice room on your phone

Founder, in a practice room on the app: "How do I delete the mock?"

You couldn't. The web has had 🗑 DELETE MOCK in the draft room's COMMISH
row since mocks existed, and a delete on the mock card in the leagues
list. The app had neither — only the 🤖 MOCK badge. So a practice room
opened on a phone could never be closed from one, which v0.395.0 turned
from a curiosity into a real problem by putting the button that creates
them in front of every member.

The app's draft room now carries 🗑 DELETE PRACTICE ROOM in the same
COMMISH row as the web, in both the live and the complete states.

It also needed a way to say the league is GONE, not merely left: the
app's back handler keeps its open-league handle unless the seat is null,
so deleting through onBack would have returned home still pointing at a
row that no longer exists. A new onDeleted clears the handle; it falls
back to onBack when a host does not pass one.

### v0.395.1 — a practice room wears the league's roster

Founder, on a room v0.395.0 had just made him: "Did the mock draft lock
the roster spots? Why are there 24 roster spots?"

The second question was a bug I shipped an hour earlier. 0281 copied the
DRAFT — rounds, mode, clocks, caps, the pool — and nothing describing the
ROSTER those picks land in. The builder's spots, the bench/taxi/IR counts,
classic scoring, PPR, best-ball flags, admitted positions and the pool
filter all live in settings_json under keys create_native_league never
writes, so the room came up with a DEFAULT nine-spot lineup while carrying
the source's 24-round count. Measured before and after, not reasoned
about: a source with all of those set produced a room where every one of
them was NULL.

0282 copies them, by ALLOWLIST rather than cloning settings_json — the
whole blob would drag in a format's vampire seats, the keeper and contract
continuity 0281 deliberately zeroes, and whatever key is added next. The
list is exactly what league_game_mode() serves: if a screen consults it to
decide what the roster looks like, the room copies it. A probe sets a key
outside the list on the source and asserts it does NOT come across.

The first question: no. The shape lock reads `draft where league_id =
p_league_id` — its own league's draft. A practice room starts the ROOM's
draft, and 0281's probes already assert the source's stays pending. The
locked editor was the practice room's own, which is correct.

### v0.395.0 — practice rooms: mock THIS draft, from your seat

Founder: "everyone gets their own practice room and you can pick what
spot you draft from. It's just a practice right now so that players can
see how drafting works."

Mock drafts have existed since 0070, but they could never mock a league
you are in: create_mock_draft takes settings typed into the create-league
form, seeds a generic pool, and — calling a twelve-argument
create_native_league that has since grown to fifteen — lands on
p_game_mode's default. Every mock was a drip redraft league, whatever you
meant to practise for.

A PRACTICE ROOM points the same machinery at a real league: same game
mode, roster size, draft mode, clocks and caps, the same player pool
copied row for row (not rebuilt — the copy carries pool-doctor repairs and
commissioner edits a rebuild would lose), and the AI seats wearing your
leaguemates' names. You choose the slot you draft from, because on a snake
the difference between 1st and 12th is the thing worth practising.

Everyone gets one, which forced the gate to move. create_native_league
refuses anyone without the `native` feature flag, but native_join has
never required it — you can be seated by invite code without it, and those
managers are exactly who this is for. So the builder splits the way
start_draft did in 0177: the body moves once into
_create_native_league_now(), create_native_league becomes the flagged door
onto it, and a practice room checks membership of the league it is mocking
instead.

Deliberately not: keepers (keeper_slots and stash_slots are forced to 0,
so you draft the whole roster rather than the eight rounds a keeper league
leaves), a schedule (so 0179's kickoff lock and 0280's shift both read "no
season"), or any write to the source league. Rooms sweep themselves —
opening one bins the caller's own rooms older than two days, never anyone
else's and never a real league.

### v0.394.7 — the download says which build it is (web only)

Founder: "There should be an APK release path on the site rather than the
chat." There already was one — `release-apk.yml` has published every
merge that touches the app to one fixed URL since it landed, and the site
links it from the gear menu, the leagues-page chip, #/changelog, the FAQ
and onboarding. What was missing was any way to tell what you were about
to install: the card said "always the newest" and asked you to take its
word, while a release published minutes earlier might still be building.

#/changelog now reads the same manifest.json the app has always read and
names the build, the version it carries and when it was published — and
warns when the site is ahead of it, which it is for about ten minutes
after every release.

The durable half is a doc fix: `docs/next-session-prompt.md` still
described hand-building an APK and attaching it to chat as the delivery
ritual, written before CI existed and never updated. That is why APKs
kept arriving as files. It now says the answer to "apk please" is the
link, and that hand-building is for testing uncommitted work on a device.

### v0.394.6 — the schedule starts on a week you can play

The other half of v0.394.5. 0279 got the draft through; this is what
happened the morning after.

`native_generate_schedule` always numbered weeks 1..N against that NFL
week's real kickoff, and the creation flow runs it the moment a league is
made — so a league created in week 2 got a week 1 whose games had
finished days earlier. Nothing ever clears it: the worker's
`finalizeMatchups` only moves live → final, and `lockDueMatchups` is
scoped to the worker's current NFL week, so a stale `scheduled` week is
never flipped live in the first place. Measured, not reasoned about: 28
matchups, all scheduled, week 1's lock_at a week in the past,
`league_live_week` pinned at 1.

Everything keys off that number, so the league seizes — 0179's kickoff
lock armed against every player with a game in the dead week (no adds,
drops, waivers or trades, ever), 0178 refusing lineups for the week
that's showing, no scores, no report, standings frozen at 0-0.

0280 does two things. Generation starts at the first week of the season
that hasn't kicked off; a league made before week 1 is byte-identical to
before, and a probe asserts that by fingerprinting the pairings and
sides. And a league already carrying dead weeks heals itself at the two
doors onto `_start_draft_now` — there is no regenerate button, so this
could not be left to somebody noticing. It shifts rather than
regenerates, so pairings survive, re-points each week's lock_at, stops at
the playoffs, and refuses once anything has been played. `native_reschedule`
and a COMMISH button cover a league that already drafted into the state.

### v0.394.5 — a draft can run after the season has started

Founder, hours before a live draft: "running a draft in kickoff league
tonight… with the season already started that might be a hiccup."

It was the whole evening. 0179 stops a classic player moving on or off a
roster once his game has kicked off, and a draft pick is exactly such a
move. In a classic league whose schedule is generated and whose current
week has started, every human pick was refused — while the worker's
autopick and an admin's picks went through, because both are exemptions
in that trigger. The room would have appeared to draft itself and
rejected every manager in it, with commissioner undo, edit and reset
refusing too. Reproduced in scratch before the fix, not reasoned about.

0279 adds one exemption: a draft that is not `complete`. Not "before week
one" — a draft at any point in the season. The lock re-arms the moment
the last pick lands, and a probe suite that builds a league shaped like a
real one (schedule generated, week 1 kicked off) holds both halves.

Three smaller draft-night repairs alongside it:

* the worker logged nothing when `draft_tick`, `process_waivers` or the
  autostart sweep failed — supabase-js returns `{error}` rather than
  throwing, so a dead clock looked like a quiet one;
* the pick button's busy latch was React state, so a fast second tap at a
  snake turnaround could fire two picks; it is a ref now;
* a failed `nativeTeamState` at mount left every DRAFT button disabled
  with no retry — it now retries every 4s until the team loads — and the
  client's own tick is floored at 3s so a seat that cannot find a legal
  player stops hammering the RPC twice a second.

### v0.394.4 — a cleared spot is cleared on the server too

Founder, on v0.394.3's "not fixed" note: "let's do that clearSlot fix
too." v0.394.3 swept the stranded rows only when something else happened
to be refused, so the orphan was still CREATED on every clear and simply
waited for a cap to trip over it.

The prune now runs whenever the LINEUP'S SHAPE changes, not only on
failure — a slot cleared, an extra slot removed, picks compacted — and
before the write, because a stranded row counts against every cap while
it is still there. A save that only swaps a player or a metric leaves the
shape alone and stays a single round trip; the first save after a mount
always reconciles, which is what heals a board that is already stranded.

Both live autosaves now also pass the week's still-OPEN windows, so a
window whose LAST pick was cleared is reconciled too — it names no rows,
so without that list it was invisible to the prune and kept its whole
lineup on the server. The bounds are unchanged and are the load-bearing
part: `locked = false` (a sealed pick is never the client's to remove),
open windows only, and callers may only ask once their lineup has
hydrated.

Considered and rejected: writing cleared spots as empty rows instead.
It cannot see a slot that no longer EXISTS — a removed extra slot — which
is one of the two ways a board strands a row.

### v0.394.3 — the second Combo Drip nobody could see

Founder, with v0.394.2's banner now naming the slot ("NOT SAVED — SUN 1PM
· 1: Combo Drip is one per unlock"): "I only have one combo drip set."
He was right. The board showed one. The DATABASE held two.

`clearSlot` only ever changed local state — it deletes the key and
`compactPicks` shifts the rest upward — and the live autosave SKIPS empty
slots (`if (!p?.playerId) continue`). So the row a cleared spot left
behind stayed in `sealed_pick` forever, stranded at a slot index the
board no longer renders. `enforce_single_combodrip` counts every
combodrip row for the matchup, visible or not, so one orphan capped the
lineup permanently with nothing on screen to remove.

`pruneStaleSlots` (liveApi): before the row-by-row retry, delete this
user's picks in the batch's windows at slots the batch does not name.
Bounded on purpose — `locked = false` so a sealed pick is never the
client's to remove, and only inside windows the batch is writing (the
caller has already filtered those down to the still-open ones), so local
state that has not hydrated can never empty a lineup. Best effort per
window, since the 0178 lock trigger fires on DELETE too.

On the FAILURE path only, so a healthy save still costs one round trip.
The board self-heals on its next autosave — which fires on mount — so a
reload is enough.

NOT FIXED HERE — done in v0.394.4 below: `clearSlot` still leaves the row,
so the orphan is created in the first place and is only swept when
something else refuses.

### v0.394.2 — one bad pick no longer blocks the whole lineup

Founder, over a board reading SLOTS SET 8/8: "what's up with the not saved
alert?" The banner read "⚠ NOT SAVED — Combo Drip is one per unlock — you
own 1, buy another to field more", and it was telling the truth: nothing
in that batch had reached the server.

A Postgres upsert is ONE statement, so any row a trigger refuses rolls
back every other row with it. The live boards autosave the WHOLE lineup
1.5s after every edit — so one over-cap Combo Drip blocked every other
pick in the lineup, on every retry, forever, while the slot counter (local
state) kept reading full. The banner named the RULE and never the SLOT.

THE THIRD TIME this shape has bitten, and the code's own comments record
the other two: a locked window once painted a permanent NOT SAVED banner
over a fully-saved board, and the slot-cap trigger once made an 11-slot
practice board "only keep 8". Both were patched with a targeted
client-side filter — whack-a-mole, since the next rule the client does not
mirror does it again. So this fixes the SHAPE:

- `liveApi.savePicksBestEffort` — try the batch (one round trip, the
  common path); when it is refused, re-send the rows ONE AT A TIME, in
  order, so a cap keeps the picks made FIRST. Returns `{saved, failed}`
  and never throws for a refused row: a refusal is an answer, not an
  outage. Both live autosaves (web Matchup, app LivePicks) use it.
- `savePicks` is UNCHANGED and still atomic — the classic boards need it:
  a move is "player into the target spot" + "player out of the spot he
  left", and landing one without the other stands a man in two places.
  Those callers revert their optimistic board when it throws.
- `core data/pickSave.ts` — `pickFailureNote` turns refusals into
  "NOT SAVED — SUN 1PM · S2: <the server's own words>", the slot first
  because that is the actionable half. Static window labels so the line
  points at something on screen. `check:picksave` (14 pins) in parity.
- The app only fires `lineupSet` when picks actually landed; a fully
  refused batch is not a lineup set.

No migration, no schema change. APK.

### v0.394.1 — Gridiron Gang's rosters actually sync

Founder, the morning after waivers ran in both leagues: "when do rosters
sync?" The cadence (0319: 20 minutes through the 04:00–10:00 ET waiver
window, hourly otherwise, tightening to a minute at each kickoff) was
right — but `syncAllLeagues` only walks `PILOT_LEAGUE_IDS`, and that was
ONE id. The worker's own log said so and nobody had read it that way:
"weekly sync: week 2 — 1/1 leagues".

Gridiron Gang therefore never mirrored its Sleeper rosters. What made it
look healthy is the MEMBER sweep, which does cover every current-season
sleeper league and logs `member sync: 1393005400290267136 → 12 seats`
every ten minutes — but it writes `league_membership` (team names, owners)
and never `sleeper_lineup`. So the board's player pool was whatever it was
the last time somebody pressed ⟳ (0204's manual request).

`fly.toml` now lists both ids. This also decides how fast v0.394.0's
dropped-pick cleanup bites: it fires on the `sleeper_lineup` rewrite, so
a waiver drop in either league now clears its open lineup spots within
the cadence instead of waiting for a manual refresh.

WATCH THE NEXT DEPLOY LOG: a same-named Fly SECRET overrides `[env]`, and
the tell is the count — "2/2 leagues" means this took, "1/1" means a
stale secret is winning and needs `fly secrets unset PILOT_LEAGUE_IDS`.

### v0.394.0 — a dropped player leaves the lineup

Founder: "if someone assigns a player to a spot but then drops him from
their external league or native league, we need to remove them from the
spot as long as it is unlocked." 0072's `enforce_legal_roster` only ever
checked the roster when a pick was WRITTEN; a pick made and then orphaned
by a drop stayed in the spot and scored zero.

Migration 0278, all in the database so every drop path is covered:
- `_pick_still_open(pick, week, league)` mirrors the 0178 lock rule a
  manager's own delete is held to — the row's `locked` flag, a windowed
  pick's kickoff less the hour lead, a classic pick's own player kickoff,
  a week hold — so the cleanup never trips the delete trigger.
- `_clear_dropped_picks(league, roster, slug)` deletes the seat's
  still-open picks on that player (rows written by the seat's manager or
  its agent, on matchups where the seat is a side), each under its own
  guard so a drop can never fail because of its lineup.
- **native**: trigger on `native_roster` after DELETE (drop_player,
  add_free_agent with a drop, waivers, the guillotine, commish moves) and
  after UPDATE of roster_id (a trade away).
- **external**: trigger on `sleeper_lineup` after INSERT or UPDATE of
  starters_json (the worker's sync) — any open pick on a player the synced
  roster no longer carries goes. External leagues ONLY: a native league's
  row is a materialized copy of native_roster (0252) and must not speak for
  it (the sim-run probe's deliberately stale pool caught exactly that). An
  EMPTY synced roster clears nothing (a failed fetch is not twelve drops).
dropped-pick probes (16) in the runner. No client change; a board that is
open when the drop lands shows the empty spot on its next refresh.

### v0.393.5 — the rehearsal strip is off unless asked for

Founder, a week into the season, on a real league's board: "REHEARSAL ·
v0.393.4 week 1 · DONE … RESET WEEK 1 — let's get rid of all these
rehearsals or make them just for me." The strip was already the server's
to grant (super-admins only) and only on 🧪 LIVE TEST leagues — but every
league the founder ever rehearsed in stays flagged, and the founder IS the
admin, so it sat on real boards with a red reset button.

`packages/core/src/data/rehearsalTools.ts`: a per-device switch, off by
default (`rehearsal:tools` in platform storage, with change listeners).
Both SimStrips (web `src/screens/SimStrip.tsx`, app `ui/SimStrip.tsx`)
render nothing — and probe nothing — while it is off. The gear shows an
admin-only 🧪 REHEARSAL TOOLS row on both hosts: "SIM STRIP HIDDEN" /
"✓ SIM STRIP ON BOARDS". No migration. APK.

### v0.393.4 — week 1 reported; a tie is a tie; an undrafted league says nothing

v0.393.3's first tick closed week 1: `[report] wk 1 gate — … ready`, seven
reports posted, 23 pushes delivered. Two things the first real run showed:
- "Team 3 edged Team 6 by 0.0" — a tie. `headlineOf` now reads "Team 3 and
  Team 6 tied at 88.0".
- "dachhack led the week with 0.0" in two leagues that haven't drafted
  (every final stamped 0.0). `reportHasScores` gates the automatic post: an
  all-zero week is remembered as done and nothing is said; an admin
  request still forces it, with the headline "closed with no games
  scored". The two zero lines already posted are the commissioner's to
  delete (✕ on the web, long-press in the app).
- Founder, mobile web: "the weekly report is behind the chat." The chat
  panel is a ModalBackdrop at layer 70 and `Sheet` defaults to 60 (below
  the modal layer on purpose). `Sheet` gains a `zIndex` prop; the report
  opens at 80.

### v0.393.3 — the week Sleeper rolled off still gets closed and reported

Why week 1 never reported: ESPN's week 2 kicks off Thursday, so "Monday
(last night)" was week 1's final — and Sleeper had already rolled the
worker's regular-season context to week 2 by the time the report feature
deployed. `tickContext` only ever looked at the current week; week 1's
completed branch (finalize → stamp → report) belonged to a week nobody
ticked any more. The 0277 request sweep lived inside that same branch, so
an admin's forced request would not have been picked up either while week
2's games were still ahead.

- `closeWeek(tag, week, games, season, regular)` factors the completed
  branch; `closePriorWeek(regWeek)` runs it for `regWeek − 1` on every tick
  (once per five minutes, one cached scoreboard fetch) when that week's
  games are all complete. Each step is idempotent, so a closed week costs
  one query.
- The request sweep moves to `tick()` itself, after the contexts — every
  tick, whatever the week is doing.
Worker only; no migration, no APK.

### v0.393.2 — "Let's make the weekly reports": the gate is visible, and an admin can force one

Founder, the morning after week 2 closed. The worker had posted nothing and
said nothing: `postWeekReports` reports a league only when every matchup of
the week is `final` AND stamped and the league's season string matches, and
each of those failing was silent. Without a database in hand there was no
way to tell which.

- **The gate is logged** (server/src/report.js): once per week and again
  whenever it changes — `[report] wk 2 gate — Kickoff League: 5/6 final,
  6/6 stamped · Other: posted` — so the deploy log answers "why no report?".
- **0277 `report_request`** + two admin RPCs. `admin_week_report_state`
  (league, week or null for the latest) returns the counts the worker gates
  on, the status breakdown, whether the report row and its chat line exist,
  the league's season, and the latest request. `admin_request_week_report`
  queues a FORCED build: the worker sweeps requests every tick, builds from
  whatever finals exist (status and season not consulted), overwrites the
  stored payload, replaces the chat line rather than doubling it, and stamps
  the request done (or its error: no matchups / nothing stamped).
- **AdminPage → ADMIN MODES** gains 📋 POST WEEKLY REPORT with a week box
  (defaults to the league's latest week) and a gate line underneath:
  "wk 2: 6/6 final · 6/6 stamped · report — · chat line — · season 2026";
  polls while a request is open so it flips to done in front of you.
- `buildLeagueReport` now always includes the requested week's rows (a
  forced build of a week whose rows aren't `final` yet read "no games
  scored"). week-report probes wr26–wr37; worker test gains the request
  cases.

### v0.393.2 — GET THE ANDROID APP on the leagues page

Founder: "add a 'get the android app' button on the leagues page." A
solid chip in the leagues page's control row, right-aligned ahead of
🔎 FIND A LEAGUE and ＋ ADD A LEAGUE: the apk-latest download, the same
link ⚙ and #/changelog carry. Web only.


### v0.393.1 — the push log names each device

Founder: "I'm getting the alerts on the web installed as app on my phone
but not in my desktop chrome." One outbox row can go to a phone and a
browser, and flush kept only the LAST device's error — so a phone success
hid a browser refusal and the log read "delivered". The worker now records
per-device outcomes in the error column: null when every device took it,
"phone refused: …" / "browser refused: …" for each refusal, prefixed with
"delivered to N ·" when some did. `pushLogStatus` reads it back: ✓
delivered, ◐ partial (the text says which device refused and why), ✗
refused. Worker + core; the app shows the new text on its next APK.
push-flush test gains the two-device case.
### v0.393.0 — the changelog is real, the app knows when it's behind

Founder, right after the APK got a link: "can you add the link to the site
too? Can we have an in-app check that alerts users if they have an older
version. 'You are X versions behind.' click for change log (i guess we
need to keep a change log now too)."

THE LOG WAS ALREADY KEPT — this file has carried a `### vX.Y.Z — title`
section per version for months. `scripts/gen-changelog.mjs` turns those
into `public/changelog.json` at web build (149 entries today), and
`check:changelog` (in check:parity) fails when APP_VERSION has no entry,
which is what makes the log stay kept. Core `data/changelog.ts` holds the
types, the URLs (APK, its manifest, the changelog, the site page) and the
arithmetic: `versionsBehind` counts entries newer than a build and no
newer than the newest APK, skipping web-only ones — a site fix is not a
reason to reinstall.

WEB: `#/changelog` (⚙ → What's new) renders the log with the Android
download at the top; ⚙ also gains "📱 Android app (APK)"; the FAQ's app
answer says Android yes, with the link, iOS not yet.

APP: `useUpdateCheck` fetches the release's `manifest.json` (newest APK
version; release-apk.yml now publishes it beside the APK) and the site's
changelog at launch and on every foreground. Behind → a strip under the
header: "YOU ARE N VERSIONS BEHIND · vX IS OUT · WHAT'S NEW →". Tap → the
What's New sheet: the entries between this build and the newest, a GET
vX button (opens the APK URL; installs over the old build), and the full
log on the site. Settings gains a What's new row that lights when behind.
Nothing when current or offline. Web + app + core; APK via release-apk.

### One link for the APK — release-apk.yml

Founder: "is there a link to the apk I can send users?" There wasn't: every
APK was built in a session and handed over as a file, and the repo has no
releases. New `release-apk.yml` runs the session ritual in CI (expo
prebuild → gradle assembleRelease, arm64, playtest keystore; the same
three checks — versionCode, signer CN, APP_VERSION in the bundle) on every
merge to main that touches apps/mobile or packages/core, or on demand, and
republishes the result under ONE fixed tag, `apk-latest`, so the download
URL never changes:
https://github.com/dachhack/ffgame/releases/download/apk-latest/drip-fantasy.apk
The repo is public, so no GitHub account is needed to download.
versionCode = 40000 + run number (monotonic, past the hand-built 36943).
Each run deletes and recreates the release so the tag rides the built
commit. Documented in apps/mobile/README.md.

### v0.392.1 — a browser re-subscribes on every visit, not only from the card

Founder added the `VAPID_PRIVATE_KEY` secret and re-ran the worker deploy;
the run staged it and the restarted worker delivered a push on its first
sweep. Left over from the key rotation: `webPushState` (which replaces a
subscription made under the old key) ran only when the notifications card
was opened, so a browser that never opened it kept a dead subscription.
`initPwa` now calls it after the service worker registers whenever
permission is already granted. Web only, no migration, no APK.

### v0.392.0 — why the alerts weren't coming through, and a way to see it

Founder: "Can we check the browser and mobile alerts. They are not coming
through even though I have them on." Four things, found by reading the
worker's own log out of the deploy run and the two clients:

1. **The browser channel never had a key.** deploy-worker.yml has logged
   "VAPID_PRIVATE_KEY secret not set — skipping" on every run since web push
   shipped (v0.194.0). The private half of the committed pair never reached
   the server, so every browser push ever queued sat in the outbox. Fixed by
   ROTATING: a fresh pair (`scripts/webpush-keygen.mjs`), its public half
   committed in `src/app/webPush.ts`, its private half handed to the founder
   for the `VAPID_PRIVATE_KEY` repo secret. A browser still subscribed under
   the old key is re-subscribed silently on its next visit (`webPushState`
   compares the subscription's applicationServerKey to ours).
2. **Parked rows walled off the queue.** flush read the outbox oldest-first,
   fifty at a time, and a row whose only devices were on the credless
   channel was skipped silently and re-fetched every sweep. Enough browser-
   only recipients and the page was nothing but them: phone pushes behind
   them never went. Such a row is now marked `waiting-vapid` / `waiting-fcm`
   (sent_at still null) and left out of the fetch while that channel is
   credless; the moment keys land it is picked up again.
   `server/test/push-flush.mjs` pins it.
3. **The app ate every foreground push.** expo-notifications shows nothing
   for a push that arrives while the app is open unless a handler says so,
   and none was set — so with the board open on a Sunday, alerts vanished.
   `setNotificationHandler` (banner + shade + sound) in `ui/push.ts`.
4. **Nobody could see any of this.** 0276 adds `push_test()` (queues one
   outbox row for the caller, to every registered device; one per 30s) and
   `my_push_log()` (the caller's last dozen outbox rows and their devices).
   Both hosts' notification prefs gain 🔔 SEND ME A TEST PUSH and a RECENT
   PUSHES list that polls every 8s: ✓ delivered / ✗ refused (with the push
   service's error) / ⏳ queued or waiting on a server key. push-probes
   pu14–pu25.

The worker log also showed "[push] delivered 1 push" tonight, so the FCM
channel itself works; the phone side is the foreground handler and the
walled-off queue.

### v0.391.0 — The weekly report, in every league's chat

Founder: "Can we get a weekly report for each league in the chat? Weekly
report posts with a link you can click to open the report in a pop up."

The worker now writes the week up the moment a league's finals are all
stamped (the completed-week branch of the tick, after `stampFinals`) and
posts one line into that league's chat as **Drip Fantasy** — no author, kind
`report`, the week on the row. The line carries the headline ("Sox led the
week with 120.0. Bulls edged Cubs by 0.4. MVP Josh Allen 33.4.") and an
**OPEN WEEK N REPORT ▸** link; the link opens a pop-up (web `Sheet`, app
`Overlay`) that reads the stored payload and renders it section by section:
the week (high score, MVP, closest game, blowout, low score), a Guillotine
or Vampire section where the format has one (chopped seat / bites), every
result, and the season standings.

- `packages/core/src/data/weekReport.ts` — `buildWeekReport` (pure, from
  matchup finals + slot scores + membership names), `reportBody` (the chat
  line, under 500), `reportSections` (what both pop-ups render), `slugPretty`.
- `supabase/migrations/0275_week_report.sql` — `league_report(league_id,
  week, payload)` (RLS, RPC-only; the PK is the idempotency), `league_message`
  gains `report_week`, a nullable `author_id` and kind `report`;
  `_chat_message_json` v3 (null author → "Drip Fantasy", `mine`/`mentions_me`
  never null, `report.week`); `league_report_get` (member-gated);
  `chat_unread` v3 (a null author counted — `<>` compared it as unknown).
- `server/src/report.js` — `postWeekReports(week, season)`: one look every
  five minutes per closed week, reports a league only when every matchup of
  the week is final AND stamped, only this season's leagues, upsert-ignore on
  `league_report` then the chat insert. `server/src/push.js` broadcasts the
  line to the league once, like a poll.
- Chat renderers (`src/app/chat.tsx`, `apps/mobile/src/ui/Chat.tsx`):
  `ReportLine` + `ReportSheet`; `liveApi.leagueReport`.
- Checks: `check:weekreport` (35 pins), `server/test/week-report.mjs` (posts
  once across ticks and restarts; a half-stamped league waits),
  `scripts/db/week-report-probes.sql` (25 probes) in the runner.

### v0.390.8 — "It's not OT yet", and the Fields sheet opens on all fields

Founder, DEN@KC in the Game view: header "OT", field card "Q4 4:41".
`qClock` took the engine's 55-minute late-game mark (3300s) as the end
of regulation; regulation is four 15-minute quarters, 3600s. Now Q4 runs
to 00:01 and past 3600 reads "OT 07:12" against a 10-minute period.
Three probes in check:gameview.

"Can we also get a chip to go to the all fields view? It should open in
all fields then go to the single view when you select a game." The
leagues page ▦ fields sheet opens on the stacked all-fields list again
(FieldsList — every game, the reader bar on the 🔊 one, ‹ › on every
field); tapping a game swaps in its Game view (strip, scoreboard, field,
drive line, reader, LIVE / STATS) with a ‹ ▦ ALL FIELDS chip to come
back. The 🔊 chip on a field makes it the reader's without opening it.
Same list, same behaviour, on both boards' overlays. App + core (clock).
APK 36943.

### v0.390.7 — the leagues-page fields show THIS week, not last year's

Founder, mobile web, ▦ fields from My Leagues: DAL@PHI, KC@LAC, TB@ATL —
2025's week 1. The fields board reads whatever feeds are installed for
the week and otherwise fetches the baked 2025 file; the live board
installs the real ones on its poll, but the leagues-page entry has no
board, so it opened on last year's opener. The same gap hid the box
score, the carrier headshots and the people on each play, which read the
week's live PLAYS that only a board used to install.

Both entries now install the week themselves before opening — game feeds
AND live plays — and re-pull every 30s while up: web LiveOnboard
(loadFieldsWeek before FieldBoard mounts) and the app's AllFieldsSheet
(plays added beside its feeds). Web + app. APK 36942.

### v0.390.6 — the Fields sheet opened as a header over nothing

Founder, screenshot: ▦ fields on My Leagues opened the sheet with its
title and nothing under it. The Game view body's root was `flex: 1`, and
the Overlay sizes itself to its children (capped at 92%) — a flex:1 root
inside it has no height to fill and collapses to zero. Every other sheet
body is `flexShrink: 1, minHeight: 0` with a shrinkable ScrollView; the
Game view body and the sheet's wrapper are that shape now. App only.
APK 36941.

### v0.390.5 — a catch behind the line is one path, not a hook

Founder, DEN@KC field: "Ball path lines are getting funky." The Worthy
catch ("pass short right to X.Worthy to DEN 29 for 5 yards") drew a hook
— up from the spot, across, back. ESPN's yards-after-catch runs PAST the
gain on screens and dump-offs (YAC 6 on a 5-yard gain: caught a yard
behind the line; a third of this game's completions), and playPath split
there: the air segment ran backwards, overlapped the carry, the carry
dropped to its own lane, and the connectors drew the hook.

Rule, in the shared geometry (engine/playPath): a completed pass whose
catch sits behind the line in the direction of travel, or under two
yards of air, is one path from the snap to the stop — no split, no lane.
A real throw downfield still splits at the catch and carries on. Also
fixed while there: both hosts mirrored the arc's endpoints for the ↔
flip but handed playPath an un-mirrored xOf, so a flipped field put the
catch on the wrong side of the snap. Five probes in check:playpath (the
old "absurd YAC" clamp case now reads as one path — the clamp lands the
catch behind the line). Core + both hosts. APK 36940.

### v0.390.4 — "Tonga?": the jumbo package is not the ball carrier

Founder, DEN@KC box score: a defensive tackle with 2 carries for 7, an
offensive tackle listed as a WR with 2 carries, 66 yards and a TD.
Replayed the game offline: the gamebook lists a jumbo package's linemen
BEFORE the play — "H.Nourzad and K.Tonga reported in as eligible.
K.Walker up the middle…" — and the adapter read the first name in the
text as the rusher. Kenneth Walker lost four carries, one a 60-yard
touchdown, to the men who reported in.

Fix: `stripEligible` drops that clause wherever it sits, up to the
sentence boundary before it — in the ingest adapter (before any name is
read) and in core (gameView: playNames / ballCarrier; spokenPlay: the
voice starts at the play). Replay after: Walker 19-151-1, Tonga his one
tackle, Moore and Nourzad nothing. Probes in espn-attr (3), check:gameview
(6) and check:spoken (1). The data heals itself: each poll reconciles a
game's full play set and deletes rows it no longer produces, and finals
get the 10-minute late pass — the wrong rows go on the worker's first
pass after deploy. Adapter + core; deploy-worker.yml carries it, and the
app bundles core, so APK 36939.

### v0.390.3 — 🏟 the Game view: Sleeper's field screen, on our feed

Founder, over Sleeper's game screen: "the sleeper field view is pretty
good can we emulate this?" Everything on that screen above and below the
field is a reading off a play feed we already carry. New core
data/gameView says them once for both hosts: `qClock` ("Q2 04:33", OT),
`spotLabel` (yards-to-goal → "KC 20" / "50" / "DEN 35"), `situationLabel`
("3rd & 10 · KC 20", "2nd & Goal · KC 4"), `driveSummary` ("KC from own
20 · 3 plays · 0/2 pass · 3 yds", kickoffs excluded, SCORED flagged),
`playNames` (every gamebook name on a play, in order) and `ballCarrier`
(the receiver on a pass, the returner on a kick, else the first name).
engine/gameNames grows `resolveGamebookPerson` / `gamePeople`, so a name
becomes a slug — the headshot. 19 probes in new check:gameview.

THE GAME VIEW (app ui/GameView.GameViewBody, web FieldView.GameView):
the week's games as a strip (tap to switch; live dot, FINAL, kickoff),
the scoreboard — nicknames, big scores, the quarter clock, the situation,
🏈 on the possession side, the club codes faded huge behind — the LAST
PLAY line, the field with the ball carrier's headshot and name at the
spot (Field's new `carrierOf`), the drive line, the reader bar, and two
tabs: LIVE (plays newest first, each with its situation, text, score,
and the people on it as headshot chips with position and box-score
line — tap opens the player card; long-press / double-click speaks) and
STATS (the box score, OFFENSE / DEFENSE). App: the leagues page ▦ fields
sheet IS the Game view now (strip on top); the boards' all-fields lists
gain "game view ▸" that swaps it in place (no stacked sheets). Web: tap
a field on the ▦ FIELDS board and the enlarged card becomes the Game
view; the header reader bar stays bound to it. Not built: Sleeper's win
probability (no model) and records/broadcaster (no data). APK 36938.

### v0.390.2 — the reader follows the field you pick, and every field steps play by play

Founder: "Can we have the live play reader work on a field you select?
Also have a way to rewind or go forward each play in the field view."

THE READER ON A FIELD. The CATCH UP · LIVE · STOP bar is its own piece now
(app ui/ReaderBar, web FieldView.ReaderBar — the core PlayReader inside,
keyed by game so switching stops the old one). On the app, one FieldsList
carries every all-fields surface — the leagues page sheet and both boards'
overlays: tap a field to select it (lit border, 🔊 in its header) and the
bar at the top of the list reads THAT game; the classic board's "play
log ▸" stays its own link. On the web, the fields board binds the bar to
the field you enlarged (else the first game) — "tap a field to enlarge
it · the reader follows it". The play-by-play sheet/panel use the same
bar and only light the row being read.

‹ › EVERY FIELD, EVERY PLAY. Under the score strip: ‹ PLAY 57/112 › and
LIVE ▸. `pin` is an absolute play index (null follows the clock); pinned,
the card draws that play exactly as it drew it when it landed — ball,
arc, situation, text, the box score at that clock — and holds while new
plays arrive; › past the last goes live. Both hosts, in Field itself, so
the matchup's slot fields step too. App + web + a small core-free reuse.
APK 36937.

### v0.390.1 — every club code is a city, and the voice is a dropdown

Founder: "Let's have the voice selection a drop down. It says 'DEN' for
Denver. Can we have it say the actual team city?"

The city: spokenText read a club code as a city only before a yard line
("to the Denver 5"); everywhere else — "to KC end zone", "Timeout #1 by
DEN", "DEN challenged the ruling" — the voice spelled the code. Now every
standalone upper-case club token reads as its city (mixed-case phrases
like "No Play" and "No Good" stay, though the Saints are "NO"). Three more
probes in check:spoken (37).

The dropdown: the app's VoicePicker is one field showing the voice in
use, opening a sheet that lists every English voice best first with ✓ on
the pick; the web's is a native <select>. Both greet in the chosen voice.
Core + both hosts. APK 36936.

### v0.390.0 — ▦ fields on the leagues page, both hosts

Founder: "Let's put fields on the upper left at the top of the my leagues
page in the app and on the web experiences." The All fields sheet lived on
the board and borrowed the board's week, slate and feeds; off a board
there was no way in. Now the upper-left slot of the leagues page — the
one the exit chip takes inside a league — carries ▦ fields on both hosts:
the app shell (App.tsx, signed in and no league open) opens a standalone
AllFieldsSheet; the web live home (LiveOnboard, view 'home') opens the
existing FieldBoard with no entries, so every game gets a card in schedule
order.

Which week: core `fieldsWeekFrom(slateRows, now)` — the week whose FIRST
kickoff is the latest already past (what's on now, or what just
happened), held until the next week's opener kicks; before any kickoff,
the earliest the slate knows; ordered by kickoff, not week number, so a
preseason board week and week 1 compare by when they played. New liveApi
`slateWeeks(season)` feeds it. The app sheet installs that week's runtime
slate and game feeds itself, polls every 30s while open, pulls to
refresh; the web board's own feed hook loads the week. Six assertions in
check:fieldboard. APK 36935.

### v0.389.2 — the voice picker moves into the gear

Founder: "Let's have the voice selection in the options gear." A voice is
a preference, not a per-game control, so PLAY-BY-PLAY VOICE now sits in
Settings on both hosts — app SettingsModal (new VoicePicker, between CARD
DECK and MORE) and the web gear's SiteSettings (under DISPLAY, only when
the browser has a speech engine). Same list, best first, ★ for enhanced /
natural, a tap greets in the voice ("First and ten. Ready when you are."),
the pick sticks. The play-by-play sheet and panel lose their row and
point at ⚙ in the idle line. App + web, no core change. APK 36934.

### v0.389.1 — whole names, no pauses, and a choice of voice

Founder, first listen: "Do we have other voice options? Anything more
natural? The pauses after the first initials are a bit too much."

THE PAUSE was the period. "J.Brissett" became "J. Brissett" and every
engine reads that period as a full stop. Gone two ways. First, the box
score knows who "J.Brissett" IS: engine/gameNames builds a resolver from
everyone with a stat in the game — last name matched on letters alone
("St. Brown" meets st-brown), the gamebook's prefix against the first
name, one hit is the answer — and the voice says "Jacoby Brissett pass
short right to Michael Wilson … tackled by Derwin James". Second, a name
the box score can't place (a holder, a defender before his first tackle)
is said the way a broadcast says it: the last name alone, "Brissett";
the gamebook's disambiguating prefix survives only where it has to, as
"Mi Wilson" — no period, no pause. Read fresh per sentence, so a defender
is known by the time his tackle is spoken. Eight more probes in
check:spoken.

THE VOICE: both engines ship several. Android's Google engine marks its
network voices Enhanced — noticeably more natural than the on-device
default; Edge's "Microsoft … Online (Natural)" set is near a broadcast
read, Chrome has Google US English, Safari Samantha. Each sheet now lists
every English voice the device has, best first (★ = enhanced/natural),
picks the best by default, remembers a tap, and greets in the chosen
voice so you hear it before committing. What is installed is the phone's
or browser's; a cloud voice (ElevenLabs / Polly class) would be the next
rung and a paid one — not built. APK 36933.

### v0.389.0 — ≣ PLAY BY PLAY, read to you: catch up or live

Founder, over the app's All fields sheet: "Let's also have the option to
expand the play by play for each game and have it read off to you catch
up or live." Every field card (app All fields sheet and the matchup's
field; web ▦ FIELDS overlay and slot fields) grows a ≣ PLAY BY PLAY 🔊
chip beside BOX SCORE. App: a sheet — the game's every play in order,
scoring plays lit with the score, turnovers marked, newest kept in view;
web: the same, inline under the field. Under it, the voice: ▶ CATCH UP
reads from the top and keeps going live when it reaches the present
(or says the final and stops); ● LIVE reads the latest play now and
every new one as the feed lands; ■ STOP. Long-press (app) / double-click
(web) a row to hear just that play. The row being read is lit.

WHAT IS SAID is core's `spokenPlay` — the gamebook line as a sentence:
formation notes, clock stamps and hurry brackets dropped, initials
spaced ("J. Brissett", the "Mi. Wilson" prefix kept), club abbreviations
before a yard line read as cities (ESPN's ARZ/BLT/CLV/HST/WSH included),
the trailing parenthetical read as the tackle (coverage on an
incompletion), penalties split off and read plainly, down and distance
first, the score after a scoring play (away first, nicknames). WHEN is
core's `PlayReader` — one state machine with the voice injected: the app
hands it expo-speech (new dependency, SDK-matched ~57.0.3), the web
window.speechSynthesis; a cut sentence is re-said on resume, a late
`done` from a stopped voice is ignored, the final is said once. Both
sheets re-read the game every 3s so LIVE follows the poll. 31 probes in
new check:spoken (real 2026 week-1 gamebook lines), in check:parity.
APK 36932.

### v0.388.13 — 🔥 HOT comes off with the whistle

Founder, Monday, the Sunday window reading ★ WON with Olave, Flowers and
Collins still wearing 🔥 HOT: "still says hot, but game has been over for
a while." HOT is the streak state read off the last drip tick at or
before the clock, and a finished game leaves no later tick to cool it —
on either host. Worse, the two hosts disagreed on what it meant: the
web's liveCardFlags is last-state (a streak that cools reads cold), but
liveResolve's slot rows — what the worker publishes and the app renders
— ran their own loop meaning "was EVER hot".

One definition now: liveResolve calls the web's liveCardFlags at the end
of the events. Then the whistle: `liveCardFlags(..., { over })` reads
hot:false when the game is over (the scorch stays — a nuke is history, a
streak is not); the web passes the window's final state, and the worker
passes `doneTeams` — the teams whose game ESPN marks completed, from the
scoreboard the tick already holds — so resolve.js publishes their
players without `hot`, per game, not per window. Scores untouched. Three
assertions in check:livescore; server/test/hot-clears.mjs resolves a
baked week and shows the hot row cooling when its team is done and every
row cool when all are, scores identical. Core + web + worker; the app's
badge reads the worker's rows, so no APK.

### v0.388.12 — "Mi.Wilson": the gamebook's own namesake prefixes, and a late pass over finals

Founder, Sunday evening: "we look to be missing michael wilson stats
from the AZ game." Replayed LAC@ARI (ESPN event 401872926, final)
through the real ingest path offline, with the player index built from
the live Sleeper directory: ZERO plays mentioned "M.Wilson". ESPN's box
had Michael Wilson at 5-56 on 7 targets. The play text had him nine
times as **"Mi.Wilson"** — and Mack Wilson Sr., the linebacker, eight
times as **"Ma.Wilson"**. When two men in one game abbreviate
identically the gamebook doesn't say "M.Wilson" twice; it lengthens the
first-name prefix until they differ. buildRoster registered each athlete
under `abbrevOf` — "M.Wilson" — only, so neither spelling matched the
roster alternation and every one of his targets was dropped on the
floor (the LB's tackles too).

Fix: `abbrevKeys(displayName)` registers every first-name prefix, one
letter to the whole name ("M.", "Mi.", "Mic.", … "Michael.Wilson"); the
longest-first alternation matches whatever length the gamebook chose,
and an extended key carries only the men it fits. Replay after: michael-
wilson 5 rec / 56 yds + 2 incompletions (= 7 targets), mack-wilson 6
tackles — both exactly the box score. espn-attr gains the case.

Backfill without a hand: the tick polled only 'in' and 'post &&
!completed', so a game already final could never receive an adapter fix
(or ESPN's own post-whistle corrections). Completed games of the current
week now get a LATE PASS every 10 minutes (`finalPolled` map in
index.js); pollGame upserts on the play key, so it is idempotent. His
plays land on the first tick after deploy.

Noted, not touched: `server/test/h2h-verify.mjs` prints a soft "coin
totals are positive" FAIL (home 30 / away 15 vs the > 50 it expects) on
main before this change — an engine-coin expectation, not this diff.
Worker + adapter only; deploy-worker.yml carries it. No migration, no APK.

### v0.388.11 — the Field General leaves a receipt, and the copy says 1.9×

Founder, 3 PM Sunday, every FIELD GEN chip gone from the cards: "did my
field general apply?" It had — the boost is baked into each drip tick and
flat play as it banks (the event carries its `mult`) — but the card
showed only the LIVE multiplier, which resets when regulation ends unless
Overtime is armed. Once it read ×1.00 there was no trace, which is why
he had to ask.

`fgBoostAt(events, side, clock)` in core liveScore sums the trace: over a
side's events up to a clock, delta − delta/mult for every multiplied bank
(burns and the QB's own zero-delta passes contribute nothing). The web
card shows "⚡ FIELD GEN ×1.46 · +3.2" while the multiplier is live and
"⚡ FIELD GEN BOOSTED +3.2" once it has reset — same chip, dimmed, with a
tooltip saying what it banked stays banked. Four assertions in
check:livescore. App untouched: its drip board renders the resolver's
slot rows and has never carried the live chip either.

The copy: the Field General metric said "300 yds = 2.8×"; the engine is
1 + 0.003 per yard, so 300 yds = 1.9× (the engine's own comment says so).
The picker line now gives the formula, the 1.9×, and the regulation
reset; the rulebook regenerated with it. Web + core, no migration, no APK.

### v0.388.10 — phone-width duel cards stop colliding

Founder, three phone screenshots of the web drip board at 2:21 PM Sunday:
"A lot of collisions on mobile web." Warren's FIELD GEN chip lying across
Mayfield's card; Lawrence's "⤴ subbed in — his points count here" laid
over Burden's score; Washington's and Gibbs's FIELD GEN chips meeting in
the middle; the outermost mini card cut off at the viewport edge.

One cause for the first three: each side of a duel is a column whose
items shrink-to-fit, so a `nowrap` line wider than its half doesn't clip
— it hangs off the INNER edge into the other card (right side anchored
at flex-end spills left; left side spills right). The metric chip and
driver already capped at 100%; the FIELD GEN chip and the sub/suppress
lines didn't. Now every one-liner caps at the column, and on a phone the
FIELD GEN chip reads ⚡ FG ×1.46 and the sub note says "⤴ Name subbed in
— counts here" and wraps instead of truncating. The floating mini card's
phone overhang trims 16 → 10px so the outermost card stays inside the
page gutter. Web only, no APK; desktop layout unchanged.

### v0.388.9 — the board's own copy of the rule: 0–0 until kickoff

Founder, on v0.388.8: "it should always show 0 to 0 until kick off."
The worker now publishes 0–0 for an un-kicked window; the web battle bar
renders whichever number it has — the resolver's row, or its own local
simulation when no row has landed — and a Ghost or Bye Steal banks flat
in the local engine too. So the bar carries the rule itself: on the live
board a window whose real-time state is setup or locked reads 0–0 and
AWAITING KICKOFF, whatever either source says. Off the live board
(sim/demo, `realtime` null) nothing changes. Web only, no APK: the app's
board reads the resolver's rows alone.

### v0.388.8 — nothing scores before kickoff: the window total hides with its slots

Founder, Sunday morning of week 1, web, the SUN 1PM window LOCKED an hour
before kickoff: "this hasn't kick off yet, but my opponent is up by 20+."
THEY LEAD 25.2–0.0 over two face-down cards. The bar shows the worker's
number (v0.339.3), and the worker had one: the resolver hid an un-kicked
window's SLOT ROWS since 0199 (the leak guard) but wrote its home/away
TOTALS as computed. The engine credits a Ghost (14 flat) and a Bye Steal
(a flat projection, cap 16) the moment they are applied, and scores a
slot's player wherever he is filed — so a window nobody had played
published a total with no slot behind it, and the opponent's sealed plays
leaked as a number. 14 + 11.2 is the likeliest 25.2; a TNF player filed
into Sunday is the other candidate, and the slot rows will name him at
1 PM either way.

Fix in resolve.js: one `started(win)` rule for slots AND totals — a
window not in the tick's startedWins (kickoff-based, v0.341.1) writes
0–0; classic 'wk' and 'ALL' follow the slots' existing "once any window
has kicked" rule; a null slate (no kickoffs known) publishes as before.
Finals and coin untouched (every window has kicked by then). New
server/test/prekick-window.mjs: a Ghost banks 14 in SNF once SNF has
kicked, 0–0 with no slot rows while only TNF has, legacy with no slate.
Worker-only; deploy-worker.yml carries it. No migration, no APK.

### v0.388.7 — a used card leaves the hand (Air Raid), and Underdog stops taking two

Founder, Sunday of week 1, web card table: "I bought and played air raid
so it shouldn't be in my hand anymore." Herbert wearing Air Raid, the
Air Raid card still fanned below him. The live board keeps TWO copies of
the hand — the store's `inventory` (what the card hand and Apply modal
deal from) and Matchup's `srvInv` (what the metric picker and shop read)
— both hydrated from my_inventory, then kept in step by hand. Buying
bumped both. Using a metric card (arm_unlock consumes it server-side,
0256) only took it out of srvInv, so the hand dealt a card that no
longer existed until a reload. Underdog was worse in the other direction:
apply_underdog took the card server-side, then the local
applySlotListPu → consumeAndApply mirrored the consume AGAIN through
consume_inventory — two cards per attach.

Fix: `refreshHand()` in Matchup re-reads my_inventory after either RPC
and lands it in BOTH copies (new store `hydrateInventory`), falling back
to a local −1 on both if the read fails. consumeAndApply/applySlotListPu
take `{ synced: true }` for the live Underdog path: record the attach and
the local −1, skip the second server consume. Web only — the app's hand
excludes metric cards and reads one ledger.

### v0.388.6 — the shop wears the clock: ⛔ passed, ⏳ locks in 2h, 🟢 live now

Founder: "in the power up shop, let's have the power ups that you can't
apply because the usage window has passed, have some kind of sign so we
know what we can buy and apply last minute." The shop sold every card as
if it were Tuesday: on a Sunday night it still offered Momentum at full
price with nothing left for it to count, and the first hint was the card
arriving dimmed in the hand. Buying is never blocked (0255 — a card
keeps), so the fix is a LABEL, and the label has to say what the server's
gates say, or it lies in the other direction.

`powerupAvailability(p, windows, opts)` in core powerups.ts is the one
rule, mirroring the migrations: pre-match cards are per window (0259) on
the LOCK clock (0260) — open while ANY window has yet to lock, deadline =
the LAST open window's lock; Extra Slot is scope 1 and closes at the
week's FIRST lock; metric cards read like buffs (using one changes a pick,
which needs an open window); real-time cards wait / go live / pass with
the windows; a settled matchup closes everything. A passed card says
"keeps for next week" — or "practice cards don't carry over" on a practice
week, where inventory is per week (0121). `closesInLabel` is the
last-minute cue: "in 2h 30m".

Both shops: an OPEN card wears ⏳ LOCKS IN 2H 30M (or "counts the 2
windows still to lock" when no kickoff is known), LIVE wears 🟢 LIVE NOW:
LATE, WAITING a faint ⏳, PASSED a red ⛔ WINDOW PASSED with the reason,
dimmed and sunk to the bottom of its tab; a legend line explains the ⛔
the first time one shows. The app board feeds it its own windows through
the same fail-safe as its picks (winLocked); the web board feeds the live
phase machine + windowLockMs, or the sim's phase on a demo board. The hub
and demo shops (no board) show no sign. New `check:shopclock` (31 probes)
pins the rule to the migrations, in `check:parity`. APK 36931.

### v0.388.5 — the app's boards play for their 2026 teams too (Doubs, again)

Founder, screenshot of the drip picker: "Looks like we still have Doubs as
GB." Romeo Doubs in a Patriots jersey under a Packers badge, filed into
the SUN 4PM window — Green Bay's game, not New England's. "Still", because
v0.387.3 fixed exactly this and fixed it for ONE surface: the web engine's
players (buildLeague), which take the provider's team in a season after
the bake. The app never goes through buildLeague. Its drip picker and
classic board resolved `pool.team || slugMeta(slug).team`, and `slugMeta`
answers a baked player from BAKED_SLUGS — his MAJORITY 2025 team — without
ever asking the live layer, by design: the 2025 replay's possession gating
is written against that team. The directory bake already said NE. Nothing
on the app asked it. Same hole on the web's OVERLAY (`poolMetaRows`), so
the web board's logos and badges disagreed with its own engine.

Two smaller faults underneath, both real: the drip board loaded the
worker's team-drift table (0142) fire-and-forget and the pool memos read
that cache synchronously the moment the pool landed — the load lost the
race and never re-ran; and the classic board never loaded it at all.

**One rule, one function.** `liveTeamFor(slug, poolTeam, season)` in
slugMeta.ts is v0.387.3's rule made shared: in a season after the bake the
worker's override, then the directory, then the pool row, then the bake;
in the bake's own season the pool row then the bake, exactly as before, so
the 2025 replay is untouched. K/DST answer from the team-keyed slug on
every path. Now used by the app drip picker (card badge, engine Player,
both window maps, the duel fields, the opponent rail), the app classic
board's overlay install (my pool and the opponent's), and the web live
board's `poolMetaRows` (which takes the league's season; absent = old
behaviour, so every existing assertion holds). Both app boards `await
loadTeamOverrides()` before resolving a team.

The app has no league row in scope and assumed 2026 by literal, so
`LIVE_SEASON` joins `BAKED_PBP_SEASON` in realPbp.ts — one named constant
instead of a fourth copy; the classic board's `'2026'` now reads it. The
web engine keeps reading the league's own season and needs no such thing.

check-live-meta grows 13 assertions that find a moved player IN THE DATA
(today A.J. Brown, PHI → NE) rather than hardcoding one: a live season
answers the directory over the bake and over a stale pool row (the Doubs
case); the bake season answers the bake; an override beats the directory
live and never in the bake season; a rookie neither bake knows keeps its
row; K/DST; LAR → LA; and the season-aware overlay. Known cost, the same
one v0.387.3 accepted: a 🧪 LIVE TEST league in 2026 replaying a 2025 week
files a moved player into his 2026 team's window, where the 2025 SIM feed
has no plays for him. Battery green. APK 36930.

### v0.388.4 — the invite link lands on the league, not a password box (0274)

Founder: "I'd love a landing page for the league invite links for external
viewing. So someone opens the link and gets a preview of the league and
settings before joining."

Since 0206 the join screen has IDENTIFIED the league — crest, name,
season, game tagline, and (0208) whether a seat is even left. That answers
"which league is this?" and nothing else. What a recruit actually decides
on — the format, the scoring, the lineup, the draft, the wire rules, who
is already in — lived in `league_preview`, which is gated on being signed
in AND on the league having publicly LISTED itself. Both gates are right
for a browse-the-board stranger and wrong for someone holding an invite:
the moment the preview is wanted is the moment before there is an
authenticated anybody, and a private league is exactly the kind whose
invite gets sent.

**0274** adds `invite_preview(code)`, anon-callable, keyed on the code —
the same credential `redeem_invite` and `native_join` already answer to.
Its payload is copied from `league_preview` (0223, live) so the landing
page and the browse card can't drift about what a rule is called, plus
`format` and `continuity`, the two facts that change what the game IS. The
header states exactly what it exposes to anon: identity, rules, seat count
and TEAM NAMES — no emails, no member names, no app_user_ids, no Sleeper
ids, no player rosters. A bad code and a rotated code get the same neutral
refusal, so the endpoint can't sort live codes from dead ones.

New `src/screens/InvitePreviewCard.tsx` renders it under the identity
block on the signed-out join screen: seats filled, the commissioner's
blurb, format · continuity · game, scoring (PPR in words, best-ball
spots), the lineup as "QB 1 · RB 2 · WR 2 · FLEX 1", the draft (mode,
rounds, clock, auction budget), the wire (waiver mode, FAAB, trade
review), the salary cap when there is one, dues, and an expandable list of
team names marking which seats are open.

**Also fixed, unrelated and pre-existing:** the probe battery had started
failing by CALENDAR. Fixtures write week-1..5 lineups and the 0178/0058
window locks read the real slate, so the day the baked 2026 season kicked
off (10 Sep) game-mode and roster-builder broke, with eight more suites
days behind. The runner now shifts the REGULAR-season slate (weeks 1–18
only — preseason weeks are left alone, because preseason-practice-probes
asserts which practice weeks are playable, a real-clock question) ten
years out in the throwaway DB, and a few fixtures that plant their own
slate moved to weeks the real one doesn't cover. 84 suites green.

Web only — no app change, so no new APK.

### v0.388.3 — a backup never covers an earlier window

Founder, Thursday: the opponent's Thursday backup (Purdy, 9.4, unopposed)
had auto-subbed into Barner's WEDNESDAY slot — a window already FINAL at
0.5 — "you shouldn't be able to assign a backup to a previous window."
Manual assignment already barred kicked windows on live boards (0138);
the engine's AUTO pass did not, scanning every starter for the lowest
beatable one. `bestBallBackups` now takes the week's window kickoff order
and a backup may cover only its own window or a later one, manual or
auto; the auto pass picks per backup (the lowest starter it may still
cover) instead of one shared pointer. Both resolvers get the order from
orchestrate (windowsForWeek), so the board and the worker agree. The web
assign menu applies the same rule on the sim/demo board too. Unknown
windows (classic 'wk') are unconstrained. Pinned by
scripts/check-backup-window.mjs (check:backupwin).

### v0.388.2 — the live board blanked after v0.388.0 (hook order)

Founder: "nothing now" — dripfantasy.com/#/matchup/1/setup rendered an
empty page. v0.388.0 declared the league switcher's useState/useEffect
beside the header chip they feed, which sits BELOW the component's
conditional returns ("Loading your matchup…" while the game mode loads,
the classic board, the no-game screen). The first render returned early
with fewer hooks, the next render reached them, and React threw. The hooks
now live with the rest at the top of the component; the chip and sheet
stay where they were. Nothing else changed.

### v0.388.1 — tap a field on ALL GAMES to make it big

Founder, from the ALL GAMES overlay on Thursday: "click a field to make it
show up big." Tapping a game's card now spans it across the whole grid
(capped at 900px, centred) and moves it to the top; the others keep their
tiles below. Tap it again, or another field, to change. The card's own
controls (↔ flip, BOX SCORE) keep their clicks. The legend row says which
tap does what. The field is a viewBox SVG, so it simply scales.

### v0.388.0 — a league switcher in the board header

Founder, Thursday night with four leagues live: "I have to keep going back
to my leagues to see my other match ups. Can we make a quick selector at
the top?" The live board's header now names the league you are in as a
chip (next to ← league); tapping it opens YOUR MATCHUPS — every other
seat you hold, league name, team name, CLASSIC where it applies — and
picking one runs the leagues page's own board prelude (openHeroBoard), so
the board rebuilds for that league on the week it is playing, one tap from
where you were. Hidden with one league; the demo has no seats. The board's
mount key now includes the live matchup id so switching leagues on the
same week remounts cleanly (the two seats could share a roster number).

### v0.387.6 — a subbed-in starter's card says so while live

Founder, Thursday: "Parkinson has points but no catches" — 6.9 over 0 rec
yd at Q1 12:19, 0–0. Not a scoring bug: `phantom-drip-diag.sql` showed zero
play rows for his slug anywhere, and the live ESPN summary run through the
worker's own adapter has none either. The 6.9 is Stevenson's. The
best-ball backup rule moves an unopposed backup's points onto the lowest
beatable starter, the worker runs it on every tick, and the Wednesday card
already said "subbed in — full points counted" — but the TARGET card only
labelled the sub at FINAL, from when the local number first carried it.
Live it shows the resolver's row, which carries the sub now. The card now
labels the sub as soon as the server has published the slot ("⤴ Stevenson
subbed in — his points count here"), "scoring" at final as before. Kyren
Williams' 6.8 on a nuke metric in the other Turf Warriors matchup is the
same shape. Web only.

### v0.387.5 — an AI-controlled opponent's picks render on the live board

Founder's hidden-pick diagnostic on the Gridiron Gang and Turf Warriors
matchups: the opponent seat was `controller='ai'` with no sealed_pick rows,
so the reveal had nothing to show — the window bar credited the side while
every card read "NOT MATCHED UP". Those seats never write sealed rows; the
worker composes their lineup at resolve time and publishes it, slug and
metric, in `matchup_state.slot_scores` for windows that have kicked off.
The web board now fills any opponent slot the sealed reveal lacks from
those rows (sealed reveal still wins its key; ghost / bye-steal phantoms
are skipped). Nothing sealed leaks: the worker publishes a window's rows
only after kickoff, which is the same moment the roster rail reveals it.
Web only; the app's Duel already reads the rows directly.

### v0.387.4 — a backup's card shows what it would bring

Founder, Stevenson's Wednesday card reading 0.0 over a log totalling 2.1:
"let's get the score up there. Let's not keep it zero, but zero it out or
show the sub at the end." The unopposed card took the resolver's published
row, which for a sub-capable backup is 0 by rule (it banks nothing in
place). Now the card shows the running would-be bank while live and the
settled would-be at final — struck through when it never subbed in, plain
when it did, with the chosen target shown beneath as before. The window
bar and headline keep the counted number. Web only; the app's Duel card
is unchanged.

Same screenshot, the other half: the speedkills1 window bar credited the
opponent 7.8 while their slot read "NOT MATCHED UP". The pick was real and
revealed; the player just wasn't in the opponent's roster as this board
had loaded it (the agent seat wire ran 21 transactions in that league at
boot), and `lookup` returned null for any slug outside the pools — so the
slot rendered empty, your player read as an unopposed backup, and the
worker scored the same row as a contested slot. `lookup` now falls back to
the league registry and then to a minimal player built from the slug.

### v0.387.3 — a live league's players play for their 2026 teams

Founder's Wednesday screenshots after v0.387.2: Romeo Doubs sitting in a
Wednesday slot with the GB@MIN field under him and "no plays yet", listed
in the Sunday-4pm rail. He is a Patriot this year. The worker knew (it
placed him from the live directory); the web board didn't: buildLeague
took every baked player's team from BAKED_SLUGS — his MAJORITY 2025 team —
regardless of the league's season. Right for the 2025 replay (the baked
possession gating is written against it), wrong for a 2026 live league for
everyone who moved (55 team changes in tonight's roster sweep alone). Now
a league in a season after the bake takes the provider's current team,
falling back to the bake only when the provider has none.

Same family, second layer: `realPbpFor` has ignored the bake on a live
week since the overlay existed, but `realPossFor` / `realKickoff` /
`realWallFor` / `realGameEndClock` still answered from it — so the live
2026 board gated tonight's drips on New England's possession from the 2025
Raiders game. Live weeks now answer "unknown" from all four and fall
through to the feed, which is what the worker (never loads the bake) did
all along.

### v0.387.2 — last year's plays on this year's board, and the AI's guesses on the opponent's rail

Founder, Wednesday opener, screenshot: "Henderson is out today. How does
he have yards? And it's showing my opponent's selections?"

**The yards were 2025's.** `live_play` / `game_feed` key on WEEK alone, no
season. The June 24 `simulate live` runs replayed baked 2025 Week 1 into
week 1 (`game_id 'SIM'`, `'SIM:LV@NE'`…) and no reset followed, so when the
real 2026 Week 1 feed started landing tonight it shared the rows: every
2025 Week-1 player carried last year's plays into this year's window
(Henderson, OUT, "had" 5-27 rushing), New England's field showed the 2025
Raiders game, and the worker scored the same rows. Immediate remedy is two
SQL deletes (SIM rows only, week 1 — NOT `simulate --reset`, which also
reverts matchups and unlocks picks). Now the worker purges a week's SIM
rows the moment it polls a real game there, and the simulator refuses to
run over a week that has real rows.

**The struck-through lineup was the AI's.** The DB reveal is per window
and was fine; the client stood `aiLineup` in for a human opponent whenever
the reveal hadn't landed, and the rail struck through every "assigned"
player once the board left setup — the first window's kickoff. Live boards
now use the reveal only (unrevealed → empty slot; every seat, agents
included, writes real sealed_pick rows), and the rail gates each window's
strike-through on that window's own reveal.

### v0.387.1 — no house mark beside the wordmark

Founder, screenshot in hand: "There is a chip to the left of DRIP FANTASY.
Why? Can we remove it?" It was the brand mark — the icon set's
`brand-mark.png` drawn by `<Brand>` (and hand-rolled the same way on the
demo board and the leagues screen) at 18px beside the wordmark. Sitting in
the same row as the real chips (← league, DEMO, the username pill) it read
as one more button, not a logo. Removed from all three headers; the mark
still lives where it is an icon inside a CTA (request an invite, play this
for real). Nothing else moves.

### v0.387.0 — the blade and the bite reach your phone (0273)

Founder: "let's do the push notifications for both." v0.385.0 and v0.386.0
gave the two format events a banner — 🪓 CHOPPED and 🩸 BITTEN — but a
banner only lands if you happen to open the app, and these are the two
moments in the product a manager most needs to hear about without looking:
your season ended, or a player left your roster while you weren't
watching. Neither had ever pushed.

**0273** adds ONE kind, `format`, rather than two: both events are rare,
high-stakes and per-format, and a manager who wants to hear about their
own elimination wants to hear about being fed on too. The outbox's kind
check and `_sanitize_push_prefs` (0241's body + the new key) grow by one
entry each; muting stays per device like every other kind, and flush's
existing `prefs?.[kind] !== false` filter means the mute works with no
worker change.

**Two detectors** in server/src/push.js, both keyed off rows that already
carry a timestamp so the trailing-window re-scan pattern works unchanged:
- `detectChopped` reads league_txn kind 'elimination' — the row
  guillotine_tick writes as it drops the blade, whose note already reads
  "week N — lowest score, 84.2". Deduped on the txn id, and the tick never
  writes twice per seat, so one elimination can never page twice.
- `detectBitten` reads vampire_steal where status='executed' and
  resolved_at is fresh — so the victim hears the moment a player actually
  leaves, never on a steal still pending or one that was vetoed. The body
  names the vampire's team, what was taken, and what came back.
Both skip an unmanaged seat (nobody to tell).

The toggle — "🪓 chopped & 🩸 bitten" — joins the alert prefs on BOTH
hosts (app SettingsModal, web NativeLeague). push-probes pins the new key
through sanitize and reads the outbox's kind list off the constraint
rather than an insert the caller's role may not make. 83 suites green.
APK 36928.

### v0.386.0 — the vampire audit: a web coven, and telling the bitten

Founder: "let's audit vampire mode as well." A full vampire season was
walked end to end in a scratch DB — coven appointment and its refusals,
the draft exclusion and waiver queue, the vampire building from the pool,
the wire lock both ways, no-steal-before-a-final / after a loss / after a
tie / on a stale win, the bad-take and bad-give refusals, the bite itself
and its register row, one-steal-per-win, multi-vampire independence, the
stash guard, steal review's veto and approve, late appointment, disbanding
the coven, and every gate. **74 of 74 passed: the rules engine is sound.**
Two CLIENT gaps, both fixed here, neither needing a migration:

**1. The web could not appoint vampires AT ALL.** `setVampires` existed
only in the app's CommishTools, so a web-only commissioner could pick
VAMPIRE in the create wizard and then never name a vampire — the one thing
the format needs done BEFORE the draft. `VampirePanel` (the web vampire
room, reachable from the hub tile and the feeding bell) grows a
commissioner-only ⚑ THE COVEN section: tap a seat to seat or unseat a
vampire, plus the wire lock and steal-review toggles. Seats come from
league_standings, which already answers every seat with its team name
pre-draft, so it costs one call and only for a commissioner.

**2. Nobody told the bitten.** A steal writes no push and no per-seat
signal: a player silently left the victim's roster and a stranger arrived,
recorded only in the register and the vampire card's log — the mirror of
v0.385.0's chopped gap. New pure helper `bittenNotice(state, rosterId)`
sits beside `feedingBell` in core; both boards already poll vampire_state
for the bell, so the 🩸 BITTEN IN WEEK N banner (naming the vampire, what
was taken and what came back) costs nothing new. A steal still awaiting a
ruling reads "A BITE IS DECLARED" instead — nobody has moved yet.

New suite `vampire-rules-probes.sql` pins the five rules the audit walked
that nothing had pinned: a tie is not a win, only the latest finaled week
is fresh, a stashed player is off the menu, a late-appointed vampire keeps
what it drafted, and an emptied coven still reads and feeds nobody. 83
suites green. APK 36927.

### v0.385.0 — tell the chopped, and refuse them politely (0272)

Founder: "can you tell if everything works with guillotine leagues?" So a
full season was walked end to end in a scratch DB — create, format, draft,
schedule, five weekly blades, the frenzy, waivers, trades, the seat guard,
the champion, the gate — about 60 checks. The MECHANICS are sound: the
blade takes the low score every week, the roster releases to waivers, the
elimination and each release print in the register, pending claims die
with the seat, the guard refuses a dead seat by every path (raw insert,
add_free_agent, a won claim, a trade re-pointing roster_id), the living
keep working the wire, standings/chat/materialize/week-role all keep
answering, the last seat is crowned and never chopped, and the worker
fires the blade during a sim. Two gaps around the mechanics, both fixed
here:

**1. Nobody told the chopped.** `eliminated_week` was exposed on exactly
one read — guillotine_state — so a manager whose team fell opened MATCHUP
to a normal-looking board with an empty lineup and no explanation; the
block's CHOPPED list was the only record and it isn't on that screen.
0272 adds `eliminated` to league_standings (both boards already poll it
for records) and to native_team_state (both team desks already poll it).
Both boards and both team desks now carry a 🪓 CHOPPED IN WEEK N banner
saying what happened, that the wire is closed, and that the seat keeps its
chat, pots and block.

**2. The refusal threw.** A dead seat's add was blocked only by the
seat-guard trigger, which RAISES — so the client took its error path where
every other rule in the app hands back {ok:false, error}. Same for the
vampire wire lock. New `wire_block_reason(league, roster)` holds both
formats' wire laws in one place; add_free_agent and submit_waiver_claim
ask it first and answer in words. The trigger is untouched and stays the
last line of defence — pinned by a probe that still drives it directly.

All four bodies copied from their live definitions (0229, 0269, 0199).
New suite `tell-the-chopped-probes.sql` (82 suites green); format-probes'
wire-lock assertion moved from "it raises" to "it answers, and the trigger
still raises behind it". APK 36926.

### v0.384.0 — 🔪 the chopping block keeps history (0271)

Founder: "let's have the chopping block keep history. So you can select
each week and it's result." The block could only ever show NOW — `alive`
is this week's cutline, `fallen` a names-and-fatal-score list — so "what
did week 3 look like" had no answer, though matchup finals and
eliminated_week have held the record all along.

**0271** grows guillotine_state a `history` key: one entry per fully-final
regular week (practice and playoff weeks excluded, league_standings' own
rule), newest first, each holding the week's whole LIVING FIELD — every
seat not yet chopped going in, which is exactly the field the blade chose
from — with each seat's final, an honest `bye` (never an imputed 0), and
`chopped` on the one that fell, sorted score-ascending so the floor reads
first. The chopped seat is also hoisted to the entry so a client can label
a week without walking its rows. A seat chopped in week N is IN week N and
gone from N+1: the week you died is the week you are most worth looking
at. Body copied from 0267, the live definition; guillotine_tick untouched.

Both cards (app GuillotineCard + web GuillotinePanel) grow week chips —
NOW · WK n … WK 1. NOW is the cutline as it stands, live `~` totals and
all; a past week is that field, final, with 🪓 on the casualty and a line
naming who fell. The frenzy and the 🪓 CHOPPED log belong to NOW (a past
week names its own casualty), and each CHOPPED row is now a button into
its week.

New probe suite `block-history-probes.sql` (9 groups, wired into the
runner, 80 suites green): a running week is not history; the field shrinks
week over week while older weeks are never rewritten; the floor sorts
first and is flagged; a byed seat carries bye + null score and the blade
never takes it; the member gate holds. APK 36925.

### v0.383.1 — 🔪 the chopping block comes to the web

Founder: "let's get the chopping block on web versions as well." New
`src/screens/GuillotinePanel.tsx` — the app GuillotineCard's twin, kept in
step by hand: survivors nearest the blade first (🔪 on the doomed seat,
BYE / final / provisional `~live` numbers), a collapsible rules explainer,
💰 THE FRENZY (top 12 + count), and the 🪓 CHOPPED week-by-week log. Same
poll-and-re-poke loop as the app card (guillotineTick then guillotineState
every 20s) so the blade falls on screen during a SIM.

Three placements:
- **League hub tile** ("The chopping block · the block · the frenzy · the
  chopped", guillotine leagues only via one `guillotine_state` probe)
  opening the panel in a Sheet.
- **Top of the web results page** (framed) — the app's rule: in a
  guillotine league the cutline IS the standings. Renders nothing in any
  other format.
- The panel self-gates, so both mounts are safe everywhere.

`scripts/check-bye.mjs` now pins the bye rendering rules against BOTH
renderers (app LeagueExtras + web GuillotinePanel): a byed seat prints
BYE, a live total prints `~`, and a byed seat is never the one under the
blade. No DB, no server, no app change — web only, no APK.

### v0.383.0 — 🧛 the vampire comes to the web: panel, tile, click-to-feed

Founder: "can we get the vampire log on web too?" Until now the web's
whole vampire surface was fangs on names and a banner that pointed at the
app. New `src/screens/VampirePanel.tsx` — the app VampireCard's twin, kept
in step by hand: the coven summary, a collapsible rules explainer, the
steal window (take / give chips + SINK THE TEETH), the commissioner's
ruling on pending steals, and the per-chair feeding log with the same
"won, never fed" / "steal vetoed" annotations. Same 20s poll as the app
card so a SIM'd win fills the log while the founder watches.

Two doors, both the app's (v0.382.1) mirrored:
- **League hub tile** ("The vampire · steal window · feeding log · coven",
  vampire leagues only via the one `vampire_state` probe) opening the
  panel in a Sheet; accent + "🩸 time to feed" badge off `feedingBell`,
  re-probed on close so a bite clears it.
- **Click the feeding bell** on the web matchup board: the banner is a
  button now, opens the same panel in a Sheet, and closing bumps
  `vampVer` to re-probe so a done bite clears the bell immediately. The
  banner copy stopped pointing at the app.

No DB, no server, no app change — web only, so no APK (the PWA picks it
up on deploy).

### v0.382.1 — 🧛 tap the bell to feed + the vampire's own league-tab tile

Founder (screenshot of the league tab): "I dont see the feeding option in
the league tab. Let's also have click the banner to feed." Both fair: the
vampire card was BURIED inside the Standings sheet — a card list the
founder scrolled twice without finding it — and the new bell only pointed
there. Two doors now:

- **Tap the bell** (app matchup board): the feeding bell is a Pressable
  that opens the steal card (VampireCard, the same one) in a sheet right
  on the board. Closing it bumps `vampVer`, which re-runs the probe so a
  done bite clears the bell immediately, not on the next 20s tick.
- **🧛 The vampire tile** (league home, vampire leagues only): opens the
  card in its own sheet; the tile wears an accent + "🩸 time to feed"
  badge whenever `feedingBell` says this seat's window is open, and the
  sheet's close re-probes so the badge clears after a bite. One
  `vampire_state` probe decides the tile's existence — every other format
  answers `vampire:false` and never shows it. The card also still rides
  the Standings sheet.

No DB, no server change. Web banner unchanged (there's no web steal UI
yet — it points at the app). APK 36924.

### v0.382.0 — 🧛 the feeding bell: "YOU WON — TIME TO FEED!" on the matchup view

Founder: "can we add a 'you won! time to feed!' banner to the matchup view
when the vampire wins?" The win happens on the matchup board, but the bite
lives in the LEAGUE tab's vampire card — so a vampire could win, never
notice the window, and lose the steal when the next week finals. Now a
blood-red banner rings on BOTH matchup boards (app ClassicBoard + web twin)
when the viewing seat is a vampire chair whose win is fresh: it won the
latest fully-final week and hasn't fed on it. Names the beaten team and the
week, points at the LEAGUE tab, and says when the window closes.

The condition is ONE shared helper, `feedingBell(vampireState, rosterId)`
in core's liveApi (pure, legacy single-vampire fallback for pre-0268
answers), so the boards and the vampire card can never disagree about
whether the window is open. Each board probes `vampire_state` once — every
other format answers `vampire:false` and no poll starts; vampire leagues
poll at 20s (the vampire card's cadence) so a SIM'd win rings while the
founder watches. No DB, no server change. APK 36923.

### v0.381.2 — the app board polls at rehearsal speed under LIVE TEST

Founder (screenshot, Vamp T mid-sim): "scoring is not flowing through in
the app" — the strip read feed 57% · 600× while both totals sat at 0.00
and every starter "yet to play". The live data path was fine; the CADENCE
wasn't. The web board polls plays/feeds every 10s under LIVE TEST
("the production minute cadence reads as a dead board there" — v0.368.0),
but the app board's poll was a flat 60s: at 600× the entire live window
(~20–50s of wall clock) fits inside one poll gap, so the board never saw a
single live row before the week finalled — and then sat on stale zeros for
up to another minute. Ported the web rule to
`apps/mobile/src/ui/ClassicBoard.tsx`: `testLive != null ? 10_000 :
60_000`, with `testLive` joining the effect deps so the fast cadence kicks
in when the sandbox flag resolves. LivePicks needed nothing — it is
push-driven (Supabase realtime via subscribeMatchup), not polled. No DB,
no server change. APK 36922.

### v0.381.1 — the sim really runs fast now: the 20× override + 600× (0270)

Founder (screenshot): "mobile web still has time and not % complete.
Also says 20x." The 20× was OURS: liveApi's adminSimStart sent
`p_speed: speed ?? 20` — a client literal silently overriding the
server default on every strip-armed run, so 0266's 100× never applied.
Now `?? null`: the SERVER owns the default. The time-not-% readout was
the documented first-tick window (feed_len stamps on the worker's first
sweep; the screenshot was ~10s into a 20× run) — made moot by the rest.
Then: "I want the feed to take like 20 sec." The feed spans one full
broadcast (~11,500 game-seconds), so ~20s ≈ 600×. 0270 (0266's body,
two literals): default 600×, cap 200 → 2000. Known shape: the worker
sweeps sims every 25s, so at 600× a week completes in one or two ticks
— scheduled → FINAL in a jump, which is what a testing loop wants;
spectacle runs can still pass a lower explicit speed (playLive's 300×
untouched). sim-percent probes re-pinned to 600. Rides APK 36921
(36920 was built but never shipped — the 20× was baked in).

### v0.381.0 — app: the sim strip (rehearsals run from the phone)

Founder: "can I run the sim on the app?" → "yes add the sim strip to
the app." The app could WATCH a rehearsal (v0.367.2 feed-is-truth
override) but only the web could arm one. New
apps/mobile/src/ui/SimStrip.tsx mirrors the web strip over the same
three RPCs (adminSimStart / adminSimReset / simRunState, % readout
included): ▶ SIM WEEK N, ⏹ RESET (Alert-confirmed), 10s poll, "the
worker is driving" line — server-gated exactly like the web (the
sim_run_state probe answers forbidden to non-admins and the strip
renders nothing). Mounted on BOTH app boards: ClassicBoard (gated on
its testLive read) and LivePicks/the drip board (unconditional mount,
self-hiding — one probe RPC); both wire onChanged to their
pull-refresh so a reset repaints immediately. The whole vampire drill
— arm, watch, feed, reset — now runs from one phone. Rides APK 36920.

### v0.380.0 — the coven wears its fangs (0269)

Founder: "let's make it clear in the draft which teams are vampires and
won't get picks. Also make it clear throughout the app/web experience."
0268's draft exclusion was correct and silent — a room with fewer
columns than the league has teams, unexplained. 0269 (bodies copied
from the live 0193/0249/0253 definitions): draft_state gains
`vampires` [{roster_id, team}]; league_standings and
admin_league_members rows gain `vampire` — every flag gated on
league_format='vampire' so stale seats keys show nothing (probed).
Both draft rooms (web DraftRoom, app Draft) render a 🧛 banner naming
who sits the draft out and why ("builds its roster from whatever the
draft leaves in the pool"); standings rows on both hosts, the web
league results scoreboard, the web admin members table and the app's
commish seat list all wear a 🧛 prefix on vampire team names. The
league-home vampire card (0268) already named the coven. Probes: coven
suite section 5 (draft_state naming, exact-coven flags on standings +
members, the format gate). App half rides the next APK (36919).

### v0.379.1 — Tier-2 CVD audit: color is never the only channel

Founder: "let's do the tier 2 audit." Swept BOTH hosts for the tell —
identical glyphs whose meaning differs only by you/opp color — via
every `you : opp` ternary and every bare meaning-dot. VERDICT: the
codebase was already disciplined almost everywhere, and this audit
RECORDS that so it isn't re-derived: window battles say ★ WON / LOST /
YOU LEAD / EVEN in words; the week banner says YOU WON; W/L letters on
the feeding log; VICTORY/DEFEAT on the final; LOCKED/SETUP,
DRAFTING, LIVE, REAL CLOCK chips all pair their dot with a word;
NUKED prints on both hosts' cards; deltas carry signs; ✓-notes carry
the glyph; pos chips carry letters; the chopping block carries 🔪 and
BYE; side accents ride position (you left, theirs right); the app's
unread dot had already collapsed to one meaning. THE ONE REAL DEFECT:
the web chat's compact bell — mention (opp-red) vs plain unread
(you-green) as the same bare 8px dot. A mention now wears a tiny @
badge; the plain dot keeps its single meaning. Web-only fix; nothing
rides an APK.

### v0.379.0 — True Colors + Plain Sight: the colorblind-accessible themes

Founder: "what would we need to do to create a color blind accessable
theme for web and app?" — then "let's do it". Every existing theme says
you-vs-opp in green-vs-red, the one pair ~8% of men can't separate, and
the whole game is that opposition. Two new themes in core/theme.ts —
clarity ("True Colors", dark) and lumen ("Plain Sight", light) — say it
in Okabe-Ito sky blue vs vermillion, separated by LUMINANCE as well as
hue; warn sits a full step away (yellow on dark; a deep violet on
light, because at light-theme luminances any yellow collapses into the
vermillion under protan/deutan — measured, not guessed). One entry in
THEMES serves both hosts (CSS vars on web, useTheme on the app); both
pickers gain the pair. NEW BATTERY CHECK scripts/check-themes.mjs
(check:themes, in the parity chain): themes listed in ACCESSIBLE_THEMES
are held to WCAG contrast floors, pairwise ΔE ≥ 20 under simulated
protanopia/deuteranopia/tritanopia (Viénot/Brettel matrices), and
grayscale separability — it failed my first lumen draft three ways and
drove the violet. Chromium pass found a real pre-existing bug: DemoBoard
set var(--warn)/var(--you)/var(--dim) text ON THE FELT, which is a
skin and always dark — a light theme's dark accents vanished into it
(daylight/arctic were already marginal). Felt text now wears fixed
FELT_GOLD/FELT_BLUE/FELT_DIM. Web ships on deploy; the app half rides
the next APK (36917). Tier 2 (second-channel audit: bars, dots,
flashes) remains open.

### v0.378.0 — the coven: vampires don't draft, may own the wire (0268)

Founder: "vampire shouldnt get to draft players. Vampire leagues should
have the option to lock the waivers to any non-vampire team. Let's also
have the number of vampires in the league customizable." The classic
vampire ruleset, in three moves (0268): (1) vampire seats appointed
BEFORE the draft are excluded from the draft order (_start_draft_now,
0219's body + the exclusion — snake/linear/auction alike, and the coven
queues behind the drafting teams in waiver priority); the 0221 seat
guard FLIPS — the vampire may now work the wire, because the leftover
pool is its only cradle. (2) settings_json.vampire_wire_lock (off by
default): ON blocks every NON-vampire FA add and waiver claim at the
same roster-door trigger. (3) settings_json.vampire_rosters is a list —
set_vampires appoints the coven (at least one team must remain to
draft; legacy set_vampire delegates, legacy vampire_roster key still
reads); steals are one-per-win PER VAMPIRE (uniqueness index grows the
vampire column; vampire_steal grows p_vampire — the 3-arg original is
DROPPED, PostgREST would see two overloads as ambiguous, and the old
APK's named call binds the new default). vampire_state answers the
whole coven under `vampires` (one chair each via _vampire_seat_state)
with the legacy single-vampire fields kept on the caller's own seat.
App: COMMISH format card appoints by toggle chips + wire-lock chip;
the league-home card renders each chair's window and feeding log.
Probes: vampire-coven-probes.sql (draft exclusion end-to-end through
an AI autodraft, guards, independent feeding, legacy surface) + the
format suite's old "wire closed to the vampire" probe rewritten as the
wire-lock pair. Rides the next APK (36916).

### v0.377.0 — the chopping block + the feeding log (0267)

Founder: "in the league home for guillotine leagues we need a chopping
block view … I need to be able to see how this works in a sim. We also
need a vampire view … the vampire's wins and who they took." Both
format cards existed (0221/0222) but couldn't show a week IN FLIGHT:
guillotine_state.alive.pts reads finals (null mid-week — and mid-SIM),
so every survivor rendered scoreless. 0267 (bodies copied from the live
0247/0222 definitions): alive rows gain `live` (the seat's
matchup_state per-window banks summed — the same rows the boards read)
and an honest `bye` (no-matchup test, not "no final yet"); the cutline
sorts final-else-live, byes last; fallen rows gain `pts` (the score the
blade fell on). vampire_state gains seat_team, `record` (a tie is not
a win) and `weeks` — every finaled week from the vampire's chair with
the opponent named; steals gain victim_team. App league home: 🔪 THE
CHOPPING BLOCK (live ~totals, blade on the floor, list scales down as
teams die, 🪓 CHOPPED week-by-week with fatal scores) and 🧛 gains the
record line + 🩸 THE FEEDING LOG (W/L per week, took X · gave Y,
vetoed / never-fed noted). Both cards poll at 20s and re-poke the
idempotent tick, so a sim's eliminations land while you watch — the
worker's sweep (0249) already drops the blade when a simmed week
finals. Vampire drafts stay ordinary: the vampire is a normal draft
seat; only its season is different (no FA/waivers — steals off wins,
one per fresh win, optional commish review). Rides the next APK.
Probes: chopping-block-probes.sql (+ the existing format suite caught a
plpgsql alias collision in review — mu the variable vs mu the table).

### v0.376.3 — the pool doctor (0265) + rehearsal in percent at 100× (0266)

Two founder asks. FIRST, the K. Walker ghost's real anatomy: 0264's
pair-repair reported {fixed: 0} in production — the tell. buildDraftPool
never ran 0205's disambiguation on the directory path (only the baked
fallback did), so the retired twin and the live RB reached
seed_league_pool under ONE slug and `on conflict do nothing` silently
ATE the RB — the ghost row stands alone, no twin to swap with. Fixes:
the missing disambiguateSlugs call is restored (post-slice), and since
only the client's directory knows who is retired, diagnosis is now
client-side — diagnosePoolGhosts (core) finds pool rows whose
sleeper_id is an inactive player and resolves the live same-slug
player; commish_repair_pool_row (0265) is the pen, rewriting one row's
identity in place (slug unchanged — rosters/picks keep referencing it;
an unreferenced duplicate row holding the new id is absorbed, a
rostered one refuses). AdminPage MODE tab: "🩺 check player identities".

SECOND (founder: "have the feed show at % rather than time. We can go
100x rather than 20x"): sim_run grows feed_len, stamped by the worker's
sweep — the only thing that knows the feed's end — and sim_run_state
answers pct (capped 100; null for the first tick, strip falls back to
the clock). admin_sim_start's default speed is 100× (0252's body, two
20s changed): a full rehearsal week in ~2 minutes. SimStrip shows
"feed 47% · 100×". Probes: pool-doctor + sim-percent suites wired in.

### v0.376.2 — the retired name-twin ghost (K. Walker WR · FA) (0264)

Founder (screenshot, bench card "K. Walker · WR · FA · BYE"): "Walker is
an RB." Sleeper's directory carries a RETIRED Kenneth Walker (WR, no
team, inactive) beside Kenneth Walker III, and buildDraftPool's ADP
lookup is slug-keyed — the ghost inherited the RB's ADP through the
shared `kenneth-walker` slug, survived the no-team filter, TIED the
RB's score, and stable sort let directory order hand him the clean slug
(the RB got `-8151`, 0205). Drafting the clean slug bought a ghost:
WR · FA, permanent BYE. Two-part fix: (client) inactive directory
players never enter a pool, and score ties break by search_rank before
slug order, so the relevant twin keeps the clean slug and its bakes;
(0264) repair_pool_fa_twins() moves the twin's identity onto the clean
slug already on rosters, deletes the twin row, rematerializes scheduled
weeks — guarded to never touch a twin someone deliberately drafted, and
run once by the migration itself. Probes: pool-twin-repair-probes.sql
wired into the runner.

### v0.376.1 — app: chat drafts wrap and the box grows

Founder (screenshot, mid-league-chat): "Need the chat to wrap and the
box get bigger so you can see what you are typing." Both app composers
— the league chat's inline one and the shared Composer the DM threads
use — were single-line TextInputs, so a long draft scrolled off
horizontally. Now multiline: the draft wraps, the box grows to ~5 lines
(maxHeight 110) then scrolls inside, the row aligns flex-end so the
📊/GIF/send controls anchor to the bottom edge as it grows, and
submitBehavior="blurAndSubmit" keeps the return key SENDING (multiline
would otherwise turn it into a newline key). App-only; rides the next
APK (versionCode 36915+).

### v0.376.0 — GO NATIVE: imported leagues convert in place (0263)

Founder: "let commissioners migrate their leagues added from other
platforms to native leagues." One RPC, convert_league_to_native:
in-place (league_id, seats, schedule, wallets, history all stay),
backfilling the three things an import never had — a league_pool
(client-seeded from buildDraftPool, so everything draftable scores), a
native_roster read from the LATEST sleeper_lineup snapshot (sleeper_id
match first per 0205, then slug; unknown rostered players are APPENDED
to the pool, not dropped; grp ir/taxi become native spots), and a draft
row born 'complete' — inserted AFTER the rosters so 0186's register
logs zero phantom pickups. The flip rewrites sleeper_league_id into the
native-… namespace (worker syncWeek/cloneWeek/importLeague key on it —
a same-season re-import now makes a fresh league instead of clobbering
this one) and provider='native' switches off every remaining sync path
(0204/0133/0106 all test provider). The mirrored Sleeper scoring blob
moves off Drip's settings_json.scoring key to imported_scoring before a
knob edit can destroy it. Pre-season gate: refused once any matchup has
locked. Dry run performs the whole conversion inside a savepoint block
and rolls back on a sentinel — preview ≡ commit by construction, and
the AdminPage MODE-tab GO NATIVE panel shows it (matched/appended/
skipped counts, unclaimed-seat warning) before the one-way confirm.
Probes: convert-league-probes.sql, 30 assertions wired into the runner.

### v0.375.3 — box-score names open player cards

Founder: "can we open up player cards by clicking names on the box
score?" Web + app box sheets: every player name is now a tap target
opening the standard player card (openPlayerCard with slug/pos/team/
week; dotted underline as the affordance). D/ST and K composite rows
stay plain — they're units, not players with cards. Opening a card from
inside the box Overlay follows PlayerPicker's precedent. App half rides
the next APK.

### v0.375.2 — reveal at kickoff, not at lock (0262) + Search Console file

Founder (screenshot): "The app just revealed the opposing pick, but that
shouldn't happen until kick off." Since 0260 the pick clock locks at
kickoff − 1h and the worker's seal rides it — but sealed_pick.locked was
ALSO the reveal flag (v0.341.1 coupled them), so both boards handed each
side the other's lineup an hour early. 0262 splits the clocks: locked
stays the edit seal; the sealed_select RLS now gates the opponent's read
on window_kickoff (new window_revealed helper; null slate falls back to
reveal-at-lock so sims/probes lose nothing). No client changes needed —
both boards already render the hidden hour as SEALED card backs, and
matchup_state was already kickoff-gated (startedWins). Probe section 17
pins owner-reads-own / opponent-blind-during-lock-hour / reveals-at-
kickoff / slateless-fallback. Also: Google Search Console verification
file at site root (public/google8d5701b5986e8447.html).

### v0.375.1 — app: ⚡N chip on buffed cards; the hand hugs the room bar

Founder (four screenshots): "I don't see any power ups on Keenum. Let's
actually have a chip on players in the app when tgey have power ups.
click the chip to see what power ups apply. Can we have the cards hug
the bottom more like on web, and go down with the bottom menu?" The
v0.375.0 pips only showed TARGETED plays — Keenum wore team buffs, which
the web's spot chips include via buffAppliesToSpot. That predicate moved
to core (one definition; web re-exports it) and the app's appliedFor now
adds armed buffs that matter to the slot's pos/metric. The pip row is
one tappable gold ⚡N chip → Overlay sheet listing icon/name/blurb per
power-up. Hand geometry: label gone, cards sink their feet under the
room bar (SINK 44, lift 50 = BAR_H), and the whole fan rides the bar's
scroll-duck via new ScrollShiftCtx — menu folds away, hand goes with it.
Bar got zIndex/elevation to outrank the sunk card feet. APK 36914.

### v0.375.0 — the app's hand is always dealt, and slots wear their plays

Founder: "power up rail on mobile floats in an awkward spot. it would
be better to just replicate the hand from the web. We also don't get to
see which power ups are assigned to Keenum on his card like on mobile
web." App PowerupHand: the stowed POWER UPS tab is gone — the fan sits
sunk against the bottom edge like the web's, always dealt, board
scrolls behind it (HAND_TAB_H now = the peek). SetupRow cards wear
gold icon pips for every targeted play attached to the slot (myTargeted
fetch; TargetedState type grew the battle-play lists). Display-only —
applying targeted plays stays on web until that flow ports. APK 36913.

### v0.374.2 — Sleeper-style stat lines

Founder (Sleeper screenshot): "I like how compact it is" + "If someone
has no targets we don't need a receptions stat. if they have no catches
we don't need receiving yards. if no carries, no rush yards." fmtStat
rewritten: every zero stat drops (even a QB's 0 TD), yards lose their
rush/rec prefix (the count before them says which), each block's TDs
ride the block, empty lines read "—". Applies everywhere fmtStat renders
(box scores web+app, board cards). check-box-game QB-phrasing pin
updated. Return yards were already captured — just buried in zeros.

### v0.374.1 — a player swap lands whole (0261)

Founder: swapped Dobbs out with Player Swap; the spot then read NO
METRIC · 0.0 (kept the QB metric an RB can't score) and the metric-swap
modal still showed Dobbs (read pre-swap picks; swaps are an overlay).
Fixes: swap entries carry toMetric (client keeps the metric when the
new position scores it, else defaultMetric(pos); server records it with
the locked-metric gate); both engines fall back via new swapMetricFor
so legacy no-metric swaps score the position default; the SwapMenu now
resolves the post-swap identity (player, metric, bench exclusions).
Probe 16 (swap entry carries the landing metric). Founder's live PRE 4
swap self-corrects on the next resolve.

### v0.374.0 — the three scopes, ruled and enforced (0260)

Founder's ruling on the scope review: (1) LOCKED — every card gate and
the buffsForWindow stamp comparison move to the pick clock (kickoff −
1h; new window_locks_at in SQL, LOCK_LEAD_MS in core, test-lead aware);
(2) Extra Slot is scope 1 (before the week's first lock — server already
enforced via lock_at; client appliable re-pinned); (3) Ball Hawk is
scope 2 — coinFor computes the turnover swing per WINDOW (boosted only
where the arm preceded the lock; stipend taken once, not per window).
Probes: 13k/15g re-pinned to 'window already locked' + 15g2 (inside the
final hour is locked, kicked or not).

### v0.373.0 — cards play mid-week, per window (0259)

Founder, hand full of "Before lock-in" cards on PRE 4 Saturday: "still
can't play cards." Whole-week lock predated late swap. Now: team buffs
arm until FINAL, mid-week arms stamped (buffsAt) and both engines count
a stamped buff only in windows kicking AFTER the stamp (buffsForWindow
in matchup.ts + liveResolve per-window sets + award filters + worker
resolve.js parse) — arming Hail Mary after Thursday's TD can't score
Thursday. Pre targeted plays (DoN/ByeSteal/Rivalry/Ghost/LeadChange/
Grudge/Jinx/RedHerring) gate on their TARGET window's kickoff; moving a
DoN/ByeSteal stake off a playing window refused. Web appliable offers
pre cards while any window is un-kicked ("Counts the N windows still to
kick"). Probes 15a–15i.

### v0.372.1 — the hand is the whole apply surface (0258)

Founder: "can we use the card hand on the web for applying all power
ups." The web hand (and ✦ APPLY modal) now shows EVERY owned card, not
just ones playable this instant — off-window cards sit dimmed wearing
their window as the note (⏳ deadline), actions withheld. A refused
server apply is now a loud alert instead of a console warn — which
exposed 0086's entitlement gate refusing ALL targeted applies on
practice boards (practice never ledgers, so purchases read 0): 0258
skips the ledger gate on practice weeks (throwaway purse; per-play caps
still bound it). Probes 14a–14d.

### v0.372.0 — Underdog is a modifier, not a metric (0257)

Founder: "under dog isn't a scoring metric." It left the picker: the
Underdog card now attaches to one of YOUR slots (✦ APPLY → tap the spot,
confirm) before that window's kickoff; the slot KEEPS its chosen metric
and every score it banks while TRAILING its duel counts ×1.5. New
apply_underdog RPC consumes the owned card (0256 model, practice-safe);
arm path + metric map dropped underdog (legacy sealed picks still score
via the kept metricId path). Engine: resolveSlot youUnderdog/
theirUnderdog opts wired through buildMatchup extras + liveResolve +
worker resolve.js. Mobile hand excludes the card until targeted applies
port (usable on web). Probes 13a–13l.

### v0.371.0 — metric unlocks are cards (0256)

Founder: "Purchase goes to your power up hand and then when you can use
it is gated. Nothing expires. No refunds. Maybe just a confirm before
you use the power up." Shop sells unlocks like any other power-up (a
card into the week's inventory, no auto-arm); arm_unlock consumes ONE
OWNED CARD instead of coin ('not owned' otherwise; final-only usage
gate); disarm_unlock returns the card, never coin (old-APK safe). Both
pickers offer a locked metric when armed OR owned and picking it shows
a confirm ("Use 1 × Return Yards? … No refunds") before consuming.
Probe 12 rewritten (12a–12n). Mobile rides APK 36910.

### v0.370.3 — the web shop tells the truth about unlocks

Founder, after 0255: "still can buy 'metric 1 week' power ups" — the web
shop had NO armed state and swallowed every server error, so an armed
unlock looked buyable forever and a refusal looked like a dead button.
Web ShopModal now shows ARMED / ✓ DISARM (combo: ARMED ×N + buy-again +
remove-one), surfaces buy/disarm errors in a red line (onBuy/onDisarm
resolve true|errorString), and Matchup grew disarmUnlockLive (refund,
mirrors server-side pick clearing via LOCKED_METRIC_UNLOCK). App: the
stale client gates on unlock buys (armsClosed / week-locked) dropped to
match 0255 — server decides. App changes ride the next APK.

### v0.370.2 — purchases are never blocked (0255)

Founder: "we shouldn't ever block purchases, just power up usages."
arm_unlock's status gate removed entirely (0254 had left final-only) —
the shop never second-guesses timing; enforce_window_lock (0058) and
enforce_locked_metric (0024) keep guarding the picks. Extra slot keeps
its pre-match rule (buying IS applying — it restructures every window
for both players). Probe 12 re-pinned: final matchup still sells an
unlock, extra slot still refuses.

### v0.370.1 — metric unlocks arm mid-week (0254)

Founder, PRE 4 Friday with 645 practice coin: "I can't buy anything
'metric - 1 week'." arm_unlock still had the pre-0058 whole-week gate
(refuse unless status='scheduled'), closing the shop at the week's first
kickoff even though 0058's late swap keeps later windows' picks editable
until their own kickoff. Gate is now final-only; 0058's window trigger
keeps guarding the picks themselves. Probe: preseason-practice section 12.

### v0.370.0 — commissioner coin grants follow the board (0253)

Founder, after a preseason grant "didn't take": "Let's set coin to the
regular season wallet after the preseason is over. So adjustments now
take, but they wipe after this week. Let's have a note in the commish
screen in leagues with preseason active." New league_practice_week
(earliest non-final week > 100) routes commish_seed_coin into that
week's throwaway practice wallet (clamped at 0 on claw-backs, flagged
{practice, week}); admin_league_wallets and admin_league_members' coin
column show the same purse (un-seeded seats read the 120 budget). All
final → season path exactly as before. Preseason note added to the web
COIN tab and the app's DRIP COIN BY TEAM (rides next APK). Probes:
preseason-practice section 11 (11a–11r).

### v0.369.9 — the box-score rows get readable too

Founder (screenshot on phone): "we need to increase the font size on
mobile web for the box score." Player rows on both hosts scale up: name
11 → 13, statline 8.5 → 10.5, pos tag 7.5 → 9, team header 10 → 12 with
16px crest, OFFENSE/DEFENSE tabs 9 → 11. Web BoxScoreCard + native
BoxScoreSheet; native change is in APK 36909.

### v0.369.8 — the game strip gets readable

Founder, first minutes on the browser: "can we make the text of the top
strip a bit bigger..I can't read all the games." Strip chips on both hosts
go 9 → 12 with matching padding and a 7px live dot (web BoxScoreCard,
mobile BoxScoreSheet). Mobile rides the next APK.

### v0.369.7 — the box score becomes the week's box-score browser

Founder: "Let's make the box score have all the games. list all the games
at the top and you can horizontal scroll through them. Red dot for active,
Grey text for final, Black text for upcoming. Have the game info directly
under that then the player box score. When you click on the box score for
a game, it opens the box score view to that game." Built on both hosts:
new core weekBoxGames(week) (gameFeed) lists the full slate in kickoff
order with a three-state status (final only when the feed SAYS post; a
feed with plays and no state is live — the board sim writes none; no feed
is upcoming; feed games the slate doesn't know are appended) + latestPlay
(the strip's score/clock, latest-by-c, revisions win ties). The web
BoxScoreCard and the app's BoxScoreSheet both open on the game whose BOX
SCORE chip was tapped, with a horizontally scrolling game strip (red dot
live · faint final · plain upcoming), the selected game's score + clock /
FINAL / kickoff line under it, then the offense/defense box. The origin
game follows the log's scrub clock; every other game shows its latest.
Pinned in check-box-game (20 assertions). App side rides the next APK.

### v0.369.6 — namesake plays resolve by role, and the named kicker scores

Founder: "still some defense guys on the offense tab and folk is the
Atlanta kicker." Two worker-side attribution fixes in the ESPN adapter:
(1) buildRoster kept ONE athlete per play-text abbreviation (first-write-
wins) — two men abbreviating identically ("T.Dodson") meant one owned every
mention, which is how four defenders wore rushing/receiving lines. The
roster now keeps every candidate (with team + boxscore side), and resolve
is role-aware: offense team for runners/passers/receivers/kickers, defense
for tacklers/interceptors/forcers, the receiving side for returners, with
boxscore side as the same-team tiebreak — preferences narrow, never
exclude, so a lone candidate still resolves (fakes are real). (2) Kicks
were written only to the team pseudo-player, so the human kicker sat with
an empty line while "ATL K" held his points (and a league rostering the
man scored him 0): the named kicker now gets the same fg/xp/fgmiss/xpmiss
rows alongside the pseudo, and the box score drops the pseudo row when a
human kicker with kicking stats is in the column (legacy rows keep it).
New server/test/espn-attr.mjs (7 assertions, synthetic summary, including
one play where one abbreviation is both the runner AND the tackler).
Worker redeploys on merge; mid-game polls reconcile the full play set, so
running games self-correct on the next poll.

### v0.369.5 — the box column reads the current team, not the 2025 tag

Founder: "Tua is on the falcons. How hard would it be to actually use a
player id?" — the ids were already in use (game membership by game_id,
plays by ESPN athlete id), but the box COLUMN still trusted slugMeta's
team, which answers from the baked 2025 play stream first (kept
deliberately, for baked-play possession scoring) — so an offseason mover
sat in his OLD team's column whenever that team was in the game (Tua,
MIA→ATL, in ATL@MIA). The current team already exists id-keyed on the
client: the worker diffs Sleeper's directory into player_team_override
daily and the bio bake carries the rest (bio already had Tua on ATL) —
teamFor reads exactly that chain, and gameBoxScore's column now goes
through it, baked tag as last resort. Pinned (moved-qb, 19 assertions).

### v0.369.4 — the namesake tag never reaches a name

Founder: '"Josh Johnson QB"' — the worker mints namesake slugs with a
disambiguator (the lowercased position, `josh-johnson-qb` / `aj-green-cb`,
or the Sleeper id) and all ten slug prettifiers across both hosts
title-cased the whole slug, tag included. New core `stripSlugTag` (in
slugMeta): strips ONE trailing token, only when it's a position tag or all
digits AND a first + last name remain — team units (`bal-k`, `atl-dst`)
survive because their head has no hyphen. Display-only; the suffixed slug
stays the storage key everywhere. All ten prettifiers (web box score,
ClassicBoard, Matchup, FeedSheet, AdminPage, LeagueHub, LeagueInfo,
commishKit; app box score + ClassicBoard) now route through it. Pinned in
check-live-meta.

### v0.369.3 — the unknown player's box-score position comes from his stats

Founder, over ATL@MIA and CIN@PHI boxes: "Looks like some mix up def vs off
on Miami." Every wrong-tab/wrong-column man wore the WR chip: real corners
and edges the bio bake has never heard of (CJ Henderson, AJ Terrell, Zach
Harrison, Maason Smith, Bralen Trice — verified absent from the bake, which
is fantasy-skewed) take slugMeta's WR/'' default — filed on the offense side
AND skipping the defender column flip, so an ATL corner tackling on MIA's
snaps landed in MIA's column. Plus "WR Josh Johnson Qb · 0/0 rec": an
unknown QB rendered as an empty receiving line. Fix in gameBoxScore: for a
man NOTHING knows, the line itself says what he is — passing stats → QB,
purely defensive line → generic DB (right tab, right column via the DEF
flip, stats phrased in their own vocabulary). Known players untouched: a
real WR with a lone tackle keeps the v0.343.2 two-way treatment. Four new
box-game pins (18 total). Known defenders showing small offensive lines
(Dodson 1 car, Ojabo 1 rec) are the worker resolver's attributions
surfacing through the intended two-way rule — server-side, watch item.

### v0.369.2 — pull-to-refresh inside All-fields too

Founder: "pull down to refresh on the matchup board and all fields should
refresh the board or fields, not kick you back to leagues." v0.369.1
covered the board; the All-fields overlay is its OWN fixed scroller, where
window.scrollY never moves — so usePullRefresh gains an optional scrollTop
reader, FieldBoard gains onRefresh (pull reads its own scroller, shows the
same ↻ hint, and the container takes overscrollBehaviorY 'contain' so the
pull can never chain out to the browser gesture). Both boards wire it to
their live poll's own load() via a ref — fresh plays + feeds now, without
tearing the overlay down: classic (10s/60s cadence) and the drip board
(15s cadence, live matchups only).

### v0.369.1 — pull down refreshes the board, not the page

Founder: "we need pull down to refresh the matchup board on web. right now
pull down kicks you back to your leagues." The browser's native
pull-to-refresh reloads the SPA, which boots to the default screen.
styles.css claims overscroll (`overscroll-behavior-y: none` — no screen can
be reload-kicked any more), and a new `usePullRefresh` hook (app/ui) is the
replacement: a >90px mostly-vertical pull that BEGINS at the top of the
page fires on release. ClassicBoard wires it to its loader counter (same
"re-run the whole load" the SimStrip's ▶/⏹ bump), disabled while any card
is over the board, with a fixed "↻ RELEASE TO REFRESH" hint while past the
threshold. The drip board keeps its realtime polling; the hook is there
when it wants the gesture.

### v0.369.0 — box-score membership joins on the GAME ID

Founder: "Jonathan Ward still in two places. Don't we have player IDs to
use?" — right on both counts. The v0.368.6 (pid, clock) join has one
degenerate case: the OPENING KICKOFF is pid ~1 at clock ~0 in every game,
so a kick returner collided on both. And yes, the exact key always existed:
live_play.game_id and game_feed.game_id — dropped at the API layer, which
is what forced the box onto heuristics. v0.369.0 threads game_id through
(weekLivePlays/weekGameFeeds selects, RealPlay/RawPlay gain `gid`,
WeekGameFeed/TeamGameFeed gain gids/gid) and membership is now: where a
player's play gids name any of the week's feed games, the answer is exact —
his gid matches this game's or he's out. pid/clock + team rules stay as the
fallback for data without game ids (2025 bakes; the board sim's flat 'SIM'
gid names no feed game so it proves nothing either way). check-box-game
pins the opening-kickoff collision, the gid-decides-membership case, and
the sim fallback (14 assertions).

### v0.368.7 — Matthew resolves through Matt (first-name variant slugs)

Founder: "hibner is a TE" — the WAS@BAL box listed BAL TE Matthew Hibner as
WR. The directory bake files him `matt-hibner` (TE · BAL) while the live
feed's plays are slugged `matthew-hibner` — an unknown slug, so slugMeta
fell to the WR/'' default. slugMeta now tries first-name-variant slugs
(matt/matthew, mike/michael, steve/steven/stephen, … — a conservative
same-name-different-dress table, surname must match exactly) as the LAST
resort before the default: for a man nothing knows, the variant namesake's
meta beats a guaranteed-wrong WR/'', and any exact entry (overlay, baked
slugs, bio) still wins outright. Pinned in check-live-meta with the real
Hibner rows. Fixes pos AND team (column placement) everywhere slugMeta
resolves — box scores, boards, scoring — on both hosts.

### v0.368.6 — the one-play returner stops haunting every box score

Founder, over preseason All-fields sheets: "how is Jalen Reagor on two
teams?" — Reagor and Jonathan Ward (return-only lines) appeared in BOTH
Friday games' boxes with identical stats. The v0.352.3 majority rule (most
of a player's play ids must be in this game's feed) collapses at one play:
a returner's single small id collides with an early play of every game and
1-of-1 is a majority. Membership now requires id AND game-clock to agree
(same clockOf both sides, ±3s for revision jitter), and the column
derivation counts only matched plays so a collision can't steer the column
either. check-box-game pins both one-play cases (genuine → seated;
collision at a different moment → out).

### v0.368.5 — app windows stop lying about LIVE + the slate sheet opens from the live board

Founder, on the APK drip board pre-kickoff: "these should be locked but not
live yet" + "in the web version if you click on the slate you get a pop up
of the games in the window. let's have the same in the app." Two app fixes,
both in the Duel (live board): (1) the window status chip fell back to the
MATCHUP's status, so the moment the matchup went live every window wore
● LIVE, kicked or not — the window's own clock decides now (winKicked, with
hasRows as the feed-truth override), revealed-but-not-kicked reads 🔒 LOCKED
(the web's word), unrevealed stays SEALED; (2) the Duel's slate crest row is
a door: it opens the SAME Game Slate sheet the setup board already owns
(games, kickoffs, fielded players both sides), handed through a new
onOpenSlate prop rather than duplicated — the demo replay omits the prop
and its crest row stays inert. App-only; rides the next APK.

### v0.368.4 — once the ball is live, the stats ARE the card

Founder: "once the game starts we don't really need the game info. just the
player stats." Live/done rows drop the clock, opponent and venue marks: the
full statline takes the card, wrapping beside the score. One word survives —
"Final" — because done-vs-still-playing decides whether to keep watching.
Pre-kick cards keep kickoff + opponent + projection unchanged; the clock,
game score and play log stay one tap away behind ▦ field. Same rule on the
app board (statline becomes the game line, three lines allowed) — next APK.

### v0.368.3 — full statlines on the classic row

Founder: "how can we rearrange the player boxes to show their full stat
lines?" The web GameCard's statline shared its line with nothing but still
sat in the text column BESIDE the 16px score, so on a phone it ellipsed
after two stats. Rearranged: the score rides the when-line (clock + score
are both short), and the statline gets the card's full width and WRAPS —
so the web board now renders the FULL fmtStat format (C/ATT, INT, sk, the
whole rushing line). The compact format — still what the app board and the
drip live cards use — gains the QB detail it dropped ("18/25-230 pass",
INT/sk when they happened), and the app's statline wraps to two lines.
App changes ride the next APK.

### v0.368.2 — the rehearsal fields YOUR roster (0252)

Founder, auction roster open beside the board: "the sim isn't using my actual
roster." Both seats fielded the same stars (both started J. Allen) — the
auto-slotter filling from a stale pool. Mechanism: the board and the sim draw
lineups from the week's sleeper_lineup pool rows, and native_materialize
(0064) — the only rewrite from native_roster — deliberately skips any week
whose matchups are not all 'scheduled'. A week the sim ever locked/finalized
is frozen after, so its pool kept its pre-draft contents, the client
auto-slot wrote picks from it, and admin_sim_start locked them as lineups.
Fix (0252): native_materialize_week — the 0064 rewrite scoped to one week,
no all-scheduled guard — runs in BOTH admin_sim_start and admin_sim_reset
for native leagues, and both drop sealed picks naming players their seat no
longer holds (emptied spots stay; Sleeper-mirror sandboxes untouched — their
lineup rows ARE the roster truth). Seats left with no picks fall to
simLineups' autoLineup off the now-correct pool. SR9 pins it: stale pool +
stale pick → start rewrites the pool from native_roster, drops the stale
pick, keeps + locks the real one; reset keeps the materialized pool.

### v0.368.1 — bigger per-player points

Founder: "Do we have room to make the points scored by each player larger?"
Yes, on both hosts, without costing row height: the web GameCard's number sat
beside a two-line text column (13px in a ~30px box) — now 16px; the app's
score column was 11px in a fixed 38px box — now 12.5px in 42px, which costs
each name cell 2px (a per-player score is at most five mono chars, so the
v0.323.1 name-width work is untouched). Rides the next APK for the app.

### v0.368.0 — the classic row goes live: game clock, statlines, playing vs yet-to-play

Founder, first rehearsal WITH data flowing: "The game times below the players
didn't tick through. We also need statlines for each player synced with the
feed. The yet to play lines also didn't change." Three gaps, all real on live
Sundays too, not just sims: (1) the row's game line showed the kickoff time
forever — now it follows the game: kickoff pre, the feed's game clock ("Q2
6:10", core fmtQuarterClock/feedClockLabel — latest released play, revisions
win ties) while live, "Final" after; (2) rows showed bare points — BoardEntry
now carries `statline` (core boardStatline: the week's counting line off the
same live plays the points come from, null until the player has a counted
play, compact format), rendered under the game line on both hosts; (3)
"yet to play (9)" over nine live rows was the header contradicting its own
board — BoardSide.yetToPlay now counts only 'pre', new `playing` counts
'live', the win-probability spread still counts both (a live score is still
unresolved), and the header renders "playing (n)" + "yet to play (m)" /
"all final". Also: the NFL SLATE chip and slate sheet get the same sim
override the rows got in v0.367.2 (chips' state came from the slate clock,
so they said "9 starters to play" mid-sim). Board checks pin the new
semantics. Mobile twin updated throughout — rides the next APK; web is the
rehearsal surface today.

### v0.367.4 — the missing COPY: the worker image never shipped the gamefeed bakes

Founder, third report: "stil no stats by the individual players" — on a build
whose client code was verified correct twice. The tell was in their OWN
screenshots: no ▦ FIELDS chip, ever. Root cause: the worker's Dockerfile
copies public/pbp but NOT public/gamefeed — so on Fly, loadBaked (plays)
works and loadBakedFeeds returns null GRACEFULLY (its catch): plays flowed
(header counted), game_feed rows were never written, the board's gameFeeds
stayed empty, simTeams stayed empty, and the v0.367.2 state override — keyed
off the feeds — never fired. Every symptom across three rounds, one missing
COPY line, zero error logs. Fix: COPY public/gamefeed into the image
(Dockerfile is in deploy-worker.yml's trigger paths, so this redeploys the
worker), and the sweep now LOGS loudly when a run has no baked feeds — the
grace that hid this is no longer silent. Reset + re-run after the worker
deploy: rows, fields, and the FIELDS chip should all light.

### v0.367.3 — the rehearsal breathes: 10s cadence, instant ▶/⏹ refresh, a visible build stamp

Founder, still mid-rehearsal: "Still no numbers, it also looks like the scores
don't reset immediately when you hit reset." Verified the v0.367.2 fix IS on
main and the team-code predicate matches every real feed code (normTeam probe
over the baked w1 gamefeed) — the remaining culprits are the classic board's
PRODUCTION cadence and an unfalsifiable client build. Three fixes: (1) the
SimStrip now prints APP_VERSION ("🧪 REHEARSAL · v0.367.3") — the classic
board showed no version anywhere, so a stale PWA bundle could not be told
apart from a real bug, twice now; (2) the board's live poll runs every 10s
under LIVE TEST (production keeps 60s) — a 10-40× rehearsal on a minute
cadence reads as a dead board; (3) SimStrip grew onChanged, and ClassicBoard
re-runs its WHOLE loader on ▶/⏹ (simVer dep) — reset flips matchup.status
back to scheduled and unlocks picks, which only the loader reads, so a
poll-only refresh left the header in live dress over a reverted week. Web-only.

### v0.367.2 — rehearsal scores flow: the sim feed outranks the slate clock

Founder, mid-rehearsal ("Should the scores be at 0?"): the worker was
streaming plays (feed at 6:10) but every player read "Yet to play" with
projections. Root cause — exactly the seam the rehearsal exists to catch:
ClassicBoard's `entryFor` derives per-player state from the REAL 2026 slate's
kickoffs (`entryState(g.kickoff, …, nowTs)`), and Sep 10-14 is in the future,
so every player stayed 'pre' and the board showed projections while live
points were already accruing in live_play. On a real Sunday the kickoffs pass
and this never bites; in a sandbox the FEED must be the truth. Fix (web +
mobile ClassicBoard): under 🧪 LIVE TEST, a `simTeams` set (teams with plays
in the week's game feeds, normTeam'd both sides — the feed speaks nflverse)
overrides state to 'live' ('done' once the matchup is final); the slate path
is untouched for real leagues, and the branch is unreachable without the
sandbox flag. Web ships on Pages; the mobile half rides the next APK (the
current APK still shows the slate-gated "Yet to play" during a rehearsal).

### v0.367.1 — classic rehearses on the REAL board; the week-0 replica retires

Founder, over a Week-0-vs-real-board screenshot pair: "Looks like we have a
custom board for the demo. Can we please reuse the actual matchup board for
the sim so I know everything works as is." Exactly right — a rehearsal that
proves the plumbing must run on the board that ships. The 0251 worker sim
already speaks classic (resolveMatchup branches on game_mode; the classic
branch explicitly refuses drip-shaped lineups leaking in), so: the REHEARSAL
strip (SimStrip) now renders on the web ClassicBoard too (loads
leagueTestLiveAt; strip self-gates on the server's forbidden) — ▶ drives the
real classic board through live_play → resolver → classic finals. The week-0
ClassicSim door is REMOVED from both boards (web + mobile; mobile
ClassicSim.tsx deleted, stepper floors back at week 1), and web ClassicSim
reverts to its bare v0.365.3 self — the hidden #/classic-sim scoring-shape
comparison on demo teams, which is what it started as. Mobile door removal
rides the next APK; the current APK still watches a simmed week fine (it
reads the same rows).

### v0.367.0 — ▶ sim from the board: the dress rehearsal, playable in place

Founder: "Can we make this all playable from the matchup board in the test
league?" The feed simulator (CLI/workflow only until now) grows a board door.
0251: `sim_run` control table + admin_sim_start/reset + sim_run_state — same
double gate as 0250 (admin AND 🧪 LIVE TEST), one sim per week across leagues
(SIM feed rows are week-scoped). START does the CLI's pre-flight (lock picks,
matchups live, fresh SIM rows); the WORKER's new sweep (server/src/simsweep.js,
wired into the tick beside sweepNative) advances a derived clock
(wall-elapsed × speed, cursor on the row so a restarted worker resumes, never
replays), drips due plays into live_play + game_feed, resolves each tick, and
finalizes through resolveMatchup-at-final (finals + coin) when the feed is
spent. Judgement is IMPORTED from simulate.js (buildFeed/simLineups/keyOf now
exported; simulateLive refactored onto simLineups — CLI dry re-run PASS). Web:
SimStrip on the live board (LIVE TEST leagues; self-gates on the server's
forbidden) with ▶ SIM WEEK / ⏹ RESET + a 10s status poll. Tests: sim-run
probes (74th suite: gates, pre-flight, refusals incl. cross-league same-week,
reset reverts everything) + server/test/sim-sweep.mjs pinning the cursor
windowing ((from,to] with no gap/overlap, dedupe keeps the latest delivery).
Founder recipe: throwaway league → 🧪 LIVE TEST → open the board → ▶.

### v0.366.0 — ⚡ admin stamp-week: the vampire/guillotine playtest lever

Founder: "how can I play test the vampire and guillotine mechanics?" Both arm
off a FULLY-FINAL week, which only the worker produced, on the real calendar —
so the arcs couldn't be rehearsed before Sep 9. New 0250 `admin_stamp_week
(league, week?, favor?, doom?)`: writes plausible finals (70–130) across one
week, DOUBLE-GATED — is_admin() AND league.test_live_at (the 🧪 LIVE TEST
sandbox flag) — so it can never touch a real league. p_favor makes a seat WIN
its matchup (arm the vampire's steal), p_doom hands it the week's floor
(choose the blade's victim); week null walks to the earliest unstamped; a
stamped week refuses a second stamp. After stamping it fires the format's
engine the way the worker's sweep would (guillotine_tick inline; vampire
result says whether the steal window armed). Probes: stamp-week-probes.sql
(72nd suite) pins both gates, the walk, doom-picks-the-victim, and favor
opening/its absence closing the steal window — negative control run (gate
stripped in scratch → probe fails, restored → refusal returns). Web UI: admin
panel ADMIN MODES grows "⚡ stamp next week" + favor/doom seat inputs, shown
only while LIVE TEST is on. Playtest recipe: throwaway league → 🧪 LIVE TEST →
tap stamp per week.

### v0.365.5 — the app gets WEEK 0: the classic sim ported to mobile

Founder validated the web week-0 sim ("looks good. Let's put it in the app").
New apps/mobile/src/ui/ClassicSim.tsx — the web sim's league mode as a native
sheet: same core judgement (classicPointsFrom clock-filtered, bestballFillBy,
projectedPoints), native mechanics where the platforms differ. The app replays
its BUNDLED 2025 week (w8, the demo's — the web sim uses its own DEMO_WEEK 2;
both are "a real 2025 week", neither claims to be the same one), installed via
the Metro-require door (installRealWeek/installGameFeedWeek, idempotent beside
the demo board's own install). The scrub bar is a PanResponder track (RN has no
range input) — tap or drag seeks; PLAY/⏭ as on web. Mobile ClassicBoard grew
the identical week-0 door: canGo allows next 0, goWeek(w+d===0) opens a
simOpen overlay (week 0 has no matchup row — the loaded week-1 board stays
under it), early-returned above the bye guard, handing the sim slotDefs, sc,
bestball, golf, names, stash-filtered rosters + exp. Swipe-right from week 1
reaches it too (same goWeek). Needs an APK; web unchanged this bump.

### v0.365.4 — classic leagues get WEEK 0: the sim inside the matchup view, under league rules

Founder: "wire it into each classic league as a week 0 in the matchup view. It
should use all the league scoring and rules." ClassicBoard's week stepper now
steps BACK from week 1 into the sim (week 0 — a `simOpen` overlay, not a
weekWanted change, since week 0 has no matchup row and would land on "No
matchup this week"). ClassicSim grew a `league` prop: the board hands it the
league's slot layout (slotDefs), merged scoring catalog (`sc` — and the scoped
rules + flags the board installed into the module caches score the sim too),
best-ball spots (always filled by actual points), golf, team names, and both
sides' stash-filtered rosters with exp attached (tenure slots). League mode
hides the PPR chips — the league's rules are not a toggle — and captions the
honest caveats (2026 rookies score 0 on a 2025 week; an empty spot means no
roster fit). Bare mode (#/classic-sim, admin) is unchanged — verified
byte-identical in headless Chromium (127.7–108.8 final, 48.3–49.9 scrubbed).
Web-only; the app's ClassicBoard has no week-0 door yet (future APK work).

### v0.365.3 — Classic Sim: a hidden, scrubbable playtest of classic mode on 2025 data

Founder: "how can I play test classic mode? Can we use 2025 data to sim a
week?" The drip board always had a scrubbable 2025 demo; classic only had
ClassicDemo (a static scoring compare). New `ClassicSim` screen (web, hidden —
super-admin panel → 🧪 classic sim, or #/classic-sim) loads the same baked
DEMO_WEEK, fills both sides' classic lineups (projection or best-ball), and
drives a clock you drag/play. Scores are `classicPointsFrom` over each starter's
plays filtered to `clock <= scrub` — so it can't disagree with the real board —
and the shared FieldView renders every starter's game at the current clock, so
the down & distance + box score scrub alongside. Verified in a headless
Chromium: Week 2 renders 127.7–108.8 at final, 48.3–49.9 scrubbed to mid-game
(maxClock 3895 catches OT), 13 games' fields drawn. Web-only, additive, no
engine/DB/mobile change.

### v0.365.2 — full QB line in the box score; down & distance on the field visual

Two founder asks, both on the live-board box-score/field surface (web + app).
(1) The QB box-score line showed only pass yds + TDs (+ loose rush yds). It now
reads the full game line — C/ATT · pass yd · TD · INT · sk · car · rush yd ·
rush TD — driven by the 0166 truth flags the feed already carries (cmp/inc/skd/
turnover), which `statlineFrom` now counts into new StatLine fields (comp, att,
sacked, passInts). Legacy data without the flags falls back to the old yds+TD
line, and the compact card format is untouched (only the box score reads the
full format). (2) The field visual now prints the CURRENT play's down &
distance next to its play text (the situation chip above still shows the
resulting next snap) — goal-to-go aware, ported identically to the mobile
FieldView. Web ships on Pages; the mobile halves need a new APK.

### v0.365.1 — web box-score gets the app's OFFENSE/DEFENSE tabs; app all-fields sheets pull-to-refresh

Two founder asks. (1) The web field-visual box score (FieldView.tsx) was a
single flat list; the app grew OFFENSE/DEFENSE tabs (v0.343.2) via core's
`boxTabRows` (stat-driven membership, two-way players on both tabs). Web now
has the same tab bar over the same `gameBoxScore` — one source of truth, so the
two hosts can't disagree. (2) The app's "All fields" sheets (drip LivePicks +
ClassicBoard) had no RefreshControl, so you couldn't pull-to-refresh the slate
while the sheet was open — the fields only moved on the realtime push. Both
sheets now wire the SAME `onPullRefresh`/`refreshLive` the main board uses (it
re-pulls every game's feed + plays), so a pull updates all fields at once
without leaving the sheet. Web box-score change ships on the Pages deploy; the
mobile pull-to-refresh needs a new APK to take effect.

### v0.365.0 — web: metric unlocks arm into applied_state (match the app), so Combo Drip saves

Buying a metric unlock on the web (Combo Drip / Return Yards / Air Raid /
Underdog) put it in team_inventory via wallet_buy_powerup — a store the
save-gate never reads. The DB gates (enforce_locked_metric,
enforce_single_combodrip) read applied_state.unlocks, which only arm_unlock
writes and the web never called. So a bought-and-picked unlock was silently
rejected at the sealed_pick upsert (whole-batch → NOT SAVED). The app arms into
applied_state and gates its picker on the armed set; the web now does the same
(founder's call — "match the app"): on the LIVE board a metric-unlock buy calls
arm_unlock (spends the wallet, combo qty+1), and the metric picker + underdog
door + mulligan gate on the armed set instead of local inventory. Boolean
unlocks arm once and field on any slot; Combo Drip is one slot per purchase
(comboOpen caps the picker client-side so an over-pick never reaches — and gets
rejected by — the whole-batch save). Sim/demo boards keep the local-inventory
consumable model unchanged (unlocks is null there → inventory fallback).
Web-only; no DB/engine/mobile change. Follow-up: the web shop doesn't yet show
armed unlocks as "ARMED ×N" or offer a sell/disarm (buy feedback is the balance
dropping); and stale pre-fix team_inventory unlock rows are orphaned (harmless).

### v0.364.6 — web: autosave no longer paints a permanent "NOT SAVED" over a saved board

The founder swapped a player in an OPEN Thursday slot and it silently didn't
save, under a stuck "NOT SAVED — Window tnf is locked" banner. Root cause: the
autosave effect (Matchup.tsx) batches EVERY window's picks into one upsert, and
the slot-cap/lock triggers reject the WHOLE upsert if any row is bad — so one
locked window's rows vetoed the open-window edits riding along AND left the
banner up over an otherwise-saved board. The batch filtered windows on
`windowKickoffMs` (kickoff), but `enforce_window_lock` refuses a window from its
LOCK time (kickoff − 1h), so a window in its lock hour (tnf: locks 6pm, kicks
7pm) slipped into the batch. Gate is now `windowLockMs`; locked windows stay out
of the save, open edits land. Web-only.

### v0.364.5 — web: the OTHER half of the setup-window edit lock (card preKick)

v0.364.4 fixed the roster RAIL but the founder was still blocked: the board
CARD itself stayed locked. The card's `preKick` (Matchup.tsx) — the "locked in,
kickoff within the hour" state that locks a card (Underdog door aside) — was
board-level (`preKickPhase = phase === 'live' && !anyStarted`) and passed to
every window. So the instant the earliest window entered its lock hour, the
board phase went 'live' and EVERY setup window's card locked, even while its
per-window badge correctly read SETUP. `preKick` is now per-window on the live
board (`winRt(window) === 'locked'`); sim/demo keeps the single board phase.
Together with 0.364.4's rail fix, a window reading SETUP is fully editable —
card and roster — regardless of what other windows are doing. Web-only.

### v0.364.4 — web: a live window you can still edit stays editable (roster fix)

Founder, on a live PRE 4 board: windows reading SETUP couldn't have their
PLAYERS changed. Confirmed a real web bug. The drip board's roster rail
(RosterAside, src/screens/boardParts.tsx) gated its player taps on the
BOARD-LEVEL phase — `interactive = side === 'you' && phase === 'setup'` — but
that phase flips to 'live' the moment ANY window in the week kicks off (all
windows setup → setup, else live; Matchup.tsx:782). So in a multi-window week,
once the earliest window locked, the whole rail went dead and a LATER window
still in its setup period could not have a player placed or swapped — even
though it correctly showed a SETUP badge and its metric picker still worked
(that path is per-window, which is why only PLAYER editing broke).

Fix: RosterAside takes an optional `winEditable(winId)` and gates each player
by ITS OWN window's state rather than the board's; the live board passes
`(id) => winRt(id) === 'setup'`, and the sim/demo board (one global phase)
passes nothing and keeps the old fallback. Native was already correct — it
assigns through the per-slot picker (per-window winLocked), not a board-phase
rail — so this is web-only. No migration, no worker.

### v0.364.3 — the worker drives the endgame (playoffs/guillotine no longer stall)

Sweep finding: playoffs and the guillotine only ever moved when a member opened
the right screen — the client's generate/advance/tick pokes were the ONLY
driver. A league whose managers were away between rounds simply stalled, and a
bracket advanced late landed its next round on a lock_at the tick had already
passed, so it never resolved. Silent, and with no push to prompt anyone.

The Fly worker now drives all three on its own cadence (server/src/native.js
sweepProgression, hourly — rounds are weekly, and the round's own scoring is
stamped every tick by the resolver from v0.364.1, so nothing here is
latency-sensitive): build round 1 once the regular season is final, advance a
finished round, drop a guillotine week. Full leagues only (kind='league', not
mocks/pods/weekly). Everything is idempotent and self-guarding server-side, so
a quiet sweep is cheap and a redundant one is a no-op — and because the worker
advances promptly, the late-advance/past-lock_at stall can't arise.

The catch was auth: the worker calls as the service role (auth.uid() null).
advance_playoffs already allowed that (0073), which is why it alone worked — it
seeds from the STORED bracket. generate (auto) and guillotine_tick refused the
null uid, and generate also seeds from LIVE standings, so league_standings
refused it too and the {error} object then blew up jsonb_array_elements. 0249
gives those three the same one-line guard advance_playoffs uses
(`auth.uid() is not null and not (...)`) — nothing else in the bodies moves,
the MANUAL seeded generate stays commissioner-only (only its auto branch
learned the null uid), and there is no anon exposure (the grants are
authenticated-only, and an authenticated user always carries a uid, so a null
uid is only ever the trusted worker key).

New scripts/db/worker-progression-probes.sql (71 suites): as the worker (app.uid
= '' → null), build round 1, refuse a manual seeded generate, advance to a
champion, and drop a guillotine week — each of which a negative control (0249
reverted) fails with 'forbidden'.

### v0.364.2 — a disarm refund must prove the coin was paid (mint closed)

Sweep finding #3, confirmed by reproduction: unlimited coin forgery. Two
writers put buffs into applied_state.buffs — arm_buff (0157), which CHARGES the
wallet, and hero_set_buffs (0157), the inventory model's apply sync, which
writes them for FREE. disarm_buff (0063) then refunded powerup_price for any
buff present, with no check a charge ever happened. So: free-arm a buff via
hero_set_buffs, disarm it to be handed its price, repeat. Reproduced live —
five loops minted 475 coin from a zero balance.

0248 gates disarm_buff's refund on a real, unrefunded ledger charge: net of
what arm_buff spent ('spend:<buff>') minus what past disarms already returned
('refund:<buff>:<epoch>'), for this seat and matchup. A buff armed through
hero_set_buffs has no spend row, so its net paid is 0 and nothing comes back —
which kills the loop; a buff genuinely armed through arm_buff still refunds
once, and a second disarm finds the charge spent. The amp-cascade guards and
the applied_state write from 0063 carry across untouched. Practice weeks are
exempt (their spends never hit coin_ledger, and credit_wallet caps a practice
refund at the week's budget — no real coin to forge). The legacy charged pair
is no longer called by either client, so no live flow changes; only the free
money goes.

New scripts/db/coin-mint-probes.sql (70 suites) proves both halves against the
scratch DB: five free-arm/disarm loops move the wallet by 0 (a negative control
with the old unconditional refund fails here with the exact 'minted 475'), a
charged arm→disarm still nets to zero, and a re-armed already-paid-back buff
cannot double-refund.

NOT fixed here (separate, deeper): hero_set_buffs still writes scored buffs
without checking inventory ownership, and the worker scores applied_state.buffs
unconditionally (finding #4) — free SCORED buffs, a competitive-integrity hole
that needs an inventory-reconciliation decision rather than a refund gate.

### v0.364.1 — the week actually closes (worker: finals get stamped)

The single most serious finding from the mode/season sweep, and it would have
bitten the FIRST real scored week (Sep 9). The only writer of a matchup's
home_final/away_final is resolveMatchup, and only at status==='final'
(server/src/resolve.js). But the worker tick's completed-week branch
(index.js) returned right after finalizeMatchups — which ONLY flips status
live→final — and before its live resolve loop. So on the tick that finalized a
week, nothing resolved it; every later tick returned there too. Result: a
finished week's finals stayed NULL forever, and everything downstream that
reads `home_final is not null` — standings, playoff seeding/advancement, the
guillotine floor, weekly coin banking — silently never moved. It hid because
no real week had completed yet (preseason uses practice weeks, which don't
rank or bank) and because NOTHING tested the tick's orchestration: every
resolve test called the engine or resolveMatchup directly, never the tick's
decision of WHEN to call it.

THE FIX (server/src): finalizeMatchups still flips status; a new stampFinals
(resolve.js) then resolves every final matchup that still lacks a score
(status='final' AND home_final IS NULL) through the real resolveMatchup, with
no startedWins so all windows publish and the totals are complete. It targets
unscored finals rather than "what I just flipped", so a transient failure is
retried next tick instead of stranded, and once every final carries its score
the query returns nothing and the pass goes quiet. The tick's completed-week
branch now finalizes then stamps (setting the runtime slate first so a cold
start still derives real windows); the old, provably-dead second finalize
below the live loop was removed — its presence hid that the close was missing
a resolve.

THE TEST that proves it, on the REAL scorer (not the demo): test/final-resolve.mjs
drives the actual finalizeMatchups → stampFinals pair on baked Week-1
play-by-play and asserts (1) finalize ALONE leaves home_final NULL — the bug
itself, pinned — then (2) stampFinals writes real non-zero finals (76.6–56.3)
and banks both sides' coin, and (3) a re-run is a quiet no-op. Folded into
`npm run smoke` (which now runs engine-smoke + final-resolve); the full worker
suite is `npm test`.

Noted for a separate look, not fixed here: test/h2h-verify.mjs's coin
assertion is stale (expects a 50 stipend baked into the resolver; the resolver
now returns MVP/window coin only, ~30/15 — the flat stipend moved to the
weekly-budget path). It prints ✗ but exits 0, so it never gated anything.

### v0.364.0 — a bye is not a zero, and not a crash

Founder, on odd-sized leagues: "can we do byes throughout the schedule and
playoffs?" — then, once the damage was clear, "let's stop the bleeding."

BYES HAVE ALWAYS HAPPENED. 0064's circle method pads an odd league with a ghost
seat and skips that pair, so exactly one team has no matchup each week, and any
commissioner can build an odd league from the team stepper today. What never
happened is anything downstream knowing about it. Three things were live:

THE GUILLOTINE EXECUTED THE BYED TEAM. The floor read `coalesce(<that week's
final>, 0)`, and a team with no matchup scores 0, which is always the lowest
score. In an odd guillotine league that is not an edge case, it IS the season:
the blade falls in bye order until one team is left for reasons unrelated to
fantasy football. 0247 makes the score NULL rather than 0 and drops a null seat
from the candidates — not being eligible to die on a week you did not play is
not a rule change, it is what the rule already meant. A negative control (the
old `coalesce` restored, the new probes run) executed roster 1 on its week-1
bye, which is the commissioner's own seat.

THE WEB BOARD WHITE-SCREENED. With no matchup row the hub still navigated to
the board with a null context, and the board fell back to `'rock-tunnel'` — a
BAKED DEMO TEAM — asserted non-null and threw on its name. A classic league hit
it too: the classic handoff is gated on that same null context, so it fell
through to the drip board. The lookup is checked now instead of asserted, the
hub opens on the nearest week the seat actually plays, and both week steppers
walk YOUR weeks rather than the league's.

THE COPY BLAMED THE COMMISSIONER. Every "no matchup" screen said the schedule
had not been synced, on a schedule that had generated correctly. A bye and an
unbuilt schedule are both "no row" from one seat, so 0247 adds
`league_week_role` to tell them apart league-wide; the classic boards keep
their week nav on a bye instead of dead-ending, and the guillotine board prints
BYE rather than 0.0 with a knife next to it.

Also: the leagues list fell back to the week-LESS `myMatchup` on a miss, which
is `.order('week').limit(1)` — it printed the Week 1 opponent as this week's.
`myMatchupFrom` asks for the next game at or after a week instead.

LEFT UNDONE ON PURPOSE — fairness, not bleeding: the extra byes still land on
the lowest roster ids every season (9 teams over 14 weeks byes seats 1–5 twice
and 6–9 once), and standings still sort on wins then TOTAL points-for, which
favours whoever played the extra game. Odd PLAYOFF brackets (3/5/7) are still
unsupported, and remain the same job as 16/32 teams: the general seed-and-bye
engine, which reproduces all four hand-written shapes exactly (n=8 comes out
`(1,8),(4,5),(2,7),(3,6)`, the current insert order).

12 new source assertions (779) and 8 new scratch-DB probes (63 suites).

### v0.363.0 — a league can play no playoffs at all

Founder: "you should be able to turn off and customize playoffs in all leagues."

CUSTOMISING them has existed since 0073 — bracket size and start week, any
native league, locked once underway. What was missing is OFF. A league that
wants its season to simply end (a guillotine, a keeper league that settles on
the regular-season table, a wide pod where a four-team bracket is beside the
point) had no way to say so — and 0162's auto-generation would build one
anyway the moment the last regular-season game went final.

OFF IS `playoff_teams = 0`, not a new flag. Every reader already goes through
`league_playoff_teams()`, so a zero is understood everywhere at once, and a
league that never set the key still reads the default 4 — nothing existing
moves. 0246 teaches `set_playoff_rules` to accept it (deleting a bracket that
was only ever SCHEDULED, which the function's own "playoffs are underway"
guard makes safe: a played game can never be erased this way), and guards the
one place a bracket is built. There are exactly two callers of that place —
the commissioner's button and 0162's poke — so one guard covers both: the
poke returns a quiet no-op, because it fires on EVERY member's league load all
season and an error there would paint a banner on a screen working exactly as
configured; the commissioner's own call is refused with the reason.

A GUILLOTINE LEAGUE IS OFF BY CONSTRUCTION. It runs all 17 weeks (v0.362.0)
and its survivor is the result, so a bracket booked for week 15 would collide
with a season still being played. `set_league_format` now switches playoffs
off when the format goes guillotine, next to where it already presets the FAAB
market — and leaving guillotine does not silently re-book one.

Both hosts get the control: OFF leads the bracket row, because it decides
whether the rest of the panel means anything, and the start week, generate
button and seeding list hide behind it. The app's playoff card returns nothing
at all for an off league — a heading over "there is no bracket" is the same
nothing with a title on it. Both panels' helper paragraphs folded into one ⓘ,
and the trophy/crown prefixes came off the champion lines.

Bracket sizes are still 2/4/6/8: round-1 seeding and `advance_playoffs` are
hand-written per shape, so 16 or 32 is a bracket-engine rewrite, not a bound.
That stays open.

8 new scratch-DB probes (62 suites) — the default is untouched, the auto poke
is silent, the manual call explains itself, turning back on restores the
knobs, and guillotine sets itself off without help.

### v0.362.0 — a guillotine league plays all 17 weeks

Founder: "Guillotine leagues go all 17 weeks. let's make sure that is wired in."

WHY 17 IS THE RIGHT NUMBER, and not just a bigger one: guillotine is the only
format with no playoffs to leave room for — the survivor IS the result — so
weeks 15–17, which 0073 reserves for a bracket, are regular season here. And
one team falls per COMPLETED week, so N teams need N−1 scored weeks. At 14 the
format quietly capped at 15 teams and anything larger ended with several still
alive and nothing to crown a winner. At 17 it reaches 18.

WIRED IN TWO HALVES, because neither alone is enough:
  · `scheduleWeeksFor(format)` in `core/data/league.ts` — both create flows
    read it, so neither host decides a season's length on its own.
  · migration 0245 re-cuts an EXISTING schedule inside `set_league_format`, so
    a commissioner who flips the format later gets the right season on either
    host without a client remembering to.

THE ORDER TRAP THAT MADE THE SPLIT NECESSARY: both create flows call
setLeagueFormat BEFORE generating the schedule, so a server-side 17 at creation
would have been overwritten by the client's own generate a moment later. 0245
therefore only re-cuts when a schedule ALREADY EXISTS — at creation there is
none, and the client makes it at the right length. The probes assert exactly
that: the format change must NOT conjure a schedule pre-creation.

REGENERATING IS SAFE PRECISELY WHERE THIS FUNCTION ALREADY IS. 0221 refuses
guillotine once the draft leaves 'pending' or the blade has fallen, and
`native_generate_schedule` refuses to touch a schedule holding any matchup that
is not still 'scheduled'. The body is copied from 0221, the live definition,
with the block appended and three locals declared.

AND THE DEFAULT THE FOUNDER ASKED FOR EARLIER NOW LANDS. "Guillotine should
default to 18 teams" was deferred because 18 was neither reachable (the server
capped at 14 until 0244) nor finishable (14 weeks). Both are gone, so picking
GUILLOTINE now lifts the team count to 18 — a default, not a lock, in the same
spirit as a contract type presetting the auction room.

New `guillotine-weeks-probes.sql` (11 assertions, wired into the runner): the
17-week schedule, that 18 teams can actually eliminate to one, that nobody byes
(the floor reads a missing matchup as 0, so a bye is an automatic elimination),
the commissioner flip in both directions, and that VAMPIRE keeps its 14 — it
still has playoffs.

Battery green: both typechecks, 767 parity assertions, vite build, **61 probe
suites**, server smoke.

### v0.361.1 — the roster editor stops explaining itself

Founder: "Let's make the preset slots a drop down or card so it doesn't take up
so much room. There's a crap ton of helper text on the roster editor. Let's
info chip it."

PRESET SPOTS IS A PICKER. Eight pre-baked spots wrapped to three rows inside an
editor that already runs long, and the list only grows. One button opens them
over the page, where each has room to say what it IS — "Rookie Superflex ·
QB / RB / WR / TE · best ball · rookies only" — instead of shouting ROOKIE
SFLX. The 20-spot ceiling is stated in the picker rather than silently doing
nothing on the 21st tap.

FIVE HELPER PARAGRAPHS FOLDED INTO ⓘ: the taxi squad's lock rules, IR
eligibility, the spot LABEL field's "shows on the draft board", ZERO-FILL's
best-ball caveat, and the classic/scoring cross-reference. Both section headers
became LabelInfo, which is how the rest of this screen already labels a control.

THREE STAYED, and they are the rule rather than an oversight (v0.350.2: state
is not explanation): the two EMPTY STATES that tell a drip league why this
editor has nothing in it — that is the screen's content, not a note under a
control — and the one dynamic line, "Positions the league can roster: …",
which reports what the spots above it currently add up to.

A NOTE ON THE MECHANICS, because it cost a broken build: three of those
paragraphs were the entire body of a conditional (`{mode === 'classic' && (…)}`,
`{sp.bb ? (…) : (…)}`). Deleting the text left `&& ( )` and an empty ternary
branch, which is a parse error rather than a blank space. The best-ball branch
is now an explicit `null` and its caveat lives in the ZERO-FILL ⓘ.

Battery green: both typechecks, 767 parity assertions, vite build.

STILL OPEN: the WEB's roster editor has its own helper text and has not had
this pass.

### v0.361.0 — 32 teams, and a menu that lists what is behind it

Founder: "Under each chip title, the small text should just list the items in
the area. no flavor text" and "We also need the option to have up to 32 teams
in any league."

THE SUBTITLES ARE INVENTORIES NOW, on both hosts' league menus. Two tiles
already did it right ("lineup spots · limits · waivers · trades", "seats ·
rules · kit · scoring") and the rest were describing themselves instead —
"every team in the league and who they're holding", "how this league turns
plays into points". Each new list was read off the sheet it opens rather than
invented: Scoring's are the `<Head>`s of its own sheet (catalog · adjustments ·
scoped bonuses), Alerts' are the push kinds the server actually sends (chat ·
trades · waivers · playoffs), Draft room's are its four tabs. The rule reached
the board's own menu rows too.

32 TEAMS — migration 0244. `create_native_league` has refused anything over 14
since 0064 and every redefinition since carried the line forward. Nothing else
in the schema needed changing: `native_generate_schedule` pairs any n ≥ 2 and
ghosts an odd count (0215), the seat loop is `for i in 1..p_teams`, and
POOL_CAP is 1200 — 32 teams over a 15-man roster is 480 picks. Both clients
raised with it, the app through a named MAX_TEAMS so the stepper and the
database quote the same number.

THE FUNCTION BODY WAS COPIED FROM 0218, THE LIVE DEFINITION, with two changes:
the bound and the message quoting it. New `team-cap-probes.sql` (13
assertions, wired into the runner) exists for exactly that reason — it asserts
the new ceiling at both ends AND that a 32-team league still comes out whole:
32 seats minted, a draft at the rounds asked for, and 0218's `salary_cap` and
`continuity` keys still landing on a contract league. A cap raise that dropped
the capkeys branch would pass any test that only counted teams.

TWO THINGS THE PROBES TAUGHT ME, both about the harness rather than the code:
a fixture must grant itself the `native` entitlement (0095) or every create
returns "invite-only" and the suite asserts the GATE, not the cap; and the
runner greps STDOUT under `set -euo pipefail`, so a suite that reports through
`raise notice` (stderr) is read as a failure even when every assertion passed.
Failures `raise exception`; the banner is a `select`.

WHAT 32 TEAMS DOES NOT YET DO, written into the migration so the next reader
finds it: playoffs still seat 2/4/6/8, so 8 of 32 make the bracket; and a
guillotine league needs N−1 scored weeks, while the schedule is generated at
14 — so anything over 15 teams ends with several still alive.

Battery green: both typechecks, 767 parity assertions, vite build, **60 probe
suites**, server smoke.

### v0.360.2 — the salary room a league never had, and four less crowded screens

Founder, a batch: the copy-from list could get long, the commish menu still
wears icons, SALARY shows in a league with no contracts, kill the pickaxe, and
let the draft filters scroll.

THE BUG FIRST. `SALARY` in the app's commissioner map was gated `nativeOnly`,
which every native league is — so a redraft, keeper or dynasty league offered a
room whose own screen opens on "OFF — this league plays without contracts". It
now gates on `contractOnly`, read from `league_contracts.contracts` the same way
`classic` is read from `league_game_mode`: false until the read lands, because a
menu that pops an item IN reads worse than one that briefly omits a room.

COPY-FROM IS A CARD NOW, not a chip per league. One chip carries the current
answer and the list opens over the form — a commissioner with a dozen leagues
was going to push the rest of the step off the screen. Each row shows the
league's own type line, so the choice is made on what the league IS.

DRAFT FILTERS SCROLL. Position chips, the two star modes and TAKEN wrapped to
three or four lines on a phone, and every one of those lines pushes the PLAYER
LIST further down during the minute you are on the clock. A swipe to reach the
last chip is cheaper than rows of the thing you are reading. Order is
deliberate: ALL and the positions first, so what scrolls out of reach is the
modes, not the filter used every pick.

ICONS: 97 prefixes out of `CommishTools` (the app's commissioner map, its
section headers and its sheet titles), and the ⛏ pickaxe is gone from all 8
files that carried it, both hosts.

Battery green: both typechecks, 767 parity assertions, vite build.

STILL OPEN from the same batch, and deliberately not guessed at: the roster
editor's helper text, the preset-slots picker, and guillotine's team count —
that last one is not a default change, see the note to the founder.

### v0.360.1 — words, not icons; ⓘ, not paragraphs (pass 1)

Founder: "no icons. make info chips instead of helper text. actually, apply
this to whole app and web. icons only when necessary and info chips over text."

BOTH RULES ALREADY EXISTED — this is finishing them, not inventing them:
  • **v0.350.2** (app): "instead of explaining everything, let's have info
    chips with pop ups." A control gets its LABEL and one ⓘ; the paragraph
    opens on demand. DYNAMIC STATUS LINES STAY INLINE — state is not
    explanation.
  • **v0.356.7** (app): decorative emoji prefixes leave; STATE markers stay,
    because they carry what the words don't repeat.

Neither was ever applied to the WEB, which is why it still looked like this,
and the app sweep missed the league board entirely.

THE WEB HAD NO INFO CHIP AT ALL — two hand-rolled ⓘ (a board row's player dot,
the metric sheet) and no shared component, which is exactly how its settings
screens grew a paragraph under every control. `InfoChip` / `LabelInfo` now sit
in `app/ui.tsx` beside the other prims, built on the existing Sheet.

PASS 1 — the screens the founder was looking at, both hosts:
  · app `Recruit.tsx`: 67 prefixes out (DRIP, NORMAL, KEEPER, DYNASTY,
    CONTRACT, GUILLOTINE, VAMPIRE, LIVE, SLOW, and the root menu's icon
    column, which was mine from v0.360.0 an hour earlier). Six helper
    paragraphs folded into the ⓘ that already labelled their control.
  · web `NativeLeague.tsx`: 56 prefixes out across the create screen, draft
    room, cap sheet and team tools.

WHAT STAYED, and why it is not an oversight: ⚠ on a severity line and ✓ on a
state line ("✓ you're in this one") are the markers v0.356.7 kept. ✓ came OFF
the two BUTTONS — a tick on an action is decoration, not state. Untouched by
design: the power-up art in `data/powerups.ts`, `chatReactions`, and the sim's
drama markers — those are the game's own vocabulary, not chrome.

VERIFIED THE BLANKET REPLACE WAS SAFE: nothing anywhere compares against an
icon-bearing label (`=== '◈ DRIP'` and friends return nothing), so every one of
these strings is display-only.

STILL TO DO — this is pass 1 of a staged sweep, not the whole thing. Roughly
900 icon uses remain across ~69 files, the heaviest being web `AdminPage`
(200), app `CommishTools` (174), web `Matchup` (78), app `LeagueExtras` (52),
web `CommishDash` (43) and web `commishKit` (42), plus the helper-text pass on
every web settings screen now that the web has a chip to fold into.

Battery green: both typechecks, 767 parity assertions, vite build.

### v0.360.0 — the league board is a tree

Founder: "Let's make this a tree of selection screens rather one big screen."

THE BOARD ANSWERED FIVE QUESTIONS AT ONCE — browse, start one, join with a
code, post yours, redeem a commissioner code — stacked on a single scroll, with
the longest of them (the create form, eight questions) in the middle of it.
Every visit paid for every answer. So: a root MENU, one screen per branch, and
the create branch stepped one question at a time.

THE STEP LIST IS COMPUTED, NOT CONSTANT. COPY SETTINGS only appears when there
is something to copy from, so a first league is never asked a question with one
possible answer — which is why the counter reads "of 6" for a new account and
"of 7" for the founder's. NEXT is REFUSED rather than hidden on the two steps
that can be wrong rather than merely unfinished (no game picked, no name), and
it says which — a disabled button with no reason is a dead end.

THE LAST STEP IS THE WHOLE ANSWER, because the steps that built it are behind
you and the one thing you cannot undo is about to happen: name, teams, game,
continuity, format, draft type and clock, plus the league being copied when
there is one.

WHAT THIS DELETED, and it is the point: the collapse-and-scroll from v0.359.0
(open the create card, then jump the ScrollView to it) was the old shape's
apology for a screen that answered everything at once. A branch you can
navigate to needs neither, so `makeOpen`, the layout probe and the one-shot
scroll ref all went, and `Card`'s `onLayout` passthrough went back with them.
Each branch now scrolls to its own top on entry — carrying the previous
screen's scroll position into a new one is how a tree feels broken.

THREE DOORS, THREE DESTINATIONS. The leagues screen's FIND chip lands on the
listings it names, ＋ ADD lands on the create branch, and the board tile — which
advertises all of it — lands on the menu. `onBoard` takes which.

The five section bodies are MOVED, not rewritten: the listings, the post
section, both code forms and every question of the create form are the same
JSX, re-parented. The only copy that changed is the header line per branch.

Battery green: both typechecks, 767 parity assertions, vite build.

### v0.359.1 — the control row on one line, measured

Founder, with a screenshot of the row wrapping: "let's make the top buttons fit
on one line. we don't need the icons if we need more space."

DROPPING THE ICONS WAS NECESSARY AND NOT SUFFICIENT — which is only knowable by
measuring, and the measurement also turned up why the row was wider than it
looked: the chip's text is **fs(11.5) = 13px**, not 11.5. Everything below the
15px TYPE_PIVOT gets lifted by the type scale, so every estimate made off the
source number is ~13% short.

Measured at 13px bold against the usable width (screen − 12 container − 4
inset, both sides), for the four chips plus their 6dp gaps:

    icons + "FIND A LEAGUE" / "ADD A LEAGUE"    519dp   wraps at 412dp
    icons dropped, same words                   481dp   wraps at 412dp
    "FIND LEAGUE" / "ADD LEAGUE", no parens     429dp   wraps at 412dp
    ALL 4 · COMMISH 4 · FIND · ADD              305dp   fits from 360dp

So the words had to go too. `ALL 4 / COMMISH 4 / FIND / ADD`.

THE PARENS CAME OFF FOR THE CASE THAT BREAKS A TODAY-FITS FIX. With them,
"COMMISH (12)" is 10dp more than "COMMISH 12" and the row is 347dp — which
fits the founder's phone and wraps on a 360dp one. A commissioner with twelve
leagues is exactly who this row is for, so the fix has to hold at two digits:
without parens it is 323dp and still fits.

WHAT THE CHIPS NO LONGER SAY, THEY SAY TO A SCREEN READER (`a11y="Find a
league"` / `"Add a league"`), where nothing is competing for width. flexWrap
stays as the safety net — a future label that outgrows the row should fold
rather than clip.

NOT TOUCHED: the web's row, which carries the same icons and the same words and
wraps the same way on a phone — but has room to spare on the desktop layout the
same component serves. Shortening it there would cost clarity where there is no
problem. Worth a look if the founder wants the mobile web to match.

Battery green: both typechecks, 767 parity assertions, vite build.

### v0.359.0 — a league shaped like one you already run

Founder: "let's add the create/add a league and league board to the app. When
creating a new league, you should be able to copy the settings from an
existing."

FIRST, WHAT WAS ALREADY THERE. The app has had all four doors since v0.225.0
and v0.226.0 — browse the board, post a listing, redeem an invite code, create
a league outright — every one of them inside `Recruit.tsx`. What it never got
was the web's v0.292.3 control row ("put the find a league at the top by the
all/commish chips"): the only way in was a dashed tile at the BOTTOM of the
leagues screen, under the league list and the archived shelf, with START A
LEAGUE another scroll inside that. A door that exists and cannot be found is a
door you get asked for. So 🔎 FIND A LEAGUE and ＋ ADD A LEAGUE now sit beside
ALL/COMMISH, the row always renders (only the FILTER is conditional — hiding it
for a non-commissioner takes the create button from the people most likely to
need it), and ＋ ADD A LEAGUE opens the board already scrolled to the create
card, once, via an onLayout the ScrollView jumps to.

COPYING A LEAGUE IS NOT ONE CALL, which is why `data/leagueBlueprint.ts` exists
rather than a `p_copy_from` argument. A league's settings live in three tiers:
what `create_native_league` takes (teams, roster size, draft type and clock,
auction budget and lots, the overnight window, position caps, drip vs classic,
keeper/dynasty and its N), the scoring catalog, and the roster/transaction
rules (waivers, FAAB, trade review, the windows, taxi, IR tags) — plus a
classic league's own shape. Only the first tier can be set at creation; the
rest are setters on a league that already exists.

SO A COPY CAN HALF-LAND, and that is the fact the module is built around.
`applyBlueprint` never throws and never rolls back — it returns a step list,
and both screens print what refused. The app shows a note beside the success
banner; the web HOLDS THE SCREEN rather than navigating to the dashboard,
because a page change would hide the misses behind it and the commissioner
would meet their missing scoring in week 1, from a score.

ORDER IS LOAD-BEARING IN ONE PLACE, and it is asserted rather than remembered:
`setLeagueFormat` presets a $1000 FAAB market for a guillotine league, so the
format goes on BEFORE the transaction rules or the copied budget is overwritten
by the preset.

THE PICKER LISTS LEAGUES YOU HOLD A SEAT IN, not ones you merely commission.
`commish_overview` carries neither continuity, format nor game mode — only the
`my_teams` row does — so sourcing it from the commissioner's list would have
copied a contract dynasty classic league into a redraft drip league without
saying a word. What a read genuinely cannot see lands in `unread` and the
picker says so.

WHAT YOU CAN SEE, YOU CAN CHANGE. The blueprint prefills the form; the form is
the truth at submit, and the effective blueprint is rebuilt from it before
anything is applied. The fields the form never asks (roster size, caps, the
night window) ride from the source — which is also why `rounds` and `caps` on
the web now defer to the blueprint: they are derived consts, and without that
a copied league silently reverted to the game-type default in the one place
nobody checks until the draft.

New `check:blueprint` — 27 assertions. The pure halves are tested directly; the
apply sequence is a chain of RPCs, so its two invariants (format before
transaction rules, every setter wrapped so none can throw) are pinned by
reading the source with comment lines stripped. One of them counts
`create_native_league`'s own `p_` arguments, so adding a parameter there fails
HERE rather than silently dropping a setting from every copied league.

Battery green: both typechecks, **767 parity assertions**, vite build, 59 probe
suites, server smoke. No APK yet.

### v0.358.4 — the spine has to earn its place

Founder: "I don't like the chips with the highlight on the left. What other
options do we have?" — then, from seven treatments rendered in the real neon
palette: "Let's do the G chips."

THE BAR WAS ON EVERY CARD, which is the same as being on none of them. A mark
every row wears marks nothing; it was decoration, and it was the loudest thing
left in a list v0.356.16 had just finished quieting down ("let's make the
league chips less busy"). So the card now rests inside a plain border and the
spine appears ONLY while the league wants something from you.

WHICH IS DRAFTING, AND ONLY DRAFTING. That is the one live signal this card
still carries: the waiting dot and the ⚠ lock alarm moved to the room bar and
the hub in v0.356.16, and re-reading them here just to paint a border would
undo that on purpose. The bar is --opp rather than --you because the DRAFTING
dot beside it is already --opp — one state should not speak in two colours.

BOTH HOSTS, ONE RULE, so they cannot drift: `LeagueCard` in LiveOnboard.tsx and
the play card in the app's Leagues.tsx, same condition, same colour, the same
comment in both places.

WHAT WAS DELIBERATELY LEFT ALONE, because gating a change on the condition that
motivated it cuts both ways (v0.332.0 → v0.333.0): `card2`'s default spine,
which three other web surfaces still use; the mock-draft card's amber; and the
commissioner-without-a-team card on either host. Those mark a KIND of row in a
section of their own, not an alarm. One thing to fix when it earns a session:
that card is --you on the web and --warn in the app. They should agree.

Battery green: both typechecks, 740 parity assertions, vite build.

### v0.358.3 — the alert wears our mark, not Android's robot

Founder, with a screenshot of their own status bar: "how do I get my alerts to
show up with a custom icon?"

THE ROBOT IS THE FALLBACK, and both of our push surfaces were asking for it.
Android's status-bar glyph keeps ONLY THE ALPHA CHANNEL — it discards the
colours and tints the remaining shape itself — so a full-colour icon arrives as
a solid opaque square and the system draws its own default instead.

  • the app declared no icon at all: `expo-notifications` sat in app.json as a
    bare string, with no `icon` and no `color`.
  • the web was worse, because it looked done: `sw.js` set `badge` — which IS
    the status-bar glyph — to `icon-192.png`, the full-colour art. Pointing it
    at a picture is the same as pointing it at nothing.

So one asset, generated once, worn by both: a white droplet on transparent,
96x96, in `scripts/gen-notification-icon.py`. `color` is `#34E5D9`, neon's
accent and the app's default theme, which tints the glyph in the shade.

THE DROPLET, NOT THE APP ICON. The mark has to survive 18px, and at that size
interior detail is mush — the icon's own DF letters and the PWA mascot both go.
A droplet is the brand read at a glance and it is legible at every density
Android will scale it to (measured at 18 / 24 / 36 / 48 before wiring it).

WHY IT IS COMPUTED, NOT DRAWN. `gen-pwa-icons.py` needs Pillow, which this
environment does not have, and headless Chromium silently drops SVG and CSS
transforms at a 96px window here — it returned a 2-pixel image, twice, and the
alpha check is the only reason that was caught rather than committed. So the
shape is arithmetic: a circle unioned with the triangle on its two TANGENT
lines, supersampled 4x4 for the edges, written out through a 30-line PNG
encoder. It reproduces anywhere Python runs. Two properties are asserted in the
generator rather than eyeballed — transparent corners, opaque body — because
those are exactly what a bad mask gets wrong.

iOS is unaffected: it uses the app icon and has no silhouette slot.

Battery green: both typechecks, 740 parity assertions, vite build, 59 probe
suites, server smoke.

### v0.358.2 — the weekly bake, two weeks out from the lock

The standing pre-season chore, four days late: `proj2026.ts`, `projStats2026.ts`
and `adp2026.ts` all re-pulled from StatHead, as_of **2026-08-26**. ADP moves
all summer and auto-slot, the seat agents, previews, the pod deal pool and the
keeper defaults all rank by these numbers, so a stale bake mis-ranks every one
of them at once. First lock is Sep 9.

ONE PULL, THREE FILES, as the headers require — `get_projections` served ppg,
games, sleeper_id and the eight stat components in a single call, so the level
and the components describe the same player at the same instant. ADP came from
`get_adp` (consensus blend: FantasyPros 2026-08-21 · Sleeper 2026-08-26 ·
FFC 2026-08-25).

WHAT ACTUALLY MOVED, and it is worth knowing how little: **75 of 445 ppg values
changed, and nothing else did.** Every name, every sleeper_id and every
projected `games` count came back identical to the 08-22 bake — checked as a set
diff against the old file before writing the new one. So no depth chart turned
over in those four days; the model just re-priced. Biggest moves are backups
whose role firmed up (Malik Davis 5.17 → 8.08, Tank Dell 6.29 → 7.93) and one
starter stepping back (Javonte Williams 17.25 → 16.25).

THE ADP FILE GREW, 200 rows → 221, and the cutoff is now written down rather
than eyeballed: the consensus blend degrades into unrostered and retired names
past its first TEAM-LESS row (this pull: `Isaiah McKoy,WR,,239`), so the bake
stops there. Everything above it is a real player on a real roster. No name from
the previous bake fell out; the 21 additions are all deep-tail (ADP 213–239).

THE THREE PINS IN `check-draft-spots` HELD. Allen 20.4, Lawrence 18.0, Nacua
18.4 all came back unchanged — the pins exist precisely so a rebake has to stop
and look, and this time looking cost nothing. Only Taylor moved (24.7 → 24.9)
and his comment is updated with it.

HOW THE TRANSCRIPTION WAS PROVED, because a hand-copied 445-row CSV is exactly
where a silent wrong number gets in: parity's `check:projscoring` re-derives the
bake from the stat lines under the standard catalog, per row, with no systematic
drift — so ppg, games and all eight components have to agree with StatHead's own
arithmetic or the suite fails. Names and ids were proved separately by the set
diff above. A dropped TE row (Kenny Fletcher) was caught this way and restored
before anything was written.

Battery green: both typechecks, **740 parity assertions**, vite build, **59
probe suites**, server smoke.

NOT DONE: no APK. `packages/core` changed, so the app still ranks by the 08-22
numbers until one is built.

### v0.339.3 — the web reads the score the engine wrote

Founder: "I need these to match."

The web's window bar rendered `banksAtClock(s.events, clock)` — a local
re-simulation at this client's clock — while the app rendered the resolver's
own `getMatchupState` rows. Both were right about their own inputs and
disagreed on screen: a FLAT metric matched (clock-independent once the plays are
in) and a DRIP metric did not, because its value IS a function of the clock and
two clocks give two answers. Humphrey 6.5 vs 1.8; Nix 7.0 both sides.

The resolver decides the week, so it is the number to show. The live board now
fetches `getMatchupState` on the SAME 15s beat as the plays — a separate poll
would guarantee they were briefly inconsistent with each other — and the bar
prefers it whenever it exists.

WHY THE LOCAL SIM STAYS: `effWinClock` returns the manual playback position off
the live board and `winMax` on it, so the live board never had a scrub position
to preserve — but the SIM and DEMO boards do, and there is no server row there
at all. The sim is correct in exactly the place it is still used.

Two details that would have bitten:
  • totals are passed as NUMBERS, not the row. `WindowSection` is memoized on a
    key-by-key `Object.is`, and a fresh object from `.find()` is never equal —
    it would have re-rendered every section on every poll;
  • the bar falls back to the sim until the home seat is known, rather than
    guessing a side and showing the opponent's score as yours for one tick.

### v0.339.2 — a drip accrues per offensive minute, not per game minute

Founder: "Drip should be per minute of offense."

It wasn't, in any live game. `sim.offSecs` gates a drip on possession intervals
from `realPossFor`, which reads the baked week cache — written ONLY by
scripts/pbp/genRealPbp.mjs. No live path ever filled it, so live intervals came
back empty and `offSecs` took its `if (!intervals.length) return t1 - t0`
fallback: every drip accrued on every GAME minute. A metric defined as
"accrues while your team has the ball" meant nothing at all in-season, and it
over-credited by roughly the inverse of a team's time of possession — about 2×.

The feed already knows possession (`GamePlay.tm`), so the intervals are derived
rather than plumbed through a new column: `possFromPlays` in gameFeed.ts, with
`feedPossFor` as the per-team lookup. BAKED STILL WINS where it exists — it
comes from the full nflverse stream and a replayed baked week must score
exactly as it always has. Parity's baked-week suites passing is the proof.

The rule is keyed off the NEXT play's `tm`, not this play's `tm2`: tm2 only
appears when possession flips, so a feed omitting it on a turnover would credit
a whole drive to the wrong side. An assertion pins that the answer does not
depend on tm2 being present at all.

New `check:poss` (18 assertions), including the end-to-end arithmetic: a
14-yard receiver whose team held the ball half the game banks 1.4 gated and 4.2
ungated.

(FIXED in v0.339.3) the two hosts read different sources — the app renders the server's
`getMatchupState` rows, the web simulates locally at its own clock — so they can
still disagree even with the gating fixed.

### v0.339.1 — the box score reaches the app's field

Founder: "can we get the box score on the field visual in the app as well."

The web has had it under its field since v0.336.0; the app never did. Same
`gameBoxScore`, same clock the field is drawn at, so the two hosts cannot
disagree about a number — which is the only reason a second implementation of
this screen is acceptable. Everything with judgement in it (who is listed, in
what order, how a line reads) stays in core; only the sheet is native.

## (FIXED in v0.339.2) live DRIP metrics were ungated

Founder, on the app/web scoring split: "does the app drip every game minute,
not every team offense minute?" Yes, and worse than app-only:

  • `sim.ts` `offSecs` ends with `if (!intervals.length) return t1 - t0` —
    "no intervals (unknown) → full elapsed (drip ungated rather than dead)";
  • `realPossFor` reads `cache.get(week)?.poss`, and `poss` is written ONLY by
    `scripts/pbp/genRealPbp.mjs`, the BAKED generator. No live path fills it.

So in any LIVE game every drip metric accrues on every game minute instead of
only while its team has the ball. "Accrues while your team has the ball" is not
being honoured live at all — the fallback was meant for unknown data and has
become the normal case in-season.

Separately, the two hosts read different sources, which is why they disagree
numerically: the app renders the SERVER's `getMatchupState` window rows, while
the web's Matchup.tsx never calls it and simulates locally with
`banksAtClock(s.events, clock)` at its own clock. FLAT metrics agree (Nix 7.0
both sides) because they are clock-independent; DRIP metrics diverge (Humphrey
6.5 vs 1.8). Fixing the gating does not fix the two-sources split, and vice
versa.

### v0.339.0 — seat agents cover drip leagues, not just classic

Founder, after the diagnostic came back: "yes, let's extend seat agents to drip
leagues."

`diag-backup-windows.sql` measured the cost of 0180 stopping at classic: EIGHT
of twenty-four seats across the two live preseason drip leagues had no account,
so — `sealed_pick.app_user_id` being NOT NULL — they could not store a lineup at
ALL. Five of Gridiron Gang's twelve. Every week the lock-time fill skipped them
and they fell back to a rebuild at resolve. That is what an "unopposed" window
in a full league actually was.

NO MIGRATION. Nothing durable was classic-only: `seat_agent` has no mode
column, `transfer_agent_lineups` fires on any membership claim, and 0213's
`agent_wire_seat` never asked. Only two JS gates were — `ensureSeatAgents`
filtering to classic, and `materializeAutoLineups` skipping any seat without an
account. Both lifted.

AI SEATS ARE EXCLUDED ON PURPOSE, and this is the trap: an AI seat's lineup
comes from `aiSide` at RESOLVE, which is where its persona draw and its bought
buffs live. Give it an agent and the fill writes rows, `sideLineup` takes its
sealed-first branch instead, and the seat silently loses both. Those seats are
not missing a manager — they are the manager.

New `drip-agent-probes.sql` (suite 61): a drip agent can author a lineup, the
membership row STAYS NULL so open-seat counts are untouched (0180's load-bearing
invariant), the claim transfers the rows and retires the mapping, and the
open-seat count moves by exactly one. Verified to FAIL without the mapping.

Coverage honesty: the probes cover the durable half. The worker half — writing
as the agent — is the same code path a human seat takes with a different uid,
and has no test harness beyond module load. First tick after deploy is the
real check.

### v0.338.4 — return yards don't make you a receiver

Founder: "let's not include return yards in the yards when we determine
sorting."

v0.338.3's sort key was scrimmage PLUS return yards, so Jacob Cowing — 14
receiving, 86 on kick returns — sorted as the best receiver in the SF box
score. He wasn't, and that inversion is precisely what a box score is read to
avoid.

`scrimmageYards` is now passing + rushing + receiving only, and exported so the
exclusion is assertable rather than a claim in a comment. Return yards still
count in `weigh`, which is the TIEBREAK — so a pure returner still ranks ahead
of someone who did nothing at all, he just no longer outranks a real receiver.

Five new assertions in `check:boxorder`, including the exact line from the
screenshot that prompted it.

### v0.338.3 — the box score reads like a box score

Founder: "sort the box score by offense vs defense, then by position then by
yards (highest at the top)."

It was one flat involvement ranking (`weigh`: yards + TDs + defensive stats),
so a 6-tackle linebacker outranked a 46-yard receiver and every position was
interleaved. You could not scan it for "how did the backs do", which is most of
what a box score is for.

Now side → position → yards → weight → slug. Two judgement calls worth knowing:

  • YARDS is the full total, passing at face value — not `weigh`'s 0.4 passing
    discount. That discount exists to compare a QB against a RB; inside a group
    of QBs it only distorts the answer, and the groups are the point now.
  • WEIGHT survives as the tiebreak and earns its place: every defender has
    zero yards, so within LB or DB it does the entire ordering — tackles, sacks
    and picks, the only sensible reading of "highest at the top" for someone
    who gains none.

K, P and RET sit on the OFFENSIVE half, where a box-score reader looks for
them. Not reusing `matchupBoard`'s POS_ORDER, the closest existing list: it
ranks FB after DB, so it encodes no offense/defense split at all.

New `check:boxorder` suite (11 assertions) on the now-exported comparator —
`gameBoxScore` reads a week's plays from module globals, so asserting through
it would pin the plumbing rather than the judgement. The file's own comment had
claimed a test asserted this ordering; none existed until now.

### v0.338.2 — ALL GAMES means all games

Founder: "it looks like the games in the field view are just the ones with
match up players in them? Should be all games."

Correct, and the code said so out loud — `FieldView.tsx` described itself as
"every NFL game WITH A SLOTTED PLAYER", and `Matchup.tsx` built its entries as
"one entry per slotted player". The board's map was keyed off those entries, so
a game nobody in your matchup was playing in did not exist as far as that
screen was concerned. On a two-game preseason Friday that reads as a broken
feed rather than a filter, which is how it was reported.

New `allGameFeeds(week)` in gameFeed.ts — the feed could only ever answer
"which game is this player in", and this screen asks the opposite question. The
board seeds from the whole slate first, then overlays entries for tinting and
clock.

Two things preserved deliberately. A game an entry landed on keeps its SLOT
clock, so the field still mirrors exactly what the slot rows show — the seeded
Infinity must never survive there, and an assertion pins it. And games your
matchup is in sort to the front, so a full 16-game slate doesn't bury the two
you care about; the rest keep the feed's schedule order.

New `check:fieldboard` suite (18 assertions), wired into `check:parity`.

### v0.338.1 — agent seats check the wire hourly, and stop re-asking

Founder, after asking when agents actually act: "Let's also just make
claims/checks hourly."

v0.338.0 put the sweep in `tickContext`, which fires on `playsPollMs` — **every
25 seconds**. I had sized `MAX_CLAIMS_PER_SWEEP` calling that "often" without
checking what it meant. Two consequences, both real:

  • the planner is deterministic, so a seat with an unresolved claim re-derived
    the same plan every 25s and `submit_waiver_claim` refused it as a duplicate
    — ~3,000 wasted RPCs and log lines per claim between filing and the 3am run;
  • an agent took every player within 25 seconds of him clearing waivers, at
    3am, ahead of every human in the league.

Now hourly (`config.seatWireMs`, keyed per context so two active week contexts
don't starve each other), and the sweep counts OUTSTANDING claims rather than
only the ones it files: a seat holds at most two, excludes their players from
its own candidate pool, treats a promised drop as spent, and discounts an open
seat a drop-less pending claim would take. Removing a pending drop from the
planning roster cannot change what it plans against, because a drop is only
ever chosen from players who are NOT in the best lineup.

The hourly cadence is also the answer to the free-agent race: fast enough that
an injury is answered the same afternoon, slow enough that the seat reads as a
manager checking in rather than a bot camping the wire.

### v0.338.0 — an unclaimed seat works the wire

Founder: "Automated players for classic leagues. not only slotting players, but
also using waivers."

The slotting half already shipped — `autoSlotClassicLineups` has fielded an
agent seat's best legal lineup every tick since v0.248.0. What seat agents
(0180) had never done is TRANSACT, so an agent seat's week-3 ACL was still a
hole in December while the replacement sat in the pool.

**Policy** (founder's calls): fill holes on any gain, take an upgrade only above
2 projected points/week, never drop a player who is in the best lineup, bid
gain × $3 capped at 25% of remaining FAAB, and a commissioner switch separate
from the auto-slot opt-out. The hole/upgrade asymmetry is the design — one
threshold either ignores injuries or churns.

**No parallel write path.** 0213 widens the guard on `submit_waiver_claim` and
`add_free_agent` to admit the worker for a seat nobody holds, rather than
forking their validation. Two conditions must both hold: `auth.uid() IS NULL`
(service role only — every signed-in user has a uid) and `agent_wire_seat`,
which JOINS league_membership rather than trusting the seat_agent row, so a
stale mapping can never let the worker transact over a real manager's roster.

Decision logic is pure (`engine/seatWaivers.ts`), so the policy is asserted
without a database: 29 assertions in `check:seatwire`. The authorization
boundary is asserted in SQL where it actually lives: `agent-wire-probes.sql`,
suite 60.

Two things found on the way: the marginal value of an add is measured against
the WEAKEST STARTER DISPLACED, not the same-position starter (a 9.5 RB added to
RB 10 / RB 8 / FLEX 5 gains 4.5, not 1.5) — `lineupValue` gets this right by
re-solving the assignment, a hand-rolled same-position check would not. And
no_add flags are enforced by a TRIGGER THAT RAISES, so a flagged add would abort
the whole sweep; the worker filters them itself, because the engine's flag cache
is never installed worker-side (the gap lock.js documents for no_start).

### v0.337.2 — the web's live screens stop reading a 2025 fallback

The app's boards have installed the league pool's own slug meta since 0200.1;
the web's live drip screens never did, leaving them the last surface resolving
players through the raw bake. `poolToPlayer` already prefers a row's pos/team,
so the ENGINE players were fine — but everything reading `slugMeta` directly
was not: cardTable for the team logo, playerCard and ui.tsx for the injury
badge. A 2026 player the 2025 bake has never heard of came back as WR with an
EMPTY team, and an empty team reads as a BYE.

Fixed at the chokepoint — `buildLiveLeague`, which all three web live screens
(Matchup, LeagueHubPage, LiveOnboard) already call — rather than at each
screen.

The trap worth remembering: `slugMeta` consults the overlay BEFORE the bake, so
an override is authoritative. The ESPN shape of `starters_json` is
`{ slug, full, pos }` with NO team, so mapping rows straight through would
install `team: ''` and MASK a real baked team — turning a working player into a
bye, the exact bug being fixed. Each row is resolved exactly as `poolToPlayer`
resolves it, so the overlay can only add information, never subtract it.

New `check:livemeta` suite (10 assertions, wired into `check:parity`), on a
pure exported `poolMetaRows`. Verified it bites: reverting to the naive mapping
fails the masking assertion.

### v0.337.1 — the commissioner map lines up in two columns

Founder, on the app's Commissioner screen: "can we align these better in the
app?"

The map's chips were intrinsic-width in a `flexWrap` row, so every group broke
raggedly — SET UP 3-then-2, RUN THE SEASON 3-then-1 — and no two labels shared
a left edge. Now `justifyContent: 'space-between'` with a `49%` chip width:
two straight columns, emoji aligned down each one, and an odd-count group
leaves its gap on the right instead of scattering it.

Measured in headless Chromium before changing anything: the widest label
(⇄ WAIVERS & TRADES) is 147dp at `fs(9.5)`, and the founder's screenshot scale
put their device near 412dp, where the track is 173dp. The grid still fits the
widest label down to a 360dp screen. Labels are deliberately NOT
`numberOfLines={1}` — below that width a wrapped label still says which
destination it is, where an ellipsis would not.

### v0.337.0 — auto-pick a metric, the way we auto-slot a player

Founder: "we should auto pick a metric if there is none just like we auto slot
players."

Exactly the right frame. Auto-slotting already extends a courtesy at lock — you
left a spot empty, the worker fields your best eligible player rather than
letting the seat sit dead. A pick that kept its PLAYER and lost its METRIC is
the same situation one level down, and nothing was catching it: the seal froze
a player who scores EXACTLY ZERO all window, because `scorePlay` is a chain of
`if (metricId === '…')` ending in `return 0`.

Three paths null a metric on purpose so the manager re-picks — 0024 (a
locked-metric unlock disarmed), 0026 (a refund), 0062 (a combodrip change) —
and each is right on its own. What none of them does is make sure the manager
comes back before kickoff. Now the worker does it for them.

── ON THE SERVER, WHICH IS THE WHOLE POINT ────────────────────────────────

v0.336.0 removed a CLIENT-side default that looked identical and was not: it
drew a metric the resolver would never score, so the board promised points that
could not arrive. This one WRITES. What you see after lock is what the engine
scores, because it is the same row.

It runs INSIDE `lockDueWindows`, before the lock update in the same call, so no
window is ever sealed metricless — not even for the moment between two
statements. Unlocked rows only: a locked row is a sealed decision and stays one.

── THE DECISION IS CORE'S, THE READING AND WRITING IS THE WORKER'S ────────

`metricGapFills` decides which rows are gaps and which metric each gets, because
that is the part that can be wrong and it is testable without a database. Three
rules earn their assertions:

  • An EMPTY STRING is a gap, not a value. It is as dead as null and much
    harder to see (see isMetricSet — `??` sails straight past it).
  • A row with NO PLAYER is not a metric gap. That is an empty spot, which is
    auto-slotting's job; filling a metric onto it would invent half a pick.
  • An unresolvable position is SKIPPED, not guessed. A wrong metric scores
    something, which reads as a working pick; none at least reads as none.

And one that guards the defaults themselves: no position may default to a
metric that scores nothing for the player holding it — the bug
DEFAULT_AI_METRIC was written to fix was a QB defaulting to `fg` and a DEF to
`suppress`, both of which bank zero for their own man.

13 new parity assertions (718 total).


### v0.336.0 — the web was inventing a metric the server would never score

Founder, with two screenshots of the SAME pick at the SAME moment, both on
v0.335.0: "Monty has no metric in the app, but rush yards in web."

THE PHONE WAS RIGHT. `lookup()` in engine/matchup.ts resolved a pick like this:

    metricId: pk.metricId ?? pickMetric(found, 0)

— the POSITION'S DEFAULT, substituted client-side whenever a pick arrived
without one. That is a SECOND RULEBOOK. The server scores what is STORED:
`scorePlay` is a chain of `if (metricId === '…')` ending in `return 0`, so a
pick with no metric banks nothing all window. The web board meanwhile drew
"Rush Yards DRIP" over it and accrued a drip rate for a metric nobody fielded —
promising points that could never arrive.

It surfaced ONLY because the two clients disagreed in front of the founder. On
its own the web board was perfectly plausible and simply wrong, which is the
whole difficulty with a fabricated default: it makes the screen look complete.
v0.331.0's NO METRIC marker — which existed because of an earlier report on
this same player — is what made the phone able to say so out loud.

'' RATHER THAN NULL. `SlotInput.metricId` is `string` through the entire
resolver (threading null through it produced 27 type errors and a refactor of
the scoring path at the end of a long night), and '' is ALREADY this engine's
no-metric value — `resolveSlot` takes `metricId: ''` for the unopposed seat.
`scorePlay('')` matches no branch and returns 0, which is the server's answer,
and `isMetricSet('')` is false, so both boards now say NO METRIC · scores 0.
One line, no type surgery, and the two clients agree with each other and with
the resolver.

GUARDED FROM SOURCE, like the reaction whitelist: the assertion reads
matchup.ts and fails if `lookup` ever calls `pickMetric` again. The failure mode
is somebody helpfully restoring the default — it makes the board look finished,
and nothing else in the suite would notice. Comments are stripped first, because
the note explaining the removal names the thing it removed, and a check that
reads its own documentation as a violation is a check that gets deleted.

── ALSO: THE BOX SCORE (founder's ask) ────────────────────────────────────

"a small chip at the bottom of the field visual. when you click it, you get a
pop up with all the players in that game by team and their current stat lines."

▤ BOX SCORE under the field opens exactly that. EVERYONE with a stat in the
game, not just the rostered ones — which is why it cannot be built from the
matchup's picks, and why `realPbpSlugs` had to be added: every reader in
realPbp was keyed by a slug you already had, so nothing could answer "who was
in this game". Same live-week exclusivity as `realPbpFor`, or last year's
players would appear in tonight's box score.

It accumulates through the same `statlineFrom` the cards use and formats with
the same `fmtStat`, so the popup and the board cannot disagree about a number.
Ordered by involvement; players with no stat are dropped, because a live week's
play table holds everyone the poller has ever written a row for and a listing
padded with a hundred 0-0 lines is a roster, not a box score. It follows the
log's clock, so scrubbing scrubs both.

4 new parity assertions (705 total).


### v0.335.0 — the play draws on the side its text says it went

Founder: "If the play says right or left can we have the play draw on that side
of the field?"

ESPN's play text has said so all along — "pass short right to D.Laube", "pass
deep left", "rush up the middle", "left tackle" — and the field drew every play
down the centre line, so a checkdown to the right flat and a deep out to the
left were the same picture.

The SNAP stays on the centre line (the ball starts between the hashes whatever
happens next) and the far end moves to the named side, so the arc leans out and
comes down over there. Middle, and anything with no side named, is unchanged.

── THE TWO THINGS THAT NEEDED TESTS RATHER THAN CONFIDENCE ────────────────

1. THE WORD BOUNDARY. Play text is full of names that contain the direction
   words — Wright, Leftwich, Rightmire — and a play drawn on the wrong side
   looks exactly as plausible as one drawn on the right side, so it would never
   be noticed. `\b` handles it ("Wright" has no boundary before its "right"),
   and the assertions name the real cases. First match wins, because ESPN puts
   the direction in the action phrase and any later occurrence is a tackler.

2. THE SIGN. "Right" is the OFFENSE'S right, which is the bottom of the screen
   only while they are moving right — the same word points opposite ways for the
   two teams in the same game, and mirrors AGAIN when the viewer flips the
   field. That is why it is `playSideDy`, a tested function, and not an inline
   ternary. Rendered all five combinations and checked them one by one:
   HOU attacking ◀ puts "right" ABOVE the centre line, LV attacking ▶ puts the
   same word BELOW it, and "middle" sits on the line for both.

The native port needed `pathLen` widened to take the endpoints — it measures the
arc to drive a length-based draw animation, and a length computed against a flat
centred arc comes up short and leaves the stroke drawn part way. That is the
second time this file's animation has needed the measurement kept in step with
the path (v0.333.0 was the first), so the two now share every input.

18 new parity assertions (701 total). Both platforms.


### v0.334.0 — a backup's empty half was making a claim about the opponent

Founder, on a locked TNF window before kickoff: "hmm game hasn't started yet and
this is unopposed, but there's a whole full roster on my opponent's side."

NOTHING WAS WRONG WITH THE ROSTER, and nothing was wrong with the data. One
component draws BOTH of these — keyed on `canSub`, which is whether the player
can sub in — and they were sharing the same words:

  • AN UNOPPOSED STARTER. The opponent really did leave that spot empty.
    "— NO OPPONENT —" is true, and worth saying loudly: the player banks full
    value against nobody and pays UNOPPOSED_COIN.

  • A BACKUP. A bench player with no counterpart ANYWHERE, by construction —
    the game has no such pairing. It banks 0 unless it subs into one of YOUR
    starter spots at the final, which the line directly beneath already says.

Telling the second story with the first one's words makes a claim about the
opponent's roster that is not merely unhelpful but FALSE. The screenshot shows
the chip reading BACKUP and the empty half reading "— NO OPPONENT —" three
inches apart, which is the board contradicting itself.

A backup now says what it is — "— BACKUP · NOT MATCHED UP —" over a BENCH chip —
and the unopposed-starter copy is untouched, because there it is accurate and
carries real money.

── THE ASSERTION IS THE RULE, NOT THE WORDING ─────────────────────────────

`claimsOpponentAbsent()` is exported next to the copy so the test can say the
thing that matters — a BACKUP must never claim the opponent is absent; an
unopposed starter may, because they are — without freezing the words. Copy
changes; the rule should not.

MOBILE IS UNAFFECTED, checked rather than assumed: its Duel pairs slots by
index and has no backup row of its own, so this vocabulary exists only on web.

6 new parity assertions (683 total).


### v0.333.0 — a short pass is an arc, not a flagpole (and my last fix over-applied)

Founder, on the same field visual after v0.332.0: "Still this. Looks like we
have the line on the ground, and the arch above for the pass. It should just be
arch then the yards after the arch."

Two defects, and the second one was mine.

── 1. THE ARC HEIGHT NEVER CHANGED ────────────────────────────────────────

The flight arc's control point was a FIXED `TOP - 6` — the top of the field —
however far the ball actually travelled. A 50-yard bomb got a graceful arc; a
five-yard checkdown got the SAME apex squeezed into a fifth of the width, which
renders as a tall narrow spike floating above a short flat line. Two marks that
plainly belong to one play stop reading as one play, which is exactly what "the
line on the ground, and the arch above" describes.

`arcControlY` now scales the apex with the distance flown. The clamp's top end
IS the old fixed value, so long throws are pixel-identical — nothing that
already looked right moves. A quadratic peaks at HALF its control offset, which
is why the constants read twice as tall as the curve you see.

── 2. v0.332.0 PUT EVERY CARRY ON ITS OWN LANE ────────────────────────────

That fix was aimed at kick returns, where the runback genuinely retraces its own
flight path, and it dropped the carried phase to a lane four units below. But it
applied to EVERY carry — including a pass's run-after, which continues in the
same direction and meets the arc end to end. So a plain reception got its
continuous motion split into an arc plus a separate line below it: the exact
"line on the ground and an arch above" the founder was looking at, introduced by
the previous fix rather than left over from before it.

`overlaps` already knew the difference and was already asserted. Now it decides:
the lane is for a carry that doubles back over its own flight, and nothing else.

── RENDERED BEFORE AND AFTER, not reasoned about ──────────────────────────

Four fields drawn in headless Chromium at the real geometry. The short-pass
BEFORE panel reproduces the founder's screenshot exactly — spike, step, flat
line. AFTER is one gentle arc flowing into the carry. The long-pass panels are
indistinguishable, which is the check that mattered: the fix had to leave the
plays that already looked right alone.

The native port needed `pathLen` updated too — it measures the arc to drive a
length-based draw animation, and a length computed against the old fixed apex
would overrun a short arc and leave it drawn only part way.

8 new parity assertions (677 total), including that a long throw's height is
unchanged to within 0.01px.


### v0.332.0 — the double line on the field: a runback drawn over its own kick

Founder, on a punt in the field visual: "We've got a double line thing going
on."

THE FIELD DRAWS A PLAY IN TWO PHASES: the ball in the AIR (an arc from the
snap to where it came down) and the ball being CARRIED (a flat line from there
to where the play ended). Both were drawn at the same y.

For a PASS that is right — the run-after continues in the same direction, so
the two meet end to end and read as one continuous play. For a KICK it is
wrong, because the returner runs BACK the way the ball came. The runback then
retraced the flight path in the same colour, at the same width, at the same y.
Two strokes, one line.

MEASURED AGAINST THE REAL GEOMETRY rather than squinted at (W=400, EZ=26,
FX=EZ, FW=W-2*EZ — the FieldViews' own constants):

  pass + YAC        air 235-287   carry 183-235   meet end to end
  punt + return     air  71-270   carry  71-113   OVERLAP 41.8px
  kickoff + return  air  43-252   carry  43-130   OVERLAP 87.0px

THE OVERLAP IS NOT WRONG IN THE DATA. The ball really did fly out and get run
back over the same grass; a punt that travels 45 yards and comes back 12 covers
that 12 twice. What is wrong is drawing two phases of one play on one line and
leaving the reader to work out which is which.

So the carried phase gets its own lane, four units under the flight path, with
a short drop at the catch so the two still read as one play. The football moves
to whichever lane the play actually ENDED in, or it would float above the
runback. The native port needed the same fix AND a longer dash length — its
draw animation is length-driven, so without adding the drop the runback stopped
short mid-field.

── AND THE GEOMETRY MOVED TO ONE PLACE ────────────────────────────────────

Both FieldViews owned a copy of the split arithmetic, and the native file
carried a comment saying it was a port "at the SAME geometry" that must not
drift — which is a comment asking to be broken. It is now `engine/playPath`,
called by both, with `overlaps` as an explicit property rather than something
you notice in a screenshot. 13 assertions cover it, including the ones this bug
lives between: a pass MUST meet end to end, a returned punt and a returned
kickoff MUST overlap, and a fair catch (`ret: 0`) must not draw a zero-length
carry at all.

13 new parity assertions (669 total). Both platforms.


### v0.331.0 — the field is the game's, not the player's; and a missing metric says so

Two founder reports from one live preseason window.

── 1. "THE GAME FIELD VISUAL DOESN'T SHOW UNLESS THERE IS A PLAY WITH YOUR
      PLAYER?" ────────────────────────────────────────────────────────────

Exactly right, and `slot.real` was the gate:

    {open && slot.real && <SlotFieldViews … />}

`real` is `REAL_WEEKS.has(week) || !!realRawPlays(player, week)`. REAL_WEEKS is
the baked 2025 set (1-22), so on ANY other week — every live one, including the
preseason windows being played right now — it is true only once one of the two
players has recorded a play HIMSELF. The LV@HOU game could be under way with six
plays in the log and the field still hidden, because neither Bech nor Montgomery
had touched the ball.

The field is a picture of the GAME. Whether your man has carried it yet is not
the question it answers, and "nothing has happened to him yet" is precisely when
you want to watch.

NOTHING REPLACES THE GATE, because the real condition was already enforced one
level down: `FieldView`/`SlotFieldViews` return null when `gameFeedFor` has no
feed, and the worker only writes a feed once the game has plays (`gameToFeed`:
`if (!all.length) return null`). `slot.real` only ever subtracted.

── 2. "HOW DID MONTGOMERY GET NO METRIC?" → "looks like just an app issue" ──

Correct on both counts. The follow-up screenshot from the WEB board shows
"Rush Yards DRIP" on that very card, so the metric is in the data and the phone
— twelve versions behind — was the one not showing it.

The lasting fix is not the display of that one card but the fact that the board
was SILENT either way. A pick with no metric scores EXACTLY ZERO: `scorePlay` is
a chain of `if (metricId === '…')` ending in `return 0`, so a pick that matches
no branch banks nothing all window. The card rendered that as an ordinary 0.0.
Both boards now say NO METRIC · scores 0, in warn colour.

AND THE CASE `??` MISSES. The cards read `metric?.name ?? p.metric_id ?? null`.
`??` falls through on null and undefined ONLY — an EMPTY STRING sails past it,
arrives as '', and then fails the `!!metricName` render test. The chip vanishes
with no null anywhere in sight, which is the hardest version of this to find,
and the engine itself uses `metricId: ''` for the unopposed seat. `isMetricSet`
is now the one predicate the render, the audit and the test all share, and 0212
teaches yesterday's audit the same lesson — an audit that catches one shape and
not the other is worse than none, because it answers "no dead seats" and is
believed.

7 new parity assertions (656 total); the audit probe now fixtures both shapes.


### v0.330.0 — the dead-seat audit, as a button

Founder: "how did Montgomery get no metric?" → then, on the .sql file that
answered it: "can we run the sql by action?"

THE LITERAL ANSWER IS NO, and that is worth writing down. This session has no
live credentials — `.env.local` is gitignored and absent, and the probe runner
spins up a throwaway Postgres — so nothing here can query production, and it
should not be able to. What CAN happen is moving the query to where the data
already is, behind the same `is_admin()` gate SYSTEM HEALTH takes, so the answer
is a tap from a phone instead of a psql prompt.

WHAT IT LOOKS FOR. A `sealed_pick` with a player and no metric. `scorePlay`
(engine/sim.ts) is a chain of `if (metricId === '…')` ending in `return 0`, so a
null matches nothing and falls through: the pick scores EXACTLY ZERO for the
whole window whatever the player does. The seat is occupied and dead, and
nothing on the board says so — which is how the question got asked.

`metric_id` is nullable on purpose: 0024 (a locked-metric unlock disarmed), 0026
(coin refund) and 0062 (combodrip quantity change) all null it while KEEPING the
player, so the manager re-picks. Each is right alone; none makes sure the manager
returns before the window LOCKS.

THREE THINGS THE PANEL SAYS THAT A ROW COUNT WOULD NOT:
  • LOCKED vs not — the difference between a warning and a window the manager
    can no longer save.
  • `sibling_slots_with_metric` — whether that seat's OTHER slots carry metrics.
    If they do, it was set up properly and LOST one, which points at
    0024/0026/0062 rather than at somebody who never finished.
  • `agent_rows`, counted apart — autoLineup always assigns a metric
    (DEFAULT_AI_METRIC; RB → 'rush'), so an AI seat here means something nulled
    it AFTER the worker wrote it: a different bug, and it says so in red.

IT REPORTS, IT NEVER REPAIRS. Rewriting somebody's sealed lineup from an audit
is not a diagnostic; `admin_set_picks` (0021) is the deliberate version of that.
Asserted.

ON DEMAND, NOT ON A POLL, unlike the health panel beside it: this is a
full-table scan across every league, and running it every ten seconds to answer
a question nobody asked is how a diagnostic becomes a load problem.

── THE PROBE WAS WRONG BEFORE THE CODE WAS ────────────────────────────────

First run: "expected exactly 1 metricless pick, got 35". The audit was right —
every probe suite in the run shares one database and several leave metricless
picks behind. The assertions now scope to the fixture's own league, and
`agent_rows` is asserted as a DELTA rather than an absolute. Left as a comment
in the file, because the next person to write a cross-league probe will hit it.

8 probe cases; 58 suites. Classic windows are excluded throughout — classic has
no metrics, so a null there is correct and would drown the signal.


### v0.329.0 — quick reactions in chat

Founder: "can we have quick reactions in chat..Like thumbs up, agree, fire,
surprise etc."

Six of them — 👍 👎 🔥 😂 😮 💯 — on every message, both platforms. Migration
0210 models them on `poll_vote` (0148), which is the same shape one row down: a
per (message, user) row, RPC-only with no RLS policies, folded into the message
JSON by `_chat_message_json` so the message list AND the pins strip both get
them without a second query.

── A FIXED SET, NOT FREE EMOJI ────────────────────────────────────────────

Free-text emoji would mean an unbounded number of distinct values per message
(so the per-message aggregate stops being a small fixed row), a moderation
surface nobody asked for, and a strip that cannot lay itself out because it
does not know what is coming. A closed set renders as the same six chips every
time, which is the point of a QUICK reaction: you are choosing, not composing.

THE LIST IS DUPLICATED IN SQL AND THAT IS CHECKED. `_chat_reaction_ok` holds
the same six, and SQL cannot import TypeScript — so check-mentions READS THE
MIGRATION FILE and asserts the two lists are identical. A reaction the client
offers and the server rejects is a button that does nothing, and nothing
surfaces that until somebody taps it.

── THE KEY IS (message, user, EMOJI) ──────────────────────────────────────

Not (message, user), which is what `poll_vote` uses. A second poll choice must
REPLACE the first because the options compete; 👍 and 😂 on the same message do
not. Tapping the same one again removes it — that is what makes it a toggle
rather than a tally, and without it there is no way to undo a mis-tap.

── THE PROBE THAT EARNED ITS KEEP ─────────────────────────────────────────

`league_message.id` is a GLOBAL sequence. A toggle scoped only by id would let
a member of one league react to another league's message by naming a number —
and it would show up there, to people they have never shared a room with. The
RPC takes `p_league_id` and predicates on it; the probe drives it from a real
second league and asserts the refusal.

── ORDER IS THE CLIENT'S, NOT THE SERVER'S ────────────────────────────────

The aggregate orders by count, which is right for a summary and wrong for a row
of controls: a chip that moves between the moment you look at it and the moment
you tap it is a chip you tap wrong. `orderedReactions` folds the counts back
into the fixed list order. Emoji outside the list — rows from a future or past
version — are kept at the end rather than dropped, because a count that exists
belongs to whoever left it.

Counts are always visible (they ARE the content); the six-chip picker sits
behind a `+`, since six always-on chips under every message is furniture rather
than chat. Tapping repaints ONE message from the RPC's own return value rather
than reloading — a chat that refetches on every tap scrolls away from the
message you were reacting to.

8 new probe cases (57 suites) and 14 new parity assertions (649 total).


### v0.328.0 — RECEPTION becomes a field you can type in

Founder, looking at the SCORING panel: "Do we have just points for a
reception?" Then: "yep. Let's add reception."

WE DID AND WE DIDN'T. `ClassicScoring.ppr` has always been a real scoring value
— every catch pays it, in classic.ts:

    pts += sc.ppr + (pos === 'TE' ? sc.teRec : pos === 'RB' ? sc.rbRec : …)

— and it defaults to 1. But it was the ONE value in the catalog with no input
anywhere. 0157 gave it a dedicated `settings_json.ppr` home; v0.213.1 pulled the
RECEPTIONS pills off the game-mode tab on the grounds that PPR is a scoring
decision; and it came to rest reachable only through the SCORING page's four
PRESETS. A preset RESETS every other value, so you could not change PPR without
losing your tuning — and nothing between 0, ½ and 1 was reachable at all.

It now has a box in RECEIVING, sitting ABOVE the three CATCH BONUS fields,
because those are additive on top of it and that is much easier to read
correctly with the base directly above them. (The founder had just set TE CATCH
BONUS to 1 on a full-PPR league — which is 2 points per tight-end catch.)

── THE TRAP: ONE NUMBER, TWO HOMES ────────────────────────────────────────

`ppr` now lives in `settings_json.ppr` AND in `scoring_classic`. Two homes for
one number is how a setting starts lying: save 0.5 in one and every sentence
rendered from the other still says "full PPR" — and plenty are, on the invite
preview, the recruit card and the board's own explainer line.

So BOTH WRITERS WRITE BOTH. `set_league_classic_scoring` mirrors ppr out to
`settings_json.ppr`; `set_league_game_mode` (the presets) mirrors its ppr INTO
the catalog. Probed in both directions, plus "the two homes agree" as its own
assertion.

── THE BUG THAT WOULD HAVE MADE THIS A SILENT NO-OP ───────────────────────

`leagueCatalogOf` merged as `{ ...gm.scoring, ...(ppr) }` — settings_json LAST.
And `league_game_mode` COALESCES that value to 1, so it is never absent. A ppr
typed into the new field would have been saved, stored, and then overwritten by
the default on every single read. The field would have looked like it worked.

Precedence flipped: the catalog copy wins when present, since its existence
means a commissioner set it deliberately. Asserted, including a catalog ppr of
ZERO — a non-PPR league is a real league, and any truthiness-based merge would
silently make it full PPR.

── AND THE HELPER'S OWN COMMENT WAS FALSE ─────────────────────────────────

`leagueCatalogOf` says "every surface now installs THROUGH THIS, so the merge
happens in one place and cannot be half-remembered at the next call site." Six
call sites were doing their own spread — both LeagueInfo panels, both player
cards, both ClassicBoards — and two of them hardcoded `ppr: gm.ppr ?? 1`, which
priced players at full PPR in a half-PPR league. All six now go through it, and
the comment is true.

── THE CLAMP IS ITS OWN, deliberately ────────────────────────────────────

Not `event_keys` (one decimal — would round a 0.25-PPR league to 0.3). Not
`yard_keys` (caps at 1 — 1.5 PPR is a real setting). `ppr` gets [0, 5] at two
decimals. Both edge cases are probed.

10 new probe cases (56 suites) and 14 new parity assertions (635 total).


### v0.327.0 — chat: the keyboard stops covering it, @all works, and the dot is red

Three founder reports in one pass, all on the chat.

── 1. "WHEN YOU TYPE IN THE CHAT, YOUR KEYBOARD COVERS THE CHAT WINDOW" ────

Mobile web. `ModalBackdrop` already tracked `window.visualViewport` — but only
reacted to ZOOM:

    const zoomed = v.scale !== 1 || v.offsetTop !== 0 || v.offsetLeft !== 0;

An open keyboard on Android Chrome shrinks the VISUAL viewport and leaves the
LAYOUT one alone: scale stays 1, both offsets stay 0. So `zoomed` was false, the
backdrop fell back to `inset: 0`, and the card was laid out against a full-screen
height whose bottom third was under the keys. The composer lives at the bottom
of that card. So does the send button.

TWO HALVES, because either alone leaves it broken: the backdrop now also reacts
to a HEIGHT-ONLY shrink, and the card takes `maxHeight: 100%` — its `86vh` is
measured against the layout viewport, which the keyboard does not shrink, so
without the cap it stayed full-height inside a third-height backdrop.

THE THRESHOLD IS NOT A FUDGE. The visual viewport also shrinks by a few dozen
pixels when the URL bar slides in, and reacting to that would make every modal
jitter as the page scrolls. A keyboard costs 250-350px; 120 sits comfortably
above browser chrome and well below any keyboard.

Measured in headless Chromium, composer bottom against the visible area:

  iPhone + keyboard   BEFORE 599 vs 508  UNDER    →  AFTER 495 vs 508  visible
  Pixel  + keyboard   BEFORE 599 vs 535  UNDER    →  AFTER 522 vs 535  visible
  no keyboard         BEFORE 599 vs 844  visible  →  AFTER 571 vs 844  visible

The last row is the one that says the fix costs nothing when there is no
keyboard: the card is still its full 560.

── 2. "DOES @all WORK?" ───────────────────────────────────────────────────

No. Mentions were derived by matching each member's name against the body, so
`@all` matched nobody and the message posted as ordinary text — no mention rows,
no badges, no dot for anyone. The sender had every reason to believe they had
just told the league something. A mention that silently reaches nobody is worse
than not having the feature: the entire value of typing one is confidence it
landed.

It works now, on both platforms, and the rule moved to `core/data/mentions` so
the two apps cannot drift on which "@all"s are real.

THE WORD BOUNDARY IS THE PART WORTH TESTING. A league with a manager called
Allen — or Ally, or anyone whose name starts with those three letters — would
otherwise broadcast to everybody every time somebody addressed them. `@all`
means everybody, `@allen` means Allen, and the difference is one lookahead.
Asserted in both directions, along with the case that matters most: a false
POSITIVE. Pinging a whole league by accident is the failure people remember.

`@all` also rides the @-suggestion row now. A mention nobody can discover is a
feature only its author uses.

── 3. "A TINY RED DOT ON THE CHAT ICON WHEN THERE ARE UNREAD MESSAGES" ────

The dot existed. It was `var(--you)` — the accent teal — and only turned red
when the unread happened to MENTION you, which made "somebody wrote in the
league" the same colour as every lit chip and every live number on the screen.
A notification has to be the one thing on a page that is that colour.

Red for any unread now, on both platforms, matching v0.292.0's league card where
the founder asked for the same thing in the same words. The mention distinction
survives where it does not compete for attention: the accessible name.

22 new parity assertions (621 total) in a new `check:mentions`.


### v0.326.0 — "League Full": a commissioner can close the waiting room

Founder: "Can we have a commish option to close the waiting room. Just 'League
Full'."

WHERE THIS SITS. 0125 made a full native league WAITLIST a joiner rather than
turn them away — `native_join` writes `league_join`, returns
`{ok: true, status: 'waitlisted'}`, and the commissioner deals them in. That is
the right default for a league still filling up and the wrong one for a league
that is done: a queue nobody will ever work through is a room full of people
who think they might still get in.

Migration 0208 adds `league.waitlist_open` (default TRUE — closing is opt-in and
nothing changes for any existing league) and `set_league_waitlist`, guarded by
the same commissioner check every other league setting takes.

TWO THINGS THE FLAG DELIBERATELY DOES NOT DO, both easy to assume from the
words "close the waiting room", and both asserted:
  • IT DOES NOT CLOSE THE LEAGUE. With a seat free, an invite link seats the
    next arrival immediately whatever the flag says. It only bites when full.
  • IT DOES NOT EVICT. Anyone already queued stays in `league_join` and stays
    assignable; the RPC returns that count so the UI can say "the 3 already
    waiting are still here" instead of implying the list was cleared.

AND IT NEVER LOCKS OUT A SITTING MANAGER. `native_join`'s "already seated?"
check runs BEFORE the door, so a manager re-opening their own league is not
"trying to get in". There is a probe for exactly this, because getting it wrong
would lock a commissioner out of the league they just closed.

THE BACK DOOR IS SHUT TOO. `join_league` (0043) writes the SAME `league_join`
table without consulting seats — the native UI never routes there, but a closed
door that can be walked around by calling a different RPC is not closed. Guarded
NARROWLY: native leagues, flag off, and no free seat. Platform leagues are
untouched, because "no open seat" means something else for an ESPN/Yahoo pool
join and refusing there would break it. Probed both ways.

SAID BEFORE THE SIGN-UP, which is the whole point. 0208 also puts `seats_open`
and `waitlist_open` into `league_by_invite` — already signed-out-callable since
0206 — so someone holding an invite link is told "LEAGUE FULL" before making an
account. Finding out afterwards would be the same stringing-along, one screen
later.

`joinDoorFor` decides seat / waitlist / full in ONE place so the join screen,
the preview card and the test cannot drift. Two rules in it earn their keep:
  • SEATS BEAT THE FLAG — a commissioner who closed the room and then freed a
    seat has not barred the door.
  • UNKNOWN IS NOT FULL. A preview from a build older than 0208 carries neither
    field, and `Number(null)` is 0 — so the first cut read "didn't tell me" as
    "no seats left" and would have turned a joinable league away. Caught by the
    assertion, not by the browser: `seatsOpen: null` is checked before the
    coercion now.

The control sits on the SEATS tab on both platforms — where "is there room" is
already being answered — and renders even with nobody queued, because closing
the door is something you do BEFORE the queue forms.

9 new parity assertions (597 total) and a 9-case probe suite whose subjects are
mostly what must NOT change.


### v0.325.0 — a classic league stops being sold as a drip league, and a full league says so

── 1. "IF THE LEAGUE BEING ADVERTISED IS A CLASSIC LEAGUE, WE NEED A DIFFERENT
      TAGLINE" ────────────────────────────────────────────────────────────

Founder, looking at a chat unfurl of an invite link. The card read "Head-to-head
fantasy football of hidden picks and live effects. Seal a secret metric behind
every player…" — which describes DRIP mode. A classic league has no hidden
picks and no effects, so that is not a tone problem: it describes a game the
recruit is not about to play.

WHAT CANNOT BE DONE, checked rather than assumed. dripfantasy.com is GitHub
Pages (.github/workflows/deploy.yml) — a pure static host that returns the same
index.html for every query string — and a link unfurler reads meta tags without
running JavaScript. So `?code=A1B2C3D4` CANNOT carry its own og:description.
Per-league unfurls need a server in front of the site: a decision about
hosting, not something code can route around. Left for the founder to call.

WHAT WAS DONE INSTEAD, in two halves:
  • THE STATIC COPY IS NOW TRUE OF BOTH MODES. index.html led with the drip
    pitch everywhere — title, description, og:description, twitter:description,
    both image alts and the JSON-LD. It now leads with what every league here
    is ("Head-to-head fantasy football, scored live over real NFL
    play-by-play") and names classic and drip as the two ways to play.
  • THE APP’S OWN JOIN SCREEN DOES vary per league, because it runs JavaScript
    and holds the code. Migration 0207 adds `game_mode` to `league_by_invite`
    (0206 having made it callable signed-out), and the "YOU’RE JOINING" card
    now badges CLASSIC or DRIP and carries the matching one-liner.

AN UNKNOWN MODE GETS THE NEUTRAL LINE, never a guess: a league on some future
mode this build has not heard of is described in terms true of all of them.
Unset reads as 'drip', matching `league_game_mode`, the resolver and the board —
a different default here would make the join card disagree with the game.

── 2. "WHEN THE LEAGUE IS FULL, WHAT HAPPENS TO PEOPLE TRYING TO GET IN?" ──

Asked as a question; the answer turned out to contain a bug.

WHAT IS SUPPOSED TO HAPPEN, and does at the database: `native_join` (0125,
superseding 0064's flat rejection) puts a joiner in `league_join` — the waiting
room — and returns `{ok: true, status: 'waitlisted'}`. 'waitlisted' is a
SUCCESS: the join happened, it just came without a seat. The commissioner sees
them via `admin_league_joiners` and deals them in, as an owner when a seat opens
or as a co-manager on an existing team.

WHAT ACTUALLY HAPPENED ON THE INVITE-LINK PATH. Because waitlisting is `ok:
true`, the `!r.ok` guard never fired:
  • WEB cleared the stashed code and called `onJoined()` — dropping the recruit
    on a leagues list with nothing in it and no explanation whatsoever;
  • MOBILE was worse: it announced "you joined <league>", which is a straight
    lie — no team, no lineup, nothing on the list.

The BOARD join in both apps has handled this correctly since 0125 ("the waiting
room for X — the commissioner deals you in from there"). The INVITE-LINK join —
the path every recruit actually arrives on — never did. Both now say it, web
with its own screen (rendered instead of the code form, because re-offering the
box would read as "that didn't work, try again", the opposite of true).

SLEEPER LEAGUES DO NOT HAVE THIS SHAPE: `redeem_invite` matches your Sleeper
account to a roster that already exists, so there is no "full" — either your
username is a manager in that league or it is not, and it says so.

12 new parity assertions (588 total) in a new `check:tagline`.


### v0.324.0 — the way in: which league you’re joining, and a crest that isn’t a hole

Two founder reports, both about the same journey — a stranger arriving with a
link and trying to become a manager.

── 1. "IF YOU GO IN WITH A CODE, IT SHOULD SHOW YOU THE LEAGUE YOU ARE JOINING
      BEFORE THE SIGN UP ACTION" ──────────────────────────────────────────

The lookup already existed, and its own comment already said this was the job.
Migration 0002: "Look up a league by code so the client can show \"You’re
joining <name>\" before the user commits."

It was granted to `authenticated` ONLY. And the moment the preview is wanted is
the moment before there is an authenticated anybody. So for four years the join
screen could say nothing but "Join your league." in the abstract, to someone who
had just been handed a link by a friend and had no way to tell which league it
was for — or whether the code was still live — until after making an account.

Migration 0206 grants it to `anon` and adds `avatar_url` so the card has a
crest. What that exposes, stated rather than waved at: the league’s name,
season, provider and avatar, to a caller who ALREADY HOLDS the invite code —
which is the same credential `redeem_invite` accepts as proof of invitation, so
showing it one screen earlier grants nothing the code did not already grant. On
enumeration: 8 hex characters is 4.3 billion values, a hit returns a league
NAME, and the same surface is reachable by anyone willing to make a free
account. Judged worth it; the reasoning is in the migration so the next person
can disagree with it on the evidence.

FOUR STATES, because three of them collapse into a lie if you merge them:
asking, found, a code that matched nothing, and a lookup that FAILED. The last
two are kept apart deliberately — telling someone their invite is dead because
the network hiccuped turns a retry into a giving-up. `error` says nothing extra.

Only the PLAYER code is previewed: `league_by_invite` matches `invite_code`,
and a commissioner’s claim code lives in a different column, so previewing one
with the other would report every commish link as an unknown league.

── 2. "THE LEAGUE AVATARS ARE BLANK FOR NATIVE LEAGUES" ───────────────────

The leagues card drew `avatar_url ? <img> : <empty bordered square>`. A Sleeper
league arrives with avatars already made and mirrored by the import; a NATIVE
league has no upstream to mirror and nothing in the app ever writes that column
— so every native seat drew the empty box, on every team, forever. Not a missing
image, a missing SOURCE, which no amount of retrying fixes.

The board already knew what to do: `TeamHead` has drawn a lettered box since
v0.228.0. `crestFor` is that rule extracted so both platforms and the test share
ONE definition — team avatar → league avatar → letter. The middle rung is what
rescues a native league whose commissioner set a league image, and rung three
always answers, so a card can always draw something.

`crestInitial` takes the first LETTER OR DIGIT, not `charAt(0)`: team names are
user-typed, and "⚡ Bolts" or "’96 Packers" would otherwise hand back a glyph
that says nothing about which team it is.

MOBILE WAS ALREADY RIGHT and was checked rather than assumed — its leagues list
has drawn a lettered crest all along. Its two local copies now borrow
`crestInitial` so the emoji case is handled the same way in both places.

The web `Crest` also handles `onError`: a mirrored avatar whose upstream has
since 404’d is indistinguishable from a good one until the browser tries it,
and a broken-image icon is worse than the letter it replaced.

19 new parity assertions (576 total) plus a new SQL probe suite whose real
subject is the GRANT — invisible in application code, silent when wrong.


### v0.323.2 — the invite link went to the demo board. Every one of them.

Founder: "I want to get people into a classic league. It looks like following
this link just goes to the demo board."

He is right, and it was total: EVERY invite link built since v0.291.0 landed on
the marketing route. Not a bad league, not a stale code — the link never
reached the join flow at all.

THE CAUSE WAS A COMMENT. invite.ts opened with, in capitals, "THE LINK ALREADY
WORKED; NOTHING BUILT ONE. `?code=XXXX` has been a complete path for a long
time — App.tsx reads it off the landing URL, stashes it as `dripInviteCode`…"

App.tsx does no such thing. It reads the invite code inside
`if (p.get('live') === '1')` and nowhere else. A bare `?code=` matched the auth
branch (no), the Yahoo branch (no), the live branch (no) — and fell out of the
effect entirely. Nothing stashed, nothing navigated, default route, demo board.

This is v0.320.0's lesson wearing a different hat: a comment described a
NEIGHBOURING module's behaviour, the neighbour disagreed, and nobody asked it.
Both times the check was seconds of reading. Ask the neighbour.

FIXED AT BOTH ENDS, deliberately:
  • `inviteLink` now emits `?live=1&code=…` — the form App.tsx has always
    understood, and the form LiveOnboard's commissioner link already used (it
    built its own by hand, which is why THAT link worked and this one didn't);
  • App.tsx now also accepts a BARE `?code=`, because the links already sent are
    out of our hands and would otherwise stay broken forever.

THE SHAPE TEST IS LOAD-BEARING, not tidiness. `?code=` is also how Supabase's
PKCE flow returns an auth code, so "any ?code= is an invite" would stash a
secret in localStorage and skip the exchange. `gen_invite_code()` (migration
0002) makes exactly eight hex characters, and a PKCE token never can be — so
`readInviteParams` matches `/^[0-9a-f]{8}$/i` and refuses outright whenever a
`state` param is present. Both are asserted.

AND `live=1` STILL MEANS "TRUST ME". With the flag present the params are taken
at face value as before, so a legacy or hand-made code is stashed and fails at
the redeem form WITH A MESSAGE rather than vanishing. The shape test guards the
INFERENCE path only.

── THE SECOND BUG, VISIBLE IN THE SAME SCREENSHOT ─────────────────────────
The Recruit panel rendered `\u21ea SEND THE INVITE` and "managers you
don\u2019t know" — the escapes printed verbatim. JSX TEXT AND JSX ATTRIBUTES DO
NOT PROCESS BACKSLASH ESCAPES; only JS string literals do. The same file gets
`'\u2713 COPIED'` right two lines above, because that one is inside quotes
inside braces. Five sites across both platforms, all in the Recruit panels, all
from the same paste. Swept for and fixed; the sweep now returns nothing.

32 new parity assertions (557 total), in a new `check:invite`.


### v0.323.1 — room for player names on a phone: 35px → 100px

Founder, on mobile web with a screenshot: "let's make more room for player
names." The board was rendering "C. Br…", "K. C…", "D. St…", "T. W…", "D. S…",
"L. M…" down the entire HOME column while the AWAY column showed "J. Williams",
"T. Kelce", "S. Barkley", "J. Jefferson" in full.

THE ASYMMETRY IS THE CLUE, and it named the culprit before any measuring. Both
columns are `minmax(0, 1fr)` in the same grid, so they are the same width — the
home cell just spends more of it. It carries the ⇄ swap button; the away cell
does not.

MEASURED AT 393px (an iPhone in Safari), the home name box was **35px**:

  393 − 24 page padding − 28 row padding      = 341
  341 − 104 centre column − 2×10 column gap   = 217, so 108 a side
  108 − 32 face − 8 gap                       = 68   ← what AWAY gets
  68 − ~26 swap − 8 gap                       = 35   ← what HOME gets

Four changes, each measured in headless Chromium at 360/393/430/768/1440:

  • the centre column 104 → 72 on phones. Nothing is lost: the spot label has
    always had `maxWidth` with no `nowrap`, so it simply wraps.
  • the face 32 → 26, the gaps 10 → 6, the row padding 14 → 10.
  • THE ⇄ MOVES DOWN ONE LINE, onto the position line inside the cell. It is
    still its own small control — the row is deliberately not one big button —
    but "RB · CIN" is short and had the room going spare, so the swap now costs
    the name nothing and the row no height.
  • the duplicated eligibility line goes. The stock flex is labelled "FLEX
    (RB/WR/TE)" and the line beneath it read "RB/WR/TE" — the same fact, one
    line lower. A league's own label ("Rookie BB") still gets its line, because
    that one genuinely does not say what it takes.

  @ 360   BEFORE home= 19 CLIP  away= 51 CLIP   →  AFTER home= 83  away= 83
  @ 393   BEFORE home= 35 CLIP  away= 68 CLIP   →  AFTER home=100  away=100
  @ 430   BEFORE home= 54 CLIP  away= 86        →  AFTER home=118  away=118
  @ 768   BEFORE home=211       away=243        →  AFTER home=243  away=243
  @1440   BEFORE home=211       away=243        →  AFTER home=243  away=243

Nearly 3× on the side that was unreadable, the two columns finally equal, and
NO CLIPPING at any width including 360 — the smallest common phone, where both
sides were truncating before. Row height is unchanged (57px), so none of it is
paid for in scroll.

ONE FLAG DRIVES ALL FOUR DIMENSIONS (`useIsMobile(480)`, the hook the app
already had) so the board cannot end up half-narrow, and the centre column stays
the same width in the header, the starters and the bench — which is the whole
reason v0.303.2 made it fixed.

THE NATIVE APP IS UNTOUCHED, checked rather than assumed. Its board is a
different layout — one flex row per pair with fixed 26/38/66px columns, both
sides through the same tracks — so it has neither the asymmetry nor the
104px centre. Changing it would risk the alignment v0.303.2 was asked for.


### v0.323.0 — the slate is the NFL's, not the matchup's: every game, with its score

Founder: "lets expand the shown game slate to include all nfl games, not just
the one's in the matchup."

THE GAMES WERE NEVER MISSING, which is worth saying because the obvious fix
would have been to go looking for a filter that does not exist. `slateChips`
has returned every row of `nfl_slate` since v0.312.0, in kickoff order, and its
own header says so. What made a sixteen-game slate READ as matchup-only is that
a game nobody was in arrived empty:

  • the whole chip rendered at 45% opacity;
  • it carried no numbers, only teams and a kickoff time;
  • clicking it said "nobody from this matchup is in this game" — true, and
    nothing at all about the game you just clicked;
  • and the sheet was captioned with `lineupChipSummary`, which counts only the
    games THIS SIDE has a starter in. So sixteen chips sat under the heading
    "NFL SLATE · 8 GAMES" — a caption contradicting the thing it captions, and
    the most likely thing "not just the one's in the matchup" was reading.

THE SCORE WAS ALREADY IN MEMORY. Both boards load `weekGameFeeds(week)` for the
whole week, and the worker polls EVERY live game — `gamesToPollFrom` filters on
game state, not on whether anyone rostered a player in it — so `game_feed` has
a row for every game that has kicked off. `GamePlay` carries `hs`/`as`, the
score after that play. So the week's scoreboard was sitting there unread, and
`slateScores(feeds)` is the whole of the new data path: no fetch, no migration,
no worker change.

THE LAST PLAY, NOT THE HIGHEST SCORE. `max(hs)` would be robust to unordered
plays and wrong for the case that matters: ESPN revises plays mid-game, and a
touchdown overturned on review LOWERS the score, so max() would pin the board
to a number the broadcast has taken back. Instead: the play with the greatest
game-elapsed clock, ties broken by array order (the later entry is the revised
copy). Order-robust and revision-correct at once, and both halves are asserted.

WHAT CHANGED ON SCREEN. Every chip is now first-class — full strength, with its
own score when it has one and its kickoff when it does not. The distinction is
carried by the TEAM NAMES (dim when you have nobody in it) rather than by
fading the whole chip, so a score you have no stake in is still readable. Your
stake stays as an addition to a game that stands on its own. The detail panel
leads with the game — teams, score, state — before saying anything about the
matchup. And the sheet is captioned by `slateSummary`, which counts everything,
with "N with a starter from this matchup" as the second line.

A NULL SCORE IS NOT 0-0. A game with no feed reports null and renders its
kickoff; 0-0 is a real score a real game can have, and conflating the two would
put a fake scoreline on every game that has not started.

20 new parity assertions (525 total). Both platforms.


### v0.322.2 — the swap: the head to head is the board, the slate is the card

Founder: "We are missing communication here. I still want the head to head line
up on the matchup board, but the nfl game slate is what pops up if clicked on
the center chip."

v0.321.0 read the request backwards. It put the LINEUP behind the centre chip
and left the NFL slate on the board permanently. This reverses that: the head
to head lineup — starters, bench, taxi/IR, both sides — is back as the board's
permanent content, and the chip now opens the SLATE.

WHY THE FIRST VERSION WAS WRONG, since the reasoning was not stupid. The lineup
IS long: twelve spots with two game cards each, plus both benches, is most of a
phone, and hiding the long thing does buy screen. But the screen is called the
matchup board and the head to head is the thing it is FOR. The slate is the
reference material you go and look up, and it is the shorter of the two, so the
swap costs almost nothing and the chip still opens onto something worth a card.

NOTHING IN THE ENGINE CHANGED, which is the tell that the chip was already
right. `lineupChipSummary` was always counting GAMES — "8 GAMES", "3 LIVE",
"9 starters to play", next kickoff — because it summarises the games this
side's lineup is in. That is exactly the label a control that opens the slate
wants. Only the chip's heading (LINEUP → NFL SLATE), its destination and its
accessible name moved.

The rehearsal notice is NOT repeated inside the sheet, unlike the lineup card
it replaces: that warning is about whose ROSTER you are looking at, and the
slate is the same twelve games whoever holds whom.

MEASURED, because this is the second layout in two versions to put that
scrollable chip row inside a new container, and v0.322.1 was exactly that bug.
A 16-game slate (1498px of chips) inside the new sheet, in headless Chromium:

  @390:  doc=390  col=358  cardRight=374   scrolls=true
  @768:  doc=768  col=720  cardRight=744   scrolls=true
  @1440: doc=1440 col=720  cardRight=1080  scrolls=true

Both platforms. Mobile keeps `Overlay` rather than a hand-rolled Modal, so the
sheet dismisses the way every other card on that screen does.


### v0.322.1 — the board wasn't hiding the matchup, it was pushing it off the screen

Founder, on web, with a screenshot: "Looks like we hid the matchup instead of
the nfl games slate. It also stretches beyond the screen."

Both sentences are the same bug, and it is not a design question — the away
team head was never hidden, it was rendered past the right edge of the window.

WHAT WAS ACTUALLY WRONG. The board's page container is `display: grid` with no
`gridTemplateColumns`. That gives an implicit `auto` track, which sizes to its
widest item's MIN-CONTENT width — and `maxWidth: 720` caps the container's BOX,
not the track inside it. The slate strip's chips are `flex: 0 0 auto`, so an
11-game slate has a min-content width of 1028px; `overflowX: 'auto'` on that row
makes it SCROLLABLE but does not shrink it, and a plain `overflow` on a block
child does not zero its contribution to an ancestor's intrinsic width.

So the card rendered 1062px wide inside a 744px page. The slate ran off the
screen, the scoreboard's two `1fr` tracks stretched with it, and the away team
head landed at x≈1065 on a 390px viewport. Nothing was conditionally hidden.

MEASURED, NOT REASONED ABOUT. The structure was reproduced in headless Chromium
and measured before and after, at 390 / 768 / 1440 / 2560:

  BEFORE @390:  doc=1082  card=1062  awayHeadRight=1065  slateScrolls=false
  AFTER  @390:  doc=390   card=350   awayHeadRight=353   slateScrolls=true
  AFTER  @768:  doc=768   card=720   awayHeadRight=727   slateScrolls=true

Note what the 1440 and 2560 rows say: BEFORE "fits" on a wide monitor while
still being a 1062px card in a 720px layout. The bug was never absent there,
only invisible — which is why it survived until someone opened it narrow.

THE FIX. `minmax(0, 1fr)` on every `fr` track from the page container down. The
lower bound is the entire point: a bare `1fr` means `minmax(auto, 1fr)`, and
that `auto` is min-content — exactly the floor that did the stretching. The
slate strip and the lineup overlay's inner column also get `minWidth: 0`.

MOBILE IS UNAFFECTED and was checked rather than assumed: its slate is a
horizontal `ScrollView`, which clips by construction, and React Native has no
CSS grid to blow out.

Not covered by `check:parity`, which is Node-only and cannot lay out a box. The
measurements above are recorded in the code comment at `SlateStrip` so the next
person meets the numbers where the mistake lives.


2026-08-20 — **"PRESEASON REHEARSAL" — THE BOARD NOW SAYS WHEN IT ISN'T YOUR ROSTER** (`v0.322.0`, no migration, core + web + mobile + parity): re-running `roster-drop-diag.sql` after `v0.320.0` **confirmed the week fix took, and named what is left**. Week 1 now writes on the cadence — `last_written` 19 minutes ago, against 2 days before — and Carson Beck's drop reads `rosters_holding = 0` on weeks 1 and 2 (the two the worker has touched since the drop) and `1` on weeks 3-14, which are Aug-18 snapshots taken before it. The sync is correct end to end. **WHAT REMAINS IS PRESENTATION, AND IT IS THE WHOLE ORIGINAL COMPLAINT.** Section 2 still reports MISMATCH — worker writes week 1, board opens week **103** — and that is now working as SPECIFIED: the founder wants 101-104 to hold every player for the rehearsal. But a whole-pool week is **indistinguishable from a broken roster** if you are the manager looking at it, and that is precisely how it was read: Beck is on all twelve rosters there, along with everybody else. The board never said so. It does now, above the scoreboard and again inside the lineup overlay (which covers the board behind it, so the notice has to exist in both): "PRESEASON REHEARSAL — every player in the league is available on this board, so adds and drops will not show here. Your real roster is on Week 1." **DETECTED FROM THE POOL, NOT THE WEEK NUMBER** (`isRehearsalPool`, `WHOLE_POOL_MIN = 200`): `week > 100` would be an inference about how preseason weeks happen to be seeded today, while the SIZE of the thing in front of the manager is the fact itself and stays true if a whole-pool week is ever minted elsewhere. The threshold is shared with `roster-drop-diag.sql`'s so the screen and the diagnostic can never disagree about what they are looking at. **This resolves itself around 1 September**, when 104's games are over and `defaultOpenWeek` falls through to week 1 — so the notice is for the ten days in between, which are exactly the ten days before launch when a manager wrongly concluding "this app lost my roster" is most expensive. 4 new parity assertions. 508 parity assertions green, full battery green + APK 32200.

2026-08-20 — **THE LINEUP IS A CARD OVER THE BOARD, OPENED BY A CHIP THAT SAYS WHAT'S ON** (`v0.321.0`, no migration, core + web + mobile + parity): founder — "let's make the lineup be a pop up when you click on a chip in the middle of the top panel (currently blank space). We can make the lineup chip informative about games and games in progress." **THE SPACE:** the scoreboard is a `1fr | SPOT_COL | 1fr` grid and the middle column belongs to NEITHER side — which is why it was empty before lock and why it is the right home for the one thing that is about the whole matchup. **THE CHIP EARNS IT TWICE**, as the way in AND as a report: `⏵ 2 LIVE / 3 playing · 4 to come` while games are on, `ALL FINAL / 9 starters played` when they are over, `5 GAMES / 7 starters to play` with the next kickoff before anything starts. **It counts only games THIS SIDE has a starter in, which is deliberately the opposite of `slateChips`' rule** — the strip below is "the week" and lists every game because omitting one would misrepresent the slate; the chip is "your afternoon", and a manager reading "3 LIVE" needs that to mean three of THEIRS. The two disagree on purpose and neither is wrong. **IT ABSORBS THE OLD BARE `LIVE`**: "⏵ 2 LIVE" says the same thing about the game's state and then says how many, which one word never could. **WHY THE LINEUP MOVES:** the board's standing content is now the scoreboard and the slate — how the matchup is going, and what is on. The lineup answers "who have I got", a question with a moment rather than a permanent one, and twelve spots with two game cards each plus both benches was most of a phone. Web uses the picker/field-card overlay pattern (backdrop, stopPropagation, ✕, and Escape now closes it too); mobile uses the shared `Overlay` rather than a hand-rolled Modal, so stacked Modals — flaky on Android per the existing note — stay something this screen does exactly once. **The `!board` fallback editor stays INLINE on purpose:** if the board cannot assemble, the lineup editor is the whole screen's value, and hiding it behind a chip that summarises games it could not compute would be exactly backwards. **NO DATE FORMATTING IN CORE** — `nextKickoff` comes back as raw ISO and each host renders it with the `fmtKick` it already has, rather than the engine growing a second notion of what "Sun 1:00 PM" means. 15 new parity assertions; one caught `3 GAMEs`, the default pluraliser appending a lowercase 's' to an upper-case label. 504 parity assertions green, full battery green + APK 32100.

2026-08-20 — **A PRESEASON WEEK NUMBER WAS BEING READ AS A REGULAR-SEASON ONE** (`v0.320.0`, no migration, core + worker + parity): founder — "we want the 101,102,103,104 weeks to have all players week 1 on should have actual rosters synced from sleeper." The preseason half is already correct and untouched. The other half was **not true and would not have been true on 9 September**: week 1 was frozen at 18 August and nothing was refreshing it. **THE BUG.** `syncWeek` mirrors exactly ONE week, chosen by `regularWeek()` — Sleeper's `/state/nfl` week, else ESPN's. Sleeper's live state right now is `{"week": 2, "season_type": "pre"}`: that 2 is **PRESEASON week 2**, and the rule read `state.week` without ever consulting `season_type`, so a preseason week number was mirrored as a regular-season week. On 20 August the worker was writing regular-season week 2; as the preseason ran on it would have written 3 then 4, all weeks nobody can open, while WEEK 1 rotted until Sleeper flipped around 8 September. Every drop, add and waiver claim in that window — including the Carson Beck report — would have been invisible on the week-1 board. **ESPN IS ALSO WRONG HERE, INDEPENDENTLY**, and rule 2 neutralises it: `scoreboard?seasontype=2` with NO `week` parameter returns `week.number` 3 (it was 2 the day before) over a 100-event bag spanning 2026-01-03 to 2026-09-20 — last season's January playoffs, August preseason games and September regular-season games together. With an explicit `week=1` the same endpoint is clean: 16 events, 10–15 September. **THE NEW RULE** (`regularWeekFrom`, core, pure and tested): Sleeper's week only when its `season_type` is `regular` or `post`; else, if regular-season week 1 has not kicked off, the answer is **1**; else ESPN's number clamped to 1–18, because an out-of-range week silently mirrors nothing. **HOW THE SHARPER HALF WAS FOUND, WHICH IS THE LESSON:** the fix was first written around a comment in the worker asserting "Sleeper's /state/nfl week sits at 0 all August". Booting the worker disproved it in one line — `regular week: 2 (sleeper /state/nfl)` — and asking the feed itself took ten seconds. The comment describing an upstream was stale; the upstream was one curl away. Verified by re-booting: the worker now logs `regular week: 1`. 20 new parity assertions using the real payloads from both feeds, including that every preseason week still mirrors week 1, that a MISSING `season_type` is untrusted rather than assumed regular, and that the postseason keeps Sleeper authoritative. 489 parity assertions green, full battery green.

2026-08-20 — **THE BOARD IS READING A WEEK NOTHING SYNCS** (`v0.319.4`, no migration, diagnostic only): `roster-drop-diag.sql` answered the Carson Beck report outright — `worker_last_wrote_week = 2`, `board_opens_week = 103`, **MISMATCH**. `syncWeek` writes exactly one week, ESPN's current REGULAR-season week, while `defaultOpenWeek` orders by real kickoff and preseason 101+ sorts ahead — so with preseason week 3 next on the calendar, every Turf Warriors manager opens **week 103, whose `sleeper_lineup` rows have `last_written = NULL`**: never written by the current sync at all. Worse, 102/103/104 carry **1,024 entries per roster** — the whole player pool, not a roster — so on that board EVERY player is on EVERY roster and no drop by anyone can ever show. Carson Beck is not stuck; the roster being displayed is not a roster. The 14 real-roster weeks (240 entries, 20 per roster) are all correct, and week 2 refreshed 7 minutes before the query. **THE SYNC IS FINE. THE READ IS POINTED SOMEWHERE ELSE.** This is a deliberate old decision meeting a case it did not anticipate: syncTick's docblock says "always the REGULAR-season week" because Sleeper has no preseason PAIRINGS to mirror — but rosters are week-independent, so the roster half could be written to the played week even though the matchup half cannot. **AND A BUG IN THE DIAGNOSTIC ITSELF, FOUND BY ITS OWN OUTPUT:** section 4 asked "which weeks does he NOT appear in" as a `not exists` over ROWS, i.e. "is there a lineup row without him" — true in every week with more than one roster, since he can only be on one. It therefore listed nearly every week regardless of the answer AND stayed silent exactly on the whole-pool weeks where all twelve rosters do hold him, which is the opposite of useful. Now asked per (week, roster) and aggregated: `rosters_holding` of 0 means the drop reached that week, 1 means still held, 12 means a whole-pool seed that says nothing. Section 3's output also appeared truncated in the paste — no row count, columns sized wider than their headers — so nothing was concluded from it. Verified end to end against the scratch DB. No behaviour change; the fix to the sync is a live decision and is the founder's call.

2026-08-20 — **A DIAGNOSTIC FOR A DROP THAT DIDN'T TAKE** (`v0.319.3`, no migration, diagnostic only): founder — "Senz0Tanaka in Turf Warriors dropped Carson Beck yesterday but he's still on the roster." The interesting part is that **the sync is demonstrably alive** — Turf Warriors had written 18 minutes earlier — so the obvious cause is already ruled out and the remaining ones are all structural. New `scripts/db/roster-drop-diag.sql` tests them in order. **THE LEADING HYPOTHESIS, WHICH THE FILE EXISTS TO CONFIRM OR KILL:** `syncWeek` writes exactly ONE week — whatever `regularWeek()` returns, i.e. ESPN's current REGULAR-season week — while `defaultOpenWeek` (liveApi.ts) opens the first week not yet fully over ordered by real kickoff, and **preseason weeks (0110's 101+) sort AHEAD of the regular season**. A league playing preseason therefore has the worker refreshing week N while every manager reads week 10x, whose `sleeper_lineup` rows are frozen at whenever they were last written. A drop can never appear, the sync log stays green, and nothing reports a problem. Section 2 puts those two weeks side by side and calls the mismatch by name; the SQL mirrors `defaultOpenWeek` exactly (kickoff order, the +4h "fully over" grace, the 101+ ordering) rather than approximating it. **THE OTHER SHAPE IT SURFACES:** section 1 prints entries-per-roster, because Turf Warriors' 10x weeks carry ~1,024 per roster — that is the whole player pool, not a roster, and on such a week EVERY player is on EVERY roster so nothing can look dropped. Sections 3/4 then show which weeks hold the player and which do not, which distinguishes "the drop never landed" from "the drop landed somewhere nobody is looking", and section 5 checks the league is in `PILOT_LEAGUE_IDS` at all — `syncAllLeagues` only walks that env var, so a Sleeper league missing from it is imported once and never refreshed again, which looks identical from the board. **A trap fixed during syntax-checking:** the verdict compared with `is distinct from`, so two NULLs — a misspelled league name — reported "aligned", i.e. a clean bill of health for a league that was never looked at. NULL on either side now says so explicitly. Verified end to end against the scratch DB. No behaviour change.

2026-08-20 — **THE HEARTBEAT PANEL WAS ANSWERING A DIFFERENT QUESTION** (`v0.319.2`, no migration, diagnostic only): running `worker-alive.sql` for real (founder: "when was the last roster update?") showed section 0 was **structurally unable to answer it**. Two defects, both only visible against production shape. **ONE: `group by (league, week) limit 12` let a single league eat the whole answer.** Dytesty mirrors fourteen weeks at one timestamp, so eleven of the twelve rows were Dytesty and the twelfth was Turf Warriors — **Gridiron Gang did not appear at all**, which reads as "that league never syncs" when it may simply have sorted below the cut. Now ONE ROW PER LEAGUE with no limit, carrying the freshest week and how many weeks are mirrored. **TWO: native leagues were listed in a panel where they can only ever look dead.** A native league has no Sleeper upstream — `syncAllLeagues` only walks `PILOT_LEAGUE_IDS`, and 0204's RPC refuses native leagues outright — so its `sleeper_lineup` rows come from native roster ops and it is ALWAYS hours stale here. Dytesty at 27 hours looked like the alarming row and was in fact the correct one. The panel now labels each league `sleeper (mirrored)` or `native (no upstream — staleness expected)`, so the reader is not required to hold that. **New 0b asks the group-key question of the FRESHEST row per league**, because section 2 orders by week and the 10x preseason test weeks (12k entries apiece — the whole player pool, not a roster) crowd out the week actually being synced; `rows_with_grp = 0` there is a statement about August test data, not about the running code, which writes `grp` unconditionally (sync.js:186, re-read rather than assumed). **AND THE ACTUAL ANSWER, which is good news:** Turf Warriors last synced 13:45:53Z = **09:45 ET, 18 minutes before the query**, inside the 04:00–10:00 ET waiver window whose rung is 20 minutes, with the query landing at 10:03 ET just after the window closed and the hourly rung took over. That is exactly the shape v0.319.0 specifies, and it is consistent with the new cadence having deployed and be running. No behaviour change; parity + probes green.

2026-08-20 — **THE HEARTBEAT DOC CAUGHT UP WITH THE HEARTBEAT** (`v0.319.1`, no migration, diagnostic only): founder asked "when was the last roster update?" — and the file that answers it, `scripts/db/worker-alive.sql`, still told the reader to expect a sync "on boot and every 6h", which `v0.319.0` had made false an hour earlier. That is the worst place for stale doc rot: it is read WHILE DEBUGGING, so a wrong expectation there turns a healthy 40-minute-old sync into a false alarm on a Wednesday, and a genuinely dead worker into a shrug ten minutes before a Sunday kickoff. Section 0 now carries the whole cadence table and the judgement it implies — 40m old at 3pm Wednesday is fine, 40m old at T-10 is not — plus the shape of the new log line, so the deploy run log states which rule fired rather than leaving it to be derived. **The file's own standing warning was re-verified rather than assumed**: `league.synced_at` is stamped by `importLeague`, NOT by `syncWeek` (sync.js:41 is inside the import), so it remains an import date and not a heartbeat — the header has said so since it cost someone an hour, and it is still true. `sleeper_lineup.synced_at` (0122, trigger-stamped) stays the answer. No behaviour change; parity + probes green.

2026-08-20 — **A SYNC CADENCE YOU CAN READ OFF A CLOCK** (`v0.319.0`, no migration, core + worker + parity): founder — "I'd rather keep things as consistent daily as possible. we need to cover waiver movements from overnight claims. So fire at 20 min intervals from 4am to 10am est. Then an hourly fire until 4am again. On game days, fire every 5 starting 2 hours before game time then increase the speed as we approach game time." **WHAT IT REPLACES:** a flat 6-hour timer, so a roster could be six hours stale at kickoff — an overnight waiver claim that processed at 4am was not guaranteed on the board before a 1pm lock, and a Sunday-morning inactive could miss the lock entirely. The manual refresh button (0204) was the mitigation and stays, but a manager should not have to know to press it. **THREE RULES THAT COMPOSE BY MINIMUM, WHICH IS LOAD-BEARING RATHER THAN TIDY:** waivers 04:00–10:00 ET every 20 minutes; hourly otherwise; and from two hours before each kickoff, 5 minutes → 2 inside the last half hour → 1 inside the last ten (inactives drop ~90 minutes out, which the 5-minute rung catches). They take a MINIMUM rather than a precedence order because **London games kick at 9:30am ET, so their two-hour ramp starts at 7:30am — inside the waiver window**; any precedence order would have got that case wrong whichever way it was written. **PURE FUNCTION, IN CORE, TESTED AGAINST FIXED INSTANTS** (`syncCadenceAt`): a schedule is otherwise only observably wrong a week into the season, when the cost is a stale lineup at lock. 31 assertions pin both waiver boundaries, the ramp order and monotonicity, the London overlap, a kicked-off game ceasing to be a deadline, and **that the window does not drift when DST ends** — `America/New_York` rather than a fixed −4, because a hardcoded offset would run the waiver window an hour late from the first Sunday in November, which is exactly the half of the season that decides seeding. Also pinned: the daily budget, 36 fires (18 waiver + 18 hourly) against 4 before, so a cost regression shows up as a failing test. **A REGRESSION CAUGHT BEFORE IT SHIPPED:** `podTick` shared `syncCheckMs`, which had to drop from 1h to 30s so the check is at least as fast as the tightest rung it can honour. Left shared, that would have silently multiplied the pod loop — an ESPN week lookup plus `ensurePods` DB writes — by 120. It now has its own `podCheckMs` at the old hour. **SCALE, MEASURED NOT ASSUMED:** a real Sunday (London/early/late/SNF) is 167 fires; at ~1.8s a league a pass is comfortable to ~30 leagues and degrades gracefully beyond — `syncTick` is non-reentrant so an overrunning pass absorbs the next firing, and the worker now LOGS when a pass outruns its own cadence rather than leaving it to be inferred from timestamps weeks later. `SYNC_FLOOR_MS` floors the ramp, `WEEKLY_SYNC_MS` pins the old flat behaviour if it is ever wanted. Week rollover is no longer its own trigger and does not need to be: a rolled week self-corrects on the first due tick, and rollover happens midweek, far from any kickoff. 469 parity assertions green, full battery green.

2026-08-20 — **THE TENTH TACKLE, AND A TEAM CODE THAT WAS BREAKING THEIR WEEKLIES** (`v0.318.0`, no migration, data + engine + parity): StatHead shipped all five items from our audit in MCP 1.0.87, and **one we filed as cosmetic turned out to be a live bug on their side**. **`weeks_10plus_tackle` LANDED, AND THE REFUSAL TO GUESS IT WAS RIGHTER THAN THE REASONING.** v0.317.0 left `idpTackle10` unpriced rather than assume Poisson, on the grounds that tackles are over-dispersed. StatHead measured it: the Poisson error is not a constant but **LEVEL-DEPENDENT** — 9.37× understated at 2 tackles a game, 2.08× at 4, 1.21× at 6, 1.03× at 8 — so **no single calibration constant could have rescued it**, which matters because a calibrated Poisson IS how they do sacks (×0.751) and PDs (×0.962). The shortcut that works for two of the three thresholds was unavailable for the third and would have been ~9× wrong on exactly the rotational players a deep IDP league rosters. Their negative binomial at variance/mean 1.21 lands 0.985× pooled. **WE REPRODUCED THEIR INTEGRAL BEFORE TRUSTING IT**, as with the points-allowed ladder: our own negative binomial over (`tackles_pg`, `tackles_game_sd`) matches their `weeks_10plus_tackle` to within **0.018 GAMES** across a ten-player sample, and a Poisson ×0.751 matches `weeks_2plus_sack` to within 0.007. All three weekly thresholds are now priced; 728 of 963 defenders carry a non-zero 10+ tackle expectation, Budda Baker highest at 2.02 games. **A FOOTNOTE THAT IS ACTUALLY THE POINT:** `tackles_game_sd` had existed all along — we could not SEE it because of the `fields`-projected-from-the-first-row bug reported in the same note. Two findings that looked independent were one. **ARI vs AZ WAS NOT COSMETIC.** We flagged it as a tidiness issue (their HC rows said `ARI`, player rows said `AZ`); they found nflverse's ROSTER files say `AZ` while its SCHEDULE says `ARI`, their weekly builder keys on the schedule code, and **all 34 Arizona defenders therefore had an all-null weekly strip** — Budda Baker projected nothing in any week of the season, with fullbacks, punters and returners hit identically. Fixed at their source; every Arizona row now reads `ARI`. Our own `normTeam` gains `AZ → ARI` anyway, on evidence rather than principle: an unrecognised team code does not error here, it silently never matches a game, which is the same failure mode one layer down. **COACHES:** BUF is Joe Brady and ARI is Mike LaFleur in their feed now, LV's spelling is fixed, and `new_coach` is a computed 10 of 32 instead of a hardcoded 7 — the two rows that most needed the flag carry it. Our hand-corrected names already matched all four, so nothing changed here; the docblock now records that the feed has caught up. **The three API fixes are live**: `fields` projects from the union of all rows, unknown fields are named rather than dropped silently, and a no-op sort says which of the two causes it was. 5 new parity assertions including the case a Poisson would have botched — a 3-tackle-a-game edge rusher has a real but small 10+ expectation, an order of magnitude below a volume tackler's, and neither is zero nor inflated. 434 parity assertions green, full battery green + APK 31800.

2026-08-20 — **EVERY DEFENDER NOW PROJECTS** (`v0.317.0`, no migration, data + engine + parity): founder — "let's go." The bake `v0.316.0` existed to make possible. **963 defenders** (283 LB, 295 DL, 385 DB) with the full twelve-component line, and StatHead's IDP model is the one they volunteer a win for — **24% better than a flat league mean on RMSE** (1.367 against 1.801, r = 0.72) — against a DST model they say plainly does NOT beat the mean. Until now a DL/LB/DB in this app sorted by Sleeper's `search_rank`, i.e. by nothing. **KEYED BY SLEEPER ID, NOT BY NAME, AND THAT IS THE POINT:** three of the 963 slugs carry two different men each — `byron-young` is the Rams LB (70.0 projected) *and* the Eagles DL (29.8), `byron-murphy` is Byron Murphy DB/MIN *and* Byron Murphy II DL/SEA (the suffix strip collapses them), `jaylon-jones` is IND *and* CHI. A name-keyed bake would have had to pick one of each pair and misprice the other by up to 2.4 pts a week. `idpLineFor` resolves in three steps — the caller's own id, then an id parsed out of a slug 0205 renamed to `<slug>-<sleeperId>`, then a bare slug **registered only for the 960 names that belong to exactly one man**. A colliding bare slug with no id resolves to NOTHING: "we don't know which man this is" is a true statement and the column can render it blank, where a coin flip between 4.1 and 1.8 a week cannot be told apart from knowledge. **NO CALL SITE HAD TO CHANGE** — `setSlugSleeperIds` installs 0205's `league_pool_ids` map into `slugMeta`, and `projectedPoints` falls back to it, so six projection call sites that could each have been forgotten separately were not touched. **THE THRESHOLD BONUSES ARE COUNTS, NOT RATES**, which is the one piece of arithmetic that is easy to get quietly wrong: Micah Parsons averages 0.51 sacks a game and so never clears "2+ in a game" on a season mean, yet clears it **1.47 times a season** — a league paying +5 owes him 7.35 points, not 0. `weeks_2plus_sack`/`weeks_3plus_pd` are carried and paid per game. **WHAT IS DELIBERATELY NOT PRICED:** safeties (identically 0.00 across all 963 — the generator refuses to emit if that changes), defensive return yardage (unmodelled upstream), and **10+ tackle games** — StatHead ship no `weeks_10plus_tackle`, no `tackle_game_sd`, and `get_player_weekly_stats` carries no defensive columns, so the weekly tackle distribution cannot be reconstructed at all. It could be ASSUMED (their sack/PD sds sit within 3% of Poisson) but tackles are driven by snap share and game script and are visibly more dispersed — and this project already overstated ties **eight-fold** by assuming normality on NFL margins, so it is left unpriced and asked upstream. **The stamped tail STAYS**, unlike the fullbacks': 19 of 963 rows (2.0%) share a component vector, against 10 of 15 there — and the highest stamped row would rank 42nd among linebackers, a startable player whose alternative is not a better number but no number, which sorts him below men projected to score a quarter as much. Generator (`scripts/bake/gen-idp.mjs`) re-checks row count, the dead safety column, `solo <= tackles`, id uniqueness, that every colliding slug stays id-resolvable, and that our own standard scoring reproduces StatHead's served `projPts` — currently **mean -0.100 pts per SEASON, worst -0.50**, pure two-decimal rounding across twelve components. Rows sorted by slug so a refresh diffs cleanly. 24 new parity assertions; one of them caught that a "sack-heavy league flips the edge rusher past the tackle machine" is FALSE at `idpSack: 8` (6.9 to 6.6) — it takes a real big-play catalog (`tackle 0.5, sack 6`), and the assertion now says so. 429 parity assertions green, full battery green + APK 31700.

2026-08-19 — **A PLAYER IS AN ID, NOT A NAME** (`v0.316.0`, migration 0205, SQL + core + parity): founder — "let's do the identity work. I'm a big fan of using keys." **THE BUG WAS ALREADY LIVE.** `league_pool`'s primary key is `(league_id, slug)` and the slug is a normalised full name that also strips generational suffixes, so two different active players with the same name were ONE ROW and the second one lost — dropped **twice over**, by `nativeLeague.ts` keeping whichever scored better and by `seed_league_pool`'s `on conflict do nothing`. In StatHead's 747 defenders three pairs collide: Byron Young LB/LA (81.2 projected) with Byron Young DL/PHI (36.0), Byron Murphy DB/MIN with Byron Murphy II DL/SEA (the suffix strip does that one), and Jaylon Jones DB/IND with Jaylon Jones DB/CHI. A commissioner running an IDP league simply could not roster both, and nothing said why. **SLUG STAYS THE STORAGE KEY** — it is embedded in a dozen tables plus every baked lookup we own, and re-keying that three weeks from first lock would be reckless and would buy nothing. `sleeper_id` arrives instead as the STABLE IDENTITY the bakes join on: nullable (team pseudo-players are not people), **unique per league where present** — the mirror of the bug it fixes — and indexed. Blank becomes NULL, or the partial index would fire on the second team unit. **AND NOTHING IS SILENTLY DROPPED ANY MORE:** the pool's dedupe map is keyed by Sleeper id rather than slug, and new `disambiguateSlugs` renames the LOSER of a name collision to `<slug>-<sleeperId>` — deterministic, stable across re-seeds because a Sleeper id does not change, and unique because it is an id. Rows arrive sorted best-first so the higher-ranked player keeps the clean slug. A renamed slug misses PLAYER_BIO/ADP_2026/PROJ_2026, which is survivable ONLY because the pool already carries that truth (`setSlugMetaOverrides` for meta) and now the id too — which is exactly why the key had to land in the same migration. **NOT ESPN'S ID, WHICH WE ALREADY STORE:** it exists for headshots, is absent for fresh rookies, and nothing we bake is keyed by it; every projection artifact we consume ships `sleeper_id`, and our pool is built from Sleeper's directory. New `league_pool_ids` serves the slug→id map to members. 15 identity probe assertions (53rd suite) + 7 parity assertions on the rename, including that re-running it is a no-op rather than stacking a second suffix — a slug that moved between seeds would orphan a dozen tables. **THIS UNBLOCKS IDP**, which is StatHead's strongest model (RMSE 1.367 vs 1.801 flat, r=0.72) and the next ship. 405 parity assertions green, full battery green + APK 31600.

2026-08-19 — **FULLBACKS, THE FIVE THAT ARE REALLY THERE** (`v0.315.3`, no migration, data + engine + parity): founder — "go ahead and bake them." New `projFb2026.ts` carries **five of StatHead's fifteen**: Juszczyk, Ingold, Burton, Beck, Prentice. The other ten are **byte-identical** — 8.30 games, 8.50 projPts, the same line to two decimals — the positional mean stamped on every fullback the model has nothing specific to say about, and ten identical numbers wearing ten different names is false precision that looks like knowledge. **THE CONTRAST WITH THE FILLED PUNTERS IS THE WHOLE ARGUMENT:** we DID fill Chicago's and Denver's punters with a league-mean line one version ago, because `chi-p` is a TEAM SLOT and Chicago will punt sixty times whoever does it — a zero would be the wrong claim. A fullback is a PERSON; there is no "Seattle's fullback" spot that must be filled, and the league mean is not evidence Robbie Ouzts will produce. **THEY SCORE AS THE LIVE SCORER SCORES THEM:** `classicScorePlay` sends a fullback down the skill branch where the reception premium is `TE/RB/WR` only, so an FB earns plain PPR and no positional bonus — priced at `pos: 'FB'` for exactly that reason, with a parity case pinning that an RB catch bonus does NOT reach one (the property that would have diverged silently had we priced him as a back). Base derived from the line under our own default catalog, like the K/DST bakes: all five reproduce StatHead's served `projPts` to within **0.08 points a season**. **WHY THEY WERE MISSING, WHICH WAS NOT WHAT WE ASSUMED:** not a position filter — nflverse labels them `position=RB` with `depth_chart_position=FB`, they are absent from StatHead's depth-order model, and the pool keeps four backs a team, so they were squeezed out before being considered. Our own `PLAYER_BIO` has the same seam (Andrew Beck is an RB in it), harmless because this file keys by slug and scores from the line rather than trusting a label. **Set expectations:** the position is dying — 22 fullbacks took a snap in 2016, six in 2025, the whole position scored 153 PPR points last season, and the best of them projects 2.7 a week. 10 new parity assertions. 398 parity assertions green, full battery green + APK 31503.

2026-08-19 — **THREE OF STATHEAD'S HEAD COACHES WERE THE MEN THEY FIRED** (`v0.315.2`, no migration, data + parity): founder spotted it by eye — "can you double check all the coaches with a web query? ATL is Kevin Stefanski." **They were right, and it was worse than one.** Verified all 32 against the web: 2026 was a **ten-change coaching cycle, tied for the most ever**, and StatHead's feed had seven right (Minter BAL, Monken CLE, Hafley MIA, Harbaugh NYG, Saleh TEN, McCarthy PIT, Kubiak LV) while keeping the **FIRED INCUMBENT** for three — Raheem Morris at Atlanta (sacked 4 Jan, replaced by **Kevin Stefanski**), Sean McDermott at Buffalo (sacked 19 Jan, replaced by **Joe Brady**), and Jonathan Gannon at Arizona (sacked after 3-14, replaced by **Mike LaFleur**). Their Las Vegas spelling was also "Kubliak" for **Kubiak**. The other 22 teams did not change, confirmed against the published count of ten openings. **WHY THIS WAS SURVIVABLE, AND THE DESIGN POINT IT PROVES:** the projection is keyed to the TEAM, not the person — `atl-hc` means "Atlanta's head coach" — so every win, margin and points figure was already correct and only the displayed NAME was wrong. A sacked coach on a card is embarrassing; a sacked coach in the scoring would have been a defect. The same property means an in-season firing costs us nothing but a stale label. Names are now hand-corrected with a docblock warning **not to blindly overwrite the block on a refresh**, and five parity assertions pin the three corrections, the spelling, and that no team still claims a coach it parted with — a silent regression there puts a fired man back on the board, which is exactly what the eye caught. 388 parity assertions green, full battery green + APK 31502.

2026-08-19 — **EVERY TEAM HAS A COACH AND A PUNTER, AND WE KNOW WHO THEY ARE** (`v0.315.1`, no migration, data + parity): founder on the v0.315.0 bake — "for punter and HC let's make them generic to the team like K and DST. So every team has one… do we have current head coach or some way to get that — they can change mid season." **BOTH DONE.** Chicago and Denver had no upstream punter row and projected zero; they are now filled with **StatHead's own positional-mean line** — the identical 61.9 / 2938 / 24.5 row they already stamp on Baltimore, Buffalo and Houston, who have no settled starter either. That is the right call for a TEAM slot and it is **not** the false precision we refused for fullbacks: every team really does employ a punter and really will punt about sixty times, so zero was the wrong claim — whereas ten identical FULLBACKS would each have looked like a distinct projection of a distinct player. 32/32 both now. **NAMES ARE IN, AND THE MID-SEASON QUESTION HAS A GOOD ANSWER:** new `TEAM_ROLE_NAME` maps each slug to the human currently in the role, from the same 1.0.84 pull, so a refresh picks up changes for free — it already carries the 2026 staff (Jesse Minter at Baltimore, Todd Monken at Cleveland, Robert Saleh at Tennessee, Klint Kubliak at Las Vegas). **A COACHING CHANGE IS HARMLESS BY CONSTRUCTION** because the projection belongs to the TEAM, not the person: `den-hc` means "Denver's head coach", so firing one and hiring another leaves the slug, the roster row and every stored lineup untouched, and only the displayed name goes stale — a cosmetic bug rather than a scoring one. Nothing reads the map to score anything, which parity pins. The two filled punters carry no name on purpose: there is no starter to name, and the pool already renders "CHI Punter". 4 new parity assertions. 383 parity assertions green, full battery green + APK 31501.

2026-08-19 — **HEAD COACHES AND PUNTERS PROJECT, AND THE MARGIN LADDER IS INTEGRATED** (`v0.315.0`, no migration, data + engine + parity): StatHead's 1.0.84 closed out the positions that returned zero. New `projTeamRoles2026.ts` bakes **32 head coaches and 30 punters**, team-keyed to the `{team}-hc` / `{team}-p` pseudo-players our pool has minted since 0171 — they built the coach rows with `sleeper_id = "<team>-hc"`, our own convention. **THEY SHIPPED IT WITH NO POINTS SCALAR, WHICH IS WHAT WE ASKED FOR AND WHY:** `ppg`/`projPts` are null or absent for both, because no standard coach or punter scoring exists anywhere in fantasy — **every one of our own catalog knobs for both defaults to 0**. So these are priced DIRECTLY under the league's catalog rather than as a ratio: the ratio's denominator would be zero, and `projectedPoints` needed its own branch since the existing `if (!base) return 0` guard would have zeroed them under a league that pays. **Under the default catalog both project exactly zero, and that is correct rather than a gap — they are worth nothing until a commissioner decides what they are worth.** **THE MARGIN LADDER, AND A FINDING THAT CHANGED THE DESIGN:** our HC scoring pays a win then a bonus by margin bracket, so the natural move was to integrate a normal over `margin_pg` with their published `margin_game_sd` of 12.71 — the same shape as the points-allowed integral. It reproduces their win and loss counts closely (McVay 9.98 against 10.3, 6.51 against 6.6) but puts **0.52 games at exactly zero against their 0.06 — ties overstated eightfold**, because an NFL margin distribution is not normal (overtime resolves most zeros, threes and sevens dominate). So the TOTALS come from StatHead where they are market-derived and calibrated, and the normal supplies only the SHAPE within each side; parity pins that the shares sum to exactly 1, that a favourite wins big more often than he loses big, that an underdog mirrors it, and that a dead-even coach is symmetric. **DELIBERATELY NOT PRICED:** the punt-average ladder (`pta44`…`pta33` pay on a WEEK's average and StatHead ship a season figure with no per-game spread — their own note says a season average cannot be scored against a weekly rung), two-point conversions (not modelled upstream), and Chicago and Denver's punters, who have no upstream row and project zero rather than a league-average stand-in. **FULLBACKS INVESTIGATED AND SKIPPED:** 15 rows of which **10 are byte-identical** — the positional mean stamped on everyone — on a position their own note calls dying (6 snaps-takers in 2025, 153 PPR points league-wide, Juszczyk 2.7/week). Ten made-up-looking identical numbers on a board is false precision; revisit if the position stops shrinking. 22 new parity assertions. 379 parity assertions green, full battery green + APK 31500.

2026-08-19 — **A MANAGER CAN REFRESH THEIR OWN SLEEPER ROSTERS** (`v0.314.0`, migration 0204, SQL + worker + both hosts): founder asked what it would cost to poll Sleeper every minute, or every twenty seconds, then — "Can we let users do a manual refresh?" **THE MEASUREMENT THAT DECIDED IT:** a full sync pass costs ~1.8s per league (2 ESPN scoreboard calls at 194KB each, 2 Sleeper calls, ~5 Supabase ops, and a hardcoded 400ms sleep), strictly sequential — so a 60s cadence stops fitting above ~33 leagues and 20s above ~11, and at 100 leagues a 20s poll would pull **168 GB/day of identical ESPN scoreboard** for a fixture list that moves twice a day. A button spends the request when someone actually cares. **AND FOR MOST LEAGUES IT IS NOT A CONVENIENCE — IT IS THE ONLY PATH:** the worker's auto-sync only touches leagues in `PILOT_LEAGUE_IDS`; every other Sleeper league has never been auto-synced at all and moved only by hand-run CLI. **THE SHAPE:** Postgres cannot call Sleeper and the worker has no HTTP surface, so the client writes a `sync_request` row through an RPC and the worker drains it on the tick it already runs — **calling the same `syncWeek` the scheduled path calls**, one code path with two triggers, so manual and automatic cannot drift. Answers in ~25s. **THE COOLDOWN IS THE WHOLE SAFETY STORY AND LIVES IN SQL**, measured from the last COMPLETED refresh (a request that fails instantly must not lock the league out) with no caller-supplied timestamp anywhere — read is granted to members, and there is deliberately NO insert/update/delete policy, so the RPC is the only door. A refusal is `ok:true, queued:false, retry_in:N` rather than an error, because nothing went wrong. Pressing twice while one is in flight is the same ask, not two rows. **ANY MEMBER MAY PRESS IT:** it mirrors someone else's source of truth into our copy — it cannot change a lineup, move a player, or advantage the presser, so commissioner-only would buy nothing the cooldown doesn't. **THE PROBE CAUGHT A REAL BUG:** a native league is minted with a namespaced `native-<uuid>` in `sleeper_league_id` because the column is NOT NULL, so the first cut's "is the id blank" test was true for **every league in the table** and would have queued work for all of them; keyed on `provider` now, and `league_sync_state` returns `sleeper` so the button draws nothing where there is no upstream. **THE SCOREBOARD CACHE, folded in:** `getGames` gained an **opt-in** `maxAgeMs` — default 0, so the live play tick that reads scores off the same call is byte-for-byte unchanged and can never be served a stale board — and `syncWeek`'s two FIXTURE reads take a 5-minute cached copy, turning 200 identical ESPN requests per 100-league pass into one. 16 new probe assertions (52nd suite). 357 parity assertions green, full battery green + APK 31400.

2026-08-19 — **A RETURN SPOT IS PRICED INSTEAD OF ZEROED** (`v0.313.0`, no migration, data + engine + parity): StatHead's 1.0.74 shipped return components, which is the data v0.311.2 was missing when it made a RET spot project **zero on purpose** — `RET` is a slot identity, a player scored there banks return production only, and showing his mute rushing and receiving was worse than showing nothing. New `projReturns2026.ts` bakes punt-return yards, kick-return yards and return TDs for **105 returners, 105 distinct slugs, ZERO collisions, 105/105 already in the skill bake**. **THE CLEAN JOIN IS NOT LUCK:** a RET spot accepts RB/WR/TE/FB only, so this file never has to name a defender — and the defensive pool is exactly where our name-keyed identity breaks (three live collisions: two Byron Youngs, two Byron Murphys, two Jaylon Joneses). Restricting the bake to what the spot can actually hold sidesteps that entirely, and the file says so, including the warning that it cannot simply be widened to DBs later. **THE TWO YARDAGE BUCKETS STAY SEPARATE** because the catalog prices them separately — `retYd` pays any return yard and `krYd`/`prYd` stack by kind — so a combined figure could not serve a league paying more for punt returns than kick returns; a parity case pins that a punt premium moves the punt returner more than five times as hard as the kick man. **Under the DEFAULT catalog a return spot is still worth almost nothing, and that is correct:** `retYd`/`krYd`/`prYd` all default to 0, so only `retTd` scores and the best returner projects ~0.2/week against 6.8 in a flex spot — which is exactly what the live scorer pays him, and the whole point of v0.311.2. **Scoped bonuses now apply here** where v0.311.2 withheld them: the value is known, so a flat bonus is no longer false precision. **A TOOL QUIRK WORTH THE COMMENT:** `get_projections` projects columns from the FIRST ROW and applies that shape to every row, so a bulk pull sorted by ppg starts with a non-returner and silently drops every return column for everyone, in csv AND jsonl — a single-player pull returns them fine. `sort_by: 'ret_yd'` is what makes the fields appear at all, and the refresh note says so. **IDP was investigated and deliberately NOT shipped** — it is StatHead's strongest model (RMSE 1.367 vs 1.801 flat, r=0.72) but three of their 747 defenders collide under our `normName` slug, and `league_pool`'s primary key IS that slug with no sleeper_id anywhere; Byron Young LB/LA (81.2 projPts) and Byron Young DL/PHI (36.0) would silently share a projection. That is a pre-existing identity defect our own pool already resolves by DROPPING one of the pair, and it wants its own migration before IDP lands. 357 parity assertions green, full battery green + APK 31300.

2026-08-19 — **THE WEEK'S SLATE FILLS THE SCOREBOARD'S DEAD SPACE** (`v0.312.0`, no migration, core + both hosts + parity): founder, with a screenshot of the mobile matchup board — "the middle of the top is super empty. Maybe have the week's game slate with info and stats? In a chip you can select." **WHAT MAKES IT NOT AN NFL SCOREBOARD:** the interesting fact about Bills-Texans is not the score, it is that THREE OF MY STARTERS ARE IN IT and two of my opponent's. A generic scoreboard is a worse copy of an app already on their phone; this one answers "what is riding on this game", which nothing else can tell them. New `slateChips` in `matchupBoard.ts` aggregates the week's slate against the matchup's own starters — per game, each side's count, their points, and the players themselves. **It reads off the BOARD, not the pool, and prices with `projectEntry`** — the same blend the side totals use — so a chip's numbers always sum toward the headline score above it rather than telling a second story. Bench is excluded for the same reason the side totals exclude it: a bench player in that game is not riding on it. **Placed as a full-width band under the two totals, not in the literal centre column** — that column is ~90px between two team heads and a slate does not fit in it; it keeps LIVE and the golf rule, and the emptiness the card actually had is the space beneath. Every game is shown in kickoff order whether or not the matchup touches it (it was asked for as *the week's* slate, and silently dropping games would misrepresent the week) — uninvolved games are DIMMED rather than hidden, and selecting one says so in words instead of showing an empty panel. Selecting a chip opens both sides' players with live-or-projected points, following the board's own lock state. Same component on web and mobile off one core aggregator, so the two hosts cannot drift. 16 new parity assertions, the load-bearing one being that a chip's points equal `projectEntry` over the same entries — a strip that disagreed with the header would be worse than no strip — plus kickoff ordering, an inferred FINAL beating the clock, a half-written slate row claiming nothing, an empty slate not crashing, and a game with no kickoff sorting LAST because an unknown time is not midnight. 348 parity assertions green, full battery green + APK 31200.

2026-08-19 — **A RETURN-ONLY SPOT NO LONGER PROJECTS A RECEIVER'S WHOLE LINE** (`v0.311.2`, no migration, engine + both hosts + parity): founder asked "we need kick/punt return yards too?" while reviewing the StatHead component request — yes, and chasing it found a live bug rather than a data gap. **RET is a SLOT identity, not a position** (0171): a player scored there banks return production ONLY, and `classicPoints` has always enforced it with a `posOverride` the LIVE column passes. The PROJECTED column never knew — `ClassicBoard` handed `projectedPoints` the slot's **NAME** while handing the live scorer its **SPEC**, and `slotPos` was sitting in scope at the same call site, unused. So a RET spot rendered a receiver's full PPR projection beside a live number that can only ever pay return yardage. **Under the default catalog it is the starkest version of this bug the subsystem has produced:** `retYd`, `krYd` and `prYd` all default to 0 and only `retTd` scores, so live is ~0 against a projection of 10+, every week, on the same row. Fixed at both layers: the spec is threaded through on web and mobile, and `slateAwareProj` now takes the spot `bestballFillBy` was already passing it — ranking RET candidates by their full skill line would seat the best RECEIVER rather than the best returner, which is the same mistake in the fill instead of on screen. **The honest value is zero, not a smaller guess:** StatHead's pool carries no return yardage at all, so there is nothing to project, and a scoped bonus is deliberately NOT added on top — a flat bonus over an unknown is false precision, and that is the path that would quietly reintroduce it (pinned). 8 new parity assertions, including that `isRetSlot` means EXACTLY a return-only spec and that every caller passing no spec — which is every other surface — is untouched. The StatHead request grew a return section to match: `retYd` is one knob but `krYd` and `prYd` are separate, so kick and punt return yardage are needed SPLIT, not combined; return TDs can stay one number because `retTd` is one knob; and `special_teams_tds` already comes back from `get_player_season_stats` today, so that half exists. 337 parity assertions green, full battery green + APK 31102.

2026-08-19 — **RE-BAKING K/DST FOUR HOURS LATER, BECAUSE 1.0.70 MOVED THEM** (`v0.311.1`, no migration, data + comment + parity): StatHead shipped `get_schedule_strength` and — the part that matters to us — **started applying those factors to the K and DST season lines**. That is not drift, it is a model change, and it moved what v0.311.0 baked four hours earlier: DEN DST 108.2 → **119.1**, HOU out of the top three, DAL down to 75.8. Re-baked off `as_of 2026-08-19T20:12:09.434Z`. **The skill positions did NOT move** — McCaffrey 451, Gibbs 442, Taylor 418 identical to our bake, same stat lines — so `proj2026.ts` and `projStats2026.ts` stand; the pool only grew to 509 because K and DST now live in it. **THE INTEGRATION HELD THROUGH THE CHANGE, AND GOT A BETTER TEST:** reconciling our points-allowed integral against the residual in their served totals now runs over **all 32 defences** rather than three, at a mean of **0.0007 pts/gm and a worst case of 0.0109** — with every line moved by the schedule factor, which is a far stronger check than the original spot check. **THE ONE THING TO NOT DO IS NOW WRITTEN DOWN:** the factors are published as data AND baked into K/DST, so re-applying them from `get_schedule_strength` double-counts. They are deliberately absent from QB/RB/WR/TE (whose weekly multipliers normalise to mean 1 and move points between weeks, not seasons) and **we have not applied them there either** — StatHead say plainly they cannot backtest a skill-position schedule adjustment, and an unbacktested multiplier across 445 players is the kind of guess this project refuses. The acknowledged cost is an asymmetry: a defence's easy slate is in its projection, a receiver's is not. **AND IT SHARPENS THE RANKING CAUTION RATHER THAN SOFTENING IT:** applying schedule roughly DOUBLED the defence spread, from 6.4–5.0 points a game to 7.0–4.5, while the RMSE figures StatHead quote (1.384 vs 1.375 for a flat mean) were measured BEFORE it was applied. A board that looks twice as decisive with nothing yet showing it forecasts better is exactly when to keep using the components to re-price and not to rank. One new parity assertion walks all 32 baked defences and pins that allowing fewer points is never worth less — the property that breaks first if a bracket boundary or the weighting is ever miswritten. 329 parity assertions green, full battery green + APK 31101.

2026-08-19 — **KICKERS AND DEFENCES HAVE A PROJECTION AT ALL** (`v0.311.0`, no migration, data + engine + parity): StatHead shipped K and DST components in **1.0.69**, with an unusually straight caveat — backtested 2023-25, their kicker model beats a flat league mean by ~3% on RMSE and their DEFENCE model beats it by nothing. **That caveat lands differently here than they expected, because our baseline wasn't a constant — it was nothing.** `proj2026.ts` is 445 rows of QB/RB/WR/TE, so `PROJ_2026.get('den-k')` was undefined and `projectedPoints` returned 0 on its first line: the draft board printed a dash, waivers sorted every kicker and defence BELOW players the source has never heard of, and `slateAwareProj` valued all 32 defences identically, so auto-slot picked one in roster-arrival order. Against that, weak-and-honest wins, and their shrinkage is doing us a favour — the whole 32-team defence board spans 6.4 to 5.0 points a game, which is what a board SHOULD look like when the signal is this thin. **We use it to re-price, not to rank, and the code says so.** New `projKdst2026.ts` bakes both, joined BY TEAM to our own `{code}-k` / `{code}-dst` pseudo-players (this app rosters team units, not named kickers) via StatHead's 2026 roster — 32/32 each, no gaps, no dupes, pinned in parity. Their roster endpoint says `AZ` where their projection endpoint says `ARI` and our `normTeam` knows neither; the generator maps it so nothing at runtime ever sees it. **THE LEVEL IS OURS, DELIBERATELY:** these two files store only the STAT LINE and we price it under our own default catalog, because StatHead charge NOTHING for a missed kick (verified — their line reproduces their own `projPts` at 3/3/4/5 + XP to within 0.5 pts/season across all 32) while ours charges −1, worth 7-8 points a season on a real kicker. Storing their total would have left a "standard" league whose projection didn't equal the standard scoring of its own components — breaking the reconciliation the whole subsystem rests on. **THE ONE PIECE OF REAL ARITHMETIC:** points allowed is scored by BRACKET, so a defence's expected points is not the bracket its average falls in. StatHead flagged it and gave sd ≈ 9.4; we checked rather than took it — integrating OUR ladder, which they have never seen, over normal(paPg, 9.4) reproduces the points-allowed residual in their own served totals to **0.005 / 0.000 / 0.002 pts/gm** for DEN, HOU and LAC, where scoring at the mean is off by ~0.65 on all three (a tenth of a defence's projection, always the same direction). The ladder is copied from `classicScorePlay`, not remembered — a drifted bracket boundary would be the same two-rulebook bug in a third coat. The normal is an approximation of a skewed discrete quantity and under-weights shutouts; noted in the code, and matching StatHead's method is what makes the numbers reconcile. **A HOLE CAUGHT BEFORE IT SHIPPED:** `poolSort.projFor` gated presence on `PROJ_2026.has()`, so every kicker and defence would have kept sorting last in the very lists this change exists to lift them off — new `hasProjection` spans both bakes. 21 new parity assertions: both pools complete on our slug convention, the standard catalog exactly the identity for K and DEF, each position's knobs moving that position and only it, missed kicks reachable because attempts are in the line, a defence's TDs visible to a per-TD scoped bonus and a kicker's correctly zero, and the integration monotone in the league's own ladder with the linear per-point knob exact. **Still absent upstream:** no 2026 Vegas lines (StatHead offered — worth taking, it is what would make DST rankable), and `fum_rec`/`def_td`/`st_td`/`safety` are league rates identical for all 32 teams. 328 parity assertions green, full battery green + APK 31100.

2026-08-19 — **THE LEAGUE'S RULES REACH EVERY PROJECTION, NOT JUST THE BOARD'S** (`v0.310.0`, no migration, core + worker + both hosts): "so we can apply scoring changes to the projections in waivers, drafts and the matchup board by league and position?" **We could not** — checked rather than assumed, and the answer was one surface out of three. v0.308.0 built the league-aware projection and v0.309.0 made it exact, but `setLeagueProjScoring` was installed in exactly one place: the matchup board's lineup rows. Everything else read the raw PPR bake — the waiver pool and the draft room (`poolSort.projFor`, which drives both the ORDER and the printed value), the player cards, and worst of all `slateAwareProj`, the ranker behind the worker's auto-slot, the unmanaged seat's computed lineup and the best-ball fill. **The board contradicted itself on one screen**: an adjusted number in the lineup row and a raw one in the player picker directly below it. **Three fixes.** (1) `projFor` routes through `projectedPoints` — waivers and drafts, value and order together — keeping `null` for a player the bake has never heard of, because 0 would sort him among the genuinely worthless. (2) The seven raw render sites swapped. (3) `slateAwareProj` ranks by the league's catalog, with the worker installing it per league per tick beside `setLeagueGolf` and the resolver installing it beside the classic resolve, so the lineup an unmanaged seat is GIVEN and the points it is then scored on come from one rulebook. It passes NO SLOT on purpose — nothing knows the spot yet, and `scopedAdjustFor` already stands spot-scoped rules aside where there is no spot. **A REAL v0.308.0 BUG FELL OUT OF THE WIRING:** a league keeps its adjustments in `scoring` and its per-catch value in `ppr` SEPARATELY, and the board installed only the first — so a half-PPR league scored receivers at ½ and projected them at 1. The same two-rulebook failure the whole subsystem exists to prevent, hiding in the one knob that isn't in `scoring`. New `leagueCatalogOf` merges them in one place and every surface installs through it. **A cycle hazard was defused first:** `classic.ts` now imports `projScoring.ts`, which imports `classic.ts` back, so the module-global's initialiser was moved inside a function — at the top level it would have thrown `Cannot access 'DEFAULT_CLASSIC_SCORING' before initialization` depending only on which module the bundler reached first. **VISIBLE BEHAVIOUR CHANGE, called out rather than slipped in:** waivers and the draft board now REORDER under custom scoring. A 1.5/reception TE premium puts Trey McBride first overall, ahead of McCaffrey; zero PPR flips Gibbs above McCaffrey on catch volume and lifts three QBs into the top six. Both are pinned. 17 new parity assertions cover the pools (order, printed value, unknown-is-not-zero, rank untouched), the auto-fill ranker (league-aware, still zeroes a ruled-out player, agrees with the board on the same player), the ppr merge, and **the worker's own contract** — that a `valueOf` closure built once per tick answers under whichever catalog is installed when it is CALLED, which is the property `autoSlotClassicLineups` leans on and would silently score every league by the first one if it ever stopped holding. 307 parity assertions green, full battery green + APK 31000.

2026-08-19 — **THE PROJECTION RATIO NOW DIVIDES BY ITSELF** (`v0.309.0`, no migration, data + engine comment + parity): "let's pass feedback to the mcp team of what we would need from them to do the same" — we did, and **StatHead shipped it in 1.0.67**. `get_projections` now serves the projected STAT LINE (passing yds/TD/INT, rushing yds/TD, rec/yds/TD, plus pass_att/pass_cmp/tgt/rush_att), so `projStats2026.ts` is re-baked off **their** components instead of Sleeper's. The first pulls after their note came back without the fields and with a 1.0.66 `get_metadata` — reported as a version problem rather than a naming one, and it was: on 1.0.67 the same call returns all of it. **WHY THIS MATTERED AND WASN'T COSMETIC.** `leagueProjRatio` divides the league's scoring of a line by the STANDARD scoring of *that same line*, so the denominator is only honest if it reproduces the number it scales. With Sleeper's line it didn't — numerator and denominator were two different models' opinions of the same player, and the shape (this back's carries against his catches) was Sleeper's, applied to StatHead's level. Now both files come from **one `get_projections` call at one `as_of`**, and scoring the lines under the default catalog re-derives StatHead's own served season total to a **mean residual of −0.06 points per SEASON, worst row 2.50** (−0.003/wk and 0.124/wk against `PROJ_2026`). **AND THE SILENT HOLE IS CLOSED:** the sleeper_id join reached **368 of 445** players — the other **77 fell back to a ratio of 1**, so a custom-scoring league was quietly showing them at stock PPR with nothing on screen to say so. Same pool now means a name join through the same `normName` slug, verified 1:1 with no collisions: **445/445**. Two new parity assertions pin exactly what the Sleeper bake could not be asked: that every projected player HAS a line (the failure mode is silent, which is why it needs a guard), and that the lines RECONCILE to the bake under the standard catalog with no systematic bias either way — a drift would tilt every ratio in the app at once, and it would tilt them without erroring. The other 24 assertions passed **unchanged through the source swap**, which is the design working: the ratio was always meant to be source-independent. Dead `PROJ_SID_TO_SLUG` dropped with its consumer. **STILL NOT AVAILABLE, CONFIRMED WITH THEM DIRECTLY:** fumbles, first downs, two-point conversions and the yardage/reception milestones don't exist anywhere in StatHead's pool, and `get_projections` carries no K or DST at all — so a league tuning only those knobs still gets a ratio of exactly 1 and an unadjusted projection. That is now a documented source limit rather than a plumbing gap. Full battery green + APK 30900.

2026-08-19 — **PROJECTIONS NOW OBEY THE LEAGUE'S OWN RULES, AND THE SPOT'S** (`v0.308.0`, no migration, core + both hosts): "do we have what we need to be able to adjust the projections for the scoring adjustments by league and roster spot?" We didn't, and the gap was on screen in every custom-scoring league: LIVE points went through the 64-field catalog and then `scopedAdjustFor` with the SPOT in hand, while PROJECTED points were `PROJ_2026.get(slug)` raw. One row, two rulebooks — a league paying ×1.5 on running backs showed live ×1.5 and projected ×1.0, and a league paying 6 for a passing touchdown projected its quarterbacks as though it paid 4. **YOU CANNOT RE-SCORE A SCALAR**, which is why this needed new data: a catalog prices passing yards, receptions and touchdowns separately. New `projStats2026.ts` bakes Sleeper's PROJECTED STAT LINES (passing yds/TD/INT, rushing yds/TD, rec/yds/TD), joined on the sleeper_id the projection bake already carried — 368 of 445 players covered. **COMBINED AS A RATIO, NOT A REPLACEMENT:** `projected = PROJ_2026 × score(line, leagueCatalog) / score(line, standardCatalog)`. Any consistent scaling of the line cancels, so Sleeper's absolute level never overwrites StatHead's — the line answers one question only, "how much more is this production worth under THESE rules" — and it buys the invariant that made this safe to ship: **a standard-catalog league is unchanged to the decimal**, which four parity assertions pin. Then the scoped layers land in the live scorer's own order: multiplier, flat points, and the per-TD bonus against PROJECTED touchdowns per week (the one that genuinely needed the stat line), all with the SPOT passed through, so "the FLEX pays ×1.5" finally shows up in the FLEX's projection and nowhere else. Zero-fill is deliberately NOT applied here — that rule is about a spot scoring nothing, and a projected player has not scored nothing; the board keeps applying it where an empty spot exists. **What the line cannot see, it does not guess:** milestone bonuses, splash TDs, kicking, DST, IDP, returns, first downs and 2-pointers are absent from BOTH sides of the ratio, so they never distort it — a league tuning only those gets a ratio of exactly 1 and an unadjusted projection, and a kicker's all-zero line falls back rather than dividing by zero. New `check:projscoring` (24 assertions) covers the invariant, each catalog knob moving the right players and only them, every no-data path falling back to the bake rather than to zero, the spot contract, and catalog-then-scoped composition. Full battery green + APK 30800.

2026-08-19 — **THE PROJECTION BAKE IS LIVE AGAIN, ON A PER-WEEK FORM OF IT** (`v0.307.0`, no migration, data + parity): StatHead shipped everything the v0.306.2 hold asked for in **1.0.66** — every `get_projections` row now carries `games` (the denominator) and `projPts` (the season total), plus a `min_games` filter, and both season and weekly responses flag rows with a denominator ≤ 4 by name. They also corrected the history in our favour: the weekly builder always divided this way, and 1.0.64 propagated it to the season board where the old April spine had been giving season-shaped numbers — so **holding the bake was right on the merits, not merely cautious**. And it was broader than the three players I found: roughly half their 64-QB pool is projected under 8 games. **THE BAKE IS REFRESHED — 445 players, `as_of 2026-08-19T14:17:42Z`.** It stores neither `ppg` nor `projPts` but **`ppg × games / 17`**, with StatHead's raw `ppg` and `games` kept verbatim in the CSV so the transform is auditable. Their advice was to rank on `projPts`, which is right for a draft board and wrong for this file: `PROJ_2026` is read as a PER-WEEK number — `buildMatchupBoard` puts it in `proj` and sums it into a projected team total — so a season total would render 346 projected points for one week. The per-week form is the same figure at the scale every consumer already expects, it is immune to the denominator (Nick Mullens 21.0 → **1.2**, Joe Milton 19.0 → **1.1**, against 2.6 in the April bake), and the QB board now reads Allen 20.4 / Hurts 18.7 / Maye 18.6 / Lawrence 18.2 with no backup anywhere near the top. **The known cost, from StatHead directly:** `games` is sometimes wrong — Justin Fields is projected 2 games on KC, a genuine depth-chart error in their pool — so he stores 2.6 where he may start. Understating a mis-rostered player is the failure we accept; the alternative was ranking him above Josh Allen. The real starters move a long way (Gibbs 21.1 → 26.0, McCaffrey 20.7 → 26.5, Chase 20.7 → 17.0, Lamar 19.9 → 13.6 on a 14-game projection), which is exactly why the parity guard that pins these values exists — it fired, and every pinned assertion was re-derived rather than loosened. **NOT taken:** their `consensus` preset, now rebuilt off the live pool (448/128, Gibbs 22.60, McCaffrey 21.80). Switching preset is a separate product decision and folding it in here would make future differences unattributable. Full battery green.

2026-08-19 — **CORRECTING MYSELF ON STATHEAD, AND HOLDING THE PROJECTION RE-BAKE** (`v0.306.2`, no migration, comment + STATUS only): the StatHead team pushed back on this morning's line that "StatHead hasn't re-run that model since April", and **they are right**. Checked rather than taken on trust: `get_projections` now answers `as_of 2026-08-19T14:17:42Z` with **445 players**, and their three headline numbers reproduce exactly — Gibbs 21.1 → 26.0, Chase 20.7 → 18.1, Bowers 15.0 → 13.9 (McCaffrey moves furthest, 20.7 → 26.5). What I was reading was a **static artifact** they served until 12:51Z today, and I inferred a frozen model from a frozen file. Their narrower statement is the accurate one: nothing they serve is an April view any more; the ADP-free PPG core is preseason-static **by design** (all 58 features are prior-season, combine, draft and age, so they cannot move between two August days), while ADP and depth-chart shares move daily. **THE RE-BAKE IS WANTED AND IS BEING HELD**, on a finding of ours that the diff doesn't show: `ppg` is projected points / projected **GAMES**, so a backup with a small denominator scores at a starter's rate. Nick Mullens comes back at **21.0 — above Lamar Jackson (16.6) and Mahomes (16.5)** — and Joe Milton III at 19.0 where the April bake has him at 2.6. The proof it is an artifact rather than a claim is that it happens **within a team**: `get_weekly_projections` week 1 puts Mullens (19.6) over his own starter Trevor Lawrence, Trey Lance (19.9) over Herbert (18.6), and Milton (19.3) over Prescott. That is fatal *for this consumer specifically* — this file is not read as a season forecast, `slateAwareProj` ranks a ROSTER to set a weekly lineup (autoSlotPlan, the unmanaged-seat fallback, best-ball fill) — so a straight replace would fix every starter's value and simultaneously teach auto-slot to bench Lamar Jackson for a backup. Staleness misprices a lineup; this would MIS-SET one, which is worse. Unblocked by either a projected-games field (filter, or multiply back to a season total) or a starter/depth-chart flag; asked for. The blocker and the evidence are now written into `proj2026.ts`'s own refresh note, because the note previously said "just re-pull" and would have walked the next session straight into it. Their offer to document the preseason-static PPG core in `get_metadata` is worth taking — it is exactly the confusion I fell into.

2026-08-19 — **A LIVE ADP, AND THE 12MB TURNED OUT TO BE 201KB** (`v0.306.1`, migration 0203, core + worker + both hosts): "let's do 1, but investigate why it's 12MB. Should be the data we actually need is smaller." Right on both counts. **THE SIZE, TAKEN APART.** (1) **12MB was the DECOMPRESSED figure** — my `curl` measurement sent no `accept-encoding`, while Node's `fetch` gzips by default, so the wire cost was always **2.8MB**, not 12. (2) **91.4% of the payload is `stats`** — 57 entries per player, weekly and projected, none of which the poller reads. ESPN's `x-fantasy-filter` narrows them: asking for full-season (`splitTypeIds:[0]`) REAL (`sourceIds:[0]`) stats takes 57 entries down to 2 and the response to **201KB on the wire** — 14× off the gzipped size, 60× off the number I quoted, and *smaller than the ownership-only view* v0.306.0 was already calling. So one lean call now carries ADP and ownership together where two calls carried less. A nonexistent split type (99) zeroes the stats entirely at 151KB, and was **rejected on purpose**: it works by matching nothing rather than by asking for something, so it breaks the day ESPN validates the value, and 50KB is not worth resting on undefined behaviour. **THE LIVE ADP.** `player_market.adp` is filled, `league_market` serves both maps in one call behind the same freshness gate (they come from one pull, so one being current and the other not is not a state that exists), and the four sort sites from v0.302.0 swapped one call for one call. **It OVERLAYS the bake rather than replacing it** — `setLiveAdp` in `poolSort`, same module-cache shape as every other per-league engine install — because `adp2026.ts` is a consensus blend and the feed is ESPN's own draft rooms, ~13 picks apart at the median: a player the feed doesn't price, or every player when the feed is stale, keeps the consensus number. A failed poll costs freshness, never the column. New parity cases pin exactly that (feed wins where it prices, bake answers elsewhere, an EMPTY feed is not a feed, a live ADP genuinely reorders the list) and the market suite grew the 0203 half (both maps from one call, ADP absent rather than zero for an unpriced player, a stale feed returning nothing rather than a frozen number). Full battery green; no APK yet.

2026-08-19 — **REAL OWNERSHIP, FROM THE MARKET INSTEAD OF FROM OUR OWN TWO LEAGUES** (`v0.306.0`, migration 0202, worker + SQL): chasing the ADP half of "refresh ADP and rosters and injury status several times a day" turned up a **correction to my own premise**, and a better answer than the one that was picked. **StatHead's ADP is not first-party** — its metadata names the ADP sources as **FFC and ESPN**, and `get_adp` describes itself as a blend of FantasyPros + Sleeper + FFC. So "buy a StatHead key to get the exact blend" was the wrong recommendation: two of its four inputs are hosts this worker already polls. **ESPN publishes ADP *and* ownership free**, on `lm-api-reads.fantasy.espn.com`, and — unlike FFC and stathead.app, both of which the dev sandbox blocks — it is reachable here, so it can be verified before shipping rather than after. Verified: 400 priced players, **367 resolving to slugs** (33 unresolved, all team D/ST, which the pool carries through its own K/DST path). **THE TWO HALVES SPLIT CLEANLY, so only one shipped.** Ownership rides the LIGHT `players_wl` view — **105KB**; ADP needs `kona_player_info` at **12MB**, 115× the bytes for the same 400 players. And the cost is the smaller objection: measured against the baked consensus, **ESPN's ADP sits ~13 picks away at the median**, because it is ESPN's draft rooms rather than the blend. Re-pointing the draft board onto another market is a decision about the product, not a data refresh — so `player_market.adp` exists, is deliberately left NULL, and the poller does not touch it. **What shipped is the ownership number the founder asked for in v0.302.0, done properly.** That version answered with the only figure the platform had — the share of ITS OWN drafted leagues rostering a player — which is honest and nearly meaningless at this size: one league of two reads 50%. `player_ownership` now serves ESPN's real percentage when the feed is fresh, **alone rather than blended**, because a player ESPN doesn't price is genuinely near-zero owned and reviving him at "50%, from one of our two leagues" would put a louder wrong number beside a quieter right one. A feed that has never run, or has gone stale past 7 days, falls back to 0199's count — the app degrades to what it did before rather than to a frozen number. No client change at all: the four sort sites from v0.302.0 call the same RPC and get a better answer. New `market-probes.sql` (52nd suite): the legacy answer with no market, the market answering alone when fresh, an unpriced player staying absent rather than blended, a stale feed falling back, and a non-member refused. Full battery green; no APK (worker + SQL only).

2026-08-19 — **ROSTERS AND INJURIES REFRESH SEVERAL TIMES A DAY** (`v0.305.0`, no migration, worker only): "we want to refresh ADP and rosters and injury status several times a day." Two of the three shipped; the third has no feed the worker can reach and is written up below. **INJURIES** were a flat 24h off-days (1h near games), so a Wednesday practice report could be a day old when a manager set a Thursday lineup: **3h off-days now**, game-day cadence unchanged. **ROSTERS** had a live path since 0142 — `syncTeamOverrides` diffs Sleeper's directory against the baked `playerBio.ts` and publishes the drift — but no cadence worth the name, because that directory is **14MB** and Sleeper asks for at most one pull a day, so the whole team map moved once every twenty-four hours. Cut-down week does not work like that. The two questions now get two feeds: **who exists** (Sleeper's directory, still daily, and it is the slug index the whole engine keys on) and **where does he play** (ESPN's 32 team rosters, every 3h, ~3,000 athletes across small fetches already inside this worker's ESPN budget, resolved by **ESPN athlete id** — the bridge the player index was built around because names drift and ids don't). Both write through one extracted `reconcileTeamOverrides`, so they cannot disagree about what the table means, only about how recently they looked. **THE SWEEP IS ADDITIVE ONLY, and a dry run against the live feed is why.** The tempting reading of a 32-team census is "anyone I didn't see was cut" — and `playerBio.ts` is a **5,363-player HISTORICAL directory**, most of whom haven't been on a roster in years, so that reading would have written ~4,000 free-agent rows into a table whose design note says "dozens to a few hundred" and declared most of the league released. Each feed is now trusted for what it is good at: ESPN makes the POSITIVE statement (this player is on this club today — the fact that actually moves in August), and deciding somebody is on NO team needs the whole universe, which is the daily Sleeper pass's job. Cost, named: a released player keeps his old club on screen for up to a day. **Measured before shipping**, against all 32 live rosters and a real Sleeper directory: 32/32 teams, 3,010 athletes, **0.4% unresolved**, 1,869 resolving to a baked slug, and **109 override rows** — squarely in the documented band, with real drift in it (Za'Darius Smith CLE→ATL, Keenan Allen FA→IND, Jaylon Moore FA→KC). Every interval is env-overridable (`INJURY_POLL_MS_DAILY`, `ROSTER_POLL_MS`, `DIRECTORY_REFRESH_MS`). **ADP IS NOT DONE AND CANNOT BE YET:** it is a BAKED constant (`adp2026.ts`), the worker has no ADP source and no StatHead HTTP credentials — StatHead reaches this project only through the MCP, i.e. through a session — and the obvious public feed (FantasyFootballCalculator, already one of the three inputs to the consensus blend) is blocked from the dev sandbox, so it cannot be verified here before shipping a poller against it. Needs a founder decision on the source. Full battery green; no APK (worker only).

2026-08-19 — **ADP RE-BAKED SIX WEEKS FORWARD** (`v0.304.0`, no migration, data only): the draft pool's consensus ADP was as-of **2026-07-07** — before a single preseason snap — and everything that ranks a player reads it: the draft board's default order, the new ADP sort (v0.302.0), the waiver wire, the keeper top-N default at the next reseed. Re-pulled from the Stathead MCP: **FantasyPros 2026-08-14 · Sleeper 2026-08-19 · FFC 2026-08-18**, 200 priced players, all 200 parsing to engine slugs. **`proj2026.ts` was checked and deliberately NOT touched** — StatHead still serves the same 416-row bake at the same model snapshot (veterans 2026-04-12, rookies 2026-05-08), verified head, tail and eight sampled rows across the range against what is stored, so a re-bake would have changed nothing but the pulled-on date. The projection join actually improved slightly (9 unjoined ADP names → 8). **What preseason did to the board:** thirteen players entered the priced pool (Cooper Kupp, Aaron Rodgers, Tank Dell, Rashod Bateman, Fernando Mendoza, Zachariah Branch…) and thirteen left it (Tyreek Hill, Brandon Aiyuk, David Njoku, Trey Benson, Cade Otton…). Biggest risers: **Stefon Diggs 148.8 → 106.0**, Deebo Samuel 171.0 → 128.8, Jonathon Brooks 147.0 → 111.8. Biggest faller by a distance: **Ricky Pearsall 102.5 → 200.4**, then James Conner 155.7 → 195.2. Jeremiyah Love, the rookie the header quotes as the market's price on the class, drifted 26.5 → 31.5. Full battery green.

2026-08-19 — **THE BOARD'S COLUMNS HOLD STILL · A SPOT CAN BE RENAMED AFTER THE DRAFT** (`v0.303.2`, migration 0201, both hosts): two founder reports off one screenshot. **(1) "Bestball middle text is not aligned with non bestball."** Two causes, one symptom. On the APP the ⇄ swap chip rendered only on a SETTABLE spot — and a best-ball spot is never settable — so that row lost the chip's width and every column after it slid across; the chip's box is now always there, sometimes empty. On BOTH hosts the centre column was `auto`/unsized, so each row sized its own middle to its own label: "Rookie BB" and "FLEX (RB/WR/TE)" are wider than "RB 1", and since **every row is its own grid**, `auto` could never have agreed across them. The centre is a fixed width now — one constant (`SPOT_COL`) taken by the header, the starters and the bench, so the whole board is one set of columns. **(2) "I changed a starting roster spot label but it didn't take."** It didn't: 0181 froze the lineup spec at the draft and required every surviving spot to be **byte-identical** to what was drafted, and a same-length save was refused before the comparison loop even ran. That freeze is right for everything that DECIDES something — slot names are positional (S1…Sn), so editing a spot's eligibility would silently reassign every saved lineup beneath it — and wrong for the one field that decides nothing. 0174 introduced the label saying exactly that in its own docblock ("PRESENTATION ONLY… a label can never make a spot behave differently than it reads"), then rode the same setter and inherited a freeze with no reason to apply to it. Post-draft the spot comparison now **ignores `label`** and a same-length save is allowed; renaming reassigns nothing, since S3 is S3 whether it reads FLEX or "Nate's Revenge". Positions, best ball, the per-spot filters and the zero-fill are all still frozen exactly as they were — the zero-fill deliberately so, because it decides POINTS. New `rename-spot-probes.sql` (51st suite): the founder's case, clearing a name, every other field still refused, the 0181 shrink still working, a grow still refused, and rename-plus-shrink in one save. Full battery green + APK 30302.

2026-08-19 — **THE WORKER LEARNS GOLF TOO** (`v0.303.1`, no migration, worker only): v0.303.0 shipped golf as a per-league engine install and wired it on both BOARDS — and never wired it in the worker, which is the half that actually writes lineups. `autoSlotClassicLineups` and the seat agents rank through `autoSlotPlan`, and `resolveClassicMatchup`'s best-ball fill ranks through the same module global; with nothing installing it the flag stayed false, so a golf league's unmanaged seats would have been auto-slotted with the HIGHEST-scoring lineup available while the board they sit under previewed the lowest. Two implementations of "best lineup" disagreeing is exactly the failure the parity scripts exist to prevent, and it slipped because they test the ENGINE and nobody had tested the worker's INSTALL. Fixed at the mapper every worker path already goes through — `modeOfSettings` carries `golf` — then installed **unconditionally** in both places, because a module global that is only set when true leaves the previous league's rule standing over the next one (the same isolation rule the `setLeagueScoring` install has carried since v0.277.0), and cleared in a `finally` on the way out of the auto-slot sweep. The new parity case is the one that would have caught it: the flag survives `modeOfSettings`, and defaults to false rather than undefined. Full battery green + APK 30301.

2026-08-19 — **GOLF MODE, AND THE ZERO-FILL RULE** (`v0.303.0`, migration 0200, core + both hosts): "for classic, we need an option for golf mode… any unfilled starting roster spot or any starting roster spot that gets 0 points in a week gets assigned a designated point total (usually 10). These spots can't also be best ball… the second change is that lowest point total wins rather than highest." **TWO SETTINGS, AND THEY ARE INDEPENDENT.** The zero-fill is per SPOT and works in any classic league — a normal league can use it so a forgotten lineup stops scoring nothing. Golf is per LEAGUE and inverts who wins. They are obviously meant for each other (a zero that pays 10 is a penalty only if low is good) but neither needs the other to be coherent, so neither is wired to the other. **(1) THE ZERO-FILL.** Per-spot `zero_pts`, because that is how it was described — a rule you add to each roster spot — and because a league may well want it on the flex and not on the quarterback. It fires on an UNFILLED spot and on one whose player scored nothing, and **nowhere else**; a spot that banks it produces a ROW even with nobody in it, which is why the resolver now walks the SLOTS rather than the picks. **Refused on a best-ball spot** rather than silently stripped — that spot fills itself from whoever is left, so "unfilled" is not a state it has, and storing half of what the commissioner asked for is the worse answer. On a LIVE board the fill waits for the spot to be SETTLED: a player at zero in the second quarter has not scored nothing, he has not scored YET, and paying early would show a total that walks backwards when he catches a pass. An EMPTY spot is settled from the first whistle — nobody is going to play it. **(2) GOLF.** One flag that inverts the meaning of a score everywhere a score is COMPARED: `league_standings` (which result is a win, and the points tiebreak, which now runs the other way), `playoff_winner`, and the consolation `reorder_ladder`. That is the whole server list — **nothing about how a score is MADE changes**: a touchdown is worth what the catalog says and no metric flips sign. What golf also has to invert, and the reason it isn't a two-line change, is **what "best lineup" MEANS**: auto-slot, the unmanaged-seat fallback and best ball all take the LOWEST scorer, or the app would confidently set the losing lineup every week for every seat with no manager in it. Done by re-expressing the VALUE (`golfValue`) rather than rewriting either search, so every caller inherits it and none can forget. **A zero is not a low score, it is an absence** — a bye, a ruled-out player, somebody the projection doesn't know — so it sorts to the BACK of the golf ordering, which is also the case the zero-fill exists to punish. Golf freezes at the draft like the game mode itself: you draft a golf league inside out, so flipping it in week 6 would not be a rule change, it would be a different league played with the wrong rosters. Both boards print **⛳ LOW WINS** between the two totals, because two numbers side by side read as "bigger is winning" in every scoreboard anyone has ever seen. **ALSO FIXED IN PASSING:** the app's `fromSpotDraft` never sent the per-spot `flags` added in v0.301.0 — it collected them, showed them, and dropped them on save; the web twin had carried them all along. New `golf-mode-probes.sql` (50th suite) and a new `check:golf` parity script: the fill fires on empty and on scoreless and nowhere else, is dropped from a best-ball spot, waits for settlement on a live board, and golf inverts the standings, both playoff comparisons and the lineup search while changing not one point of any score. Full battery green + APK 30300.

2026-08-19 — **A TAXI PLAYER STOPS TAKING A BENCH SPOT · THE WIRE ONLY OFFERS PLAYERS THE LEAGUE CAN ROSTER · FOUR WAYS TO ORDER A POOL** (`v0.302.0`, migration 0199, core + both hosts): four founder items off one screen. **(1) "Players on taxi don't count as a bench spot taken."** Every add path has asked ONE question since 0064 — "does this roster hold fewer than `draft.rounds` players?" — because back then a roster had one kind of place. 0164 gave it THREE with three capacities and taught `set_roster_spot` to respect them; it never went back to the add paths. **Reproduced on the scratch DB** (3 starters + 2 bench + 2 taxi + 1 IR, rounds 8): a team with 5 active and 2 on the taxi holds 7 of 8, so it may sign a free agent — who lands ACTIVE, making SIX active players in FIVE seats; and the other way round, which is the founder's exact sentence, **stashing a player on the taxi frees nothing**, because he still counts against the same total the bench is drawn from. So a manager who tidies his roster precisely the way his league is shaped gets no room for having done it. The fix asks about the SEAT the player actually takes: a signing always lands active, so `add_free_agent`, `submit_waiver_claim` and `process_waivers` now check ACTIVE SEATS — starters + bench, counting only `spot = 'active'` — and the taxi and IR keep their own capacities where they always were. **A league with no roster shape is bit-for-bit unchanged**: no shape means no stash places, so its whole roster IS its active seats and it refuses in exactly the words it always used. `roster_illegal_reason` is deliberately untouched — it locks a manager out of transactions entirely, and a draft legitimately fills starters + bench + taxi into active seats, so every team would be locked out the moment its draft ended for the crime of not having stashed yet. Both hosts' `full` flag follows the seats too, off a new `active_seats` in `native_team_state`. **(2) "Default filter waivers by player eligible for the league (no kickers if there is no kicker spot on the roster)."** New `leagueEligiblePos` — the union of what every starting spot accepts, which is the same derivation 0195 gave `league_pos_cap` server-side, kept in step on purpose so the wire never offers a player the signing would refuse. A bench player who can never start anywhere is a player the league has no use for, so the bench doesn't widen the set. The draft room asks the server's own number instead (`pos_caps[p] === 0`), since it has one. **(3) "Allow multiple select in the waiver filters."** Position chips are a multi-select on all four lists (wire and draft room, both hosts); no selection means every position the LEAGUE can roster, and a position it can't isn't offered as a chip at all. **(4) "Sort by ADP and projected points in waivers and draftable players. Sort by ownership % would be good too."** New `poolSort`: **RANK** (the pool's own order, still the default, because it is what the draft clock's autopick follows), **ADP** (ascending), **PROJ** (projected PPR points per game, descending) and **OWN %**. There is no external ownership feed here and there doesn't need to be — this platform HAS leagues, so `player_ownership` counts the share of drafted leagues rostering him, platform-wide rather than league-local, since a percentage that counted only your own twelve teams would read 0% for everyone on the wire, which is the list you wanted to sort. A player the source doesn't know **sorts last in every order**: an unknown ADP is not an ADP of zero and a missing projection is not zero points, and the pool's rank breaks every tie. Each row's leading number becomes whatever the list is sorted BY, so an order is always legible. New `seat-cap-probes.sql` (49th suite): stashing frees a bench seat, a signing that would overfill the seats is refused while the total still has room, dropping a TAXI player frees no bench seat, waivers judge the seat at submit AND at the sweep, an unshaped league is unchanged word-for-word, and ownership counts leagues rather than rosters — plus new parity cases for the eligibility set and all four orders. Full battery green + APK 30200.

2026-08-19 — **THE COMMISSIONER SAYS WHO GOES ON IR — AND THE TAXI RULE FINALLY BITES BEFORE THE TAP** (`v0.301.0`, migration 0198, core + both hosts): "we need to make sure only injured guys can be put on IR (commish chooses eligible tags) and that the commish selected eligibility applies to putting guys in taxi slots." **(1) IR TAKES A DESIGNATION THE LEAGUE CHOSE.** 0164 already refused a healthy player — it wanted `injury_status.status` in `('IR','O')`, hardcoded. That pair is one league's answer: some run a strict season-ending IR (the `IR` tag alone), some let Out ride, a few let Doubtful ride, and none of them should need a migration to say so. `settings_json.ir = { tags: [...] }`, the vocabulary is the injury report's own and nothing else (**O / D / Q / IR** — a tag the feed never emits would be a spot nobody could qualify for), and the default is the pair 0164 hardcoded so a league that never opens the setting is bit-for-bit unchanged. An **empty list is refused**: a league with IR spots and no eligible tag has a place nobody can ever be put, which reads as broken rather than as strict — a commissioner who wants that removes the IR spots. The refusal **names the list and the player's own tag** ("IR is for players designated IR/O — this one is D"), because "not eligible" on its own sends a manager to the settings page to find out what is. **No commissioner exemption here**, deliberately unlike the taxi lock: the lock is a DEADLINE, and someone has to be able to fix a mistake after it; this is a fact about the player, and it is just as true on the commissioner's own roster. **(2) AND THE RULES NOW BITE BEFORE THE TAP.** 0196 gave the taxi squad its tenure ceiling and enforced it in `set_roster_spot` — but **no screen had ever read `roster_rules`**, so both hosts offered "→ TX" on every name and the rule only appeared as a red error afterwards. That is the founder's second clause, and the fix is one reader: `roster_rules` carries `ir_tags` beside `taxi_max_exp`/`taxi_locked_now`, and the stash picker on both hosts now **greys the ineligible rows and prints the server's own sentence under each one** — same wording, because the server is still the authority and a screen that disagreed with it would be worse than one that stayed quiet. Ineligible names stay VISIBLE rather than vanishing: "why isn't he in the list" is a worse question than "why is he greyed out". The IR picker also shows each player's current designation beside his name. New `injuryTags()` reads the report as a plain slug→tag map rather than through the week-keyed module cache — a roster screen isn't showing a week, and borrowing that cache would let opening a roster clobber the week a live board had installed. New `ir-eligibility-probes.sql` (48th suite): the default pair, a healthy player refused with the list named, the commissioner narrowing it (a previously-eligible Out player refused) and widening it (Questionable qualifies), an empty list and a bogus tag both refused, duplicates collapsing, the commissioner's own roster held to the same rule, and `roster_rules` carrying the list. Full battery green + APK 30100.

2026-08-19 — **THE MATCHUP-BOARD SWIPE ACTUALLY FIRES ON A PHONE** (`v0.300.1`, no migration, app only): "can we do swipe to go to the next week in the matchup board?" — it shipped in v0.299.1 and **didn't work on the app**, which is the same report. The handlers were spread onto the `ScrollView` itself, and that is a fight the JS responder loses: Android's native scroll view intercepts the drag before the ScrollView's own responder props are ever consulted, so a horizontal flick did nothing while the arrows beside the week label worked fine. They now ride a **wrapper `View` and claim on CAPTURE** — a parent that captures is asked first, and it only ever says yes to a gesture the existing guard has already proved horizontal (20px across, and twice as far across as down), so a vertical scroll still reaches the list untouched. The web board was never affected: React touch handlers on the root element see events bubbling up from every child. Note the swipe lives on the CLASSIC board — a drip league's matchup screen has no week navigation at all yet, arrows or otherwise. Full battery green + APK 30001.

2026-08-19 — **A SCOPED BONUS LEARNS TWO NEW SCOPES: THE SPOT AND THE FLAG — AND A CLASSIC LEAGUE'S ADJUSTMENTS BECOME NOTHING ELSE** (`v0.300.0`, migration 0197, core + both hosts): four founder notes that turn out to be one subsystem. **(1) "Adjustments for classic leagues need to be just the scoped bonuses."** The three global knobs — TD BONUS, YARDAGE MULTIPLIER, TURNOVER PENALTY — are DRIP-side layering over a base the findings tuned and the catalog quotes verbatim; a classic league doesn't have that base, it has a **catalog it edits itself** on the six tabs beside this one. So a TD bonus here was a second TD bonus, silently doubling `passTd`/`rushTd`/`recTd` from a screen that never mentioned them, and a yardage multiplier was a second per-yard rate. Both hosts hide all three in classic and the panel opens on the bonuses. Drip is untouched: they are the only scoring controls it has. **(2) "Let's also allow scoped bonuses to apply to each/any of the starting roster positions as a rule."** A scoped rule could name a position, a team, a tenure — all facts about the PLAYER. `slot` is the first scope that is a fact about the LINEUP: "the FLEX scores ×1.5" is true of whoever fills it, and stops being true the week he's started somewhere else. Slot ids are the league's own builder rows (`S1…Sn`), so the editor prints the commissioner's own spot names and the rule survives a rename. **A spot rule only pays when the caller says which spot is being scored** — `classicPoints(player, week, sc, scoreAs, slot?)` threads it, the lineup resolver and best-ball fill pass it, and a screen that scores a player OUTSIDE a lineup (a player card, a projection) passes nothing and the rule stands aside. Paying it there would make the card disagree with the board that actually fields him, which is the one number a manager checks twice. **(3) "We also want scoped bonuses for flags."** Flags have carried their own ×/+ rules since 0144 — but only one flag at a time, typed into each flag. The other direction is one rule that pays every player wearing a label, matched **case-insensitively on the label** because the label is what the commissioner typed and what the league reads. Read lazily inside the match loop: most leagues flag nobody, and this runs per play. **(4) "Allow flags as a condition for position filters."** The spot-level twin: a spot filter (0172 — teams, tenure window) now also takes FLAGS, so "a spot only your franchise tag may stand in" is expressible. Same no-guess rule the tenure window follows — a player with no id has no flag to read and so cannot prove he qualifies, and an unflagged league lets nobody into a flag-only spot rather than everybody. 0197 re-issues `sanitize_scoped_rules` (slot ids uppercased and bounded at 20; flag labels **trimmed, not uppercased**, bounded at 12 — the label is presentation) and `set_league_classic_slots` (per-spot `flags`, ≤8, ≤24 chars, deduped case-insensitively). New `scoped-scope-probes.sql` (47th suite) plus new cases in both parity scripts: a spot rule pays in its spot and nowhere else and nothing at all outside a lineup, scopes still AND, a flag rule finds the flagged player through a differently-cased label and misses everyone else, and a flag-only spot refuses the unflagged, the id-less, and the wrong label. Full battery green + APK 30000.

2026-08-19 — **THE MATCHUP BOARD WALKS THE SEASON, AND A ROOKIE STOPS WEARING SOMEBODY ELSE'S 2025** (`v0.299.1`, no migration, both hosts): four founder notes off one screen. **(1) "We don't need the classic, week 1, full ppr line."** The game mode and the PPR setting are LEAGUE SETTINGS — set once, read on the league page — not facts about the game in front of you. Gone; the WEEK survived, and earns its place by becoming the control that moves you through the season. **(2) "We also don't need the lock reminder or time."** Every spot already prints its own kickoff on its own row, which is where the answer belongs since 0178 made locking per-spot; a second countdown in the middle of the scoreboard was the same fact, further from the thing it was about. `LIVE` stays — that is the game's STATE, not a reminder. **(3) WEEK NAVIGATION, ARROWS AND SWIPE.** `‹ WEEK 3 ›` in the header, and a swipe anywhere on the board (left goes forward, the way pages move under a thumb). The far end is the league's OWN last regular-season week — `playoff_start_week − 1`, read rather than assumed, because 14 is a default and not a rule — and until that read lands the forward arrow won't offer a week the board can't fill, since `myMatchup` for a week with no game returns nothing and the screen would empty. The web reads raw touch events with a distance-and-angle guard; the app uses a PanResponder that only CLAIMS a gesture 20px across and twice as horizontal as vertical, so scrolling a long board is never read as a week change. **(4) "We also need any injury designations on players in the matchup view."** The board renders `e.injury` and always has — but **nothing on this screen had ever loaded the live report**. `injuryFor` was answering out of the BAKED 2025 map, which is why exactly one player wore a Q (McCaffrey, questionable in week 1 of *last* season) and nobody else wore anything. Both boards now load `loadLiveInjuries(week)` and bump a version, the same module-cache-plus-signal shape the live plays and flags already use. **AND THE ROOKIE'S 2025 STAT LINE** — "why does a rookie have a 2025 stat line?" — is the same class of bug from the other end: `statsForName` matches the bake BY NAME, so a 2026 rookie sharing a name with last year's player inherits his season (the founder's C. Allen, a KC rookie out of Cincinnati, wearing somebody else's 14 games). **Experience settles it**: a player in his first NFL season cannot have played in the one before, so a rookie gets `NO_SEASON` and his GAME LOG isn't even fetched — it is keyed by a slug built from the same name. Position already disambiguates the famous collision (Josh Allen QB vs Josh Allen LB); this is the one it can't. Full battery green + APK 29901.

2026-08-19 — **THE TAXI SQUAD GETS ITS RULES · DYNASTY DROPS THE KEEPER TAB · THE ROOKIE FILTER STOPS DRAFTING KICKERS** (`v0.299.0`, migration 0196, core + both hosts): three founder items. **(1) THE TAXI SQUAD.** 0164 gave it a SIZE and nothing else: any player could ride it, forever. That is not what a taxi squad is anywhere it is played. Two settings now, both the commissioner's: a **tenure ceiling** (`max_exp` — 0 is rookies only, 1 is first-and-second-year, null is anyone) and a **lock** at the season's first kickoff, default ON. **The lock bites on ADDING only** — taking a player OFF is always allowed, which is the whole point of having him there — and **the commissioner moves players either way whenever they like**, which is how a mistake gets fixed after the gate comes down. Both settings are editable AT ANY TIME, deliberately unlike the roster shape (which freezes at the draft): a commissioner reopening the taxi in November is answering a November question. **Week 1's first kickoff needed no new data** — `matchup.lock_at` has been the week's first kickoff since 0001, so the lock time is the earliest of them for week 1, and a league with no schedule has no lock. A player whose experience Sleeper doesn't know is refused, the same answer 0171/0172's tenure filters give: unknown cannot prove it qualifies. **(2) "I still have keeper in 'my team' in my dynasty team. No need for that, you keep everyone."** Right — v0.296.5 gated the KEEPERS tab on `keeper_count > 0`, and a dynasty league DERIVES a nonzero count (roster − rookie rounds), so it drew. Declaring keepers is a KEEPER-league act; a dynasty keeps everyone and has nothing to declare. Tab and card both gone for `continuity = 'dynasty'`, on both hosts. **(3) "The rookie filter is picking up kickers and def."** K / D-ST / HC / P are TEAM-KEYED pseudo-players — one per club, with no person behind them and so no tenure at all — and the pool builder applied the tenure window to real players only, then appended them unconditionally. A tenure window is a statement about PEOPLE, and an entry that cannot answer it does not belong in the answer; a filtered pool drops them now, an unfiltered one still gets all 32. New `taxi-rules-probes.sql` (46th suite): the ceiling bites (veteran refused, rookie rides, unknown refused, and the refusal says how many years he has), the lock shuts at kickoff and refuses ADDS while still allowing removals, the commissioner is never locked out, a league that turns the lock off never shuts, and -1 clears the ceiling. Full battery green + APK 29900.

2026-08-19 — **EDIT ANY PICK · A LEAGUE WITH NO KICKER SPOT DOESN'T DRAFT ONE · CLASSIC DROPS THE COIN** (`v0.298.0`, migrations 0194 + 0195, core + both hosts): three founder reports. **(1) "I need to be able to click on a pick that was made and remove it or replace it with another available player."** What existed was `commish_undo_pick` (0067), which unwinds the LAST pick — the right tool for "the room got ahead of itself" and the wrong one for "round 3, pick 5 went to the wrong player", which it could only reach by unwinding every pick made since and re-making them by hand. `commish_edit_pick` addresses a pick BY ITS OVERALL: **remove** empties the cell and hands the player back to the pool, **replace** swaps him in place. Neither renumbers the board or moves the clock — the picks around it belong to the teams that made them, and a draft that shuffled up to close a gap would take somebody else's player to do it. Position limits are re-checked on a replace, counting the outgoing player as already gone (0071's `p_exclude_slug` was already there for exactly this), so a QB-for-QB swap is legal in a one-QB league and a refused edit changes nothing. Live or complete, because most of these are noticed after the room empties. On both hosts the BOARD CELL is the door: tap a made pick, get remove (two taps) and a search over the available pool (one tap). **(2) "My auto draft drafted kickers and a def but there were no roster spots for k or def."** Reproduced on the scratch DB in one run, and the cause is a default that predates classic leagues: `league_pos_cap` falls back to **QB 3 / TE 3 / K 1 / DEF 1** when a league sets no explicit limits — the drip game's shape, from 0071, when every league was a drip league. A classic league already SAYS what it plays, in its lineup spec, so the default now reads it: **a position no starting spot accepts defaults to 0**, one the spec accepts is uncapped, and an explicit blob still outranks both. Drip is untouched — its lineup really does have a kicker and a defense in it. Two holes in the same wall went with it: the autopick's **last-resort fallback** ("caps exhausted the board — take the best free player outright") ignored caps entirely, and **zero is a ban, not a small limit**; and the **queue** was a way round the rules, because `native_exec_pick` skips the cap check for AUTO picks on purpose (a hard failure mid-tick would freeze the room) — a queued kicker now gets passed over for the next name down, since a wishlist is not a rule change. Also, while re-issuing the autopick: its capped query had **no branch for the enabled extras** (IDP/FB/HC/P), so an IDP league could only reach a defender through that same rank-only fallback. **(3) "Classic leagues won't use power ups so they don't need that on the league menu. They don't need drip coin either."** ◈ POWER-UPS and ◈ DRIP COIN leave a classic league's commissioner map on both hosts — coin exists to buy power-ups, and a classic league has neither. Two new probe suites (44th and 45th): `edit-pick-probes.sql` (replace in place, remove without renumbering, the cap check discounting the outgoing player, and every wrong turn refused) and `pos-default-probes.sql` (the derivation both ways, drip's defaults intact, a top-RANKED kicker going undrafted through a full autodraft, and a queued ban passed over). Full battery green + APK 29800.

2026-08-19 — **THE SHEET WAS ON TOP OF THE THINGS IT OPENS** (`v0.297.2`, no migration, web only): founder — "manage flags and write note don't do anything." They did: they opened, painted UNDERNEATH, and were never seen. v0.296.3's `Sheet` took `zIndex: 80`, and the web's modal layer — `ModalBackdrop`'s default — is **70**. Everything a destination opens from inside a sheet lives there: the ⚑ kit's note editor and flag manager, the avatar picker, the confirms. A container that outranks its own contents is a container that eats every click inside it. The Sheet is **60** now: below the modal layer, above the page (the sticky header is 40, the install prompt 58), and portaled last so it still wins against the two other things that say 60. The layering is written down in the component this time, because the next person to reach for a bigger number will be reaching for exactly the bug that is being fixed. Full battery green; web-only, so no APK.

2026-08-19 — **IR IS A SPOT, NOT A ROUND — AND TWO THINGS THAT BROKE AROUND IT** (`v0.297.1`, migration 0193, core + both hosts): three founder reports from one sitting. **(1) "IR spots shouldn't add rounds to your draft."** Right, and the schema already knew how to make the distinction: 0182 drew it for KEEPERS, where `draft.rounds` is the ROSTER (what a team may hold) and `keeper_slots` is how many of those spots arrive pre-filled, so the draft runs `rounds − keeper_slots` picks. **An IR spot is the same shape of thing from the other end** — a spot the roster has and the draft must not fill, because you don't draft an injured-reserve player, you stash one there in November. So `stash_slots` joins `keeper_slots` and every place that asks *how long is this draft* subtracts both: `native_exec_pick`'s completion, `draft_state`'s reported rounds, `_start_draft_now`'s pick count and pool check, and the startup pick assets. **Capacity deliberately does not move**: `roster_cap` is still `draft.rounds`, active seats are still starters + bench, the taxi and IR caps are still their own — a team holds exactly what it held yesterday and simply stops drafting into the IR spots. **The auction came along for free and got a pre-existing wrinkle straightened**: every call site passed `d.rounds` into `auction_spots_left`, so "how many spots to fill" was the CALLER's opinion; it derives from the draft row now, which fixes seven call sites at once. Keepers are NOT subtracted there, and that isn't an oversight — a keeper already occupies a `native_roster` row, so subtracting the count too would charge the seat twice. Pending drafts are backfilled from their league's shape; live and complete ones are untouched, because a draft whose length changed underneath it is a worse bug than the one being fixed. **(2) "Roster size doesn't adjust when I change the roster spots above."** The ROSTER destination draws two editors — the lineup BUILDER and the roster RULES — and the size in the second is DERIVED from the first, but they are separate components with separate loads, so the builder changed the answer and the rules panel went on printing what it read on mount. New settings channel on `rosterBus` (same idea as v0.285.0's roster notice, one level up): the builder says a setting moved, the rules panel re-reads. **(3) "The spots don't drag and drop anymore. The window just scrolls."** MY REGRESSION, and an old bug it exposed: the builder used HTML5 drag (`draggable` + dragstart/drop), which **a touch screen never fires** — the finger scrolled the page instead, and once v0.296.3 made that panel a scrolling SHEET, scrolling was all it could look like. Rewritten on POINTER events, which cover mouse, pen and touch in one path, with `touchAction: 'none'` on the handle so the browser can't claim the gesture for a scroll and pointer capture so the moves keep arriving when the finger leaves the handle. The list reorders LIVE under the finger, so there is no drop target to aim at. New `ir-rounds-probes.sql` (43rd suite): the roster keeps counting IR while the draft doesn't, `draft_state` says both numbers AND the stash that explains the gap, a 2-team league with 4 starters / 3 bench / 1 taxi / 2 IR drafts exactly 16 picks and completes, the roster cap is still the full 10, and an all-IR shape is refused. Full battery green + APK 29701.

2026-08-19 — **THE ROSTER CAP WAS ARBITRARY; THE POOL WAS NOT** (`v0.297.0`, migration 0192, core + both hosts): founder, blocked at 10 starters + 11 bench + 5 taxi — "I can't add any more bench, taxi or spots. do we have a max?" then "any reason to actually have a max? I'd say 99 if a max is needed." **There was a max, and it had no argument behind it**: `draft.rounds check (rounds between 5 and 25)` since 0064 — a sanity bound on a table that had quietly become the ceiling on how big a roster a league may run. A dynasty with a taxi squad wants 30–40 spots; every one of them hit a wall the game had no reason to build. Now 5–99, in the table's own constraint and in every function that re-validates it (`create_native_league`, `set_roster_rules`, `set_league_roster_shape`, `_provision_startup_picks`, and `pick_asset`'s round check, which 0190 had only just moved to 25). **The per-field ceilings went too** — bench 20 / taxi 8 / IR 8 CLAMPED silently, which is its own small lie, and the total was always the rule that mattered; both hosts' ＋ now stops on the SUM and says so. **THE REAL CONSTRAINT IS THE PLAYER POOL**, and here I was wrong before I read the code: I told the founder nothing checked it. Something did — `_start_draft_now` has compared `total_picks` against the unrostered pool since 0064 and refused with "pool smaller than the draft". What that message could not do is tell you what to change: at 25 rounds it was a nudge, at 99 it has to say whether to trim one round or forty. It now names the arithmetic — *needs 120 picks (60 rounds × 2 teams), pool holds 50* — and the check stays exactly where it was, after `total_picks`, because that value already accounts for the owned-picks path (0183/0190). Nothing else moved. **The suites caught the deliberate changes**, which is what they are for: `taxi-ir`'s tx6 asserted the string "5–25 rounds" and `dynasty`'s dy16d asserted "pool smaller" — the first updated to the new bound, the second kept passing because the richer message still opens with the phrase it always did. New `roster-size-probes.sql` (42nd suite): 40 rounds creatable, 99 the edge, 100 refused, a 40/12/10 shape stored rather than clamped, a shape over the total refused rather than trimmed, and a draft bigger than its pool refused AT THE DOOR in numbers and then starting once the pool covers it. Full battery green + APK 29700. **Migration 0192 applies to the live database on merge** (the pipeline runs it).

2026-08-19 — **A NEW LEAGUE LANDS ON ITS ROSTER SETTINGS** (`v0.296.6`, no migration, web + app): founder — "after you create a league, you should go to the roster settings so the draft can reflect the correct number and type of positions." Both hosts used to land on the DRAFT: the web on the commissioner console's ⛏ DRAFT tab, the app on the leagues list with a success note and nothing opened at all. **The draft drafts the roster the league is SHAPED for**, and both the shape and the draft freeze the moment it starts — so the shape is the first screen, and the draft room is one destination away. Web: `manageTab` 'draft' → 'lineup' (🧢 ROSTER), which with v0.296.3's `openSection` means a phone opens straight into the sheet. App: the create flow had no way to open the league it had just made — `Recruit` sits under the BOARD view and cannot reach `setOpen` — so it grew an `onCreated` callback, `CommishTools` grew `initialSection`, and App.tsx carries a ONE-SHOT section hint cleared on the way out, because a commissioner who did NOT just create a league wants the map. Full battery green + APK 29606.

2026-08-18 — **MY TEAM GETS THE APP'S TABS, AND KEEPERS GETS ITS OWN** (`v0.296.5`, no migration, web + app): founder — "in my team in the mobile web, let's make roster, waivers, trades tabs like in the app, and the notification settings can get removed because they are already in the league home tab. Let's make sure keepers are only available for keeper leagues and they should get their own tab in my team." **THE TABS**: the web's MY TEAM was one long scroll of everything — two columns wide on a desktop, a mile deep on a phone. The app has been tabbed since v0.268.0 on the founder's own instruction ("default to roster but all the other areas need to be tabbed"), so this is the web catching up: 🧢 ROSTER (default) · ✚ WAIVERS (with the pending-claim count) · ⇄ TRADES, with **identity and the over-limit warning staying ABOVE the tabs** — who you are and what's broken outrank any tab you happen to be standing in, which is the app's rule too. Inside WAIVERS the wire and the order sit side by side on a desktop and stack on a phone. **`focus` NOW PICKS A TAB** rather than scrolling to a section: 0182's league-home deep link always meant "take me to this destination", and a tab is a destination — the three `scrollIntoView` refs are gone with it. **THE NOTIFICATION SETTINGS ARE GONE** from both of this screen's branches (pre-draft and full): 🔔 Alerts has been a tile on the league menu on both hosts since v0.287.0, the app has never carried a second copy on MY TEAM, and two editors for one set of per-device prefs is one too many. **KEEPERS IS A FOURTH TAB, ON BOTH HOSTS** — it was a card under the roster, which is where you look for it in the two weeks a year it matters and where it is noise for the other fifty. **And the tab only exists where the league keeps anyone**: gated on `keeper_state.keeper_count > 0`, which is exactly the question — 0185's `_apply_continuity` DELETES `keeper_count` for a redraft league, sets it for a keeper one, and derives it as `rounds − rookie_rounds` for a dynasty. The card already hid itself the same way; a tab that opens onto nothing is worse than a tab that isn't there. Full battery green + APK 29605.

2026-08-18 — **THE THIRD DOOR OUT OF THE COMMISSIONER'S CONSOLE** (`v0.296.4`, no migration, web only): founder, with a screenshot — "we don't need this extra all leagues link below the leagues and matchup chip." Correct: the console opened with `← all leagues` directly under the league strip, and TWO other ways out already sat above it — the shell header's `← my leagues`, which renders on every view except home, and the strip's own 🏠 LEAGUE chip. Three doors in one square inch of screen, and the one in the middle was the one nobody needed. Gone. **The one at the FOOT of the page stays**: after scrolling a console this long the way out is genuinely far away, and that link is the answer to a different question than the two at the top. Full battery green; web-only, so no APK.

2026-08-18 — **THE WEB ANSWERS A TAP THE WAY THE APP DOES: A POPUP** (`v0.296.3`, no migration, web only): founder — "do the same with commish settings. Some of the items expand like scoring setting and teams and rosters. Let's stick with the pop up for all the items where we have that in the app." Two surfaces, one rule. **THE RULE**: every one of these selections is an `Overlay` on the app — the thing you picked arrives over the page you picked it from, and dismissing puts you back exactly where you were. The web had been answering the same selections by EXPANDING a panel *somewhere in the page*, which is a different interaction wearing the same menu: the menu moves under your finger, the page grows, and (before v0.296.2) the panel could land below the fold entirely. New `Sheet` in `app/ui.tsx` — `ModalBackdrop` + a capped card, header sizes to content, **body is the only child allowed to shrink** (the app's own sheet rule, arrived at the same way), wide content scrolling INSIDE it so the page behind never scrolls sideways, Escape to close. A centred card rather than a bottom sheet, deliberately: the sheet is the phone's gesture language — a thumb at the bottom edge, a drag to throw it away — and the web has neither the thumb nor the expectation; what the founder asked for is *over the page, one dismiss from gone*, and this is that with the desktop's manners. **THE LEAGUE HUB**: teams & rosters, register, scoring, roster settings, alerts and recruit are now sheets, carrying the app's own titles and subtitles so the same room is announced the same way on both hosts. Each panel grew a `bare` mode, because a bordered box inside a bordered card is two frames around one picture — the app's sheets hold the CONTENT, not a card of it — and the register's internal 460px scroll box goes with it, since the sheet is what scrolls now. **THE COMMISSIONER'S CONSOLE**: on a phone the map used to be a SWAP — the hub of destinations OR one destination, with a "⊞ ALL SETTINGS" button to get back — which is the exact thing the app's commissioner map was written not to do. The map now stays put and the destination pops up over it. Desktop keeps its rail-beside-panel: that layout was the founder's own "big version for desktop", and these are editors with wide tables rather than the hub's reference sheets. **One bug found while wiring it**: `sectionOpen` couldn't be derived from `defaultTab`, because CommishDash passes `defaultTab ?? 'members'` — always truthy — so every phone visit would have opened straight into SEATS instead of the map (which is, in fact, what the old `showHub` rule had been doing since v0.259.0, quietly defeating its own hub-first intent). A separate `openSection` prop now carries "the caller meant a destination" — true only post-create, landing in the draft room. Full battery green; web-only, so no APK.

2026-08-18 — **THE WEB'S LEAGUE MENU IS NOW THE APP'S LEAGUE MENU** (`v0.296.2`, no migration, web only): founder — "using the app as the standard, let's match the mobile web league page menu and selection locations to the app." v0.287.0 mirrored the app's LAYOUT (two bands, same tile idiom) but left the web carrying three things the app doesn't, all of them above the heading. **(1) A THIS WEEK LINE** — week, opponent, and a LIVE flag — the residue of the matchup tile after v0.288.0 took the tile itself. **(2) A "YOUR WEEK" BAND** over what was, after that trim, mostly one tile. **(3) TILES FOR TRADES / WAIVERS / TEAM OPTIONS**, which on the web are not destinations at all: `onTeam(focus)` scrolls to a SECTION of the team page, and the team page is a chip on the strip above this menu. That is the founder's own v0.275.0 rule — *a menu that repeats the strip is a menu you have to read twice* — and it is exactly why the app's menu holds only the shop up there: the shop has no chip anywhere and spends coin that is yours, not the league's. All three are gone; the waiver badge went with them, because a badge for a room this menu no longer opens is a badge you can't act on. **THE SECOND HALF OF THE ASK WAS "SELECTION LOCATIONS", AND THAT WAS THE REAL BUG.** An opened panel rendered in one stack BELOW the entire menu, so on a phone, tapping SCORING SETTINGS — the fifth tile — put its table nine tiles further down, off-screen: you pressed a thing here and something happened over there, with no scroll and no sign it had worked. The app never has that gap; a tile throws a sheet over the page you are already looking at. Panels now sit **immediately after the tile that opened them**, as a full-width row of the same grid (`gridColumn: 1 / -1`), which puts them under the tile on a phone and under that ROW on desktop rather than squeezing a scoring table into half a column. **One divergence is deliberate and stays**: 🏆 Standings takes the web to the full results page — the app's sheet holds a table and a bracket, the web's page holds those plus every pairing of every week. Same place in the menu, more behind it. The chip strip needed nothing: it already matches the app's chip set and its show-rules exactly. Full battery green; web-only, so no APK.

2026-08-18 — **THE CARD'S FOOTER STOPPED RUNNING OFF THE CARD** (`v0.296.1`, no migration, app only): founder, with a screenshot — "on the app the metric and player labels are off". They were: on a **Small** card the `↻ METRIC · ⇄ PLAYER · ⓘ CARD` row started left of the stock's edge and ran out the right side, under the sealed card beside it. **The card scaled and its footer didn't.** Every other piece of text on the face is sized through `cs(n, scale)` — art, name, team line, metric chip — because the setup board's card sizes (Small 122pt / Medium 146 / Large uncapped) are a WIDTH cap and everything inside has to come down with it. The footer alone was drawn at a fixed 9pt with a fixed 12pt gap, by its caller, which had no idea what size card it was being drawn into: three labels and two gaps came to ~157pt inside 109pt of stock. **The fix is the contract, not a number**: `footer` is now a RENDER PROP that receives the card's scale, because the card is the only thing that knows it, and the labels size themselves with the same `cs()` the card uses. The row also **stretches and wraps** — one line on a Large card, two on a Small one — so the widest single label is the only thing that has to fit, which it always does; and the face got `overflow: 'hidden'` behind that, so nothing the card draws can ever escape the stock again. Full battery green + APK 29601.

2026-08-18 — **THE REST OF THE DRAFT CONTROLS** (`v0.296.0`, migration 0191, core + both hosts): founder's list was seven — trash the draft and start over, back out a pick, force a pick from queue (or best available), assign an NFL player to a pick, put a team on autodraft, let a player's autodraft override a PAUSE, and move teams in and out of draft positions. **FOUR OF THE SEVEN ALREADY EXISTED IN 0067** and are worth naming so nobody rebuilds them: `commish_undo_pick`; `commish_force_pick(league, null)`, whose fallback is *queue first, then best available* — exactly the asked-for behavior; `commish_force_pick(league, slug)`, which has always taken a chosen player and which **nothing had ever called with one**; and `set_autodraft`, which has accepted the COMMISSIONER as well as the seat's owner since the day it shipped. Their gaps were UI, not database, and that is most of what this change is. **ASSIGN IS A MODE, NOT A SECOND BUTTON**: ⚑ turns the PLAYERS list into the on-clock team's board with a banner naming whose pick you are making, because a per-row second button that sometimes drafts for you and sometimes for someone else is a button you cannot read at speed. Three things were genuinely missing. **(1) THERE WAS NO RESET.** A draft that went wrong could be unwound one pick at a time and no other way. `commish_reset_draft` is typed (`RESET`) rather than double-tapped, on 0188's rule — this ends a room for everyone in it. **Keepers survive**: they land on `native_roster` as `acquired='keeper'` BEFORE the draft (0182), so the wipe takes `acquired='draft'` only — a keeper was never drafted and must not be un-drafted. **So do traded picks** (pick ownership is an agreement between two managers, not part of the draft's state) **and every manager's queue** (the wishlist is theirs, not the draft's). **(2) MOVING ONE TEAM MID-DRAFT.** `set_draft_order` (0176) is pending-only and rightly so for a wholesale re-cut; "he joined late, put him at the end" is a different act and has to work with the room running. It **SLIDES, it does not SWAP** — a swap moves a second team nobody asked to move. Picks already made keep their seats; everything from the clock forward follows the new order, which for a league with owned picks (0183/0190) means **rebuilding `pick_owners`** — that list is what `draft_on_clock` reads in preference to the arithmetic, so moving the order without it would look applied and call the old seats. **(3) AUTODRAFT NOW RUNS THROUGH A PAUSE.** `draft_tick` exited its whole loop on `d.paused`, which is right for everyone waiting on a clock and wrong for the seats that explicitly asked not to be waited for: **a pause freezes the clock, and an autodraft seat does not pick because time ran out — it picks because it has standing instructions**. Those picks are now made first, with the deadline put back to null afterwards (`native_exec_pick` sets a fresh one through `draft_deadline`, which knows nothing about pauses) so the clock stays frozen for everyone else. The client's self-driving tick learned the same rule, or a phone-only league's pause would strand its autodraft seats until the worker's next sweep. New `draft-controls-probes.sql` (41st suite): reset keeps keepers and refuses an untyped confirm, moving slides and takes the clock with it, and an autodraft seat picks while paused with the room's clock still frozen. Full battery green + APK 29600. **Migrations 0188–0191 are applied to the live database** — `.github/workflows/migrate.yml` runs every newly-ADDED migration on the merge to `main`, so each shipped with its PR (runs 32180484007, 32182732312, 32184500102, 32186916366, all green). Earlier entries in this file asking for them to be applied by hand were already stale when written.

2026-08-18 — **TRADING AROUND THE DRAFT** (`v0.295.0`, migration 0190, core + both hosts): founder — "a way for players in drafts to trade draft positions and drafted players. Also have mixed trade draft spots and dynasty rookie picks for dynasty startup drafts. Pick trading can be turned on/off by commish", with two design calls chosen on the founder's answers: keep snake, and open trading BEFORE AND DURING the draft. 0183 had already made rookie picks owned, tradeable assets honored on the clock; three things stopped that covering a startup draft. **(1) EVERY TRADE WAITED FOR THE DRAFT.** `propose_trade` opened with `d.status <> 'complete' → 'wait for the draft to finish'` — the one rule that makes in-draft trading impossible by construction. Lifted to pending + live. **(2) OWNED PICKS FORCED LINEAR ROUNDS**, which 0183 chose deliberately and for a good reason (a rookie pick means "round 3, Team X's slot", and snaking relabels it every other round) — true for a rookie draft and wrong for a startup, which snakes and whose managers expect it to. An asset now carries a **kind**, and the owner list walks the snake for `startup` and the linear order for `rookie`. **The load-bearing property, and the probe that guards it: a league that provisions startup slots and trades NONE of them must draft exactly as before** — the owner-list path has to reproduce the plain snake overall-for-overall, or turning the feature on would silently re-shuffle everyone's draft. **(3) ONLY THE FUTURE SEASON WAS TRADEABLE** — `_clean_trade_picks` resolved every pick against `_future_pick_season`, so the draft in front of you was the one draft whose picks you couldn't deal. Both seasons now resolve, which is also what makes a MIXED offer free: startup slots and rookie futures are rows in one table, so one trade carries both with no new plumbing. **THE GUARDS THE OLD GATE WAS DOING FOR US**, now explicit: a pick already USED is a player (refused), the pick ON THE CLOCK is being spent as we speak (refused), and both are re-checked at EXECUTE, not just propose — an offer made three picks ago can be accepted after the clock has passed the very pick it moves. And an executed trade now moves `draft.pick_owners`, not just `pick_asset`: that list is the draft's frozen copy and `draft_on_clock` reads it in preference to the arithmetic, so moving the asset alone would change who OWNS a pick without changing who gets CALLED for it — the trade would look done and do nothing. **The switch** is `settings_json.pick_trading` (default on): OFF refuses the pick half of any offer and clears startup slots, but only while every one still sits with its original owner — a traded pick is somebody's property and a settings flip must not delete it (0183's `set_rookie_rounds` rule, same question). **An existing probe had to be inverted**, deliberately: `pk15d` asserted "the pending draft's own picks don't trade", which is exactly the restriction this lifts; it now asserts they DO, with a new case proving a nonexistent pick is still refused so the season resolution didn't simply stop checking. New `draft-trading-probes.sql` (40th suite) covers the snake reproduction, the on-clock refusal, a mid-draft trade moving both the asset AND the owner list, and the switch refusing to delete traded property. Full battery green + APK 29500.

2026-08-18 — **THE DRAFT LOTTERY** (`v0.294.0`, migration 0189, core + both hosts): founder — "set draft lottery shares, run draft lottery" (part of a larger draft-controls list; **change order and randomize already existed** — `set_draft_order` (0176) with ▲▼ reordering and 🎲 RANDOMIZE on both hosts since v0.221-era, which is worth knowing before anyone rebuilds them). What that couldn't do is an UNEVEN draw — the thing a dynasty league actually wants, where last year's bottom team holds more balls than the team that nearly won. **SHARES ARE WEIGHTS, NOT PERCENTAGES.** A commissioner thinks "worst team 250, champion 5", not in figures that must total 100 — percentages needing a rebalance every time one changes are a chore and an argument. Any non-negative integers work and the odds are their ratio; the UI prints the resulting % live so the weights stay legible. A share of **zero** is legal and means "in the league, not in the lottery" — those seats fill the remaining slots behind everyone drawn, because a zero share must not mean "excluded from the draft". **THE DRAW IS RECORDED, WHICH IS THE POINT**: `lottery_result` keeps the ordered sequence with each seat's share AND the odds it actually held at the moment it was drawn — not its opening odds, since that is the number people argue about afterwards. 0176 already made this argument about randomising early and visibly ("a random order nobody watched being drawn is indistinguishable from a rigged one"); a weighted draw needs it more, because "the worst team won it again" is a sentence that costs leagues members. `draft_lottery` is readable by any member for the same reason. Without replacement, weight-proportional at every step — the NBA-style draw people mean when they say the word. Pending-only, like everything in 0176. **The probes assert fairness, not just success** (`lottery-probes.sql`, the 39th suite, 22 assertions): a 1000:1:1 share has to win the top pick at least 20 times in 25 — a bound loose enough never to flake and tight enough that a uniform shuffle (expected ~8) fails it, since "is it a permutation" alone would pass a lottery that ignored the weights entirely. Full battery green + APK 29400.

2026-08-18 — **FIND A LEAGUE GETS ITS OWN CHIP; THE COMMISSIONER HAS TO MEAN IT; THE MENU DROPS ITS EMOJI** (`v0.293.1`, no migration, both hosts): three founder notes. (1) **"Let's not have the league finder in the add a league page. Let's put the league finder as its own chip next to add a league."** 🔎 FIND A LEAGUE now sits beside ＋ ADD A LEAGUE on the leagues-list control row, and the "Find me a league →" card leaves the role chooser (`onBoard` with it). They are different questions — "I have a code / I'm making one" versus "I have neither, show me leagues that need managers" — and burying the second inside the first gave the people with no way in the furthest to walk. (2) **"We need a confirm popup when commish moving/dropping players."** ⇄ move, ⏳ waive and ✂ cut all fired on the tap, on BOTH hosts — and on the app the last two were unlabelled glyphs side by side. They are the one class of action in the console where the person who feels it isn't the person clicking, so all three now ask, naming the player, the team losing him and the team getting him ("are you sure?" over a list of forty names is not a question anyone can answer), and saying the quiet part: *this is another manager's roster, they are not asked*. The move PICKER already asked "to whom", which is not the same as asking "are you sure". (3) **"Get rid of icons on the league home."** Nine emoji in a vertical stack were nine different art styles doing the job the TITLE was already doing. Gone on both hosts; the `icon` argument is kept and ignored rather than threaded out of every call site, since that is where an icon would go back if the answer turns out to be "a consistent SET" rather than "none". Full battery green + APK 29300.

2026-08-18 — **TWO DOORS OUT: LEAVE, AND DELETE** (`v0.293.0`, migration 0188, core + both hosts): founder — "we need a way for players to leave a league and a way for commish to delete the league." Neither existed: `admin_delete_league` (0044) has been admin-only since the beginning, with the comment "commissioners cannot nuke a league", and a member who wanted out had nothing at all. **LEAVING IS NOT A NEW CONCEPT** — a seat is "open" when `app_user_id is null and not enrolled` (what `native_join` and `join_from_board` look for), and 0042's `admin_assign_roster` already vacates one with exactly that update. `leave_league` is that same vacate, performed by the person in the seat. **The roster stays**, deliberately: the seat keeps its team name and its players so the next manager inherits a real team mid-season and the schedule still has someone to play — a departure is a change of manager, not the deletion of a team. **Co-managers are the other kind of member** (0125): they hold no seat, so their leave drops only their own `team_manager` row and must not vacate the owner's; one RPC handles both because a member shouldn't have to know which they are (`as: 'manager' | 'comanager'` comes back). **The commissioner cannot leave** — every commish RPC is `commissioner_id = auth.uid()`, so a league whose commissioner walked away has nobody who can fill the empty seat, rule a trade, or delete it; the button isn't offered to them rather than offered and then refused. **DELETING IS TYPED, not double-tapped.** A two-tap confirm is right for a drop — one player, recoverable by re-adding him. This ends a league for everyone in it and the cascade takes matchups, rosters, wallets and the register, so the friction is the league's own name, compared case- and whitespace-forgiving so it proves intent rather than spelling. **The probes caught a real mismatch**: the migration's comment claimed case-insensitive and the code compared case-sensitively — the assertion that documented behavior failed on the first run. 15 assertions (`leave-delete-probes.sql`, the 38th suite) cover the vacate's exact shape, the roster and team name surviving, a co-manager leave not touching the owner, the commissioner's refusal not half-applying, an outsider refused, the seat being CLAIMABLE again afterwards, every refusal leaving the league whole, and the cascade actually cascading. Full battery green + APK 29300.

2026-08-18 — **＋ ADD A LEAGUE MOVES TO THE TOP** (`v0.292.3`, no migration, web only): founder — "put the find a league at the top by the all/commish chips." It was a centred link at the FOOT of the card grid, so on a six-league page you scrolled past everything you already have to reach the one control that adds another, and on a one-league page it sat marooned under a single card. It is now a chip on the ALL / COMMISH row, pushed to the right end and drawn with a DASHED border — same size and radius as the filters so the row reads as one control strip, different edge so it doesn't read as a third filter. **The row now renders for everyone.** It used to exist only `isCommish`, since the filter chips are the commissioner's; moving the button into it unchanged would have deleted the button for every non-commissioner — which is exactly the person most likely to be adding a second league. The FILTER is what's conditional inside the row now, not the row itself. Label kept as ADD rather than the founder's "find": the destination is the role chooser, where you can join with a code, browse the board, OR create a league from scratch — "find" describes two of those three. Full battery green; web-only, so no APK.

2026-08-18 — **ONE CHIP, WITH A WORD IN ITS CORNER** (`v0.292.2`, no migration, web only): founder — "get rid of scores too. Let's make the matchup just be a small word at the top right of the open league chip. Remove the icon from the open league chip." **The ▦ scores that was still there** was on the COMMISSIONER-ONLY card, not the play card — that one shed it in v0.292.0 and its sibling kept it, which is exactly the drift the "mirror LeagueCard's anatomy" note at the top of that component exists to prevent. Gone, and its spacing brought in line with the play card while there (padding 13→11, gap 12→9). The league's scoreboard is inside ⚑ manage league; the hub's 🏆 tile is still the door on the play side, so nothing was orphaned. **The two stacked chips become one.** v0.292.1's ▶ MATCHUP bar was still a second row of furniture for what is really one destination with a side door — it is now a small `matchup ›` riding the primary chip's top-right corner, in the accent's own foreground so it reads as part of the chip rather than a sticker on it, turning to `● matchup` in the live red when the board is live. Absent while the schedule is pending, since there is no board to open. **Nested buttons are invalid HTML**, so this is a positioned wrapper rather than a button inside a button: the word sits above the chip in the stacking order and stops its own click from reaching the chip underneath, which is what lets one control look like one thing and behave like two. The ◈ brand mark leaves the chip with it. Three dead things went out behind the change — `buildNote` (its only reader was the wide chip's "Loading your board…" label; the corner word is too small for a sentence and shows "…"), and `onResults` off both `CommishOnlyCard` and `LeagueHome`. Full battery green; web-only, so no APK.

2026-08-18 — **THE LEAGUE CARD IS TWO CHIPS** (`v0.292.1`, no migration, web only): founder — "get rid of team and draft quick link as well and make the matchup be a chip on top of the go to league chip." The quick-link ROW is gone entirely, and with it the last trace of a card that offered six doors an hour ago: ⛏ draft and ⇄ team join ▦ scores, ▷ demo and ⚑ manage league inside the league, where the hub's tiles have always been the real way to them. What is left is the only two places anyone goes from a leagues LIST — **the game and the league** — stacked: **▶ MATCHUP** on top, lighter (outlined, on the card's own ground), and **◈ OPEN LEAGUE →** beneath it in the accent, because the shortcut is the shortcut and the league is the way in that always works. The stacking is also what fixed the shape: a single centred word floating under a full-width button read as leftover, while two chips read as two choices, which is what they are. The matchup chip is ABSENT while the schedule is pending rather than dead — there is no board to open yet, and the line under it already says why. `onDraft`/`onTeam`/`onResults`/`onManage` all leave the card's props; the parent keeps every handler (`onDraft` still feeds `MockLeagueCard`, and the hub owns the rest), because none of those destinations went away — the card just stopped being a second menu in front of the first. Full battery green; web-only, so no APK.

2026-08-18 — **THE LEAGUE CARD GETS OUT OF ITS OWN WAY** (`v0.292.0`, no migration, web only): founder, from the leagues list — "just have a red dot if there are unseen events/messages. No x for you chip. No scores. No demo. No manage league. Make it compact." **FIVE SIGNAL CHIPS BECOME ONE DOT.** The card badged unread chat, trade offers, unvoted polls, waivers-in and the commissioner's "⚑ 2 FOR YOU" separately, so a card that also carries COMMISSIONER, PRACTICE and PICKS OPEN had six things competing to be read — and each of them answered a question nobody asked, the COUNT. What a leagues LIST has to say is "something is waiting in here"; an 8px dot says exactly that, and the breakdown survives as its tooltip in words rather than numbers ("2 unread messages · 1 poll to vote in"). **The lineup ALARM keeps its own chip, deliberately**: a window locking on empty slots is not an unseen message, it is a countdown that costs points if it runs out, and it is the one signal on this card a silent dot would make worse. **THREE DOORS, NOT SIX.** ▦ scores, ▷ demo (2025) and ⚑ manage league are gone; every one of them is INSIDE the league — scores is the hub's all-matchups tile, manage league is its ⚑ tile — so the row was offering shortcuts to a menu one click above them. The 2025 demo went with them and took its whole `playFullBoard` builder with it (~50 lines, plus the `buildDripTestLeague` and `clearRuntimeSlate` imports that only it used): it was built for someone deciding whether to play, and a manager with a league in front of them is past that. ▶ matchup, ⛏ draft and ⇄ team stay — none is duplicated by the hero button. **COMPACT** is then just arithmetic: the spacing was tuned when the card carried six chips and five links under a hero button, so padding 16 → 12, crest 38 → 32, and the three vertical gaps 12/12/10 → 9/9/7. Nothing the card SAYS changed — crest, seat, matchup and the door are all still full size. The stale "Try ▷ demo (2025) meanwhile" in the no-opponent line went too. Full battery green; web-only, so no APK.

2026-08-18 — **📣 RECRUIT JOINS THE LEAGUE MENU** (`v0.291.0`, no migration, core + both hosts): founder — "put a recruit section in the league section. Allow post to board for commish and portable/sendable link for commish and players." A tile on both hosts' league menus, opening a sheet (app) / panel (web) with two halves on **two different permissions**, which is the whole shape of the feature. **THE LINK is any member's**: `league_invite` has always been callable by any enrolled member — recruiting a friend was never meant to need the commissioner, and everyone in a league knows someone who would play. **THE BOARD is the commissioner's**: `post_league_listing` / `close_league_listing` / `league_listing_state` (0123) are commish-gated in SQL, because offering a seat to STRANGERS is a decision about who the league is, not a favour to a friend — the panel simply doesn't draw that half for anyone else. No migration: every RPC already existed. **The link already worked; nothing built one.** `?code=XXXX` has been a complete path for a long time — App.tsx reads it off the landing URL, stashes it as `dripInviteCode` so it survives the magic-link bounce to another origin, and the redeem form picks it up and joins on arrival — yet every share button in the app handed out a bare CODE and the words "dripfantasy.com", leaving the recipient to type four characters into a form they had to find first. New `data/invite.ts` owns `SITE_ORIGIN`, `inviteLink` and `inviteMessage`, and the three existing ⇪ RECRUIT buttons (MY TEAM, the recruit screen, the commish kit) now send the SAME message through it, link included. The origin is hardcoded rather than read from `platform().url.redirectBase()` deliberately: on native that resolves to a deep link (`dripfantasy://auth`), which is exactly what a shared link must not be — it opens nothing for a recipient who hasn't installed the app, which is every recruit worth having. The message repeats the code in plain text under the link, since SMS and some chat clients mangle query strings. **No new native dependency**: the app's copy button was dropped in favour of the OS share sheet (which offers Copy itself) rather than pulling in `expo-clipboard` — the link text is `selectable` besides. Web uses the clipboard API with `navigator.share` beside it where the browser has one. Full battery green + APK 29200.

2026-08-18 — **THE BOARD'S HEADER STOPS FIGHTING ITSELF ON A PHONE** (`v0.290.0`, no migration, web only): founder, from the mobile-web drip board — four notes, all of them the same complaint from different angles: too much crammed into two header rows. (1) **The drip coin moves down beside 🛒 SHOP.** It was in the header, which on a phone put a balance in the same row as the brand, both back-doors and the gear — and put it nowhere near the only thing it is for. Money next to what you spend it on. (2) **Chat is the icon alone**, `ChatButton compact` — unread becomes a DOT rather than a count, the same trade the app's chip made in v0.279.3; the count still reaches you inside the panel. (3) **The 🏈 PRESEASON badge is gone and PRE is highlighted in the week selector instead.** The badge was saying what `weekLabel` already said two chips to its left — "PRE 3" — while taking enough width to collide with the score; the fact now rides the label that carries it, accented when the shown week is a preseason one, with the badge's sentence kept as the tooltip since colour alone can't explain it. (4) **The brand stops painting over the back-doors.** `Brand`'s wordmark and version line are both `nowrap` inside a column a flex row is free to squeeze, and NOTHING CLIPPED — so the shrinking did nothing and "DRIP FANTASY" drew straight over the chip beside it (the screenshot shows "DRIP FANTA" with a button on top). `overflow: hidden` + ellipsis makes a squeeze visible and harmless instead of invisible and wrong. Note the collision was partly self-inflicted: v0.288.1 added the `← league` door to that row, which is what pushed it over — and with the coin now gone from the row there is ~85px back, so the wordmark should read in full and the clip is insurance. Full battery green; web-only, so no APK.

2026-08-18 — **THE SPOT CHIPS BECOME ONE WIDTH AND THE PLAYERS FALL INTO A COLUMN** (`v0.289.0`, no migration, app + web): founder, from the MY TEAM roster — "align the players in a column to the right and make the position label chips all the same size and large enough to accommodate labels." The badge box was `minWidth: 40` and grew with its text, so `FLEX (RB/WR/TE)` ran roughly three times the width of `QB` and shoved that one row's face and name out of the column the other nine shared. Every chip is now a FIXED `BADGE_W`, whatever it says, which is the whole of the alignment fix. **The labels FIT the box rather than being cut to fit it**: new `slotBadgeLabel` in core drops the parenthetical eligibility — `FLEX (RB/WR/TE)` → `FLEX`, `SUPERFLEX (QB/RB/WR/TE)` → `SUPERFLEX`, `FLEX (RB/WR/TE) 2` → `FLEX 2` (the duplicate index survives), and a commissioner's own `NFC Flex` passes through untouched — and anything still long wraps to a second line INSIDE the same box instead of widening it. Nothing is lost by the trim: the row already prints the player's actual position, 🧢 ROSTER SETTINGS lists what each spot accepts, and `slotAcceptsLabel` still spells it out for the draft room and the spot editor. **The width came from arithmetic, and the arithmetic caught a trap**: `fs(8.5)` does not render at 8.5pt — theme.native's type lift pulls small sizes toward its 15pt pivot and returns **11**. "SUPERFLEX" is therefore ~59pt of glyphs plus padding ≈ 67pt, not the ~54 an 8.5pt reading suggests, so the first 62pt guess would have broken a single word mid-glyph rather than truncating it. 72 with deliberate slack. The web's roster line, built to mirror the app in v0.285.0, had the identical flaw and takes the identical fix. Full battery green + APK 29100.

2026-08-18 — **← LEAGUE ON THE BOARD ACTUALLY GOES TO THE LEAGUE** (`v0.288.1`, no migration, web only): founder — "if you click back to league at the top of the matchup board on web it doesn't take you back to the league page." It missed **twice**. (1) The button is `ClassicBoard`'s `← LEAGUE`, and `Matchup.tsx` wired its `onBack` to `navigate({ name: 'leagues' })` — the Sleeper/demo-era `<Leagues/>` screen, which is neither the league nor your leagues. (2) Even pointed at `#/live` it could not have worked, and this is the part worth knowing: **the matchup board is its own top-level route, so App.tsx UNMOUNTS LiveOnboard while the board is up and every piece of its state dies with it** — `homeFor`, `target`, `view`. Coming back remounted it at `view: 'home'`, so there was no league left to land on regardless of where you had been. The `live` route now carries `view: 'leaguehome'` + `leagueId` (in-memory, like `view: 'admin'` — `routeToHash` writes neither, so a reload still lands on the leagues list), and LiveOnboard looks the enrollment back up when its list arrives. **One shot per intent, found or not**: a ref guards it, because `refresh` re-runs on a timer and would otherwise yank you back to the hub from wherever you had since navigated — and a league you have LEFT has to stop the restore pending or the screen would wait forever for an enrollment that is not coming. The loading gate holds while the restore is owed, so the leagues list doesn't flash up for a frame on the way in. **The drip board gains the same door** (`← league` beside `← my leagues`): the classic board has had one and the drip board never did, so "my leagues" was the only way off it — two clicks and a list to get back to the league you were already in. Only rendered for a real league; the demo and plain-sim boards have no hub behind them. Full battery green; web-only, so no APK.

2026-08-18 — **THE WEB GETS THE APP'S TOP ROW** (`v0.288.0`, no migration, web only): founder — "Let's have the same top row as on the app. League, Match up, My team, chat chip." New `app/LeagueStrip.tsx`: the league's NAME on one row and the ROOM CHIPS on the row beneath, mounted inside LiveOnboard's shell so it stands over every league room the web has — the hub, the team desk, the draft room, results, and the commissioner's console. **The chip set is the app's rule set, not a second one**: 🏠 LEAGUE always · ▦ MATCHUP only with a seat · ⛏ DRAFT native-only and only while there's a draft to run · ⇄ MY TEAM native + a seat · 💬 for every member of any league (0147), the icon alone at 15px, which is what buys the row its width back. `homeFor` was already this screen's notion of an open league — every league room's back action reads it — so it is what the strip is drawn for; no new state was needed. `useHeroBoard` now takes a NULLABLE enrollment so LiveOnboard can call it unconditionally at the top of its body and the ▦ MATCHUP chip can build the board from any room, not just from the hub's tile. **The hub sheds what the strip now repeats** — the founder's own v0.275.0 rule ("a menu that repeats the strip is a menu you read twice"), which until now didn't apply to the web because the web had no strip: the My matchup and Chat tiles are gone, and so is the second copy of the league name (the app made that exact trim in v0.280.0). Trades / Waivers / Team options STAY — no chip duplicates them; they are focused deep links into what ⇄ MY TEAM contains. **What the tile carried and a chip cannot** is preserved rather than dropped: the week, the opponent and whether it's live now read as their own one-line THIS WEEK / ● LIVE button above the bands, still one click from the board. The chat tile's two badges merge into the 💬 dot — unread messages OR an unvoted poll, since an icon-only chip has room for one signal. **THE ONE ROOM WITHOUT THE STRIP is the matchup board**, deliberately: that is its own top-level route with its own full-bleed chrome (App.tsx renders it, not LiveOnboard), and whether a name-plus-chips band belongs over a live game board is a decision about the BOARD. The ▦ MATCHUP chip is the way into it. Full battery green; web-only, so no APK.

2026-08-18 — **THE CHIPS GET THEIR OWN ROW; THE WEB HUB GETS THE APP'S MENU AND A DESKTOP SIZE** (`v0.287.0`, no migration, app + web): founder, from a league-home screenshot — "pin the top chips to the row under the league name. I like the league and commish menu layout on the app — mirror that in the mobile web and create a big version for desktop." (1) **The app header is two rows now, always.** v0.279.3 put the league name and the room chips on ONE wrapping row, which meant the wrap landed wherever the name happened to end: "Super Cool League of Players" stranded 🏠 LEAGUE up top with MATCHUP / MY TEAM / 💬 beneath, and a short name put three up and one down. The name is a header; the chips are the navigation under it; neither moves when the name changes. (2) **The desktop hub was a 440px column — on any screen.** `LiveOnboard`'s `pageMax` table never listed `leaguehome`, so the hub fell through to the 440 default and its own `maxWidth: 560` never got the chance to apply. That is the whole reason the desktop hub read as an unfinished phone page. It now gets 1080, and above 900px lays its tiles out in **two columns**. (3) **The hub splits into the app's two bands.** The tiles were already the same idiom, in one unbroken column; now they read at a seam — **YOUR WEEK** (matchup · chat · shop · trades · waivers · team options) then **THE LEAGUE** (teams & rosters · draft room · standings · register · scoring · roster settings · alerts · commissioner), which is the app's order. What stays different is deliberate: the app drops MATCHUP / MY TEAM / CHAT from its menu because they are chips on the strip above it, and the web has no strip — this hub IS the navigation — so they remain tiles. An OPEN PANEL now breaks out of the grid to full width beneath its band, because a register squeezed into a half-width cell is a worse read than the tile it came from. 🔔 **Alerts** joins the web menu, hosting the same `NotifPrefsCard` the team screen uses (now exported) rather than a forked editor. (4) **The commissioner's menu needed no work** — it has had the app's exact shape since v0.259.0: the grouped `NavHub` (every destination on screen, one tap in) at phone width and the `SideNav` rail as the desktop "big version". Its comment still claimed narrow screens got a scrolling strip, which is the thing the app's map was written not to copy and has not been true for twenty-eight versions; the comment is fixed rather than the code. Full battery green + APK 29000.

2026-08-18 — **THE BAKE REACHES THE SUPER BOWL** (`v0.286.0`, no migration, core + both hosts): founder — "regular season stays 14 weeks, but let's have all the stats through 18 weeks. Also playoffs if available." The bake stopped at week 14 because the original Stathead pull did; `scripts/pbp/raw/` held 208 games and `expected.txt`, the completeness guard, knew nothing about a week 15. Now **1–22**: the full 2025 regular season plus the postseason as nflverse numbers it (19 wild card · 20 divisional · 21 conference · 22 Super Bowl) — 285 games, 52,373 attributed plays. **The half that matters beyond the card**: `playoff_start_week` defaults to **15** (migration 0073), so every league's championship was being resolved by the engine's SIMULATION for want of data. It now plays on real football. **REG_SEASON_WEEKS stays 14** — that constant was doing two jobs (the season's shape, and how much football is baked) and they have come apart; its docblock now says which one it is, and `REAL_WEEKS` is what to read for "do we have data". No league's schedule moves. **New raw source, proven equivalent**: `scripts/pbp/nflverseToRaw.py` reads nflverse's own season release — what the Stathead MCP wraps — so 77 games arrived as a file rather than through 77 tool calls. It had to be proven interchangeable before it could be trusted: rebuilding weeks 1–14 through it reproduces the committed dumps on **31,079 of 31,085 plays**, the residue being upstream revisions since the first pull (a dozen re-scraped kickoffs, five millisecond refinements to `time_of_day`, one genuine fumble re-attribution). The nullified-play rule the old dumps followed had to be recovered exactly — nflverse keeps `no_play` rows and they carry a `time_of_day`, so admitting them shifts the derived drive spans and wall-clock timeline even though scoring never moves. **Weeks 1–14 are left byte-identical**, deliberately: re-cutting a week under a league that has already played it is not a data refresh, it is rewriting a result. `NFL_SLATE` gains 15–22 with window ids read off each game's real kickoff (Saturday slates get `sat`); the older weeks keep their coarser cut for the same reason. Postseason weeks get names rather than numbers — `weekLabel`/`weekTick` print WC · DIV · CONF · SB, since "WK 22" means as little as "WK 102" did. Season log: 1.5 → 2.0 MB (58,994 plays, 581 players); APK ~20.5 MB. `check:gamelog` now asserts the whole span, that weeks 15–17 carry real plays, and that the postseason thins round by round — plus the existing week-by-week agreement with the board, now **22 weeks × three players**. Full battery green + APK 28900.

2026-08-18 — **THE WHOLE SEASON IN THE GAME LOG; THE ROSTER LINE LOSES ITS BUTTONS** (`v0.285.0`, no migration, core + both hosts): founder, two notes. (1) **"We only have week one of 2025 in the player card game logs. Let's get all of 2025 in — we could probably ship the data (compressed?) with the APK."** The log read `live_play`, which holds only what the live pipeline has actually BROADCAST — one week, because one week has been simulated. But live_play is downstream of the bake (`server/src/simulate.js`: "baked wN.json → live_play rows"), so the card was reading the less complete of two copies of the same plays. New `scripts/pbp/genSeasonLog.mjs` re-pivots the fourteen week files from WEEK-major (the board's axis: one week, every player) to PLAYER-major (the card's: one player, every week), dropping the two fields no scorer touches — `t` wall-clock and `pid` — and every zero flag: **3.3 MB of week files → 1.5 MB**, which is ~200 KB over HTTP on the web and **+1.2 MB of APK** on native (measured: 18.8 → 20.1 MB). Those differ because Metro does not ship this as a zip-compressed asset — it inlines the JSON into `index.android.bundle` and Hermes compiles it to bytecode, so the APK pays for bytecode rather than deflated JSON. Buying the 200 KB back would mean expo-asset plus a runtime file read: a dependency and an async hop to save a megabyte we have. Explicit gzip is the wrong call either way — it would need a decompressor in the bundle to undo what every HTTP server already does. Web fetches `public/pbp/season.json`; native has no `assetUrl`, so `platform.native.ts` installs a loader that Metro-`require`s the same file — inside the loader, so a session where nobody opens a game log never pays the parse. `playerSeasonPlays` is retired with its last caller. The log now runs the full season, offline, with no round trip. `check:gamelog` grows from 14 assertions to 22 and now proves the re-pivot itself: **fourteen weeks × three players agreeing with the board to the decimal**, so a field lost in the bake fails here rather than in a card. (2) **"Get rid of the taxi and drop next to each player in my team. If you want a player on taxi, you should be able to swap them into a taxi spot on the roster list. For drop, put that in the player card."** Both chips are gone from the roster line. **DESIGNATIONS are the SLOTS' job now**: an empty IR or taxi place reads "＋ move someone to the taxi squad" and opens a picker of your active roster; a filled one's badge reads `TX ↩` and sends him back. That replaces a →TAXI/→IR/→ACT cycle you had to press twice to reach IR, and it matches what those sections are — places, with someone in them or not. **DROPPING is the PLAYER CARD's job**, two taps to confirm, offered only for a player on YOUR roster in THIS league: an irreversible red button one thumb-width from the name you meant to tap was the problem, and now the same button is wherever you found him. Because the card is a module-level overlay with no parent to call, a small `rosterBus` carries "this league's rosters moved" — both team screens listen and refresh on the tap instead of on their 15-second poll. **The web's My Team caught up while it was open**: it was still the pre-v0.281.0 flat list, so it now lays out in STARTING SPOTS / BENCH / IR / TAXI off the same `assignSpots` matching the app uses, with the same slot interaction. Full battery green + APK 28800 (20.1 MB).

2026-08-17 — **THE GAME LOG, SCORED BY YOUR LEAGUE'S OWN RULES** (`v0.284.0`, no migration, core + both hosts): founder — "let's do it." The player card gains a **GAME LOG** tab: every week he has plays for, with the opponent, the counting line, and FPTS **under this league's scoring table** — a 12-point rushing TD league prints 12-point rushing TDs. **No new data and no second scorer.** `live_play` is keyed (week, player_slug), so ONE player's season is a few hundred rows (`playerSeasonPlays`), and the points come from `classicPointsFrom` — the same body the board and the worker score with, split out of `classicPoints` in this change (which is now a two-line wrapper). Same split for `statlineFrom` and `rawPlaysFrom`: the log decodes and accumulates plays through the board's own code, never its own. **Why the split was necessary at all**: `classicPoints` reads plays from a module cache the LIVE BOARD owns, one week at a time — a card installing eighteen weeks over it would leave the board scoring the wrong week. The log fetches its own rows and never touches that cache. **Drip leagues get statlines and NO points column**, and say why: drip scores per window with power-ups on top, so a season number would be one no matchup ever produced. Fetched lazily on the tab, since most cards are opened to read a name and close. New `check:gamelog` parity script (14 assertions, wired into `check:parity`): the log agreeing with the board TO THE DECIMAL by both routes, the league's table actually moving the number, drip printing none, and a blank week reading as "did not play". Full battery green + APK 28700.

2026-08-17 — **EVERY NAME IS A DOOR; THE SWAP GETS ITS OWN CHIP** (`v0.283.0`, no migration, both hosts): founder — "we want pretty much every place where the player name exists to be clickable to show the player card. In the matchup screen, we need to have the player name click show the card and maybe a small chip for the spot swap instead of clicking the name." **The matchup screen** (classic, both hosts): the starters row was ONE button into the picker, so there was no way to simply READ about the player standing in a spot. Now the NAME opens the card and a small ⇄ chip does the swap; an EMPTY spot keeps "+ SET" as the picker's door, since there is nobody to read about. Bench and IR names open cards too. **Everywhere else** (app): roster rows, the player pool/wire, the draft room's pool and pick log, and trade lists. Two surfaces got a chip instead of the name, deliberately: a TRADE row IS a checkbox (stealing its name would make picking players harder to hit) and the drip SETUP card's face already carries the swap/metric gestures the board was built around — both gained a ⓘ beside what they had rather than having a known motion redefined. Full battery green + APK 28600.

2026-08-17 — **THE PLAYER CARD GROWS UP** (`v0.282.0`, no migration, both hosts): founder, with Sleeper's card in five screenshots — "Let's revise ours to include these." What ours now has that it didn't: a **FACT STRIP** (AGE · EXP · NO. · PROJ) reading at a glance instead of buried in a sentence; **NEXT UP** — the opponent and kickoff from the slate the app already carries, or "bye" when there is no game; **ROSTERED** — who holds him in this league, or "free agent — nobody holds him"; and a **HISTORY tab**, which is 0186's register filtered to one player: every add, drop, waiver claim (with the bid) and trade, in the league's own words. The league context arrives through `setCardLeague`, installed by whichever surface knows one — App (`liveCtx` / the open league), the hub page, the team screen — rather than threading a `leagueId` prop through Duel, RosterPanel and PlayerPicker for a modal none of them own; it is CLEARED when the league closes so a card opened from the leagues list can never claim the last league's owner. **What was deliberately NOT built**: Sleeper's GAME LOG and TEAM tabs. A per-week NFL stat table and a depth chart are data this app does not hold (baked pbp is fetched a week at a time for the board; nothing knows a team's depth order), and height/weight are not in the bio bake — an empty tab and two invented numbers would both be worse than saying so. Full battery green + APK 28500.

2026-08-17 — **MY TEAM'S ROSTER READS LIKE A ROSTER** (`v0.281.0`, no migration, app only): founder, with Sleeper screenshots — "This is a pretty standard 'my team' view. Each starting position, bench, IR, then taxi. Let's do the same in our my team tab instead of the list we have now." The ROSTER tab was one flat list of everybody with a small spot badge; it is now the shape the league actually plays: **STARTING SPOTS** (a row per spot, badged with the spot's own name — QB, RB1, the commissioner's "NFC Flex" — tinted by the first position it accepts), then **BENCH**, then **INJURED RESERVE**, then **TAXI SQUAD**, with the unused IR and taxi places DRAWN as empty rows because "how many more can I stash" is the question those sections exist to answer. The starters half is `assignSpots` — the same maximum-matching the draft room's TEAMS panel uses to answer who is legal where — and the header says so ("how your roster fits — set the lineup on ▦ MATCHUP"), because drip sets a lineup per WINDOW and classic per week: letting the layout imply this was a submitted lineup is the one thing this screen must not do. Every row keeps the actions that make the tab worth opening (→TAXI/→IR/→ACT cycle, DROP), hoisted into one shared `RosterRow` rather than repeated four times. Full battery green + APK 28400.

2026-08-17 — **THE LEAGUE CAN BE RENAMED** (`v0.280.0`, migration 0187, core + both hosts): founder, from the league menu — "we don't need the league name twice here. We do need a way for commish to change the name and avatar for the league." Two halves. (1) **The duplicate title is gone**: the app header became the league's name at header size in v0.279.3, and LeagueHome printed it again one row below. Its block keeps what the header does NOT carry — "you are Team 1 · ⚑ commissioner" — and the way out; the `name` prop went with it. (2) **`set_league_name`** (0187) is genuinely new. The CREST has had a setter since the avatar work; the NAME had none anywhere, so whatever `create_native_league` was handed stood forever, typo and all. Same auth and shape as `set_league_avatar` — commissioner or admin, 2–60 characters, trimmed with inner whitespace collapsed (a name is a chip and a header; "Turf    Warriors" wrecks both), returning the STORED name so the field renders what the server kept. App: a 🏷 NAME & CREST section leads SET UP in the commish map, with the crest picker beside the name (it reads both from `my_teams`, so a seatless commissioner can use it too). Web: the rename joins the crest on the team card's identity block, where the commissioner already changes it. 12 probes (`league-name-probes.sql`, the 37th suite): member refused, trimming, both bounds, a refusal leaving the OLD name intact, and `my_teams` reporting the rename. Full battery green + APK 28300.

2026-08-17 — **THE LEAGUE NAME BECOMES THE HEADER** (`v0.279.3`, no migration, app only): founder — "move the top menu chips up to the same row as the league name. Make the chat chip just the icon (bigger) and let's increase the size of the league name font so it's more like a header." The name was a 9.5pt line of dim mono with the room chips stranded on their own row beneath; it is now an 18pt title sharing that row with them. 💬 CHAT drops to the bubble alone at 15pt — the word bought nothing the icon doesn't say, and the width it frees is what lets the title share the row at all (the unread dot is absolutely positioned, so it rides the smaller chip unchanged, and the chip keeps a spoken name so the icon still announces itself as "Chat"). The row WRAPS by design: four chips and a long league name will not fit a phone, so the chips flow underneath while the title shrinks to one line rather than pushing them off. Signed out of a league there is no title to draw, so the email keeps its own quiet line. Full battery green + APK 28200.

2026-08-17 — **THE COMMISH CHIP LEAVES THE STRIP** (`v0.279.2`, no migration, app only): founder — "I guess we don't need commish in the top if we already have it in the league tab." Right: the league menu's ⚑ Commissioner tile is the same door, so the strip is back to the rooms every open league has (🏠 LEAGUE · ▦ MATCHUP · ⛏ DRAFT · ⇄ MY TEAM · 💬 CHAT). The commish VIEW is untouched and still renders with the strip above it — including the seatless-commissioner path, which lands there on open and, having no seat, sees LEAGUE + CHAT beside it. Full battery green + APK 28100.

2026-08-17 — **THE CONTROL BOX GETS BACK TO ONE LINE** (`v0.279.1`, no migration, app only): founder, from the PRE 3 board — "remove the preseason chip and make the auto pilot chip not have a label but just turn on/off when pressed. I want everything in that box to be one line." All three. The 🏈 PRESEASON chip is gone: the week stepper two rows above already reads PRE 3, and a second banner for the same fact was what pushed the box onto three lines. The auto-pilot chip loses its words — it is a toggle, so the FILL is the state, exactly as every other `on` chip in the app reads, and the sentence under the row still spells out what being on means. That freed the width for one `flexWrap: 'nowrap'` row: 🤖 · ▦ FIELDS · 0/11 SET · ◆ 120 · 🛒 SHOP. `Chip` gains an optional `a11y` prop (spoken name + selected state) so an icon-only toggle still announces itself as "Auto-pilot on/off" rather than as an unnamed button. Full battery green + APK 28000.

2026-08-17 — **THE FIELDS CHIP JOINS THE CONTROLS; THE WEEK STEPPER LEARNS PRESEASON** (`v0.279.0`, no migration, core + app): founder, from the Turf Warriors board — "Put the fields chip on the same row as the shop and auto pilot chips. The app doesn't have preseason matchups for turf Warriors." (1) ▦ FIELDS leaves the roster-door row (where it was a third door beside a matched pair) and joins 🤖 auto-pilot / ◆ / 🛒 SHOP, which is what it always was: a control. It stays visible under auto-pilot, unlike SHOP — watching the games is not something the robot does for you. (2) **The stepper could not reach a preseason board at all.** It counted `1..REG_SEASON_WEEKS`, and preseason weeks are numbered from `PRESEASON_BASE` (101+), so a league playing PRE 1–3 had boards nobody could open — the ‹ arrow simply clamped at WK 1. New `leagueWeeks(leagueId)` reads the league's own matchup rows (the same source `defaultOpenWeek` trusts) and returns them in PLAY order — preseason sorts before week 1, however it is numbered — and the stepper walks THAT list, falling back to the old count only when the weeks haven't loaded. Note for the founder: this reaches any preseason week the league actually has; if Turf Warriors was never switched to preseason practice, the toggle is `set_preseason_practice` (web AdminPage), which clones Week 1 into 101–103. Full battery green + APK 27900.

2026-08-17 — **THE FLAGS SHEET COMES BACK, AND ITS FILTERS BECOME RULES** (`v0.278.0`, no migration, web + app): founder, with a screenshot of a ⚑ Player flags sheet showing a label box, the rule chips, and then nothing — "bulk player flags doesn't look like it's working. Can we allow scoped bonuses for player flags?" **The bug**: that sheet's body carried `style={{ flexGrow: 0 }}` (since v0.217.0) where `ui/Overlay`'s own docblock states the contract as `flexShrink: 1`. They are different properties — `flexGrow: 0` refuses to GROW, and RN's default `flexShrink: 0` meant it also refused to shrink — so once bulk mode put a FOOTER under it, the column had nothing left to give the body and it collapsed to nothing. Every other sheet in the app uses the contract; this one now does too. (`CommishSettings` carries the same deviation but has no footer, so it is left alone rather than risking a layout regression on a screen that works.) **The feature**: the bulk filters (position / team / tenure) already ARE a scope, so the sheet can hand them to `set_league_scoring` instead of a player list — ⚖ MAKE IT A SCOPED RULE INSTEAD, on both hosts, appending to the league's 0145 rules (existing rules and knobs read back and preserved, 12-rule cap respected). It states what the rule will read as BEFORE the press, since the rule lands in ⚖ SCORING rather than in the flag list, and confirms with the saved label after. Only the × and ± travel — a scoped rule has no can't-trade/can't-start — and the sheet says so rather than dropping them silently. Why it matters beyond convenience: a flag list is a snapshot (the rookie signed in week 6 isn't in it and nobody goes back), a scoped rule is standing law, and since v0.277.0 it pays in both game modes. Full battery green + APK 27900.

2026-08-17 — **SCOPED RULES REACH NORMAL LEAGUES** (`v0.277.0`, no migration, core + worker + both hosts): founder — "let's have a version of scoped rules for normal leagues too." One line does the work: `classicPoints` now applies `scopedAdjustFor` (0145) exactly as sim.ts does — multipliers multiply, point bonuses add, and a per-TD bonus pays on every touchdown he scored (counted from the same plays that produced the points, so the two can't disagree). One rule therefore means one thing in both game modes. The league-wide KNOBS (0143 — TD ±, yardage ×, turnover −) stay drip-only: they layer on the drip engine's growth curves, which classic has no equivalent of, and a 🏈 NORMAL league that has them set is TOLD so rather than left guessing. **The dangerous half was the install, not the arithmetic**: the worker's classic branch installed flags but never `setLeagueScoring`, and the classic boards never installed it at all — harmless while classic ignored scoped rules, fatal the moment it read them (the module-global would have held the PREVIOUS matchup's league, scoring one league under another's bonuses). All three now install it, boards recomputing off the existing `flagsVer` signal since scoring and flags are both module caches React cannot see. New `check:scoped` parity script (15 assertions, wired into `check:parity`): each of mult/pts/per-TD when a rule matches, a miss on every scope axis, scopes AND rather than OR, stacking, the snake-case stored shape scoring identically to the camel one, and the identity property — no rules installed scores bit-for-bit what the league scored before 0145 existed. Full battery green + APK 27800.

2026-08-17 — **THE SCOPED BONUSES SURFACE** (`v0.276.0`, no migration, web + app): founder — "we need to show the scoped bonuses on the scoring settings." The commissioner's LAYERING knobs (0143 — every TD ±, all yardage ×, turnover −) and SCOPED BONUSES (0145 — "QB·WR / DAL / rookies: ×1.5 +3") were readable only from the commish kit, so a member could not find out that his league pays rookies double. Both hosts' scoring sheets now read `league_scoring` (already member-callable) through `parseScoring` and print them: knobs as plain lines, scoped rules split into WHO on the left and WHAT on the right — a list of them is scanned by scope first — with a footer stating the two rules that surprise people (a player must fit EVERY part of a scope; rules stack, multipliers multiplying and points adding). **Drip-engine only, and the sheet says so**: `scopedAdjustFor` is read by sim.ts and never by `classicPoints`, so a 🏈 NORMAL league with rules stored from before a mode flip is told they're dormant rather than shown a bonus that doesn't pay. This also retires the drip mode's dead-end copy — "there are no per-stat values here" became "the engine's numbers are fixed; what this league layers on top is below", which is now true and continues into real content. `LeagueScoringRow` gains the `scoped` field it always returned. Full battery green + APK 27700.

2026-08-17 — **THE MENU STOPS REPEATING THE STRIP; SCORING AND ROSTER SAY MORE** (`v0.275.0`, no migration, web + app): founder, three notes in one. (1) **MATCHUP / MY TEAM / CHAT / FIELDS leave the app's league menu** — the first three are one tap away on the nav strip directly above it, and ▦ FIELDS is a chip on the matchup board itself (v0.270.0), so the menu was asking to be read twice. The ◈ shop stays: it has no chip anywhere. The fields SIGNAL plumbing goes with them (App.tsx state → LivePicks prop → effect), since the board's own door replaced it. Web keeps its tiles — its hub IS the navigation, with no strip above it. (2) **Scoring gains ⚑ COMMISSIONER RULES**: the per-player flags (0144) score as surely as the pass-TD value — ×2 on a player, +3 a week, can't-be-started — and lived nowhere a member could read them. Now listed with the label and the rule in plain English, under BOTH modes (a drip league has no stat table but can absolutely have a ×2), silent when nothing is flagged. (3) **Roster settings marks its spots**: 🎯 for best ball (0159) and a tappable ⓘ for a spot with a 0172 filter, which reveals its terms ("only SF/SEA · 0–2 YRS") — one tap away rather than always on screen, because most spots have no filter and a wall of terms on the ones that do would drown the lineup shape. A legend appears only when the league actually uses either. Full battery green + APK 27600.

2026-08-17 — **THE LEAGUE MENU GETS ITS FULL LIST + THE REGISTER** (`v0.274.0`, migration 0186, core + both hosts): founder — "League should have the following: Teams and Rosters, Draft, Alerts, Standings (from my team), scoring settings, roster settings, league register (transaction log), commish." Four of those existed; four are new, and the menu now splits at a **THE LEAGUE** heading — above it your week (matchup, chat, shop, my team, fields), below it the league itself. **Standings** moves off MY TEAM's tabs (the table is the league's, not the team's; the playoff bracket rides along), leaving three tabs there. **Scoring settings** and **Roster settings** are new read-only sheets for every member, built from the RPCs that already existed (`league_game_mode`, `roster_rules` — the latter already documented as "any member") — scoring prints only the fields that actually score, with "anything not listed scores 0", and answers honestly for a drip league (no per-stat table exists; the engine scores it); roster prints size, the named starting spots, position limits, waiver mode/budget/hold/clear schedule, the FA window and trade review. **The league register** (0186) is the new one: `league_txn` + `league_register`, every in-season add, drop, waiver win (with the bid), trade (with the seat each player came from) and commissioner move. **Written by a TRIGGER on native_roster, not by the RPCs** — every path ends at an insert/update/delete there, so one trigger catches all of them (and any added later) without copying a single existing function body; `acquired` already carries the why. In-season only: the trigger no-ops unless the draft is `complete`, which keeps draft picks, keeper seeding, pool-reseed cascades and the rollover's copy out of the register in one rule. A trade is an UPDATE of `roster_id`, so it never reads as a drop; `commish_move_player`'s delete-and-reinsert would have, and is suppressed at read time (same slug + same `at` = one transaction = a move, while a genuine add-and-drop swap names two different slugs). **The probes caught a real leak**: `league_register` shipped its first draft without `where t.league_id = p_league_id` and returned every league's transactions to any member — 16 assertions now cover the gate, each kind, the bid join, the move-vs-drop rule, taxi/IR silence, ordering and the outsider refusal (`register-probes.sql`, the 36th suite). Full battery green + APK 27500.

2026-08-17 — **THE MY TEAM TAB SAYS WHAT IT SHOWS** (`v0.273.1`, no migration, app only): founder, from a screenshot — "League on the my team tab should be 'standings'." It was named for its scope rather than its contents, and collided with the 🏠 LEAGUE tab sitting two rows above it on the same screen. Now 🏆 STANDINGS (id renamed with it, so the code stops calling it 'league' too); the panel is unchanged — standings table + playoff bracket. Full battery green + APK 27400 (which also carries v0.272.0's alerts move and v0.273.0's classic shop removal — 27200/27300 were superseded before delivery).

2026-08-17 — **NO SHOP IN CLASSIC** (`v0.273.0`, no migration, web + app): founder — "We don't need power up shop in the classic league." Classic leagues (0157) have no power-ups, but both hubs offered the ◈ Power-up shop tile anyway — a door onto a board with no shop. Neither hub knew the game mode, so each now asks `leagueGameMode` in its existing load effect and hides the tile on `classic` (web `LeagueHubPage`, app `LeagueHome`). Defaults to visible until the answer lands — drip is the common case and a popping-in tile would be worse than one briefly showing. Full battery green + APK 27300.

2026-08-17 — **ALERTS MOVE TO THE LEAGUE MENU** (`v0.272.0`, no migration, app only): founder — "Lets put alerts in the league menu, not the my team." The 🔔 ALERTS tab leaves MY TEAM (tab union, chip, panel, and the pre-draft PushPrefs card all gone — alerts are league-wide plumbing, not roster management) and the league menu gains a 🔔 Alerts tile, unconditional for any member since PushPrefs is device-level, opening the push prefs in a bottom sheet next to the TeamsSheet. Full battery green + APK 27200.

2026-08-17 — **THE GAME FIELD BECOMES A CARD** (`v0.271.0`, no migration, web only): founder, walking back half of v0.270.0 — "Let's not do a new tab on the web for the game view, just a card." A classic game line now opens the field + play log as a CARD over the board — the picker's exact dismissal grammar (backdrop, ✕, Escape) — instead of `window.open`. `FieldGame` was self-contained by construction (loads and polls its own feed off week + team), so the card just hosts it: an `onClose` prop adds the ✕ and hands width/padding to the wrapper. The `#/field/<week>/<team>` route, built solely to give the new window something to land on, is retired from the router (Route type, both hash mappers, App.tsx wiring) — nothing links to it anymore and an orphan route is a lie waiting to rot; the "▦ field ↗" marker drops its ↗. App untouched (its sheet already was the card idiom). Full battery green + APK 27100 (version label only — no app-side change).

2026-08-17 — **FIELDS ON EVERY BOARD + THE GAME-LINE DOOR** (`v0.270.0`, no migration, core-adjacent none — web + app): founder — "Can we get a chip for the fields on the match up boards? Classic and Drip. On classic, it would be good if clicking on a game line would open the field with a play log on a new window." Three fronts. (1) **Chips on the boards**: the app's drip board gets a ▦ FIELDS door beside its two roster doors (the league-menu tile stays as the second way in; web drip already had its button), and BOTH classic boards get one — web opens the drip board's own full-screen `FieldBoard` grid over classic's starters (both sides, clock=MAX, no outcome tint), the app opens an all-fields sheet of `FieldView`s. Classic boards never installed game feeds at all, so their 60s poll now fetches `weekGameFeeds` and installs via `setLiveGameFeed` under the live-exclusivity rule (a live week must never fall through to baked 2025 drives); feeds ride in STATE because the module cache is invisible to React. The chip only renders once feeds exist — a door into an empty sheet reads as broken. (2) **The game-line door on classic**: every game line with a published feed becomes a tap target — web `GameCard`s grow an `onOpen` (cursor + "▦ field ↗" marker) that `window.open`s a NEW WINDOW; the app's `BoardCell` game line becomes its own accented Pressable inside the row (nested, so the picker tap survives) opening a field + play-log sheet. (3) **The standalone field page**: new self-contained route `#/field/<week>/<team>` (`FieldGame.tsx`) — live drive chart on top, full play log newest-first beneath (quarter clock, down & distance, scoring plays accented with the score after), self-refreshing every 45s, live-rows-first with baked fallback; restorable on cold load because week+team is all it needs (week validation admits the 101+ preseason board weeks). Full battery green + APK 27000.

2026-08-17 — **THE TAB STRIP SHEDS ITS DEAD WEIGHT** (`v0.269.0`, no migration, app only): founder, from the league-home screenshot — "Let's take draft off the top row when it is completed. Let's also take fields off and just have it on the league menu." Two chips leave the strip. (1) ⛏ DRAFT now shows only while there is a draft to run: App.tsx asks `native_team_state` for `draft_status` when a native league opens and drops the chip on `complete` — the room itself stays reachable through the league menu's "Draft room" tile (the record after draft night), and the chip defaults to VISIBLE until the answer lands, because a live draft with no way in beats a finished one briefly showing. (2) ▦ FIELDS leaves the strip entirely (it was an action chip pretending to be a tab — 0182.3) and becomes a "Fields" tile on the league menu next to the Power-up shop, same pattern: bump the signal, land on the board, sheet already open. Seat-gated like the chip was. Full battery green + APK 26900.

2026-08-17 — **MY TEAM GETS TABS** (`v0.268.0`, no migration, app only): founder — "My Team needs to have tabs as well. Default to roster but all the other areas need to be tabbed." The screen was one long scroll (identity, alerts, roster, keepers, claims, the player pool, standings, playoffs, trades, waiver order stacked end to end). Now: a chip strip under the identity card — 🧢 ROSTER (default: roster + keepers) · ✚ WAIVERS (claims with a pending-count badge on the chip, the player pool, the waiver order) · ⇄ TRADES (TradeCenter) · 🏆 LEAGUE (standings + playoffs) · 🔔 ALERTS (push prefs) — one area at a time. Identity and the over-limit warning stay ABOVE the tabs (who you are and what's broken outrank any tab); the claim-bid and pick-a-drop modals are tab-agnostic. Pre-draft branch untouched. Build note: APK 26701 (the v0.267.1 drag fix) failed at the JS bundle because these edits raced its bundler in the same tree — superseded; 26800 carries both changes. Full battery green + APK 26800.

2026-08-17 — **THE DRAG SURVIVES THE SCROLLER** (`v0.267.1`, no migration, app only): founder, on-device with 26700 — "The drag and drop doesn't really work. it just ends up down one spot no matter what I do." Diagnosis: inside a ScrollView, Android natively intercepts any moving vertical touch — the drag survived exactly long enough for the first fast movement to cross one row (one down-swap), then the sheet's scroll stole the responder and the gesture silently died; `onPanResponderTerminate` cleaned up, netting "one spot down" every attempt. Fix, four PanResponder flags on the grip: claim in the CAPTURE phase (start + move) before the scroller sees the touch, REFUSE termination requests for the touch's whole life, and block the native scroll component on Android (`onShouldBlockNativeResponder`). The `onDragActive` → `scrollEnabled` freeze stays as the second line of defence. Full battery green + APK 26701.

2026-08-17 — **THE ROSTER BUILDER GETS A THUMB** (`v0.267.0`, no migration, app only): founder, from the ROSTER sheet — "We can't get rid of the arrows and go drag and drop? We also need a button to pop up a position label editor." (and mid-turn: "would be great if it didn't wrap"). All three in one row redesign. (1) **Drag-to-reorder**: a ⠿ grip replaces the ▲▼ arrows — PanResponder swap-on-cross (no new deps): the lifted row translates with the finger, crossing half a neighbour swaps in state, accumulated crossed heights keep the transform finger-relative, and the hosting sheet freezes its scroll during the drag (`onDragActive` → `scrollEnabled`). The gesture survives re-renders because rows carry a client-only stable key (`SpotDraft.k` — index keys would remount the grip mid-gesture and kill the responder; `fromSpotDraft` never sends it). (2) **The ✏️ SPOT EDITOR sheet**: label front and center (it was buried in the 🔎 filter popover), the 0172 per-slot filters and the remove action ride along, and a set label shows on the row as its own quoted line. (3) **Rows never wrap**: grip + number left, position chips in the flexible middle, 🎯 BB + ✏️ pinned right — the 🔎/▲/▼/✕ cluster that overflowed at the new type size is gone. Full battery green + APK 26700.

2026-08-17 — **THE TYPE SCALE BECOMES A COMPRESSION CURVE** (`v0.266.0`, no migration, app only): founder, with screenshots of the MODE and ROSTER sheets on 26500 — "still really tiny in the commish area. Maybe the multiple was not the best solution?" Right on both counts. A multiplier PRESERVES the problem: small text is the complaint and 8.5×1.15 ≈ 9.8 is still small, while the already-fine titles grew the most absolute points. And half the commish area is raw `<Text>` the prims never touch (the chip map, GameModeCard, the builder rows, the settings sheets), so v0.265.0 missed it entirely. Fix, two halves: (1) `fs()` is now COMPRESSION toward a pivot — sizes below 15 close 40% of their distance to it (8.5→11, 9→11.5, 10→12, 12→13.25), 15+ unchanged; monotonic so hierarchy survives, and the big text stops inflating. (2) The management surfaces' raw literals sweep through `fs()` — CommishTools, CommishSettings, CommishKit, LeagueExtras, TradeCenter, Team — fontSize AND lineHeight together (a scaled font under a literal lineHeight clips). Game surfaces still deliberately unscaled. Full battery green + APK 26600.

2026-08-17 — **THE APP'S TYPE GETS ITS PHONE SIZE** (`v0.265.0`, no migration, app only): founder — "the font could use a bump up in the app though." The app's sizes were ported 1:1 from the web's CSS pixels, and what reads at arm's length on a laptop is squinty at phone distance — Mono 8.5/9/10pt everywhere. One knob, not 445 edits: `TYPE_SCALE = 1.15` + `fs()` in `theme.native`, applied INSIDE the primitives (Mono — size, lineHeight, letterSpacing together — Display, Chip, PrimaryButton, LinkButton, PosPill, and the Overlay sheet's title/subtitle), so all ~510 prim call sites bump at once and future callers ride the scale automatically. Raw `<Text>` sites on the game surfaces (the board, the field, score digits) are DELIBERATELY not scaled — those layouts are tuned to the pixel; they get bumped individually or not at all. Quarter-point rounding keeps line heights crisp (8.5→9.75, 10→11.5, 12→13.75, 17→19.5). Full battery green + APK 26500.

2026-08-17 — **THE COMMISH MAP GOES SHEET-FIRST** (`v0.264.0`, no migration, app only): founder, from a screenshot of ⚑ COMMISH — "fold everything in the settings tab into a chip below and follow the same pattern… mirror what we have in the mobile web view but just make it a pop up from below per the mobile app style." The monolithic ⚑ SETTINGS overlay (waivers + FA + trades + roster rules + playoffs + board visibility stacked in one sheet) is GONE as a destination: its slices join the chip map as ⇄ WAIVERS & TRADES (SET UP), 🏆 PLAYOFFS (RUN THE SEASON) and 📣 LEAGUE BOARD (ENGAGE) — the same sections the web console names — via a `view` prop on `CommishSettings` (shared loads and save paths untouched, so the changed-fields-only FAAB-reset guard survives). And every chip now opens its section as a BOTTOM SHEET (`Overlay`) instead of rendering inline below the map: the map is the screen, a destination pops up from the thumb edge and slides away, exactly the web's tap-into-a-lone-panel pattern translated to the app's own idiom. No default section — map-first, like the web hub. Full battery green + APK 26400.

2026-08-17 — **THE CONTINUITY AXIS + THE SUPER BOWL GATE** (`v0.263.0`, migration 0185, core + both hosts): two founder messages in one sitting — "add a section where you select redraft/keeper/dynasty… keeper: pick the number of keepers; dynasty: pick the number of rookie draft rounds. The game then assigns the rookie picks for the next three years. Allow this selection on league creation." and "season roll over is just an option that appears after the super bowl." **The axis**: REDRAFT / ★ KEEPER / 🏰 DYNASTY is one selection (`set_league_continuity`, `settings_json.continuity`) living in 🎮 MODE & SEASON on both hosts AND on both create forms (replacing v0.262.0's checkbox) — keeper takes its keeper count, dynasty takes its rookie-round count (keepers implied: roster − rounds, computed at set time) and **deals every team's picks for the NEXT THREE SEASONS** as tradeable assets; rollover carries all future seasons' assets (trades intact) and re-provisions so the horizon stays three years. Switching to redraft/keeper deletes untraded futures and refuses while any is traded. `league_continuity()` derives the mode for pre-0185 leagues, so nothing existing loses behavior or badge; `_clean_trade_picks` takes a per-element season (omitted = next season — old callers exact), and the trade composers list all three seasons' picks ("2028 R1 (Team 3's slot)"). **The gate**: `_season_over` = Feb 15 of season+1, safely past any Super Bowl; `rollover_league` refuses before it (admins bypass — off-season testing must stay possible) and both dynasty panels show "🏈 opens after the Super Bowl" instead of the button, with keeper declarations and pick trades running all season. The 🔁 NEXT SEASON panels lost their setters (summary + pointer to MODE) and keep declarations/preview/pick-map/rollover. **Also fixed: a real probe flake caught red-handed** — dy4a's over-the-cap list used the literal `'p01'`, which roster 2 sometimes legitimately DRAFTED under the random order, collapsing 3 declared slugs to 2 distinct and sailing under the cap (~1-in-4); a guaranteed-distinct middle player replaces it, and rollover-exercising fixtures moved to past seasons (2024) to live with the gate, with a 2026 league probing the refusal. ★ KEEPER badge joins 🏰 DYNASTY on both hosts' league cards. Full battery green (three consecutive full-suite runs) + APK 26300.

2026-08-17 — **DYNASTY AT CREATION + THE BADGE** (`v0.262.0`, migration 0184, core + both hosts): founder — "let's make it a setting on creation and badge it so it's clear that it's dynasty." Dynasty stays a SETTINGS-derived identity (keeper_count / rookie_rounds, editable all season in 🔁 NEXT SEASON); what's new is the front door and the label. `create_native_league` gains `p_dynasty` (old 13-arg signature dropped — the 0175 overload trap): checking 🏰 DYNASTY on either host's create form presets the conventions — keeper_count = roster − 3 ("keep everyone but the rookie-draft spots"), rookie_rounds = 3 — stamps `settings_json.dynasty`, and DEALS the first generation of pick assets on the spot, so futures are visible and tradeable from day one; the create button, busy note and confirmation all name it ("CREATE 🏰 DYNASTY ◈ DRIP LEAGUE →"). `league_is_dynasty()` is the ONE badge predicate — the creation stamp OR either live setting — so leagues that turned dynasty on through the panel before this migration badge correctly; `my_teams` and `keeper_state` carry it. Badges: 🏰 DYNASTY chip on the my-leagues cards (web LeagueCard chip row, app Leagues row) and a 🏰 DYNASTY LEAGUE header on both commish dynasty panels. 9 new probes (pk12*: presets, dealt futures, stamped + settings-only + plain predicates, my_teams carriage). Full battery green + APK 26200.

2026-08-17 — **DYNASTY PHASE 3: TRADEABLE PICK ASSETS** (`v0.261.0`, migration 0183, core + both hosts): the founder's follow-up — "dynasty needs rookie draft rounds and assigned rookie draft picks per team. These are tradeable picks." `pick_asset` rows are (league, SEASON, round, original seat) → owning seat; the season tag is what lets one table serve a pick's whole life: on league L (season S), S+1 rows are the TRADEABLE FUTURES; at rollover they COPY to the new league where the tag now equals the league's own season — the exact rule `_start_draft_now` uses to find "the assets for THIS draft" — and S+2 futures re-provision from the carried `rookie_rounds` setting, so the cycle continues by itself. **Provisioning**: `set_rookie_rounds` (commish, 0–10) deals one asset per seat per round; growing adds, shrinking refuses to delete a round holding a traded pick (someone's acquired property). **Trading**: `trade_proposal` gains `give_picks`/`get_picks`; `propose_trade` validates ownership both ways, `execute_trade` RE-validates (a pick that moved between accept and execute fails the trade, which stays pending — probed with two deals offering the same pick) and flips `owner_roster`. Picks occupy no roster spot, so the cap rules are untouched; a lopsided player count still refuses. **The draft honors ownership**: at start, assets for the league's own season build `draft.pick_owners` — an explicit per-overall owner list, LINEAR rounds in the base order (the dynasty convention; snaking would relabel every asset's slot) — and `draft_on_clock` returns the owner instead of the snake seat; completion keys on the asset count; a team that traded for extra picks drafts past its cap into the existing over-limit lockout. No assets ⇒ byte-for-byte the 0182 snake behavior (the dynasty suite re-passes untouched). UI: ⛏ DRAFT PICKS checklists inside both hosts' trade composers, pick lines in trade rows ("⛏ 2027 R1 (Team 3's slot)"), and a ROOKIE DRAFT PICKS section (rounds setter + per-team ownership map) in both commish dynasty panels. `pick-asset-probes.sql` is the 35th scratch suite (22 assertions). Full battery green + APK 26100.

2026-08-17 — **DYNASTY PHASE 1+2: SEASON ROLLOVER, KEEPERS, AND THE ROOKIE DRAFT** (`v0.260.0`, migration 0182, core + both hosts): the founder's next arc, built WITH the two checked schema facts — `draft.league_id` is the PK (one draft per league row) and `league` is `unique(sleeper_league_id, season)` — so a new season is a NEW league row at season+1 with its own draft slot for free. `rollover_league` (commish, post-draft-complete): clones the league to season+1 (same `sleeper_league_id`, settings/scoring/spec wholesale, commissioner, seats with their managers and team names), carries KEEPERS onto `native_roster` as `acquired='keeper'`, copies the pool (waiver clocks cleared), inserts a fresh pending draft, and generates the 14-week schedule; the response NAMES the game mode it carried (the v0.251.0 rule) and both hosts' confirms say ◈ DRIP / 🏈 NORMAL out loud. Keepers: `settings_json.keeper_count` (`set_keeper_count`, 0–rounds−1), managers declare via `set_keepers` on their TEAM screen (`keeper_pick`, FK into `native_roster` so a dropped player self-retracts), `_keeper_resolve` fills undeclared seats top-N by pool rank — ONE function serves the preview (`keeper_state`) and the rollover, so the screen shows what the rollover does. **The rounds/cap split that made it cheap**: `draft.rounds` stays ROSTER SIZE (every cap consumer — adds, waivers, trades, auction spots-left — untouched); new `draft.keeper_slots` teaches only the PICK-COUNT logic — snake completes at (rounds−keepers)×teams (`native_exec_pick`), `_start_draft_now` counts FREE pool players against picks actually made, `draft_state` reports effective rounds (+`keeper_slots`/`roster_size`); auctions already complete off spots-left, which counts keepers by itself. **Rookie draft falls out** (`p_rookie_only`): the new pool carries keepers only, `pool_filter` pinned `{max_exp:0}` (0171 machinery), and the draft refuses to start until the rookies-only reseed — which no longer eats keepers, because `seed_league_pool`'s delete-all used to CASCADE through native_roster's FK (found by reading, fixed and probed). Wallets deliberately NOT copied — fresh season seed at ◎0, funded by the copied `weekly_budget`. Seat agents re-provision on their own (0180 is season-agnostic; `seat_agent` is `unique(agent_user_id)` so agent seats copy as open). Web: 🔁 NEXT SEASON panel in the league console + ★ KEEPERS card on TeamManage; app: same pair (CommishTools + Team). 22-assertion `dynasty-probes.sql` is the 34th scratch suite (declared-beats-rank, double-rollover refusal, frozen declarations, cap-vs-picks split, mock refusal, reseed survival). Function bodies copied from LIVE migrations (0071/0172/0177), checked not remembered. Full battery green + APK 26000 (playtest-signed, arm64 — the JDK-17 toolchain gap from the v0.169.0 ops note hit again and was reinstalled ad hoc).

2026-08-17 — **THE COMMISH TOOLS GET A MAP** (`v0.259.0`, no migration, both hosts): founder — "all the commish tools on mobile web and app are still pretty awkward to navigate." The awkwardness was DIFFERENT on each host, which is why it felt pervasive. (1) **Mobile web**: under 900px the league console's side rail collapsed into ONE native `<select>` holding ~17 destinations — every move was open → scan seventeen rows → pick, with no visible map — and the panels were designed at desktop width, so a wide grid pinched into 375px pushed the card off the screen edge (the "settings card nearly flowing over" report). Now: `NavHub`, a grouped TILE GRID — the whole map on screen at once, one tap into a panel that renders alone with a "⊞ ALL SETTINGS · <section>" chip back; the narrow panel body is overflow-safe (wide content scrolls inside its own box, the page never scrolls sideways); hub-first only when no explicit landing tab (post-create still lands straight in the draft room). (2) **The app**: its map was fine (8 destinations, wrapped chips) but 🎮 MODE & SCORING was one ~350-line mega-scroll — mode toggle + the roster builder + the ~36-knob catalog stacked, the knobs two screens below the fold. Split into 🎮 MODE / 🧩 ROSTER / ⚖ SCORING, matching the web rail — one `view` prop on the existing card (the same shape as web LeagueSettings), shared state untouched. (3) **One name across hosts**: web MEMBERS → 👥 SEATS (the app's word, and the founder's, all session). Verified in a browser at 375×720: the hub shows all groups with no horizontal scroll, tap-in renders the lone panel with the back chip, tap-back restores the map — screenshots in session. Full battery green + APK 25900.

2026-08-17 — **TEAM UNITS PASS TENURE BANDS** (`v0.258.0`, no migration, core + both hosts): the inconsistency flagged during the waiver work (v0.243.0). `tenureMatches` answered NO for a D/ST on every band — its `exp` is unknowable, and unknown proves nothing — while `slotAllows` EXEMPTS team units from a spot's tenure window for exactly that reason. So the engine let a D/ST fill a rookies-only spot while the waiver wire's ROOKIES chip hid every D/ST: the wire could not show you the units the league's own spots would accept. Fix: the SAME set, the SAME rule — `tenureMatches` takes an optional `pos` and a team unit (K/DEF/HC/P, case-insensitive) matches every band; both hosts' waiver filters pass it. A skill player with unknown tenure still proves nothing, and a known one still lands in his own band only — 4 new assertions (110 in the suite). Full battery green + APK 25800.

2026-08-17 — **A FROZEN LINEUP MAY SHRINK FROM THE END, AND NOTHING ELSE** (`v0.257.0`, migration 0181, SQL + one line of commish copy): HANDOFF NEXT #6. The spec freeze at draft start (0174) is right in general — slot names are positional, so any edit that shifts a position silently reassigns every saved lineup beneath it — but it had one stuck state with no exit: a league with MORE STARTING SPOTS THAN DRAFT ROUNDS can never field a full lineup, and once the draft starts nothing could fix it. The hatch is exactly as narrow as the hazard allows: post-draft, the ONLY accepted edit is a STRICT PREFIX of the stored spec — same spots, byte for byte in their CLEANED form, one or more removed from the END. A tail spot is the only one whose removal shifts nothing; dropped-tail rows become inert (the resolver and boards iterate the spec). Everything else — grow, reorder, edit a survivor, flip a best-ball flag, clear the spec — stays refused, each with a message that says why. The comparison runs cleaned-vs-stored so cosmetics (key order, lowercase tokens, implicit bb:false) can't fail a legitimate shrink — probed with a lowercase `[{"pos":["qb"]}]` shrinking a frozen `[{QB},{RB,bb}]`. Function body copied from 0174's LIVE definition, checked not remembered (the 0178 trigger bug came from editing a stale copy). No UI change needed — the commish editor never hard-gated; the RPC's message IS the UX — one helper-copy line now mentions the hatch. sb11 flipped from "frozen" to the seven-probe hatch block (same-spec refused, grow refused, prefix-length edit refused, bb flip refused, clear refused, legal shrink lands and stores, grow-back still refused). Full battery green; no client bundle change beyond copy, no APK.

2026-08-17 — **THE MODE IS SAID WHERE THE GAME IS PLAYED** (`v0.256.0`, no migration, both hosts): HANDOFF NEXT #4, plus a retirement it exposed. The ◈ DRIP / 🏈 NORMAL chip lived on web LivePicks only — and tracing its mounts (v0.253.0) showed that screen is DEAD CODE: nothing imports it; the web's game runs through Matchup.tsx, which took over at v0.234.0. So: (1) **Matchup.tsx gets the chip** beside the week strip — by that point in the render a classic league has already returned to ClassicBoard (which names itself in its own header), so the chip is a statement, not a switch: ◈ DRIP, with the settings pointer in its tooltip, live leagues only (the demo has no mode to read). (2) **The app's board gets it too**, in LivePicks' WeekNav, following the gameMode state. (3) **Web LivePicks.tsx is deleted** — 1,200 lines of unmounted screen that cost a parity patch two versions ago; both hosts compile without it, which is the proof nothing used it. Its useful organs had already been transplanted (ClassicBoard, boardParts); git history keeps the rest. Full battery green + APK 25600.

2026-08-17 — **THE LEAGUE BOARD COMES TO THE WEB** (`v0.255.0`, no migration, web): HANDOFF NEXT #5 — browse/post/join was app-only, "the mirror of the invite-code gap, and it costs signups on the marketing surface," which is exactly where the ads funnel lands people. New `src/screens/LeagueBoard.tsx`, wired into LiveOnboard as its own view and a new ungated "Find me a league →" choice on BOTH RoleChooser mounts (the join RPC gates server-side; the browse surface is the acquisition surface and hides from nobody). Same RPCs as the app's Recruit (`league_board` / `league_preview` / `join_from_board` / `post_league_listing` / `close_league_listing`), so the listings, the no-invite-code rule and the seat logic stay one implementation with two faces. Browse shows seats/draft/blurb with the caller's own leagues marked JOINED; LOOK INSIDE opens the 0156 preview — game mode chip (◈ DRIP / 🏈 NORMAL), scoring line, seat map with taken teams struck through — and claims with an optional team name; commissioners get the posting half at the bottom, native leagues only (the board's promise is a claimable seat). Verified in a browser against a mocked API: listings render, the preview opens with the NORMAL chip and seat map, claim writes `join_from_board(league, team)` once and the success banner lands. Full battery green; web-only, no APK.

2026-08-17 — **THE SEAT AGENT** (`v0.254.0`, migration 0180, worker + resolver): the durable half of the unclaimed-seat decision — v0.248.0 computed those lineups at scoring time; this gives them ROWS. One synthetic user per unclaimed classic seat (`seat_agent`, provisioned by the worker via the same admin-API pattern `seedTestUsers` established), and the auto-slot writes sealed_pick rows AS the agent — so the per-player kickoff seal freezes them, the boards read them like any manager's, history is STORED rather than recomputed, and a projection re-bake can no longer rewrite a lineup mid-week. **THE MAPPING LIVES BESIDE MEMBERSHIP, NOT IN IT**: everything that offers a seat keys on `app_user_id IS NULL`, so seating the agent there would make every league read as full — the membership row stays NULL and only the worker and resolver ever look. One agent per seat, not a house bot, because sealed_pick's unique key and seat attribution both tell home from away BY AUTHOR — a shared bot holding both sides of a matchup would collide with itself. **AN AGENT IS A DILIGENT MANAGER, NOT A TUESDAY SNAPSHOT**: its unlocked rows are the worker's own prior writes, never decisions, so they re-plan at current values every tick — a player ruled Out on Friday drops from Sunday's spots exactly as a careful human would drop him — while LOCKED rows stand and reserve their players (the seal is the seal). Human seats keep fill-only-empty semantics untouched. **THE CLAIM TRANSFERS**: any path that sets `league_membership.app_user_id` fires `transfer_agent_lineups` — locked history arrives under the human's name, unlocked rows arrive as a set lineup to adjust, the human's own rows win collisions on a re-claim, and the mapping retires. Transferring only `app_user_id` is exempt from `enforce_window_lock` by that trigger's own changed-fields rule (0178:143), so locked rows move without fighting the late-swap guard; the distinct-spots bound keeps `enforce_slot_cap` satisfied throughout. Resolver attribution passes agent uids into `assignSealedRows` explicitly — the case that forced it is BOTH seats agent-held, where two foreign authors would otherwise be ambiguous orphans and both lineups would silently field nothing. The v0.248.0 computed fallback remains as the graceful floor for a seat the worker hasn't agented yet. 12 SQL probes (`seat-agent-probes.sql`, in the scratch suite); `classic-autoslot-diag.sql` now shows has_agent and counts agent rows. No client code changed — APK skipped per ritual (apps/mobile untouched). Full battery green.

2026-08-17 — **TWO SMALL DEBTS FROM THE AUDIT** (`v0.253.0`, no migration, core + web): the last two items from the v0.246.0 BAKED_SLUGS audit and HANDOFF NEXT. (1) **`myRoster()` REFUSES rather than guesses.** It was `limit(1)` with no ORDER BY — an arbitrary enrolled membership, different between calls at the database's whim — and it is the fallback every board uses when no leagueId reaches it, so "my matchup" could quietly open a league you did not mean and be perfectly correct about it, which reads as wrong data rather than wrong league. Now: one enrollment → that league; more than one → null, same as none, and the caller's no-board state stands. Refusing is the point — an ORDER BY would be stable and still a guess (HANDOFF #3; v0.231.0's league-name chip was the visibility half). Mapped the mounts first: every live path passes leagueId/rosterId explicitly (web plays through Matchup.tsx → ClassicBoard with liveCtx; the app's LivePicks gets both from App.tsx), so the fallback is dormant belt-and-braces everywhere and the behavior change is safe by construction. (2) **Web LivePicks catches up on 0200.1**: `poolToPlayer` read team from the bake alone (a 2026 rookie renders an empty chip; the app has read `p.team ||` since v0.240-era) and the screen never installed the pool's meta into `slugMeta` (the app has since v0.245.0). Both fixed — noting honestly that this screen is currently UNMOUNTED on web (Matchup.tsx took over drip; LivePicks survives as the reference the next screen copies), so this is parity in the copy-source, not a live fix. Full battery green + APK 25300.

2026-08-17 — **THE FILLS LEARN THE CALENDAR** (`v0.252.0`, no migration, core + worker + both hosts): the short-term half of the unclaimed-seat decision (founder chose this over placeholder users). `PROJ_2026` is a SEASON constant — it knows neither byes nor Friday's injury report — so every auto-fill that ranked by it raw would seat a 20-point projection who is guaranteed to score zero: the worker's Tuesday auto-slot, the boards' on-open fill, the best-ball preview, and the unmanaged seat's computed lineup, which is the worst of them because no manager exists to fix it. New `slateAwareProj(week, slate, ruledOut?)` in core: the projection, zeroed only on EVIDENCE, under the house no-guess rule. BYE requires a KNOWN team absent from a LOADED slate — an unknown team is never a bye, an empty slate zeroes nobody, and teams normalize on BOTH sides because the pool says LAR/WSH/JAC where the slate says LA/WAS/JAX (un-normalized, every Rams player would have read as a phantom bye — probed). RULED OUT comes only through the caller's own predicate, and DELIBERATELY NOT `injuryFor` by default: that helper falls back to the BAKED 2025 report when no live feed is installed and the season was never set — which is exactly the worker's resting state, so a built-in default would have benched 2026 players for last year's injuries. O and IR only; Q and D still play too often to auto-bench. WIRING: the worker's auto-slot takes the tick's slate and reads its own `injury_status` poll; the resolver passes a `ruledOut` set through `ClassicSide` so an unmanaged seat benches an Out player at scoring time; both boards build one memoized `fillValue` from their own slate + the live injury feed and use it in all three fill sites (on-open write, unmanaged fallback, best-ball preview). The boards' WRITE path now also gates on a loaded slate — rows written bye-blind would stand forever, and the worker fills within a tick if the client never gets a slate. 12 new assertions (106 in the suite), the keepers being the claims it must NOT make. Full battery green + APK 25200.

2026-08-17 — **THE CREATE FORM NO LONGER GUESSES THE GAME** (`v0.251.0`, no migration, both hosts): HANDOFF NEXT #2. Both create forms opened with `useState<'drip' | 'classic'>('drip')`, so a commissioner who never tapped 🏈 NORMAL got a DRIP league with a normie name — which is exactly how the founder's own "Normie Test" happened, and the choice FREEZES at the draft, so the mistake is permanent. Now there is NO DEFAULT: `game` starts null, the form refuses to submit until one is chosen, and the helper copy says why ("this is the choice that decides what your league plays, and it locks in at the draft"). THE CONFIRMATION LIVES IN THE MOMENT OF COMMITMENT rather than a dialog after the fact: the button itself names what it will create — "CREATE 🏈 NORMAL LEAGUE →" / "CREATE ◈ DRIP LEAGUE →", "PICK A GAME TO CREATE" while nothing is chosen — the busy note names it ("Creating your NORMAL league…"), and the app's success toast names it ("…, a 🏈 NORMAL league — you're its commissioner"). MOCKS ARE EXEMPT by design: a mock is a draft with no season behind it, so the game choice (a season property) doesn't apply — it drafts the drip shape without asking, exactly as before. The roster-shape footer no longer presumes either: with nothing picked it says the shape follows the game rather than showing drip's. Verified in a browser: named league + no game → disabled "PICK A GAME TO CREATE"; each chip renames the button; switching to MOCK re-enables with "🤖 START THE MOCK →". Full battery green + APK 25100.

2026-08-17 — **THE BEST-BALL FILL IS EXACT** (`v0.250.0`, no migration, core): the fix v0.247.0 flagged and deliberately deferred — `bestballFillBy` still ran the most-specific-first greedy whose optimality argument ("every flex's eligibility is a superset of the dedicated slots it follows") stopped being true the day 0172 gave a spot its own player filter. That greedy is in the RESOLVER: a best-ball league with a rookies-only flex was scoring 20 where 38 was available, every week. Deferred because it changes scores; shipped NOW because pre-season is the only window where changing scores is free — nothing has resolved yet, and after week 1 this same fix would rewrite history. **IT CANNOT RIDE `optimalLineup`**, which is the interesting part: the matroid greedy needs each player to be worth ONE number, and a RET spot (0171) values a player by his RETURN production while a flex values him in full — per-PAIR values are a general assignment problem, not a matroid. So the new `assignByValue` runs SUCCESSIVE MOST-PROFITABLE AUGMENTING PATHS (Bellman–Ford, ~20×30 boards, microseconds), whose classic invariant — after k augmentations the matching is the most valuable one of size k — lands exactly on best ball's own promise, lexicographically: every flagged spot that CAN fill does, THEN the total is maximal. A spot never stands empty to protect a total, and a lone negative-scoring player still fills his spot, both exactly as the greedy behaved. Equal-total arrangements are canonicalized toward the old shape (the more specific spot keeps the bigger name), so the exact fill never LOOKS different from the greedy except where the greedy was leaving points on the table. The RET interaction the per-slot values exist for, verbatim in the probes: star A (20 from scrimmage, 8 returning) and role-player B (6 and 6) — the greedy hands the RET spot its best returner and banks 14; the exact fill has B return so A's 20 counts in the flex, 26. 16 new assertions (94 in the suite): a 400-case brute force under the lexicographic objective with per-slot AND negative values, determinism, and the retired greedy re-implemented inline purely to prove it loses 34 of those cases — a check nothing can fail is decoration. The v0.247.0 probe that asserted the greedy STRICTLY LOSES the rookie-flex case now asserts the fill FINDS the 38. Both hosts and the worker share the one function, so no host code changed. Full battery green + APK 25000.

2026-08-17 — **THEIR BENCH TOO** (`v0.249.0`, no migration, both hosts): founder — "let's show the opponent bench as well in the match up screen." The board's own model has carried `bench: { home, away }` since v0.228.0; both hosts passed `[]` for away and left a comment explaining why — "the opponent's bench is not readable pre-lock (and shouldn't be)". That reasoning expired at 0178, when classic lineups became OPEN all week, and expired twice over at v0.248.0, which fills an unmanaged seat's starting spots from that very roster. There was nothing left to withhold; there was just a column nobody had wired up. Rows pair by INDEX and nothing more — two benches are two lists, so whichever side runs out first leaves its half of the row empty rather than stretching to match. **A DISPLAY BUG FELL OUT OF IT.** The bench was derived from the STORED picks (`pool` minus `used`, where `used` is manual starters only), and a best-ball spot's occupant has no stored row of his own — so he rendered in a starting spot AND under BENCH at the same time. Since v0.248.0 an unmanaged seat's auto-filled starters would have done it on every row of every unclaimed team. Both hosts now derive it from the EFFECTIVE lineup, which is the set actually starting. Web keeps the full game card per side; the app keeps its compact row and mirrors the STARTERS column widths so the two cards read as one board rather than two tables. Verified in a browser against an eight-man opponent roster with nothing stored: five of theirs seated, three benched beside my one, and the ragged rows read as ragged rather than broken. Full battery green + APK 24900.

2026-08-17 — **THE SEAT NOBODY MANAGES** (`v0.248.0`, no migration, core + worker + both hosts): founder, from his own board — "should my opponent's lineup be set?" It should, and it wasn't, and the diagnostic said why in one column: `has_user = f` on **seven of eight seats in both leagues**. `sealed_pick.app_user_id` is `not null references app_user(id)`, so a seat with no claimed manager has NOWHERE to store a lineup — v0.247.0's auto-slot skipped every one of them on a branch written off as an edge case (`if (!uid) continue`). Rosters were fine, 11–15 active players each; the picks table simply couldn't hold their lineups, and every unclaimed team was losing 0–x each week with a full roster on the bench. **THE FIX IS TO NOT NEED THE ROW.** `PROJ_2026` is a baked constant, so "the best lineup this roster can field" is the SAME ANSWER all week — which means it can be computed at scoring time instead of stored. `classicLineup` now fields it for any side with no stored rows, so the boards and the resolver reach it through one function and cannot disagree; `optimalLineup` went generic (`<T extends SpotPlayer>`) so the engine gets real `Player`s back rather than a cast the compiler stopped checking. **IT FIRES ONLY WHEN THE SIDE STORED NOTHING**, which is what keeps it from ever overruling a manager: the worker writes rows for every claimed seat, so a seat with rows is a managed seat and everything it stored stands — including a spot cleared on purpose. That distinction needed care on the server, because every path into the resolver has already dropped rows with a null `player_slug`, so a manager who emptied every spot arrives looking exactly like a seat that never had a lineup. Lifting that filter is the tidier fix and is NOT safe — the same rows feed the drip paths, where "no rows" means AI-rebuild and "rows, none locked" means field nothing — so classic asks its own question, once per matchup, and only when a side already looks unmanaged. Two supporting changes: the resolver loads classic rosters for EVERY matchup rather than only best-ball ones (both auto-fills read them now), and both boards load the opponent's pool unconditionally — it was behind `if (bestball.length)`, so an opponent's roster never reached the screen at all. 11 assertions (89 in the suite), including the one that keeps it honest: a MANAGED seat that emptied every spot still fields nothing. Verified in a browser against an opponent seat holding a roster and zero rows: THEM went from **0.0 to 85.7** with a full lineup — Hurts, Robinson, Hampton in the rookies-only flex, Wilson — while the managed side's stored picks were left untouched. KNOWN AND ACCEPTED: re-baking `proj2026.ts` mid-week would retroactively change an unmanaged team's lineup, since nothing is frozen against it and freezing it would need the row we haven't got. Full battery green + APK 24800.

2026-08-17 — **EVERY TEAM STARTS THE WEEK WITH A LINEUP** (`v0.247.0`, no migration, core + worker + both hosts): founder — "let's auto-slot the optimal projected line up for each team each week, then allow players to adjust." A classic team used to begin every week EMPTY: a manager who never opened the app scored an honest zero, and an opponent's board was nine dashes. Now the worker sets every team's lineup from its own roster, ranked by projection, and the manager adjusts from there — normal fantasy, where the lineup is already set and you tweak it. **THE ALGORITHM IS THE POINT, AND THE OBVIOUS ONE IS WRONG.** The obvious answer is `bestballFillBy`'s: walk spots most-specific-first, give each its best remaining player. Its own comment argues that greedy is optimal "because every flex's eligibility is a superset of the dedicated slots it follows" — true when written, false since 0172 gave a spot its own player filter. Spots [RB, FLEX(rookies only)] with a rookie RB projected 20 and a veteran RB projected 18: RB is more specific, goes first, takes the rookie, and the rookies-only flex is left holding a veteran it cannot legally seat. 20 points where 38 was available. So `optimalLineup` is a MAXIMUM-WEIGHT assignment with an exact answer that costs one sort on top of the matching `assignSpots` already does: the simultaneously-startable sets are the independent sets of a **transversal matroid**, greedy is optimal on a matroid, and Kuhn's augmenting paths never un-seat anyone — so feeding players in descending value order IS the greedy. Provably the highest-scoring legal lineup, and because projections are non-negative, also a maximum-SIZE one. **THE SAFETY ARGUMENT IS ONE DISTINCTION**: a spot with NO STORED ROW has never been decided; a row holding NULL is a manager who emptied it on purpose. Only the first kind is filled, which is what makes this safe to re-run every tick and safe to run on the worker and the board at once — it can add a decision, never overwrite one. `ignoreDuplicates` makes the database enforce the same thing under a race. Scoped to the tick's own week and `status='scheduled'` (a schedule runs weeks ahead; slotting week 12 today would fill it with players since dropped and then never revisit it), rows land UNLOCKED, and a league whose commissioner set `lineup_policy='empty'` opts out — that is a policy said out loud. Both boards run the same plan on open so the manager sees a lineup rather than waiting on a tick. **TWO BUGS CAUGHT BEFORE SHIPPING.** (1) `settings_json` stores the builder spec as `roster_slots` while `leagueSlotDefs` reads `slots` — passing the raw row doesn't fail, it silently returns the DEFAULT NINE SPOTS, so every builder league would have had a lineup written against slots it does not have; `modeOfSettings` is now exported from `resolve.js` as the single mapper. (2) Both brute-force probe generators seeded a textbook LCG and drew `seed % n` — an LCG's LOW bits cycle with period n, so the "400 random shapes" were ONE shape four hundred times and the pre-existing optimality check had been proving nothing since v0.234.0. Replaced with xorshift32, and each block now asserts its own cases actually differ. 29 new assertions (78 in the suite), including a 400-case brute-force cross-check that no arrangement scores more — plus a companion assertion that the value-blind assignment loses many of those cases, because a check nothing can fail is decoration. Full battery green + APK 24700.

2026-08-17 — **THE RE-BAKE, AND WHY IT WAS NEVER THE FIX** (`v0.246.0`, no migration, core): founder — "let's re-bake". Done (`scripts/gen-player-bio.mjs`, 5363 bios from Sleeper's live directory), and the diff says the interesting thing: **24 team changes, 2 tenure changes, ZERO new players**. The bake was already current. Staleness was never Tate's problem, and re-baking would not have fixed a single rookie — which is worth knowing before the next time someone reaches for it. THE ACTUAL CAUSE: `slugMeta` resolves overlay → `BAKED_SLUGS` → `WR/''`, and `BAKED_SLUGS` is generated by `scripts/pbp/genRealPbp.mjs` from **2025 PLAY-BY-PLAY**. A 2026 rookie has no 2025 plays, so that map *structurally cannot contain him at any freshness*. Every rookie fell to the `WR/''` default — reading as a bye on the board and, because `mkPlayer` takes a position from here, being SCORED as a WR by `classicPoints`. The DIRECTORY bake (`playerBio.ts`) has known them all along, with a real position and team; nothing consulted it. It is now `slugMeta`'s second source, deliberately AFTER `BAKED_SLUGS` and never before it — that map's team is the player's MAJORITY 2025 team, which is what the baked play stream's possession gating is written against, so overruling it would quietly change how baked plays score. Team resolves through `teamFor`, so the worker's live override layer (0142) still beats the bake for anyone who has moved since. This fixes rookies on EVERY surface, not just the two boards v0.245.0 patched by hand — those pool overrides still layer on top as the most current source. Costs nothing: `PLAYER_BIO` was already in both bundles via `leagueScoring`, and the web bundle grew 0.2 kB. 6 assertions (52 in the board suite), including that a baked player still answers from the PBP bake and that a live override still beats both. Full battery green + APK 24600.

2026-08-17 — **TWO THINGS THE BOARD WAS SAYING THAT WEREN'T TRUE** (`v0.245.0`, no migration, both hosts): founder, from a screenshot — "there is no overall lock for classic. Tate does not have a bye week one." Both correct, and the second was the bigger bug. (1) **THE LOCK HEADER WAS A LEFTOVER.** Since 0178 each spot locks at its own player's kickoff, but the scoreboard still printed "LOCKS · Wed 8:20 PM" — `matchup.lock_at`, the DRIP lead, which now only decides when the matchup flips live. It reads NEXT LOCK now, computed from the earliest future kickoff among YOUR OWN starters, which is the next moment something of yours actually freezes. (2) **"C. TATE · BYE" WAS TWO BUGS STACKED.** He is `carnell-tate`, a 2026 rookie on TEN, playing in week 1. Neither ClassicBoard installed the league pool's player meta into `slugMeta` (0200.1's `setSlugMetaOverrides`, which only the app's LivePicks ever called), so any player the BAKE doesn't know resolved to `WR` with an EMPTY team — and that is not just a wrong label: `mkPlayer` feeds `slugMeta` into `classicPoints`, so a rookie RB was being SCORED as a WR on the client (the server, which has its own directory, was right). Both boards now install pool meta for their own roster and the opponent's. Underneath it sat a second fault worth fixing on its own: an empty team is in nobody's slate, so `gameFor` returned null and the board printed BYE — a CLAIM it could not support. `isBye` now demands proof, a KNOWN team and a LOADED slate, and anything else says "no game listed" instead of inventing a bye. Without that guard an unsynced slate would have called all 32 teams idle at once. 4 assertions (46 in the board suite). Verified in a browser against a fixture carrying a rookie the bake doesn't know: he reads `WR · TEN` with his real kickoff, the header shows NEXT LOCK at that kickoff, and a genuinely unplaceable player says "no game listed" rather than BYE. Full battery green + APK 24500.

2026-08-17 — **BEST BALL PREVIEWS ITSELF** (`v0.244.0`, no migration, both hosts): founder — "pre-matchup best-ball spots should auto load the highest projected eligible player not in another starting spot so we get the best projected total score." A best-ball spot fills with whoever SCORES most, so before anyone has scored it rendered empty and counted ZERO toward the projected total — a best-ball team's headline number was understated by however many spots it auto-fills, which is exactly the number a manager checks before kickoff. Pre-kickoff those spots now fill by PROJECTION and the total counts them. THE IMPLEMENTATION IS A REFACTOR, NOT A SECOND ALGORITHM: `bestballFillBy` takes the ranking as an argument and owns everything that decides WHO IS ELIGIBLE — the manual-start exclusion (the founder's 0159 rule: the manual set is what reserves players), the 0144 no_start flag, one-player-one-spot, and the most-specific-then-filtered fill order — while `bestballFill` becomes a thin caller that ranks by `classicPoints`. So the preview and the real fill can disagree about who is BEST, never about who is ALLOWED. Once the week starts it reverts to the score-ranked fill, which is what the resolver actually does. A SIDE EFFECT WORTH THE REFACTOR ON ITS OWN: `bestballFill` ranked by `classicPoints`, which needs baked play data, so this algorithm had never had a single probe in the 85 versions since 0159. Ranking by plain numbers made its SHAPE testable — 7 new assertions (49 in the suite) covering the manual-start exclusion, one-player-one-spot, dedicated-before-flex, and a rookies-only best-ball spot still getting its rookie. Both hosts mark an auto-filled spot 🎯 AUTO beside the pill, so it is never mistaken for a choice someone made. Verified in a browser: a manual RB (16.4) plus a best-ball flex that picked Nacua 21.4 over Robinson 20.8 and Bowers 15.0 — headline total 37.8 where it used to read 16.4. Full battery green + APK 24400.

2026-08-17 — **WAIVER WIRE: TENURE AND TEAM** (`v0.243.0`, no migration, both hosts): founder — "we need more filters on the waiver wire: rookie, tenure, NFL team." The pool had search + position and nothing else, so "show me the rookie backs" meant reading 400 rows. TENURE IS BANDS, NOT A NUMBER BOX — ANY / ROOKIES / 1–3 / 4–7 / 8+ — because nobody searches for "exactly six accrued seasons", and ROOKIES is the FIRST BAND rather than a separate toggle beside it: two controls over one field would sooner or later disagree about who is a rookie. The NFL-team list is built from the POOL rather than a hardcoded 32, so a league whose pool is one conference never offers a filter that returns nothing; web uses a native select, the app a horizontally scrolling strip (32 wrapped chips would fill a phone before a single player showed). THE RULE THAT NEEDED CARE, and it is why `data/tenure.ts` is a core module with probes rather than an inline comparison: **an UNKNOWN `exp` matches no band but ANY**. `exp` is null for players a pre-0172 seed never learned, and counting them as rookies would hand a rookies-only league a pool of veterans — the same no-guess rule `slotAllows` follows for a 0172 tenure-windowed spot, which matters because a commissioner can build such a spot and then has to find its players HERE. 6 assertions (42 in the suite), including that the bands tile with no gap or overlap. Verified in a browser against a five-player pool with one unknown tenure: ROOK → the rookie alone (the unknown correctly absent), 8+ → the veteran, BUF → both Bills, BUF + 4–7 → one. Full battery green + APK 24300 (which also carries v0.242.0 — its APK was superseded before it shipped).

2026-08-17 — **THE PICKER OFFERS THE WHOLE ROSTER** (`v0.242.0`, no migration, both hosts): founder — "cuts off at the bottom a bit. Let's have eligible spot players show up in the picker even if they are already in a spot not on the bench." TWO FIXES. (1) **THE SHEET CLIPPED ITS OWN BOTTOM** because I passed the picker's rows as a plain `View`. `ui/Overlay` documents exactly one contract for callers — "a sheet's body just has to be able to shrink — `flexShrink: 1` on the ScrollView" — written after this same bug took the bottom off the roster sheet's button. I read that comment while building the picker and still handed it a View. Now a ScrollView, so a long list scrolls instead of being cut. (2) **A PLAYER ALREADY STARTING SOMEWHERE IS OFFERED**, with an "in TE" marker saying where he stands. "Put my TE in the flex" used to be a two-step dance — empty the TE spot, then fill the flex — when it is one move. Choosing him MOVES him, and the rule for what happens to the spot he left lives in core as `planSpotMove` because both hosts must answer it identically: SWAP IF YOU CAN, MOVE IF YOU MUST — the displaced player backfills the vacated spot only when he is LEGAL there (a back displaced from a flex cannot drop into a TE spot), otherwise it is left EMPTY rather than filled with someone the resolver won't field. Both writes travel in ONE save; writing only the target would leave the same player standing in two spots until the next poll. Excluded from the list: the spot's current occupant, anyone taxi/IR, anyone kicked off, and anyone whose CURRENT spot has locked — he cannot leave it, so offering the move would only earn a refusal from the database. 5 assertions on `planSpotMove` (36 in the suite), and verified in a browser: the picker showed "B. Bowers · in TE" and picking him wrote `S3=bowers, S2=null` in a single call. Full battery green + APK 24200.

2026-08-17 — **THE APP'S BOARD, HALVED** (`v0.241.0`, no migration, both hosts): founder, with a phone screenshot — "No images in the app to save room. We need to make things more compact and get rid of 'proj' and just keep the number." (They also asked for position colours in the slots and immediately took it back; the slot pill has carried a position-coloured band and label since v0.229.0, which is presumably what they saw.) THREE CHANGES. (1) **NO PORTRAITS IN THE APP'S BOARD** — v0.240.0's faces land on the WEB board only. A phone's board is a dense mirrored list and a face per side buys identity the name already carries. The PICKER sheet keeps its faces: that screen exists to pick a player out of a list and has the room. (2) **HALF THE HEIGHT.** v0.237.0 gave every row an identity line plus a BOXED sub-card holding the game line and the number; on a phone that was ~200dp per starter, so four rows filled a screen. The sub-card is gone: the game line moved into the player cell as a third small line, and the number moved up beside the slot pill where it was before v0.237.0 — one flat row per spot, about a third of the height. The slot pill also came down from 84dp to 66dp, which is what gives the two names room to sit either side of it. The web keeps its sub-card; it has the width, and the two-tier row is what makes the desktop board readable. (3) **THE NUMBER LOSES ITS LABEL** on both hosts, headline totals included. Before kickoff it is a projection and after it is points — now carried by the quiet colour and by the "Yet to play" state rather than by a word that repeated what the row already said. Full battery green + APK 24100. (APK 24000 was built and NOT shipped — the founder's note landed while it was compiling and superseded it.)

2026-08-17 — **FACES ON THE BOARD** (`v0.240.0`, no migration, both hosts): the founder's "get player pictures into the board". The matchup board's rows carried name + pos · team and no portrait at all — the draft room, the picker and the setter all had one, the board never did. Each starter and bench row now leads with the player's face, placed on the OUTER edge so both sides still read outward from the centre slot pill, exactly as the names and scores do. No new imagery plumbing: web reuses `PlayerImg` (headshot → team logo → position pill, three stages, so a missing portrait costs the picture and never the row) and the app reuses its own `Face`. ONE THING WORTH KNOWING, found while checking why the fixture rendered no images: `isMarkFree()` (`data/markFree.ts`) suppresses every headshot and logo app-wide, and it is reachable three ways — `?markfree=1`, a persisted localStorage flag, and `VITE_MARK_FREE=true` at BUILD time. It is OFF by default and was off here; the board simply had no `<img>` in it. But if pictures ever go missing everywhere at once, that flag is the first thing to check, not the image URLs. Also fixed in passing: the app's `Face` was defined INSIDE the screen component, so React saw a brand-new component type on every render (and `BoardCell`, being module-level, couldn't reach it at all) — it is now module level, which is what let the board use it. Verified in a browser with the CDN stubbed, since this sandbox has no route to espncdn: 7 portraits, mirrored layout intact, no shift in the rows. Full battery green + APK 24000.

2026-08-17 — **THE PICKER COMES TO YOU, AND THE ROSTER STOPS MOVING** (`v0.239.0`, **migration 0179**, both hosts): two founder asks. (1) **THE PICKER IS A CARD OVER THE BOARD**, not a panel under it. It used to render below the whole board, so tapping a spot near the top scrolled the answer off screen — you pressed a thing and nothing appeared to happen. A spot is a question ("who goes here?"), so the answer now opens over it: a modal on web (backdrop, ✕, and ESCAPE — a dialog you can only dismiss with a mouse is one a keyboard user is stuck in), and the app's own bottom-sheet `Overlay` on mobile rather than a ported centre-card, because that prim exists for exactly this and enters from the thumb's edge. It lists ONLY what may legally go in the spot — the spot's positions + its 0172 filter, minus anyone already starting, minus anyone whose game has kicked off — with each candidate's projection, and it says so plainly when that list is empty instead of showing a blank card. A picker that offers a choice the database will refuse is a trap. (2) **A CLASSIC PLAYER STOPS MOVING WHEN HIS GAME STARTS.** 0178 froze the LINEUP; the ROSTER was still open, so `set_roster_spot` could send a back to IR at half time and `drop_player`/`add_free_agent` could cut him mid-game. THIS IS MORE THAN TIDINESS: a best-ball spot fills from the ROSTER at scoring time, so ADDING a free agent whose game had already finished would field him retroactively with his score known — the one move here that could actually decide a matchup, and it is an add rather than a drop, which is why arrivals are guarded too. IMPLEMENTED AS ONE TRIGGER ON `native_roster` rather than edits to three RPCs: fourteen places write that table (draft, free agents, waivers, trades, taxi/IR, commish tools, backup assignment), so guarding the three doors a manager happens to use today would leave the rest open — and would have meant copying three function bodies into the migration, which is exactly how 0178 nearly shipped a five-versions-stale trigger. The server (no auth uid) and admins pass through, because game ops must never jam. `classic_kickoff_for(league, week, slug)` is now the single implementation and 0178's matchup-scoped function delegates to it, so the lineup rule and the roster rule cannot drift apart about who has kicked off. 8 more assertions (27 in the suite), including the best-ball add, the server exemption, and a drip roster proving the rule doesn't reach it. Full battery green + APK 23900.

2026-08-16 — **CLASSIC PLAYS WITH THE LINEUPS OPEN** (`v0.238.0`, **migration 0178**, both hosts + worker): founder — "make opponent lineups visible pre-kickoff in classic, just like normal fantasy. Nothing is hidden or locks before kick off." Two rules classic had inherited from DRIP and never wanted, both fixed and both fenced to classic. (1) **LINEUPS ARE PUBLIC.** `sealed_pick`'s select policy — the file calls it "THE security boundary" — handed an opponent's picks over only once `locked`. That is the hidden-pick rule, and the hidden pick IS the drip game; it was never something classic asked for. Now any LEAGUE MEMBER (founder's call — normal fantasy shows every team, not just your opponent) reads any classic team's lineup, sealed or not. (2) **LATE SWAP.** The whole weekly lineup sat under the pseudo-window 'wk' and sealed the instant ANY window kicked off, so a Thursday night game froze your Sunday backs. Each spot now locks at ITS OWN player's kickoff, with NO 1-hour lead — "nothing locks before kick off" taken literally. THE FALLBACK LADDER IS THE DESIGN, and collapsing any two rungs is a bug: an empty spot and a player on a BYE never lock (nobody to be late for — this is what lets you clear a Sunday spot on Saturday); a placeable player locks at his own kickoff; a player we CANNOT place (unknown slug, or a Sleeper-imported league with no `league_pool`) falls back to the WEEK-wide rule, because unknown has to resolve to the STRICTER answer or an unresolvable slug stays swappable all week. TWO NEAR-MISSES WORTH RECORDING. First: I rewrote `enforce_window_lock` from the 0058 text and would have silently DROPPED the `week_lock_hold` escape (0134) and the 1-hour drip lead (0102) — a trigger has been redefined five times and only the LATEST body is the live one; the existing gm12a probe is what caught it. Second: I reached for `greatest()` of the incoming and outgoing player's kickoffs, which reads plausibly and is exactly backwards — swapping a player who has already played for one who plays Sunday would take the Sunday kickoff and wave it through. It must be `least`: either side having kicked off locks the write. The OUTGOING player is checked at all because otherwise you could pull a back at half time once he'd fumbled, and DELETE is checked because a delete is a swap with the second half missing. 19 assertions in a new `classic-open-lineups-probes.sql`, every one written as a pair — the classic league may, the drip league may NOT (drip still hides unlocked picks, still reveals on lock, still enforces its window lead). Worker: `sealDueClassicPicks` seals row by row off each player's team kickoff, resolving teams from `league_pool` first (the same source the trigger reads, so the two layers can't disagree) then the baked bio. Both boards now render the opponent's column all week, gate editing per row, and refuse to offer a player whose game has started. Full battery green + APK 23800.

2026-08-16 — **THE MATCHUP BOARD BEFORE KICKOFF** (`v0.237.0`, no migration, both hosts): the founder sent a Sleeper matchup screenshot — "let's use this as inspiration". The tell in that screenshot is that it is a PRE-KICKOFF board: every row reads "Yet to play" with a projection where a score will go. Ours only became a board once the week LOCKED; before that it was a bare lineup setter, which is backwards — the hours when a manager can still DO something are exactly the hours we were showing them least. The board now renders from the moment the week opens, and takes Sleeper's two-tier row: identity on top (name, pos · team, injury), a sub-card beneath with the game line, the status, and the number. THE NUMBER SAYS WHICH IT IS — `proj 15.3` quietly before kickoff, points in full once live — because a bare figure beside "Yet to play" is ambiguous precisely when someone is deciding a lineup on it. TWO DIVERGENCES FROM THE REFERENCE, both forced and both deliberate. (1) Sleeper's board is read-only because it sets lineups on another screen; this is the only lineup screen we have, so every one of YOUR rows is still a button into the picker, and an empty spot reads "+ SET · takes RB · ROOKIES ONLY". (2) Sleeper shows both lineups pre-kickoff; we cannot — `sealed_pick`'s RLS ("THE security boundary", 0001) hands out an opponent's picks only once locked. So pre-lock the row spans the full width and the card says once, at the top, that their lineup is sealed, rather than drawing a column of blanks that would read as "they haven't set one". Making classic opponents visible early is a MIGRATION and a game-rule decision, not a rendering one — flagged, not taken. THE ICONS: Sleeper's third game-line marker is WEATHER, from a forecast we don't have, so we draw only the two facts we hold — a 🏟 roof from a new hand-maintained `data/stadiums.ts` (dome / retractable / canopy / open, with Miami correctly OPEN since its canopy covers the seats) and a ☾ primetime marker derived in ET from the kickoff hour. A made-up sun icon would be worse than none. THE BUG THAT NEARLY SHIPPED: the roof table was first keyed on broadcast codes, but the slate and `slugMeta` call the Rams **LA** (`normTeam`), so both SoFi tenants would have silently answered null and never drawn a marker — `roofFor` now normalizes and a probe pins it. 16 new assertions (42 board + 31 spot). Verified in a browser in BOTH states against a fixture with a dome game, a night game, an outdoor game and a bye. Full battery green + APK 23700.

2026-08-16 — **THE LINEUP SETTER NAMES ITS SPOTS** (`v0.236.0`, no migration, both hosts): the founder, straight after v0.235.0 — "we need to do the same for the match window (lineup setting) in classic. We need the eligible positions and slot labels." The weekly setter labelled each row with the STORED slot key — `S1`, `S2`, `RB2` — which is a storage identifier, not something a manager can set a lineup against: under the position builder every spot is `S<n>`, so a ten-row lineup read S1…S10 with no clue what any of them accepted. Each row now leads with what the spot is CALLED (the commissioner's own 0174 label, else the derived one) and, underneath, what it ACCEPTS — but only the half the name doesn't already say. That distinction is the whole design: a derived name like "FLEX (RB/WR/TE)" already lists its positions and repeating them is noise, while a custom label ("Only NFC Players") hides eligibility completely, which is exactly when the positions must be spelled out; per-spot filters (0172) are in neither, so they always show ("ROOKIE RB ONLY / RB · ROOKIES ONLY", "Only NFC Players / WR/TE · PHI/LAR/ATL"). THE OTHER HALF IS DUPLICATES: the builder names every RB spot "RB", so two identical rows were indistinguishable — `slotDisplayNames` numbers repeats and ONLY repeats (RB 1 / RB 2), while the counts model's own generated RB1/RB2 are left alone. All three helpers (`slotDisplayNames`, `slotAcceptsLabel`, `slotFilterLabel`) live in `engine/classic.ts` next to the eligibility they describe, and `fltLabel` — which had been copy-pasted identically into both hosts' ClassicBoard — is now one function. One `nameOf` map per board feeds the setter, the picker AND the locked matchup board, so those three can no longer disagree about what a spot is called; the draft panel (v0.235.0) reads the same names. 8 more assertions in `check:parity` (31 total), the load-bearing one being that the accepts line names exactly the rule `slotAllows` enforces — a spot that READS differently than it BEHAVES is the bug a free-text label is one edit away from causing. Verified in a browser: the setter rows, and the picker for the labelled+filtered spot reading "SET Only NFC Players — WR / TE · PHI/LAR/ATL" while offering only the one legal bench player. Full battery green + APK 23600.

2026-08-16 — **THE DRAFT ROOM SHOWS YOUR LINEUP, NOT YOUR ROUNDS** (`v0.235.0`, no migration, both hosts): the founder's open ask — the TEAMS panel listed picks as R1..R12, which says when you took someone and nothing about what you have. It now shows each pick against the ROSTER SPOT it will fill, under the commissioner's own labels, with leftovers as BENCH and unfilled spots named. THIS IS AN ASSIGNMENT PROBLEM, NOT A RELABEL, and that is the whole reason it took a core function instead of a loop: since 0172 a spot carries its own player filter and since 0174 its own name, so eligibility sets OVERLAP WITHOUT NESTING — a player is legal for several spots and two spots can each want the one player the other needs. A first-fit walk therefore strands a starter on the bench beside an empty spot he was eligible for (spots [FLEX, RB] + picks [RB1, WR1]: FLEX goes to RB1 and the WR benches while RB sits empty), which shows a lineup the league will not field — strictly worse than R1..R12. So `assignSpots` (`engine/classic.ts`, beside `bestballFill`, reusing `slotAllows` for eligibility) is a MAXIMUM BIPARTITE MATCHING: never leaves a spot empty that some legal arrangement fills, never benches a player some legal arrangement starts. Two deliberate tie-breaks: players are processed in DRAFT ORDER and Kuhn's never un-matches a matched player, so an earlier pick can never be benched to seat a later one; and a player takes a FREE eligible spot before disturbing anyone, so RB1/RB2 land in RB/FLEX rather than being shuffled through an augmenting path. Score-free on purpose — at draft time nobody's points exist, so it answers only "who is legal where", and `bestballFill` still does the score-driven half in-season off the same eligibility. 23 assertions in `scripts/check-draft-spots.mjs`, wired into `check:parity`, including the two traps (flex-claimed-early, filtered-spot-loses-its-only-candidate) and a BRUTE-FORCE property over 400 generated league shapes: no arrangement fills more spots than the one shown — proved, not argued. A DRIP league is untouched (no starting spec to map onto) and so is a classic league whose mode read FAILS: `gm` stays null and the old R1..Rn list renders, never a guessed lineup shape. The mode/tenure reads are `alive`-guarded — the v0.232.0 lesson, applied before it could bite. Verified in a browser against a fixture league (labelled + rookies-only + team-whitelisted spots): 6/10 filled with six picks, then 9/10 with ten, the NFC-only spot correctly claiming Nacua once a plain WR opened up, bench and empty rows both rendering, no page errors. Full battery green + APK 23500.

2026-08-16 — **THE MATCHUP BOARD, APP HALF** (`v0.229.0`, no migration, app-only): the same head-to-head in the app, rendering the SAME `buildMatchupBoard` output as the site — scoreboard (crests, records + seed, live score, projected final, win bar), the per-side "yet to play" line, starters mirrored around a centre slot pill, and BENCH / TAXI-IR. Two RN-forced divergences, both deliberate: the slot pill is STACKED COLOUR BANDS behind the label rather than a gradient (RN has no gradients without a native dependency, and the information — a FLEX reads as the set of positions it accepts — survives the change intact), and the mirrored row is flex rather than grid. Pre-lock is untouched on both hosts: that screen is a LINEUP SETTER, and the old editable grid remains both the pre-lock tool and the fallback when the board can't assemble. OPEN BUG, reported by the founder mid-build and NOT yet fixed: "matchup screen in normie mode is still the card board" in a normie test league. What I verified rather than guessed — the APP's LivePicks branch (`gameMode === 'classic' && roster` → ClassicBoard) reads correctly, and the web's LivePicks branch does too; but `src/screens/Matchup.tsx`, which serves the web's `matchup`/demo routes, has NO game-mode branching at all, so anything reaching the board through that route gets the drip card board regardless of league mode. That's a confirmed defect. Whether it explains the founder's app sighting is NOT established — it needs to be narrowed to which screen/tab was open, since the app path I can read looks right. Next session: reproduce, then fix the routing rather than the board.

2026-08-16 — **THE MATCHUP BOARD, SITE HALF** (`v0.228.0`, no migration, web-only): the renderer on top of v0.227.0's engine, built to the founder's Sleeper reference. Once a classic week LOCKS, the board becomes a head-to-head: a scoreboard with both crests, names, records + standings seed, live score, PROJECTED final, and a win bar; a "yet to play (N) — 2 QB, 2 RB, 4 WR" line per side; starters as mirrored rows reading outward from a POSITION-COLOURED SLOT PILL down the middle (a FLEX shows the colours of everything it accepts, so it reads as a set rather than a word); each player carrying pos · team, an injury tag, and their game line ("Sun 1:00 PM @ CIN", or BYE in the warning colour when the slate has no game for their team); then BENCH and TAXI/IR. PRE-LOCK IS UNCHANGED ON PURPOSE: that screen is a LINEUP SETTER, and replacing it with a read-only head-to-head would take away the one thing you opened it to do — so the new board renders only when locked, with the old grid still the fallback if the board can't assemble. THE ONE HEURISTIC, named because it is one: the slate carries no status column, so a game is treated as FINAL 3h20m after kickoff. Without SOME end signal `entryState` calls every started game 'live' forever, which keeps the projection floating instead of settling on the real score — the one thing a finished matchup must not do. 3h20m is the long side of a game including stoppages; erring long means an overtime game stays live rather than being called early. New reads are all optional and degrade to a quieter row rather than a blank board: a slate the worker hasn't synced costs the game line, not the scores. Verified in a browser against a fixture with a done / live / bye starter and an EMPTY opposing slot: crest fallbacks, records, the win bar, three-colour FLEX pill, BYE in warn, "Empty" where a slot was never set, no page errors, no overflow. Full battery green (parity now includes the 26 board assertions). NEXT: the same board in the app.

2026-08-16 — **LEAGUE CREATION IN THE APP** (`v0.226.0`, no migration, app-only): founder — "let's do league creation in the app", the last big web-only feature. A START YOUR OWN LEAGUE card on the board screen runs the whole three-step flow the web does — `create_native_league` → `seed_league_pool` (built on-device via `buildDraftPool`, which the app already used for pool reseeds) → `native_generate_schedule` — with live progress on the button, because pool building is the slow part and a silent spinner reads as a hang. THE FORM IS THE POST-v0.221.0 TRIM, not the old one: game type, name, teams, draft type, pace, clock, and nothing else, because everything else has a setter afterwards and the app now has those too (v0.224.0). Roster size and position limits are DEFAULTS the game type picks — drip 12 with the pre-0071 limits, classic 15 with none — exactly as on web, so the two hosts create identical leagues from identical answers. GATED like the web's button, on `myFeatures().native` OR admin, rather than showing a door the server would shut. THE THREE STEPS FAIL SEPARATELY AND SAY SO: a league whose pool failed can't draft and one whose schedule failed has no season, but both still EXIST — so each step names its own recovery ("reseed it from the draft room", "regenerate it from ⚑ COMMISH") instead of a generic failure that leaves a half-built league looking like nothing happened. Placed on the board screen beside the invite-code and commissioner-code boxes rather than on its own screen: that screen is already where the app answers "how do I get into a league", and a separate one would split the question in two. ALSO FIXED, found while wiring it: the leagues empty state still read "Join with an invite code at dripfantasy.com" — true when written, wrong since v0.225.0, and it would have pushed every new user straight back OFF the app past the two features that had just landed. It now points at the board with a button. Full battery green + APK 22600. REMAINING WEB-ONLY: the super-admin console (correctly a desktop tool), the manual per-team K/DEF picker, and mock drafts.

2026-08-16 — **THE APP CATCHES UP — AND AN ONBOARDING DEAD END** (`v0.225.0`, no migration, app-only): founder — "let's keep catching the app up". Rather than work from the two gaps I already knew about, the gap was MEASURED: every exported liveApi call the web uses and the app never does (42 of them). Most are correctly web-only — the super-admin console (users, premium tiers, solo quotas, card themes) is a desktop tool. Three were real, and one of those was not on anyone's list. (1) **THE APP HANDED OUT A CODE IT COULDN'T ACCEPT.** `native_join` had no caller anywhere in the app: the only way in was the public board (`join_from_board`). Yet BOTH the Recruit screen and the commissioner's ⇪ RECRUIT button share an invite code — "Invite code: XXXX. dripfantasy.com" — so someone who installed the app holding a code from a friend had to go find the website to use it. The COMMISSIONER code, the rarer and more advanced path, has had a box on that screen all along, which made the omission read as deliberate rather than missing. Now a GOT AN INVITE CODE? card sits ABOVE the commissioner one (it's the common case by a wide margin), with an optional team name; the code IS the seat, so it claims the lowest open roster with no approval step. This was an onboarding dead end during a preseason recruiting push, and it would not have been found by porting from a list of known gaps. (2) **K/DST FILL** — a league setting with no app presence at all, so a commissioner couldn't turn kicker/defense fill on or off from a phone. The MODE selector (off / random weekly / manual) now sits with the game mode exactly as on web; MANUAL's per-team assignment is a 32-option dropdown PER SEAT, which is a desk job, so it says so and points at the console rather than pretending to fit. (3) **ROSTERS & WAIVER WIRE** — the last known gap, the web's v0.215.0 view selector: ALL ROSTERED · ⏳ WAIVER WIRE · any single team, each with a count line, view-aware empty states, and the search rule preserved exactly (ALL still reaches the whole pool, because that was the only route to a free agent before the selector existed and muscle memory shouldn't break). Full battery green + APK 22500. REMAINING WEB-ONLY, now a short list: league creation (no app screen), the super-admin console, and the manual per-team K/DEF picker.

2026-08-16 — **DRAFT-ROOM COMMISH CONTROLS IN THE APP** (`v0.224.0`, no migration, app-only): founder — "let's do the draft room commish controls in the app", closing the gap v0.223.0 named. The LIVE-draft levers had been there for a while (pause / resume / force pick / undo / quiet hours); what was web-only was everything that decides what the draft IS, so a commissioner running a league from a phone could START a draft but not SHAPE one. `DraftSetupCard` ports all three 0176/0177 sections — format (snake ⇄ auction, pick clock, auction budget / bell / lots), the scheduled start, and the draft order with ▲▼ reordering plus 🎲 RANDOMIZE — collapsed by default because most visits to that card are to press START. THE ONE REAL DIVERGENCE, and it's deliberate: the web scheduler is `<input type="datetime-local">`, which React Native simply does not have, and pulling a native date-picker module in for a single field would add a native dependency to every build for the rest of the app's life. Instead: relative day chips (TODAY / TOMORROW / +2d / +3d / +7d) beside common draft times (6–9 PM) with a 30-minute stepper, which is TWO TAPS for the real use ("tonight at 8", "Sunday at 8") — and the resolved date is spelled out underneath, because "TOMORROW + 8 PM" is only unambiguous once you can read back what it landed on. A resolved time already in the past says so and disables the button rather than letting the server refuse it. THE DATE MATH WAS TESTED, not trusted — it's the one piece here that isn't a port, so the expression was run against month rollover, year rollover, +7d across a month boundary, BOTH US DST transitions, and the stepper's wrap through midnight in both directions; all correct. Also ported: the countdown, which belongs to EVERY member and not the commissioner (that's the point of a schedule), counting off the server's `server_now` so a skewed phone agrees with everyone else — plus a new `fmtLong` because the app's existing `fmtCountdown` is m:ss and would render a week-out draft as "10080:00". Carried the web panel's reorder fix across rather than re-introducing the bug: the arrows operate on the rows SHOWN, seeded from seat order, so hand-setting an order works before you've ever randomized. Full battery green + APK 22400. STILL WEB-ONLY: league creation (no app screen at all) and the rosters / waiver-wire view selector.

2026-08-16 — **SCHEDULED DRAFT START** (`v0.223.0`, migration 0177, web + worker): founder — "let's do the scheduled draft start", the follow-up flagged at the end of v0.222.0. Starting a draft has always been a button somebody had to be awake to press, so a league that agreed on "Sunday 8pm" still waited on one person's phone. Now `draft.start_at` + `set_draft_start` arm it and the WORKER opens the room. THE SHAPE, and why it isn't the obvious one: the cheap version is letting a client start the draft when its poll notices the time has passed — which fails exactly when it matters, because nobody has the app open at 8pm sharp and the draft would start whenever the first person happened to look, i.e. worse than no schedule since everyone was told 8. The native sweep already exists as the "keep leagues moving when nobody's watching" path (draft_tick, process_waivers, auto_weekly_budget), so the auto-start joins it as one service_role-only RPC, running FIRST in the sweep so a draft whose time just arrived is live before the same pass looks for overdue seats. THE REFACTOR THAT FORCED: `start_draft` checks `is_league_commish()` and the worker is nobody's commissioner, so its body — ordering, deadline, auction budgets, waiver priorities — moved once into `_start_draft_now()` (granted to nobody) with `start_draft` becoming the authenticated door onto it; probes sc10b–sc10f re-pin the old behaviour through the new seam. THREE JUDGEMENT CALLS, each probed: (1) a time in the PAST is REFUSED rather than fired immediately — a mistyped year that launches the draft on save breaks the promise in the one direction nobody can undo; (2) a start that can't run (unseeded pool, a seat short) is REPORTED and RETRIED, so seeding five minutes late still works — the worker logs the reason every sweep, because a league sitting armed and failing is exactly what nobody notices until draft night; (3) but only within 2 DAYS, because without a window a league that scheduled, failed, and moved on would have its draft detonate weeks later the instant something seeded a pool, with nobody in the room. `start_at` is KEPT after the start (status already takes the row out of scope) so the room can still say what it was scheduled for. PUSHES: the existing "draft is LIVE" fires for free the moment status flips; new on top is a T-90m..T-0 reminder keyed on `start_at`, so moving the draft re-arms the reminder instead of suppressing it. UI: the countdown belongs to EVERY member, not just the commissioner — that's the entire point of a schedule — and counts off the server's own `server_now`, so a skewed device shows the same number as everyone else. Verified in a browser pinned to America/Los_Angeles rather than UTC, where a local/UTC mix-up would hide completely: 20:30Z round-trips to 13:30 in the datetime field exactly. 32 assertions (sc0–sc10f) green first run. Full battery green (30 probe suites).

2026-08-16 — **DRAFT SETUP AFTER CREATION + A 48h CLOCK THAT COULDN'T BE CREATED** (`v0.222.0`, migration 0176, web-only — the draft room's commish controls have no app equivalent yet): founder — "let's figure out how to do the draft setup and changes after the creation." This is the other half of v0.221.0: that pass trimmed the create screen on "anything with a setter after creation needn't be asked up front", and FOUR controls stayed only because they had no setter. Now they do. (1) `set_draft_setup` — pick clock, snake ⇄ auction, budget, bid bell, lots at once; nulls mean unchanged so one control moves without restating the rest; PENDING-ONLY, which is the same freeze the game mode, lineup spec and roster rules all use, for the same reason (flip the format at pick 40 and there's no coherent reading of the first 39 picks). The target state is validated AS A WHOLE rather than field-by-field — probe ds5 pins the case that motivated it: switching to auction while the stored budget is smaller than the roster must be refused, even though 'auction' alone and that budget alone are each individually fine. It also writes `settings_json.mode`, or the league preview would keep advertising a snake draft that is really an auction. (2) `set_draft_order` — the order now exists BEFORE the draft, not from the instant it goes live. Until now start_draft either randomised or took an order in the same call, so a commissioner couldn't run an order reveal, honour last season's standings, or let anyone see their slot before the room opened. Null randomises NOW, visibly — a random order nobody watched being drawn is indistinguishable from a rigged one. `start_draft` gained a fallback chain (explicit order → pre-set order → random) and RECHECKS the pre-set one against current seats, because a team can join between the draw and the start and a stale list would drop them from the draft entirely (probe ds10). (3) THE BUG, found while researching and reproduced on a scratch DB before it was fixed: `draft.pick_seconds` carries a CHECK of 15..86400 from 0064, which predates slow drafts — while the create RPC validates to 172800 and the UI's SLOW pace offers a pick clock up to 48 HOURS. Any clock over 24h therefore failed at INSERT with a raw check-constraint error and no league was created. Constraint widened to match the promise both layers were already making; probe ds0 creates at exactly 48h. (4) UI: a collapsed ⚙ DRAFT SETUP panel inside WAITING TO START — where a commissioner already is while seats fill — with the order as a ▲▼ list beside 🎲 RANDOMIZE, and a warning when a saved order no longer matches the seats. Verified in a real browser, which caught a bug worth the trip: the reorder arrows operated on the STORED order, so before you'd randomized once they silently did nothing — exactly the hand-set-from-scratch case the feature exists for. 26 assertions (ds0–ds11) green. Full battery green. ALSO SHIPPED: APK 22100, carrying the v0.220.0 app work (FAAB wallets + coin table) that v0.219.0's build predated.

2026-08-16 — **PICK THE GAME AT CREATION** (`v0.221.0`, migration 0175, web-only — league creation has no app screen): founder — "for create a fresh league, let's have the two types as options: Drip and Normal. We don't need so many options in this. What should we have to make it flow easily?" (1) THE GAME IS NOW THE FIRST QUESTION. Until now a fresh league was ALWAYS drip, and becoming a classic one took two more steps by two different people — an admin setting `classic_ok` (0158), then the commissioner flipping the mode — so the person who already knew which game they wanted had to ask permission to have it. `create_native_league` takes `p_game_mode`, and creating as 'classic' SELF-FLAGS the league (`classic_ok := true` alongside `game_mode`), which is what lets its commissioner switch modes pre-draft without an admin. STATED PLAINLY BECAUSE IT'S A POLICY CHANGE: the 0158 admin gate is untouched for the case it was written for — flipping a league that ALREADY EXISTS — it just no longer stands between a commissioner and a league they're creating from scratch. (2) THE TRIM, and the rule that decided it: EDITABILITY, not importance. Checking the RPCs rather than guessing — draft type, pace, pick clock and the auction knobs have NO setter after creation (get them wrong and the league is stuck), so they STAY; roster size and per-position limits have one (`set_roster_rules`, live until the draft starts, already on the commissioner's ROSTER tab) and overnight pause has one (`set_draft_night`, in the draft room), so they GO. Eight control groups became five, and the form now fits one screen with no scroll. What left didn't vanish — it became a DEFAULT the game type chooses: drip 12 spots with the pre-0071 position limits, classic 15 and NO position caps, because a classic league's shape is its starting-lineup spec and capping the roster too would be two answers to one question. The footnote now says what you're getting and where to change it instead of asking. (3) One hazard caught in review, not in production: a new parameter with a default creates an OVERLOAD rather than replacing the function, so a 12-argument call would have matched both definitions — "function is not unique", every league creation broken — hence the explicit drop-then-create every prior revision of this function used, with probe cg0 pinning that the 12-arg call still works. Probes cg0–cg3a: the drip default is unchanged AND still needs the admin flag to reach classic (the regression that would matter most), a classic-created league reads back flagged, its commissioner can switch away and back with no admin, its lineup spec is accepted immediately, unknown games are refused, and case/whitespace is normalised rather than rejected. Verified in-browser in both variants: no page errors, no horizontal overflow, correct copy per type. Also bumped this screen's three 9px footnotes to 11px — it predates the v0.216.0 type pass. Full battery green.

2026-08-16 — **BOTH WALLETS, IN THE APP** (`v0.220.0`, no migration, app-only): the founder's ask — "port the faab wallets and coin table to the app" — closing two of the three gaps v0.219.0 reported honestly. Everything needed already existed in core (`leagueFaabWallets`, `commishGrantFaab`, `adminLeagueMembers`, `commishSeedCoin`), so this is UI, not schema. (1) DRIP COIN BY TEAM under ◈ DRIP COIN: every seat sorted RICHEST FIRST with a circulation total and a "not joined" marker. Per-seat balances DID exist in the app, but only as a 💰 chip on each SEATS row — so comparing two teams meant scrolling a seat list reading one number at a time, and the two coin questions ("who has what", "give that team some") lived on a screen about who has JOINED. The chip on SEATS stays: it's still the right lever when you're already looking at that seat. (2) FAAB WALLETS as its own destination — MONEY now holds two, deliberately NOT one merged "money" screen, because drip coin buys power-ups and FAAB buys players; they never trade against each other and a commissioner topping one up must not have to wonder which they moved. Season budget / team count / unspent readout, a grant to every team, and per-seat rows in ROSTER_ID order rather than by balance (most seats sit on the same default, so a balance sort would reshuffle ties on every grant and move the row out from under your thumb). THREE mode states, not two: FAAB (levers live), a known non-FAAB mode (names WHICH one, and why the grant would be refused — the flip itself resets every balance, which is exactly why a grant made now would evaporate), and mode-unknown, where naming a mode we failed to read would be a guess printed as fact. Balances show either way, because hiding the numbers would make the refusal a mystery. (3) THE PHONE ADAPTATION, not a copy: the web puts an amount box and a button inside each row, which works with 700px to spend; a phone row has ~340px and must hold a name and a balance, so rows stay readouts and one shared `GrantSheet` does the typing — with GRANT/DOCK as a sign TOGGLE, since the iOS number pad has no "−" key and a signed text field would be literally unenterable there. TWO BUGS FOUND ON THE WAY: a pre-existing hard RN crash (`Notice` renders children into a `View`, and the demoted-commissioner branch passed a bare string — the one path where that branch actually renders), and a self-inflicted one caught before it shipped, where the new table poked the parent's epoch and remounted itself through its own key, wiping the ✓ receipt the commissioner needs to read. New probe fb12 pins the contract the FAAB card leans on: `league_faab_wallets` stays readable off FAAB while the grant stays refused. Full battery green. STILL WEB-ONLY: the rosters / waiver-wire view selector.

2026-08-16 — **THE PHONE NAV IS A SELECT + THE APP GETS SECTIONS** (`v0.219.0`, no migration, web + app): the two-part founder ask — "let's use the grouped select for the phone nav and do the mobile app port". (1) WEB PHONE NAV: the v0.217.1 audit measured 16 destinations flattened into one strip where ~1,458px of ~1,826px sat off-screen behind a swipe with NO scrollbar (`.mgmt-tabs` hides it deliberately), so on a phone most of the commish surface simply could not be found. Under 900px `LeagueRow` now renders a native `<select>` — one `<optgroup>` per nav group, so the same four groups the desktop rail shows (SET UP / RUN THE SEASON / ENGAGE / DIAGNOSE) survive into the OS picker, every destination visible in one tap, with the active group named underneath so you always know where you are. NATIVE was the right call over a custom drawer: the OS picker is already a full-screen scrollable list on both phone platforms, it's keyboard- and screen-reader-correct for free, and it costs 23 lines instead of a focus-trap. The desktop rail is untouched; the flattened `leagueTabs` list is gone with its only consumer. (2) THE APP PORT: `CommishTools` had grown to seven stacked cards in one endless scroll — the exact problem the web pass fixed in v0.212.0 — so it gains the same grouped map, but as a WRAPPED CHIP ROW rather than a select, because with ~7 destinations everything fits on screen at once and a picker would HIDE what the strip can show; the fix and the anti-fix are the same principle applied to different counts. Sections: 🎮 MODE & SCORING · 👥 SEATS · 🧑 PLAYERS · ⚑ KIT · 👁 ACTIVITY · ◈ POWER-UPS · ◈ DRIP COIN, defaulting to SEATS (the thing a commissioner opens this screen for most). Each card renders only when its section is live, so the app stops paying for six panes of layout to show one. ALSO ported from web: the nine SCORING TABS and the four SCORING PRESETS (STANDARD / ½ PPR / FULL PPR / TE PREMIUM) with the same ARM-THEN-COMMIT double click — a preset replaces all 155 values, so a stray tap must not wipe an evening's tuning — and the app's redundant RECEPTIONS pills gave way to a pointer line now that presets own that value. STILL WEB-ONLY, reported rather than papered over: FAAB wallets + grants, the coin-by-team table, and the rosters/waiver-wire view selector have no app equivalent yet. Full battery green.

2026-08-16 — **DRAG-REORDER + SPOT LABELS** (`v0.218.0`, migration 0174): "allow drag and drop re-ordering on the roster slots. Also, allow the commish to create a custom label for each spot (Only NFC Players, e.g.)". REORDERING needed no schema change — the spec has always been an ordered array whose slot names generate positionally (S1..Sn), and it already FREEZES at the draft, which is exactly what makes dragging safe: reorder after rows exist and you'd silently reassign somebody's lineup, so the existing freeze is the guard. Web gets a ⠿ handle (HTML5 drag, with the drop row highlighted); because drag is mouse-only, the handle is also KEYBOARD-operable (focus it, ↑/↓ moves the row), and the app — where HTML5 drag doesn't exist at all — gets ▲▼ buttons for the same result. LABELS are `label` on SlotSpec: trimmed, control characters stripped, capped at 24, empty stores nothing; new core helper `slotDisplayName()` prefers it over the derived FLEX/QB tag on the builder row, both lineup boards' pickers, and the web board's slot tag (with the real slot id kept in the tooltip). DELIBERATELY PRESENTATION-ONLY, and probed as such (sl1e): a label never changes what a spot ACCEPTS — the chips and the 🔎 filter decide that — so a spot can't read one way and behave another. That separation is why the placeholder shows the derived label: an unnamed spot still says what it is. Probes sl1–sl2a (trim, 24-cap, control-char strip, blank-stores-nothing, eligibility untouched, order stored as sent); one self-inflicted bug found and fixed on the way — the first version embedded a RAW newline in a JSON literal, which Postgres rejects before the function ever runs, so the escape had to be `\n`. Full battery green.

2026-08-16 — **MOBILE-WEB AUDIT + THE BREAKPOINT GAP** (`v0.217.1`, no migration, web-only): founder asked what to optimise on mobile web before porting to the app, so the commish surface was MEASURED in a real browser at 390 / 760 / 768 / 899 / 900px rather than eyeballed. Good news first: no horizontal page overflow at any width, the scoring sub-strip's `wrap` mode fits all ten tabs on a phone, the team chips' division grid collapses to one clean column, and the roster/wallet/matchup rows all reflow. THE DEFECT FOUND: two breakpoints that never met. `.mgmt`'s mobile rules (16px inputs so iOS doesn't zoom on focus, 34px minimum button height) stopped at 760px, while the desktop side rail starts at 900px — so 761–899px, which is IPAD PORTRAIT, got NEITHER treatment: the phone's cramped scrolling nav together with the desktop's 21px tap targets and 13.5px inputs that iOS zooms into on focus. Measured, not guessed: at 768px a position chip was 21px tall and inputs 13.5px; at 760px the same chip was 34px. Fixed by moving the media query to 899px so it ends exactly where `useWide` begins — one number, no gap — re-measured across all five widths to confirm 768/899 now match 390's treatment and 900 hands off to the rail. STILL OPEN (a design choice, not a bug, so it was reported rather than assumed): the primary league nav flattens to a single scrolling strip on phones, where 16 destinations mean ~1,458px of ~1,826px sits off-screen behind a swipe with no affordance (`.mgmt-tabs` deliberately hides its scrollbar). Options put to the founder: a native grouped `<select>` (one tap, shows all four groups, cheapest), wrapping the strip like the scoring one, or a drawer holding the real SideNav.

2026-08-16 — **FAAB WALLETS + GRANTS** (`v0.217.0`, migration 0173): the founder's ask — "waivers when it's faab, we need to list all the teams and current wallet and allow grants per team and overall grants." The READ half already existed (`league_membership.faab_budget`, `member_faab()`, `native_team_state.waiver_order[].faab`); what did not exist was any way to CHANGE one seat's balance. The only lever was the league-wide budget in set_transaction_rules, which RESETS every team — so a commissioner couldn't correct one bad bid, pay out a side bet, or stake a late joiner without wiping the league. New `commish_grant_faab(league, roster_id, amount)`: ADDITIVE like the drip-coin grant beside it, `roster_id` NULL grants EVERY team in one statement (the overall grant), negatives claw back, and the result FLOORS AT 0 — the claim resolver assumes a bid never exceeds the balance, so a negative wallet would corrupt waiver processing. NULL budgets materialise off the league default first, so a grant means the same thing to a seat that has spent and one that hasn't. REFUSED OUTSIDE FAAB MODE deliberately: flipping waiver mode resets every faab_budget to NULL, so a grant made on rolling waivers would silently evaporate the moment FAAB was switched on — better to say so than to lose it. Plus `league_faab_wallets()` (commish read, mode-independent, flags whether a seat is 'touched' or still on the default). UI: a FAAB WALLETS table inside WAIVERS & TRADES, gated on the SAVED mode, with per-team grant boxes, a grant-every-team row, and a season-budget / unspent-total readout. 15-assertion probe suite (fb0–fb11) covering commissioner-only, the outside-FAAB refusal, additive-off-effective-balance, the zero floor, the all-teams grant, validation refusals, the 100k ceiling, and the documented mode-flip reset the refusal guards — green first run. ALSO: K/DST folded into MODE & SEASON (it's a setup decision about what the league rosters, not a diagnostic). Full battery green.

2026-08-16 — **COMMISH POLISH ROUND** (`v0.216.1`, no migration, web + a mobile parity touch): seven founder notes in one pass. (1) POSITION CHIPS WEAR POSITION COLOURS — the roster builder's lit chips now use the same `--pos-*` palette as the draft board's PosPill (verified identical: both `rgb(16,35,57)` for QB), so QB reads as QB everywhere instead of "selected" being one undifferentiated accent; unlit stays neutral so eligibility is what pops. Mirrored in the app's builder. (2) ROSTER SIZE stepper retired where it's DERIVED: in a classic league the builder already computes it (starters + bench + taxi + IR → draft rounds) and a second control writing the same value could DISAGREE with it, so it becomes a read-only readout there — but a DRIP league has no builder, so it stays editable there rather than removing its only control. (3) TEAM CHIPS BY DIVISION + LOGOS: new `NFL_DIVISIONS` in core (validated to cover all 32 codes exactly once), rendered AFC beside NFC, four divisions each, every chip carrying its ESPN logo — and the division label is itself a button, so "the whole NFC West" is one click. Logos respect mark-free mode (trademark suppression → abbr-only) and collapse on load failure. (4) THE LAST PILLS GONE from AdminPage (4 × radius-999, incl. the waivers/trades toggles the founder spotted). (5) CUSTOM DAILY WAIVER TIMES: clear time / FA window were ALWAYS minutes end-to-end (the RPC accepts 0..1439) — only the UI rounded to whole hours. Now a real time field with 15-minute nudges; no schema change needed. (6) SEASON folded into MODE (now 🎮 MODE & SEASON) — kept always-visible so the admin console, which has no injected mode panel, doesn't lose the sync/preseason half. (7) DRIP COIN named as such everywhere (tab, weekly budget, per-team table, grant placeholder) with an explicit "this is NOT the FAAB waiver budget" note — two currencies exist in a native league and "COIN" alone was ambiguous. Full battery green. NEXT: per-team FAAB wallets + grants (founder ask) — `league_membership.faab_budget` and `member_faab()` already exist, but there is NO per-team setter RPC, so that one needs migration 0173 rather than UI alone.

2026-08-16 — **TYPE SCALE — the tool screens are readable now** (`v0.216.0`, no migration, web-only): founder — "the font, it's tiny in most places." Measured before touching anything: across the five management files the MASS of the type sat at 8–9.5px with 7.5px labels in the scoring grid — well under any readable floor, which is why it read as tiny everywhere rather than in one spot. Applied ONE monotone scale to all 392 inline sizes (7.5→10, 8→10.5, 8.5→11, 9→11.5, 9.5→12, 10→12.5, 10.5→13, 11/11.5→13.5, 12→14, 12.5→14.5, 13/13.5→15, 14→15.5, 15→16.5, 16→17.5, 17→18.5, 18→19.5, 19→20.5; 20+ untouched so the big scoreboard numerals keep their weight). Monotone matters: the mapping never inverts an existing pair, so every deliberate hierarchy — section head over label over body — survives intact, with the biggest relative lift at the bottom where legibility had actually failed. Then fixed what bigger text breaks, which is the half of this job that isn't find-and-replace: the scoring grid's column floor 96→124px (else "FIRST DOWN (QB)" wraps mid-label), the side rail 176→204px, and the tenure / week / grant inputs widened to hold their now-larger digits. Verified in-browser at the real scale: zero truncated rail labels, tab strip wraps instead of clipping, no horizontal page overflow, smallest rendered text on the page now 10px (was 7.5). NOT TOUCHED: the game-side board keeps its own type — same boundary as the de-pill; extending the scale there is a follow-up if the founder wants it app-wide. Full battery green.

2026-08-16 — **ROSTERS BY TEAM + THE WAIVER WIRE** (`v0.215.0`, no migration, web-only): the founder's ask — "select by team so we can see the players on a user's roster then take action… also a selection to see the waiver wire of available players for movement." The MOVE PLAYERS tool was a single flat list of every rostered player in the league, so answering "what does this manager actually have" meant reading a league-wide list and matching team names by eye, and there was no way at all to browse who was AVAILABLE — free agents could only be reached by typing a name you already knew. Now a view selector drives the list: ALL ROSTERED PLAYERS (the old default, unchanged) · ⏳ WAIVER WIRE — everyone unrostered · or any single team. The section is renamed ROSTERS & WAIVER WIRE. Each view carries a count line that answers the question it was opened for — "12 rostered · 2 taxi · 1 IR" for a team, "N available — nobody's roster" for the wire — and rows gained the two facts that decide whether a move makes sense: the TAXI/IR stash badge on a rostered player, and a live ⏳ waiver-hold countdown on a free agent (claims still open; a commissioner move clears the hold). Empty states are view-aware rather than a generic "No matches". SEARCH BEHAVIOUR PRESERVED deliberately: in the ALL view it still reaches the whole pool, because that was the only way to find a free agent before this selector existed and muscle memory shouldn't break; inside a team or the wire it filters that set. Actions are untouched (move / waive / cut, roster-size rules still enforced server-side). Verified in-browser across both views. Full battery green.

2026-08-16 — **THE REPLAY SHOWS THE REAL GAME** (`v0.214.0`, no migration, web-only): founder pass over the MATCHUPS tab. THE BUG WORTH NAMING: the feed sheet (≣) replayed whatever week was typed into the admin's "from 2025 wk" box against the BAKED 2025 play-by-play — so opening it on a real 2026 matchup showed the right lineups playing the wrong football, silently, with no indication the plays weren't that matchup's. It now reads the matchup's OWN week from live_play (the rows the worker wrote while the games actually ran), falling back to the baked set only when that week has no live rows — the admin's resolve-from-baked test flow — and LABELS which stream is on screen ("REPLAY · WK 3" vs "· baked 2025") so the two can never be conflated again. Empty weeks say so instead of rendering a silent blank sheet. The ≣ button is disabled until a matchup kicks off ("replay unlocks once this matchup kicks off"), per the founder's "only available after it happens". The ▦ live board already read the actual matchup (admin_matchup_board — real states, slot scores, teams, 2.5s refresh); its tooltip now names the matchup it opens. COIN EDIT REMOVED from matchup rows (button, inline editor, adminSetCoin import), and the per-team grant left the MEMBERS rows too — both now live on the ◈ COIN tab, where teams are comparable side by side; MEMBERS is about seats, matchups are about state. Full battery green.

2026-08-16 — **COIN BY TEAM** (`v0.213.2`, no migration, web-only): the founder wanted current coin per team and per-team grants on the new ◈ COIN tab. Everything needed already existed but was scattered — `adminLeagueWallets` balances and the per-team `SeedCoin` grant control were embedded one-per-row inside the MEMBERS list, so the commissioner's two coin questions ("who has what" / "give this team some") could only be answered by scrolling a member list one team at a time, with no way to compare. Now one table under the weekly allowance: every team sorted RICHEST FIRST (comparison is the point of a table), balance in accent when non-zero and faint at zero, a "not joined" marker on unclaimed seats, a total-in-circulation readout, and the grant input inline on each row. `SeedCoin` gained `hideBalance` so the inline ◇ chip doesn't repeat the table's own balance column. COIN now loads members+wallets on arrival like MEMBERS does (both the click path and the open-card effect). Verified in-browser against a five-team fixture: correct sort order, circulation total, zero-balance dimming, grant control per row, zero page errors. Full battery green.

2026-08-16 — **FOUR MORE DIVISIONS + SCORING PRESETS** (`v0.213.1`, no migration, web-only): a rapid round of founder notes on the commish surface, all shipped together. (1) OFFENSE SPLIT one-per-skill — PASSING / RECEIVING / RUSHING / OTHER (the cross-skill combined totals + per-position first-down bonuses), since a QB's knobs and a WR's knobs were sharing a tab. That took the scoring strip to ten tabs, which OVERFLOWED the pane and hid ADJUSTMENTS behind a sideways scroll — caught by measuring scrollWidth in-browser, not by eye — so labels lost their padding words (TURNOVERS & ST → TURNOVERS, TEAM DEFENSE → DEFENSE, OTHER OFFENSE → OTHER) and TabBar gained a `wrap` mode for SECONDARY strips inside a narrowed pane, where a scrolled-off tab is a tab nobody finds. All ten now fit one line at 1180px and wrap cleanly at 1000px. (2) PPR SELECTOR REMOVED from GAME MODE — receptions are a scoring decision, so they ride the new presets instead; that tab is now purely "which game are we playing". (3) SCORING PRESETS: START FROM · STANDARD / ½ PPR / FULL PPR / TE PREMIUM, each a RESET-then-apply (never a half-merge with what was there) that also sets the league's receptions value, with the current setting shown as a readout so PPR never became invisible. Applying asks TWICE — the first click arms, the second commits — because a preset replaces all 155 values and a stray click shouldn't wipe an evening's tuning. (4) ROSTER RULES folded onto the lineup tab, now ⛭ ROSTER (the builder says what the starting spots are; the rules say how big the roster is and how it may change) — it shows in the admin console too, where only the rules half exists. WAIVERS & TRADES became its own destination, and (5) the drip COIN controls (weekly allowance + one-off grants) got theirs, off the top of MEMBERS where you scrolled past an economy control to see who had joined. Verified in-browser: 10 scoring tabs no-scroll, preset confirm state, rail reads INVITE & ACCESS / GAME MODE / ROSTER / SCORING / WAIVERS & TRADES / SEASON + MEMBERS / COIN / PICKS, zero page errors. Full battery green (both typechecks, build, parity 2×, 32 probe suites, smoke).

2026-08-16 — **ONE SCORING PAGE, TABBED — AND THE PILLS ARE GONE** (`v0.213.0`, no migration, web-only): two founder notes off the v0.212.0 pass. (1) SCORING LIVED IN TWO PLACES: the classic 155-knob catalog on the settings page and the DRIP-side adjustments (TD bonus / yardage multiplier / turnover penalty / scoped bonuses) behind the commish kit's ⚖ ADJUST modal — so "change scoring" had two answers depending on which mode you were in. `ScoringEditor` gained an `inline` mode (same component, same save path, no backdrop/fixed card) and is now a tab on the one SCORING destination; the kit keeps only a read-only pointer row, shown when adjustments are actually in force so it still warns you the league isn't at base rules. (2) THE CATALOG IS TABBED: 14 sections in one endless column became six groups across the top — OFFENSE / TURNOVERS & ST / KICKING / TEAM DEFENSE / IDP / HEAD COACH — plus ⚖ ADJUSTMENTS. Sections match BY NAME against the group map with a MORE bucket that appears only when the core catalog grows a section no group claims, so a future section gets an editor instead of vanishing. A drip league sees only ADJUSTMENTS (its sole scoring control) rather than an empty classic catalog. (3) DE-PILLED, founder's call — "I don't like the pill look of the buttons and field entrys": one `RADIUS = 3` token in adminUi now drives every control on the MANAGEMENT surfaces (adminUi btn/inp/chip, the CommishDash toggles + team chips + all filter fields, the whole commish kit including its five 999-radius chip rows). Verified in-browser with the real theme vars painted on: 3px computed on both buttons and inputs, tabs render, changed fields still light accent. NOT TOUCHED: the game-side board (LiveOnboard, boardParts, PodBuilder, hub/league screens) still uses pill buttons — ~25 call sites whose look is the game's aesthetic rather than the tool aesthetic; extending the token there is a quick follow-up if the founder wants it app-wide.

2026-08-16 — **COMMISH UI RESTRUCTURE — one grouped map, web desktop** (`v0.212.0`, no migration, web-only): the founder's read after a day of feature drops — "a lot of features that are combined or on the same page and a lot of busy screens… rework in favor of ease of use and simplicity and more division of features." DIAGNOSIS: the surface had TWO competing navigations — a flat 10-tab strip inside LeagueRow, plus three orphan cards (last-seen, game mode, live buffs) stacked BELOW it that the tabs didn't know about — and one of those cards, GameModeCard, was doing five jobs at once (mode, lineup builder, roster shape, pool filters, all 155 scoring knobs). So "where do I set scoring?" meant scrolling past a tab bar into a card and expanding a collapsed section. FIX: one navigation, grouped by WHEN you need it — SET UP (invite & access · game mode · lineup · scoring · roster rules · season) / RUN THE SEASON (draft · members · picks · matchups · rosters · playoffs) / ENGAGE (commish kit · activity · power-ups) / DIAGNOSE (k/dst · audit · admin modes). Desktop (≥900px) renders it as a grouped LEFT RAIL beside the content pane (new `SideNav` + `useWide` in adminUi); narrow screens keep the existing scrolling strip, same destinations flattened, so mobile web is untouched. GameModeCard became `LeagueSettings` with a `view` prop (mode | lineup | scoring) — identical state and save paths, three destinations, and the scoring catalog now opens EXPANDED since it owns its page; a drip league gets an explanatory empty state instead of a blank pane. The old catch-all SETUP tab split into INVITE & ACCESS / ROSTER RULES / SEASON / ADMIN MODES (the destructive admin controls are no longer one scroll below the invite codes). The commissioner-only panels reach LeagueRow through a new `panels` injection prop, so the dependency still points one way (CommishDash → AdminPage) and the admin console simply doesn't show entries it wasn't given. Verified in a real browser via a temporary Playwright harness (17 destinations, 4 groups, no rail/pane overlap, click-through works, zero page errors) — which caught the active-row state being invisible on these themes (--bg ≈ --surface), fixed by carrying selection on the accent COLOR + a 3px accent bar. NOT rebuilt as an APK: nothing under apps/mobile changed, so the installed app stays 21120 (v0.211.2) until the next app-side ship.

2026-08-16 — **TEAM-ACRONYM CHIPS ON FILTER INPUTS** (`v0.211.2`, APK 21120, no migration): the founder's playtest note on the per-spot filter editor — "we need a helper here for the team acronyms." A tappable 32-team grid (core NFL_CODES, uppercased) now sits under EVERY teams input — the per-spot 🔎 editor and the league-wide PLAYER FILTERS box, web CommishDash + app CommishTools alike. The chips stay in SYNC with the free-text field both ways: a tap toggles the code in/out of the comma list, and hand-typed codes light their chips (shared `teamList`/`toggleTeam` string helpers; the input remains the source of truth, so nothing about save paths changed). Both hosts' `TeamChips` follow their local pill idiom (web buttons / RN Pressables + haptic tap).

2026-08-16 — **APK TRIM PASS** (`v0.211.1`, APK 21110, no migration): the size cap was down to ~73 KB of headroom (31,383,848 vs the 31,457,280 delivery cap). Root cause of the bulk: AGP's modern packaging stores native libs UNCOMPRESSED in the APK so the loader can mmap them — ~18.8 MB of `lib/arm64-v8a/*.so` riding raw (libreactnative 7.0 MB, libhermesvm 2.5 MB, …). Fix: `expo.useLegacyPackaging=true` added to the existing `withReleaseShrink` gradle-properties plugin (the Expo template's `packagingOptions.jniLibs` reads exactly this property) — .so files now deflate in the APK and extract at install. Trade accepted: slower install + bigger installed footprint; cold-start unaffected. DELIBERATELY NOT enabled: `android.enableBundleCompression` — it would save ~2.5 MB more by deflating the Hermes bundle, but a compressed bundle can't be mmap'd and every cold start would pay the inflate; with the jniLibs win the headroom is large without it (documented in the plugin as the reserve lever). R8 + resource shrinking were already on (the plugin's original job). Same verification gauntlet as every APK (signer CN, versionCode, version string, giphy key, zero VAPID, size).

2026-08-16 — **PER-SLOT PLAYER FILTERS** (`v0.211.0`, migration 0172, APK 21100): the founder's follow-on — "Player filters need to be applied per starting roster spot. so you can have an RB slot only for rookies for example." A builder spot (SlotSpec) now carries its OWN teams / min_exp / max_exp alongside pos/bb; set_league_classic_slots v4 validates them with the exact 0171 pool-filter rules (codes 2–4 uppercase letters ≤32 deduped, tenure clamped 0..30, min≤max) and the spec stays draft-frozen. ENFORCEMENT is at the FILL seam, mirroring how position eligibility already works: a new core `slotAllows(def, {pos, team, exp})` gates both boards' bench pickers and `bestballFill` (team whitelist hits everyone incl. team units; tenure windows skip team units K/DEF/HC/P and refuse unknown tenure — the 0171 no-guess rule, per-slot); the greedy fill order puts FILTERED spots before unfiltered spots of the same width, so a plain RB slot can never steal the only rookie from a rookies-only RB slot (unit-proved). Filters never shrink the draft pool — a vet RB stays draftable, he just can't man the rookie spot. Tenure visibility at lineup time: league_pool grows `exp` (seeded from the directory's years_exp via buildDraftPool→seed_league_pool v3; clients + the worker resolver fetch a slug→exp map only when a spot actually sets a window; pre-0172 pools carry nulls, and since specs freeze at draft while pools re-seed pre-draft, the builder UI says "tenure filters need a pool re-seed"). ALSO FIXED IN v3: seed_league_pool's position whitelist still predated 0171 — DL/LB/DB/FB/HC/P entries were being SILENTLY DROPPED at seed time, so 0171's extra-position pool half never actually landed; the whitelist now admits all twelve (regression probe sf5). Both commish builder cards grew a 🔎 per-spot filter editor (lit when set; teams/min/max inputs, SAVE LINEUP applies); pickers label the active filter ("KC/SF · ROOKIES ONLY"). Probes sf1–sf6 (round-trip, uppercase/dedupe, bad-code + min>max refusals, 0..30 clamp, seed regression + exp round-trip); 15 new unit assertions (100 total; slotAllows matrix + fill-order + unknown-tenure cases); all suites + parity 2× + smoke green.

2026-08-16 — **FLAGGED POSITIONS + POOL FILTERS** (`v0.210.0`, migration 0171, APK 21000): the founder's double ask — coaches, punters, IDP, fullbacks, returners "in drafts, line ups, waivers, etc. but feature flagged by league on admin decision," plus commissioner ALLOWABLE-PLAYER filters (teams / tenure). ENFORCEMENT MODEL: league_pool IS the gate — drafts, waivers, adds and lineups all key off it (native_roster carries a hard FK) — so both features decide membership at SEED time and every downstream surface follows with zero extra checks. Admin flags (settings_json.positions_extra, HC/P/IDP/FB/RET, the classic_ok unlock pattern — new EXTRA POSITIONS chips per league on the admin page): the pool builder adds real defenders + fullbacks from the Sleeper directory (now carrying IDP/FB ungated — the old IDP_ENABLED constant retired; DRIP's Sleeper-sync keeps its own gate in buildLeague until drip's flagged rollout) and HC/P team pseudo-players ("kc-hc"/"kc-p", the K/DST pattern); the roster builder's chips widen per league; set_league_classic_slots v3 admits the extra tokens only where flagged. RETURNER is a SLOT IDENTITY, not a player position: any RB/WR/TE/FB can man a RET spot (slotEligiblePos) but the spot banks RETURN PRODUCTION ONLY — resolver, board previews and best-ball fills all score its occupant "as RET" (unit-proved: an 80-yd TD catch is mute, the kick return banks; best-ball ranks RET candidates by return points). HC scoring (19 knobs): win/loss/tie + the twelve margin brackets + per-point-scored + the founder's 3RD/4TH DOWN CONVERSIONS + 2-PT (live: conversions derive from the down/distance the adapter already parses; result/points rows land at FINAL via the pa/ya machinery under stable pids). P scoring (9 knobs): per punt, per yard, ESPN's seven punt-average bands (week-total). Catalog 127 → 155. POOL FILTERS (settings_json.pool_filter, commish, pre-draft): team whitelist + tenure window off Sleeper years_exp (0 = rookie; "rookies only" = max 0, "8+ year vets" = min 8; unknown tenure is excluded while a tenure filter is set — no guessing); the directory loader now carries years_exp (cache key bumped to v2) and both hosts' seed/reseed calls pass the league's flags + filter. Both commish cards grew the PLAYER FILTERS box + dynamic chips + an UNLOCKED banner; POS filter rows extended; theme gains FB/HC/P/RET palettes across all seven themes. Probes px0-8/pf0-6 (admin-only flip, junk refusals, flagged-token admission, RET-stands-alone, filter validation/round-trip/clear) + sb6b updated for the new IDP gate; 85 unit assertions total; all suites + parity 2× + smoke green. NOTED: drip-side rollout of the new positions stays gated in buildLeague (founder: "drip version at some point — again, feature flagged").

2026-08-16 — **GAP CLOSE — every rosterable position, no asterisks** (`v0.209.0`, migration 0170, APK 20900): the founder's "let's do them all" after the position-gap audit. Twenty-one knobs (catalog 106 → 127) + the two formerly-INERT knobs brought alive. KICKING: six missed-FG distance bands stacking on the flat miss (rows with no recorded distance take flat only). IDP: SACK YD per-yard (yards ride `y` on individual sack rows, halved with the credit on splits), INT/FUM RET YD + the 50+ return-TD bonuses (return yards parsed from the clause AFTER the takeaway marker — never the scrimmage clause), 2+ SACK and 3+ PD game bonuses (position-gated in classicPoints — a team DEF racks up 2+ sacks most weeks). TEAM DEFENSE: INT/FUM RET YD rates. QB: PICK-6 THROWN via a `p6` flag on the INT row — deliberately never `td`, so no TD points can ever fire on a pick thrown. OFFENSE: FUMBLE (ANY) (`fum` kind — kept or lost; `to` still marks lost) and FUM REC TD (`frtd`, own-team recovery TD, Sleeper's 6). SPECIAL TEAMS PLAYER section: solo tackle / forced fumble / recovery for ANY position — coverage tackles are their own `st_tkl` kind so they can never inflate scrimmage tackle counts or the 10+ bonus (unit-proved), and gunners' ff/fumrec rows (which 0168 already emitted) now score via stFf/stFr (Sleeper's 1s). INERT-KNOB FIX: `idpTd` and `idpSafety` finally have row sources — live, the interceptor/recoverer on a Return Touchdown gets an individual `dst_td` row; the true-up adds nflverse's exact `td_player_id` + `safety_player_id` credits (INDIVIDUAL rows only — team dst_td/safety already flow from ESPN, and a true-up team row would double-count across the two game-id namespaces). live_play +`p6`; whitelist widens by 21. 23 new scorer/week assertions (incl. the st_tkl-never-inflates proof and the halved-split-sack-yards case) + extended true-up fixture suite + cs25/26; all suites + parity 2× + smoke green. Remaining for CURRENT positions: nothing — the only open catalog items need positions that don't exist yet (punter, head coach) or the offseason 2025 re-bake.

2026-08-16 — **THE TRUE-UP LOOP — QB hits + passes defended** (`v0.208.0`, migration 0169, APK 20800): the Phase-3 hold lifts — "let's do the qb hit and pass defended true-up loop." ESPN's live text never reliably names QB hits or pass breakups (the reason these two were held), so the worker now runs a 6-hourly TRUE-UP against nflverse's nightly play-by-play (GitHub releases, ~19MB gz/season): a minimal streaming CSV parser (pbp desc fields carry commas/quotes/newlines) extracts `qb_hit_1/2_player_id` + `pass_defense_1/2_player_id`, resolves gsis → our minted slug through the Sleeper directory (playerIndex grows `slugForGsis` — Sleeper pads gsis with a leading space, trimmed — plus a `slugForNflAbbr` "C.Jordan"-style initial+last fallback, best-rank-wins, for the ~2/3 of defenders Sleeper carries no gsis for), and upserts `qbhit`/`pd` rows into live_play under the NFLVERSE game-id namespace (2026_01_BUF_NYJ + nflverse play_id) — structurally collision-free against the ESPN poller's rows on the conflict key, idempotent re-runs, one team row per play on the DEF pseudo-player. Sweeps the current regular-season week + three back (late stat corrections); IDP QB-hit/PD points "tick up" ~a day after games BY DESIGN (the documented trade); nflverse has no preseason pbp, so preseason stays quiet. Four new knobs (catalog 102 → 106, all default 0): IDP + team QB HIT / PASS DEFENDED. Validated the parser against the REAL 2025 season file end-to-end: 3,040 qb-hit plays, 2,504 PD credits, 5,694 defender rows — and the sample rows matched the exact plays ground-truthed via the upstream audit (C.Jordan's play-115 QB hit, W.Johnson's play-243 PD). No schema change — rows ride existing columns; 0169 widens the whitelist only. 9-assertion fixture suite for extract/resolve/namespace + 6 scorer checks + cs23/24 probes; all suites + parity 2× + smoke green. The play-feed enrichment scope is now FULLY delivered: 106 honest knobs, live + true-up, same-day.

2026-08-16 — **IDP FIDELITY** (`v0.207.0`, migration 0168, APK 20700): Phase 3 of the play-feed enrichment scope — "let's build 3", per the recorded Phase-3 recommendation (ship what live text carries; hold what it doesn't). Individual defenders finally SCORE in normie leagues: the ESPN adapter parses the tacklers from the play text's trailing parenthetical ("(M.Parsons)" = solo, "(K.Elam; T.Bernard)" = split), the forcer from "FUMBLES (…)", the interceptor from "INTERCEPTED by", the recoverer from "RECOVERED by" — emitting per-defender tackle rows with a `tt` solo/assist flag, `tfl` rows on negative-yard scrimmage plays, individual `sack` credit (an `hf` flag halves a split sack), `ff`, `int`, `fumrec`. Five new knobs (catalog 97 → 102): IDP SOLO/ASSIST premiums layered on the base per-tackle point, TACKLE FOR LOSS, IDP FORCED FUMBLE (all default 0, Sleeper-style), and team FORCED FUMBLE (default Sleeper's 1 — new rows only, nothing retroactive). Deliberately HELD, exactly as scoped: QB hits and passes defended (not reliably in live text — they wait for the nflverse true-up loop) and the 2025 IDP bake (defender gsis ids aren't in the crosswalk — offseason work; the 2026 season is live-scored, so the live path is the one that matters). live_play grows `tt`/`hf`; all three converters thread them. Team-side: the DEF pseudo-player also earns `ff` rows (the ladder DEF card gets forced fumbles at Sleeper's default). 48-assertion unit suite (solo/assist/legacy layering, half sacks, individual INT credit, defaults regressions); cs21/22 probes (with the 0.1-grid storage note); all suites + parity 2× + smoke green. Play-feed enrichment scope: ALL THREE PHASES SHIPPED same-day.

2026-08-16 — **SPECIAL TEAMS + TEAM BRACKETS** (`v0.206.0`, migration 0167, APK 20600): Phase 2 of the play-feed enrichment scope, the founder's "let's build 2". Twenty-one new knobs (catalog 76 → 97): KR/PR split return-yardage rates (an `rk` flag on return rows — legacy rows score the combined RETURN YD only, the 0166 no-guess rule), BLOCKED KICK (new `blk` DEF kind: blocked FG/PAT from bake columns + every Blocked typeText/`is BLOCKED` text live), the full POINTS ALLOWED ladder (8 knobs incl. per-point rate, defaults = Sleeper's 10/7/4/1/0/-1/-4 — the standard DEF scoring normies expect) and YARDAGE ALLOWED ladder (10 knobs, defaults 0). Brackets score off one `pa` + one `ya` game-summary row per defense emitted only at game FINAL — live from the ESPN summary's final score + boxscore totalYards under stable synthetic pids (the per-poll reconcile stays idempotent, and a game in progress can never score a bracket); baked from per-game scoring-play accumulation (TDs via td_team, FG/XP by posteam, safeties to the defense; 2-pt + blocked-punt columns guarded for the next dump re-pull). PUNTER GROUNDWORK: `punt` rows (y = distance) land on team pseudo-players ("xxx-p", the K/DST pattern) from both sources — unscored until position P exists, data accumulating now. Deliberately NOT baked: return rows into the main stream — the drip retyd metric folds returns from its separate store, so main-stream returns would double-count; the split knobs are live-data-only until that's unified. New SQL rate_keys clamp class (−1..1, 3dp) for the per-point/per-yard-allowed rates (yard clamp can't hold negatives, event clamp's 0.1 rounding would erase −0.05). Re-bake verified: shared-key points identical across all weeks, new rows only (w1: 32 pa / 32 ya / 119 punt / 2 blk), registries untouched. 37-assertion unit suite; cs19/20 probes; 32 suites + parity 2× + smoke green.

2026-08-16 — **TRUTH FLAGS — the play feed learns first downs, completions, sacks-against and 2-pt** (`v0.205.0`, migration 0166, APK 20500): Phase 1 of the play-feed enrichment scope, the founder's "let's build 1". The play contract grows four optional flags — `fd` (first down gained, TDs count), `cp`/`ic`/`sk` (completed / incomplete-attempt-incl-INTs / sacked, exactly one per flag-aware dropback) — and 2-pt conversions become their OWN kinds (`tp_pass`/`tp_rush`/`tp_rec`, zero yards, ca:0), deliberately not flags: a flag row would collide with the same play's TD row on live_play's (pid,slug,k) conflict key, and own-kinds are invisible to every drip metric with no guard code. Fifteen new knobs (catalog 61 → 76): pass/rush/rec 1ST DOWN + per-position QB/RB/WR/TE bonuses (new FIRST DOWNS BY POSITION section), COMPLETION / INCOMPLETE / ATTEMPT (att = cmp∨inc — sacks are NOT attempts), 25+ CMP GAME, QB SACKED, and 2-PT pass/rush/catch (defaulting to Sleeper's 2 — only flag-aware rows can carry the kind, so no historical total moves). Sources: the ESPN adapter was already branch-aware (completion vs incompletion vs sack are separate parse branches) and now emits the distinction, derives fd from the down/distance it already parses, and text-parses successful 2-pt segments; the 2025 bake re-generated with cp/ic/sk from the existing dumps (w1: 679 cmp / 356 inc / 69 sk; points + row counts verified byte-identical — parity 2× ALL PASS is the proof), with fd/tp reads guarded for the next re-pull (the dumps predate down/ydstogo/two_point columns); live_play grows four nullable columns and all three row→RealPlay converters (worker, core, web select) thread them. Legacy rows carry no flags, so truth knobs score NOTHING on them — never a wrong guess (the 0-yd-row ambiguity that made these categories unsupportable is resolved by refusing to guess). 24-assertion unit suite + cs17/18 sanitizer probes; all 32 suites green; both typechecks clean.

2026-08-16 — **Sleeper scoring parity + ESPN targets** (`v0.204.0`, migration 0165, APK 20400): the founder pasted all fifteen Sleeper scoring screenshots — "make sure we have these in our normie leagues" — then mid-pass added ESPN: "targets which sleeper doesn't have. Let's get targets in," plus notes-for-later on punting and coach scoring. The classic catalog grows 36 → 60 knobs, every one honestly scoreable from the play feed: PASSING 40+ yd completion + stacking 40/50+ yd TD bonuses; RUSHING 40+ yd rush, 40/50+ yd TD bonuses, 20+ carry game; RECEIVING RB/WR catch bonuses (position PPR beside 0160's TE), ESPN per-TARGET points (pays on every target — rec rows and incomplete-target rows both carry the flag), six exclusive reception distance bands (0-4 … 40+), 40/50+ yd TD bonuses; new COMBINED RUSH+REC 100/200 game section; KICKING FG 60+ band (fg50 narrows to 50-59; fg60 defaults to fg50's value so no retroactive change) + per-FG-yard and per-FG-yard-over-30 rates; IDP 10+ tackle game. Editors on both hosts auto-render from the catalog — zero client-code changes. NOT added, deliberately: every category the play feed can't score (first downs, 2-pt conversions, completions/attempts — QB incompletions, sacks and 0-yd completions are identical 0-yd pass rows — points/yardage-allowed brackets, blocked kicks, solo/assist splits, punting, coach scoring…): a knob that does nothing is a trap. Full ESPN punting + head-coach catalogs and the unsupportable-Sleeper list recorded in docs/espn-scoring-notes.md for the day the feed carries them. 14-assertion unit suite (stacking, exclusive bands, 0-yd rows trip nothing, week-total bonuses, defaults-unchanged regression — one comparator bug caught NaN passing as OK and was fixed to fail-on-NaN); cs13–16 sanitizer probes; all 32 suites + parity + smoke green.

2026-08-16 — **TAXI + IR spots, and the builder drives DRAFT ROUNDS** (`v0.203.0`, migration 0164, APK 20300): the founder's follow-up to the builder — "set the positions before drafting so the builder determines the draft rounds. Let's build out taxi and IR spots." Model chosen so every existing roster-cap check stays true as written: DRAFT ROUNDS DERIVE as starters + bench + taxi + ir — you draft the WHOLE roster, then DESIGNATE stashes — so the cap sites that count all native_roster rows against draft.rounds (adds, waiver claims, illegal-roster lockout) need no changes at all. Storage: settings_json.roster_shape = {bench, taxi, ir} via set_league_roster_shape (commish-only, classic-only, pre-draft only; bench ≤20, taxi/IR ≤8; derived rounds must land in the draft machinery's 5..25 window) + native_roster.spot ('active'|'taxi'|'ir'). Both the shape setter and every builder save re-sync draft.rounds while the draft is pending — the commish cards show a live "DRAFT = N ROUNDS" readout under BENCH/TAXI/IR steppers. Designations (set_roster_spot, owner/commish): taxi cap = shape.taxi; IR cap = shape.ir AND the player carries a real IR/Out designation in injury_status (the worker's ESPN feed — no honor-system IR); back-to-active needs an open active seat (starters + bench). A stashed player can NEVER be started: a sealed_pick for a taxi/IR player is refused at the DB (0144's no_start trigger pattern), the worker's autofill adds stashed slugs to its no-start set, best-ball pools and the worker's roster fetch take spot='active' only. Post-draft everyone lands active; designation is the manager's move. UI: roster rows on both hosts get a cycle button (→TAXI / →IR / →ACT) plus a stash chip beside DROP; league_game_mode v7 carries shape + live rounds. 32nd probe suite (tx0–11: drip/member refusals, rounds derivation + builder resync, 5–25 refusal, taxi cap, healthy-player IR refusal, IR-player stash, full-active return refusal, stash-start trigger both spots, unrostered slugs pass, draft freeze). Follow-ups noted: taxi rookie-eligibility gate (no tenure data server-side yet), roster_illegal_reason could name over-full active.

2026-08-16 — **The roster POSITION BUILDER** (`v0.202.0`, migration 0163, APK 20200): the founder's paper sketch, faithfully — "for normie leagues, let's use a starting roster position builder for commish settings." Classic lineups graduate from counts-per-predefined-type (0161's steppers, where FLEX/SFLX/WRT/IDP were the only combos) to an ORDERED LIST OF SPOTS, each carrying its OWN eligible-position set (any combination of QB/RB/WR/TE/K/DEF/DL/LB/DB — the sketch's "QB WR RB TE LB DB DL K" row is legal) and its own 🎯 best-ball flag, with ＋ ADD SPOT / ✕ remove / one SAVE. Storage: settings_json.roster_slots = [{pos:[…], bb:bool}] via set_league_classic_slots (validation: known positions, ≥1 pos per spot, ≤20 spots, dupes dedupe; draft-frozen; null/[] clears back to the 0161 counts) — slot names generate engine-side as stable S1..Sn (classicSlotsFromSpec; catalog-matching combos keep their labels). One resolver everywhere: leagueSlotDefs (spec ⊳ counts ⊳ default nine) + leagueBestball (per-spot flags ⊳ 0159 name array) feed the worker's classic resolve, both boards, and the commish cards; enforce_slot_cap v4 admits exactly the spec's spot count; league_game_mode v6 carries 'slots'. Legacy leagues load the builder pre-filled from their generated slots + best-ball names, so the first SAVE migrates them losslessly. BENCH = draft rounds − starters (already a creation-time knob, shown in the builder's legend); TAXI/IR from the sketch are follow-up — they need roster-management semantics (status gates, moves) that classic mode doesn't have yet. 31st probe suite (sb0–11: drip-refused, member-refused, unknown-pos/empty/21-spot refusals, dedupe, bb persistence, member read, spec-count slot cap, clear-falls-back, draft freeze). ALSO: fixed a date-triggered probe-fixture bug unmasked this morning — preseason-practice's future-kickoff fixture rows collided with the 0056 baked real slate on nfl_slate's (season,week,home) PK and silently dropped, so week 102 aged past the 4h skip rule at 04:00Z and 2g went red; phantom home codes (ZZx) can never collide.

2026-08-16 — **AI fills for everyone, spends only for itself** (`v0.201.0`, worker-only, no migration, no APK): the founder's ruling — "keep the AI for slotting players in spots humans left open, but the AI only uses power ups when AI control is on. We want all slots filled if possible without power ups regardless of if the team is being actively managed." Two changes in lock.js's materialization: (1) SPEND GATE — `aiDriven` is now `isAi` alone; the old `missed && policy === 'ai'` arm let the budget pass buy buffs/unlocks/battle-plays on a missed HUMAN's seat under the 'ai' lineup policy — gone. A missed manager under ANY policy is auto-filled with what they already own; their coin is never spent and no power-ups appear they didn't buy. The 'ai' policy therefore now fills like 'best_lineup' (both accepted; semantics collapsed). (2) FILL REACH — missed/partial no longer require `enrolled`, just a claimed seat (an app_user to key sealed rows under): every claimed seat gets its empty slots filled if possible, consistent with the claimed-seat scoring rulings. Unclaimed seats have no key to write under — the resolve-time fallback still covers them ("if possible"). The 'empty' policy stays the commissioner's explicit opt-out (missed side scores its honest zero). Persona nukes were already permanent-AI-only. Engine smoke green.

2026-08-16 — **Phantom opponent buffs off the live board — Achane closed, task #57 closed** (`v0.200.5`, web-only): the founder's "looks like the power ups were not applied in the app?" inverted by applied-state-diag: the WEEK'S ONLY armed row is the founder's own, buffs EMPTY — Joeggernaut armed NOTHING, so the WORKER was right and the WEB was inventing. Mechanism: `buildMatchup`'s opponent-buffs param documents itself "AI default when omitted" (the demo drama draw — momentum/garbage-time/overtime, verbatim AI_BUFF_POOL, verbatim the chips on Achane's duel); revealedOppBuffs returns null for a no-row opponent; the board passed `liveOppBuffs ?? undefined` → the demo draw ran against a real human opponent, +7.1 phantom lift. Fix: live boards pass `liveOppBuffs ?? []` — unknown/none means NONE; demo boards keep the draw. That was the last unexplained divergence: totals now reconcile as server-official = client (settled slots + unopposed + tail + window bonuses), with live between-plays sampling and genuinely hidden opponent extras as the only documented daylight.

2026-08-16 — **BANK NOW reconciles to the settled card** (`v0.200.4`, web-only): the founder's "log score is very different than the banked score" — 0200.3 moved final cards to settled values (drip tail + buff lift: Achane's MOMENTUM +1.1 / GARBAGE TIME +2.0 / OVERTIME +4.0 chips are his opponent-seat's ARMED BUFFS riding the drip), but the duel log's event stream stayed clock-capped at the last play, so its BANK NOW line still showed the pre-tail bank (25.7 vs the card's 30.3). At FINAL the log now gets the full stream — BANK NOW = the settle = the card; live windows stay capped, revealing plays as they land.

2026-08-16 — **The web board's totals align with the official score** (`v0.200.3`, web-only, no migration, no APK): the founder's "align them", with per-player evidence (Randall 25.0 app / 24.1 web, Wheeler 9.3/8.5, Badie 5.9/5.7 — server high by ~drip-rate × tail; Achane 23.4/25.7 the odd inverse). Three rules the client header total was missing vs matchup_state: (1) UNOPPOSED slots now count — the engine scores solo slots vs EMPTY and the server banks them; `if (!s.you || !s.their) continue` dropped every pick the opponent fielded no counterpart for (the dominant share of the 89.2-vs-62.3 header gap; backup rows still excluded — they only score by subbing at final); (2) FINAL windows settle — done windows bank the drip TAIL (accrual between last play and game end) that the last-play playback ceiling cut; slot cards at final now show the engine's settled `slot.youFinal/theirFinal` (the Wheeler 8.5→9.3 class); (3) the +5 WINDOW WIN BONUS is mirrored onto each contested window's current leader, as the server bakes it every resolve. Live windows keep the running between-plays ticker (the drama feature) and now converge at final. ACHANE (web OVER server on a final game — can't be tail accrual) stays open on task #57 pending his ⚖ SCORE DIFF row post-deploy. Typecheck + build + parity green.

2026-08-16 — **⚖ SCORE DIFF — the client-vs-server accounting instrument** (`v0.200.2`, web-only, no migration, no APK): task #57's instrument, founder-requested. The live board grows a collapsed dashed strip under the windows: per window, the CLIENT engine's settled per-slot banks (banksAtClock at events' end, bonus-free) beside the SERVER's matchup_state slot_scores (also bonus-free) and the server's window score (which bakes in the +5 win bonus, so "win − slots ≈ 5" reads as the bonus, not a bug); red Δs per slot, "—" where only one engine fields a slot (the knowledge-divergence signature), grand totals incl. the server official number; 30s refresh while open. Self-contained component (src/app/scoreDiff.tsx) — fetches matchup + state itself, mounts with liveCtx only. PRIME SUSPECT recorded while building it: Matchup.tsx's header total does `if (!s.you || !s.their) continue;` — the web header SKIPS UNOPPOSED SLOTS while the server banks them (engine scores solo slots vs EMPTY — the smoke's "unopposed barkley 30.9"); on a week where the opponent fields fewer windows, that alone under-reads the client total. Not hot-fixed blind — the panel's "—" rows will confirm it visually, then the header rule gets the deliberate fix.

2026-08-15 — **The app duel log learns the 2026 players** (`v0.200.1`, core + app, no migration, APK 20010): the founder's late-night screenshots — the app's SAT duel log listing every play but banking 0.0 on BOTH edges with no DRIP/HOT/coin rows, while the web's same duel banked 24.1 with full annotations. One mechanism: the duel log (0193) builds its engine Players from `slugMeta`, whose baked table only knows the 2025 demo names — a 2026 fringe player (Ian Wheeler, RB) fell to the WR/no-team fallback, and the position-gated metric + empty-team possession gating banked zero accrual, which also means zero drip events, hence the missing annotation rows. The client edition of the 0199.4 worker bug. Fix: `setSlugMetaOverrides` runtime overlay on slugMeta (same module-global contract as the other engine caches) + LivePicks installs the league pool (pos/team for every rostered player) on load. Reproduced exactly: Wheeler's play line scores 0 as WR/'' and 25 as RB/BUF — the web's observed 24.1. SEPARATELY (task #57, not shipped): app total 89.2/36.8 (server, official) vs web 62.3/34.1 (client preview) for the same matchup — both engines apply the +5 window bonus, so the divergence needs a per-window server-vs-client diff instrument on the web board before the failing layer can name itself.

2026-08-15 — **Identity goes id-first** (`v0.200.0`, worker-only, no migration, no APK): the founder's "can we make the switch to player ids instead of by name for matching?" — with the measured caveat that ids alone can't carry it (live Sleeper directory: 1,724 of 3,196 active fantasy-position players lack espn_id, including a real starting kicker; 219 duplicate full names incl. 43 "Duplicate Player" junk records). So: LAYERED id-first, never id-or-bust. (1) playerIndex mints UNIQUE per-player slugs — entries group by name-slug, the primary (0199.4 rank) keeps the clean slug every stored pick/roster/bake already means, namesakes get `-pos` (or `-sleeperId`) suffixes; byEspnId now maps each ESPN id to ITS OWN player's slug, so a namesake's plays can never merge into a star's timeline; collision count logged at boot. (2) Play + injury ingestion resolve by ATHLETE ID first: buildRoster/normalizeInjuries pass the ESPN athlete id through to an id-aware resolver (`slugForEspnId(id) ?? slugForName(name)`) — the id names the athlete in THIS game; no-id players keep the ranked-name path. Zero data migration: primary holders' slugs are unchanged. 9-assertion unit suite (QB keeps slug, LB suffixed, junk sidelined, per-id slug mapping, no-id fallback, IDP-namesake pair) via injectable directory; engine smoke green; adapter change is a backward-compatible optional arg (validate-espn runs in CI on merge — ESPN unreachable from the dev container). Full re-key of storage to player ids remains an offseason-scale project; this closes the scoring-identity hole without it.

2026-08-15 — **The QB gets his slug back — the actual Allen bug** (`v0.199.4`, worker-only, no migration, no APK): the widened zero-window probe convicted the last layer in one log read: `sat H=josh-allen/pass/9p → 0` — plays in the store, metric right, engine returns 0. Local reproduction: the SAME nine plays score 8.4 as QB/BUF and 0 as LB/JAX or null-pos — the pass metric is position-gated. Root cause in worker playerIndex: `if (!bySlug.has(slug))` first-write-wins, so a Sleeper directory namesake/stale duplicate named "Josh Allen" (the NFL reuses names) claimed the QB's slug and handed the ENGINE a non-QB position; every seat fielding him scored 0 server-side while the clients — which never read this index — scored 8.4. This was the founder's ORIGINAL "Josh Allen with passing yards but no points"; the seat rulings (0199.2), the play-store clobber (0199.3), and the stale tab were real adjacent bugs fixed en route, each unmasking the next. Fix: slug/name collision policy — fantasy positions (QB/RB/WR/TE/K/DEF) beat IDP/null, then Sleeper search_rank (lower = more prominent) — so the player the pool means by a slug is the one the engine sees. Unit check (placeholder-first + LB + QB → QB wins) + engine smoke green. Verify post-deploy: the sat zero-window probe lines disappear and Allen reads ~8.4 in the app.

2026-08-15 — **The play store stops eating itself** (`v0.199.3`, worker-only, no migration, no APK): the real "Allen 0 in app" root cause, found via three founder-run dbquery diagnostics after the seat fixes landed: seat-adoption-check showed the away seat FIELDING josh-allen but every live window 0.0 for BOTH sides while fri scored; play-coverage showed his 9 plays / 111 yds sitting in live_play week 102 the whole time. The worker's `injectWeek` wrapped `setSyntheticWeeks`, which CLEARS the entire synth store and installs ONE week — and the tick runs one context per active week in one process, so the second context's injection erased the first's plays; masked by sequential ordering until the 8/15 Saturday slate made ticks outlast `playsPollMs` (`setInterval` had no re-entrancy guard), at which point overlapping ticks clobbered week 102 mid-resolve and the engine wrote honest-looking zeros with the plays in the DB. Fix: (1) worker injectWeek is now ADDITIVE across weeks (accumulates every injected week, reinstalls all — a context can never evict a sibling's plays); (2) tick() is non-reentrant (a running tick absorbs the next firing, logged); (3) diagnostics that would have collapsed this hunt to one log read: injectWeekPlays logs rows/players per install, and a zero-resolve probe logs what the store held for a fielded pick whenever a started matchup writes 0–0. Verified: engine smoke + a 3-assertion additive-injection check (cross-week survival, both weeks present, self-replace).

2026-08-15 — **The seat adopts its saved picks** (`v0.199.2`, no migration, worker + both hosts, APK 19920 — supersedes 19910): the founder's "he has points in the web version but not the app" screenshot flipped the vacated-seat call: the web (client-resolving from every revealed row) SCORED Allen 8.4 while the worker fielded nothing — and the founder reads the web as correct, which is the standing "score their saved picks" ruling extended to a reassigned seat. So v0.199.1's hide-the-ghost filter is replaced by ADOPTION in one shared rule (core engine/seatPicks.ts assignSealedRows): a matchup's sealed rows split between the seats by current occupant, and an orphaned lineup (author on neither seat) is adopted by the seat that plainly owns it — only when unambiguous: ONE foreign author and exactly ONE seat with no rows of its own; an occupant's saved lineup is never overridden and ambiguous ghosts are dropped from display AND scoring alike. Worker resolveMatchup now assigns matchup-level (enrolledPicks → matchupSealedRows + seatPicks; prefetch carries allPicks; adopted seats score with no purchased extras since applied_state stays keyed to the departed account); getRevealedPicks runs the same helper and re-homes adopted rows to the current occupant's id so the boards place them on the correct side. 12-assertion semantics smoke on the helper; worker engine smoke green. Board and resolver can no longer disagree in either direction.

2026-08-15 — **Ghost picks off the board — the vacated-seat fix** (`v0.199.1`, no migration, APK 19910): the founder's "still 0 for Allen" AFTER both seat-scoring fixes deployed → the last remaining board/resolver disagreement is a VACATED seat: sealed_pick rows outlive a seat reassignment (they key on app_user_id, no roster column), so a previous manager's locked lineup keeps rendering on the board with live yardage while enrolledPicks — which matches rows to the membership's CURRENT app_user_id — fields nothing: "passing yards but no points", immune to the enrolled/sealed-first fixes. Scoring-side attribution is impossible by schema (an orphan row has no side), so the fix is display-side in ONE place: core getRevealedPicks now filters rows to the two seats' current occupants (membership-read failure falls back to unfiltered rather than blanking the board) — all four board surfaces (web Matchup + ClassicBoard, app LivePicks + ClassicBoard) inherit it. Board and worker now agree: a vacated seat is an empty seat. If the founder WANTS that lineup to count, re-assigning the seat to its author in COMMISH restores both display and scoring. Diagnostic `scripts/db/vacated-seat-diag.sql` (dbquery.yml) finds orphaned locked picks league-wide; the workflow-dispatch API is closed to this session's integration, so it's founder-runnable evidence rather than a pre-fix confirmation.

2026-08-15 — **The season closes itself + no more stale tabs** (`v0.199.0`, migration 0162, APK 19900): the founder's "let's do 2 and 3" off the to-do list. SEASON STRUCTURE (#3): `generate_playoffs` grows a `p_auto` mode (old 2-arg signature DROPPED — PostgREST ambiguity) — MEMBER-callable, seedless (standings seeding, the 0073 default), gated on `_regular_season_complete` (every non-playoff matchup final + draft complete) and a bracket-exists no-op that can never clobber a commissioner's custom-seeded bracket. Both hosts poke it exactly where advance_playoffs already pokes (app PlayoffControls load, web AdminPage playoff panel), so the first member to open the league after the last regular-season game final IS the trigger — no cron, no commissioner required; advance keeps walking rounds as befores. Champion banners: app LeagueHome + web LeagueHubPage read playoff_state and wear 🏆 {team} / LEAGUE CHAMPIONS once a champion exists. Probes: 30th suite (ap0–9: refused mid-season, member-can't-seed, waits for the last live game, generates once, second poke no-ops, commish custom seeds still win). WEB STALENESS (#2, the 8/15 playtest's "web and app scoring not aligned" root cause): the build now emits `dist/version.json`; new `UpdateBanner` polls it (5 min + tab-refocus, PROD only) and floats a one-tap "⬆ NEW VERSION x IS OUT — TAP TO RELOAD" pill when the deployed version leaves the tab behind — navigations are network-first in the SW, so the reload IS the upgrade. A seven-versions-stale tab can no longer silently disagree with the app.

2026-08-15 — **Sealed-first completes the seat ruling** (`v0.198.1`, worker-only, no migration, no APK): founder's "still no points for Allen in app" AFTER the v0.197.1 unenrolled fix deployed → the remaining zero-scoring path was AI/auto-pilot seats: sideLineup checked `controller === 'ai'` BEFORE reading sealed picks, so an AI seat's materialized rows were ignored in favor of an aiSide rebuild from sleeper_lineup — empty on a preseason board week → opponent fields nothing while the board shows their picks. Fix: locked sealed rows are the lineup for ANY seat that has them (the ruling, completed); the aiSide rebuild only covers seats with no rows; the AI's bought buffs still ride via loadout. If Allen is still 0 after this deploy's first tick, the fallback hypothesis is a VACATED seat (rows from a user no longer on the membership) — that would need a display-side filter instead.

2026-08-15 — **Classic goes fully commissioner-shaped: custom lineups + the whole Sleeper catalog** (`v0.198.0`, migration 0161, APK 19800): the founder's "full section for customizing starting roster spots... any combinations of starting roster spot types" + "customize all the scoring settings like in sleeper and ESPN fantasy." LINEUP: settings_json.roster_classic = counts per slot TYPE (QB/RB/WR/TE/FLEX/SFLX superflex/WRT rec-flex/K/DEF/DL/LB/DB/IDP; 0–6 each, 1–20 total, frozen at draft) — slot NAMES generate in the engine (classicSlots: TYPE or TYPE+index; the default reproduces the original nine EXACTLY, so pre-0161 rows keep meaning), and the slot-cap trigger admits exactly the configured starter count. bestballFill's fill order generalized to eligibility-size ascending (dedicated before REC-FLEX before FLEX before SUPERFLEX — greedy stays optimal, supersets last); best-ball name validation loosened to the generated-name pattern (engine fills only names in the configured lineup, stale names inert). SCORING: the catalog grows to ~36 knobs — 5-bracket FG ladder (fg0 now 0–19; fg20/fg30 join — pre-launch semantic change, no live overrides existed), return yds/pt, TE catch premium, configurable IDP line, and STACKING game bonuses (300/400 pass, 100/200 rush/rec) computed on week totals in classicPoints. UI both hosts: 🧩 STARTING LINEUP stepper row (per-type −/＋, live starter count, flex legend) + the ⚖ SCORING editor regrouped into Sleeper-style sections (PASSING/RUSHING/RECEIVING/TURNOVERS & RETURNS/KICKING/TEAM DEFENSE/IDP); best-ball chips follow the configured slots; join preview shows "Lineup: 1QB·2RB·…". Boards fully dynamic off league_game_mode.roster. Probes +13 (rc0–8 sanitize/clamp-6/cap-20/at-least-one/member-read/slot-cap-2-starters/draft-freeze; bb12 pattern names; cs11–12 catalog keys); engine smoke at 61 assertions (superflex fill takes the second QB, bracketed FG, TE premium, threshold bonuses at/below threshold).

2026-08-15 — **Live playtest: saved picks score for any claimed seat + per-window FINAL on the app** (`v0.197.1`, no migration, APK 19710): two findings from the founder's Turf Warriors session. (1) "Josh Allen with passing yards but no points" + "web and app scoring not aligned" → the RULED half: a claimed-but-UNENROLLED seat's saved (locked) picks now SCORE — enrolledPicks drops its `enrolled` requirement (founder's ruling: "score their saved picks"); the board's reveal and the resolver's fielding can no longer disagree. Truly empty seats keep the aiSide/policy fallbacks. The other half of the misalignment was a STALE WEB TAB: dripfantasy.com had v0.197.0 live (all Pages deploys green) while the founder's tab ran the morning's v0.190.0 bundle — client-resolved hero-board numbers off a week-old engine; a reload aligns. (2) "previous windows are still live" → matchup status is WEEK-level (finalizeMatchups flips only when every game of the ESPN week completes), so the app dressed Thursday's window in ● LIVE for two days; the app's Duel already accepted a winStatus override (the web used it since 0190) — LivePicks now passes the web's wall-clock rule: kickoff + 4h → FINAL. Frozen Q4 clocks on preseason feeds (ESPN ends without a clean final play) are cosmetic and now sit under a FINAL chip.

2026-08-15 — **Classic gets the commissioner's full toolbox** (`v0.197.0`, migration 0160, APK 19700): the founder's "full commish-editable scoring settings for normie leagues" + "apply the commish player flags in normie leagues." SCORING: every number the classic scorer uses is now a league knob — per-yard rates (pass/rush/rec), TD values, INT vs FUMBLE (now separate knobs; the scorer distinguishes by play kind), return TD, the kicker's distance ladder incl. misses, the DST line — via set_league_classic_scoring into settings_json.scoring_classic with camelCase keys MATCHING the engine's ClassicScoring interface (no mapping layer to drift; SQL knows key list + clamps only, defaults live solely in the engine's DEFAULT_CLASSIC_SCORING; PPR stays its dedicated 0157 knob). Editable any time (0143 precedent). FLAGS (0144→classic): roster/start triggers were always mode-agnostic; the engine half now bites in classic too — bonus_mult scales the play points, bonus_pts lands flat on the final (classicPoints reads the same flag cache both drip resolvers use), and no_start players are EXCLUDED from best-ball fills (the DB trigger only guards manual writes — same reasoning as the drip auto-lineup's noStart set). Worker installs the flag cache synchronously before each classic resolve (drip's isolation rule) and passes the scoring overrides; both boards load playerFlags + the scoring object so displayed points match the resolver exactly. Smoke grew to 35 assertions (knob overrides incl. flat-FG and 2-pt sacks, INT-vs-fumble separation, bonus_mult ×2, flat bonus_pts, no_start-excluded-from-bestball; one FAIL was my fixture dropping the DST's plays, not the engine). Probes +11 (cs0–10: clamps, unknown/non-numeric keys dropped, member reads, clear-to-defaults, refused in drip). UI: ⚖ SCORING collapsible grid (20 fields, changed-from-default values lit) with SAVE / RESET TO STANDARD in both commish GAME MODE cards.

2026-08-15 — **Best ball comes to normie leagues** (`v0.196.0`, migration 0159, APK 19600): the founder's "The entire roster can be Bestball or you can select to make roster spots Bestball that take the highest scoring player not in a non-bestball starting roster spot." One setting: settings_json.bestball = the ARRAY of classic slots that fill themselves (all nine = pure best ball, subset = hybrid, [] = off) via set_league_bestball — commish, CLASSIC leagues only, sanitized in SQL to known slot names, frozen once the draft starts. The selection lives in ONE place: engine classic.ts `bestballFill` (manual starters reserve players; flagged slots greedily take the top scorer among the unreserved, dedicated slots before FLEX — optimal since FLEX's eligibility is a superset; stored rows in best-ball slots are IGNORED) — shared verbatim by the worker's resolveClassicMatchup (now ClassicSide {picks, roster, bestball}; native_roster fetched per matchup only when best ball is on) and both boards' `effective` lineup computation, so what members watch is what the resolver scores. Engine smoke grew to 23 hand-checked assertions (full-roster fill, hybrid FLEX-chases-leftovers, stored-row-ignored — one probe caught my own wrong expectation, the engine was right). Probe suite +12 (bb0–11: sanitize order, classic-only, entire-roster, clear, drip refusal, draft freeze). UI: 🎯 BEST BALL row in both commish GAME MODE cards (ENTIRE ROSTER / OFF / per-slot chips); boards mark 🎯 slots, pre-lock they read "fills itself with your top scorer" (no picker, never reserve players), post-lock they show the live chosen player — which can CHANGE mid-slate as scores move, converging at final; join preview appends FULL BEST BALL / best ball ×N.

2026-08-15 — **Classic behind the founder's flag** (`v0.195.1`, migration 0158, APK 19510 — supersedes the never-delivered 19500): the founder's immediate follow-up to 0157 — "let's feature flag it. I'll turn on normie fantasy availability per league." `set_league_classic_access` (ADMIN only) writes settings_json.classic_ok; `set_league_game_mode` v2 refuses 'classic' without it (the one write path, so no client can route around the flag — param validation first, so probe error shapes held); `league_game_mode` v2 reports classic_ok so both commish cards swap the CLASSIC pill for a "not unlocked" note where the flag is off (an already-classic league keeps its pills — clearing the flag never yanks a live league's mode; the draft freeze still governs). Admin lever: 🎮 CLASSIC (NORMIE) AVAILABILITY row under every league in web AdminPage's league list, showing current mode. Probe suite extended (gm5b–f: gated pre-flag, commish can't flip the flag, admin unlocks, commish then sets classic) — all 29 suites pass. The 19500 build was superseded mid-flight (killed pre-bundle; discard-and-supersede policy) — 19510 is the delivered artifact.

2026-08-15 — **NORMIE MODE — classic fantasy as a league setting** (`v0.195.0`, migration 0157, APK 19500): the founder's "drop bonuses and power ups in normie mode. Let's do both normal fantasy scoring mechanics and the league roster/starter structure." A league can now be CLASSIC: standard scoring across every stat (0.04/pass yd, 4 pass TD, −2 INT, 0.1/rush+rec yd, 6 TD, PPR knob 0/0.5/1 in settings_json.ppr; K by distance, DST splash line), ONE weekly QB/RB/RB/WR/WR/TE/FLEX/K/DEF lineup, no window bonuses, no power-ups — still resolved LIVE off the same play stream. The pick spine is untouched: classic lineups are sealed_pick rows under pseudo-window 'wk' (free-text column; null metric passes the metric guard; slot cap fixed at 9 for classic), sealed at the week's first kickoff — dueWindows() adds 'wk' once any window is due, and window_kickoff v2 closes the 0058 anti-sniping hole for it at the DB. settings_json.game_mode via set_league_game_mode (commish; FROZEN once the draft starts) + member-readable league_game_mode; league_powerups_off() is the one predicate arm_buff v5 / hero_set_buffs v3 / league_live_buffs v2 / league_preview v2 all consult, so classic auto-hides every buff rail with zero client changes. Worker: prefetch carries a mode map; resolveMatchup branches to core engine/classic.ts resolveClassicMatchup (29th probe suite gm0–13 incl. the 9-in/10th-out cap and post-kickoff write refusal; engine proven on a synthetic week: 14/14 hand-checked lines incl. PPR variants). Auto-lineup materialization skips classic leagues (a drip-shaped fill would be junk + eat the cap) — missed classic lineups score their honest zeros. UIs: both hosts branch at LivePicks into a new ClassicBoard (setter pre-lock: nine named slots + bench, per-slot save; live after: two-column starters with per-player points + totals, 60s refresh); 🎮 GAME MODE card (DRIP ⇄ CLASSIC + PPR) in app CommishTools + web CommishDash; the join preview leads HOUSE RULES with which game it is.

2026-08-15 — **Web push closes the notification loop** (`v0.194.0`, NO migration, no APK — web + worker only): the last item of the founder's 1/3/5 slate. The browser becomes a push device using the tables push already owns: a PushManager subscription JSON is stored in push_token as `platform='web'` (token column was already free-text; prefs/mutes/outbox all apply unchanged), so ONE detector pass feeds phones and browsers alike. WORKER: `server/src/webpush.js` speaks the Web Push protocol raw — RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID ES256 auth, pure node:crypto, no new deps (same posture as the raw-FCM path) — and `flush()` now branches per device platform, with per-channel creds guards (a row only burns once a creds-bearing channel attempted it). Encryptor proven byte-exact against RFC 8291 Appendix A's known-answer vector (`scripts/webpush-vector-test.mjs` — 5/5, incl. raw r||s ES256). CLIENT: push + notificationclick handlers in the existing PWA sw.js (tag-per-kind replacement, focus-or-open on tap); `src/app/webPush.ts` holds the committed VAPID public key + subscribe/unsubscribe; the 0153 NotifPrefsCard gains 🔔 ENABLE PUSHES ON THIS BROWSER (denied-state copy, browser/phone row labels, silent re-register keeps last_seen fresh). CREDS: VAPID private scalar → new `VAPID_PRIVATE_KEY` repo secret, staged to Fly by deploy-worker.yml alongside FCM (same in-script guard, same snapshot gotcha); worker DERIVES the public key from it, so the secret can't self-disagree. Until the secret lands, web pushes wait in the outbox — the FCM go-live story again.

2026-08-15 — **QB Rush Yards earns its slot** (`v0.193.1`→`v0.193.2`, no migration, APK 19320 — supersedes the never-delivered 19300/19310): the founder's balance call after watching the slate, revised once on review ("Make it .2 per yard"). QB Rush Yards (FLAT) goes 0.1/yd + 6/TD → **0.2/yd + 8/TD**: a scrambler's 50-yd night read ~8 pts against pass-flat's ~16, so the metric was never a real pick; now a Lamar-profile 85-yd + TD night lands ~20.75 (boom) while an ordinary night still trails pass-flat — a deliberate call FOR a running QB, not a free upgrade. QB-scorer line only: RB/WR Underdog (same 0.1+6 shape) and projectedPoints (the all-position ranking + bye-steal pricing heuristic) deliberately untouched. Rulebook regenerated (metrics.ts is its source). Ships with the 0193 duel log in one APK.

2026-08-15 — **The minutes view comes to the phone** (`v0.193.0`, no migration, APK 19300): the founder's "yes let's build the live duel log" after the Achane reconciliation made MINUTES view's value obvious. The app's live board is server-score-driven and never ran the engine — so no per-duel event stream, no MINUTES log. The bridge: core `data/duelLog.ts` `liveDuelEvents(mine, theirs, week, youAreHome, myBuffs, oppBuffs)` — a PURE call over what the board already holds (revealed picks both sides, the two buff sets; the week's plays are already injected by refreshLive's setLivePlays) into `resolveLiveMatchup(..., {captureEvents: true})` (the worker's own resolver — slotEvents existed behind the drama-audit flag), events side-normalized to the caller (home='you' flip for away). APP: refreshLive also fetches revealedOppBuffs; each duel's slotDetail gains ▸ DUEL LOG opening an Overlay with the EXISTING PlayLog — PLAYS/MINUTES/NEWEST, cumulative edges, tap-for-details, and the 0192.1 BANK NOW line all arrive free. Resolution runs once per open (lazy memo), nothing polled. Fidelity note (documented in the module): this is the web hero board's knowledge set — a member can't see opponent targeted extras, so those duels can read under official, same as the web.

2026-08-15 — **The Achane reconciliation** (`v0.192.1`, no migration, APK 19210): founder's live-slate question — Achane's card read 25.7 while the log's cumulative edge ended at 13.9. NOT a scoring bug: a DRIP metric earns between plays (per in-game minute; momentum/garbage-time/overtime multipliers ride those ticks — his +1.1/+2.0/+4.0 chips), and the log's PLAYS mode filters drip ticks, so its edges end at the last PLAY (32:45, bank 13.9) while the bank kept climbing to 25.7. The math reconciles; the log didn't SAY so. Fix: a pinned ◈ BANK NOW line under both hosts' slot logs, computed from the UNFILTERED event tail so it always matches the card, with 'drip keeps earning between plays — MINUTES shows it' appended when PLAYS mode is hiding a gap.

2026-08-15 — **Look before you join** (`v0.192.0`, migration 0156, APK 19200 — supersedes the never-delivered 19100): the founder's "browse and review open native leagues before joining, so only committed users take a spot". `league_preview(p_league_id)` answers for any league with an OPEN listing (members/commish/admin may read their own): identity + blurb, seats, the draft's shape (mode/rounds/clock/budget/overnight pause), house rules (waivers, trade review, pos caps, the 0155 real-time power-up switch), non-default scoring, and the seat map — team names + TAKEN/OPEN, never emails. Twenty-eighth probe suite (pv0–13: unlisted hides from outsiders while the commish reads their own; listed opens to any signed-in user; the seat map carries no identities; closing the listing shuts the window). APP (the board lives there — Recruit): the listing card's door is now ⌕ REVIEW THIS LEAGUE → a full preview sheet (draft/rules/scoring/seat list) with ✓ I'M IN — TAKE A SEAT inside it feeding the existing name-your-team join; browsing commits nothing. Core wrapper named BoardPreview (LeaguePreview was taken by the Sleeper-import preview — the collision was tsc-caught).

2026-08-15 — **The commissioner's kill-switch on real-time power-ups** (`v0.191.0`, migration 0155, APK 19100): the founder's "commish option to turn on/off availability of real-time power ups". Scope = the ARMED live-buff set (LIVE_BUFFS: overtime, momentum, amps, counters…), not the pre-game shop. settings_json.live_buffs ('on' default) enforced at BOTH arm chokepoints: arm_buff refuses before any wallet spend, and hero_set_buffs (the inventory path both live boards actually use) refuses ADDITIONS while allowing shrink — a buff armed before the flip stays reclaimable. Twenty-seventh probe suite (lb0–9 incl. the hero add-refused/clear-allowed pair and 'back on gets past the switch'). set_league_live_buffs (commish/admin) + member-readable league_live_buffs. UI: ◈ REAL-TIME POWER-UPS ON/OFF card in app CommishTools + web CommishDash; the web board's buff rail hides behind a one-line explainer when off; the app's armFromHand refuses with the commissioner's-setting message.

2026-08-15 — **The polish round: every badge, one ask** (`v0.190.0`, migration 0154, APK 19000): the founder's pick 5, consolidated. `league_signals(p_league_id)` answers every "needs a look" count at once — polls_unvoted (open polls ≤14d, not yours, no vote), waiver_results (my claims won/lost since league_seen.last_at — OPENING the league is what clears the dot; 7-day cap), and commish {waiting, review} (member-null; waiting = league_join with no enrolled seat, review = accepted trades when trade_review='commish'). Twenty-sixth probe suite (sg0–13; the asker-doesn't-count-their-own-poll rule was caught BY the probe first run). CLIENTS: league cards both hosts wear 📊 N POLLS / ✚ WAIVERS IN / ⚑ N FOR YOU pills (folded into the existing 2-min signals poll); hub tiles badge — chat carries the poll count beside unread, waivers/team tiles the resolved count, manage/commish the inbox. CROSS-LEAGUE INBOX: a 💬 INBOX strip on both home screens — every league with unread chat as a tappable chip (@-toned on mention), web → the league hub, app → straight into that league's chat tab (onOpen landing widened with 'chat').

2026-08-15 — **The commissioner's night dial + mutes where the options live** (`v0.189.0`, migration 0153, APK 18900): two founder asks. (1) OVERNIGHT PAUSE, SETTABLE — the engine has spoken quiet hours since 0069 (awake_deadline counts only awake ET minutes) but night_start/end_min were creation-time-only. `set_draft_night` (commish/admin; both-null clears; validation mirrors create) with the mid-draft honesty rule: a LIVE draft's running clocks RE-BASE — remaining wall time preserved and re-run through awake_deadline under the new hours (snake deadline_at + every open auction_lot), so the pause a commish sets at 9pm can't be beaten by a deadline computed at 8. Twenty-fifth probe suite (nd0–12; the live re-base pinned by a synthetic 2h clock + a quiet window that must push it past 6h). UI: a 🌙 QUIET HRS control in BOTH draft rooms' commish bars (web hour selects, app − / ＋ dials; current window shown on the button as '10p–9a ET'). (2) NOTIFICATION MUTES IN THE OPTIONS — prefs are server-side per device, so the WEB can flip the phone's: NotifPrefsCard in TeamManage's options (lists my_push_tokens; per-kind chips; no device → pointer at the app), and the app's Team screen mounts the same PushPrefs card Settings uses (now exported).

2026-08-15 — **Draft night gets a voice** (`v0.188.0`, migration 0152, APK 18800): the founder's pick 1+3 from the what's-next list. The hardening review's best finding was that the scariest failure was ALREADY fixed — sweepNative has ticked every live draft since 0064 (idempotent, advisory-locked), so an unattended draft autopicks; what was missing was the VOICE. Migration 0152 widens push kinds with 'draft' (+ the prefs mute key; probes pu6a/b). Worker detectDraft: "the draft is LIVE" and "the draft is complete" broadcast to every member (dedupe `draft:{league}:live|complete`, complete bounded to a 15-min window), and "you're ON THE CLOCK — pick N is yours" to the snake picker (same reversal math as SQL draft_on_clock; dedupe per overall; auctions get the brackets only — no single on-clock target). detectChat also learned the two league-wide moments: 📊 NEW POLL (kind='poll' rows → all members but the asker, dedupe per message×member) and ⚑ LEAGUE NOTE (settings_json.commish_note.at fresh → all but the commish). New shared leagueMembers() broadcast helper. App Settings gains the ⛏ DRAFT ALERTS mute chip.

2026-08-15 — **The app hub gets Teams & rosters** (`v0.187.1`, no migration, APK 18710 — supersedes the never-shipped 18700, whose gradle ran while this landed): the founder's "view teams on the league home". The web hub's TeamsRosters (0182) ported native as a 👥 tile + Overlay sheet in LeagueHome: one group per seat (nativeRosters + leaguePool + matchupTeams, my team accented, players position-ordered), each player row opens the PlayerCardSheet — the app has the card, so a roster listing that didn't tap through would feel broken. Native leagues only, same as the web.

2026-08-15 — **The commissioner's pulse check + GIFs keep their heads** (`v0.187.0`, migration 0151, APK 18700): the founder's "let commissioners see the last time each league member opened the league". SQL `league_seen` (one row per league×member, deny-all RLS) + `league_touch` (member/commish upsert on OPEN — the hub or the board, never the league list's badge polls; an outsider's touch answers ok and writes nothing, so admin browse-as can't fake presence) + `league_last_seen` (commish/admin only: the chat-union member list with display names, last_at desc, null = never). Twenty-fourth probe suite (ls0–12) green first run. CLIENTS: leagueTouch fires on the app's league open (the single onOpen seam) and the web's OPEN LEAGUE + ▶ matchup quick-link (hub door skips under browse-as); the read renders as a collapsed "👁 LAST OPENED" card — web in CommishDash under each LeagueRow, app in CommishTools under the seats card — tones: <24h you-green, <4d plain, older warn, never opp-red; core `seenAgoLabel` speaks m/h/d/never. ALSO (founder screenshot, live slate): app chat cropped tall GIFs — MsgBody's fixed 200×150 cover box; new InlineImage measures the image (Image.getSize) and keeps true aspect at width 200, height clamped 100–300.

2026-08-15 — **Fri-slate board polish, app** (`v0.186.1`, no migration, APK 18610): three founder findings from the live Friday slate. (1) DUPLICATE FIELDS — LivePicks' slotDetail deduped by TEAM, but a duel whose two players share a game (DEN RB vs ATL RB in DEN@ATL) maps two teams to ONE game: now dedupes on gameFeedFor's game key, one field per game per pair. (2) CARD/CHIP ALIGNMENT — MiniCard's name got a fixed two-line box (height 19, centred) so TYLER BADIE and a wrapping BIJAN ROBINSON produce the same card height, and the metric chip got minHeight 36 + centred content so one-line and two-line metrics wear the same chip; pair tops AND bottoms now hold. (3) THE MISSING LOG — the web's WindowGameLog (every ingested play across the window's games, newest first, scoring plays flagged with the running score, collapsed by default with the play count ticking on the header) is now ported native in PlayLog.tsx and mounted per window under the battle bar once the window kicks.

2026-08-14 — **The engagement layer reports in + chat clears the gesture bar** (`v0.186.0`, no migration, APK 18600): the founder's "analytics sweep — add anything missing". The audit: acquisition/activation was instrumented (demo→code-request→join→lineup, PWA install), but the whole 0147–0150 sprint was dark. Fourteen new events, wired at the CHOKEPOINT — core liveApi's write RPCs fire via a `tracked()` helper on the server's ok (one seam, both hosts, failed writes never count): chat_posted {text|gif|poll, dm, mentions}, poll_voted, chat_pinned, trade_proposed/responded, waiver_claimed {waiver|fa}, draft_picked, commish_action {note|flag|flags_bulk|scoring|trade_approve|trade_veto}, player_starred {favorite|block|want}. Host-side: chat_opened (surfaces), hub_tile_opened (web Tile + app LeagueHome), player_card_opened (both openPlayerCard buses), push_registered {granted} (the opt-in rate) + push_pref_set (app Settings). analytics-plan.md carries the new table + watch-list (chat_posted per weekly-active league; push grant rate; hub tile distribution). ALSO (founder screenshot, same hour): the app chat composer sat under the Android gesture bar — App.tsx's SafeAreaView leaves the bottom edge to the power-up hand, and Chat.tsx's three bottom-pinned rows (league composer, DM composer, DM new-message) used fixed paddingBottom:10; each now adds insets.bottom.

2026-08-14 — **Push goes live-capable** (`v0.185.2`, no migration, APK 18520): the founder's Firebase project landed — `apps/mobile/google-services.json` committed (client-safe by design; package com.dripfantasy.app, project dripfantasy-6e332), which flips app.config.js's existence gate so the APK registers real FCM device tokens after sign-in. The version bump also re-runs deploy-worker so the FCM_SERVICE_ACCOUNT GitHub secret (founder-added, Secrets tab) stages to Fly — the staging step logs "skipping" if the secret isn't in yet, and the next worker deploy after it lands picks it up. End-to-end test: install 18520, sign in, Settings → NOTIFICATIONS shows the per-kind chips; an @-mention from another account should push within ~70s (60s sweep + FCM).

2026-08-14 — **v0.185.0 actually reaches the worker** (`v0.185.1`, no migration, APK 18500 rebuilt): two post-merge ship-blockers on the push arc. (1) deploy-worker.yml referenced `secrets` in a step-level `if:` — a context GitHub doesn't allow there, which makes the WHOLE workflow file unparseable: the b4e7735 run "failed" with zero jobs and the sweepPush worker never deployed (the run's name showing as the file path instead of "Deploy the worker" is the tell). The guard now lives inside the run script (empty secret → logged skip, worker enqueue-only by design). (2) expo-notifications was hand-pinned `^0.32.17` but SDK 57 uses unified versioning (`~57.0.10` per bundledNativeModules.json); the mismatch survived typecheck and prebuild and died in R8 with missing `expo.modules.kotlin.types.*` — pinned right, rebuilt. Bonus: the release APK crossed the 30MiB delivery limit with expo-notifications aboard; the 1024px splash/icon pngs shipped raw (2.9MB of source art) — 256-color quantization cut them to 428KB, APK back to 29.8MiB. This version bump exists to trigger the (now parseable) worker deploy.

2026-08-14 — **App push notifications, worker-sent raw FCM** (`v0.185.0`, migration 0150, APK 18500): the founder's platform call — app-only (web stays in-app badges; beta testers arrive in weeks). No Expo push service: the app registers its RAW FCM device token (`register_push_token`, upsert BY TOKEN so a phone that switches accounts moves — probes pin it), the Fly worker detects and sends. SQL: `push_token` (per-device prefs jsonb, four mute keys sanitized) + `push_outbox` (unique dedupe_key; worker-only, deny-all RLS) + register/remove/set_push_prefs/my_push_tokens RPCs; twenty-third probe suite (pu0–13). WORKER `push.js` (60s sweep, own interval): detectors — lineup (window lock 55–65 min out + empty base slots via core slotsFor; dedupe lineup:{matchup}:{win}:{user}), chat (mentions + DMs, 10-min trailing scan made idempotent by dedupe), trades (pending → to_roster owner), waivers (won/lost) — then FCM HTTP v1 send (service-account JWT minted with node crypto, token cached; UNREGISTERED deletes the device row; channel drip-default). Credential = FCM_SERVICE_ACCOUNT Fly secret; deploy-worker.yml stages it from the GitHub secret when present; absent → enqueue-only (logged once). APP: expo-notifications (SDK 57), channel + Android 13 permission + getDevicePushTokenAsync in ui/push.ts (registration after sign-in; no-op without google-services.json — app.config.js gates googleServicesFile on file existence so every build stays green), Settings gains NOTIFICATIONS mute chips per kind (or an ENABLE button). BLOCKED-ON-FOUNDER to go live: Firebase project (package com.dripfantasy.app) → google-services.json (committed, client-safe) + service-account JSON → GitHub secret FCM_SERVICE_ACCOUNT.

2026-08-14 — **The week-saver: lineup alarms + trade-offer badges** (`v0.184.0`, no migration, APK 18400): the founder's picks 1+2 from the notifications shortlist. LINEUP ALARMS — core `data/lineupAlarm.ts` `lineupAlarmFor(matchupId, week, userId)`: liveSlate → setRuntimeSlate → windowsForWeek (the preseason-cluster-safe path), lock = kickoff−1h, capacity = slotsFor (base slots only — never alarms over a slot you'd have to buy), set = myPicks rows with a player; returns the SOONEST window inside a 90-min horizon with empty slots. Cards wear a red "⚠ LOCKS 6:20 PM · 3 EMPTY" pill. TRADE OFFERS — leagueTrades filtered to status='pending' && to_roster=yours → "⇄ N OFFERS" warn pill (native leagues). WEB: both computed in a 2-min poll keyed off the home's matchup cards, skipped under browse-as, rendered beside the 0183 💬 pill. APP: `useLeagueSignals` + `CardSignalPills` in ui/unread.tsx, same pills on the league list cards. Parity + both typechecks green. Next conversation: real push notifications (Expo + web push) as a pre-launch arc.

2026-08-14 — **Unread dots everywhere the league is** (`v0.183.0`, no migration, APK 18300): the founder's "notification dot on the league and the chat chip". Client-only — chat_unread (0147/0148) already served the counts. WEB: "Your leagues" cards wear a 💬 N pill (warn @ N when mentioned) — one badge poll per enrolled league on the 60s badge cadence, skipped under browse-as, threaded LiveOnboard→LeagueHome→LeagueCard. APP: `ui/unread.tsx` (useChatUnread hook + CardUnreadPill + ChatChipDot) — the league list cards wear the same pill; the tab strip's 💬 CHAT chip gets a corner dot (hidden while the chat tab is open, cleared by the next poll after reading). Candidate next notifications surfaced to the founder: lineup alarms (window locks soon + unset slots), trade offers awaiting answer, waiver results, commish inbox (waiting room + review-queue trades), unvoted polls, and real push (Expo) post-launch.

2026-08-14 — **Every league gets a front door** (`v0.182.0`→`v0.182.4`, no migration, APK 18230+): fourth follow-up (0182.4): GIF search became provider-agnostic — core `data/gifs.ts` `gifProvider(tenorKey?, giphyKey?)` (Tenor v2 wins if both; Giphy carries its ToS-required 'Powered by GIPHY' attribution); both chat pickers consume it; deploy.yml forwards VITE_TENOR_KEY + VITE_GIPHY_KEY repo variables. Reason: Google has delisted the Tenor API for new enablements (founder's console: 'No results found'), so the founder's existing Giphy key is the path — paste key → set repo var + bake EXPO_PUBLIC_GIPHY_KEY into the APK ritual, no code change. Third follow-up (0182.3): the app's ▦ FIELDS button moved off the board body into the tab strip beside CHAT/COMMISH (an action chip — opens the all-fields sheet from any tab via openFieldsSignal; strip wraps on narrow phones). Second follow-up (0182.2, live-slate finding): a DONE window's field + play log collapse in all experiences — the app's Duel now gates the per-slot fields behind a per-window '▸ FIELD & PLAY LOG' toggle once the window chip reads FINAL (collapsed by default), and the web board auto-closes any slot log left open through a live window at the final whistle (toggle reopens for the post-mortem; the window game log was already collapsed-by-default since 0169). follow-up (0182.1, founder's call): the league NOTE lives on the hub only now — the board's purple banner is gone on both hosts (one place, not two). What stays on the board is the ⚖ non-default-scoring chip (nobody should discover a turnover penalty from a score dropping) — the app's banner component remains mounted renderless-ish since it is what loads the board's flag/scoring caches. The hub note banner gained the commissioner's empty-state prompt + ✎ edit/write (routes to manage/commish tools), replacing the board affordance. the founder's league-home ask — opening a league now lands on a per-league HUB instead of the matchup board, with the board one tile (and one quick-link) away. WEB: `LeagueHubPage` inside LiveOnboard's view machine — identity header, the commissioner's standing note as a banner, and tiles: MY MATCHUP (the hero-board build), CHAT (unread/@ badge, opens the panel in place), ALL MATCHUPS & STANDINGS, POWER-UP SHOP (builds the board and opens the shop via a one-shot module intent consumed by Matchup), and for native leagues TRADES / WAIVERS & FREE AGENTS / TEAM OPTIONS (deep-link into TeamManage via a new `focus` prop that scrolls the right section into view), TEAMS & ROSTERS (new in-place expandable: every team's roster off nativeRosters+leaguePool+matchupTeams), DRAFT ROOM, and ⚑ MANAGE LEAGUE for the commissioner. The league card's primary CTA is now OPEN LEAGUE →; a `▶ matchup` quick-link (● matchup when live) joined the card's link row — the founder's "quick link on the league chip". Sub-screens (team/draft/results/commishdash) return to the hub when they were entered from it. Hub write-tiles refuse under browse-as. APP: new 🏠 LEAGUE tab, the landing view for any opened league (`LeagueHome` screen — note banner, matchup/chat+badge/shop/team/draft/commish tiles); the league card opens the hub with a bordered ▶ MATCHUP quick chip beside OPEN →; board/team/draft/commish backs return to the hub; the SHOP tile opens the board with the shop up (openShopSignal). Both typechecks + parity green.

2026-08-14 — **Browse-as shows the right person again** (`v0.181.1`, migration 0149, web-only — no APK): founder screenshot — "BROWSING AS heyeng78 … READ ONLY" over a page of the ADMIN's own league cards. A 0125 regression: browse-as (0108/0109) read enrollments straight off league_membership with the viewed user's id under admin-widened SELECT policies; 0125 moved the client onto `my_teams()` (keyed on auth.uid()) and the passed userId was silently dropped (`myEnrollments(_userId)`) — banner, feature gates and commish cards kept their admin twins, so everything AROUND the league list looked right. Fix: the missing twins — `admin_user_teams(p_app_user_id)` (my_teams' body incl. the co-manager arm) and `admin_user_waitlist` (same leak, waiting-room rows), both admin-gated; LiveOnboard's refresh + waitlist effect route through them when viewAs stands. Twenty-second probe suite (ba0–7: viewed-user's seat listed, nothing of the admin's leaks, non-admin refused); all suites green.

2026-08-14 — **Chat v2: pins, polls, @mentions, GIFs** (`v0.181.0`, migration 0148, APK 18100): the founder's next batch, an hour after chat shipped. PINS — commish pins up to 5 messages; a 📌 strip at the top of the league chat (collapsible), unpin from the strip; web hover 📌, app long-press menu. POLLS — commish posts a question + 2–6 options (≤60 chars) as a `kind='poll'` message; members tap to vote and re-vote (`poll_vote` upsert), counts + percent bars live in every fetch, own choice highlighted; no closing mechanic — deleting the message retires it (votes cascade). @MENTIONS — composer @-autocomplete over the league member list (names may contain spaces: query = tail after the last word-opening @); mentions travel as ids derived from @names present at send, server keeps only real members (cap 8, never self); mentioned-you messages tint, `chat_unread` counts mentions apart, web badge shows `💬 CHAT @ · N`. GIFs — a message that IS an image URL (allowlisted hosts: Tenor/Giphy/Imgur media + bare image files) renders inline both hosts; Tenor search picker behind `VITE_TENOR_KEY` (web) / `EXPO_PUBLIC_TENOR_KEY` (app) — free key from Google Cloud console, founder to provision; without it the GIF button hides and pasted links still render. `chat_post` v2 (+p_mentions; old dropped), `_chat_message_json` shared shape, `chat_messages` v2 (+pins strip on latest page). Probes pl0–13, pn0–8, mn0–4; all suites green; parity untouched.

2026-08-14 — **The league talks: chat + DMs** (`v0.180.0`, migration 0147, APK 18000): the chat/DMs to-do, founder's pick. Two league-scoped surfaces: LEAGUE CHAT (one channel per league, every member + the commissioner, 500-char messages, 2s flood guard, authors delete their own / commish deletes anything — hard delete) and DIRECT (one thread per member pair PER LEAGUE — discovery is the league member list, names are its team names via `_chat_display_name`: team_name → co-manager's team → email prefix). Access RPC-only, RLS deny-all (the 0140 pattern); author names joined server-side so a message renders without a second fetch. Reads POLL: 8s while a surface is open, 60s for the badge (`chat_unread` — never marks read); fetching the LATEST page marks the surface read (opening the chat IS reading it) — probes pin that split (ch17/ch19). Web: 💬 CHAT · N button beside SHOP/FIELDS on the board toolbar → modal panel (LEAGUE/DIRECT tabs, sticky-bottom scroll, member picker). App: 💬 CHAT tab — and the tab strip now renders for ANY open league (play-only platform leagues get ▦ MATCHUP + 💬 CHAT; management tabs still commish-gated); long-press to delete. Twenty-first probe suite (ch0–ch24, dm0–dm13, rls0–2); all suites green; parity untouched. Not in v1: push notifications for messages (no push infra yet — unread badges only), cross-league inbox, tab-strip unread badge on the app.

2026-08-14 — **Half-point bonuses** (`v0.179.0`, migration 0146, APK 17900): the founder's "the scoring bonus should support decimals like +0.5". `bonus_pts` — the flat-points value on a flag rule (0144) and on a scoped scoring rule (0145) — now takes 0.5 steps (numeric scale 1, same ±10 bounds); TD bonuses stay integers. SQL sanitizers re-declared with `trim_scale(round(…,1))` so 0.5 stores as 0.5 and whole values stay trim (×2 not ×2.0 — also retro-cleans stored rules); engine parse (commish parseRules, leagueScoring parseScoring/scopedAdjustFor) rounds to 1dp instead of int; steppers step 0.5 both hosts. Probes f5a–c + s22a–b; all suites green; parity untouched; halves verified to stack (0.5+0.5→1) via engine parse test.

2026-08-14 — **Playtest round 1: the filters the founder reached for** (`v0.178.0`→`v0.178.2`, migration 0145, APK 17820): three same-hour follow-ups from live playtesting folded in. 0178.1: the app's kit sheets clipped at the bottom — the editors' content wasn't scrollable and the Overlay sheet clips overflow, so the new filter rows pushed the save controls off-screen; both editors now scroll their content and pin the actions in the sheet's footer. 0178.2 ("nothing happens when I click the flag button", web): the label-required error rendered at the TOP of the modal — scrolled out of view above a 500-row list — so the click looked dead; errors now render at the button, and better, an empty label with rules set auto-names the flag from its rules ("immune · ×2.5 pts", with a live preview hint), so pick-rules-hit-FLAG just works. Plus the founder's bulk-remove ask: ✕ UNFLAG (selected set) beside the FLAG button and ✕ CLEAR ALL {n} on the current-flags list (confirm-gated, chunked to the RPC's 500 cap) — the RPC's null-label delete gesture, no SQL change. All both hosts. three findings from the founder's first hands-on pass, fixed same-day. (1) "The scoring bonus doesn't take" — diagnosed as UX, not storage (sanitize verified on scratch): the bulk FLAG button silently greyed out when the label was empty, which reads as a broken save. The button now stays live and says what's missing ("Give the flag a label…"), with a standing hint under it — both hosts. (2) Bulk flag filters: position / team / tenure chips narrow the ~5.3k directory (alongside or instead of the search box) with ☑ SELECT ALL over the filtered set; bulk cap 200→500 so "flag every rookie" fits. Tenure and position ride the bio bake (pos newly baked; 5,363 players). (3) SCOPED SCORING BONUSES: `scoring.scoped` rules (max 12) matching pos/team/tenure — bonus_mult ×0.5..3 (per-play + drip rate), bonus_pts ±10 (game end, bank-floored), td_bonus −3..6; a player matches when EVERY given filter matches, rules stack (mults multiply, points sum), unknown tenure never matches a tenure rule. Engine seam `scopedAdjustFor()` beside the 0143/0144 caches; behavioral test hand-math green (qb 5.4→14.8 under ×1.5+3+TD3, identity on clear); parity untouched at defaults. `set_league_scoring` v2 (old 4-arg dropped — PostgREST overloads), s18–s24 probes, all nineteen suites green. Cosmetic: stored bonus_mult scale fixed (1.3000000000000000 → 1.3) + one-time cleanup. Editors both hosts; app team pick is a horizontal chip strip.

2026-08-14 — **The commish kit gets a desk** (`v0.177.0`, APK 17700, no migration): first playtest finding — the founder went looking for the flags tools in the COMMISH DASHBOARD and they only lived on the live board's ⚑ banner. Now both: web `CommishToolsPanel` (self-loading by leagueId — note/flags/scoring summaries + the same three editors) behind a new ⚑ KIT tab on every LeagueRow (CommishDash + AdminPage, any league kind); app `CommishToolsCard` on the ⚑ COMMISH screen. The board banner stays — mid-slate editing is still the primary surface; the dashboard is the desk.

2026-08-14 — **Flags that bite** (`v0.176.0`→`v0.176.1`, migration 0144, APK 17610, docs/flag-rules.md): the founder's functional-flags spec — flags carry RULES, set individually or in BULK. no_trade/no_add enforced at the DATA (one native_roster trigger keyed by acquisition kind; draft/commish always pass; process_waivers re-declared so a flagged claim marks LOST instead of aborting the sweep); no_start (sealed_pick trigger, manager-only + server exempt; worker auto-fill excludes the slug; pickers grey the player with the commissioner's reason inline, both hosts — 0176.1); no_powerups (slot-targeted effects stripped in resolveLiveMatchup, own boosts and enemy attacks alike; window-wide EMP/Rivalry stay); immune (all metric denial vs his bank/drip skipped — the TE-drip precedent generalized; steal cuts die with the denial); bonus ×0.5..3 per-play and ±10 raw at game end. Engine reads one cache (flagRulesFor); the worker prefetches flags per league and installs synchronously before each resolve (the 0143 isolation rule). Editors both hosts: rule toggle chips + bonus steppers; BULK multi-select (web 0176.0, app 0176.1) up to 200 via set_player_flags_bulk. Chips league-wide show rule glyphs. Behavioral tests: immune drip 14.5→40.3, ×2+5 bonus 3.8→10.8, identity on clear; 128 parity checks green untouched. Nineteenth probe suite; all nineteen green. EIGHT ships today — founder playtesting next; watch for whatever that shakes loose.

2026-08-14 — **The commissioner tunes the game** (`v0.175.0`, migration 0143, APK 17500): league scoring adjustments — the stated prerequisite for new positions + penalties scoring, now unblocked. The base system is measured-and-tuned and the catalog quotes its numbers, so leagues don't edit literals: three LAYERING knobs instead (the Underdog ×1.5 pattern) — TD BONUS [-3..+6, defensive TDs included], YARDAGE MULTIPLIER [0.5..2, flat per-yard AND drip-rate growth; per-event scoring deliberately untouched to protect the priced denial economy], TURNOVER PENALTY [0..5, bites the player's own bank, clamped at zero]. Defaults are the identity (128 parity checks green untouched); all-default stores nothing (reset == never touched, 0143). Engine: `engine/leagueScoring.ts` module cache + seams through scorePlay/dripRateOf/DST-drip/turnover site, verified by hand-math behavioral test both directions. Worker: knobs fetched with the tick prefetch, installed SYNCHRONOUSLY immediately before each resolve — matchups run 20-at-a-time under Promise.all, so set-then-resolve in one synchronous run is what keeps leagues isolated (an install separated by an await could be overwritten by a sibling). Client: ⚖ editor on the commish banner; a warn ⚖ chip every member sees whenever non-default knobs stand. Eighteenth probe suite; both hosts; worker deploy green. SIX ships today, none device-tested — tonight's slate is the shakedown for the whole stack.

2026-08-14 — **Rosters that keep up with the NFL** (`v0.174.0`, migration 0142, APK 17400): the "NFL roster updates" to-do, landed ahead of cut-down day (~Aug 25). Client player→team knowledge was baked and went stale on landing (the Carson Beck class of problem, about to go league-wide when 32 rosters cut to 53). Two layers now: the bio bake carries each player's CURRENT team (regenerated: 5,363 players, 1,972 with teams), and `player_team_override` (0142) holds the drift — the worker diffs Sleeper's directory against the bake daily (piggybacking the existing index refresh + once at boot, so a new bake immediately shrinks the table); NULL team = "cut, free agent now". Core `teamFor()/displayTeam()` (override → bake → caller's value), synchronous cache, injuries pattern. Lands in both player cards, the app's live-board team resolution, and the native draft pool's 2025 fallback; live Sleeper pools were already current. Seventeenth probe suite (global read, worker-only write). Folded in: `fullStats` toggle RETIRED (gated a wrap that always happens now), and commish ⚑ flags now render on the NATIVE league screens (web+app draft rooms, FA pools, my-roster lists) — the gap noted at 0141. Worker deploy confirmed green (boot runs the first override sync). Watch item: the "team overrides: N standing" fly log line should spike cut-down week — that's the system working.

2026-08-14 — **A play happens once, however many ids ESPN gives it** (`v0.173.1`, worker+bake only, no APK): the game_feed dedupe owed since the preseason opener. ESPN re-emits the same play under a fresh id when it restructures drives (seen at halftime); gameToFeed passed both copies into the whole-doc game_feed upsert, so the dupe was stored forever and only the web log deduped (display-level) — the app's log and both hosts' field visuals never did. Now the adapter dedupes at the source on the web log's own (clock, text) identity, last copy wins (the re-listed play is the revision — same rule as live_play's conflict-key dedupe). Covers every consumer at once; the web display dedupe stays as belt-and-braces for pre-deploy docs. Verified against a synthetic two-drive summary with a re-emitted play. Deployed via deploy-worker.yml (scripts/espn/** is in its trigger paths) ahead of tonight's slate.

2026-08-14 — **The commissioner gets a voice on the board** (`v0.173.0`, migration 0141, APK 17300): the commish kit — a LEAGUE NOTE (one standing announcement in settings_json; overwrite-in-place because a feed rots; 500-char cap) and PLAYER FLAGS (`player_flag`, 40-char labels — "keeper", "out for season", "ruled ineligible"), for ANY league kind including Sleeper pilots, which is where the need showed up. Members see the note as a purple ⚑ banner on the live board, both hosts; the commissioner edits it IN PLACE there (a note that requires the admin dashboard doesn't get written) and manages flags from the same banner via a searchable editor over the baked Sleeper directory (~5.3k active players, rookies included — any player flaggable whether rostered or not). Flags render as ⚑ chips with the injury badge's anatomy but purple (never reads as medical) beside every injury badge: pool rows, both pickers, player card, web and app. Plumbing is the injuries pattern (synchronous module cache `core/data/commish.ts` + version-counter bump). Sixteenth probe suite; all sixteen green. Not yet: flags on the NATIVE draft-room/FA-pool screens (cache loads with a live board today); no real-device pass.

2026-08-14 — **Stars get consumers, trades get signals** (`v0.172.0`, migration 0140, APK 17200): the favorites star (0139) recorded and nothing read it — now the draft room's player list and the FA/waiver pool grow ★ FIRST (float starred to the top) / ★ ONLY (hide the rest) chips plus a gold ★ on rows, web and app, deliberately distinct from the draft queue's ☆ (queue = per-draft ranked wishlist; favorites follow the account everywhere). And the trade market got a voice (`trade_signal`, 0140): 🔁 THE BLOCK (flag your own player as available — the whole league sees the shared block, with a 👀 count per shopped player), 👀 INTEREST (mark another team's player from a block row or while browsing their roster in the propose modal; the owner sees "TeamX is interested in your Y"), and every signal is one ⇄ tap from a propose modal preloaded with the right partner and player. Staleness by read, not by trigger: the read RPC joins native_roster and returns only signals whose premise holds (block dies when the player moves, want dies when the wanter lands him) — no cleanup chasing mutation paths, and a commish-undo revives signals for free. Premise checks server-side (block = own player only, want = someone else's only, free agents refuse both). Fourteenth probe suite; all fourteen green. Native leagues only. NOT device-tested yet — first real exercise should be the two-account test league.

2026-08-14 — **Player cards: tap a player, get the story** (`v0.171.0`→`v0.171.1`, migration 0139, APK 17101): the "player stats cards" to-do, absorbing tenure and star/favorites from the list on the way. One card, both hosts, opened from every surface you meet a player on — web: live-board ScoreCards, window pool rows, both picker variants (ⓘ InfoDot, stopPropagation so reading never picks); app: roster rows, picker mini-cards, live duel cards — all through a module-level bus (`openPlayerCard()` + one mounted host), the same shape both hosts. Content is what core already knew but never showed in one place: a baked bio file (`playerBio.ts`, 5,331 players from the Sleeper directory via `scripts/gen-player-bio.mjs` — tenure/college/jersey/age; regenerate at season boundary; jersey #0 is real, test `!= null`), the LIVE injury detail with comment + est. return (not just the letter), this week's statline when plays are loaded, the baked 2025 season line, and a ★ favorite backed by `favorite_player` (0139, RLS `app_user_id = auth.uid()`, eleventh probe suite) — account-scoped, so a star set in the app is lit on the web. Delivered as two merges (#388 card+web door, #389 all remaining doors) and APK 17101, built tree-frozen, four ritual checks green. Follow-ups parked: favorites don't yet sort/filter any list (the star records, nothing consumes it yet); no real-device pass.

2026-08-14 — **The backup mechanic, live-fire hardened** (`v0.170.0`→`v0.170.12`, migrations 0137–0138, APK 17012): the founder's ruling — auto-sub at lock, announced, reassignable, and the reassignment COUNTS — built end to end: `set_backup_assign` writes applied_state.targeted.backups (participant-gated, refused once the target's window kicks: "backups commit blind", 0138), both resolvers unified on auto-with-manual-override, the worker reads assignments per side. Its live-fire finds, each fixed same-day: the target menu was empty by construction (sealed picks aren't absence; kicked windows rightly barred — intersection nil); already-live weeks never re-ran the auto-fill (fill-only materializer now runs per tick: owned-loadout only, no AI rewrite/coin, idempotent); auto-fill went per-matchup → per-window → per-SLOT (any empty spot with an eligible player fills, humans included, never duplicating a fielded player); the autosave re-sent kicked windows and one refusal vetoed the whole batch (permanent phantom NOT SAVED + silently dropped real edits — kicked windows now stay out unless admin-held); a turnover scorched the QB's own card (worker flagsFor lacked the TURNOVER guard web always had — data-side fix, no APK). Also: metric DRIVER stat under the chip both hosts ("what is my metric counting" vs the statline's "what has he done"); ▦ FIELDS on the live board web AND app (was demo-only); unopposed slots read as the same widget with a blank card; statline compact+bottom-pinned+inset (three iterations, founder-steered). **Ritual amendment: THE TREE IS FROZEN WHILE GRADLE RUNS** — metro bundles the tree as-it-is, not the launch commit; two hybrid APKs caught by the version-string check. Open: `fullStats` toggle is vestigial (retire); worker-side game_feed dedupe owed; four Turf Warriors seats claimed-but-unenrolled (opponents see all-backup weeks — flip to AI or chase the humans); diag-backup-windows.sql re-run recommended post-Friday-lock.

2026-08-14 — **Backups become real: auto at lock, announced, reassignable — and the reassignment counts** (`v0.170.0`, 0137). The founder assigned a backup on one device; another device didn't show it. Three layers down: (1) assignments synced via `hero_applied`, whose RLS accepts writes only while the matchup is `scheduled` — but backups are assigned AT LOCK by design, so every post-lock write was refused and silently swallowed; (2) each device kept its own localStorage copy; (3) none of it mattered because the worker's resolver auto-maximizes backups and never read assignments, while the client engine scored unassigned backups 0 — two resolvers, two answers. Founder's ruling: auto at lock (announced), manual reassignment on top, honored by scoring. Now: `set_backup_assign` (0137) writes `applied_state.payload_json.targeted.backups` — the store the worker already loads — writable until `final` (post-lock is the point); both resolvers unified (manual first, respecting a losing choice by leaving it unused; auto-max the rest — the client's "benched until you choose" fiction is gone); worker threads `backups` through `toExtras`; client dual-writes (hero blob pre-lock + RPC always) and hydrates server-first. App: a kicked window's empty opposing half now renders NO PLAYER/NO PICK instead of an eternal SEALED back (Duel/LiveCard `unopposed`), and a kicked window never reads "SEALED". Tenth probe suite (`backup-assign-probes.sql`). WATCH ITEM: the founder's Thu 9:00p unopposed window showed no slot_scores at all next morning — if it still shows big reveal-stage cards after this worker deploy + a resolve pass, the one-sided-window scoring gap is real; chase with a dbquery diagnostic. Needs APK (17000) for the app halves.

2026-08-13 (slate night) — **Live-fire polish burst** (`v0.169.1`→`v0.169.8`, all Pages-only): game info moved off the live cards onto each slot log's toggles row with LIVE SCORE (chips: logos+codes desktop, logos-only mobile, team-code fallback on 404); statlines never truncate (desktop wraps; then moved to lie across the card's full width, metric cap 48%→60%; `fullStats` toggle now vestigial — retire it); PLAYS/sort toggles at true center (1fr|auto|1fr grid), sort is arrow-only; game log starts collapsed and dedupes ESPN re-emitted plays (worker-side feed dedupe still owed); unopposed-backup chip only counts KICKED windows (sealed picks aren't absence — first multi-window night exposed it); app rookie teams resolve from the pool row not the 2025 bake (APK 16902, verified + delivered). Ops: GitHub App integration CANNOT fire workflow_dispatch (403) — relock + missed-deploy recovery both needed a human click or a fresh merge; worth granting Actions write. One dropped push-trigger on the v0.169.8 merge — redeployed via this commit.

2026-08-13 (late) — **Per-league week lock switch** (`v0.169.0`, 0136), grown from the same-evening live-fire emergency: mid-slate the founder needed all of practice week 102 reopened NOW and held open until manually relocked. 0134 did it as a week-global hold with the reopen riding in the migration (migrate.yml on main being the session's only prod write path); 0135 followed within the hour because the web board derives window locks from the wall clock against slate kickoffs and was showing 🔒 over an open database — `lock_holds()` is the peephole and the board polls it every 30s. 0136 is the grown-up version the founder asked for: `admin_set_week_lock(league, week, locked)` behind AdminPage 🔓 unlock / 🔒 lock buttons per league (ADMIN MODES), holds scoped to (league, week) in `week_lock_hold` (the active 102 hold was converted, not dropped). UNLOCK records the hold, reopens the week's scheduled/live matchups (never `final`) with far-future `lock_at`, unseals+unreveals picks; open boards follow inside ~30s. LOCK deletes the hold and NULLs `lock_at` — deliberately *not* "lock now": the worker's backfill restores the week's NATURAL lock time, so an early relock doesn't jump the gun and a mid-slate relock seals next tick. The app needed no changes (it gates on matchup status/lock_at). Ninth probe suite rewritten for the RPC (blast-radius: other weeks/leagues/final untouched; unseal+unreveal; NULL semantics; non-admin refused). Deployed same evening; `relock-102.sql` remains as a bulk dbquery fallback. Earlier same day: v0.167.0 injury badges + engine healthy(), v0.168.0 member self-sync, v0.168.1 board-honors-hold, APK 16800 (note: the build env had NO Android SDK — JDK 17 + cmdline-tools were installed ad hoc; bake them into the environment or a SessionStart hook before the next APK ask).

2026-08-13 — **Members sync themselves** (`v0.168.0`, migration 0133): kills the live join-rush failure ("it says im not in the league when I try to claim team") where everyone who joined the Sleeper league after the commissioner's last ⟳ refresh members bounced off `redeem_invite` until the button was pressed again. Same shape as the self-granting allowance: the button stays, the system stops needing it. One guarded membership write (`_upsert_membership_rows`, 0105's never-unseat semantics; the commish button is now a shell over it, and the worker's `importLeague` — which was raw-upserting and could unlink an enrolled manager on re-import — now goes through it too); a worker sweep (poked leagues next ~25s tick, every current-season sleeper league on a 10-min safety net, failed fetches back off); and a self-healing claim flow — on the exact "not a manager" bounce the web claim screen pokes `request_member_sync` (any signed-in code holder; rate-limited to one standing request per league per 20s) and re-runs the preview for up to 60s with honest copy, so a just-joined manager seats themselves in about one tick with no commissioner involved. The poke deliberately carries no member rows — an invite code is a weak credential, so the worker fetches from Sleeper itself. Eighth probe suite (`member-sync-probes.sql`) covers grants, guards, rate limit, due/consume/back-off, and the bounce→sync→redeem loop end to end; all eight suites green. NOT live until both the migration lands on `main` AND the worker is `fly deploy`ed — until then pokes stamp a flag nothing consumes.

2026-08-13 — **Injury badges, on the live feed** (`v0.167.0`): the worker has polled ESPN into `injury_status` daily since 0001 and *nothing ever read it* — zero consumers outside `server/`. The only injury UI in the product read a hardcoded 2025 file that disables itself on any other season, so on the 2026 board that locks Sep 9 all twelve badge sites rendered blank and the app had no injury UI at all. Now wired: a direct select (the table has carried an authenticated-read policy since 0001, so **no migration**), loading into a synchronous module cache behind the existing `injuryFor()` — the same shape as the live-play overlay, because the render path and the engine's lineup builders both call it and neither can await. Badges on both hosts, including the app's player picker, the last thing seen before committing a player to a slot. It also fixes a quieter bug: `defaultLineup`/`aiLineup` gate on the same function, so on a 2026 board the engine believed **every player was available** — from now on an auto-set lineup benches Out/IR (Questionable and Doubtful stay startable; founder's call). The report answers only for the week it was polled for — ESPN's feed is a now-snapshot with no week and no history — and outranks the baked 2025 file for that week so the two never blend. Web re-polls every 5 min because designations move when it matters most: inactives drop ~90 min before kickoff, inside the hour when picks are still open and lock at kickoff-1h. `npm run check:injuries` (23 assertions, folded into `check:parity`) guards the precedence rules, because a wrong answer here looks exactly like a healthy league — which is how this went unnoticed for the life of the project. No real-device pass yet.

2026-08-10 — **The site is an installable app** (`v0.141.0`): manifest, icon set, and a service worker, so dripfantasy.com installs to a home screen on both platforms and works offline. Step one of `docs/mobile-app-plan.md` — PWA now, Capacitor shells built during the season, store submission for 2027 (that doc also supersedes README "Phase 3" and says why a React Native port is the wrong trade). Caching is built around never pinning anyone to an old build mid-Sunday: navigations network-first, content-hashed `/assets/` cache-first across two retained generations, nothing dynamic cached, and a one-line kill switch that unregisters every client. It also fixes a bug that predates it — Pages drops the previous deploy's files, so deploying mid-session used to break `React.lazy()` chunk loads in open tabs. An install banner (60s warm-up, 45-day snooze, hidden on the live board) covers Chromium's install dialog and iOS's Share sheet, with `pwa_install_*` events plus `standalone` on `app_open` so installs read as a retention cohort. Verified headlessly: offline reload, mid-deploy survival, network-first freshness, cache bounding, and the kill switch. Not done on purpose: push — the server half is identical for web and native, so it's scheduled once, with the shells.

2026-08-09 — **Preseason practice for playtesters** (0110). Preseason play existed since 0054/0101 but was super-admin-only and not actually throwaway: practice results counted in the standings AND the playoff seeding, practice coin banked into the real wallet, practice power-ups charged that wallet and moved real inventory, and the weekly budget could be granted for a preseason week. All four sealed server-side behind one rule — *a practice week never moves real coin, real inventory, or a real record* — with power-ups made free (not refused) so a broke team can still exercise the board. Opening practice is now a commissioner's ONE click (`enablePreseasonPractice` = turn on + seed all three weeks' deep pools), replacing two admin buttons that had to be pressed in order and re-pressed after every re-toggle. Also revoked `_clone_preseason_weeks` from PUBLIC (SECURITY DEFINER, any signed-in user could wipe another league's preseason weeks). New probe suite green on a clean scratch DB; the probe runner itself was dying at 0091 for want of `pg_net`, so everything after it had gone unchecked.

2026-08-08 — **Window Pot v1 built, flagged OFF** (`v0.140.0`): an OPT-IN wager ladder on any game window. One manager puts ◎10 up, the other matches it or ignores it; if matched they trade check/wager/call/raise in strict turn until that window's PICKS lock, and the winner of the window takes the pot. Backing out costs exactly the ante and returns every wagered chip; an unmatched offer voids and an unanswered wager comes home, so silence is never punished. Designed and built twice the same day — the first pass followed the original spec (automatic ◎5 ante at lock, post-lock betting, hidden auto-call policy, quiet-hours clocks) and the founder inverted it to opt-in/pre-lock, which deleted the policy and the clocks outright. Migration `0117_window_pot.sql` is the authority — advisory-locked turn-gated RPCs, RLS member-read + RPC-only writes, every wallet move idempotent; the betting deadline is literally the `enforce_window_lock` expression so it can't drift from picks lock. Worker sweep in `server/src/pot.js` closes pots at the deadline and settles at the window's final; the client chip + action sheet live on the window section (`src/screens/WindowPot.tsx`) because the ladder is played during setup. Ships OFF everywhere behind a per-league super-admin toggle (AdminPage → ADMIN MODES → 🪙 window pot, with a `tune` for the ante/cap and a `⟲ void N open` escape hatch that refunds every chip); turning it off never strands coin — pots already running still close and settle themselves. Every §6 scenario asserted in `scripts/db/window-pot-probes.sql`; the scratch-probe harness was repaired on the way (pg_net stub, two stale gate assertions) and is green. Coin in, coin out — a pot never moves a point.

2026-08-07 — **First live-fire complete** (preseason CAR@ARI): the full loop — seal, 1h-lead lock, per-window reveal, live ESPN ingest, resolve, effects, window bonus, coin payout — ran end to end on a real NFL game, final 40.0–23.0. Nine live-found defects fixed the same night (PRs #254–#263; the standouts: the pick-cache clobber that could overwrite sealed picks, and ESPN's halftime drive restructuring silently freezing `live_play` via duplicate-key batch rejection — full detail in HANDOFF "First live-fire"). Field visuals overhauled (team-colored end zones, possession logos, TV-flip, YAC + return-split play rendering, window game log). Yahoo developer app APPROVED and `yahoo-oauth` deployed — remaining: `VITE_YAHOO_CLIENT_ID` repo variable + redirect-URI fix, then a first real league connect. New feature spec'd and ready to build: **the Window Pot** (`docs/window-pot.md` + kickoff prompt), v1 behind a per-league flag.

## Previous

2026-07-28 — Access model shipped (0094/0095): standalone solo play (pods/showdowns) is a per-account feature the founder flips (AdminPage FEATURE FLAGS); DFS leagues are commissioner-run — founder approves commissioners (`dfs_commish` flag), they found private DFS leagues (kind='dfs', same salary-board machinery) and distribute invite codes (the invite is the access); drafted-on-site native leagues (incl. mocks) moved off the admin-only "closed testing" gate onto the same model (`native` flag). Earlier: DFS-style team building shipped for pods + showdowns (0092): players build a 9-man squad under a $50k salary cap from a weekly-frozen salary board (weekly projections → salaries; source chain StatHead-weekly-bake → Sleeper live weekly → StatHead season → 2025 actuals); AI seats and no-show humans get a seeded auto-build; random deal removed. Per-game late swap (0093): each player locks 1h before HIS kickoff — frozen picks can't leave the entry, locked games can't be added, everything else swaps through Monday night. Earlier same day: Yahoo live-ready (PR #215), lead alerting (0091, needs one-click function deploy), proj2026.ts re-baked at 416-player depth with Sleeper-id exact joins (StatHead MCP shipped our feedback incl. injury-aware weekly + K/DST). Engagement strategy reframed: ads sell solo play; league adoption is the expansion step.

## Current blockers

- Preseason practice (0110) is on the branch, not live: the migrate workflow only runs on push to `main` (`paths: supabase/migrations/**`), and the same `fly deploy` below carries `resolve.js`'s practice-week coin skip. Until both land, the RPC guards aren't in the DB and practice coin would still bank.
- `fly deploy` of the worker pending — carries #262's `ret` emission for live game feeds, the practice-week coin skip above, AND the Window Pot's sweep. Do before the Aug 13 preseason slate, which is the validation run for all the live-fire fixes and the pot's live-fire.
- Yahoo activation: set the `VITE_YAHOO_CLIENT_ID` repo VARIABLE (+ site rebuild) and fix the Yahoo console redirect URI (`https://dripfantasy.com/` + www — currently the httpbin placeholder); then the first real league connect (JSON mapping unvalidated against live Fantasy data).

## Next 3 tasks

1. **Live-fire the Window Pot** on the Aug 13 slate: `fly deploy` the worker, then flip the two-account test league on from the admin page and walk all five outcomes across the six-window preseason slate — an offer matched and laddered to the cap, one backed out of (costs exactly ◎10), one wager left unanswered (returns at picks lock), one offer left unmatched (voids), and one window finished + re-resolved twice to prove the pot pays once. Spec §12 has the flag-flip procedure.
2. Aug 13 preseason slate = regression run for the nine live-fire fixes (lock lead, dedupe ingest, state-driven FINAL, feed-anchored clocks) + first `ret`/`yac` splits on live data. Watch `fly logs` for the new loud `poll game` errors.
3. Yahoo end-to-end (variable + redirect URI + first league connect), then update the FAQ's "Yahoo landing next" line to fully supported. Carried: showdown re-engagement email; DFS commissioner + solo flag approvals.
