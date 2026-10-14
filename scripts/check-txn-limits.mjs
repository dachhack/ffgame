// TRANSACTION LIMITS (0358): the manager's "what's left" line, shared by web
// and app. The server does the counting; this pins what the line says.
import { txnLimitSummary, txnResetLabel } from '../packages/core/src/data/txnLimits';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
// Wed 3:00 AM ET = 07:00 UTC during daylight time.
const WS = '2026-09-23T07:00:00+00:00';
ok('the reset is a week after the week started, in ET', txnResetLabel(WS) === 'Wed 3:00 AM ET', txnResetLabel(WS));
ok('no week start, no reset label', txnResetLabel(null) === null);

const none = txnLimitSummary({ ok: true, max_adds_week: null, max_adds_season: null, max_trades_season: null, week_start: WS, used: { week: 4, season: 9, trades: 2 } });
ok('no limits: nothing to say', none.text === null && !none.addsOut && !none.tradesOut, none);

const some = txnLimitSummary({ ok: true, max_adds_week: 3, max_adds_season: 10, max_trades_season: 1, week_start: WS, used: { week: 2, season: 7, trades: 0 } });
ok('all three, in order', some.text === '1 of 3 adds left this week (resets Wed 3:00 AM ET) · 3 of 10 left this season · 1 of 1 trade left', some.text);
ok('adds and trades still open', !some.addsOut && !some.tradesOut);

const weekOut = txnLimitSummary({ ok: true, max_adds_week: 2, max_adds_season: null, max_trades_season: null, week_start: WS, used: { week: 2, season: 2, trades: 0 } });
ok('the week spent: adds out', weekOut.addsOut && weekOut.text?.startsWith('0 of 2 adds left this week'), weekOut);
const seasonOut = txnLimitSummary({ ok: true, max_adds_week: 5, max_adds_season: 4, max_trades_season: 2, week_start: WS, used: { week: 1, season: 6, trades: 2 } });
ok('the season spent (and over-spent) reads 0, adds out', seasonOut.addsOut && seasonOut.text?.includes('0 of 4 left this season'), seasonOut);
ok('trades spent', seasonOut.tradesOut && seasonOut.text?.endsWith('0 of 2 trades left'), seasonOut);
ok('a failed read says nothing', txnLimitSummary({ ok: false }).text === null);
ok('no read at all says nothing', txnLimitSummary(null).text === null);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\ntxn-limits: all ok');
