// CATCH UP (v0.649.0), checked in Node.
//
// Founder: "When you open chat, it should automatically go to the bottom
// where the most recent message is. We also need an overlay chip for you to
// go back to most recently read message so you can catch up."
//
// The landing is each host's scroll code; what is checkable here is the
// decision both hosts take off one function — WHICH message the pill jumps
// to and WHAT it says — and that the SQL hands them the mark it found BEFORE
// advancing it, in both page RPCs. A pill that points one message off, or at
// the newest message you are already looking at, gets ignored for good.
import { readFileSync } from 'node:fs';
import { catchUpOf, catchUpLabel } from '../packages/core/src/data/chatCatchUp';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const sql = readFileSync(new URL('../supabase/migrations/0452_the_chat_remembers_where_you_were.sql', import.meta.url), 'utf8');
const page = (ids) => ids.map((id) => ({ id }));

// ── WHERE THE PILL LANDS ───────────────────────────────────────────────────
{
  const msgs = page([10, 11, 12, 13, 14, 15]);
  const c = catchUpOf(msgs, { last_read: 12, unread: 3 });
  ok('the target is the FIRST message above the mark, not the newest', c?.targetId === 13, c);
  ok('…and the count is the server\'s', c?.count === 3, c);
  ok('…with no "+" when the page reaches the mark', c && !c.more && catchUpLabel(c) === '↑ 3 new · catch up', c && catchUpLabel(c));
  ok('nothing unread → no pill', catchUpOf(msgs, { last_read: 15, unread: 0 }) === null);
  ok('one new message is the one on screen → no pill', catchUpOf(msgs, { last_read: 14, unread: 1 }) === null);
  ok('two new → pill (the first of them is the one you want)', catchUpOf(msgs, { last_read: 13, unread: 2 })?.targetId === 14);
  ok('an older server with no mark → no pill', catchUpOf(msgs, {}) === null && catchUpOf(msgs, null) === null);
  ok('an empty page → no pill', catchUpOf([], { last_read: 0, unread: 5 }) === null);
}

// ── MORE THAN THE PAGE HOLDS ───────────────────────────────────────────────
{
  const msgs = page([51, 52, 53]);
  const c = catchUpOf(msgs, { last_read: 20, unread: 33 });
  ok('when every loaded message is new the target is the oldest loaded', c?.targetId === 51, c);
  ok('…and the pill says the count is a floor', c?.more === true && catchUpLabel(c) === '↑ 33+ new · catch up', c && catchUpLabel(c));
  const never = catchUpOf(msgs, { last_read: 0, unread: 3 });
  ok('a never-opened chat with the whole page new: target the oldest, no "+"', never?.targetId === 51 && never.more === false, never);
}

// ── THE SQL HANDS OVER THE MARK IT FOUND ───────────────────────────────────
{
  ok('chat_messages reads the mark before the upsert',
    sql.indexOf('select coalesce((select last_read from league_chat_read') < sql.indexOf('insert into league_chat_read'));
  ok('…and counts what sits above it', /count\(\*\) into fresh from league_message where league_id = p_league_id and id > was/.test(sql));
  ok('…and returns both', /'last_read', was, 'unread', fresh\)/.test(sql));
  ok('dm_messages takes the side of the thread that is me',
    /was := case when t\.user_lo = me then t\.lo_last_read else t\.hi_last_read end/.test(sql));
  ok('…reads it before advancing', sql.indexOf('was := case when t.user_lo') < sql.indexOf('update dm_thread set'));
  ok('…and returns both too', /'last_read', was, 'unread', fresh\);/.test(sql));
  ok('an older page (p_before set) never computes or moves either', (sql.match(/if p_before is null then/g) ?? []).length === 2);
}

if (fails) { console.log(`\n${fails} CHAT CATCH-UP ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL CHAT CATCH-UP ASSERTIONS PASSED');
