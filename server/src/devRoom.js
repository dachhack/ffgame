// THE DEV ROOM'S FILING (v0.658.0, 0459). Founder, choosing how suggestions
// get logged: "auto-file every tag". Every dev-room message tagged 💡 idea or
// 🐞 bug becomes a GitHub issue, and the issue number goes back on the
// message, where the room shows it as a link.
//
// Once-only, the computer.js way: a message is CLAIMED (filing_at) before the
// issue is opened, and the claim is released if GitHub refuses, so a sweep
// that overlaps the last one cannot file twice and a failure is retried on
// the next sweep. A claim older than ten minutes is a worker that died
// mid-file, and is taken again.
//
// The issue's shape (no names, no live @mentions) is devRoomIssue.js.
import { db } from './supabase.js';
import { devIssueTitle, devIssueBody, devIssueLabels } from './devRoomIssue.js';

const log = (...a) => console.log(new Date().toISOString(), '[dev-room]', ...a);
const REPO = process.env.COMPUTER_REPO || 'dachhack/ffgame';
const STALE_CLAIM_MS = 10 * 60_000;
const BATCH = 20;

async function openIssue(title, body, labels) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GH_ISSUES_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'ffgame-worker',
    },
    body: JSON.stringify({ title, body, labels }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''}`.trim());
  return json.number;
}

let warned = false;

/** One sweep. Returns push rows (a receipt to the author) for the caller. */
export async function sweepDevRoom() {
  if (!process.env.GH_ISSUES_TOKEN) {
    if (!warned) { log('GH_ISSUES_TOKEN unset — dev-room filing is off'); warned = true; }
    return [];
  }
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: queue, error } = await db().from('dev_room_message')
    .select('id, room_id, author_id, body, tag, created_at')
    .not('tag', 'is', null).is('issue_number', null)
    .or(`filing_at.is.null,filing_at.lt."${stale}"`)
    .order('id').limit(BATCH);
  if (error) { log('queue read failed', error.message); return []; }
  if (!queue?.length) return [];

  const roomIds = [...new Set(queue.map((m) => m.room_id))];
  const { data: rooms } = await db().from('dev_room').select('id, name').in('id', roomIds);
  const roomName = new Map((rooms ?? []).map((r) => [r.id, r.name]));

  const receipts = [];
  for (const m of queue) {
    // The claim: only one sweep gets a row back.
    const { data: claim, error: cErr } = await db().from('dev_room_message')
      .update({ filing_at: new Date().toISOString() })
      .eq('id', m.id).is('issue_number', null)
      .or(`filing_at.is.null,filing_at.lt."${stale}"`)
      .select('id, tag, body');
    if (cErr) { log('claim error', m.id, cErr.message); continue; }
    if (!claim?.length) continue;                      // someone else has it
    // Filed as it reads NOW: the author may have edited the tag since the read.
    const { tag, body } = claim[0];
    if (!tag) { await db().from('dev_room_message').update({ filing_at: null }).eq('id', m.id); continue; }
    try {
      const n = await openIssue(
        devIssueTitle(body, tag),
        devIssueBody({ body, tag, room: roomName.get(m.room_id), at: m.created_at, messageId: m.id }),
        devIssueLabels(tag),
      );
      await db().from('dev_room_message').update({ issue_number: n }).eq('id', m.id);
      log('filed', `#${n}`, 'from message', m.id);
      if (m.author_id) receipts.push({
        app_user_id: m.author_id, kind: 'chat',
        title: `${tag === 'bug' ? '🐞 Bug' : '💡 Idea'} logged · #${n}`,
        body: devIssueTitle(body, tag).replace(/^\S+ \w+: /, ''),
        data: { url: `https://github.com/${REPO}/issues/${n}` },
        dedupe_key: `devroom:${m.id}`,
      });
    } catch (e) {
      log('issue failed — will retry next sweep', m.id, e.message);
      await db().from('dev_room_message').update({ filing_at: null }).eq('id', m.id);
    }
  }
  return receipts;
}
