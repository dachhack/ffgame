// A SPORT LEAGUE'S LINEUP, on the phone (v0.625.0) — the web SportLineup's
// twin. The app's ROSTER page showed a daily-sport league the NFL builder
// (QB/RB/WR chips), and set_league_classic_slots refused every sport
// position, so "I saved the roster and it didn't take" was exactly right:
// only the bench and IR landed. This is counts per slot type (2 G, 2 F,
// 1 C, 2 UTIL…) plus bench and IR, saved through set_sport_lineup until the
// draft starts.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPORTS, type Sport } from '@drip/core/sports/index';
import { sportRosterSlots, slotCountsOf } from '@drip/core/sports/league';
import { setSportLineup, setLeagueRosterShape, friendlyError, type GameModeInfo } from '@drip/core/data/liveApi';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Chip, Mono } from './prims';

export function SportLineup({ leagueId, sport, gm, locked, onSaved }: {
  leagueId: string; sport: Sport; gm: GameModeInfo | null;
  /** The draft has started: the lineup is frozen. */
  locked: boolean;
  onSaved?: () => void;
}) {
  const t = useTheme();
  const def = SPORTS[sport];
  const [counts, setCounts] = useState<Record<string, number>>(() => slotCountsOf(def, gm?.slots ?? null));
  const [bench, setBench] = useState<number>(gm?.shape?.bench ?? def.benchDefault);
  const [ir, setIr] = useState<number>(gm?.shape?.ir ?? def.irDefault);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setCounts(gm?.slots?.length ? slotCountsOf(def, gm.slots) : { ...def.defaultRoster });
    setBench(gm?.shape?.bench ?? def.benchDefault);
    setIr(gm?.shape?.ir ?? def.irDefault);
  }, [gm, def]);

  const starters = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);
  const custom = Object.keys(counts).filter((k) => !def.slotTypes.some((x) => x.type === k));
  const bump = (type: string, d: number) => setCounts((c) => {
    const n = Math.max(0, Math.min(6, (c[type] ?? 0) + d));
    const next = { ...c, [type]: n };
    if (n === 0) delete next[type];
    return next;
  });

  const save = async () => {
    if (busy || locked) return;
    if (starters < 1 || starters > 20) { setNote('a lineup needs 1–20 starters'); return; }
    setBusy(true); setNote(null);
    try {
      const known = Object.fromEntries(Object.entries(counts).filter(([k]) => def.slotTypes.some((x) => x.type === k)));
      const slots = [...sportRosterSlots(def, known), ...custom.flatMap((k) => Array.from({ length: counts[k] }, () => ({ pos: k.split('/'), label: k })))];
      const r = await setSportLineup(leagueId, slots);
      if (!r.ok) { warn(); setNote(friendlyError(r.error ?? 'failed')); return; }
      const sh = await setLeagueRosterShape(leagueId, bench, 0, ir, 0, 0);
      if (!sh.ok) { warn(); setNote(friendlyError(sh.error ?? 'lineup saved, but the bench/IR did not')); return; }
      commit();
      setNote(`✓ ${r.starters} starters, ${bench} bench, ${ir} IR — the draft runs ${sh.draft_rounds ?? '?'} rounds`);
      onSaved?.();
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const stepper = (label: string, v: number, set: (n: number) => void, min: number, max: number, on = true) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, opacity: locked ? 0.55 : 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: on ? t.text : t.dim }}>{label}</Text>
      <Pressable disabled={busy || locked || v <= min} onPress={() => { tap(); set(Math.max(min, v - 1)); }} hitSlop={6}>
        <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.you }}> − </Text>
      </Pressable>
      <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.you, minWidth: 12, textAlign: 'center' }}>{v}</Text>
      <Pressable disabled={busy || locked || v >= max} onPress={() => { tap(); set(Math.min(max, v + 1)); }} hitSlop={6}>
        <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.you }}> ＋ </Text>
      </Pressable>
    </View>
  );

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Mono size={8.5} tone="faint" weight="700">{def.league} LINEUP · {starters} STARTERS{locked ? ' · FROZEN SINCE THE DRAFT' : ''}</Mono>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {def.slotTypes.map((x) => stepper(x.label, counts[x.type] ?? 0, (n) => bump(x.type, n - (counts[x.type] ?? 0)), 0, 6, (counts[x.type] ?? 0) > 0))}
        {custom.map((k) => stepper(`${k} (custom)`, counts[k], (n) => bump(k, n - counts[k]), 0, 6))}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {stepper('BENCH', bench, setBench, 0, 15)}
        {stepper('IR / IL', ir, setIr, 0, 6)}
      </View>
      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(12) }}>
        Every spot names the positions it takes (UTIL takes anyone). Lineups change any day; a player locks into his spot at {def.vocab.start}. The draft runs starters + bench rounds; IR spots are stashed into, not drafted.
      </Mono>
      {!locked && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Chip label={`${def.league} STANDARD`} on={false} disabled={busy}
            onPress={() => { tap(); setCounts({ ...def.defaultRoster }); setBench(def.benchDefault); setIr(def.irDefault); }} />
          <Chip label={busy ? 'SAVING…' : 'SAVE LINEUP'} on disabled={busy} onPress={() => void save()} />
        </View>
      )}
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 6 }}>{note}</Mono>}
    </View>
  );
}
