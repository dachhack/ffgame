// DECLARED (0409): the prospect-pool parsers and the window, offline.
import { draftIdsOf, prospectOf, declaredWindowYear, runDeclared } from '../src/poll/declared.js';

let fails = 0;
const ok = (cond, name, got) => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`PASS  ${name}`);
};

const page = { items: [
  { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/draft/athletes/110756?lang=en' },
  { $ref: 'http://x/y' },
  { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/draft/athletes/110770?lang=en' },
] };
ok(JSON.stringify(draftIdsOf(page)) === '["110756","110770"]', 'the list page → draft ids', draftIdsOf(page));
const det = { fullName: 'Arvell Reese', athlete: { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/athletes/4950400?lang=en' } };
ok(JSON.stringify(prospectOf('110756', det)) === JSON.stringify({ draft_id: '110756', espn_id: '4950400', name: 'Arvell Reese' }), 'a detail → his college ESPN id');
ok(prospectOf('1', {}).espn_id === null, 'no college ref → null, not a guess');
ok(declaredWindowYear(new Date('2027-01-12T00:00:00Z')) === 2027, 'mid-January reads that year');
ok(declaredWindowYear(new Date('2027-04-25T00:00:00Z')) === 2027, 'draft week reads that year');
ok(declaredWindowYear(new Date('2026-10-01T00:00:00Z')) === null, 'October reads nothing (a big board, not a class)');

// A pass fetches only the draft ids it doesn't hold.
const fetched = [];
const fetchJson = async (url) => {
  fetched.push(url);
  if (url.includes('limit=')) return page;
  return { fullName: 'P', athlete: { $ref: '.../college-football/athletes/77' } };
};
let upserted = null;
const rpc = async (fn, args) => {
  if (fn === 'nfl_prospect_known') return { data: ['110756'], error: null };
  if (fn === 'upsert_nfl_prospects') { upserted = args; return { data: args.p_rows.length, error: null }; }
  return { data: null, error: { message: 'unexpected ' + fn } };
};
const r = await runDeclared(2026, () => {}, fetchJson, rpc);
ok(r.listed === 2 && r.added === 1, 'two listed, one new', r);
ok(fetched.length === 2 && fetched[1].endsWith('/athletes/110770'), 'only the unknown id is fetched', fetched);
ok(upserted?.p_year === 2026 && upserted.p_rows[0].espn_id === '77', 'and stored with its college id', upserted);

if (fails) { console.log(`\n${fails} DECLARED TEST(S) FAILED`); process.exit(1); }
console.log('\nALL DECLARED TESTS PASSED (0409)');
