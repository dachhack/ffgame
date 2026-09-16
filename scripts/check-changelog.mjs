// The changelog is kept (v0.393.0). Pins the STATUS.md → changelog.json
// parser and the discipline it enforces: the version this tree builds as
// (APP_VERSION) has a `### vX.Y.Z — title` entry in STATUS.md. Founder: "I
// guess we need to keep a change log now too" — this is what makes forgetting
// it a red check rather than a silent gap in the app's What's New.
import { parseChangelog, appVersion, buildChangelog } from './gen-changelog.mjs';
import { entriesBehind, versionsBehind, compareVersions } from '../packages/core/src/data/changelog.ts';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };

const log = buildChangelog();
ok(log.entries.length >= 100, `STATUS.md yields a real changelog (${log.entries.length} entries)`);
ok(log.entries.every((e) => /^\d+\.\d+\.\d+$/.test(e.version) && e.title.length > 0), 'every entry has a version and a title');
ok(log.entries.every((e, i) => i === 0 || compareVersions(log.entries[i - 1].version, e.version) > 0), 'entries are newest first, no duplicates');
const v = appVersion();
ok(log.entries.some((e) => e.version === v), `APP_VERSION v${v} has a STATUS.md entry — write one before bumping the version`);
ok(log.latest === v, 'changelog.latest is APP_VERSION');

const sample = parseChangelog(`### v0.2.0 — two\n\nweb only, no APK.\n\n### v0.1.5 — one point five\n\nnotes here\n`);
ok(sample.length === 2 && sample[0].version === '0.2.0' && sample[0].webOnly === true && sample[1].webOnly === undefined, 'parser: web-only flag and order');
ok(versionsBehind(sample, '0.1.0', '0.2.0') === 2 && versionsBehind(sample, '0.1.0', '0.2.0', { appOnly: true }) === 1, 'versionsBehind counts, and appOnly skips web-only entries');
ok(entriesBehind(sample, '0.1.5', null).length === 1 && entriesBehind(sample, '0.2.0', null).length === 0, 'entriesBehind: strictly newer than mine');
ok(compareVersions('v0.10.0', '0.9.9') > 0, 'numeric compare, not lexical');

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL CHANGELOG ASSERTIONS PASSED');
