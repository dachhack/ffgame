// 🧪 SIM STRIP (v0.381.0) — the web rehearsal strip (src/screens/SimStrip.tsx),
// in RN, so the whole drill runs from one phone: arm the sim, watch the board,
// feed the vampire, reset.
//
// Renders only for a super-admin on a 🧪 LIVE TEST league — the gate is the
// SERVER's (sim_run_state answers 'forbidden' to everyone else), so the strip
// probes once and vanishes for non-admins rather than trusting a client role
// flag. ▶ arms a sim_run for the week on screen; the WORKER's sweep does the
// driving, so backgrounding the app mid-week changes nothing. Progress reads
// in percent (0266); the clock is the fallback for the first worker tick.
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { adminSimStart, adminSimReset, simRunState, type SimRun } from '@drip/core/data/liveApi';
import { APP_VERSION } from '@drip/core/version';
import { MONO, useTheme } from '../theme.native';
import { tap, warn as buzz } from './feedback';
import { Mono } from './prims';

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function SimStrip({ leagueId, week, onChanged }: { leagueId: string; week: number; onChanged?: () => void }) {
  const t = useTheme();
  // null = probing, false = not an admin (render nothing), SimRun|'idle' = show.
  const [state, setState] = useState<SimRun | 'idle' | false | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = async () => {
    const r = await simRunState(leagueId).catch(() => null);
    if (!alive.current) return;
    if (!r?.ok) { setState(false); return; }
    setState(r.run ?? 'idle');
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => { alive.current = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  if (state === null || state === false) return null;
  const run = state === 'idle' ? null : state;

  const start = async () => {
    if (busy) return;
    tap(); setBusy(true); setErr(null);
    const r = await adminSimStart(leagueId, week).catch(() => null);
    setBusy(false);
    if (!r?.ok) { buzz(); setErr(r?.error ?? 'failed'); return; }
    onChanged?.();
    void refresh();
  };
  const doReset = async () => {
    setBusy(true); setErr(null);
    const r = await adminSimReset(leagueId, run?.week ?? week).catch(() => null);
    setBusy(false);
    if (!r?.ok) { buzz(); setErr(r?.error ?? 'failed'); return; }
    onChanged?.();
    void refresh();
  };
  const reset = () => {
    if (busy) return;
    tap();
    Alert.alert(`Reset the sim'd week ${run?.week ?? week}?`,
      'Matchups back to scheduled, picks unlocked, SIM feed cleared.',
      [{ text: 'Cancel', style: 'cancel' }, { text: '⏹ Reset', style: 'destructive', onPress: () => void doReset() }]);
  };

  const btn = (accent: string) => ({
    borderWidth: 1, borderColor: accent, borderRadius: 4,
    paddingHorizontal: 9, paddingVertical: 5, opacity: busy ? 0.6 : 1,
  });
  const btnText = (accent: string) => ({
    fontFamily: MONO, fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.6, color: accent,
  });

  return (
    <View style={{ marginBottom: 9, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', borderColor: t.warn, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Mono size={9} tone="warn" weight="700" track={0.08}>🧪 REHEARSAL · {APP_VERSION}</Mono>
        <View style={{ flex: 1 }} />
        {!run && (
          <Pressable onPress={() => void start()} disabled={busy} style={btn(t.you)}>
            <Text style={btnText(t.you)}>▶ SIM WEEK {week}</Text>
          </Pressable>
        )}
        {run && (
          <Pressable onPress={reset} disabled={busy} style={btn(t.opp)}>
            <Text style={btnText(t.opp)}>⏹ RESET WEEK {run.week}</Text>
          </Pressable>
        )}
      </View>
      <Mono size={8.5} tone="dim" style={{ lineHeight: 13 }}>
        {run
          ? run.status === 'running'
            ? `week ${run.week} · LIVE · feed ${run.pct != null ? `${run.pct}%` : `at ${fmtClock(Number(run.clock))}`} · ${run.speed}× — the worker is driving; watch the windows`
            : 'DONE — the week resolved to FINAL through the live path'
          : 'replay a baked 2025 week through the real pipeline, onto this board'}
      </Mono>
      {!!err && <Mono size={8.5} tone="opp">⚠ {err}</Mono>}
    </View>
  );
}
