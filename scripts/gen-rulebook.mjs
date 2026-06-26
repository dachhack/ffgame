// Regenerate the auto sections of docs/rulebook.md (the §4 metric catalog and the
// §6 power-up tables) straight from the data, so they can never drift from the
// engine. Run: npm run gen:rulebook
import { readFileSync, writeFileSync } from 'node:fs';
import { METRICS } from '../src/data/metrics.ts';
import { POWERUPS } from '../src/data/powerups.ts';

const POS = [
  ['QB', 'Quarterback'], ['RB', 'Running Back'], ['WR', 'Wide Receiver'], ['TE', 'Tight End'],
  ['K', 'Kicker'], ['DEF', 'Defense (DST)'], ['DL', 'IDP (DL / LB / DB)'],
];
const cell = (s) => String(s).replace(/\|/g, '\\|'); // table-safe

function catalog() {
  let out = '';
  for (const [pos, label] of POS) {
    out += `\n### ${label}\n\n| Metric | Tag | Scores | Effect |\n|---|---|---|---|\n`;
    for (const m of METRICS[pos] ?? []) out += `| **${cell(m.name)}** | ${cell(m.tag)} | ${cell(m.sc)} | ${cell(m.ef)} |\n`;
  }
  return out;
}

function powerups() {
  const grp = (title, sub, list) => {
    let s = `\n### ${title}\n*${sub}*\n\n| Power-up | Cost | Kind | What it does |\n|---|---|---|---|\n`;
    for (const p of list) s += `| ${p.icon} **${cell(p.name)}** | ◎ ${p.price} | ${p.kind} | ${cell(p.blurb)} |\n`;
    return s;
  };
  return grp('Pre-kickoff', 'arm during setup; locks once a window starts', POWERUPS.filter((p) => p.timing === 'pre'))
    + grp('In-game', 'fire anytime a window is live (not retroactive)', POWERUPS.filter((p) => p.timing === 'live'));
}

function splice(md, tag, content) {
  const a = `<!-- AUTO-${tag}:START -->`, b = `<!-- AUTO-${tag}:END -->`;
  const i = md.indexOf(a), j = md.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`markers for ${tag} not found`);
  return md.slice(0, i + a.length) + '\n' + content + '\n' + md.slice(j);
}

const path = new URL('../docs/rulebook.md', import.meta.url);
let md = readFileSync(path, 'utf8');
md = splice(md, 'CATALOG', catalog());
md = splice(md, 'POWERUPS', powerups());
writeFileSync(path, md);
console.log(`rulebook regenerated: ${Object.values(METRICS).flat().length} metric rows, ${POWERUPS.length} power-ups`);
