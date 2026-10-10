// MY TEAM'S RULE in the lists that offer players (v0.659.0, 0460) — the web
// twin's note (src/app/seatRule.tsx): hide who the commissioner's rule won't
// let this team take, with "show everyone" to browse.
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { seatPlayerRules } from '@drip/core/data/liveApi';
import { seatRuleAllows, type SeatRule } from '@drip/core/data/seatRules';
import { useTheme } from '../theme.native';
import { tap } from './feedback';
import { Mono } from './prims';

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

export const seatRuleShows = (rule: SeatRule | null, showAll: boolean, p: { slug: string; pos: string; team: string }, exp: number | null | undefined) =>
  !rule || showAll || seatRuleAllows(rule, { slug: p.slug, pos: p.pos, team: p.team, exp });

export function SeatRuleBanner({ rule, showAll, onToggle }: { rule: SeatRule | null; showAll: boolean; onToggle: () => void }) {
  const t = useTheme();
  if (!rule) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 }}>
      <Mono size={9} tone="dim" style={{ flex: 1 }}>{`⚖️ Commissioner’s rule: your team may only take ${rule.text ?? ''}`}</Mono>
      <Pressable hitSlop={8} onPress={() => { tap(); onToggle(); }}>
        <Mono size={9} tone="you" weight="700">{showAll ? 'HIDE REST' : 'SHOW ALL'}</Mono>
      </Pressable>
    </View>
  );
}
