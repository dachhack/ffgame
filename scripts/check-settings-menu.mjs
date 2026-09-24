// Guard for THE GEAR IS A MENU (v0.487.0). Offline — check:parity.
//
// Founder: "the app settings menu. It's huge. Can we make a tiny pop-up when
// you hit the gear that allows you to pick categories then options?"
//
// The sheet opens on categories; each category's options show only when it is
// picked. These keep it that way — and keep every option reachable, because a
// menu that tidies a setting out of existence is worse than a long scroll.
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
const src = readFileSync(new URL('../apps/mobile/src/ui/SettingsModal.tsx', import.meta.url), 'utf8');

ok(/useState<Section \| null>\(null\)/.test(src), 'the sheet opens on the category menu, not on any options');
ok(/useEffect\(\(\) => \{ if \(visible\) setSection\(null\); \}, \[visible\]\)/.test(src), '…every time it opens');
for (const id of ['notifications', 'theme', 'cards', 'voice', 'rehearsal']) {
  ok(new RegExp(`\\{ id: '${id}'`).test(src) && new RegExp(`section === '${id}'`).test(src),
    `category "${id}" is listed AND opens its options`);
}
ok(/section === 'notifications' && <PushPrefs \/>/.test(src), 'notifications still renders the full push prefs');
ok(/section === 'voice' && <VoicePicker \/>/.test(src), 'the voice picker is still reachable');
ok(/THEME_OPTS\.map/.test(src) && /CARD_SIZES\.map/.test(src) && /SKIN_OPTS\.map/.test(src),
  'theme, card size and card deck pickers all still exist');
ok(/isAdmin \? \[\{ id: 'rehearsal'/.test(src) && /section === 'rehearsal' && isAdmin/.test(src),
  'rehearsal tools stay admin-only');
ok(/‹ ALL SETTINGS/.test(src), 'every options page has a way back to the menu');
for (const a of ['Admin', "What's new", 'Sign out']) {
  ok(src.includes(`label="${a}"`), `the "${a}" action is on the menu`);
}
// v0.502.0: the demo board left with the 2025 bake it replayed.
ok(!src.includes('label="Demo board"'), 'the retired "Demo board" action is gone');

console.log(fails ? `\n${fails} SETTINGS-MENU ASSERTION(S) FAILED` : '\nALL SETTINGS-MENU ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
