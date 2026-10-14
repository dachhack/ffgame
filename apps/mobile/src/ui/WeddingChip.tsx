// 💍 THE WEDDING CHIP (v0.705.0, founder: "For shotgun wedding we need chips in
// matchup and my team for the impending wedding"; v0.706.2: "Chip should take
// you straight to the vows"). A plain chip wherever the week is read — the
// matchup board, the roster — while YOUR wedding is pending; a tap goes to the
// vows on My Team › Trades. Nothing for anyone outside the wedding, and no
// sheet in between.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { shotgunState } from '@drip/core/data/liveApi';
import { markWeddingsSeen, onWeddingSeen, weddingCongrats, weddingNews, type Wedding } from '@drip/core/data/shotgunWedding';
import { useTheme, MONO, alpha } from '../theme.native';
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

// 🎉 THE CONGRATULATIONS BANNER (v0.707.5, founder: "after your wedding goes
// through, let's have a banner squeeze in under the league name and settings
// row … click the banner takes you to trades … goes away once clicked or you
// visit the trades section"). Yours, gone through, not yet seen on this
// device (core's weddingNews); a tap marks it seen and opens My Team › Trades,
// and the Trades tab marks it seen on a visit.
export function WeddingBanner({ leagueId, onOpen }: { leagueId: string; onOpen: () => void }) {
  const t = useTheme();
  const [ws, setWs] = useState<Wedding[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => shotgunState(leagueId)
      .then((r) => { if (live) setWs(r.ok && r.on !== false ? (r.weddings ?? []) : []); })
      .catch(() => {});
    void load();
    const id = setInterval(load, 5 * 60_000);
    const off = onWeddingSeen(() => bump((n) => n + 1));
    return () => { live = false; clearInterval(id); off(); };
  }, [leagueId]);
  const w = weddingNews(ws);
  if (!w) return null;
  const c = weddingCongrats(w);
  return (
    <Pressable onPress={() => { tap(); markWeddingsSeen([w.id]); onOpen(); }}
      accessibilityRole="button" accessibilityLabel={`${c.title} ${c.sub}`}
      style={({ pressed }) => ({
        marginHorizontal: 14, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, backgroundColor: alpha(t.you, pressed ? 22 : 12),
      })}>
      <Text numberOfLines={2} style={{ fontSize: 13.5, fontWeight: '700', color: t.text }}>{c.title}</Text>
      <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 0.3, color: t.you, marginTop: 2 }}>{c.sub}</Text>
    </Pressable>
  );
}
