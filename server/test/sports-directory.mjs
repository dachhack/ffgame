// The sport directories: NHL (standings + rosters + stats REST), MLB (players
// + leaderboards + fielding eligibility + 40-man IL status), NBA (Sleeper
// directory + season stats), WNBA (ESPN rosters); the rank; the basketball
// crosswalk. Run: `npx tsx test/sports-directory.mjs` from server/.
import { readFileSync } from 'node:fs';
import { nhlSeasonLines, nhlStandingsTeams, nhlSeasonId, nhlRosterPlayers, nhlOffRoster, nhlFirstSeasons, nhlExp } from '../src/sports/nhl.js';
import { mlbSeasonLines, mlbFieldingGames, mlbEligibility, mlbRosterStatus, mlbBuildDirectory, mlbExp } from '../src/sports/mlb.js';
import { sleeperNbaPlayers, sleeperNbaSeasonLines, espnWnbaRoster, wnbaTeam } from '../src/sports/nba.js';
import { directoryRow, rankDirectory, buildXref, resolveXref, normName, injuryRows, boardInjury } from '../src/poll/sportDirectory.js';
import { SPORTS } from '../../packages/core/src/sports/index.ts';
import { linePoints } from '../../packages/core/src/sports/score.ts';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/sports/${n}`, import.meta.url), 'utf8'));
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };
// A season line may carry per-game derived COUNTS (dd, td, qs, nh) the
// source summed; everything else must be a raw stat id.
const rawIds = (sport) => new Set(SPORTS[sport].stats.filter((s) => !s.derived || ['dd', 'td', 'qs', 'nh'].includes(s.id)).map((s) => s.id));
const onlyKnown = (sport, line) => Object.keys(line).every((k) => rawIds(sport).has(k));

// ── NHL ──────────────────────────────────────────────────────────────────────
{
  ok(nhlSeasonId('2026') === 20262027, 'season id');
  const teams = nhlStandingsTeams(fx('nhl-standings-sample.json'));
  ok(teams.length === 32 && teams.includes('BOS') && teams.includes('UTA'), `32 teams from the standings (${teams.slice(0, 3).join(', ')}…)`);
  const lines = nhlSeasonLines(fx('nhl-skaters-20252026-sample.json'), fx('nhl-goalies-20252026-sample.json'), fx('nhl-realtime-20252026-sample.json'));
  ok(lines.size === 31, `${lines.size} season lines`);
  const top = [...lines.values()].filter((l) => l.g != null).sort((a, b) => (b.g + b.a) - (a.g + a.a))[0];
  ok(top.gp >= 60 && top.hit >= 0 && top.ppa >= 0 && top.ppa + top.ppg <= top.g + top.a, `top skater: ${top.g}G ${top.a}A in ${top.gp} GP, ${top.hit} hits, PPP ${top.ppg + top.ppa}`);
  ok([...lines.values()].every((l) => onlyKnown('nhl', l)), 'NHL season lines use core ids');
  const g = [...lines.values()].find((l) => l.w != null);
  ok(g && g.gs > 0 && g.gtoi > 100 && g.sv > 0, `goalie season line: ${g?.w}W ${g?.sv} SV in ${g?.gtoi} min`);
  const roster = nhlRosterPlayers(fx('nhl-roster-bos.json'), 'BOS');
  const rows = roster.map((p, i) => directoryRow('nhl', { ...p, season: lines.get(p.extId) ?? null, gp: 0 }, i + 1));
  ok(rows.every((r) => r && r.player_key.startsWith('nhl-') && r.eligible.length === 1), `roster → rows: ${rows.map((r) => r.pos).join(',')}`);
  // OFF THE ROSTER (v0.627.2): the report's stars who are on no roster come in with their last team.
  const extra = nhlOffRoster(roster.map((p) => p.extId), lines, new Map(), '2025');
  ok(extra.length > 0 && extra.every((p) => p.offRoster && p.team && p.name && p.season && !roster.some((r) => r.extId === p.extId)), `${extra.length} off-roster players off the report (e.g. ${extra[0]?.name} ${extra[0]?.team} ${extra[0]?.pos})`);
  ok(extra.some((p) => p.name === 'Connor McDavid' && p.team === 'EDM'), 'McDavid, not a Bruin, stands in the directory off his season line');
  ok(nhlOffRoster(roster.map((p) => p.extId), nhlSeasonLines({ data: [{ playerId: 1, skaterFullName: 'Cup O. Coffee', teamAbbrevs: 'BOS', positionCode: 'C', gamesPlayed: 3 }] }, { data: [] }), new Map(), '2025').length === 0, 'three games is not an established line');
  const traded = nhlSeasonLines({ data: [{ playerId: 2, skaterFullName: 'Moved Midseason', teamAbbrevs: 'NYI,NJD', positionCode: 'L', gamesPlayed: 60 }] }, { data: [] });
  ok(nhlOffRoster([], traded, new Map(), '2025')[0]?.team === 'NJD', 'a traded player lands on the team he ended with');
  // TENURE (v0.629.1): first NHL season off the bios reports; a rostered man with no row has never played.
  const first = nhlFirstSeasons(fx('nhl-bios-skaters-sample.json'), fx('nhl-bios-goalies-sample.json'));
  ok(first.size === 22 && [...first.values()].every((f) => f >= 20000000 && f <= 20262027), `${first.size} first seasons off the bios`);
  ok(nhlExp(20152016, '2026') === 11 && nhlExp(20262027, '2026') === 0 && nhlExp(20252026, '2025') === 0 && nhlExp(null, '2026', true) === 0 && nhlExp(null, '2026', false) === null && nhlExp('bogus', '2026', false) === null, 'tenure: seasons since the first; a rostered unknown is a rookie, an off-roster unknown is unknown');
  const exps = roster.map((p) => ({ name: p.name, exp: nhlExp(first.get(p.extId), '2025', true) }));
  ok(exps.every((e) => Number.isInteger(e.exp)) && exps.filter((e) => e.exp === 0).map((e) => e.name).sort().join() === 'James Hagens,Jonathan Aspirot' && Math.max(...exps.map((e) => e.exp)) === 7, `the fixture Bruins' tenure: ${exps.map((e) => `${e.name} ${e.exp}`).join(', ')}`);
  ok(nhlExp(first.get('8477956'), '2025', true) === 0, 'a rostered man the bios never list (the fixture drops Pastrnak) reads as first-year');
  ok(directoryRow('nhl', { ...roster[0], exp: nhlExp(first.get(roster[0].extId), '2025') }, 1).exp === nhlExp(first.get(roster[0].extId), '2025'), 'the database row carries it');
}

// ── MLB ──────────────────────────────────────────────────────────────────────
{
  const hitting = fx('mlb-hitting-2026-sample.json'), pitching = fx('mlb-pitching-2026-sample.json'), fielding = fx('mlb-fielding-2026-sample.json');
  const lines = mlbSeasonLines(hitting, pitching);
  ok(lines.size >= 30 && [...lines.values()].every((l) => onlyKnown('mlb', l)), `${lines.size} MLB season lines in core ids`);
  const ace = [...lines.values()].filter((l) => l.gs >= 20).sort((a, b) => b.p_k - a.p_k)[0];
  ok(ace && ace.outs > 400 && SPORTS.mlb.derive(ace).ip > 130, `an ace: ${ace?.p_k} K over ${SPORTS.mlb.derive(ace).ip} IP`);
  const games = mlbFieldingGames(fielding);
  ok(games.size > 0, `fielding games for ${games.size} players`);
  ok(mlbEligibility('CF', new Map([['CF', 120], ['LF', 12], ['SS', 3]]), { hgp: 140 }).join() === 'OF', 'an outfielder is OF once, not per corner');
  ok(mlbEligibility('2B', new Map([['2B', 60], ['SS', 40]]), { hgp: 110 }).sort().join() === '2B,SS', 'two infield spots at 10+ games');
  ok(mlbEligibility('P', new Map(), { pgp: 30, gs: 30 }).join() === 'SP' && mlbEligibility('P', new Map(), { pgp: 60, gs: 0 }).join() === 'RP', 'starters and relievers from starts');
  ok(mlbEligibility('P', new Map(), { pgp: 40, gs: 12 }).sort().join() === 'RP,SP', 'a swingman is both');
  ok(mlbEligibility('DH', new Map([['1B', 4]]), { hgp: 100 }).join() === 'DH', 'a pure DH is a DH');
  ok(mlbEligibility('TWP', new Map([['P', 20]]), { hgp: 150, pgp: 20, gs: 20 }).sort().join() === 'DH,SP', 'a two-way player hits and starts');
  const status = mlbRosterStatus([fx('mlb-roster-40man-147.json')]);
  const il = [...status.values()].filter((s) => s.injury);
  ok(status.size === 42 && il.length >= 1 && il.every((s) => /^IL\d+$/.test(s.injury.code)), `40-man: ${status.size} players, ${il.length} on the IL (${il.map((s) => s.injury.code).join(',')})`);
  const dir = mlbBuildDirectory({
    players: fx('mlb-players-2026-sample.json'), teams: fx('mlb-teams-2026.json'),
    cur: { hitting, pitching }, prior: { hitting: { stats: [{ splits: [] }] }, pitching: { stats: [{ splits: [] }] } },
    fielding, rosters: [fx('mlb-roster-40man-147.json')], season: '2026',
  });
  ok(dir.length >= 25 && dir.every((p) => /^[A-Z]{2,3}$/.test(p.team) && p.feedCodes.length > 0), `${dir.length} directory rows with team codes and eligibility`);
  const yank = dir.find((p) => p.team === 'NYY');
  ok(!!yank, `a Yankee resolved through the 40-man: ${yank?.name} (${yank?.feedCodes})`);
  // OFF THE LIST (v0.627.2): a leaderboard player the season's player list leaves out comes in off his line.
  const people = fx('mlb-players-2026-sample.json').people;
  const dropped = people.find((p) => { const l = lines.get(String(p.id)); return l && ((l.hgp ?? 0) >= 40 || (l.pgp ?? 0) >= 10); });
  const dir2 = mlbBuildDirectory({
    players: { people: people.filter((p) => p.id !== dropped.id) }, teams: fx('mlb-teams-2026.json'),
    cur: { hitting, pitching }, prior: { hitting: { stats: [{ splits: [] }] }, pitching: { stats: [{ splits: [] }] } },
    fielding, rosters: [fx('mlb-roster-40man-147.json')], season: '2026',
  });
  const back = dir2.find((p) => p.extId === String(dropped.id));
  ok(!!back && back.offRoster && /^[A-Z]{2,3}$/.test(back.team) && back.feedCodes.length > 0, `${dropped.fullName}, off the list, is back off the leaderboard as ${back?.team} ${back?.feedCodes}`);
  ok(dir2.length === dir.length, 'and the directory is the same size as with him listed');
  const rows = rankDirectory('mlb', dir).map((p, i) => directoryRow('mlb', p, i + 1));
  ok(rows[0].rank === 1 && rows[0].rank_pts >= rows[1].rank_pts && rows.every((r) => r.eligible.every((e) => SPORTS.mlb.positions.includes(e))), `ranked: #1 ${rows[0].full_name} ${rows[0].rank_pts} pts`);
  // TENURE (0436): seasons since the debut year; this season's debut is a rookie; no debut, no tenure.
  ok(mlbExp('2026-04-02', '2026') === 0 && mlbExp('2019-07-31', '2026') === 7 && mlbExp(null, '2026') === null && mlbExp('bogus', '2026') === null, 'MLB tenure from the debut date');
  const dir3 = mlbBuildDirectory({
    players: { people: people.slice(0, 3).map((p, i) => ({ ...p, mlbDebutDate: i === 0 ? '2026-05-01' : i === 1 ? '2020-08-01' : undefined })) }, teams: fx('mlb-teams-2026.json'),
    cur: { hitting, pitching }, prior: { hitting: { stats: [{ splits: [] }] }, pitching: { stats: [{ splits: [] }] } },
    fielding, rosters: [fx('mlb-roster-40man-147.json')], season: '2026',
  });
  const byId = new Map(dir3.map((p) => [p.extId, p]));
  ok(byId.get(String(people[0].id))?.exp === 0 && byId.get(String(people[1].id))?.exp === 6 && byId.get(String(people[2].id))?.exp == null, 'a directory row carries the tenure; rows without a debut carry none');
  ok(directoryRow('mlb', dir3.find((p) => p.extId === String(people[1].id)), 1).exp === 6 && directoryRow('mlb', dir3.find((p) => p.extId === String(people[2].id)), 2).exp === null, 'and the database row does too');
}

// ── NBA ──────────────────────────────────────────────────────────────────────
{
  const dir = sleeperNbaPlayers(fx('sleeper-nba-sample.json'));
  ok(dir.length === 28 && dir.every((p) => /^\d+$/.test(p.extId) && p.team), `${dir.length} active rostered Sleeper players (inactive dropped)`);
  // TENURE (0436): Sleeper's years_exp rides along; a rookie is 0.
  ok(dir.every((p) => p.exp === null || Number.isInteger(p.exp)) && dir.some((p) => p.exp != null), `tenure from years_exp: ${dir.filter((p) => p.exp != null).length} of ${dir.length} known, ${dir.filter((p) => p.exp === 0).length} rookies`);
  const hurt = dir.filter((p) => p.injury);
  ok(hurt.length >= 3 && hurt.every((p) => ['O', 'GTD', 'OFS'].includes(p.injury.code)), `injuries mapped: ${hurt.map((p) => p.injury.code).join(',')}`);
  const lines = sleeperNbaSeasonLines(fx('sleeper-nba-stats-2025-sample.json'));
  ok(lines.size >= 20 && [...lines.values()].every((l) => onlyKnown('nba', l) && l.min > 0), `${lines.size} NBA season lines with minutes from seconds`);
  ok([...lines.values()].some((l) => l.dd > 0) && [...lines.values()].every((l) => 'dd' in l && 'td' in l), 'double- and triple-double counts ride along as season counts');
  const withLines = dir.map((p) => ({ ...p, season: lines.get(p.extId) ?? null, seasonId: '2025', gp: lines.get(p.extId)?.gp ?? 0 }));
  const ranked = rankDirectory('nba', withLines);
  ok(linePoints(SPORTS.nba, ranked[0].season) >= linePoints(SPORTS.nba, ranked[1].season), `#1 ${ranked[0].name} by points, then search rank`);
  const noLine = ranked.filter((p) => !p.season);
  ok(noLine.every((p) => ranked.indexOf(p) > ranked.findIndex((q) => q.season)), 'players without a line rank behind everyone with one');
  const row = directoryRow('nba', ranked[0], 1);
  ok(row.eligible.length >= 1 && row.pos === row.eligible[0] && row.rank_pts > 0 && row.season === '2025', `row: ${row.full_name} ${row.eligible} ${row.rank_pts} pts`);
}

// ── WNBA (ESPN roster shape) ─────────────────────────────────────────────────
{
  const roster = { team: { id: '14', abbreviation: 'NY' }, athletes: [
    { id: '4066533', fullName: 'Breanna Stewart', position: { abbreviation: 'F' }, jersey: '30', headshot: { href: 'https://a.espncdn.com/x.png' } },
    { id: '3149391', fullName: 'Sabrina Ionescu', position: { abbreviation: 'G' }, injuries: [{ status: 'Out', details: { type: 'Ankle' } }] },
    { id: 'x1', fullName: 'Bad Id', position: { abbreviation: 'C' } },
    { id: '99', displayName: 'Gone Player', position: { abbreviation: 'C' }, status: { type: 'inactive' } },
  ] };
  const rows = espnWnbaRoster(roster);
  ok(rows.length === 3 && rows[0].team === 'NYL' && rows[0].headshot && rows[1].injury.code === 'O' && rows[1].injury.note === 'Ankle' && rows[2].active === false, 'ESPN roster: ids, the league tricode (NY → NYL), headshot, injury, inactive');
  ok(wnbaTeam('CONN') === 'CON' && wnbaTeam('PHX') === 'PHO' && wnbaTeam('ATL') === 'ATL' && wnbaTeam('gs') === 'GSV', 'ESPN WNBA codes become the box scores\' tricodes');
  ok(directoryRow('wnba', rows[0], 1).eligible.join() === 'F', 'a WNBA forward is F');
}

// ── injuries for the boards ──────────────────────────────────────────────────
{
  ok(boardInjury('IL60') === 'IR' && boardInjury('GTD') === 'Q' && boardInjury('OFS') === 'IR' && boardInjury('P') === null && boardInjury(null) === null, 'sport designations map to the boards\' O/D/Q/IR');
  const rows = injuryRows([
    { sport: 'mlb', player_key: 'mlb-1', team: 'NYY', injury_status: 'IL15', injury_note: 'Injured 15-Day' },
    { sport: 'mlb', player_key: 'mlb-2', team: 'NYY', injury_status: null },
    { sport: 'nba', player_key: 'nba-3', team: 'GSW', injury_status: 'O', injury_note: 'Knee — Surgery' },
  ]);
  ok(rows.length === 2 && rows[0].status === 'IR' && rows[0].source === 'mlb-dir' && rows[1].status === 'O' && rows[1].comment === 'Knee — Surgery', 'injury_status rows for the injured only');
}

// ── the crosswalk ────────────────────────────────────────────────────────────
{
  ok(normName('Luka Dončić') === 'luka doncic' && normName('Jaren Jackson Jr.') === 'jaren jackson' && normName("De'Aaron Fox") === 'deaaron fox', 'names normalise');
  const x = buildXref([
    { player_key: 'nba-1', full_name: 'Jaylen Brown', team: 'BOS', alt_ids: null },
    { player_key: 'nba-2', full_name: 'Jaylen Wells', team: 'MEM', alt_ids: { nba: '1642', espn: '5' } },
    { player_key: 'nba-3', full_name: 'Jalen Brunson', team: 'NYK', alt_ids: null },
    { player_key: 'nba-4', full_name: 'Jaime Jaquez Jr.', team: 'MIA', alt_ids: null },
    { player_key: 'nba-5', full_name: 'Mike Smith', team: 'LAL', alt_ids: null }, { player_key: 'nba-6', full_name: 'Marcus Smith', team: 'LAL', alt_ids: null },
  ]);
  ok(resolveXref(x, 'nba', { extId: '1642', name: 'Whatever', team: 'ZZZ' }) === 'nba-2', 'a remembered alt id wins outright');
  ok(resolveXref(x, 'nba', { extId: '7', name: 'Jaylen Brown', team: 'BOS' }) === 'nba-1', 'exact name + team');
  ok(resolveXref(x, 'nba', { extId: '8', name: 'J. Jaquez Jr.', team: 'MIA' }) === 'nba-4', 'surname alone when unique on the team');
  ok(resolveXref(x, 'nba', { extId: '9', name: 'Mike Smith', team: 'LAL' }) === 'nba-5' && resolveXref(x, 'nba', { extId: '10', name: 'Smith', team: 'LAL' }) === null, 'two Smiths: the initial decides, a bare surname does not');
  ok(resolveXref(x, 'nba', { extId: '11', name: 'Jaylen Brown', team: 'LAL' }) === null, 'a traded player on a stale team does not match (the next sweep fixes the team)');
}

console.log(fails ? `\n${fails} FAILED` : '\nall sport directory checks passed');
process.exit(fails ? 1 : 0);
