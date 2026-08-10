// NFL team brand colors — end-zone paint + possession accents for the field
// visuals. `c` is the primary field/end-zone color, `t` a contrasting text
// color from the same brand palette. Colors are facts (not marks), so this map
// stays active even in mark-free mode; the logos are what mark-free suppresses.

interface TeamColor { c: string; t: string }

const COLORS: Record<string, TeamColor> = {
  ARI: { c: '#97233F', t: '#FFB612' },
  ATL: { c: '#A71930', t: '#A5ACAF' },
  BAL: { c: '#241773', t: '#9E7C0C' },
  BUF: { c: '#00338D', t: '#C60C30' },
  CAR: { c: '#0085CA', t: '#101820' },
  CHI: { c: '#0B162A', t: '#C83803' },
  CIN: { c: '#FB4F14', t: '#101820' },
  CLE: { c: '#311D00', t: '#FF3C00' },
  DAL: { c: '#003594', t: '#869397' },
  DEN: { c: '#FB4F14', t: '#002244' },
  DET: { c: '#0076B6', t: '#B0B7BC' },
  GB:  { c: '#203731', t: '#FFB612' },
  HOU: { c: '#03202F', t: '#A71930' },
  IND: { c: '#002C5F', t: '#A2AAAD' },
  JAX: { c: '#006778', t: '#D7A22A' },
  KC:  { c: '#E31837', t: '#FFB81C' },
  LV:  { c: '#101820', t: '#A5ACAF' },
  LAC: { c: '#0080C6', t: '#FFC20E' },
  LAR: { c: '#003594', t: '#FFA300' },
  MIA: { c: '#008E97', t: '#FC4C02' },
  MIN: { c: '#4F2683', t: '#FFC62F' },
  NE:  { c: '#002244', t: '#C60C30' },
  NO:  { c: '#101820', t: '#D3BC8D' },
  NYG: { c: '#0B2265', t: '#A5ACAF' },
  NYJ: { c: '#125740', t: '#FFFFFF' },
  PHI: { c: '#004C54', t: '#A5ACAF' },
  PIT: { c: '#101820', t: '#FFB612' },
  SF:  { c: '#AA0000', t: '#B3995D' },
  SEA: { c: '#002244', t: '#69BE28' },
  TB:  { c: '#D50A0A', t: '#FF7900' },
  TEN: { c: '#0C2340', t: '#4B92DB' },
  WAS: { c: '#5A1414', t: '#FFB612' },
};

// Feed abbreviations vary by source (ESPN play text says ARZ, nflverse says LA…).
const ALIAS: Record<string, string> = {
  ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU', JAC: 'JAX',
  LA: 'LAR', OAK: 'LV', SD: 'LAC', SL: 'LAR', STL: 'LAR', WSH: 'WAS',
};

export function teamColor(abbr?: string | null): TeamColor | null {
  if (!abbr) return null;
  const key = abbr.toUpperCase();
  return COLORS[ALIAS[key] ?? key] ?? null;
}
