// THE CREST FALLBACK (v0.324.0), checked in Node.
//
// Founder: "The league avatars are blank for native leagues."
//
// In check:parity because the failure is invisible to the code that causes it:
// `avatar_url ? <img> : <empty box>` is correct-looking, and it is only wrong
// for leagues that have no upstream to mirror an avatar FROM — which is every
// native league, forever, and none of the Sleeper ones anybody tests with.
import { crestFor, crestInitial } from '../packages/core/src/data/crest';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

// ── THE LADDER ─────────────────────────────────────────────────────────────
{
  const both = crestFor({ teamAvatar: 'https://t.png', leagueAvatar: 'https://l.png', teamName: 'Team 1', leagueName: 'Kickoff League' });
  ok('the team’s own avatar wins when it has one', both.url === 'https://t.png' && both.from === 'team', both);

  // THE NATIVE-LEAGUE CASE, which is the whole bug: no team avatar, because
  // nothing in the app ever writes that column for a native seat.
  const native = crestFor({ teamAvatar: null, leagueAvatar: 'https://l.png', teamName: 'Team 1', leagueName: 'Kickoff League' });
  ok('a native seat borrows the LEAGUE crest instead of drawing a hole',
    native.url === 'https://l.png' && native.from === 'league', native);

  const bare = crestFor({ teamAvatar: null, leagueAvatar: null, teamName: 'Team 1', leagueName: 'Kickoff League' });
  ok('with no image anywhere it still answers, with a letter',
    bare.url === null && bare.initial === 'T' && bare.from === 'initial', bare);
  ok('the initial comes from the TEAM first — the card is about the team',
    crestFor({ teamName: 'Warriors', leagueName: 'Kickoff League' }).initial === 'W');
  ok('…and falls to the league when the team has no name',
    crestFor({ teamName: null, leagueName: 'Kickoff League' }).initial === 'K');
}

// ── EMPTY IS NOT A URL ─────────────────────────────────────────────────────
// The column is nullable AND text, so '' and '   ' both turn up in practice —
// and both would render as a broken image if treated as present.
{
  ok('an empty-string avatar is not an avatar',
    crestFor({ teamAvatar: '', leagueAvatar: 'https://l.png' }).from === 'league');
  ok('a whitespace avatar is not an avatar',
    crestFor({ teamAvatar: '   ', leagueAvatar: 'https://l.png' }).from === 'league');
  ok('…and neither is a whitespace LEAGUE avatar',
    crestFor({ teamAvatar: null, leagueAvatar: '  ', teamName: 'Zed' }).from === 'initial');
  ok('a padded url is trimmed rather than requested with the spaces',
    crestFor({ teamAvatar: '  https://t.png ' }).url === 'https://t.png');
  ok('undefined everywhere never throws and never renders empty',
    crestFor({}).initial === '?' && crestFor({}).url === null);
}

// ── THE LETTER IS A LETTER ─────────────────────────────────────────────────
// charAt(0) would hand back a glyph that says nothing about which team it is,
// and team names in this app are user-typed.
{
  ok('an emoji prefix does not become the crest', crestInitial('⚡ Bolts') === 'B');
  ok('a leading quote does not either', crestInitial("'96 Packers") === '9');
  ok('leading whitespace is skipped', crestInitial('   Team 1') === 'T');
  ok('a digit is a fine initial', crestInitial('12th Man') === '1');
  ok('case is normalised', crestInitial('team one') === 'T');
  ok('a name of pure punctuation falls through to the next name',
    crestInitial('——', 'Kickoff League') === 'K');
  ok('and with nothing usable anywhere, a neutral mark rather than a blank',
    crestInitial('——', '  ', null, undefined) === '?');
  ok('non-latin names keep their own first letter', crestInitial('Киев') === 'К');
  ok('no arguments at all still answers', crestInitial() === '?');
}

if (fails) { console.log(`\n${fails} CREST ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL CREST ASSERTIONS PASSED');
