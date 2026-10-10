// WHO EACH TEAM MAY TAKE (v0.659.0, 0460) — the client's copy of the seat
// rule. The server (seat_rule_error) is the authority; this is what lets the
// draft room and the waiver lists grey out a player BEFORE a manager taps him,
// and what the commissioner's editor calls a rule. Kept in step with the SQL
// by check:seatrules.
import { NFL_DIVISIONS } from './kdst';

export interface SeatRule {
  roster_id: number;
  team?: string;
  positions: string[];
  teams: string[];
  teams_label?: string | null;
  min_exp?: number | null;
  max_exp?: number | null;
  /** The server's own words ("TE · NFC · rookies"). */
  text?: string | null;
}

/** One spelling per NFL team (the SQL's _nfl_team_norm). */
export const normTeam = (t: string | null | undefined): string => {
  const u = (t ?? '').trim().toUpperCase();
  return u === 'LAR' ? 'LA' : u === 'WSH' ? 'WAS' : u === 'JAC' ? 'JAX' : u === 'LVR' ? 'LV' : u;
};

/** May this seat take this player? Mirrors seat_rule_error: positions bind
 *  everyone; team and experience bind NFL players only, and refuse an
 *  unknown team or tenure. `exp: undefined` means THIS SCREEN didn't load
 *  tenure (the lists read it only on demand): the experience part is then
 *  not judged here, and the server still refuses a pick that breaks it. */
export function seatRuleAllows(rule: SeatRule | null | undefined, p: { slug?: string; pos?: string | null; team?: string | null; exp?: number | null }): boolean {
  if (!rule) return true;
  if (rule.positions.length && !rule.positions.includes((p.pos ?? '').toUpperCase())) return false;
  const college = !!p.slug && /^c-[0-9]+$/.test(p.slug);
  if (college) return true;
  if (rule.teams.length) {
    const t = normTeam(p.team);
    if (!t || !rule.teams.map(normTeam).includes(t)) return false;
  }
  if (p.exp === undefined) return true;
  if (rule.min_exp != null && (p.exp == null || p.exp < rule.min_exp)) return false;
  if (rule.max_exp != null && (p.exp == null || p.exp > rule.max_exp)) return false;
  return true;
}

/** "NFC", "NFC North", "AFC West + CHI"… — what a set of teams IS, when it is
 *  a conference or a division; else null (the codes speak for themselves). */
export function teamsLabel(teams: string[]): string | null {
  const set = new Set(teams.map(normTeam));
  if (!set.size) return null;
  for (const conf of ['AFC', 'NFC'] as const) {
    const all = NFL_DIVISIONS.filter((d) => d.conf === conf).flatMap((d) => d.teams.map((x) => x.toUpperCase()));
    if (all.length === set.size && all.every((x) => set.has(x))) return conf;
  }
  for (const d of NFL_DIVISIONS) {
    const all = d.teams.map((x) => x.toUpperCase());
    if (all.length === set.size && all.every((x) => set.has(x))) return `${d.conf} ${d.div}`;
  }
  return null;
}

/** The rule in a few words, the SQL's _seat_rule_text. */
export function seatRuleText(rule: Pick<SeatRule, 'positions' | 'teams' | 'teams_label' | 'min_exp' | 'max_exp'>): string {
  const parts: string[] = [];
  if (rule.positions.length) parts.push(rule.positions.join('/'));
  if (rule.teams.length) parts.push(rule.teams_label || (rule.teams.length <= 4 ? rule.teams.join('/') : `${rule.teams.length} NFL teams`));
  const mn = rule.min_exp ?? null; const mx = rule.max_exp ?? null;
  if (mn === 0 && mx === 0) parts.push('rookies');
  else if (mn != null && mx != null) parts.push(`${mn}–${mx} yrs`);
  else if (mn != null) parts.push(`${mn}+ yrs`);
  else if (mx != null) parts.push(`up to ${mx} yrs`);
  return parts.join(' · ');
}

/** The positions a commissioner can pick from. IDP and the rest only when the
 *  league plays them. */
export const RULE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
