// 💍 SHOTGUN WEDDING in the app (v0.653.0) — docs/shotgun-wedding.md. Twin of
// the web's src/screens/ShotgunWeddingCard.tsx; the words come from core
// (data/shotgunWedding) so the two never disagree.
//
// Renders nothing unless the league has the mode on and a week with
// weddings. Your own wedding first, with CALL IT OFF (whoever holds the
// veto), PROPOSE NEW VOWS (either team, one to three players each way) and
// SAY YES to the other side's vows; everyone else's a smaller box each, except
// for the commissioner (0456), who sees every pending wedding in full with
// ✎ REWRITE (change the trade outright) and CALL OFF, whatever the veto rule.
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import {
  shotgunState, shotgunDecline, shotgunCounter, shotgunAcceptCounter, shotgunCommishEdit, shotgunCommishDecline, friendlyError,
} from '@drip/core/data/liveApi';
import {
  weddingStatusShort, weddingPlayerTag, type Wedding, type WeddingPlayer, type WeddingSide,
} from '@drip/core/data/shotgunWedding';
import { useTheme, alpha, MONO } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono } from './prims';

// THE TRADE BOX (v0.656.4, founder: "get rid of the walls of text"): the two
// sides side by side, a player to a row. Twin of the web's TradeBox.
function Side({ side, gives, you, get, small }: { side: WeddingSide; gives: WeddingPlayer[]; you: boolean; get: boolean; small?: boolean }) {
  const t = useTheme();
  const fs = small ? 11.5 : 12.5;
  return (
    <View style={{ flex: 1, minWidth: 0, paddingHorizontal: small ? 8 : 10, paddingVertical: small ? 7 : 9, borderRadius: 7, borderWidth: 1,
      borderColor: you ? alpha(t.you, 45) : t.bd, backgroundColor: you ? alpha(t.you, 8) : t.bg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: fs, fontWeight: '700', color: t.text }}>{side.team}</Text>
        {side.score != null && <Mono size={9.5} tone="faint">{side.score}</Mono>}
      </View>
      <Mono size={8.5} weight="700" track={0.1} tone={you ? 'you' : 'faint'} style={{ marginTop: 2 }}>{you ? 'YOU SEND' : get ? 'YOU GET' : 'SENDS'}</Mono>
      {gives.length ? gives.map((p) => (
        <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
          {!!p.pos && <Mono size={9} weight="700" tone="dim" style={{ width: 22 }}>{p.pos}</Mono>}
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: fs, color: t.text }}>{p.name}</Text>
        </View>
      )) : <Text style={{ fontSize: 11.5, color: t.faint, marginTop: 4 }}>Nobody</Text>}
    </View>
  );
}
function TradeBox({ w, home, away, small }: { w: Wedding; home: WeddingPlayer[]; away: WeddingPlayer[]; small?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 6, marginTop: small ? 6 : 10 }}>
      <Side side={w.home} gives={home} you={w.my_seat === w.home.roster} get={w.my_seat === w.away.roster} small={small} />
      <Text style={{ alignSelf: 'center', color: t.faint, fontSize: 14 }}>⇄</Text>
      <Side side={w.away} gives={away} you={w.my_seat === w.away.roster} get={w.my_seat === w.home.roster} small={small} />
    </View>
  );
}

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
            <View key={w.id} style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.bd }}>
              <TradeBox w={w} home={w.home.gives} away={w.away.gives} small />
              <Mono size={9.5} tone="faint" style={{ marginTop: 5 }}>{weddingStatusShort(w)}</Mono>
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
        const counterFrom = w.counter ? (w.counter.from === w.home.roster ? w.home.team : w.counter.from === w.away.roster ? w.away.team : 'one side') : null;
        return (
          <View key={w.id} style={{ marginTop: 10, ...(mine ? {} : { paddingTop: 10, borderTopWidth: 1, borderTopColor: t.bd }) }}>
            <TradeBox w={w} home={w.home.gives} away={w.away.gives} />
            <Mono size={10} tone="dim" style={{ marginTop: 7 }}>
              {weddingStatusShort(w)}{w.status === 'pending' && mine ? '  🔒 Players locked.' : ''}
            </Mono>
            {!!w.counter && w.status === 'pending' && (
              <View style={{ marginTop: 10, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: alpha(t.warn, 45), backgroundColor: alpha(t.warn, 6) }}>
                <Mono size={9} weight="700" track={0.1} tone="warn">NEW VOWS FROM {counterFrom!.toUpperCase()}</Mono>
                <TradeBox w={w} home={w.counter.home_gives} away={w.counter.away_gives} small />
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
