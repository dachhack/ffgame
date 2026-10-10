// MY TEAM'S RULE, in the lists that offer players (v0.659.0, 0460). The
// commissioner can limit who a team may draft and pick up; the server refuses
// anyone else, so the draft room and the free-agent list hide them by default
// rather than offer a tap that can only be refused. "Show everyone" brings
// them back for browsing.
import { useEffect, useState } from 'react';
import { seatPlayerRules } from '@drip/core/data/liveApi';
import { seatRuleAllows, type SeatRule } from '@drip/core/data/seatRules';

export function useMySeatRule(leagueId: string | null | undefined, rosterId: number | null | undefined): SeatRule | null {
  const [rule, setRule] = useState<SeatRule | null>(null);
  useEffect(() => {
    if (!leagueId || rosterId == null) { setRule(null); return; }
    let alive = true;
    seatPlayerRules(leagueId)
      .then((r) => { if (alive) setRule(r.ok ? (r.rules ?? []).find((x) => x.roster_id === rosterId) ?? null : null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [leagueId, rosterId]);
  return rule;
}

/** The list filter: everyone when there is no rule or the reader asked for all. */
export const seatRuleShows = (rule: SeatRule | null, showAll: boolean, p: { slug: string; pos: string; team: string }, exp: number | null | undefined) =>
  !rule || showAll || seatRuleAllows(rule, { slug: p.slug, pos: p.pos, team: p.team, exp });

export function SeatRuleBanner({ rule, showAll, onToggle }: { rule: SeatRule | null; showAll: boolean; onToggle: () => void }) {
  if (!rule) return null;
  return (
    <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, marginBottom: 8,
      border: '1px solid color-mix(in srgb, var(--you) 45%, var(--bd))', borderRadius: 6, padding: '6px 10px', color: 'var(--dim)' }}>
      <span>⚖️ Commissioner’s rule: your team may only take <b style={{ color: 'var(--you)' }}>{rule.text}</b></span>
      <span style={{ flex: 1 }} />
      <button onClick={onToggle} className="mono" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--you)', fontSize: 11 }}>
        {showAll ? 'hide the rest' : 'show everyone'}
      </button>
    </div>
  );
}
