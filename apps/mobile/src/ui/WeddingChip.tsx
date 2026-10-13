// 💍 THE WEDDING CHIP (v0.705.0, founder: "For shotgun wedding we need chips in
// matchup and my team for the impending wedding"; v0.706.2: "Chip should take
// you straight to the vows"). A plain chip wherever the week is read — the
// matchup board, the roster — while YOUR wedding is pending; a tap goes to the
// vows on My Team › Trades. Nothing for anyone outside the wedding, and no
// sheet in between.
import { useEffect, useState } from 'react';
import { shotgunState } from '@drip/core/data/liveApi';
import type { Wedding } from '@drip/core/data/shotgunWedding';
import { tap } from './feedback';
import { Chip } from './prims';

export function WeddingChip({ leagueId, onOpen }: { leagueId: string; onOpen: () => void }) {
  const [w, setW] = useState<Wedding | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => shotgunState(leagueId)
      .then((r) => {
        if (!live) return;
        const ws = r.ok && r.on !== false ? (r.weddings ?? []) : [];
        setW(ws.find((x) => x.status === 'pending' && x.my_seat != null) ?? null);
      })
      .catch(() => { if (live) setW(null); });
    void load();
    const id = setInterval(load, 60_000);
    return () => { live = false; clearInterval(id); };
  }, [leagueId]);
  if (!w) return null;
  return <Chip label={w.counter ? '💍 NEW VOWS' : '💍 THE VOWS'} on a11y="your shotgun wedding" onPress={() => { tap(); onOpen(); }} />;
}
