// THE ADP JOIN, PINNED (v0.452.0).
//
// ADP was the last name-only bake in the data layer. Adding the id is worth
// almost nothing TODAY — the source audit measured 221 of 221 rows minting a
// distinct slug that a live Sleeper-built pool also mints, with no collisions
// — and everything, because the failure it prevents is silent: a bake and a
// pool that spell the same man differently produce a player with no ADP, who
// then sorts to the bottom of the board and autopicks last.
//
// So the assertions are mostly about what must NOT change. The id is an
// addition; if a single existing slug's number moves, the change is wrong.
import { readFileSync } from 'node:fs';
import { ADP_2026, ADP_BY_SID, adpValue } from '../packages/core/src/data/adp2026.ts';
import { setSlugSleeperIds, clearSlugMetaOverrides } from '../packages/core/src/data/slugMeta.ts';
import { normName } from '../packages/core/src/data/players.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

const src = readFileSync(new URL('../packages/core/src/data/adp2026.ts', import.meta.url), 'utf8');
const rows = src.split('const ADP_CSV = `')[1].split('`;')[0].split('\n')
  .map((l) => l.split(',')).filter((c) => c.length >= 4);

// 1. EVERY row carries an id, and no two rows share one.
const ids = rows.map((c) => (c[4] ?? '').trim());
ok(rows.length > 200, `${rows.length} rows in the board`);
ok(ids.every(Boolean), `every row carries a sleeper id (${ids.filter(Boolean).length}/${rows.length})`);
ok(new Set(ids).size === ids.length, 'and no two rows claim the same one');
ok(ids.every((id) => /^\d+$/.test(id)), 'ids are numeric, as Sleeper mints them');

// 2. THE NAME MAP IS UNCHANGED. Rebuilt here from the CSV the same way the
// module did before the fifth column existed — if these disagree, the id
// column changed a value, which it must never do.
const before = new Map();
for (const c of rows) {
  const slug = normName(c[0]).replace(/\s+/g, '-');
  const adp = parseFloat(c[3]);
  if (slug && Number.isFinite(adp) && !before.has(slug)) before.set(slug, adp);
}
ok(before.size === ADP_2026.size, `the name map still has ${ADP_2026.size} slugs`);
const moved = [...before].filter(([s, v]) => ADP_2026.get(s) !== v);
ok(moved.length === 0, moved.length ? `${moved.length} values MOVED: ${moved.slice(0, 3).map(([s]) => s)}` : 'and not one value moved');

// 3. BOTH MAPS PRICE THE SAME PLAYER THE SAME. Every id resolves to the
// number its own row carries.
let paired = 0; let mismatched = 0;
for (const c of rows) {
  const slug = normName(c[0]).replace(/\s+/g, '-');
  const id = (c[4] ?? '').trim();
  if (!id) continue;
  paired++;
  if (ADP_BY_SID.get(id) !== ADP_2026.get(slug)) mismatched++;
}
ok(mismatched === 0, `${paired} rows agree between the id map and the name map`);

// 4. WITH NO POOL INSTALLED, NOTHING CHANGES. This is the invariant that
// makes the change safe to ship: away from a league (the mock draft, the
// marketing board, a card opened from a search), no slug→id overlay exists
// and `adpValue` is exactly the lookup it always was.
clearSlugMetaOverrides();
const sample = [...ADP_2026.keys()].slice(0, 50);
ok(sample.every((s) => adpValue(s) === ADP_2026.get(s)), 'with no pool installed, the id-first lookup IS the name lookup');
ok(adpValue('not-a-real-player') === null, 'and an unknown slug is null, not undefined');

// 5. WITH A POOL INSTALLED, THE ID WINS — which is the whole point. A pool
// that spells him differently from the board still finds his ADP.
const [firstRow] = rows;
const realSlug = normName(firstRow[0]).replace(/\s+/g, '-');
const realAdp = ADP_2026.get(realSlug);
setSlugSleeperIds({ 'a-differently-spelled-name': (firstRow[4] ?? '').trim() });
ok(adpValue('a-differently-spelled-name') === realAdp,
  `a pool slug the board never heard of still prices, through the id (${realAdp})`);
// …and the id never overrides a slug the board DOES know with somebody else's
// number, because the overlay is keyed by that pool's own slug.
setSlugSleeperIds({ [realSlug]: (firstRow[4] ?? '').trim() });
ok(adpValue(realSlug) === realAdp, 'and a slug the board knows keeps its own number');
clearSlugMetaOverrides();

// 6. THE POOL BUILDER TAKES THE ID DIRECTLY. It runs where no overlay exists
// yet — it is the thing that BUILDS the pool — so it must read the id off the
// directory row rather than through the overlay.
const nl = readFileSync(new URL('../packages/core/src/data/nativeLeague.ts', import.meta.url), 'utf8');
ok(/ADP_BY_SID\.get\(p\.id\) \?\? ADP_2026\.get\(slug\)/.test(nl),
  'the pool builder joins on the directory id first, then the name');

console.log(fails === 0 ? '\nALL ADP-JOIN ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
