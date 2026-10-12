// The wire audit (v0.688.1): what the report says and which chat lines it keeps.
import { wireReport, relevantLines, et } from '../src/wireAudit.js';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

ok('an Eastern time reads with its UTC', et('2026-10-12T08:00:00Z') === 'Mon, Oct 12, 4:00 AM ET (2026-10-12 08:00Z)', et('2026-10-12T08:00:00Z'));
ok('no time is a dash', et(null) === '—');

const lines = [
  { body: '🔻 Hewy13 dropped Case Keenum', txn: { kind: 'drop', drop: 'keenum' } },
  { body: '📋 Waivers ran — Hewy13 won Tyson Bagent ($0)', txn: { kind: 'waiver' } },
  { body: '🔻 Someone dropped Tyson Bagent', txn: { kind: 'drop', drop: 'bagent' } },
  { body: '➕ Someone added Joe Flacco', txn: { kind: 'add', add: 'flacco' } },
  { body: '🗓️ Waiver schedule updated', txn: { kind: 'waiver_days' } },
  { body: 'chatter about tyson bagent by a member', txn: null },
];
const kept = relevantLines(lines, ['bagent'], ['Tyson Bagent']);
ok('keeps the player\'s own drop', kept.some((m) => m.txn?.drop === 'bagent'));
ok('keeps every run', kept.some((m) => m.txn?.kind === 'waiver'));
ok('keeps schedule changes', kept.some((m) => m.txn?.kind === 'waiver_days'));
ok('keeps lines naming him', kept.some((m) => m.body.startsWith('chatter')));
ok('drops another player\'s add', !kept.some((m) => m.txn?.add === 'flacco'));
ok('drops an unrelated drop', !kept.some((m) => m.txn?.drop === 'keenum'));

const report = wireReport({
  leagueId: 'L', player: 'bagent', now: '2026-10-12T09:00:00Z', days: 21,
  league: { name: 'Kickoff League', sport: 'nfl', season: '2026', settings_json: { waiver_days: ['waivers_to_fa', 'waivers_to_fa', 'waivers', 'waivers', 'waivers', 'waivers', 'waivers'], waiver_clear_min: 240, waiver_game_hold_dow: 3 } },
  rpc: { fa_window_open: { data: true }, 'waiver_hold_until (a drop now)': { data: '2026-10-14T08:00:00Z' }, broken: { error: 'nope' } },
  teams: { 2: 'Hewy13' },
  pool: [{ slug: 'bagent', full_name: 'Tyson Bagent', pos: 'QB', team: 'CHI', waived_until: '2026-10-14T08:00:00Z' }],
  roster: [{ slug: 'bagent', roster_id: 2, acquired: 'waiver', added_at: '2026-10-12T08:00:00Z', spot: 'active' }],
  claims: [{ id: 9, roster_id: 2, add_slug: 'bagent', drop_slug: null, bid: 0, status: 'won', note: null, created_at: '2026-10-11T14:34:00Z', clears_at: null, processed_at: '2026-10-12T08:00:00Z' }],
  lines: kept, slate: [{ week: 6, home: 'CHI', away: 'DET', win: 'early', kickoff: '2026-10-11T17:00:00Z' }],
});
ok('the report names the league and player', report.includes('Kickoff League · bagent'));
ok('…shows the stored schedule', report.includes('waiver_clear_min     240'));
ok('…renders a timestamp answer in Eastern', report.includes('waiver_hold_until (a drop now)   Wed, Oct 14, 4:00 AM ET'));
ok('…renders a boolean answer', report.includes('fa_window_open                   true'));
ok('…shows an RPC error rather than dying', report.includes('ERROR nope'));
ok('…marks a live hold', report.includes('← HELD now'));
ok('…names the owner by team', report.includes('Hewy13 · waiver · active'));
ok('…lists the claim with its clocks', report.includes('#9  Hewy13  add bagent  bid $0  won') && report.includes('clears_at —'));
ok('…lists the slate', report.includes('DET @ CHI'));

if (fails) { console.log(`${fails} failing`); process.exit(1); }
console.log('all wire-audit checks passed');
