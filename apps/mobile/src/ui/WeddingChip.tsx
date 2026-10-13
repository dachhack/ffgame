// 💍 THE WEDDING CHIP (v0.705.0, founder: "For shotgun wedding we need chips in
// matchup and my team for the impending wedding"). A small chip wherever the
// week is read — the matchup board, the roster — while a wedding is pending:
// yours first, else the league's. Its sheet says where it stands, who sends
// whom, and the new vows on the table; TRADES ▸ opens the card that acts on it,
// where the host can take you there. Renders nothing otherwise.
import { useEffect, useState } from 'react';
import { shotgunState } from '@drip/core/data/liveApi';
import { weddingStatusLine, weddingSends, weddingCounterLine, type Wedding } from '@drip/core/data/shotgunWedding';
import { InfoChip } from './InfoChip';

export function WeddingChip({ leagueId, onOpen }: { leagueId: string; onOpen?: () => void }) {
  const [w, setW] = useState<Wedding | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => shotgunState(leagueId)
      .then((r) => {
        if (!live) return;
        const ws = r.ok && r.on !== false ? (r.weddings ?? []) : [];
        const pending = ws.filter((x) => x.status === 'pending');
        setW(pending.find((x) => x.my_seat != null) ?? pending[0] ?? null);
      })
      .catch(() => { if (live) setW(null); });
    void load();
    const id = setInterval(load, 60_000);
    return () => { live = false; clearInterval(id); };
  }, [leagueId]);
  if (!w) return null;
  const mine = w.my_seat != null;
  const counter = weddingCounterLine(w);
  return (
    <InfoChip label={mine ? '💍 YOUR WEDDING' : '💍 WEDDING'} title={`${w.home.team} ⇄ ${w.away.team}`}
      actions={onOpen ? [{ label: 'TRADES ▸', onPress: onOpen }] : undefined}>
      {`${weddingStatusLine(w)}\n\n${weddingSends(w.home.team, w.home.gives)}.\n${weddingSends(w.away.team, w.away.gives)}.${counter ? `\n\n${counter}` : ''}`}
    </InfoChip>
  );
}
