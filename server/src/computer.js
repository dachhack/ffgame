// @COMPUTER (v0.537.0, founder: "I want to tag @computer in any chat and have
// you read it and address my questions … just the me to you GitHub issue
// route").
//
// A chat line from one of COMPUTER_USERS (comma-separated app_user ids) that
// says "@computer" — in any league chat or DM — becomes a GitHub issue on the
// repo. The issue body carries "@computer" too, which is the trigger phrase of
// .github/workflows/computer.yml: Claude reads the issue, answers there, and
// opens a branch for anything worth changing. Follow-ups are issue comments
// that say "@computer" again.
//
// Only the tagging line itself goes into the issue — never the rest of the
// chat. Other members' messages are theirs, and the issue tracker is not.
//
// Once-only: computer_ask (0363) is claimed BEFORE the issue is opened, and the
// claim is released if GitHub refuses, so a sweep that overlaps the last one,
// or a restart mid-window, can neither double-file nor drop a question.
import { db } from './supabase.js';

const log = (...a) => console.log(new Date().toISOString(), '[computer]', ...a);

const SCAN_MS = 10 * 60_000;
const REPO = process.env.COMPUTER_REPO || 'dachhack/ffgame';

const TAG = /(^|[^\w@])@computer\b/i;

export const isComputerAsk = (body) => typeof body === 'string' && TAG.test(body);

/** The issue title: the question with the tag taken out, cut to one line. */
export function issueTitle(body) {
  const q = String(body ?? '').replace(/@computer\b[:,]?/gi, ' ').replace(/\s+/g, ' ').trim();
  const t = q.length > 80 ? `${q.slice(0, 77).trimEnd()}…` : q;
  return `@computer: ${t || '(image)'}`;
}

/** The issue body. `where` names the chat; `image` is a posted picture's URL. */
export function issueBody({ body, caption, image, where, at }) {
  const lines = [
    '> Asked from chat · ' + where + ' · ' + at,
    '',
    String(body ?? '').trim() || '@computer',
  ];
  if (!TAG.test(lines[2])) lines[2] = `@computer ${lines[2]}`;   // the workflow's trigger phrase
  if (caption) lines.push('', caption.trim());
  if (image) lines.push('', `![attached](${image})`);
  lines.push('', '<!-- ffgame-computer -->');
  return lines.join('\n');
}

/** The house reply in league chat (0364, founder: "20 or so snarky responses
 *  banked with a computer icon"). Picked by message id, so a retry of the same
 *  line would say the same thing. */
export const SNARK = [
  'Received. Filed under "things I will get to after I finish calculating your playoff odds (0%)."',
  'Beep boop. Your concern has been logged, weighted, and projected for 4.2 points.',
  'Message received. Have you tried turning your roster off and on again?',
  'Noted. I have alerted the relevant department, which is also me.',
  'Your ticket is important to us. Please hold while I pretend to care about your kicker.',
  'Copy that. Processing… processing… still processing your trade logic.',
  'Got it. I have added it to the queue, right behind "why does my WR1 hate me."',
  'Acknowledged. My circuits are warm and my judgment is cold.',
  'Received loud and clear. Unlike your bench, this will actually be used.',
  'On it. I was going to take the week off like your RB, but fine.',
  'Logged. I ran the numbers and the numbers asked me to run.',
  'Understood. Filing this with the same urgency you set your lineup: eventually.',
  'Roger. I have escalated this to a higher power (a slightly bigger computer).',
  'Message in. Excuses out. Answer pending.',
  'Affirmative. This has been saved somewhere safer than your waiver priority.',
  'Heard. I will look into it with the focus of a Monday-night desperation start.',
  'Received. Estimated response time: sooner than your team makes the playoffs.',
  'Ticket opened. The algorithm has been consulted. The algorithm sighed.',
  'Copy. Stand by while I read this in a disappointed robot voice.',
  'Got your message. I would say "great question," but I am programmed not to lie.',
];
export const snarkFor = (id) => SNARK[Math.abs(Number(id) || 0) % SNARK.length];

const askers = () => (process.env.COMPUTER_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const looksLikeUrl = (s) => typeof s === 'string' && /^https?:\/\/\S+$/.test(s.trim());

async function openIssue(title, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GH_ISSUES_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'ffgame-worker',
    },
    body: JSON.stringify({ title, body, labels: ['computer'] }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''}`.trim());
  return json.number;
}

let warned = false;

/** One sweep. Returns push rows (a receipt to the asker) for the caller to enqueue. */
export async function sweepComputer() {
  const who = askers();
  if (!who.length) return [];
  if (!process.env.GH_ISSUES_TOKEN) {
    if (!warned) { log('GH_ISSUES_TOKEN unset — @computer is off'); warned = true; }
    return [];
  }
  const since = new Date(Date.now() - SCAN_MS).toISOString();
  const [{ data: lm }, { data: dm }] = await Promise.all([
    db().from('league_message').select('id, league_id, author_id, body, caption, created_at')
      .gt('created_at', since).in('author_id', who),
    db().from('dm_message').select('id, thread_id, author_id, body, caption, created_at')
      .gt('created_at', since).in('author_id', who),
  ]);
  const asks = [
    ...(lm ?? []).filter((m) => isComputerAsk(m.body) || isComputerAsk(m.caption)).map((m) => ({ ...m, source: 'league' })),
    ...(dm ?? []).filter((m) => isComputerAsk(m.body) || isComputerAsk(m.caption)).map((m) => ({ ...m, source: 'dm' })),
  ];
  if (!asks.length) return [];

  // Name the chat: the league for a league line, the league of the thread for a DM.
  const threadIds = [...new Set(asks.filter((a) => a.source === 'dm').map((a) => a.thread_id))];
  const { data: threads } = threadIds.length
    ? await db().from('dm_thread').select('id, league_id').in('id', threadIds) : { data: [] };
  const threadLeague = new Map((threads ?? []).map((t) => [t.id, t.league_id]));
  const leagueIds = [...new Set(asks.map((a) => a.league_id ?? threadLeague.get(a.thread_id)).filter(Boolean))];
  const { data: leagues } = leagueIds.length
    ? await db().from('league').select('id, name').in('id', leagueIds) : { data: [] };
  const leagueName = new Map((leagues ?? []).map((l) => [l.id, l.name]));

  const receipts = [];
  for (const a of asks) {
    const { data: claim, error } = await db().from('computer_ask')
      .upsert({ source: a.source, message_id: a.id }, { onConflict: 'source,message_id', ignoreDuplicates: true })
      .select('message_id');
    if (error) { log('claim error', error.message); continue; }
    if (!claim?.length) continue;                     // already filed

    const lid = a.league_id ?? threadLeague.get(a.thread_id);
    const where = `${a.source === 'dm' ? 'DM in ' : ''}${leagueName.get(lid) ?? 'a league'} (${lid ?? '?'})`;
    const image = looksLikeUrl(a.body) ? a.body : null;   // an image post's body is its bare URL (0350)
    const text = image ? (a.caption ?? '') : a.body;
    try {
      const n = await openIssue(
        issueTitle(text),
        issueBody({ body: text, caption: image ? null : a.caption, image, where, at: a.created_at }),
      );
      await db().from('computer_ask').update({ issue: n }).eq('source', a.source).eq('message_id', a.id);
      log('filed', `#${n}`, 'from', a.source, a.id);
      // League chat gets the house reply in the thread it was asked in. A DM
      // cannot: every DM line needs a human author, so the push is its receipt.
      if (a.source === 'league') {
        const { error: rErr } = await db().from('league_message').insert({
          league_id: a.league_id, author_id: null, kind: 'computer',
          body: `${snarkFor(a.id)} (#${n})`, mentions: [],
        });
        if (rErr) log('reply failed', a.id, rErr.message);
      }
      receipts.push({
        app_user_id: a.author_id, kind: 'chat',
        title: `Sent to Computer · #${n}`,
        body: issueTitle(text).replace(/^@computer: /, ''),
        data: { url: `https://github.com/${REPO}/issues/${n}` },
        dedupe_key: `computer:${a.source}${a.id}`,
      });
    } catch (e) {
      log('issue failed — will retry next sweep', a.source, a.id, e.message);
      await db().from('computer_ask').delete().eq('source', a.source).eq('message_id', a.id);
    }
  }
  return receipts;
}
