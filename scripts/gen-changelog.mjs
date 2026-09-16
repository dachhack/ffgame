// STATUS.md → public/changelog.json (v0.393.0). One source: every version has
// had a `### vX.Y.Z — title` section in STATUS.md for months, written as it
// shipped. This reads them — heading + the paragraphs under it, up to the next
// heading — and writes the JSON both hosts read through core's changelog.ts.
// Runs in `npm run build` (the site serves it) and `check:changelog` asserts
// the version being built has an entry, which is what keeps the log kept.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseChangelog(md) {
  const lines = md.split('\n');
  const entries = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const notes = cur.body.join('\n').trim()
      .replace(/\n{3,}/g, '\n\n')
      // Inline markdown that reads badly as plain text.
      .replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]*)\*\*/g, '$1');
    entries.push({ version: cur.version, title: cur.title, notes, ...(/\bweb only\b/i.test(notes) ? { webOnly: true } : {}) });
    cur = null;
  };
  for (const line of lines) {
    const m = /^### v(\d+\.\d+\.\d+)\s*[—–-]\s*(.+?)\s*$/.exec(line);
    if (m) { flush(); cur = { version: m[1], title: m[2], body: [] }; continue; }
    if (/^##\s|^###\s/.test(line)) { flush(); continue; }
    if (cur) cur.body.push(line);
  }
  flush();
  // Newest first, and one entry per version (a version that appears twice
  // keeps its first — the top of STATUS is the latest word).
  const seen = new Set();
  return entries.filter((e) => (seen.has(e.version) ? false : (seen.add(e.version), true)))
    .sort((a, b) => cmp(b.version, a.version));
}
function cmp(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}

export function appVersion() {
  const m = /APP_VERSION = '([^']+)'/.exec(readFileSync(resolve(root, 'packages/core/src/version.ts'), 'utf8'));
  return m ? m[1].replace(/^v/, '') : '';
}

export function buildChangelog() {
  const entries = parseChangelog(readFileSync(resolve(root, 'STATUS.md'), 'utf8'));
  return { generated: new Date().toISOString(), latest: appVersion(), entries };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(root, 'public/changelog.json');
  mkdirSync(dirname(out), { recursive: true });
  const log = buildChangelog();
  writeFileSync(out, JSON.stringify(log));
  console.log(`changelog: ${log.entries.length} entries, latest v${log.latest} → public/changelog.json`);
}
