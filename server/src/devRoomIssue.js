// THE DEV ROOM'S ISSUE (v0.658.0) — what a tagged dev-room line looks like on
// GitHub. Pure, so check:devroom can hold it without a database.
//
// The repo is PUBLIC and the people writing these are testers, not the
// founder, so three things are deliberate:
//   • NO NAMES. The issue says "a tester", never who. (Member names stay in
//     the app, where only the room can read them.)
//   • NO LIVE MENTIONS. Every "@word" is broken with a zero-width joiner, so a
//     tester's "@someone" pings nobody on GitHub, and "@computer" or "@claude"
//     in their text can never start an automated session. The founder's own
//     @computer route (computer.js) is the only thing that may do that.
//   • NOTHING BUT THE TEXT. No pictures, no context lines from the room.

export const DEV_LABEL = 'dev-room';
const TAG_WORD = { idea: 'Idea', bug: 'Bug' };
const TAG_EMOJI = { idea: '💡', bug: '🐞' };

/** "@name" → "@‍name": still reads as written, links nothing. */
export function defuseMentions(s) {
  return String(s ?? '').replace(/@(?=[A-Za-z0-9_-])/g, '@‍');
}

/** "💡 Idea: <first line, 80 chars>". */
export function devIssueTitle(body, tag) {
  const one = defuseMentions(body).replace(/\s+/g, ' ').trim();
  const t = one.length > 80 ? `${one.slice(0, 77).trimEnd()}…` : one;
  return `${TAG_EMOJI[tag] ?? '💬'} ${TAG_WORD[tag] ?? 'Note'}: ${t || '(empty)'}`;
}

/** The issue body: where it came from, then the tester's words, quoted. */
export function devIssueBody({ body, tag, room, at, messageId }) {
  const quoted = defuseMentions(body).split('\n').map((l) => `> ${l}`).join('\n');
  return [
    `From the dev room${room ? ` (${defuseMentions(room)})` : ''} · ${TAG_WORD[tag] ?? 'Note'} from a tester · ${at ?? ''}`.trim(),
    '',
    quoted,
    '',
    `<!-- dev-room message ${messageId} -->`,
  ].join('\n');
}

/** GitHub labels for a tagged line. */
export const devIssueLabels = (tag) => [DEV_LABEL, ...(TAG_WORD[tag] ? [tag] : [])];
