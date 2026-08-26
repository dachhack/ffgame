// THE INVITE LINK, checked in Node (v0.323.2).
//
// In check:parity because this failure is silent, total, and invisible from
// inside the app: a link that lands on the wrong route looks like a working
// link to whoever SENT it, and the recipient — a stranger being recruited — has
// no idea what they were supposed to see. Founder: "I want to get people into a
// classic league. It looks like following this link just goes to the demo
// board." Every invite built since v0.291.0 was doing that.
//
// The cause was a comment. invite.ts asserted "?code=XXXX has been a complete
// path for a long time — App.tsx reads it off the landing URL"; App.tsx reads
// it only inside `if (p.get('live') === '1')`. Nobody asked App.tsx.
import { inviteLink, inviteMessage, previewLink, readInviteParams, INVITE_CODE_RE, SITE_ORIGIN } from '../packages/core/src/data/invite';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
/** A query string, read the way App.tsx reads one. */
const q = (search) => { const p = new URLSearchParams(search); return (k) => p.get(k); };

// ── THE BUG, PINNED ────────────────────────────────────────────────────────
{
  const link = inviteLink('3C4514BF');           // the code from the founder's screenshot
  ok('the link carries live=1 — the flag App.tsx branches on',
    new URL(link).searchParams.get('live') === '1', link);
  ok('…and the code', new URL(link).searchParams.get('code') === '3C4514BF', link);
  ok('…and points at the public site, not a native deep link',
    link.startsWith(`${SITE_ORIGIN}/?`), link);
  // THE EXACT URL THAT WAS BROKEN. It has to keep working, because it is
  // already sent and out of our hands.
  const old = readInviteParams(q('?code=3C4514BF'));
  ok('a BARE ?code= link is still recognised as an invite', old?.invite === '3C4514BF', old);
  ok('the new link parses too', readInviteParams(q('?live=1&code=3C4514BF'))?.invite === '3C4514BF');
  ok('a lowercase code is normalised', readInviteParams(q('?code=3c4514bf'))?.invite === '3C4514BF');
}

// ── THE COLLISION THAT MAKES THE SHAPE TEST LOAD-BEARING ───────────────────
// `?code=` is also how Supabase's PKCE flow returns an auth code. Treating one
// as an invite would stash a secret and skip the exchange.
{
  ok('a PKCE-shaped auth code is NOT an invite',
    readInviteParams(q('?code=8f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8')) === null);
  ok('a long opaque token is NOT an invite',
    readInviteParams(q('?code=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')) === null);
  ok('ANY code with a state param is left alone, whatever its shape',
    readInviteParams(q('?state=yahoo&code=3C4514BF')) === null);
  ok('…including a provider we have never heard of',
    readInviteParams(q('?state=abc123&code=DEADBEEF')) === null);
  ok('nine hex characters is not an invite code',
    readInviteParams(q('?code=3C4514BFA')) === null);
  ok('seven is not either', readInviteParams(q('?code=3C4514B')) === null);
  ok('non-hex of the right length is not either',
    readInviteParams(q('?code=ZZZZZZZZ')) === null);
  ok('the shape is exactly what gen_invite_code() makes',
    INVITE_CODE_RE.test('A1B2C3D4') && !INVITE_CODE_RE.test('a1b2c3d4e'));
}

// ── THE OTHER CODES ON THE SAME DOOR ───────────────────────────────────────
{
  ok('a solo pass is routed to the solo stash, not the invite one', (() => {
    const r = readInviteParams(q('?code=SOLO-ABCD1234'));
    return r?.solo === 'SOLO-ABCD1234' && r.invite === undefined;
  })(), readInviteParams(q('?code=SOLO-ABCD1234')));
  ok('a bare ?commish= is enough on its own',
    readInviteParams(q('?commish=A1B2C3D4'))?.commish === 'A1B2C3D4');
  ok('a bare ?dfs= is enough on its own',
    readInviteParams(q('?dfs=A1B2C3D4'))?.dfs === 'A1B2C3D4');
  ok('several at once all survive', (() => {
    const r = readInviteParams(q('?code=A1B2C3D4&commish=B2C3D4E5&dfs=C3D4E5F6'));
    return r?.invite === 'A1B2C3D4' && r.commish === 'B2C3D4E5' && r.dfs === 'C3D4E5F6';
  })());
}

// ── TRUSTED MODE: live=1 IS THE AUTHOR VOUCHING ────────────────────────────
// With the flag present the params are taken at face value, as they always
// were — a bad code then fails at the redeem form WITH A MESSAGE, which beats
// vanishing. The shape test exists for the INFERENCE path.
{
  ok('with live=1, an odd code is still stashed rather than dropped',
    readInviteParams(q('?live=1&code=LEGACY-123'), true)?.invite === 'LEGACY-123');
  ok('…and without it, the same code is ignored',
    readInviteParams(q('?code=LEGACY-123')) === null);
  ok('trusted mode still refuses an OAuth return',
    readInviteParams(q('?live=1&state=yahoo&code=abc'), true) === null);
}

// ── NOTHING TO SEE ─────────────────────────────────────────────────────────
{
  ok('an empty query asks for nothing', readInviteParams(q('')) === null);
  ok('an empty code asks for nothing', readInviteParams(q('?code=')) === null);
  ok('whitespace is not a code', readInviteParams(q('?code=%20%20')) === null);
  ok('a missing getter value never throws', readInviteParams(() => undefined) === null);
}

// ── THE MESSAGE CARRIES THE SAME LINK ──────────────────────────────────────
{
  const m = inviteMessage({ league: 'Turf Warriors', code: '3c4514bf', seatsOpen: 7 });
  ok('the message embeds the SAME link the button copies', m.includes(inviteLink('3C4514BF')), m);
  ok('…so the message link works too', m.includes('live=1'));
  ok('the code is repeated in plain text for clients that mangle query strings',
    m.includes('invite code 3C4514BF'), m);
  ok('the league is named', m.includes('"Turf Warriors"'));
  ok('seats are pluralised', m.includes('7 seats open')
    && inviteMessage({ code: 'A1B2C3D4', seatsOpen: 1 }).includes('1 seat open'));
  ok('no seats claims none', !inviteMessage({ code: 'A1B2C3D4', seatsOpen: 0 }).includes('seat'));
  ok('an unnamed league still reads', inviteMessage({ code: 'A1B2C3D4' }).includes('my league'));
}

// ── THE LOOK-FIRST LINK (v0.358.1) ──────────────────────────────────────────
// Founder: "add the classic link to the commish invite area. Classic league
// invites should get you there." Two things have to hold. The invite link goes
// to sign-in and must NEVER pick up a game hint — the join screen already
// pitches per-mode, and a hint there would be dead weight on a URL people
// paste by hand. The look-first link is the opposite: it carries no code, so
// the hint is the only thing distinguishing a classic recruit's landing from a
// drip one's.
{
  ok('a classic league sends recruits to the classic board',
    previewLink('classic') === `${SITE_ORIGIN}/?game=classic`, previewLink('classic'));
  // DRIP GETS THE BARE ORIGIN — the demo already opens on drip, so the
  // parameter would say nothing while making the link longer to mistype.
  ok('a drip league just sends them to the site', previewLink('drip') === SITE_ORIGIN);
  ok('an unset mode is drip, as everywhere else',
    previewLink() === SITE_ORIGIN && previewLink(null) === SITE_ORIGIN && previewLink('') === SITE_ORIGIN);
  ok('case and padding do not matter', previewLink('  CLASSIC ') === `${SITE_ORIGIN}/?game=classic`);
  ok('an unknown mode is not classic', previewLink('guillotine') === SITE_ORIGIN);

  // THE INVITE LINK STAYS CLEAN whatever the league plays.
  ok('a game hint never lands on the invite link itself',
    !inviteLink('A1B2C3D4').includes('game='), inviteLink('A1B2C3D4'));

  const cm = inviteMessage({ league: 'Slow Hands', code: 'A1B2C3D4', game: 'classic' });
  ok('a classic invite offers the look-first link', cm.includes(previewLink('classic')), cm);
  ok('…and still carries the real join link', cm.includes(inviteLink('A1B2C3D4')));
  const dm = inviteMessage({ league: 'Fast Hands', code: 'A1B2C3D4', game: 'drip' });
  ok('a drip invite does not offer a second link to the same place',
    !dm.includes('?game='), dm);
  ok('a league that never chose reads as drip',
    !inviteMessage({ code: 'A1B2C3D4' }).includes('?game='));
}

if (fails) { console.log(`\n${fails} INVITE-LINK ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL INVITE-LINK ASSERTIONS PASSED');
