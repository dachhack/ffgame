// @computer (v0.537.0): which chat lines become issues, and what they say.
import { isComputerAsk, issueTitle, issueBody, SNARK, snarkFor } from '../src/computer.js';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

ok('a leading tag asks', isComputerAsk('@computer why did I lose?'));
ok('a tag mid-line asks', isComputerAsk('hey @Computer, check the LB scores'));
ok('a longer handle does not', !isComputerAsk('@computers are great'));
ok('no tag, no ask', !isComputerAsk('computer, why?'));
ok('nothing, no ask', !isComputerAsk(null));
ok('the title drops the tag', issueTitle('@computer why 8-2?') === '@computer: why 8-2?', issueTitle('@computer why 8-2?'));
ok('…and stays one short line', issueTitle('@computer ' + 'x'.repeat(200)).length <= 90);
ok('an image-only ask still gets a title', issueTitle('') === '@computer: (image)');
const b = issueBody({ body: 'why is this broken @computer', where: 'Kickoff League (abc)', at: 't' });
ok('the body keeps the trigger phrase', b.includes('@computer'));
ok('…names where it was asked', b.includes('Kickoff League (abc)'));
const img = issueBody({ body: 'look', image: 'https://x/y.png', where: 'L', at: 't' });
ok('an untagged line gets the phrase so the Action fires', img.split('\n')[2].startsWith('@computer '));
ok('…and the picture is embedded', img.includes('![attached](https://x/y.png)'));

ok('twenty lines in the bank', SNARK.length === 20, SNARK.length);
ok('no two alike', new Set(SNARK).size === SNARK.length);
ok('the same line always gets the same reply', snarkFor(12345) === snarkFor(12345));
ok('neighbouring lines get different ones', snarkFor(1) !== snarkFor(2));
ok('every reply fits a chat line', SNARK.every((l) => l.length + 8 <= 500));

if (fails) { console.log(`\n${fails} @COMPUTER ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL @COMPUTER ASSERTIONS PASSED');
