// GETTING A PICTURE READY TO POST (0349) — the browser half of an image
// message. Core owns the bucket, the path and the limits (data/chatImage.ts);
// this owns the part that needs a DOM: picking the file up (file input, paste,
// drag-and-drop) and shrinking it before it goes anywhere.
//
// WHY SHRINK AT ALL. A photo off a modern phone is 3–8 MB and 4000px wide, and
// chat renders it 200px tall. Uploading the original would spend the league's
// data on pixels nobody can see, fail the bucket's 6 MB cap often enough to
// look broken, and make the message slow to load for everyone else for ever.
// 1600px on the long edge is generous for a screenshot of a lineup — the one
// thing people zoom into — and turns an 8 MB photo into ~200 KB.
//
// WHAT IS LEFT ALONE: GIFs (a canvas re-encode would freeze the animation, and
// an animated GIF is usually the whole point) and anything already small. Those
// pass through byte-for-byte, capped by the bucket.
//
// EVERY FAILURE FALLS BACK TO THE ORIGINAL. Canvas encoding is the kind of
// thing an old browser, a private window or an oversized image can refuse. If
// any step throws we post the file as it came in and let the size cap decide;
// a picture that posts a bit big beats a picture that will not post.
import { CHAT_IMAGE_MAX_BYTES, chatImageType } from '@drip/core/data/chatImage';

/** Longest edge we keep. Chat shows images at 200px tall; this leaves room to
 *  open one full-screen without it being a postage stamp. */
const MAX_EDGE = 1600;
/** Below this, re-encoding is a waste — it can even make the file bigger. */
const SMALL_ENOUGH = 320 * 1024;

export type PreparedImage = { ok: true; blob: Blob; type: string } | { ok: false; error: string };

/** Does this browser produce the format we ask a canvas for? Safari only
 *  learned WebP recently, and a canvas that cannot encode it silently hands
 *  back a PNG — which the bucket would reject. */
function canEncode(type: string): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL(type).startsWith(`data:${type}`);
  } catch { return false; }
}

async function shrink(file: File, target: string): Promise<Blob | null> {
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    // Already small enough on both edges AND a modest file: nothing to gain.
    if (scale === 1 && file.size <= SMALL_ENOUGH) return null;
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, target, 0.82));
    // A re-encode that came out BIGGER (small flat PNGs do this) is a loss.
    return blob && blob.size < file.size ? blob : null;
  } catch { return null; }
  finally { bmp?.close?.(); }
}

/** Validate, shrink where it helps, and hand back the bytes to upload. */
export async function prepareChatImage(file: File): Promise<PreparedImage> {
  const type = chatImageType(file.type);
  if (!type) return { ok: false, error: 'Pictures only — JPEG, PNG, GIF or WebP.' };
  const tooBig = (n: number) =>
    `That image is ${(n / 1048576).toFixed(1)} MB — keep it under ${CHAT_IMAGE_MAX_BYTES / 1048576} MB.`;
  if (type === 'image/gif') {
    // No re-encode: a canvas would keep frame one and throw the animation away.
    return file.size > CHAT_IMAGE_MAX_BYTES ? { ok: false, error: tooBig(file.size) } : { ok: true, blob: file, type };
  }
  const target = canEncode('image/webp') ? 'image/webp' : 'image/jpeg';
  const smaller = await shrink(file, target);
  if (smaller) return { ok: true, blob: smaller, type: target };
  return file.size > CHAT_IMAGE_MAX_BYTES ? { ok: false, error: tooBig(file.size) } : { ok: true, blob: file, type };
}

/** The first image on a paste — a screenshot straight from the clipboard, the
 *  way people actually share one. Returns null for an ordinary text paste, so
 *  the caller leaves that alone. */
export function pastedImage(e: React.ClipboardEvent): File | null {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
      const f = items[i].getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** The first image in a drop. Same idea, for a file dragged onto the chat. */
export function droppedImage(e: React.DragEvent): File | null {
  const files = e.dataTransfer?.files;
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith('image/')) return files[i];
  }
  return null;
}
