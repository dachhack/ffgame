// POSTING A PICTURE (0349) — the bytes half of an image message.
//
// Founder: "I want to allow users to post images in the chat."
//
// Chat has rendered images since 0148, but only ones hosted somewhere else — a
// GIF from the picker, an imgur link. This is the upload path for the ones that
// live on the poster's phone, and it deliberately produces the SAME kind of
// message: a body that is one image URL. Nothing downstream learns a new shape.
// An old app build renders these, the pin strip previews them, reactions and
// deletes work on them, because to every one of those they are what a GIF is.
//
// WHERE THEY GO: the `chat-image` bucket, at
//
//     <league_id>/<author_id>/<random>.<ext>
//
// which is not a naming convention but the permission itself — the storage
// policies in 0349 read the league and the author back out of it. So this
// module is the only place that builds the path, and it builds it from the
// session's own user id rather than anything a caller passes.
//
// WHAT IT DOES NOT DO: resize. Re-encoding needs a canvas (web) or an image
// library (native), neither of which belongs in platform-agnostic core — the
// host shrinks the picture and hands over the bytes it wants stored. Core owns
// the limits, the naming, the URL shape and the delete, so the two hosts cannot
// drift on any of them.
import { getSupabase } from './supabaseClient';
import { supabaseUrl } from './liveConfig';

export const CHAT_IMAGE_BUCKET = 'chat-image';
/** The bucket's own ceiling (0349). The host should land well under it. */
export const CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
/** The bucket's allowed_mime_types, mirrored so a host can reject earlier and
 *  with a sentence rather than a 400. */
export const CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type ChatImageType = (typeof CHAT_IMAGE_TYPES)[number];

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
};

/** True for a content type the bucket will accept. `image/jpg` and stray
 *  parameters (`image/jpeg; charset=…`) are what browsers and pickers actually
 *  hand over, so they normalise rather than fail. */
export function chatImageType(mime?: string | null): ChatImageType | null {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase();
  const fixed = m === 'image/jpg' ? 'image/jpeg' : m;
  return (CHAT_IMAGE_TYPES as readonly string[]).includes(fixed) ? (fixed as ChatImageType) : null;
}

/** Storage's public route to the bucket — the part after the host, which is
 *  the same whether the project is reached through its custom domain or its
 *  supabase.co URL. */
const PUBLIC_PATH = `/storage/v1/object/public/${CHAT_IMAGE_BUCKET}/`;

/** The public URL prefix an upload from THIS build gets. */
export const chatImageBase = (): string => `${supabaseUrl().replace(/\/+$/, '')}${PUBLIC_PATH}`;

/** Is this body one of OUR uploads (rather than a GIF or a pasted link)? Used
 *  for labels, for analytics, and — the one that matters — for deciding whether
 *  deleting a message should also delete a file.
 *
 *  Matched on the PATH, not on this build's configured host: the same bucket
 *  answers on the custom domain and on the project's supabase.co URL, and a
 *  message stores whichever host the client that posted it was configured with.
 *  Keyed to the host, an image posted from one and moderated from the other
 *  would leave its file behind with nothing to show for it.
 *
 *  A truncated prefix (the DM list's 80-character preview) still matches, which
 *  is the point of testing the front of the string. */
export function isChatImageUrl(url?: string | null): boolean {
  const u = (url ?? '').trim();
  if (!/^https:\/\/[^/]/i.test(u)) return false;       // https only: a public bucket is served over TLS
  const slash = u.indexOf('/', 'https://'.length);
  return slash > 0 && u.slice(slash).startsWith(PUBLIC_PATH);
}

/** The object path inside the bucket, or null when the URL is not ours (or is
 *  too short to name one file — never hand storage.remove a guess). */
export function chatImagePath(url?: string | null): string | null {
  const u = (url ?? '').trim();
  if (!isChatImageUrl(u)) return null;
  const path = u.slice(u.indexOf(PUBLIC_PATH) + PUBLIC_PATH.length).split('?')[0];
  return path.split('/').length === 3 && !path.endsWith('/') ? path : null;
}

/** 16 hex characters of file name. Not crypto.randomUUID: Hermes has no
 *  `crypto` and this file is shared with the native app. It does not need to be
 *  unguessable on its own — it sits behind two uuids that are — only unique
 *  inside one author's folder, which two random 64-bit-ish halves are. */
function randomName(): string {
  const h = (n: number) => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0').slice(0, n);
  return `${h(8)}${h(8)}`;
}

/** THE PATH, which is also the permission (0349): the storage policies read
 *  the league out of the first folder and the author out of the second, so a
 *  key that is not exactly three segments can only ever be rejected. Built in
 *  one place, checked by scripts/check-chat-image.mjs against the SQL. */
export function chatImageKey(leagueId: string, authorId: string, type: ChatImageType): string {
  return `${leagueId}/${authorId}/${randomName()}.${EXT[type]}`;
}

export interface ChatImageUpload { ok: boolean; url?: string; path?: string; error?: string }

/** Put an image in the league's bucket and hand back the URL to post as the
 *  message body. `data` is whatever the host's SDK can upload — a web `Blob`/
 *  `File`, or an `ArrayBuffer` on native. */
export async function uploadChatImage(leagueId: string, data: Blob | ArrayBuffer | Uint8Array, mime: string): Promise<ChatImageUpload> {
  const type = chatImageType(mime);
  if (!type) return { ok: false, error: 'That file is not an image we can post — JPEG, PNG, GIF or WebP.' };
  const size = data instanceof ArrayBuffer ? data.byteLength
    : ArrayBuffer.isView(data) ? data.byteLength
    : (data as Blob).size;
  if (size > CHAT_IMAGE_MAX_BYTES) {
    return { ok: false, error: `That image is ${(size / 1048576).toFixed(1)} MB — keep it under ${CHAT_IMAGE_MAX_BYTES / 1048576} MB.` };
  }
  const sb = await getSupabase();
  if (!sb) return { ok: false, error: 'Live mode is not configured' };
  const { data: auth } = await sb.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { ok: false, error: 'Sign in to post a picture.' };
  const path = chatImageKey(leagueId, uid, type);
  // upsert stays false: the name is fresh every time, so an upsert could only
  // ever mean somebody handed us a path, and nobody does.
  const { error } = await sb.storage.from(CHAT_IMAGE_BUCKET)
    .upload(path, data as Blob, { contentType: type, cacheControl: '31536000', upsert: false });
  if (error) return { ok: false, error: error.message || 'Could not upload that image.' };
  return { ok: true, path, url: `${chatImageBase()}${path}` };
}

/** Delete the file behind an image message. Called after the message itself is
 *  gone: the storage policy lets the author or the commissioner through, which
 *  is exactly who chat_delete let through a moment earlier. Best-effort by
 *  design — a message that is deleted but whose file survives is a smaller
 *  problem than a delete button that reports failure after the line is gone. */
export async function removeChatImage(url?: string | null): Promise<boolean> {
  const path = chatImagePath(url);
  if (!path) return false;
  try {
    const sb = await getSupabase();
    if (!sb) return false;
    const { error } = await sb.storage.from(CHAT_IMAGE_BUCKET).remove([path]);
    return !error;
  } catch { return false; }
}
