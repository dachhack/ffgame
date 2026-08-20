// @MENTIONS (v0.327.0), checked in Node.
//
// Founder: "does @all work?" It didn't — `@all` matched no member name, so the
// message went out mentioning nobody while looking exactly like one that had.
// In check:parity because that failure is SILENT on both ends: the sender sees
// their message posted, and the people it was for see nothing at all.
import { mentionsEveryone, mentionIds } from '../packages/core/src/data/mentions';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const ME = { id: 'me', name: 'Me', me: true };
const LEAGUE = [ME, { id: 'a', name: 'Allen' }, { id: 'b', name: 'Bird Law' }, { id: 'c', name: 'Cy' }];

// ── @all REACHES THE LEAGUE ────────────────────────────────────────────────
{
  ok('@all is recognised', mentionsEveryone('heads up @all draft is friday'));
  ok('…and mentions every other member', mentionIds('@all draft friday', LEAGUE).sort().join() === 'a,b,c');
  ok('at the start of a message', mentionsEveryone('@all hi'));
  ok('at the very end, with no trailing space', mentionsEveryone('draft friday @all'));
  ok('capitalised, because people start sentences with it', mentionsEveryone('@All hands'));
  ok('followed by punctuation', mentionsEveryone('@all!') && mentionsEveryone('@all, please read'));
}

// ── THE CASE THAT MAKES THE BOUNDARY LOAD-BEARING ─────────────────────────
// A league with an Allen would broadcast to everybody every time somebody
// addressed him.
{
  ok('@allen is NOT everybody', !mentionsEveryone('nice pick @allen'));
  ok('…and reaches only Allen', mentionIds('nice pick @Allen', LEAGUE).join() === 'a');
  ok('@ally is not everybody either', !mentionsEveryone('@ally'));
  ok('@all-star is not everybody', !mentionsEveryone('@all-star week'));
  ok('@allocation is not everybody', !mentionsEveryone('@allocation'));
  ok('a bare "all" with no @ is just a word', !mentionsEveryone('all of you should read this'));
  ok('an email-ish string does not broadcast', !mentionsEveryone('mail me at x@allstate.com'));
}

// ── NEVER THE AUTHOR ───────────────────────────────────────────────────────
// The badge means "somebody wants you"; you know what you wrote.
{
  ok('@all does not mention the sender', !mentionIds('@all', LEAGUE).includes('me'));
  ok('…nor does mentioning yourself by name', !mentionIds('@Me testing', LEAGUE).includes('me'));
}

// ── PER-NAME MENTIONS STILL WORK ───────────────────────────────────────────
{
  ok('a single name reaches one person', mentionIds('@Cy you up?', LEAGUE).join() === 'c');
  ok('a name with a space is matched whole', mentionIds('@Bird Law thoughts?', LEAGUE).join() === 'b');
  ok('two names reach two people', mentionIds('@Allen @Cy trade?', LEAGUE).sort().join() === 'a,c');
  ok('no @ at all mentions nobody', mentionIds('just talking', LEAGUE).length === 0);
}

// ── DEGENERATE INPUT MUST NOT BROADCAST ────────────────────────────────────
// The dangerous direction is a false POSITIVE: pinging a whole league by
// accident is the one failure people remember.
{
  ok('an empty body mentions nobody', !mentionsEveryone('') && mentionIds('', LEAGUE).length === 0);
  ok('a null body never throws', !mentionsEveryone(null) && mentionIds(null ?? '', LEAGUE).length === 0);
  ok('an empty league is an empty mention list', mentionIds('@all', []).length === 0);
  ok('a league of only me is too', mentionIds('@all', [ME]).length === 0);
  ok('a member with no name is skipped rather than matching everything',
    mentionIds('@Cy hi', [...LEAGUE, { id: 'x', name: '' }]).join() === 'c');
}

if (fails) { console.log(`\n${fails} MENTION ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL MENTION ASSERTIONS PASSED');
