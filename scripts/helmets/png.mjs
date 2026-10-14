// Raw RGBA in and out of image files, with no image library: resvg decodes
// (any PNG/JPEG it can draw), zlib encodes.
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

// → { width, height, pixels: Uint8Array RGBA, not premultiplied }
export function decodeImage(path) {
  const buf = readFileSync(path);
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  const { width, height } = imageSize(buf, mime);
  const img = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image href="data:${mime};base64,${buf.toString('base64')}" width="${width}" height="${height}"/></svg>`).render();
  return { width, height, pixels: unpremultiply(new Uint8Array(img.pixels)) };
}

function imageSize(buf, mime) {
  if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  for (let i = 2; i < buf.length;) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  throw new Error('JPEG: no size');
}

// Premultiplied RGBA (what resvg renders) → straight RGBA.
export function unpremultiply(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a && a < 255) for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(255, Math.round((pixels[i + c] * 255) / a));
  }
  return pixels;
}

// PNG with per-row filters (None/Sub/Up/Average/Paeth, whichever leaves the
// smallest residuals): several times smaller than resvg's own output.
export function encodePng(pixels, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const zero = new Uint8Array(stride);
  const cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y ? pixels.subarray((y - 1) * stride, y * stride) : zero;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f];
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? row[x - 4] : 0, b = up[x], c = x >= 4 ? up[x - 4] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[x] - pred) & 0xff;
        o[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    raw.set(cand[best], y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
