// THE ADP BOARD POLLER, PINNED (v0.454.0). Offline — part of check:parity.
//
// The worker now refreshes the draft board's ADP by itself (0334). What can
// go wrong is not the market's opinion, it is the plumbing around it:
//
//   · reading a format column into the wrong field, so a superflex league
//     gets a PPR number wearing a 2QB label;
//   · joining on a name, or resolving a slug from anything but the id;
//   · keeping a dynasty-only row, which is 2,000 of the feed's 2,877 and not
//     a redraft board at all;
//   · pruning on every chunk instead of the last, which would leave a reader
//     mid-sweep looking at a board with a hole in it.
import { readFileSync } from 'node:fs';
import { adpRows } from '../server/src/poll/adp.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// The feed in its real shape, including the rows that must NOT survive.
const feed = {
  season: 2026,
  fetchedAt: '2026-09-21T06:00:00Z',
  players: [
    { sleeper_id: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET',
      adp_ppr: 1.0, adp_half_ppr: 1.9, adp_std: 2.7, adp_2qb: 1.2, adp_dynasty_ppr: 1.3 },
    { sleeper_id: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF',
      adp_ppr: 23.2, adp_half_ppr: 25.0, adp_std: 27.4, adp_2qb: 4.1, adp_dynasty_ppr: 12.0 },
    // Dynasty only — a startup price, not a draft board. Must be dropped.
    { sleeper_id: '99991', name: 'Deep Stash', position: 'WR', team: 'FA', adp_dynasty_ppr: 180.2 },
    // No id at all: unplaceable, and never to be matched by name.
    { sleeper_id: null, name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', adp_ppr: 1.0 },
    // Priced, but nobody our index knows — kept, with a null slug.
    { sleeper_id: '77777', name: 'Camp Body', position: 'WR', team: 'NYJ', adp_ppr: 240.0 },
  ],
};
const index = { sleeper: (sid) => ({ 9221: { slug: 'jahmyr-gibbs' }, 4984: { slug: 'josh-allen' } })[sid] ?? null };
const rows = adpRows(feed, index);
const by = new Map(rows.map((r) => [r.sleeper_id, r]));

ok(rows.length === 3, `${rows.length} rows kept of ${feed.players.length}`);
ok(!rows.some((r) => r.sleeper_id === '99991'), 'a dynasty-only row is not a draft board and is dropped');
ok(!rows.some((r) => !r.sleeper_id), 'a row with no id is dropped rather than matched by name');

// 2. every format lands in its own column
const gibbs = by.get('9221');
ok(gibbs.adp_ppr === 1 && gibbs.adp_half === 1.9 && gibbs.adp_std === 2.7
  && gibbs.adp_2qb === 1.2 && gibbs.adp_dyn === 1.3, 'each format lands in its own column');
const allen = by.get('4984');
ok(allen.adp_2qb === 4.1 && allen.adp_ppr === 23.2,
  'and the quarterback carries both prices — 4.1 superflex against 23.2 in 1QB');

// 3. the slug comes from the id, and only from the id
ok(gibbs.slug === 'jahmyr-gibbs', 'the slug is resolved through the player index by sleeper id');
ok(by.get('77777').slug === null,
  'a player the index cannot place keeps his id and a null slug, so tomorrow can claim him');
ok(rows.every((r) => r.source === 'sleeper'), 'rows name their source');

// 4. zero and nonsense are not prices
const junk = adpRows({ players: [
  { sleeper_id: 'z1', adp_ppr: 0 }, { sleeper_id: 'z2', adp_ppr: -3 }, { sleeper_id: 'z3', adp_ppr: 'x' },
] }, index);
ok(junk.length === 0, 'a zero, a negative and a non-number are all "not priced"');

// 5. the pruning contract, which lives half in SQL and half in the poller
const sql = readFileSync(new URL('../supabase/migrations/0334_the_market_refreshes_itself.sql', import.meta.url), 'utf8');
ok(/delete from adp_board where source = 'sleeper' and fetched_at < stamp/.test(sql),
  'the prune is keyed on the pull stamp, not on wall-clock age');
ok(/if p_prune then/.test(sql), 'and only runs when the caller asks');
const poller = readFileSync(new URL('../server/src/poll/adp.js', import.meta.url), 'utf8');
ok(/p_prune: i \+ CHUNK >= rows\.length/.test(poller), 'the poller asks on the last chunk only');

// 6. the format follows the lineup, not the scoring alone
ok(/when \(select n from qb\) > 1 then '2qb'/.test(sql),
  'a lineup starting more than one quarterback IS the superflex market');
ok(/spot -> 'pos' \? 'QB'/.test(sql), 'read off the league\'s own slot spec');
ok(/>= 0\.75 then 'ppr'/.test(sql) && />= 0\.25 then 'half'/.test(sql),
  'and everything else reads its own PPR value');

// 7. a format the market barely prices is not a market
const flat = sql.replace(/\s+/g, ' ');
ok(/< 300 then fmt := 'ppr'; end if;/.test(flat),
  'a format priced below a full draft board (300 picks) falls back to PPR');
ok(/if board and fmt <> 'ppr' then/.test(flat),
  'and the guard only ever downgrades TO ppr, never away from it');
ok(/adp_format', case when board then fmt else null end/.test(sql),
  'and the reported format is the one that actually answered');

// 8. the ladder is per player, not per feed
ok(/not exists \(\s*select 1 from adp_board b2 where b2\.slug = m\.slug/.test(sql),
  'ESPN answers only for the players the board does not price');

console.log(fails === 0 ? '\nALL ADP-BOARD ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
