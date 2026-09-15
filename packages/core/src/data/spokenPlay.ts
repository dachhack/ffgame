// 🔊 THE PLAY, SAID OUT LOUD (v0.389.0).
//
// Founder, over the app's All fields sheet: "Let's also have the option to
// expand the play by play for each game and have it read off to you — catch
// up or live." The feed's play text is the NFL gamebook's shorthand, written
// to be scanned, not heard: "(Shotgun) J.Brissett pass short right to
// Mi.Wilson to ARZ 44 for 9 yards (D.Jackson)." Read literally, a voice says
// "jay dot brissett … to arz forty-four … dee dot jackson". This turns one
// play into a sentence a voice can carry — and it is the ONE place that
// judgement lives, so the app's speaker and the web's speaker say the same
// thing. `PlayReader` (playReader.ts) decides WHICH plays to say and when.
import type { GamePlay } from './gameFeed';

/** Who a gamebook name token is — "J.Brissett" → "Jacoby Brissett" — or null
 *  when the host can't say (then the last name alone is spoken). Built per
 *  game from the box score by engine/gameNames.gameNameResolver. */
export type NameOf = (abbr: string) => string | null;
// A gamebook name: one-to-three-letter first-name prefix, a period, the last
// name (which may itself carry "St. " — "A.St. Brown"). No space after the
// period, which is exactly what a voice trips on.
const NAME_RE = /\b([A-Z][a-z]{0,2})\.((?:St\. )?[A-Z][A-Za-z'’-]+)/g;

/** City and nickname per club, keyed by the abbreviations the feed and the
 *  gamebook use (ESPN's ARZ/BLT/CLV/HST/WSH spellings included). */
const CLUBS: Record<string, [city: string, nick: string]> = {
  ARI: ['Arizona', 'Cardinals'], ARZ: ['Arizona', 'Cardinals'], ATL: ['Atlanta', 'Falcons'],
  BAL: ['Baltimore', 'Ravens'], BLT: ['Baltimore', 'Ravens'], BUF: ['Buffalo', 'Bills'],
  CAR: ['Carolina', 'Panthers'], CHI: ['Chicago', 'Bears'], CIN: ['Cincinnati', 'Bengals'],
  CLE: ['Cleveland', 'Browns'], CLV: ['Cleveland', 'Browns'], DAL: ['Dallas', 'Cowboys'],
  DEN: ['Denver', 'Broncos'], DET: ['Detroit', 'Lions'], GB: ['Green Bay', 'Packers'],
  HOU: ['Houston', 'Texans'], HST: ['Houston', 'Texans'], IND: ['Indianapolis', 'Colts'],
  JAX: ['Jacksonville', 'Jaguars'], JAC: ['Jacksonville', 'Jaguars'], KC: ['Kansas City', 'Chiefs'],
  LV: ['Las Vegas', 'Raiders'], LAC: ['Los Angeles', 'Chargers'], LA: ['Los Angeles', 'Rams'],
  LAR: ['Los Angeles', 'Rams'], MIA: ['Miami', 'Dolphins'], MIN: ['Minnesota', 'Vikings'],
  NE: ['New England', 'Patriots'], NO: ['New Orleans', 'Saints'], NYG: ['New York', 'Giants'],
  NYJ: ['New York', 'Jets'], PHI: ['Philadelphia', 'Eagles'], PIT: ['Pittsburgh', 'Steelers'],
  SF: ['San Francisco', '49ers'], SEA: ['Seattle', 'Seahawks'], TB: ['Tampa Bay', 'Buccaneers'],
  TEN: ['Tennessee', 'Titans'], WAS: ['Washington', 'Commanders'], WSH: ['Washington', 'Commanders'],
};
export const clubCity = (abbr: string): string => CLUBS[abbr.toUpperCase()]?.[0] ?? abbr;
export const clubNick = (abbr: string): string => CLUBS[abbr.toUpperCase()]?.[1] ?? abbr;
const ABBR_RE = Object.keys(CLUBS).sort((a, b) => b.length - a.length).join('|');

const ORD = ['', 'First', 'Second', 'Third', 'Fourth'];

/** "First and 10", "Third and goal" — null on a down-less play (kickoff, PAT). */
export function spokenDown(p: Pick<GamePlay, 'dn' | 'dist' | 'yl'>): string | null {
  if (!(p.dn > 0)) return null;
  const goal = p.dist >= p.yl;
  return `${ORD[p.dn] ?? `${p.dn}th`} and ${goal ? 'goal' : p.dist}`;
}

/** The gamebook line as a spoken sentence: formation notes and clock stamps
 *  dropped, initials spaced ("J. Brissett", "Mi. Wilson"), club abbreviations
 *  before a yard line read as cities, the trailing parenthetical read as the
 *  tackle (or, on an incompletion, the coverage), penalties read plainly. */
export function spokenText(txt: string, ty?: string, nameOf?: NameOf): string {
  let s = String(txt ?? '').trim();
  // "(Shotgun)", "(No Huddle, Shotgun)", "(5:33) (Shotgun)" — leading notes.
  s = s.replace(/^(?:\(\s*[^()]*\)\s*)+/, '');
  // "[T.Tuipulotu]" — the gamebook's pressure/hurry note. Not worth a breath.
  s = s.replace(/\s*\[[^\]]*\]/g, '');
  // A penalty rides the same line after the play ("… (D.Phillips).PENALTY on
  // …"); split it off so the play's own tail can be read first.
  const penAt = s.search(/\.?\s*PENALTY on /);
  let pen = '';
  if (penAt >= 0) { pen = s.slice(penAt).replace(/^\.?\s*/, ''); s = s.slice(0, penAt); }
  // The trailing parenthetical is who made the play on defense.
  const tail = s.match(/\(([^()]*)\)\s*\.?\s*$/);
  if (tail) {
    const who = tail[1].split(/;/).map((x) => x.trim()).filter(Boolean);
    const verb = /Incompletion/i.test(ty ?? '') || /incomplete/i.test(s) ? 'broken up by' : 'tackled by';
    const names = who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}` : who[0];
    s = s.slice(0, tail.index).replace(/[.\s]+$/, '') + (names ? `, ${verb} ${names}.` : '.');
  }
  // Any parenthetical left mid-sentence ("(Shotgun)" after a clock) goes.
  s = s.replace(/\s*\([^()]*\)/g, '');
  // Penalty: "PENALTY on ARZ-H.Froholdt, Offensive Holding, 10 yards, enforced at JAX 39 - No Play."
  if (pen) {
    pen = pen.replace(/^PENALTY on ([A-Z]{2,3})-/, (_m, c: string) => `Penalty on ${clubCity(c)}, `)
      .replace(/,\s*enforced at [A-Z]{2,3} \d+/g, '')
      .replace(/\s*-\s*No Play\.?/g, ', no play.');
    s = `${s.replace(/[.\s]+$/, '')}. ${pen}`;
  }
  // Club abbreviation before a yard line or as a possessive: "to ARZ 44" → "to the Arizona 44".
  s = s.replace(new RegExp(`\\b(to|at|from) (${ABBR_RE}) (\\d{1,2})\\b`, 'g'), (_m, prep: string, c: string, yd: string) => `${prep} the ${clubCity(c)} ${yd}`);
  s = s.replace(new RegExp(`\\b(${ABBR_RE})-(?=[A-Z][a-z]*\\.)`, 'g'), (_m, c: string) => `${clubCity(c)}'s `);
  // …and EVERY other standalone club code reads as its city (v0.390.1,
  // founder: "It says DEN for Denver"): "to KC end zone", "Timeout #1 by
  // DEN", "DEN challenged". Upper-case whole tokens only, so "No Play" and
  // "No Good" (the Saints are "NO") are untouched. Runs before the name
  // pass, which only ever sees mixed-case tokens.
  s = s.replace(new RegExp(`(^|[^A-Za-z.])(${ABBR_RE})(?![A-Za-z])`, 'g'), (_m, pre: string, c: string) => `${pre}${clubCity(c)}`);
  // NAMES (v0.389.1). "J.Brissett" used to become "J. Brissett", and every
  // engine treats that period as a full stop — founder: "the pauses after the
  // first initials are a bit too much." Now: the FULL name when the game's
  // box score can say who it is ("Jacoby Brissett"), else the last name the
  // way a broadcast says it ("Brissett") — and the gamebook's disambiguating
  // prefix survives only where it has to: two Wilsons on one side read
  // "Michael Wilson" and "Mack Wilson" when known, "Mi Wilson" / "Ma Wilson"
  // (no period, no pause) when not.
  s = s.replace(NAME_RE, (whole, first: string, last: string) => {
    const full = nameOf?.(whole);
    if (full) return full;
    return first.length > 1 ? `${first} ${last}` : last;
  });
  // Gamebook shorthand a voice trips on.
  s = s.replace(/\bpushed ob\b/g, 'pushed out of bounds').replace(/\bran ob\b/g, 'ran out of bounds').replace(/\bob at\b/g, 'out of bounds at')
    .replace(/\b(\d+)\s*yd\b/g, '$1 yard').replace(/\bTD\b/g, 'touchdown').replace(/\bFG\b/g, 'field goal')
    .replace(/\bis GOOD\b/g, 'is good').replace(/\bis No Good\b/gi, 'is no good').replace(/\bTOUCHDOWN\b/g, 'touchdown')
    .replace(/\bINTERCEPTED\b/g, 'intercepted').replace(/\bFUMBLES\b/g, 'fumbles').replace(/\bRECOVERED\b/g, 'recovered')
    .replace(/\bMUFFS\b/g, 'muffs').replace(/\bREVERSED\b/g, 'reversed').replace(/\bNULLIFIED\b/g, 'nullified')
    .replace(/\s{2,}/g, ' ').trim();
  if (s && !/[.!?]$/.test(s)) s += '.';
  return s;
}

/** The whole spoken play: situation, the sentence, and the score when it
 *  moved — "Third and goal. K. Walker right end to the Denver 5 for 3 yards,
 *  tackled by M. Roach and P. Surtain." / "… Touchdown. Chiefs 7, Broncos 0." */
export function spokenPlay(p: GamePlay, ctx: { home: string; away: string; prev?: GamePlay | null; nameOf?: NameOf }): string {
  const parts: string[] = [];
  const dd = spokenDown(p);
  if (dd) parts.push(`${dd}.`);
  parts.push(spokenText(p.txt, p.ty, ctx.nameOf));
  const scored = p.sc === 1 || (ctx.prev != null && (ctx.prev.hs !== p.hs || ctx.prev.as !== p.as));
  if (scored) parts.push(`${clubNick(ctx.away)} ${p.as}, ${clubNick(ctx.home)} ${p.hs}.`);
  return parts.join(' ');
}

/** The scoreline, for a catch-up opener or a final: "Chiefs 24, Broncos 17." */
export function spokenScore(p: Pick<GamePlay, 'hs' | 'as'>, ctx: { home: string; away: string }): string {
  return `${clubNick(ctx.away)} ${p.as}, ${clubNick(ctx.home)} ${p.hs}.`;
}
