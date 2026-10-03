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
// v0.595.0 (founder: "look at the rest of the chat … that should be the
// pipeline"): the issue also carries the chat from the 15 minutes before the
// ask, so "@computer I thought we fixed this" arrives with the "this". The
// repo is public, so other members are "Member A", "Member B" (founder's
// choice: names hidden), their @mentions are masked and their pictures are
// left out; the asker's own lines and screenshots go in as posted.
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

// ── THE CHAT BEFORE THE ASK (v0.595.0) ─────────────────────────────────────
export const CONTEXT_MS = 15 * 60_000;
const CONTEXT_MAX = 25;
const LINE_MAX = 400;
const MENTION = /@(?!computer\b)[^\s@,.!?;:]+/gi;

/** The chat before an ask as markdown lines, others' names hidden. Pure.
 *  `msgs` oldest first: { author_id, body, caption, kind, created_at }. */
export function contextSection(msgs, askerId) {
  const names = new Map();
  const who = (m) => {
    if (m.author_id === askerId) return 'Asker';
    if (!m.author_id) return m.kind === 'computer' ? 'Computer' : 'League';
    if (!names.has(m.author_id)) {
      const i = names.size;
      names.set(m.author_id, `Member ${i < 26 ? String.fromCharCode(65 + i) : i + 1}`);
    }
    return names.get(m.author_id);
  };
  const clip = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > LINE_MAX ? `${t.slice(0, LINE_MAX - 1)}…` : t; };
  const lines = [];
  for (const m of msgs ?? []) {
    const name = who(m);
    const mine = name === 'Asker';
    const hide = (s) => (mine ? clip(s) : clip(s).replace(MENTION, '@member'));
    const isImg = looksLikeUrl(m.body);
    let text = isImg ? (mine ? `![image](${String(m.body).trim()})` : '(image)') : hide(m.body);
    if (m.caption) text += ` ${hide(m.caption)}`;
    if (m.kind === 'poll') text = `(poll) ${text}`;
    const t = String(m.created_at ?? '').slice(11, 16);
    lines.push(`> **${name}**${t ? ` · ${t}` : ''} — ${text.trim() || '(empty)'}`);
  }
  if (!lines.length) return '';
  return [`**Chat before the ask** (last ${CONTEXT_MS / 60_000} min, UTC; other members' names hidden)`, '', ...lines.flatMap((l) => [l, '>'] ).slice(0, -1)].join('\n');
}

/** The messages before an ask in its chat, oldest first. */
export async function chatBefore(a) {
  const from = new Date(Date.parse(a.created_at) - CONTEXT_MS).toISOString();
  const q = a.source === 'league'
    ? db().from('league_message').select('id, author_id, body, caption, kind, created_at').eq('league_id', a.league_id)
    : db().from('dm_message').select('id, author_id, body, caption, created_at').eq('thread_id', a.thread_id);
  const { data, error } = await q.gte('created_at', from).lt('created_at', a.created_at)
    .order('created_at', { ascending: false }).limit(CONTEXT_MAX);
  if (error) { log('context read failed', error.message); return []; }
  return (data ?? []).filter((m) => m.id !== a.id).reverse();
}

/** The issue body. `where` names the chat; `image` is a posted picture's URL;
 *  `context` is contextSection's markdown. */
export function issueBody({ body, caption, image, where, at, context }) {
  const lines = [
    '> Asked from chat · ' + where + ' · ' + at,
    '',
    String(body ?? '').trim() || '@computer',
  ];
  if (!TAG.test(lines[2])) lines[2] = `@computer ${lines[2]}`;   // the workflow's trigger phrase
  if (caption) lines.push('', caption.trim());
  if (image) lines.push('', `![attached](${image})`);
  if (context) lines.push('', '---', '', context);
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

/** Post a comment on an issue, as the worker. */
async function comment(n, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${n}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GH_ISSUES_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'ffgame-worker',
    },
    body: JSON.stringify({ body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''}`.trim());
  return json.id;
}

/** Backfill: the chat before an already-filed ask, as a comment on its issue
 *  (ops "computer-context"). The comment says @computer so relayFixes never
 *  mistakes it for the fix note. v0.595.1: the worker's token may open issues
 *  but not comment (a 403 on the first backfill), so then the context goes in
 *  a new issue that points back at the ask. */
export async function postContext(n) {
  if (!process.env.GH_ISSUES_TOKEN) throw new Error('GH_ISSUES_TOKEN unset');
  const { data: ask } = await db().from('computer_ask').select('source, message_id').eq('issue', n).maybeSingle();
  if (!ask) throw new Error(`no chat ask filed as #${n}`);
  const table = ask.source === 'league' ? 'league_message' : 'dm_message';
  const cols = ask.source === 'league' ? 'id, league_id, author_id, created_at' : 'id, thread_id, author_id, created_at';
  const { data: m, error } = await db().from(table).select(cols).eq('id', ask.message_id).maybeSingle();
  if (error || !m) throw new Error(`the ask's message is gone (${error?.message ?? 'deleted'})`);
  const ctx = contextSection(await chatBefore({ ...m, source: ask.source }), m.author_id);
  const body = `Chat context for this @computer ask (backfilled)\n\n${ctx || '_Nothing was said in that chat in the 15 minutes before the ask._'}`;
  let filed = null;
  try { await comment(n, body); }
  catch (e) {
    if (!/^403\b/.test(e.message)) throw e;
    filed = await openIssue(`@computer: chat context for #${n}`, `${body}\n\nFor #${n}.\n\n<!-- ffgame-computer -->`);
  }
  return { issue: n, ...(filed ? { filed_as: filed } : {}), lines: ctx ? ctx.split('\n').filter((l) => l.startsWith('> **')).length : 0 };
}

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

/** GitHub, read-only, as the worker. */
async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GH_ISSUES_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'ffgame-worker',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''}`.trim());
  return json;
}

// ── THE FIX, BACK IN THE CHAT (v0.562.0, 0393) ─────────────────────────────
// Founder: "yes, post fixes to the league chat too." When an ask's issue is
// closed as COMPLETED, its last comment — the fix note — goes back to where
// it was asked: a house line in the league's chat, or, for a DM (no house line
// can go there), a push to the asker. Once per ask (computer_ask.relayed_at).
// An issue closed as not planned, or closed more than RELAY_MAX_AGE_MS ago
// (history from before this shipped), is marked and left quiet.
const RELAY_EVERY_MS = 5 * 60_000;
const RELAY_MAX_AGE_MS = 48 * 3600_000;
let lastRelay = 0;

/** The chat line for a fixed issue: its note in plain words, one line. Pure. */
export function fixLine(n, note) {
  const text = String(note ?? '')
    .split(/\n-{3,}\n/)[0]                                // the attribution footer
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                 // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // links → their words
    .replace(/[*_`]+/g, '')                               // emphasis, code
    .split('\n').map((l) => l.replace(/^\s*(?:[-•]|\d+\.)\s+/, '').trim()).filter(Boolean)
    .join(' ')
    .replace(/@computer\b/gi, 'computer')                  // never re-trigger anything
    .replace(/\s+/g, ' ').trim()
    // The line already says so: drop the note's own "✅ Fixed…" opener.
    .replace(/^✅\s*/, '').replace(/^(?:Fixed|Done)\b.*?[.:](?=\s|$)\s*/i, '');
  const head = `✅ Fixed (#${n})`;
  if (!text) return `${head}.`;
  const room = 480 - head.length - 2;
  return `${head}: ${text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text}`;
}

/** One relay pass. Returns push rows (DM asks) for the caller to enqueue. */
export async function relayFixes(now = Date.now()) {
  if (!process.env.GH_ISSUES_TOKEN || now - lastRelay < RELAY_EVERY_MS) return [];
  lastRelay = now;
  const { data: asks, error } = await db().from('computer_ask')
    .select('source, message_id, issue').not('issue', 'is', null).is('relayed_at', null);
  if (error || !asks?.length) return [];
  const mark = (a) => db().from('computer_ask').update({ relayed_at: new Date().toISOString() })
    .eq('source', a.source).eq('message_id', a.message_id);
  const receipts = [];
  for (const a of asks) {
    try {
      const iss = await gh(`/issues/${a.issue}`);
      if (iss.state !== 'closed') continue;
      if (iss.state_reason !== 'completed' || now - Date.parse(iss.closed_at) > RELAY_MAX_AGE_MS) { await mark(a); continue; }
      const comments = await gh(`/issues/${a.issue}/comments?per_page=100`);
      const note = [...(Array.isArray(comments) ? comments : [])].reverse().find((c) => c?.body && !/@computer\b/i.test(c.body))?.body;
      const line = fixLine(a.issue, note);
      if (a.source === 'league') {
        const { data: m } = await db().from('league_message').select('league_id').eq('id', a.message_id).maybeSingle();
        if (m?.league_id) {
          const { error: e } = await db().from('league_message').insert({ league_id: m.league_id, author_id: null, kind: 'computer', body: line, mentions: [] });
          if (e) { log('relay failed', a.issue, e.message); continue; }
        }
      } else {
        const { data: m } = await db().from('dm_message').select('author_id').eq('id', a.message_id).maybeSingle();
        if (m?.author_id) receipts.push({
          app_user_id: m.author_id, kind: 'chat', title: `Fixed · #${a.issue}`, body: line.replace(/^✅ Fixed \(#\d+\):?\s*/, ''),
          data: { url: `https://github.com/${REPO}/issues/${a.issue}` }, dedupe_key: `computer-fixed:dm${a.message_id}`,
        });
      }
      await mark(a);
      log('relayed', `#${a.issue}`, 'to', a.source, a.message_id);
    } catch (e) {
      log('relay error', `#${a.issue}`, e.message);   // tried again next pass
    }
  }
  return receipts;
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
      const context = contextSection(await chatBefore(a), a.author_id);
      const n = await openIssue(
        issueTitle(text),
        issueBody({ body: text, caption: image ? null : a.caption, image, where, at: a.created_at, context }),
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
