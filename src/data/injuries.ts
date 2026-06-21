// Weekly NFL injury-report designations (Out/Doubtful/Questionable) and genuine
// season-ending IR for league-rostered players, keyed by player slug.
// REAL 2025 data — generated from Stathead get_injuries + get_rosters via
// scripts/genInjuries.mjs. Do not hand-edit; re-run the generator instead.
export type InjuryStatus = 'O' | 'D' | 'Q' | 'IR';

// Per-week game-status designations (the official Out/Doubtful/Questionable report).
export const INJURIES: Record<number, Record<string, 'O' | 'D' | 'Q'>> = {
  1: { 'christian-mccaffrey': 'Q', 'darnell-mooney': 'Q', 'isaiah-likely': 'O', 'jayden-reed': 'Q' },
  2: { 'brock-bowers': 'Q', 'brock-purdy': 'O', 'dallas-goedert': 'O', 'isaiah-likely': 'O', 'jauan-jennings': 'Q', 'wandale-robinson': 'Q', 'xavier-worthy': 'O' },
  3: { 'brock-purdy': 'Q', 'dandre-swift': 'Q', 'emeka-egbuka': 'Q', 'isaiah-likely': 'O', 'jauan-jennings': 'Q', 'jaxon-smith-njigba': 'Q', 'jayden-daniels': 'O', 'jayden-reed': 'O', 'jaylen-waddle': 'Q', 'jj-mccarthy': 'O', 'justin-fields': 'O', 'tyler-warren': 'Q', 'xavier-worthy': 'Q', 'zach-charbonnet': 'D' },
  4: { 'alec-pierce': 'O', 'baker-mayfield': 'Q', 'ceedee-lamb': 'O', 'chuba-hubbard': 'Q', 'colston-loveland': 'Q', 'dandre-swift': 'Q', 'davante-adams': 'Q', 'isaiah-likely': 'Q', 'jacory-croskey-merritt': 'Q', 'jauan-jennings': 'Q', 'jayden-daniels': 'O', 'jaylen-warren': 'Q', 'jj-mccarthy': 'O', 'mike-evans': 'O', 'ricky-pearsall': 'Q', 'terry-mclaurin': 'O', 'tyrone-tracy': 'O', 'zach-charbonnet': 'Q' },
  5: { 'alec-pierce': 'O', 'brock-bowers': 'Q', 'brock-purdy': 'O', 'bucky-irving': 'O', 'ceedee-lamb': 'O', 'chuba-hubbard': 'O', 'jauan-jennings': 'O', 'jj-mccarthy': 'O', 'juwan-johnson': 'Q', 'lamar-jackson': 'O', 'mike-evans': 'O', 'ricky-pearsall': 'O', 'taysom-hill': 'Q', 'tyrone-tracy': 'D' },
  6: { 'alvin-kamara': 'Q', 'brock-bowers': 'O', 'brock-purdy': 'O', 'bucky-irving': 'O', 'ceedee-lamb': 'O', 'christian-watson': 'O', 'chuba-hubbard': 'O', 'colston-loveland': 'Q', 'dalton-kincaid': 'Q', 'deebo-samuel': 'Q', 'jamarr-chase': 'Q', 'jauan-jennings': 'Q', 'kyler-murray': 'Q', 'mike-evans': 'O', 'quentin-johnston': 'Q', 'ricky-pearsall': 'O', 'terry-mclaurin': 'O', 'zay-flowers': 'Q' },
  7: { 'brock-bowers': 'D', 'brock-purdy': 'O', 'bucky-irving': 'O', 'christian-watson': 'O', 'dandre-swift': 'Q', 'darnell-mooney': 'Q', 'david-njoku': 'O', 'deebo-samuel': 'O', 'emeka-egbuka': 'Q', 'garrett-wilson': 'D', 'jakobi-meyers': 'Q', 'jj-mccarthy': 'Q', 'josh-downs': 'O', 'josh-jacobs': 'Q', 'kyler-murray': 'Q', 'mike-evans': 'Q', 'puka-nacua': 'O', 'ricky-pearsall': 'O', 'stefon-diggs': 'Q', 'terry-mclaurin': 'O', 'zach-ertz': 'Q' },
  8: { 'aaron-jones': 'Q', 'aj-brown': 'O', 'breece-hall': 'Q', 'brock-purdy': 'O', 'bryce-young': 'D', 'bucky-irving': 'O', 'cole-kmet': 'O', 'dalton-kincaid': 'Q', 'dandre-swift': 'Q', 'david-njoku': 'Q', 'drake-london': 'Q', 'garrett-wilson': 'O', 'jayden-daniels': 'O', 'jj-mccarthy': 'Q', 'lamar-jackson': 'O', 'michael-penix': 'Q', 'nico-collins': 'O', 'ricky-pearsall': 'O', 'shedeur-sanders': 'Q' },
  9: { 'alvin-kamara': 'Q', 'brock-purdy': 'Q', 'cooper-kupp': 'Q', 'dalton-schultz': 'Q', 'dandre-swift': 'O', 'isiah-pacheco': 'O', 'kyler-murray': 'Q', 'rashid-shaheed': 'Q', 'rhamondre-stevenson': 'O', 'ricky-pearsall': 'O', 'terry-mclaurin': 'O', 'travis-hunter': 'O' },
  10: { 'aaron-jones': 'Q', 'aj-barner': 'Q', 'alvin-kamara': 'Q', 'brian-thomas': 'O', 'bucky-irving': 'O', 'cj-stroud': 'O', 'cooper-kupp': 'Q', 'dandre-swift': 'Q', 'garrett-wilson': 'Q', 'harold-fannin': 'Q', 'jayden-daniels': 'O', 'ollie-gordon': 'Q', 'rhamondre-stevenson': 'Q', 'ricky-pearsall': 'O', 'terry-mclaurin': 'O' },
  11: { 'brenton-strange': 'O', 'brian-thomas': 'Q', 'bucky-irving': 'O', 'cj-stroud': 'O', 'dalton-kincaid': 'O', 'davante-adams': 'Q', 'drake-london': 'Q', 'garrett-wilson': 'O', 'isiah-pacheco': 'O', 'jaxson-dart': 'O', 'jayden-daniels': 'O', 'jk-dobbins': 'O', 'joe-burrow': 'O', 'marvin-harrison': 'O', 'matthew-golden': 'Q', 'quentin-johnston': 'Q', 'rhamondre-stevenson': 'O', 'sam-laporta': 'O', 'terry-mclaurin': 'O' },
  12: { 'aaron-rodgers': 'Q', 'alvin-kamara': 'Q', 'brenton-strange': 'Q', 'brian-thomas': 'O', 'bucky-irving': 'O', 'cj-stroud': 'O', 'dalton-kincaid': 'O', 'dillon-gabriel': 'O', 'drake-london': 'O', 'isiah-pacheco': 'O', 'jaxson-dart': 'O', 'jayden-reed': 'O', 'joe-burrow': 'O', 'josh-jacobs': 'Q', 'kenneth-walker': 'Q', 'marvin-harrison': 'O', 'matthew-golden': 'Q', 'trey-benson': 'O', 'xavier-worthy': 'Q' },
  13: { 'alvin-kamara': 'O', 'baker-mayfield': 'Q', 'bucky-irving': 'Q', 'chig-okonkwo': 'Q', 'chris-olave': 'Q', 'drake-london': 'O', 'jayden-daniels': 'O', 'jayden-reed': 'O', 'jj-mccarthy': 'O', 'marvin-harrison': 'Q', 'matthew-golden': 'Q', 'omarion-hampton': 'O', 'tee-higgins': 'O', 'trey-benson': 'O', 'tyler-warren': 'Q' },
  14: { 'alvin-kamara': 'O', 'amon-ra-st-brown': 'Q', 'chris-olave': 'Q', 'deshaun-watson': 'O', 'drake-london': 'O', 'dylan-sampson': 'Q', 'jayden-reed': 'Q', 'justin-fields': 'O', 'justin-herbert': 'Q', 'marvin-harrison': 'O', 'matthew-golden': 'Q', 'mike-evans': 'O', 'omarion-hampton': 'Q', 'trey-benson': 'O' },
};

// Genuine season-ending IR, week-aware: slug -> the first week the player was on
// IR. It applies from that week onward (earlier weeks fall back to the weekly
// report above), so a player who landed on IR midseason isn't flagged for the
// weeks he actually played.
export const IR_FROM: Record<string, number> = { 'brandon-aiyuk': 1, 'deshaun-watson': 1, 'george-kittle': 14, 'james-conner': 4, 'jk-dobbins': 11, 'justin-fields': 12, 'kyler-murray': 6 };

// IR (from its start week) takes precedence; else the week's designation; else null.
export function injuryFor(week: number, slug: string): InjuryStatus | null {
  const ir = IR_FROM[slug];
  if (ir != null && week >= ir) return 'IR';
  return INJURIES[week]?.[slug] ?? null;
}
