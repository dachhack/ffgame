// EDITING WHAT WAS SAID (0351).
//
// Founder: "Let's have long press on a comment to edit it if you are the author
// or the league commish. The comment adds an edited note with the name of who
// edited it."
//
// Both halves of that sentence are rules, and both live here rather than in the
// two chat screens — the web decides with a ✎ beside the ✕ it already has and
// the app decides inside its long-press menu, and a message one host offers to
// edit and the other refuses is a bug nobody reports, they just stop trusting
// the button.
//
// WHAT AN EDIT MAY TOUCH. Somebody's own words, and nothing else:
//
//   • THE HOUSE DOES NOT GET EDITED. A weekly report, a waiver run, an add or
//     a drop (kinds 'report' and 'txn', author_id null) is a RECORD of what
//     happened. Rewording it would make the league's own log say a thing that
//     did not occur, and the commissioner is exactly the person with both the
//     motive and the buttons.
//   • A POLL IS NOT EDITABLE EITHER. Once somebody has voted, changing the
//     question changes what they voted for, silently and after the fact.
//     Deleting the poll and posting a new one is the honest version, and it
//     already works.
//   • A PICTURE KEEPS ITS PICTURE. Editing an image message edits the CAPTION
//     (0350), never the URL: swapping the URL would orphan the uploaded file in
//     the bucket and turn "fix a typo" into "replace the evidence". The server
//     enforces this too — see 0351 — so this is the honest half of the UI, not
//     the only guard.
//
// AND EVERY EDIT SIGNS ITSELF. edited_by is a name, not a flag, because the
// case that matters is not "this was changed" but "somebody else changed it".

/** A message, as much of one as these rules need. */
export interface EditableMessage {
  kind?: string | null;
  mine?: boolean;
  author_id?: string | null;
  body: string;
  caption?: string | null;
  edited_at?: string | null;
  edited_by?: string | null;
}

/** A body that is one bare URL — which is how chat has said "this is a picture
 *  or a GIF" since 0148, and what the clients render inline. */
export function isBareUrlBody(body?: string | null): boolean {
  return /^https?:\/\/\S+$/.test((body ?? '').trim());
}

/** May this person edit this message? */
export function canEditMessage(m: EditableMessage | null | undefined, canModerate = false): boolean {
  if (!m) return false;
  if ((m.kind ?? 'text') !== 'text') return false;   // polls, reports, the wire
  if (m.author_id == null) return false;             // the house has no author to be
  return !!m.mine || canModerate;
}

/** Which half of the message an edit rewrites: a picture's words, or the words
 *  themselves. */
export function editTarget(m: EditableMessage): 'caption' | 'body' {
  return isBareUrlBody(m.body) ? 'caption' : 'body';
}

/** What the editor starts with — never `null`, so the field is controlled. */
export function editSeed(m: EditableMessage): string {
  return (editTarget(m) === 'caption' ? m.caption : m.body) ?? '';
}

/** The note under an edited message, or null when it has not been. Names the
 *  editor because "edited" alone leaves the interesting case unsaid. */
export function editNote(m: EditableMessage | null | undefined): string | null {
  if (!m?.edited_at) return null;
  return `edited by ${m.edited_by || 'someone'}`;
}
