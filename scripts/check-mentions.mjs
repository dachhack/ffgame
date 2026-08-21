// @MENTIONS (v0.327.0), checked in Node.
//
// Founder: "does @all work?" It didn't — `@all` matched no member name, so the
// message went out mentioning nobody while looking exactly like one that had.
// In check:parity because that failure is SILENT on both ends: the sender sees
// their message posted, and the people it was for see nothing at all.
import { mentionsEveryone, mentionIds } from '../packages/core/src/data/mentions';
import { CHAT_REACTIONS, CHAT_REACTION_EMOJI, orderedReactions, reactionLabel } from '../packages/core/src/data/chatReactions';
import { readFileSync } from 'node:fs';
import { isMetricSet, NO_METRIC_LABEL } from '../packages/core/src/data/metrics';

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

// ── QUICK REACTIONS (0210) ─────────────────────────────────────────────────
// The list is duplicated in SQL because SQL cannot import TypeScript. This is
// the check that makes the duplication safe: a reaction the client offers and
// the server rejects is a button that does nothing, and nothing surfaces that
// until somebody taps it.
{
  const sql = readFileSync(new URL('../supabase/migrations/0210_chat_reactions.sql', import.meta.url), 'utf8');
  const m = /_chat_reaction_ok[\s\S]*?array\[([^\]]*)\]/.exec(sql);
  ok('the SQL whitelist is findable at all', !!m);
  const sqlSet = (m ? m[1] : '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  ok('SQL and TypeScript offer the SAME reactions',
    sqlSet.join(' ') === [...CHAT_REACTION_EMOJI].join(' '), { sql: sqlSet, ts: [...CHAT_REACTION_EMOJI] });
  ok('…all six of them', sqlSet.length === 6, sqlSet.length);
  ok('every reaction has a spoken label, since the emoji is not one',
    CHAT_REACTIONS.every((r) => r.label && r.label !== r.emoji));
  ok('no duplicate emoji in the list', new Set(CHAT_REACTION_EMOJI).size === CHAT_REACTION_EMOJI.length);
  ok('reactionLabel answers for a known emoji', reactionLabel('🔥') === 'fire');
  ok('…and falls back to the emoji itself for an unknown one', reactionLabel('🦆') === '🦆');
}

// ── THE STRIP MUST NOT RESHUFFLE UNDER A THUMB ─────────────────────────────
// The server orders by count, which is right for a summary and wrong for a row
// of controls: a chip that moves between looking and tapping is a chip you tap
// wrong.
{
  const server = [{ emoji: '💯', n: 5, mine: false }, { emoji: '👍', n: 1, mine: true }];
  const fixed = orderedReactions(server).map((r) => r.emoji);
  ok('reactions render in the LIST order, not by count', fixed.join(' ') === '👍 💯', fixed);
  ok('…carrying their counts and mine flags through',
    orderedReactions(server)[0].n === 1 && orderedReactions(server)[0].mine === true);
  ok('only reactions somebody used are returned', orderedReactions([{ emoji: '🔥', n: 2, mine: false }]).length === 1);
  // An emoji from a future (or past) list version still belongs to whoever left
  // it — dropping it would silently delete a count that exists.
  const withOld = orderedReactions([{ emoji: '🦆', n: 3, mine: false }, { emoji: '👍', n: 1, mine: false }]);
  ok('an unknown emoji is kept rather than dropped', withOld.length === 2, withOld);
  ok('…and sorts after the known ones', withOld.map((r) => r.emoji).join(' ') === '👍 🦆');
  ok('empty and null are empty, not a crash',
    orderedReactions([]).length === 0 && orderedReactions(null).length === 0 && orderedReactions(undefined).length === 0);
  ok('a malformed row is skipped', orderedReactions([null, { n: 1 }, { emoji: '👍', n: 1, mine: false }]).length === 1);
}

// ── A MISSING METRIC (v0.331.0) ────────────────────────────────────────────
// Founder: "how did Montgomery get no metric?" A pick whose metric is missing
// scores EXACTLY ZERO — scorePlay is a chain of `if (metricId === '…')` ending
// in `return 0` — and the card rendered it as an ordinary 0.0.
{
  ok('a real metric is set', isMetricSet('rush') && isMetricSet('recyd'));
  ok('null and undefined are not', !isMetricSet(null) && !isMetricSet(undefined));
  // THE ONE THAT MATTERS. The cards read `metric?.name ?? p.metric_id ?? null`,
  // and `??` falls through on null/undefined ONLY — so '' sails past it, then
  // fails the `!!metricName` render test. The chip vanishes with no null
  // anywhere in sight, which is the hardest version of this to find. The engine
  // itself uses `metricId: ''` for the unopposed seat, so it is in circulation.
  ok('an EMPTY STRING is not set — the case `??` misses', !isMetricSet(''));
  ok('…nor is whitespace', !isMetricSet('   ') && !isMetricSet('\t'));
  ok('a non-string is not set', !isMetricSet(42) && !isMetricSet({}));
  ok('the placeholder says it scores zero, not just that it is absent',
    /0/.test(NO_METRIC_LABEL) && NO_METRIC_LABEL.trim() !== '');
  // A blank label would put us straight back to an invisible dead seat.
  ok('the placeholder is itself renderable', isMetricSet(NO_METRIC_LABEL));
}

if (fails) { console.log(`\n${fails} MENTION ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL MENTION ASSERTIONS PASSED');
