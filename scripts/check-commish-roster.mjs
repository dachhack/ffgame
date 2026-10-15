// THE ROSTER SETTINGS, SPLIT THREE WAYS (v0.714.0). Founder: "We have several
// roster features: Roster Construction, Eligible Players, Per Manager Roster
// Constraints, let's have those be separate areas in the commish settings" —
// and of copies: "That's a players option that should be in the commish
// settings". Pins the three destinations on both hosts, what lives in each,
// and that copies left the draft room. Run: node scripts/check-commish-roster.mjs
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let fails = 0;
const ok = (name, cond) => { if (!cond) { fails++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

const tools = read('apps/mobile/src/screens/CommishTools.tsx');
ok('phone: three roster destinations on the map', tools.includes("{ id: 'lineup', label: 'ROSTER CONSTRUCTION' }") && tools.includes("{ id: 'eligible', label: 'ELIGIBLE PLAYERS' }") && tools.includes("{ id: 'rosterrules', label: 'MANAGER ROSTER RULES' }"));
ok('phone: the roster actions are ROSTERS & WIRE', tools.includes("{ id: 'players', label: 'ROSTERS & WIRE', nativeOnly: true }"));
ok('phone: ELIGIBLE PLAYERS carries copies and the pool top-up', /section === 'eligible' && <>[\s\S]{0,200}view="eligible"[\s\S]{0,200}<CopiesCard[\s\S]{0,120}<TopUpPoolCard/.test(tools));
ok('phone: MANAGER ROSTER RULES carries the position limits', /section === 'rosterrules' && <>[\s\S]{0,200}view="rules"[\s\S]{0,200}<RosterCapsCard leagueId=\{leagueId\} part="caps"/.test(tools));
ok('phone: team rules, taxi, IR and OUT are manager rules', tools.includes("{view === 'rules' && mode !== null && sport === 'nfl' && <SeatRulesCard") && tools.includes("{view === 'rules' && shape.taxi > 0") && tools.includes("{view === 'rules' && shape.ir > 0") && tools.includes("{view === 'rules' && shape.out > 0"));
ok('phone: filters, extra positions and devy are eligible players', tools.includes("{view === 'eligible' && <View style={{ marginTop: 8, borderWidth") && tools.includes("{view === 'eligible' && admin && (") && tools.includes("{view === 'eligible' && extraPos.includes('COLLEGE') && !collegeCal && <DevyModeCard"));
ok('phone: the stale "freezes the moment the room opens" note is gone', !tools.includes('freezes the moment the room opens'));
ok('phone: the WAIVERS sheet no longer holds the roster rules', !read('apps/mobile/src/ui/CommishSettings.tsx').includes("sec('ROSTER RULES')"));
ok('phone: copies left the draft room for ELIGIBLE PLAYERS', !read('apps/mobile/src/screens/Draft.tsx').includes('setLeagueCopies(') && read('apps/mobile/src/ui/RosterSettingsCards.tsx').includes('setLeagueCopies(leagueId, n)'));

const admin = read('src/screens/AdminPage.tsx'), dash = read('src/screens/CommishDash.tsx');
ok('web: three roster destinations on the rail', admin.includes("label: '🧩 ROSTER CONSTRUCTION'") && admin.includes("label: '🎟 ELIGIBLE PLAYERS'") && admin.includes("label: '📏 MANAGER ROSTER RULES'") && admin.includes("label: 'ROSTERS & WIRE'"));
ok('web: the panels are injected per destination', dash.includes('eligible: <LeagueSettings leagueId={l.league_id} view="eligible" />') && dash.includes('rosterrules: <LeagueSettings leagueId={l.league_id} view="rules" />'));
ok('web: ELIGIBLE PLAYERS carries copies and the top-up; ROSTERS & WIRE the tools', admin.includes("{tab === 'eligible' && l.provider === 'native' && <><CopiesPanel leagueId={l.league_id} /><TopUpPoolPanel leagueId={l.league_id} /></>}") && admin.includes("{tab === 'rosters' && l.provider === 'native' && <NativeRosterTools leagueId={l.league_id} />}"));
ok('web: size under construction, limits under manager rules', admin.includes('<RosterRulesEditor leagueId={l.league_id} part="size" />') && admin.includes('<RosterRulesEditor leagueId={l.league_id} part="caps" />'));
ok('web: team rules, taxi, IR and OUT are manager rules', dash.includes("{sport === 'nfl' && view === 'rules' && mode !== null && <SeatRulesPanel") && dash.includes("{view === 'rules' && shape.ir > 0") && dash.includes("{view === 'rules' && shape.taxi > 0"));
ok('web: copies left the draft room', !read('src/screens/NativeLeague.tsx').includes('setLeagueCopies('));

if (fails) { console.log(`\n${fails} COMMISH-ROSTER ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL COMMISH-ROSTER ASSERTIONS PASSED');
