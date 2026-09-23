// EDITING WHAT WAS SAID (0351), checked in Node.
//
// Founder: "long press on a comment to edit it if you are the author or the
// league commish. The comment adds an edited note with the name of who edited
// it."
//
// Three things here are worth a red check rather than a careful reading:
//
//   • WHO MAY EDIT WHAT. The web decides with a ✎ and the app decides inside
//     its long-press menu, off one function. A message one host offers to edit
//     and the other refuses is not a crash — it is a button somebody presses
//     once and never trusts again.
//   • WHAT AN EDIT MUST NOT REACH. The house's own records, a poll people have
//     already voted in, and the URL of a posted picture. Each is refused in
//     core AND in SQL; this holds the two together, because the client rule is
//     the one that decides whether the button appears and the SQL rule is the
//     one that actually stops it.
//   • THAT EVERY EDIT IS SIGNED. The note is the entire safeguard: an edit that
//     leaves no mark is a commissioner rewriting somebody quietly.
import { readFileSync } from 'node:fs';
import {
  canEditMessage, editNote, editSeed, editTarget, isBareUrlBody,
} from '../packages/core/src/data/chatEdit';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const sql = readFileSync(new URL('../supabase/migrations/0351_the_comment_can_be_corrected.sql', import.meta.url), 'utf8');

const text = (over = {}) => ({ kind: 'text', author_id: 'u1', mine: true, body: 'good luck', ...over });
const PIC = 'https://auth.dripfantasy.com/storage/v1/object/public/chat-image/l/u/deadbeefdeadbeef.jpg';

// ── WHO MAY EDIT ───────────────────────────────────────────────────────────
{
  ok('the author may edit their own message', canEditMessage(text(), false));
  ok('the commissioner may edit somebody else\'s', canEditMessage(text({ mine: false }), true));
  ok('anybody else may not', !canEditMessage(text({ mine: false }), false));
  // A poll's question is what people voted on. Changing it after the fact
  // changes their votes, and not even the commissioner gets to do that here.
  ok('a poll is not editable, even by the commissioner', !canEditMessage(text({ kind: 'poll' }), true));
  // The house's lines are the league's record of what happened.
  ok('a weekly report is not editable', !canEditMessage(text({ kind: 'report', author_id: null, mine: false }), true));
  ok('a wire line is not editable', !canEditMessage(text({ kind: 'txn', author_id: null, mine: false }), true));
  ok('nor is a text message with no author — that is the house too',
    !canEditMessage(text({ author_id: null, mine: false }), true));
  ok('a missing message is not editable', !canEditMessage(null, true) && !canEditMessage(undefined, true));
  // An absent kind is the default, not a reason to refuse: rows predate 0148.
  ok('a message with no kind is treated as text', canEditMessage({ author_id: 'u1', mine: true, body: 'hi' }, false));
}

// ── WHAT AN EDIT REWRITES ──────────────────────────────────────────────────
{
  ok('a text message edits its body', editTarget(text()) === 'body');
  ok('…starting from what it said', editSeed(text()) === 'good luck');
  // THE ONE THAT PROTECTS THE BUCKET. Swapping the URL would leave the
  // uploaded file with nothing pointing at it — and turn "fix a typo" into
  // "replace the picture".
  ok('a picture edits its caption, never its URL', editTarget(text({ body: PIC, caption: 'my lineup' })) === 'caption');
  ok('…starting from the caption', editSeed(text({ body: PIC, caption: 'my lineup' })) === 'my lineup');
  ok('…and from empty when it never had one', editSeed(text({ body: PIC })) === '');
  ok('a GIF is a picture for this purpose too',
    editTarget(text({ body: 'https://media1.tenor.com/x/abc.gif' })) === 'caption');
  ok('a URL with words after it is an ordinary message', editTarget(text({ body: `${PIC} nice` })) === 'body');
}

// ── BARE-URL BODIES, THE SAME RULE IN BOTH LANGUAGES ───────────────────────
// The SQL keeps its own copy because SQL cannot import TypeScript. If they
// disagree, the client offers to edit a caption while the server rewrites a
// body, or the other way about.
{
  const m = /~ '(\^https\?:[^']+)'/.exec(sql);
  ok('the SQL states its bare-URL rule', !!m, m && m[1]);
  // POSIX [:space:] inside a negated class is the one dialect difference.
  const sqlRe = m ? new RegExp(m[1].replace(/\[:space:\]/g, '\\s')) : null;
  const cases = [PIC, 'https://media1.tenor.com/x/abc.gif', 'http://x.co/a.png',
    `${PIC} nice`, 'good luck this week', '', '   ', 'https://x.co/a.png and more'];
  for (const c of cases) {
    const ts = isBareUrlBody(c);
    ok(`SQL and TypeScript agree on ${JSON.stringify(c.length > 40 ? `${c.slice(0, 37)}…` : c)}`,
      sqlRe ? sqlRe.test(c.trim()) === ts : false, { ts, sql: sqlRe ? sqlRe.test(c.trim()) : null });
  }
  ok('surrounding whitespace does not change the answer', isBareUrlBody(`  ${PIC}  `));
  ok('null and undefined are not bare URLs', !isBareUrlBody(null) && !isBareUrlBody(undefined));
}

// ── THE NOTE, WHICH IS THE WHOLE SAFEGUARD ─────────────────────────────────
{
  ok('an unedited message carries no note', editNote(text()) === null);
  ok('an edited one names who did it',
    editNote(text({ edited_at: '2026-09-23T01:00:00Z', edited_by: 'Taco Time Titans' })) === 'edited by Taco Time Titans');
  // Never a bare "edited": the interesting case is somebody ELSE having done
  // it, so an unnameable editor still gets said out loud.
  ok('…and says someone rather than nothing when the name is missing',
    editNote(text({ edited_at: '2026-09-23T01:00:00Z' })) === 'edited by someone'
    && editNote(text({ edited_at: '2026-09-23T01:00:00Z', edited_by: '' })) === 'edited by someone');
  ok('a name with no timestamp is not an edit', editNote(text({ edited_by: 'Someone' })) === null);
}

// ── AND THE SERVER REFUSES THE SAME THINGS ─────────────────────────────────
// The client rule decides whether the button appears; these decide what
// happens when somebody calls the RPC without one.
{
  ok('the migration records both halves of an edit',
    /add column if not exists edited_at timestamptz/.test(sql)
    && /add column if not exists edited_by uuid references app_user/.test(sql));
  ok('chat_edit refuses the house and every kind but text',
    /m\.author_id is null or m\.kind <> 'text'/.test(sql));
  ok('…and anybody who is neither the author nor the commissioner',
    /m\.author_id = me or is_league_commish\(p_league_id\) or is_admin\(\)/.test(sql));
  ok('a picture keeps the body it already had', /if _chat_is_media_body\(m\.body\) then\s+b := m\.body;/.test(sql));
  ok('mentions are recomputed against real league members',
    /select coalesce\(array_agg\(distinct u\), '\{\}'\) into men/.test(sql)
    && /from league_membership lm where lm\.league_id = p_league_id/.test(sql));
  ok('the edit signs itself in the same statement as the text',
    /set body = b, caption = cap, mentions = men, edited_at = now\(\), edited_by = me/.test(sql));
  ok('an edit that changes nothing does not stamp one',
    /if b = m\.body and cap is not distinct from m\.caption then/.test(sql));
  ok('the payload hands back a NAME, not a uuid the clients would have to join',
    /'edited_by', case when m\.edited_by is null then null else _chat_display_name/.test(sql));
}

if (fails) { console.log(`\n${fails} CHAT EDIT ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL CHAT EDIT ASSERTIONS PASSED');
