// GETTING A PICTURE READY TO POST (v0.485.0), native — the phone's half of an
// image message. Core owns the bucket, the path, the limits and the shrink
// POLICY (data/chatImage.ts); web does the same job with a canvas
// (src/app/imagePost.ts). This is the Expo version: the system picker, then
// the bytes to hand up.
//
// THREE MODULES, ONE OF THEM ALREADY HERE. expo-image-picker opens the
// library, expo-image-manipulator does the resize, and expo-file-system reads
// the result — the last of which ships inside `expo` itself, so it is declared
// rather than added. Nothing here uses base64: File.bytes() hands back the
// actual bytes, which is both faster and about a third less memory than moving
// a 4 MB photo through a string.
//
// THE ORIGINAL IS PREFERRED. A picture that is already small enough, at
// sensible dimensions, is uploaded exactly as it sits on the phone — no
// re-encode, no generation loss. Only an oversized one goes through the
// manipulator, and a GIF never does: Expo's picker preserves an animated GIF
// only at `quality: 1` with no cropper, and a manipulator pass would hand back
// frame one with the animation quietly gone.
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import {
  CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_EDGE, chatImageType, shouldShrinkChatImage,
  type ChatImageType,
} from '@drip/core/data/chatImage';

export type PreparedImage =
  /** `uri` is the file these exact bytes came from — what the draft shows the
   *  poster before they send it (0350). Local, so the preview costs nothing. */
  | { ok: true; bytes: Uint8Array; type: ChatImageType; uri: string }
  | { ok: false; error: string };

const tooBig = (n: number) =>
  `That image is ${(n / 1048576).toFixed(1)} MB — keep it under ${CHAT_IMAGE_MAX_BYTES / 1048576} MB.`;

/** The type of a picked asset. `mimeType` is there on both platforms in SDK 57,
 *  but a file name is the honest fallback and costs two lines. */
function pickedType(mime?: string, name?: string | null, uri?: string): ChatImageType | null {
  const direct = chatImageType(mime);
  if (direct) return direct;
  const ext = /\.([a-z0-9]+)(?:\?|$)/i.exec(name || uri || '')?.[1]?.toLowerCase();
  return chatImageType(ext ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : null);
}

/** Open the photo library and hand back bytes ready for the bucket.
 *  `null` means the picker was dismissed — not an error, and not a message. */
export async function pickChatImage(): Promise<PreparedImage | null> {
  // quality 1 + no cropper: the two conditions under which Expo's picker
  // returns an animated GIF intact rather than its first frame.
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1, exif: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const type = pickedType(a.mimeType, a.fileName, a.uri);
  if (!type) return { ok: false, error: 'Pictures only — JPEG, PNG, GIF or WebP.' };

  const original = new File(a.uri);
  const size = a.fileSize ?? original.size ?? 0;
  if (!shouldShrinkChatImage({ bytes: size, width: a.width, height: a.height, type })) {
    if (size > CHAT_IMAGE_MAX_BYTES) return { ok: false, error: tooBig(size) };
    return { ok: true, bytes: await original.bytes(), type, uri: a.uri };
  }

  // Oversized: resize the long edge and re-encode. JPEG rather than WebP —
  // the manipulator's WebP is not on every platform, and the bucket takes both.
  try {
    const ctx = ImageManipulator.manipulate(a.uri);
    if (Math.max(a.width, a.height) > CHAT_IMAGE_MAX_EDGE) {
      ctx.resize(a.width >= a.height ? { width: CHAT_IMAGE_MAX_EDGE } : { height: CHAT_IMAGE_MAX_EDGE });
    }
    const saved = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
    const out = new File(saved.uri);
    if (out.size > CHAT_IMAGE_MAX_BYTES) return { ok: false, error: tooBig(out.size) };
    return { ok: true, bytes: await out.bytes(), type: 'image/jpeg', uri: saved.uri };
  } catch {
    // The manipulator can refuse a file the picker was happy with. Posting the
    // original a bit big beats a picture that will not post at all.
    if (size > CHAT_IMAGE_MAX_BYTES) return { ok: false, error: tooBig(size) };
    return { ok: true, bytes: await original.bytes(), type, uri: a.uri };
  }
}
