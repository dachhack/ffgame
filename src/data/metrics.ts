import type { Metric, Pos, GameWindow } from '../types';

// The five game-time windows. 1 + 3 + 2 + 1 + 1 = 8 slots.
export const WINDOWS: GameWindow[] = [
  { id: 'tnf', label: 'TNF', sub: 'Thursday Night', slots: 1, time: 'Thu 8:15p' },
  { id: 'early', label: 'SUN 1PM', sub: 'Sunday Early', slots: 3, time: 'Sun 1:00p' },
  { id: 'late', label: 'SUN 4PM', sub: 'Sunday Late', slots: 2, time: 'Sun 4:05p' },
  { id: 'snf', label: 'SNF', sub: 'Sunday Night', slots: 1, time: 'Sun 8:20p' },
  { id: 'mnf', label: 'MNF', sub: 'Monday Night', slots: 1, time: 'Mon 8:15p' },
];

export const TOTAL_SLOTS = WINDOWS.reduce((n, w) => n + w.slots, 0);

// Shared IDP metric catalog (DL/LB/DB). Phase 1: flat box-score scoring on
// synthesized defensive plays (tackle / sack / int / fumble rec / def TD /
// safety); no drip or nuke interaction yet — those land with real per-defender
// play-by-play (see docs/mcp-requests.md item 8).
const IDP_METRICS: Metric[] = [
  { id: 'idp_tackles', name: 'Tackles', tag: 'FLAT', fx: 'sys', sc: 'tkl 1 · sk 2 · int 3 · FR 2', ef: 'Flat defensive scoring: 1 per tackle, 2 per sack, 3 per interception, 2 per fumble recovery, 6 per defensive/ST TD, 2 per safety. Volume-driven and steady.' },
  { id: 'idp_splash', name: 'Splash Plays', tag: 'BIG PLAY', fx: 'sys', sc: 'sk 4 · int 6 · FR 4 · TD 6', ef: 'Rewards game-wreckers: 4 per sack, 6 per interception, 4 per fumble recovery, 6 per defensive/ST TD, 2 per safety, 0.5 per tackle. Boom-or-bust.' },
];

// Hidden scoring metrics per position. Each carries a scoring rule AND a
// strategic effect. Text mirrors the design handoff's MET catalog.
export const METRICS: Record<Pos, Metric[]> = {
  QB: [
    { id: 'fg', name: 'Field General', tag: 'MULTIPLIER', fx: 'mult', sc: '0 direct pts', ef: 'Passing yards set a window-wide drip multiplier on all your skill players. 300 yds = 2.8×. The QB scores nothing himself.' },
    { id: 'pass', name: 'Passing Yards', tag: 'FLAT', fx: 'sys', sc: '0.04 pts / yd + 4 / TD', ef: 'Flat points on passing yards and TDs. No drip, no nuke, no interaction. Predictable.' },
    { id: 'rush', name: 'Rush Yards', tag: 'FLAT', fx: 'sys', sc: '0.1 pts / yd + 6 / TD', ef: 'Flat points on your scrambles and rushing TDs. Purely additive — no nuke, no erase, no interaction.' },
    { id: 'passbig', name: 'Air Raid', tag: 'TD HEAVY', fx: 'sys', sc: '0.04 / yd + 10 / TD', ef: 'Unlock (1 wk): passing yards at 0.04/yd plus a huge 10 pts per passing TD. Flat — no nuke or erase.', lock: 'unlock-pass-td10' },
  ],
  RB: [
    { id: 'rush', name: 'Rush Yards', tag: 'DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Each carry permanently raises a drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. An opponent catch erases the last 10 min and pauses it; a target pauses it; a TD wipes the bank. Rate survives erases. 3 straight (no opponent score) goes hot → drip doubles; cold when they score.' },
    { id: 'carries', name: 'Carries', tag: 'COMPRESSION', fx: 'compression', sc: '0.5 / carry', ef: '0.5 per carry. A 3+ carry streak with no opponent score compresses: each further carry trims the opponent’s most recent score by 25% — and you keep a quarter of every point trimmed.' },
    { id: 'rec', name: 'Receptions', tag: 'RATE RESET', fx: 'reset', sc: '1 pt / catch', ef: 'Each catch zeroes the opponent’s active drip rate (they keep the bank, rebuild from scratch); against a flat scorer it halves their last play — and you steal a quarter of any points cut.' },
    { id: 'td', name: 'Touchdowns', tag: 'NUKE', fx: 'nuke', sc: '0.04 / yd + 10 / TD', ef: 'Boom-or-bust: scrimmage yards at a discount (0.04/yd) plus a big 10 per TD — and each TD wipes the opponent’s entire banked score AND steals a quarter of it.' },
    { id: 'combodrip', name: 'Combo Drip', tag: 'RUSH+REC DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Unlock (1 wk, SINGLE-USE — one Combo Drip slot per lineup): carries AND catches both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; a TD wipes the bank. 4 straight productive touches goes hot → drip doubles (a stuffed run or incomplete cools it).', lock: 'unlock-combo-drip' },
    { id: 'retyd', name: 'Return Yards', tag: 'RUSH+RET DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Unlock (1 wk): carries AND kick/punt return yards both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; 4 straight productive touches (rush 3+ / return 10+) goes hot → drip doubles, a stuffed run or short return cools it.', lock: 'unlock-return' },
  ],
  WR: [
    { id: 'recyd', name: 'Receiving Yards', tag: 'DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Each catch permanently raises a drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. An opponent catch erases the last 10 min and pauses it; a target pauses it; a TD wipes the bank. Rate survives erases. 3 straight (no opponent score) goes hot → drip doubles; cold when they score.' },
    { id: 'rec', name: 'Receptions', tag: 'ERASE', fx: 'erase', sc: '1 pt / catch', ef: 'Each catch erases the opponent’s drip from the last 10 clock-minutes — and you steal a quarter of every point you erase.' },
    { id: 'tgt', name: 'Targets', tag: 'CLOCK STOP', fx: 'stop', sc: '1 pt / target', ef: 'Every target stops the opponent’s drip clock. No erase — pure denial.' },
    { id: 'td', name: 'Touchdowns', tag: 'NUKE', fx: 'nuke', sc: '0.04 / yd + 10 / TD', ef: 'Boom-or-bust: scrimmage yards at a discount (0.04/yd) plus a big 10 per TD — and each TD wipes the opponent’s entire banked score AND steals a quarter of it.' },
    { id: 'combodrip', name: 'Combo Drip', tag: 'RUSH+REC DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Unlock (1 wk, SINGLE-USE — one Combo Drip slot per lineup): catches AND carries both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; a TD wipes the bank. 4 straight productive touches goes hot → drip doubles (a stuffed run or incomplete cools it).', lock: 'unlock-combo-drip' },
    { id: 'retyd', name: 'Return Yards', tag: 'REC+RET DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Unlock (1 wk): catches AND kick/punt return yards both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; 4 straight (catch / 10+ return) goes hot → drip doubles, an incomplete or short return cools it.', lock: 'unlock-return' },
  ],
  TE: [
    { id: 'recyd', name: 'Receiving Yards', tag: 'DRIP', fx: 'sys', sc: '0.005 / yd → rate (pts/min)', ef: 'Each catch raises a drip rate (yds × 0.005 pts/min) — half a WR’s — that accrues while your team has the ball. Immune to WR/RB pauses and erases: only a TD (or K shutdown) stops it. 3 straight (no opponent score) goes hot → drip doubles.' },
    { id: 'tgt', name: 'Targets', tag: 'WIDE ERASE', fx: 'erase', sc: '1 pt / target', ef: 'Every target — catch or incompletion — erases the opponent’s drip from the last 15 min (you steal a quarter of every point erased). Wider than any WR, and fires on volume alone.' },
    { id: 'rec', name: 'Receptions', tag: 'ERASE', fx: 'erase', sc: '1.5 pts / catch', ef: 'Each catch erases the opponent’s drip from the last 10 clock-minutes — and you steal a quarter of every point you erase.' },
    { id: 'td', name: 'Touchdowns', tag: '12-PT NUKE', fx: 'nuke', sc: '0.04 / yd + 12 / TD', ef: 'The strongest single play in the game. Yards at a discount (0.04/yd) plus 12 per TD; each TD wipes the matched opponent’s entire bank (you steal a quarter of it) AND knocks every opposing drip in the window down by 1.0 pts/min (min 0).' },
    { id: 'combodrip', name: 'Combo Drip', tag: 'RUSH+REC DRIP', fx: 'sys', sc: '0.005 / yd → rate (pts/min)', ef: 'Unlock (1 wk, SINGLE-USE — one Combo Drip slot per lineup): catches AND carries both feed one drip rate (yds × 0.005 pts/min, TE rate) that accrues while your team has the ball. Immune to WR/RB pauses like any TE drip; a TD wipes the bank. 4 straight productive touches goes hot → drip doubles (an incomplete cools it).', lock: 'unlock-combo-drip' },
    { id: 'retyd', name: 'Return Yards', tag: 'REC+RET DRIP', fx: 'sys', sc: '0.005 / yd → rate (pts/min)', ef: 'Unlock (1 wk): catches AND kick/punt return yards both feed one drip rate (yds × 0.005 pts/min, TE rate) that accrues while your team has the ball. Immune to WR/RB pauses like any TE drip; 4 straight (catch / 10+ return) goes hot → drip doubles, an incomplete or short return cools it.', lock: 'unlock-return' },
  ],
  K: [
    { id: 'banker', name: 'Banker', tag: 'XP BONUS', fx: 'mult', sc: 'FG by distance', ef: 'Each XP made adds +1 pt to ALL your TDs for the week.' },
    { id: 'neg', name: 'Negation', tag: 'SHUTDOWN', fx: 'nuke', sc: '0 pts', ef: '6+ kicks → the matched opponent scores 0 and all their effects are negated.' },
  ],
  DEF: [
    { id: 'suppress', name: 'Suppress', tag: 'HALVING', fx: 'stop', sc: '0 pts', ef: 'Banks 0 itself — instead its own defensive week score (sk/int/fr/TD) becomes a kill-bar: EVERY opponent slot, in ANY window, that scores at or below it is halved.' },
    { id: 'earn', name: 'Earn Points', tag: 'FLAT', fx: 'sys', sc: 'sk1 / int3 / fr2', ef: 'Normal flat head-to-head scoring. No suppress, no halving.' },
  ],
  // IDP (individual defensive players). Phase 1: flat box-score scoring off
  // synthesized defensive plays; upgrades to interactive metrics + real
  // per-defender play-by-play once Stathead exposes defender ids.
  DL: IDP_METRICS,
  LB: IDP_METRICS,
  DB: IDP_METRICS,
};

export function metricById(pos: Pos, id: string | null | undefined): Metric | undefined {
  if (!id) return undefined;
  return (METRICS[pos] || []).find((m) => m.id === id);
}

/** Map every locked metric_id → the power-up that unlocks it, derived straight
 *  from the catalog's own `lock:` fields so there's one source of truth. A
 *  sealed pick on a locked metric is only legal once its unlock is armed; the DB
 *  trigger (migration 0024) enforces the same map server-side, and a parity test
 *  (scripts/check-locked-metrics.mjs) keeps the two in lockstep. */
export const LOCKED_METRIC_UNLOCK: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const list of Object.values(METRICS)) {
    for (const m of list) if (m.lock && !(m.id in out)) out[m.id] = m.lock;
  }
  return out;
})();

/** A sensible default metric for auto-filled / opponent lineups. */
export function defaultMetric(pos: Pos): Metric {
  const list = (METRICS[pos] || METRICS.WR).filter((m) => !m.lock);
  return list[0];
}
