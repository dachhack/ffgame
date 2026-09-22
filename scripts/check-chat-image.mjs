// POSTING A PICTURE (0349), checked in Node.
//
// Founder: "I want to allow users to post images in the chat."
//
// An uploaded image is not a new kind of message — it is an ordinary chat line
// whose body is a URL into our own bucket. That makes three things load-bearing
// and none of them visible when they break:
//
//   • THE PATH IS THE PERMISSION. storage's policies read the league out of the
//     first folder and the author out of the second (0349). A key built any
//     other way is refused at upload time with a permissions error, which reads
//     like "you are not in this league" and is not.
//   • THE TYPES ARE DUPLICATED IN SQL, because SQL cannot import TypeScript. A
//     type the client offers and the bucket rejects is a picker that fails on
//     the file the user chose; SVG, which the bucket must never take, is the
//     one where the failure is a security bug rather than an annoyance.
//   • THE EXTENSION IS WHAT MAKES EVERY OTHER CLIENT RENDER IT. The native app
//     and every web build before this one decide "is this an image?" by looking
//     at the end of the URL. Keep that true and an upload posted from the web
//     shows up as a picture in an app that has never heard of the bucket.
import { readFileSync } from 'node:fs';
import {
  CHAT_IMAGE_BUCKET, CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_EDGE, CHAT_IMAGE_SMALL_ENOUGH, CHAT_IMAGE_TYPES,
  chatImageType, chatImageKey, chatImageBase, isChatImageUrl, chatImagePath, shouldShrinkChatImage,
} from '../packages/core/src/data/chatImage';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const sql = readFileSync(new URL('../supabase/migrations/0349_the_league_posts_a_picture.sql', import.meta.url), 'utf8');

// ── THE PATH THE POLICIES READ ─────────────────────────────────────────────
{
  const key = chatImageKey(LEAGUE, AUTHOR, 'image/jpeg');
  const parts = key.split('/');
  ok('a key is exactly three segments — league / author / file', parts.length === 3, key);
  ok('…the league first, as the write policy expects', parts[0] === LEAGUE, parts[0]);
  ok('…the author second, which is what pins an upload to one person', parts[1] === AUTHOR, parts[1]);
  ok('…and a random file name, never the one off the user\'s disk', /^[0-9a-f]{16}\.jpg$/.test(parts[2]), parts[2]);
  ok('two keys in a row differ', chatImageKey(LEAGUE, AUTHOR, 'image/png') !== chatImageKey(LEAGUE, AUTHOR, 'image/png'));
  // The SQL rejects anything that is not three segments; both halves agree.
  ok('the SQL reads the path the same way', /array_length\(parts, 1\), 0\) <> 3/.test(sql));
  ok('…the league from the first segment', /return parts\[1\]::uuid/.test(sql));
  ok('…and the author from the second', /return parts\[2\]::uuid/.test(sql));
}

// ── EVERY OTHER CLIENT RENDERS IT BY THE EXTENSION ─────────────────────────
{
  const byExtension = (u) => /\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(u);
  for (const t of CHAT_IMAGE_TYPES) {
    const url = chatImageBase() + chatImageKey(LEAGUE, AUTHOR, t);
    ok(`an upload of ${t} renders in a client that only knows extensions`, byExtension(url), url);
  }
  ok('the bucket URL is the project\'s own storage host, not a CDN',
    /^https:\/\/[^/]+\/storage\/v1\/object\/public\/chat-image\/$/.test(chatImageBase()), chatImageBase());
}

// ── WHAT THE PICKER ACCEPTS, AND WHAT IT MUST NOT ──────────────────────────
{
  ok('jpeg, png, gif and webp are the four', CHAT_IMAGE_TYPES.join(' ') === 'image/jpeg image/png image/gif image/webp');
  ok('image/jpg normalises — pickers and Windows both say it', chatImageType('image/jpg') === 'image/jpeg');
  ok('a charset parameter does not defeat it', chatImageType('image/png; charset=binary') === 'image/png');
  ok('case does not either', chatImageType('IMAGE/GIF') === 'image/gif');
  // SVG is a script that renders like a picture. In a public bucket on our own
  // origin it is a stored-XSS delivery mechanism, so it is refused on both ends.
  ok('SVG is NOT an image we accept', chatImageType('image/svg+xml') === null);
  ok('nor is an HTML file wearing an image name', chatImageType('text/html') === null);
  ok('nor is a PDF, a video, or nothing at all',
    chatImageType('application/pdf') === null && chatImageType('video/mp4') === null
    && chatImageType('') === null && chatImageType(null) === null && chatImageType(undefined) === null);
}

// ── THE CLIENT'S LIMITS ARE THE BUCKET'S LIMITS ────────────────────────────
{
  const limit = /file_size_limit[\s\S]*?values\s*\([^)]*?,\s*(\d+),/.exec(sql)
    ?? /,\s*(\d{6,}),\s*\n?\s*array\[/.exec(sql);
  ok('the migration states a size limit at all', !!limit);
  ok('…and it is the one the client enforces', limit && Number(limit[1]) === CHAT_IMAGE_MAX_BYTES,
    { sql: limit && Number(limit[1]), ts: CHAT_IMAGE_MAX_BYTES });
  const types = /array\[([^\]]*)\]/.exec(sql);
  const sqlTypes = (types ? types[1] : '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  ok('SQL and TypeScript allow the SAME types', sqlTypes.join(' ') === CHAT_IMAGE_TYPES.join(' '),
    { sql: sqlTypes, ts: [...CHAT_IMAGE_TYPES] });
  ok('the bucket is the one the client writes to', sql.includes(`'${CHAT_IMAGE_BUCKET}'`));
  ok('the bucket is public-read, which is what makes a stored URL keep working',
    /values \('chat-image', 'chat-image', true,/.test(sql));
}

// ── IS THIS BODY ONE OF OURS? ──────────────────────────────────────────────
// Used to label a pin, to count the right analytics event, and — the one that
// matters — to decide whether deleting a message should delete a file.
{
  const url = chatImageBase() + chatImageKey(LEAGUE, AUTHOR, 'image/webp');
  ok('an upload is recognised', isChatImageUrl(url));
  ok('…and its path comes back out, ready for storage.remove', chatImagePath(url).split('/').length === 3);
  ok('surrounding whitespace does not hide it', isChatImageUrl(`  ${url}  `));
  ok('a cache-busting query is stripped from the path', chatImagePath(`${url}?t=2`) === chatImagePath(url));
  // A GIF is somebody else's file. Treating one as ours would mean trying to
  // delete from Tenor on every moderation — noise at best.
  // The SAME bucket answers on the custom domain and on the project's
  // supabase.co URL, and a message stores whichever host posted it. Recognising
  // only this build's host would strand the other one's images: rendered, but
  // never cleaned up when the message they belong to is deleted.
  const viaProjectHost = `https://abcdefgh.supabase.co/storage/v1/object/public/chat-image/${LEAGUE}/${AUTHOR}/deadbeefdeadbeef.png`;
  ok('the same bucket on the project host is ours too', isChatImageUrl(viaProjectHost));
  ok('…and yields the same shape of path', chatImagePath(viaProjectHost).split('/').length === 3);
  ok('a different bucket on our own host is NOT', !isChatImageUrl(chatImageBase().replace('chat-image', 'avatars') + 'x/y/z.png'));
  ok('a Tenor GIF is not ours', !isChatImageUrl('https://media1.tenor.com/x/abc.gif'));
  ok('a Giphy GIF is not ours', !isChatImageUrl('https://media0.giphy.com/media/x/giphy.gif'));
  ok('nor is a lookalike that merely CONTAINS our base',
    !isChatImageUrl(`https://evil.example.com/?next=${chatImageBase()}${LEAGUE}/${AUTHOR}/deadbeefdeadbeef.png`));
  ok('nor is an http downgrade of it', !isChatImageUrl(url.replace('https://', 'http://')));
  ok('plain text is not', !isChatImageUrl('good luck this week') && !isChatImageUrl('') && !isChatImageUrl(null));
  ok('a path is not returned for something that is not ours', chatImagePath('https://media1.tenor.com/x/abc.gif') === null);
  ok('…nor for our base with nothing under it', chatImagePath(chatImageBase()) === null);
  ok('…nor for a truncated key that would delete the wrong thing',
    chatImagePath(`${chatImageBase()}${LEAGUE}/${AUTHOR}`) === null);
  // The DM list previews the body's FIRST 80 CHARACTERS (0147). An upload URL
  // is longer than that, so the preview is a prefix — and still has to read as
  // a picture rather than as half a link.
  ok('an 80-character preview of an upload is still recognised as one', isChatImageUrl(url.slice(0, 80)), url.slice(0, 80));
  ok('…and that prefix is genuinely shorter than the URL', url.length > 80, url.length);
}

// ── BOTH HOSTS SHRINK TO THE SAME PLACE (v0.485.0) ─────────────────────────
// The web re-encodes with a canvas and the app with expo-image-manipulator, so
// the two could easily drift into the web sending 200 KB and the app sending
// 4 MB — which nobody would notice until the storage bill did. WHETHER to
// re-encode is one function, here, used by both.
{
  const MB = 1048576;
  ok('a 4000px phone photo is shrunk',
    shouldShrinkChatImage({ bytes: 6 * MB, width: 4032, height: 3024, type: 'image/jpeg' }));
  ok('a small screenshot is left alone',
    !shouldShrinkChatImage({ bytes: 180 * 1024, width: 1170, height: 1200, type: 'image/png' }));
  ok('…but a heavy one at the same size is not, because the bytes are the cost',
    shouldShrinkChatImage({ bytes: 2 * MB, width: 1170, height: 1200, type: 'image/png' }));
  ok('exactly at the long edge is not over it',
    !shouldShrinkChatImage({ bytes: 1024, width: CHAT_IMAGE_MAX_EDGE, height: 900, type: 'image/jpeg' }));
  ok('one pixel over is', shouldShrinkChatImage({ bytes: 1024, width: CHAT_IMAGE_MAX_EDGE + 1, height: 900, type: 'image/jpeg' }));
  ok('the tall edge counts too', shouldShrinkChatImage({ bytes: 1024, width: 900, height: CHAT_IMAGE_MAX_EDGE + 1, type: 'image/jpeg' }));
  // THE ONE THAT PROTECTS SOMEBODY'S GIF. Every re-encode path on both hosts
  // keeps frame one — a GIF is posted as it came or refused for size, never
  // silently flattened.
  ok('a GIF is NEVER re-encoded, however big',
    !shouldShrinkChatImage({ bytes: 5 * MB, width: 4000, height: 4000, type: 'image/gif' }));
  ok('unknown dimensions fall back to the byte test',
    shouldShrinkChatImage({ bytes: 4 * MB, type: 'image/jpeg' })
    && !shouldShrinkChatImage({ bytes: 1024, type: 'image/jpeg' }));
  ok('the small-enough floor is under the hard cap', CHAT_IMAGE_SMALL_ENOUGH < CHAT_IMAGE_MAX_BYTES);
}

// ── THE APP ASKS FOR THE PHOTO LIBRARY AND NOTHING ELSE ────────────────────
// expo-image-picker's config plugin, left unconfigured, ADDS
// android.permission.RECORD_AUDIO and writes both iOS usage strings. A chat
// feature would ship the app asking for a microphone, and nobody reads a
// generated manifest until a store review does. `false` blocks them.
{
  const app = JSON.parse(readFileSync(new URL('../apps/mobile/app.json', import.meta.url), 'utf8'));
  const plugin = (app.expo.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-image-picker');
  ok('the app declares the image picker plugin', !!plugin);
  const opts = plugin?.[1] ?? {};
  ok('…with the line iOS shows before opening the library',
    typeof opts.photosPermission === 'string' && opts.photosPermission.length > 20, opts.photosPermission);
  ok('…the camera explicitly OFF, not merely unmentioned', opts.cameraPermission === false, opts.cameraPermission);
  ok('…and the microphone too', opts.microphonePermission === false, opts.microphonePermission);
  const deps = JSON.parse(readFileSync(new URL('../apps/mobile/package.json', import.meta.url), 'utf8')).dependencies;
  for (const m of ['expo-image-picker', 'expo-image-manipulator', 'expo-file-system']) {
    ok(`${m} is a declared dependency, not a borrowed transitive one`, !!deps[m], deps[m]);
  }
}

if (fails) { console.log(`\n${fails} CHAT IMAGE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL CHAT IMAGE ASSERTIONS PASSED');
