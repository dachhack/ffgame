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
    { id: 'carries', name: 'Carries', tag: 'COMPRESSION', fx: 'compression', sc: '0.5 / carry', ef: '0.5 per carry. A 3+ carry streak with no opponent score compresses: each further carry trims the opponent’s most recent score by 25%.' },
    { id: 'rec', name: 'Receptions', tag: 'RATE RESET', fx: 'reset', sc: '1 pt / catch', ef: 'Each catch zeroes the opponent’s active drip rate. They keep the bank, rebuild from scratch.' },
    { id: 'td', name: 'Touchdowns', tag: 'NUKE', fx: 'nuke', sc: '6 pts / TD', ef: 'Each TD wipes the opponent’s entire banked score to zero.' },
    { id: 'combodrip', name: 'Combo Drip', tag: 'RUSH+REC DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Unlock (1 wk): carries AND catches both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; a TD wipes the bank.', lock: 'unlock-combo-drip' },
  ],
  WR: [
    { id: 'recyd', name: 'Receiving Yards', tag: 'DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Each catch permanently raises a drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. An opponent catch erases the last 10 min and pauses it; a target pauses it; a TD wipes the bank. Rate survives erases. 3 straight (no opponent score) goes hot → drip doubles; cold when they score.' },
    { id: 'rec', name: 'Receptions', tag: 'ERASE', fx: 'erase', sc: '1 pt / catch', ef: 'Each catch erases the opponent’s drip from the last 10 clock-minutes.' },
    { id: 'tgt', name: 'Targets', tag: 'CLOCK STOP', fx: 'stop', sc: '0.5 pts / target', ef: 'Every target stops the opponent’s drip clock. No erase — pure denial.' },
    { id: 'td', name: 'Touchdowns', tag: 'NUKE', fx: 'nuke', sc: '6 pts / TD', ef: 'Each TD wipes the opponent’s entire banked score to zero.' },
    { id: 'carries', name: 'Carries', tag: 'WIPE', fx: 'nuke', sc: '1 pt / carry', ef: 'Unlock (1 wk): every carry — jet sweep / end-around — instantly wipes the opposing player to 0.', lock: 'unlock-carries-wipe' },
    { id: 'combodrip', name: 'Combo Drip', tag: 'RUSH+REC DRIP', fx: 'sys', sc: '0.01 / yd → rate (pts/min)', ef: 'Unlock (1 wk): catches AND carries both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; a TD wipes the bank.', lock: 'unlock-combo-drip' },
  ],
  TE: [
    { id: 'recyd', name: 'Receiving Yards', tag: 'DRIP', fx: 'sys', sc: '0.005 / yd → rate (pts/min)', ef: 'Each catch raises a drip rate (yds × 0.005 pts/min) — half a WR’s — that accrues while your team has the ball. Immune to WR/RB pauses and erases: only a TD (or K shutdown) stops it. 3 straight (no opponent score) goes hot → drip doubles.' },
    { id: 'tgt', name: 'Targets', tag: 'WIDE ERASE', fx: 'erase', sc: '1 pt / target', ef: 'Every target — catch or incompletion — erases the opponent’s drip from the last 15 min. Wider than any WR, and fires on volume alone.' },
    { id: 'rec', name: 'Receptions', tag: 'ERASE', fx: 'erase', sc: '1.5 pts / catch', ef: 'Each catch erases the opponent’s drip from the last 10 clock-minutes.' },
    { id: 'td', name: 'Touchdowns', tag: '8-PT NUKE', fx: 'nuke', sc: '8 pts / TD', ef: 'The strongest single play in the game. Wipes the matched opponent’s entire bank AND instantly knocks every opposing drip in the window down by 1.0 pts/min (min 0).' },
    { id: 'carries', name: 'Carries', tag: 'WIPE', fx: 'nuke', sc: '1 pt / carry', ef: 'Unlock (1 wk): every carry instantly wipes the opposing player to 0.', lock: 'unlock-carries-wipe' },
    { id: 'combodrip', name: 'Combo Drip', tag: 'RUSH+REC DRIP', fx: 'sys', sc: '0.005 / yd → rate (pts/min)', ef: 'Unlock (1 wk): catches AND carries both feed one drip rate (yds × 0.005 pts/min, TE rate) that accrues while your team has the ball. Immune to WR/RB pauses like any TE drip; a TD wipes the bank.', lock: 'unlock-combo-drip' },
  ],
  K: [
    { id: 'banker', name: 'Banker', tag: 'XP BONUS', fx: 'mult', sc: 'FG by distance', ef: 'Each XP made adds +1 pt to ALL your TDs for the week.' },
    { id: 'neg', name: 'Negation', tag: 'SHUTDOWN', fx: 'nuke', sc: '0 pts', ef: '6+ kicks → the matched opponent scores 0 and all their effects are negated.' },
  ],
  DEF: [
    { id: 'suppress', name: 'Suppress', tag: 'HALVING', fx: 'stop', sc: '0 pts', ef: 'Banks 0 itself — instead its own defensive week score (sk/int/fr/TD) becomes a kill-bar: EVERY opponent slot, in ANY window, that scores at or below it is halved.' },
    { id: 'earn', name: 'Earn Points', tag: 'FLAT', fx: 'sys', sc: 'sk1 / int3 / fr2', ef: 'Normal flat head-to-head scoring. No suppress, no halving.' },
  ],
};

export function metricById(pos: Pos, id: string | null | undefined): Metric | undefined {
  if (!id) return undefined;
  return (METRICS[pos] || []).find((m) => m.id === id);
}

/** A sensible default metric for auto-filled / opponent lineups. */
export function defaultMetric(pos: Pos): Metric {
  const list = (METRICS[pos] || METRICS.WR).filter((m) => !m.lock);
  return list[0];
}
