// A SPORT LEAGUE'S LINEUP, on the phone (v0.625.0, v0.629.0) — the web
// SportLineup's twin: counts per slot type (2 G, 2 F, 1 C, 2 UTIL…), then
// each spot as built with what a football spot may carry — 🎯 BEST BALL (the
// spot fills itself each night with the roster's top eligible scorer), a
// TEAMS scope and a ROOKIES scope — plus bench and IR, saved through
// set_sport_lineup until the draft starts.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPORTS, type Sport } from '@drip/core/sports/index';
import { sportRosterSlots, sportRelabelSlots, sportAddSlot, sportRemoveSlot, sportSlotTypeOf, sportSpotScopeLabel, sportHasTenure, type SportSlotSpec } from '@drip/core/sports/league';
import { setSportLineup, setLeagueRosterShape, leaguePool, friendlyError, type GameModeInfo } from '@drip/core/data/liveApi';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Chip, Mono } from './prims';

const specOf = (def: (typeof SPORTS)[Sport], gm: GameModeInfo | null): SportSlotSpec[] => {
  const raw = gm?.slots as (Partial<SportSlotSpec> & { pos: string[] })[] | null | undefined;
  if (!raw?.length) return sportRosterSlots(def);
  return sportRelabelSlots(def, raw.map((s) => ({
    pos: [...(s.pos ?? [])], label: s.label ?? '', ...(s.bb ? { bb: true } : {}),
    ...(s.teams?.length ? { teams: [...s.teams] } : {}), ...(s.min_exp != null ? { min_exp: s.min_exp } : {}), ...(s.max_exp != null ? { max_exp: s.max_exp } : {}),
  })));
};

export function SportLineup({ leagueId, sport, gm, locked, onSaved }: {
  leagueId: string; sport: Sport; gm: GameModeInfo | null;
  /** The draft has started: the lineup is frozen. */
  locked: boolean;
  onSaved?: () => void;
}) {
  const t = useTheme();
  const def = SPORTS[sport];
  const [spots, setSpots] = useState<SportSlotSpec[]>(() => specOf(def, gm));
  const [bench, setBench] = useState<number>(gm?.shape?.bench ?? def.benchDefault);
  const [ir, setIr] = useState<number>(gm?.shape?.ir ?? def.irDefault);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [teamsFor, setTeamsFor] = useState<number | null>(null);
  const [teams, setTeams] = useState<string[] | null>(null);
  useEffect(() => {
    setSpots(specOf(def, gm));
    setBench(gm?.shape?.bench ?? def.benchDefault);
    setIr(gm?.shape?.ir ?? def.irDefault);
  }, [gm, def]);
  useEffect(() => {
    if (teamsFor == null || teams) return;
    leaguePool(leagueId).then((rows) => setTeams([...new Set(rows.map((r) => r.team).filter((x): x is string => !!x))].sort())).catch(() => setTeams([]));
  }, [teamsFor, teams, leagueId]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of spots) { const k = sportSlotTypeOf(def, s.pos)?.type ?? [...new Set(s.pos)].sort().join('/'); out[k] = (out[k] ?? 0) + 1; }
    return out;
  }, [spots, def]);
  const starters = spots.length;
  const bbCount = spots.filter((s) => s.bb).length;
  const allBb = bbCount === starters && starters > 0;
  const custom = Object.keys(counts).filter((k) => !def.slotTypes.some((x) => x.type === k));
  const bump = (type: string, d: number) => {
    if (d > 0 && starters >= 20) return;
    setSpots((cur) => (d > 0 ? sportAddSlot(def, cur, type) : sportRemoveSlot(def, cur, type)));
  };
  const patch = (i: number, p: Partial<SportSlotSpec>) => setSpots((cur) => cur.map((s, j) => {
    if (j !== i) return s;
    const next: SportSlotSpec = { ...s, ...p };
    if (!next.bb) delete next.bb;
    if (!next.teams?.length) delete next.teams;
    if (next.min_exp == null) delete next.min_exp;
    if (next.max_exp == null) delete next.max_exp;
    return next;
  }));

  const save = async () => {
    if (busy || locked) return;
    if (starters < 1 || starters > 20) { setNote('a lineup needs 1–20 starters'); return; }
    setBusy(true); setNote(null);
    try {
      const r = await setSportLineup(leagueId, spots);
      if (!r.ok) { warn(); setNote(friendlyError(r.error ?? 'failed')); return; }
      const sh = await setLeagueRosterShape(leagueId, bench, 0, ir, 0, 0);
      if (!sh.ok) { warn(); setNote(friendlyError(sh.error ?? 'lineup saved, but the bench/IR did not')); return; }
      commit();
      setNote(`✓ ${r.starters} starters${r.bestball ? ` (${r.bestball} best ball)` : ''}, ${bench} bench, ${ir} IR — the draft runs ${sh.draft_rounds ?? '?'} rounds`);
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
        <Mono size={8.5} tone="faint" weight="700">{def.league} LINEUP · {starters} STARTERS{bbCount ? ` · ${bbCount} BEST BALL` : ''}{locked ? ' · FROZEN SINCE THE DRAFT' : ''}</Mono>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {def.slotTypes.map((x) => stepper(x.label, counts[x.type] ?? 0, (n) => bump(x.type, n - (counts[x.type] ?? 0)), 0, 6, (counts[x.type] ?? 0) > 0))}
        {custom.map((k) => stepper(`${k} (custom)`, counts[k], (n) => bump(k, n - counts[k]), 0, 6))}
      </View>

      {/* EACH SPOT (0436): best ball and scope live on the spot. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <Mono size={8.5} tone="faint" weight="700" track={0.1}>SPOTS</Mono>
        {!locked && (
          <View style={{ marginLeft: 'auto' }}>
            <Chip label={allBb ? '🎯 ALL BEST BALL — ON' : '🎯 ALL BEST BALL'} on={allBb} disabled={busy}
              onPress={() => { tap(); setSpots((cur) => cur.map((s) => (allBb ? (({ bb: _bb, ...rest }) => rest)(s) : { ...s, bb: true }))); }} />
          </View>
        )}
      </View>
      <View style={{ gap: 4, marginTop: 6 }}>
        {spots.map((s, i) => {
          const scope = sportSpotScopeLabel(s);
          return (
            <View key={i} style={{ gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: s.bb ? t.you : t.bd, borderRadius: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Mono size={10} weight="700" tone={s.bb ? 'you' : undefined} style={{ minWidth: 44 }}>{s.label}</Mono>
                <Mono size={8.5} tone="faint" numberOfLines={1} style={{ flex: 1 }}>{s.pos.join('/')}{scope ? ` · ${scope}` : ''}</Mono>
              </View>
              {!locked && (
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                  <Chip label="🎯 BEST BALL" on={!!s.bb} disabled={busy} onPress={() => { tap(); patch(i, { bb: !s.bb }); }} />
                  <Chip label={`TEAMS${s.teams?.length ? ` · ${s.teams.length}` : ''}`} on={!!s.teams?.length || teamsFor === i} disabled={busy} onPress={() => { tap(); setTeamsFor(teamsFor === i ? null : i); }} />
                  {sportHasTenure(sport) && (
                    <Chip label="ROOKIES" on={s.max_exp === 0} disabled={busy} onPress={() => { tap(); patch(i, { max_exp: s.max_exp === 0 ? null : 0, min_exp: null }); }} />
                  )}
                </View>
              )}
              {teamsFor === i && !locked && (
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                  {teams == null ? <Mono size={8.5} tone="faint">loading teams…</Mono>
                    : teams.length === 0 ? <Mono size={8.5} tone="faint">no pool yet — seed the player pool first</Mono>
                    : teams.map((tm) => {
                      const on = !!s.teams?.includes(tm);
                      return <Chip key={tm} label={tm} on={on} disabled={busy} onPress={() => { tap(); patch(i, { teams: on ? (s.teams ?? []).filter((x) => x !== tm) : [...(s.teams ?? []), tm].slice(0, 8) }); }} />;
                    })}
                  {!!s.teams?.length && <Chip label="CLEAR" on={false} onPress={() => { tap(); patch(i, { teams: [] }); }} />}
                </View>
              )}
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {stepper('BENCH', bench, setBench, 0, 15)}
        {stepper('IR / IL', ir, setIr, 0, 6)}
      </View>
      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(12) }}>
        Every spot names the positions it takes (UTIL takes anyone). Lineups change any day; a player locks into his spot at {def.vocab.start}. A 🎯 best-ball spot is nobody's to set: each night it takes your top scorer among the players who played and fit it — one player, one spot — and the board shows it as the night goes. A TEAMS spot takes only those teams' players{sportHasTenure(sport) ? '; a ROOKIES spot only first-year players' : ''}. The draft runs starters + bench rounds; IR spots are stashed into, not drafted.
      </Mono>
      {!locked && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Chip label={`${def.league} STANDARD`} on={false} disabled={busy}
            onPress={() => { tap(); setSpots(sportRosterSlots(def)); setBench(def.benchDefault); setIr(def.irDefault); }} />
          <Chip label={busy ? 'SAVING…' : 'SAVE LINEUP'} on disabled={busy} onPress={() => void save()} />
        </View>
      )}
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 6 }}>{note}</Mono>}
    </View>
  );
}
