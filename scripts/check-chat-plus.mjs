// Guard for THE PLUS BUTTON (v0.487.0). Offline — check:parity.
//
// Founder: "Let's do a + button that lets you then select poll, image, gif."
//
// League chat's 📊 / GIF / 📷 row lives behind one + in BOTH apps. These hold
// the shape: every choice is still reachable, poll is still gated the way the
// server gates it, and the old standalone buttons do not creep back beside it.
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

for (const [name, path] of [['app', 'apps/mobile/src/ui/Chat.tsx'], ['web', 'src/app/chat.tsx']]) {
  const src = read(path);
  const lc = src.slice(src.indexOf('function LeagueChat('), src.indexOf('function ', src.indexOf('function LeagueChat(') + 20));
  ok(src.includes('function PlusMenu(') && /canPoll && item\('poll'/.test(src)
    && /item\('image'/.test(src) && /canGif && item\('gif'/.test(src),
    `${name}: the + menu offers poll, image and GIF`);
  ok(lc.includes('<PlusMenu canPoll={canModerate}'), `${name}: …with polls still the commissioner's, as the server rules`);
  ok(/if \(what === 'poll'\) setPollOpen\(true\)/.test(lc) && /else if \(what === 'gif'\) setGifOpen\(true\)/.test(lc),
    `${name}: each choice opens what its old button opened`);
  ok(!lc.includes('setPollOpen((v) => !v)') && !lc.includes('<ImageButton'),
    `${name}: the standalone 📊 / GIF / 📷 buttons are gone from the league composer`);
}

console.log(fails ? `\n${fails} CHAT-PLUS ASSERTION(S) FAILED` : '\nALL CHAT-PLUS ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
