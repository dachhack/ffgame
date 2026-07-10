// Regenerate the auto sections of docs/rulebook.md (the §4 metric catalog and the
// §6 power-up tables) straight from the data, so they can never drift from the
// engine, AND emit a static, crawlable public/rulebook/index.html so search
// engines have real keyword-rich content to index (the SPA itself is one URL).
// Run: npm run gen:rulebook
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

// ── Static HTML page (public/rulebook/index.html) ──────────────────────────
// A minimal, dependency-free Markdown → HTML pass covering exactly the
// constructs the rulebook uses: h1–h3, pipe tables, `-` lists, `>` blockquotes,
// `---` rules, inline **bold** / *em* / `code`. No links or images are present.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function mdToHtml(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  const closeList = (stack) => { while (stack.length) out.push(stack.pop()); };
  const listStack = [];
  while (i < lines.length) {
    const line = lines[i];
    // Table: header row followed by a |---| separator.
    if (/^\|.*\|$/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
      closeList(listStack);
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { closeList(listStack); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^---+\s*$/.test(line)) { closeList(listStack); out.push('<hr />'); i++; continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!listStack.length) { out.push('<ul>'); listStack.push('</ul>'); }
      // Fold indented continuation lines (soft-wrapped list items) into this <li>.
      let text = li[1];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) { text += ' ' + lines[i].trim(); i++; }
      out.push(`<li>${inline(text)}</li>`);
      continue;
    }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) { closeList(listStack); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); i++; continue; }
    if (line.trim() === '') { closeList(listStack); i++; continue; }
    // Paragraph: gather consecutive plain lines.
    closeList(listStack);
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^[#>|-]/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  closeList(listStack);
  return out.join('\n');
}

const bodyHtml = mdToHtml(md);
const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Scoring Rulebook — Drip Fantasy</title>
<meta name="description" content="How scoring works in Drip Fantasy: the drip system, hidden metrics, nukes, erasures, hot streaks, the full metric catalog and power-up tables." />
<link rel="canonical" href="https://dripfantasy.com/rulebook/" />
<meta property="og:type" content="article" />
<meta property="og:title" content="Scoring Rulebook — Drip Fantasy" />
<meta property="og:description" content="The complete scoring rulebook for Drip Fantasy — drips, metrics, effects, power-ups." />
<meta property="og:url" content="https://dripfantasy.com/rulebook/" />
<meta property="og:image" content="https://dripfantasy.com/drip_fantasy_logo3.png" />
<style>
  :root { color-scheme: light dark; }
  body { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; font: 16px/1.6 system-ui, -apple-system, Segoe UI, sans-serif; color: #1a1a1a; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e7e7e7; background: #12181a; } code { background: #263238; } th { background: #1c2529; } td, th { border-color: #2a3439; } blockquote { border-color: #2a3439; color: #9fb0b5; } a { color: #6cd0c4; } }
  h1 { font-size: 2rem; line-height: 1.2; } h2 { margin-top: 2.4rem; border-bottom: 1px solid #ddd; padding-bottom: .3rem; } h3 { margin-top: 1.8rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; display: block; overflow-x: auto; }
  td, th { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; font-size: .92rem; }
  th { background: #f4f6f6; }
  code { background: #eef1f1; padding: .1rem .3rem; border-radius: 3px; font-size: .88em; }
  blockquote { border-left: 3px solid #ccc; margin: 1rem 0; padding: .2rem 1rem; color: #555; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 2rem 0; }
  a { color: #0a7d72; }
  .home { display: inline-block; margin-bottom: 1.5rem; font-weight: 600; }
</style>
</head>
<body>
<a class="home" href="/">← Play Drip Fantasy</a>
${bodyHtml}
<hr />
<p><a href="/">← Back to Drip Fantasy</a></p>
</body>
</html>
`;
const outDir = new URL('../public/rulebook/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('index.html', outDir), page);

console.log(`rulebook regenerated: ${Object.values(METRICS).flat().length} metric rows, ${POWERUPS.length} power-ups → docs/rulebook.md + public/rulebook/index.html`);
