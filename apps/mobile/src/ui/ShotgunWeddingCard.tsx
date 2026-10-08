// 💍 SHOTGUN WEDDING in the app (v0.653.0) — docs/shotgun-wedding.md. Twin of
// the web's src/screens/ShotgunWeddingCard.tsx; the words come from core
// (data/shotgunWedding) so the two never disagree.
//
// Renders nothing unless the league has the mode on and a week with
// weddings. Your own wedding first, with CALL IT OFF (the winner only),
// PROPOSE NEW VOWS (either team, one to three players each way) and SAY YES
// to the other side's vows; everyone else's one line each.
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import {
  shotgunState, shotgunDecline, shotgunCounter, shotgunAcceptCounter, friendlyError,
} from '@drip/core/data/liveApi';
import {
  weddingStatusLine, weddingCounterLine, weddingSends, weddingPlayerTag, type Wedding,
} from '@drip/core/data/shotgunWedding';
import { useTheme, alpha, MONO } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono } from './prims';

export function ShotgunWeddingCard({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const t = useTheme();
  const [ws, setWs] = useState<Wedding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const [pickH, setPickH] = useState<string[]>([]);
  const [pickA, setPickA] = useState<string[]>([]);

  const load = () => shotgunState(leagueId)
    .then((r) => setWs(r.ok && r.on !== false ? (r.weddings ?? []) : []))
    .catch(() => setWs([]));
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); setNote(done); setComposing(null); await load(); onChanged?.(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (x) { warn(); setNote(friendlyError(x)); }
    finally { setBusy(false); }
  };

  if (!ws?.length) return null;
  const toggle = (list: string[], set: (v: string[]) => void, slug: string) =>
    set(list.includes(slug) ? list.filter((s) => s !== slug) : list.length >= 3 ? list : [...list, slug]);
  const Btn = ({ label, tone, onPress, disabled }: { label: string; tone: 'you' | 'opp' | 'plain'; onPress: () => void; disabled?: boolean }) => (
    <Pressable disabled={busy || disabled} onPress={() => { tap(); onPress(); }}
      style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, opacity: busy || disabled ? 0.5 : 1,
        borderWidth: 1, borderColor: tone === 'you' ? t.you : tone === 'opp' ? t.opp : t.bd,
        backgroundColor: tone === 'you' ? t.you : t.bg }}>
      <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 0.4,
        color: tone === 'you' ? t.onAccent : tone === 'opp' ? t.opp : t.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <Card style={{ marginBottom: 12 }}>
      <Mono size={9} tone="faint" track={0.12}>💍 SHOTGUN WEDDING · WEEK {ws[0].week}</Mono>
      {!!note && <Mono size={10} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 8 }}>{note}</Mono>}
      {ws.map((w) => {
        if (w.my_seat == null) {
          return (
            <View key={w.id} style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.bd }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: t.text }}>{w.home.team} ⇄ {w.away.team}</Text>
              <Text style={{ fontSize: 11.5, color: t.dim, marginTop: 2 }}>
                {weddingSends(w.home.team, w.home.gives)}; {weddingSends(w.away.team, w.away.gives)}.
              </Text>
              <Mono size={9.5} tone="faint" style={{ marginTop: 2 }}>{weddingStatusLine(w)}</Mono>
            </View>
          );
        }
        const iAmHome = w.my_seat === w.home.roster;
        const rosterMine = iAmHome ? w.rosters?.home : w.rosters?.away;
        const rosterTheirs = iAmHome ? w.rosters?.away : w.rosters?.home;
        const myPick = iAmHome ? pickH : pickA; const setMy = iAmHome ? setPickH : setPickA;
        const theirPick = iAmHome ? pickA : pickH; const setTheir = iAmHome ? setPickA : setPickH;
        const counter = weddingCounterLine(w);
        return (
          <View key={w.id} style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: t.text, lineHeight: 20 }}>{weddingSends(w.home.team, w.home.gives)}</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: t.text, lineHeight: 20 }}>{weddingSends(w.away.team, w.away.gives)}</Text>
            <Mono size={10} tone="dim" style={{ marginTop: 6 }}>{weddingStatusLine(w)}</Mono>
            {w.status === 'pending' && (
              <Mono size={9.5} tone="faint" style={{ marginTop: 3 }}>🔒 These four can’t be dropped, traded or moved to IR until it’s settled.</Mono>
            )}
            {!!counter && w.status === 'pending' && (
              <View style={{ marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: alpha(t.warn, 8) }}>
                <Mono size={10} tone="warn">{counter}</Mono>
              </View>
            )}
            {w.status === 'pending' && (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {w.can_accept && <Btn label="SAY YES TO THE NEW VOWS" tone="you" onPress={() => void act(() => shotgunAcceptCounter(w.id), '✓ married on your own vows')} />}
                {w.can_counter && (
                  <Btn label={composing === w.id ? 'CLOSE' : 'PROPOSE NEW VOWS'} tone="plain" onPress={() => {
                    if (composing === w.id) { setComposing(null); return; }
                    setComposing(w.id); setNote(null);
                    setPickH(w.home.gives.map((p) => p.slug)); setPickA(w.away.gives.map((p) => p.slug));
                  }} />
                )}
                {w.can_decline && (
                  <Btn label="CALL IT OFF" tone="opp" onPress={() => Alert.alert('Call off the wedding?', 'Everyone keeps their players.', [
                    { text: 'Keep it', style: 'cancel' },
                    { text: 'Call it off', style: 'destructive', onPress: () => void act(() => shotgunDecline(w.id), '✓ called off') },
                  ])} />
                )}
              </View>
            )}
            {composing === w.id && !!rosterMine && !!rosterTheirs && (
              <View style={{ marginTop: 10, padding: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: t.bd, borderRadius: 8 }}>
                <Mono size={9} tone="faint" track={0.1}>YOU SEND (1–3)</Mono>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                  {rosterMine.map((p) => <Chip key={p.slug} small label={weddingPlayerTag(p)} on={myPick.includes(p.slug)} onPress={() => toggle(myPick, setMy, p.slug)} />)}
                </View>
                <Mono size={9} tone="faint" track={0.1} style={{ marginTop: 10 }}>YOU GET (1–3)</Mono>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                  {rosterTheirs.map((p) => <Chip key={p.slug} small label={weddingPlayerTag(p)} on={theirPick.includes(p.slug)} onPress={() => toggle(theirPick, setTheir, p.slug)} />)}
                </View>
                <View style={{ marginTop: 10, flexDirection: 'row' }}>
                  <Btn label="SEND NEW VOWS" tone="you" disabled={!pickH.length || !pickA.length}
                    onPress={() => void act(() => shotgunCounter(w.id, pickH, pickA), '✓ new vows sent — they say yes, or the original goes through')} />
                </View>
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}
