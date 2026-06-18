// Build-time generator: bakes real 2025 Week-4 play-by-play (Stathead MCP /
// nflverse) into a compact per-player dataset. Source rows were pulled per
// rostered player and team-filtered to drop namesakes (e.g. Trevor Etienne,
// Luke McCaffrey). Rows: qtr,time,play_type,yards,td. QBs flagged so a "pass"
// row scores as passing; for skill players a "pass" row is a target/reception.
// Run: node scripts/genRealPbp.mjs  → writes src/data/realPbp.ts
import { writeFileSync } from 'node:fs';

const QB = new Set(['dak-prescott', 'trevor-lawrence', 'caleb-williams', 'cj-stroud', 'kyler-murray', 'jaxson-dart']);

// id -> rows "qtr,time,play_type,yards,td"
const RAW = {
'dak-prescott': `1,04:14,pass,7,0
1,03:31,pass,4,0
1,02:13,pass,0,0
1,02:07,pass,4,0
2,09:59,pass,0,0
2,05:50,pass,14,0
2,05:12,pass,9,0
2,03:44,pass,2,0
2,03:01,pass,11,0
2,02:23,pass,8,0
2,01:31,pass,11,0
2,00:54,pass,28,0
2,00:44,run,2,1
2,00:13,pass,15,1
3,13:28,pass,0,0
3,12:51,pass,0,0
3,07:07,pass,0,0
3,06:28,pass,4,0
3,05:44,pass,15,0
3,04:49,pass,10,0
3,03:37,pass,3,0
3,02:12,pass,0,0
3,02:07,pass,11,0
3,01:18,pass,9,0
3,00:38,pass,8,1
4,11:34,pass,5,0
4,10:22,pass,5,0
4,09:18,pass,4,0
4,08:35,pass,0,0
4,08:31,pass,12,0
4,07:11,pass,0,0
4,07:06,pass,3,0
4,01:38,pass,0,0
4,01:35,pass,7,0
4,01:13,pass,19,0
4,00:50,pass,28,1
5,09:21,pass,4,0
5,07:57,pass,22,0
5,07:17,pass,3,0
5,06:43,pass,34,0`,
'trevor-lawrence': `1,08:13,pass,14,0
1,06:55,run,2,0
1,05:22,pass,0,0
1,04:32,pass,6,0
1,03:49,run,3,0
1,01:53,pass,0,0
2,13:02,pass,6,0
2,11:35,pass,28,0
2,10:40,pass,7,0
2,09:19,pass,8,0
2,08:06,pass,11,0
2,07:42,pass,9,0
2,05:47,pass,11,0
2,05:06,pass,4,1
2,03:26,pass,0,0
2,03:22,pass,-1,0
2,02:43,pass,0,0
2,00:32,pass,7,0
2,00:27,pass,11,0
2,00:21,pass,10,0
2,00:15,pass,1,0
3,14:26,pass,7,0
3,08:26,pass,0,0
3,08:22,pass,0,0
3,06:25,pass,0,0
3,04:59,pass,0,0
3,04:55,pass,4,0
3,02:22,pass,0,0
4,13:39,pass,7,0
4,07:33,pass,9,0
4,06:08,run,1,0
4,04:31,pass,0,0
4,03:44,pass,7,0
4,02:43,run,6,0
4,02:36,pass,8,0`,
'christian-mccaffrey': `1,14:05,run,3,0
1,13:31,run,11,0
1,12:51,run,2,0
1,11:17,pass,4,0
1,09:59,run,2,0
1,09:23,run,-1,0
1,08:42,pass,0,0
1,01:06,run,3,0
2,14:36,run,-1,0
2,14:00,run,7,0
2,13:10,pass,0,0
2,04:56,run,3,0
2,02:23,pass,0,0
2,02:00,pass,0,0
2,01:00,run,2,0
3,12:36,run,5,0
3,11:23,run,5,0
3,10:13,run,4,0
3,08:39,pass,8,1
3,04:07,run,1,0
3,03:29,run,0,0
3,02:22,pass,0,0
3,01:39,pass,11,0
4,15:00,run,1,0
4,11:57,pass,7,0
4,11:20,run,2,0
4,10:34,pass,29,0
4,03:32,pass,13,0`,
'travis-etienne': `1,08:33,run,4,0
1,07:34,run,11,0
1,06:11,run,8,0
1,02:34,run,-2,0
2,14:50,run,48,1
2,11:58,run,2,0
2,11:21,run,5,0
2,09:58,run,1,0
2,00:15,pass,1,0
3,15:00,run,1,0
3,13:42,run,1,0
3,08:22,pass,0,0
3,08:04,run,18,0
3,07:25,run,5,0
3,06:48,run,-2,0
3,06:02,run,7,0
4,14:14,run,2,0
4,06:53,run,0,0
4,05:22,run,11,0
4,04:38,run,5,0
4,02:47,run,-1,0`,
'george-pickens': `2,09:59,pass,0,0
2,05:50,pass,14,0
2,01:31,pass,11,0
2,00:54,pass,28,0
2,00:13,pass,15,1
3,13:28,pass,0,0
3,02:12,pass,0,0
4,08:31,pass,12,0
4,00:50,pass,28,1
5,09:21,pass,4,0
5,07:57,pass,22,0`,
'wandale-robinson': `1,03:31,pass,0,0
3,11:33,pass,8,0
3,05:28,pass,0,0
4,09:14,pass,6,0
4,05:44,pass,0,0`,
'caleb-williams': `1,14:16,pass,5,0
1,13:31,pass,0,0
1,10:07,pass,0,0
1,10:01,pass,0,0
1,06:34,run,4,0
1,05:57,pass,6,0
1,05:13,run,-4,0
1,04:30,pass,0,0
1,04:24,pass,0,0
2,15:00,pass,4,0
2,14:23,pass,10,0
2,13:40,pass,0,0
2,13:33,pass,7,0
2,13:03,pass,29,0
2,12:15,pass,0,0
2,12:09,run,-6,0
2,11:19,pass,-10,0
2,08:14,pass,-4,0
2,07:35,pass,7,0
2,05:34,pass,3,0
2,03:55,pass,0,0
2,03:50,pass,13,0
2,03:07,pass,3,0
2,02:00,pass,15,0
2,01:15,pass,0,0
2,01:03,pass,0,0
3,14:21,pass,0,0
3,14:13,pass,17,0
3,13:28,pass,10,0
3,11:54,pass,0,0
3,11:44,pass,27,1
3,04:31,pass,0,0
3,04:22,run,2,0
3,01:07,pass,0,0
4,13:58,pass,13,0
4,13:13,pass,5,0
4,12:31,pass,0,0
4,12:27,run,0,0
4,06:39,pass,5,0
4,05:29,pass,13,0
4,04:50,pass,7,0
4,04:08,run,12,0
4,02:42,pass,17,0
4,02:00,pass,0,0
4,01:53,run,6,0
4,01:34,pass,0,0`,
'davante-adams': `2,02:14,pass,5,0
2,01:20,pass,16,0
2,00:11,pass,10,1
3,12:45,pass,0,0
4,05:53,pass,25,0
4,04:09,pass,0,0`,
'cole-kmet': `2,15:00,pass,4,0
2,13:03,pass,29,0
2,12:15,pass,0,0
2,03:50,pass,13,0
2,01:15,pass,0,0
3,14:21,pass,0,0
3,04:31,pass,0,0
4,12:31,pass,0,0
4,02:00,pass,0,0`,
'cj-stroud': `1,09:47,run,2,0
1,09:04,pass,9,0
1,08:36,pass,5,0
1,07:58,run,4,0
1,06:16,pass,-3,0
1,05:31,pass,6,0
1,03:05,pass,22,0
1,01:54,pass,8,0
1,00:51,pass,0,0
2,14:17,pass,0,0
2,14:12,pass,3,0
2,10:20,pass,0,0
2,09:37,pass,5,0
2,06:38,pass,6,0
2,05:58,pass,9,0
2,03:49,pass,9,0
2,02:23,pass,-6,0
2,02:00,pass,0,0
3,13:29,pass,7,0
3,07:46,pass,2,0
3,06:47,pass,9,0
3,06:24,run,3,0
3,04:06,pass,37,0
3,02:45,pass,8,0
3,02:03,pass,0,0
3,01:57,run,2,0
3,01:13,pass,5,0
3,00:28,pass,17,0
4,15:00,pass,12,1
4,14:55,pass,0,0
4,11:50,pass,-2,0
4,11:29,pass,12,0
4,09:31,pass,24,1
4,05:43,pass,0,0
4,05:39,pass,20,0`,
'nico-collins': `1,03:05,pass,22,0
2,14:12,pass,3,0
2,10:20,pass,0,0
2,02:00,pass,0,0
3,04:06,pass,37,0
3,00:28,pass,17,0`,
'jauan-jennings': `2,01:06,pass,10,0
2,00:54,pass,0,0
3,10:59,pass,14,0
3,08:32,pass,2,0
3,06:14,pass,0,0`,
'jake-tonges': `2,03:36,pass,0,0
2,02:20,pass,14,0
2,01:20,pass,0,0
3,11:59,pass,23,0
4,07:49,pass,21,1`,
'puka-nacua': `1,12:18,pass,8,0
1,10:59,pass,0,0
1,10:12,pass,10,0
2,11:23,pass,14,0
2,08:37,pass,31,0
2,01:35,pass,23,0
2,01:25,pass,0,0
2,00:59,pass,9,0
2,00:26,pass,17,0
3,11:32,pass,17,0
3,07:50,pass,7,0
3,03:20,pass,4,0
4,08:02,pass,10,0
4,04:06,pass,11,0
4,03:24,pass,9,1`,
'kyler-murray': `1,14:54,pass,8,0
1,14:21,pass,7,0
1,13:12,run,3,0
1,12:31,pass,0,0
1,09:02,pass,0,0
1,08:58,pass,0,0
1,08:10,pass,4,0
1,07:47,pass,2,0
1,07:03,pass,4,0
1,05:56,pass,6,0
1,00:48,pass,-8,0
1,00:08,run,4,0
2,11:34,pass,0,0
2,11:31,pass,6,0
2,11:11,pass,3,0
2,10:39,pass,0,0
2,10:37,pass,7,0
2,10:03,pass,17,0
2,09:24,pass,0,0
2,09:18,pass,-1,0
2,08:32,pass,0,0
2,05:13,pass,4,0
2,00:54,pass,0,0
2,00:49,pass,0,0
2,00:46,pass,12,0
2,00:38,pass,-7,0
2,00:17,run,4,0
2,00:02,pass,4,0
3,07:25,pass,3,0
3,06:39,pass,0,0
3,04:50,pass,4,0
3,04:11,pass,10,0
3,03:46,pass,16,0
3,03:10,pass,-7,0
3,01:48,pass,0,0
4,09:27,pass,3,0
4,09:01,run,29,0
4,08:35,run,1,0
4,07:24,pass,9,0
4,06:38,pass,-7,0
4,05:55,pass,16,1
4,03:16,pass,6,0
4,03:09,pass,0,0
4,03:04,pass,0,0
4,03:01,pass,5,0
4,02:14,pass,-7,0
4,02:00,pass,15,0
4,01:26,pass,5,0
4,01:21,pass,0,0
4,01:16,pass,18,0
4,00:33,pass,7,1`,
'malik-nabers': `1,12:42,pass,7,0
1,10:05,pass,13,0
2,06:21,pass,0,0`,
'sam-laporta': `1,05:28,pass,5,0
2,00:46,pass,27,0
2,00:17,pass,0,0
3,00:18,pass,7,0`,
'brian-thomas': `1,08:13,pass,14,0
1,01:53,pass,0,0
2,13:02,pass,6,0
2,07:42,pass,9,0
2,07:06,run,7,0
2,03:26,pass,0,0
2,00:27,pass,11,0
4,07:33,pass,9,0`,
'rhamondre-stevenson': `1,10:51,run,1,0
1,00:54,run,22,0
1,00:06,run,2,0
2,04:02,run,1,0
2,00:17,run,3,0
3,14:14,run,5,0
3,11:05,run,1,0
3,05:08,run,2,0
3,01:44,run,1,0
3,01:02,pass,3,0`,
'jaxson-dart': `1,12:42,pass,7,0
1,11:10,run,9,0
1,10:41,run,4,0
1,10:05,pass,13,0
1,09:25,run,15,1
1,04:10,pass,18,0
1,03:31,pass,0,0
1,02:52,pass,0,0
1,02:46,pass,-3,0
1,00:33,run,1,0
2,07:29,pass,-8,0
2,06:48,pass,13,0
2,06:26,pass,0,0
2,06:21,pass,0,0
2,06:12,run,11,0
2,05:38,pass,4,0
2,05:10,pass,4,0
2,04:42,run,4,0
2,02:26,pass,-3,0
2,02:00,pass,0,0
3,13:01,run,10,0
3,12:25,pass,0,0
3,06:12,run,0,0
3,05:28,pass,0,0
3,02:54,pass,3,1
3,01:21,pass,7,0
3,00:19,pass,-6,0
4,15:00,pass,17,0
4,13:54,pass,-5,0
4,13:09,run,2,0
4,10:15,pass,9,0
4,09:14,pass,6,0
4,06:24,run,-2,0
4,05:44,pass,0,0
4,02:38,pass,10,0`,
};

function clockOf(qtr, mmss) {
  const [m, s] = mmss.split(':').map(Number);
  return Math.max(0, Math.min(3599, (qtr - 1) * 900 + (900 - (m * 60 + s))));
}

const week = 4;
const pbp = {};
const points = {};

for (const [id, csv] of Object.entries(RAW)) {
  const isQB = QB.has(id);
  const plays = [];
  let recYds = 0, rushYds = 0, passYds = 0, rec = 0, rushTd = 0, recTd = 0, passTd = 0;
  for (const line of csv.trim().split('\n')) {
    const [qtr, time, ptype, yards, td] = line.split(',');
    const y = Number(yards) || 0;
    const isTd = td === '1';
    const c = clockOf(Number(qtr), time);
    if (ptype === 'run') {
      plays.push({ c, k: 'rush', y, td: isTd ? 1 : 0, ca: 0, tg: 0 });
      rushYds += y; if (isTd) rushTd++;
    } else if (ptype === 'pass') {
      if (isQB) {
        plays.push({ c, k: 'pass', y, td: isTd ? 1 : 0, ca: 0, tg: 0 });
        passYds += y; if (isTd) passTd++;
      } else {
        const caught = y > 0 || isTd;
        plays.push({ c, k: caught ? 'rec' : 'incomplete', y: caught ? y : 0, td: isTd ? 1 : 0, ca: caught ? 1 : 0, tg: 1 });
        if (caught) { rec++; recYds += y; if (isTd) recTd++; }
      }
    }
  }
  plays.sort((a, b) => a.c - b.c);
  pbp[id] = plays;
  points[id] = Math.round((rec + recYds * 0.1 + rushYds * 0.1 + (rushTd + recTd) * 6 + passYds * 0.04 + passTd * 4) * 10) / 10;
}

const out = `// AUTO-GENERATED by scripts/genRealPbp.mjs — do not edit by hand.
// Real 2025 Week-4 play-by-play (Stathead MCP / nflverse), keyed by player id.
// c=game-elapsed seconds, k=kind, y=yards, td/ca/tg=flags.
export interface RealPlay { c: number; k: 'pass' | 'rush' | 'rec' | 'incomplete'; y: number; td: number; ca: number; tg: number; }
export const REAL_WEEKS = new Set<number>([${week}]);
export const REAL_PBP: Record<number, Record<string, RealPlay[]>> = ${JSON.stringify({ [week]: pbp })};
export const REAL_POINTS: Record<number, Record<string, number>> = ${JSON.stringify({ [week]: points })};
`;
writeFileSync(new URL('../src/data/realPbp.ts', import.meta.url), out);
console.log('wrote src/data/realPbp.ts —', Object.keys(pbp).length, 'players');
for (const id of Object.keys(pbp)) console.log(`  ${id}: ${pbp[id].length} plays, ${points[id]} pts`);
