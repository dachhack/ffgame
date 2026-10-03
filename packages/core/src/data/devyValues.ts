// DEVY VALUES (v0.601.0, 0417) — the gear's list for any signed-in player.
// Founder: "put regularly updated devy base value in the options chip so
// players in any league can see fresh devy values for 1QB and SF" … "a
// refreshed on date as well".
//
// value_1qb is the devy market's price per share; value_sf is the same curve on
// StatHead's superflex rank. Both carry the underclass discount (0413).
import { collegeClassLabel } from './college';

export interface DevyValueRow {
  espn_id: string; name: string; pos: string; school: string | null; class_year: number | null;
  rank_1qb: number; rank_sf: number | null; value_1qb: number; value_sf: number | null; underclass: boolean;
}
export interface DevyValuesPage { as_of: string | null; total: number; rows: DevyValueRow[] }

/** Where the numbers come from: StatHead's site (Prospects → Devy). */
export const STATHEAD_DEVY_URL = 'https://stathead.app';

/** "drip-devy-values-sf-2026-10-03.csv" (or …-qb-… for one position). */
export function devyCsvName(sort: 'sf' | '1qb', pos: string | null | undefined, asOf: string | null | undefined): string {
  const day = asOf && !Number.isNaN(Date.parse(asOf)) ? new Date(asOf).toISOString().slice(0, 10) : 'latest';
  return `drip-devy-values-${sort}${pos && pos !== 'ALL' ? `-${pos.toLowerCase()}` : ''}-${day}.csv`;
}

export const DEVY_VALUE_POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE'] as const;

/** "Refreshed Oct 3, 2026" — when Drip last loaded StatHead's board. */
export function refreshedLabel(asOf: string | null | undefined, tz?: string): string {
  if (!asOf) return 'Not loaded yet';
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return 'Not loaded yet';
  return `Refreshed ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(tz ? { timeZone: tz } : {}) })}`;
}

/** The row's second line: position, school, class, the discount. */
export function devyValueSub(r: DevyValueRow): string {
  return [r.pos, r.school, r.class_year ? collegeClassLabel(r.class_year) : null, r.underclass ? 'underclass discount' : null]
    .filter(Boolean).join(' · ');
}

/** Two decimals, or a dash when there's no number. */
export const fmtValue = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2));
