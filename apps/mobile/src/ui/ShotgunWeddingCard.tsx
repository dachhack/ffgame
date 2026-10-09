// 💍 SHOTGUN WEDDING in the app (v0.653.0) — docs/shotgun-wedding.md. Twin of
// the web's src/screens/ShotgunWeddingCard.tsx; the words come from core
// (data/shotgunWedding) so the two never disagree.
//
// Renders nothing unless the league has the mode on and a week with
// weddings. Your own wedding first, with CALL IT OFF (whoever holds the
// veto), PROPOSE NEW VOWS (either team, one to three players each way) and
// SAY YES to the other side's vows; everyone else's one line each — except
// for the commissioner (0456), who sees every pending wedding in full with
// ✎ REWRITE (change the trade outright) and CALL OFF, whatever the veto rule.
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import {
  shotgunState, shotgunDecline, shotgunCounter, shotgunAcceptCounter, shotgunCommishEdit, shotgunCommishDecline, friendlyError,
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
  const [composing, setComposing] = useState<{ id: string; mode: 'vows' | 'commish' } | null>(null);
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
        const mine = w.my_seat != null;
        const boss = w.can_commish === true;
        if (!mine && !boss) {
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
        const open = composing?.id === w.id ? composing.mode : null;
        const rows = open === 'commish' || !mine
          ? [{ label: `${w.home.team.toUpperCase()} SENDS (1–3)`, list: w.rosters?.home, pick: pickH, set: setPickH },
             { label: `${w.away.team.toUpperCase()} SENDS (1–3)`, list: w.rosters?.away, pick: pickA, set: setPickA }]
          : [{ label: 'YOU SEND (1–3)', list: iAmHome ? w.rosters?.home : w.rosters?.away, pick: iAmHome ? pickH : pickA, set: iAmHome ? setPickH : setPickA },
             { label: 'YOU GET (1–3)', list: iAmHome ? w.rosters?.away : w.rosters?.home, pick: iAmHome ? pickA : pickH, set: iAmHome ? setPickA : setPickH }];
        const openComposer = (mode: 'vows' | 'commish') => {
          if (open === mode) { setComposing(null); return; }
          setComposing({ id: w.id, mode }); setNote(null);
          setPickH(w.home.gives.map((p) => p.slug)); setPickA(w.away.gives.map((p) => p.slug));
        };
        const counter = weddingCounterLine(w);
        return (
          <View key={w.id} style={{ marginTop: 10, ...(mine ? {} : { paddingTop: 10, borderTopWidth: 1, borderTopColor: t.bd }) }}>
            {!mine && <Mono size={9} tone="faint" track={0.1} style={{ marginBottom: 4 }}>{w.home.team.toUpperCase()} ⇄ {w.away.team.toUpperCase()}</Mono>}
            <Text style={{ fontSize: mine ? 14 : 13, fontWeight: '700', color: t.text, lineHeight: 20 }}>{weddingSends(w.home.team, w.home.gives)}</Text>
            <Text style={{ fontSize: mine ? 14 : 13, fontWeight: '700', color: t.text, lineHeight: 20 }}>{weddingSends(w.away.team, w.away.gives)}</Text>
            <Mono size={10} tone="dim" style={{ marginTop: 6 }}>{weddingStatusLine(w)}</Mono>
            {w.status === 'pending' && mine && (
              <Mono size={9.5} tone="faint" style={{ marginTop: 3 }}>🔒 These players can’t be dropped, traded or moved to IR until it’s settled.</Mono>
            )}
            {!!counter && w.status === 'pending' && (
              <View style={{ marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: alpha(t.warn, 8) }}>
                <Mono size={10} tone="warn">{counter}</Mono>
              </View>
            )}
            {w.status === 'pending' && (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {w.can_accept && <Btn label="SAY YES TO THE NEW VOWS" tone="you" onPress={() => void act(() => shotgunAcceptCounter(w.id), '✓ married on your own vows')} />}
                {w.can_counter && <Btn label={open === 'vows' ? 'CLOSE' : 'PROPOSE NEW VOWS'} tone="plain" onPress={() => openComposer('vows')} />}
                {w.can_decline && (
                  <Btn label="CALL IT OFF" tone="opp" onPress={() => Alert.alert('Call off the wedding?', 'Everyone keeps their players.', [
                    { text: 'Keep it', style: 'cancel' },
                    { text: 'Call it off', style: 'destructive', onPress: () => void act(() => shotgunDecline(w.id), '✓ called off') },
                  ])} />
                )}
                {boss && <Btn label={open === 'commish' ? 'CLOSE' : '✎ REWRITE (COMMISH)'} tone="plain" onPress={() => openComposer('commish')} />}
                {boss && !w.can_decline && (
                  <Btn label="CALL OFF (COMMISH)" tone="opp" onPress={() => Alert.alert(`Call off ${w.home.team} and ${w.away.team}’s wedding?`, 'Everyone keeps their players.', [
                    { text: 'Keep it', style: 'cancel' },
                    { text: 'Call it off', style: 'destructive', onPress: () => void act(() => shotgunCommishDecline(w.id), '✓ called off') },
                  ])} />
                )}
              </View>
            )}
            {!!open && rows.every((r) => !!r.list) && (
              <View style={{ marginTop: 10, padding: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: t.bd, borderRadius: 8 }}>
                {open === 'commish' && (
                  <Mono size={10} tone="dim" style={{ marginBottom: 8 }}>This replaces the trade that goes through at the deadline. The deadline and who can call it off stay as announced.</Mono>
                )}
                {rows.map((r, i) => (
                  <View key={r.label}>
                    <Mono size={9} tone="faint" track={0.1} style={{ marginTop: i ? 10 : 0 }}>{r.label}</Mono>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                      {(r.list ?? []).map((p) => <Chip key={p.slug} small label={weddingPlayerTag(p)} on={r.pick.includes(p.slug)} onPress={() => toggle(r.pick, r.set, p.slug)} />)}
                    </View>
                  </View>
                ))}
                <View style={{ marginTop: 10, flexDirection: 'row' }}>
                  <Btn label={open === 'commish' ? 'REWRITE THE VOWS' : 'SEND NEW VOWS'} tone="you" disabled={!pickH.length || !pickA.length}
                    onPress={() => void act(open === 'commish'
                      ? () => shotgunCommishEdit(w.id, pickH, pickA)
                      : () => shotgunCounter(w.id, pickH, pickA),
                    open === 'commish' ? '✓ vows rewritten — the league has been told' : '✓ new vows sent — they say yes, or the original goes through')} />
                </View>
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}
