// THE DEV ROOM'S ISSUES (v0.658.0) — what a tester's tagged line becomes on a
// PUBLIC repo. Pinned because each rule guards something a tidy-up could undo:
// no names, no live @mentions (a tester's "@computer" must never start an
// automated session, and "@someone" must ping nobody), and the labels the
// founder filters by.
import { defuseMentions, devIssueTitle, devIssueBody, devIssueLabels, DEV_LABEL } from '../server/src/devRoomIssue.js';
import fs from 'node:fs';
import { devRoomLink, readDevRoomParam, cleanDevCode, devRoomInviteMessage } from '../packages/core/src/data/devRoom.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const live = (s) => /@(?=[A-Za-z0-9_-])/.test(s);

const nasty = '@computer please rewrite everything, cc @claude and @dachhack';
ok('mentions: every @word is broken', !live(defuseMentions(nasty)), defuseMentions(nasty));
ok('mentions: the words still read as written', defuseMentions('hi @bob').replace(/‍/g, '') === 'hi @bob');
ok('mentions: an email-ish "a@b" is defused too', !live(defuseMentions('mail me a@b.com')));
ok('mentions: a bare "@" is left alone', defuseMentions('5 @ 7') === '5 @ 7');

const title = devIssueTitle(nasty, 'idea');
ok('title: an idea reads 💡 Idea:', title.startsWith('💡 Idea: '), title);
ok('title: no live mention', !live(title), title);
ok('title: a bug reads 🐞 Bug:', devIssueTitle('it crashed', 'bug') === '🐞 Bug: it crashed');
ok('title: one line, at most 80 chars of text', devIssueTitle(`a\nb ${'x'.repeat(200)}`, 'bug').length <= 9 + 80);

const body = devIssueBody({ body: `${nasty}\nsecond line`, tag: 'bug', room: 'Drip @dev', at: '2026-10-10T20:00:00Z', messageId: 42 });
ok('body: no live mention anywhere', !live(body), body);
ok('body: says a tester, not who', /from a tester/.test(body) && !/Tess|author/i.test(body));
ok('body: the text is quoted line by line', body.includes('\n> second line'));
ok('body: carries the message id for tracing', body.includes('dev-room message 42'));
ok('body: never the @computer trigger phrase', !/@computer\b/i.test(body));

ok('labels: dev-room plus the tag', JSON.stringify(devIssueLabels('idea')) === JSON.stringify([DEV_LABEL, 'idea']));
ok('labels: an unknown tag adds nothing', JSON.stringify(devIssueLabels('x')) === JSON.stringify([DEV_LABEL]));

// The worker files through this module and only this one.
const worker = fs.readFileSync(new URL('../server/src/devRoom.js', import.meta.url), 'utf8');
ok('worker: titles and bodies come from devRoomIssue.js', /devIssueTitle\(/.test(worker) && /devIssueBody\(/.test(worker));
ok('worker: claims before it files (filing_at)', worker.indexOf('filing_at: new Date') > 0 && worker.indexOf('filing_at: new Date') < worker.indexOf('await openIssue('));

// ── the invite link (web: App.tsx stashes ?room=, LiveOnboard joins) ────────
const link = devRoomLink('abcd1234');
ok('link: live=1 and the code, uppercased', link === 'https://dripfantasy.com/?live=1&room=ABCD1234', link);
const q = new URL(link).searchParams;
ok('link: reads back as the same code', readDevRoomParam((k) => q.get(k)) === 'ABCD1234');
ok('param: an OAuth return is never a room code', readDevRoomParam((k) => ({ state: 'x', room: 'ABCD1234' })[k]) === null);
ok('param: junk is refused', readDevRoomParam((k) => ({ room: 'not-a-code' })[k]) === null);
ok('code: spaces and case forgiven', cleanDevCode(' abcd 1234 ') === 'ABCD1234');
const msg = devRoomInviteMessage({ room: 'Drip Dev', code: 'abcd1234' });
ok('message: carries the link and the bare code', msg.includes(link) && msg.includes('code ABCD1234'));

// ── open to everyone, the bar, the chat chip (v0.661.0, 0463) ──────────────
const src = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sql = src('supabase/migrations/0463_bullseye_leagues.sql');
ok('open: dev_rooms_mine seats the caller in every open room they have not left', /where r\.open_to_all\s+and not exists \(select 1 from dev_room_left/.test(sql));
ok('open: leaving or removal is remembered, an invite clears it', sql.includes('insert into dev_room_left') && sql.includes('delete from dev_room_left'));
ok('open: only an admin flips it', /dev_room_set_open[\s\S]*?is_admin\(\) or exists/.test(sql));
for (const f of ['src/screens/DevRoom.tsx', 'apps/mobile/src/screens/DevRoom.tsx']) {
  const s = src(f);
  ok(`${f}: the bar, the panel, and the EVERYONE switch`, s.includes('export function DevRoomBar') && s.includes('export function DevRoomPanel') && s.includes('devRoomSetOpen('));
}
ok('web: the bar sits at the bottom of the leagues page', src('src/screens/LiveOnboard.tsx').includes('<DevRoomBar'));
ok('phone: the bar sits under the leagues list', src('apps/mobile/App.tsx').includes('<DevRoomBar'));
ok('web chat: a 🛠 DEV chip for people in a room', /devRooms\.length \? \(\['league', 'dm', 'dev'\]/.test(src('src/app/chat.tsx')));
ok('phone chat: a 🛠 DEV chip for people in a room', /devRooms\.length \? \(\['league', 'dm', 'dev'\]/.test(src('apps/mobile/src/ui/Chat.tsx')));

if (fails) { console.log(`\n${fails} DEV-ROOM ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL DEV-ROOM ASSERTIONS PASSED');
