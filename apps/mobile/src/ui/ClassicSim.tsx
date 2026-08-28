// WEEK 0 — CLASSIC SIM (the app's port of the web's ClassicSim league mode).
//
// Founder: "wire it into each classic league as a week 0 in the matchup view.
// It should use all the league scoring and rules" → "looks good. Let's put it
// in the app." ClassicBoard's week stepper steps back from week 1 into this
// board: the app's bundled 2025 week (w8 — the same one the demo ships),
// scored under THIS league's slots/scoring/rosters, driven by a clock you drag
// or play, with the live field visuals scrubbing alongside.
//
// Judgement lives in core (classicPointsFrom / bestballFillBy /
// projectedPoints), exactly like the web sim — what is native here is the
// sheet: an RN scrub track (PanResponder; there is no <input type=range>) and
// the bundled-asset install (the native app has no origin to fetch from, so
// the week arrives as a Metro require, same door the demo uses).
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, Image, Text, View } from 'react-native';
import { classicPointsFrom, bestballFillBy, isRetSlot, type ClassicPick, type ClassicScoring, type ClassicSlotDef } from '@drip/core/engine/classic';
import { projectedPoints } from '@drip/core/engine/projScoring';
import { playsForPlayer } from '@drip/core/engine/sim';
import { installRealWeek, isRealWeekLoaded } from '@drip/core/data/realPbp';
import { installGameFeedWeek, gameFeedFor } from '@drip/core/data/gameFeed';
import { headshot } from '@drip/core/data/media';
import type { Player } from '@drip/core/types';
import { useTheme } from '../theme.native';
import { tap } from './feedback';
import { Mono, PosPill } from './prims';
import { FieldView } from './FieldView';
import { openPlayerCard } from './PlayerCardSheet';

/** What the classic board hands the sim: the league's slot layout, its merged
 *  scoring catalog, its best-ball spots, golf, and both sides' rosters
 *  (stash-filtered, `exp` attached for tenure slots). Mirrors the web's
 *  ClassicSimLeague — a shape, not an import: the web file pulls in web-only
 *  UI this bundle must not carry. */
export interface ClassicSimLeague {
  slots: ClassicSlotDef[];
  sc: Partial<ClassicScoring>;
  bestball: string[];
  golf: boolean;
  youName: string; oppName: string;
  you: Player[]; opp: Player[];
  onExit: () => void;
}

// The app's bundled real week — w8.json is what ships in the APK (the demo's
// week), so the sim replays it. The web sim uses its own DEMO_WEEK; the two
// are both "a real 2025 week", not the same one, and neither claims to be.
const SIM_WEEK = 8;

// Regulation caps at 55:00 (the engine's GAME_SECONDS); OT reaches past it, so
// the ceiling is read from the week's plays and this is only the floor.
const REG_SECONDS = 3300;
const TICK_MS = 350;
const STEP = 75;

function qClock(sec: number): string {
  const q = Math.min(5, Math.floor(sec / 900) + 1);
  const r = Math.max(0, 900 - (sec % 900));
  return `${q > 4 ? 'OT' : `Q${q}`} ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`;
}

type Row = { def: ClassicSlotDef; player: Player | null };

export function ClassicSim({ league }: { league: ClassicSimLeague }) {
  const t = useTheme();
  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState(REG_SECONDS);
  const [playing, setPlaying] = useState(false);
  const [hindsight, setHindsight] = useState(false);

  // Install the bundled week into the module caches, then signal the render.
  // Idempotent — the demo board installs the same data at its own module scope.
  useEffect(() => {
    try {
      if (!isRealWeekLoaded(SIM_WEEK)) installRealWeek(SIM_WEEK, require('../../assets/pbp/w8.json'));
      installGameFeedWeek(SIM_WEEK, require('../../assets/gamefeed/w8.json'));
    } catch { /* a missing asset leaves an honest empty board */ }
    setReady(true);
  }, []);

  const slots = league.slots;
  const slotNames = useMemo(() => slots.map((s) => s.slot), [slots]);
  const leagueBb = useMemo(() => new Set(league.bestball), [league.bestball]);

  const scoreRow = (plays: ReturnType<typeof playsForPlayer>['plays'], p: Player, d: ClassicSlotDef): number =>
    classicPointsFrom(plays, p, league.sc, d.pos && isRetSlot(d.pos) ? 'RET' : undefined, d.slot);

  // League best-ball spots — and every spot under the hindsight toggle — fill
  // by the week's ACTUAL points; the rest by projection (the pre-kick lineup).
  const fillSide = (roster: Player[]): Row[] => {
    if (!ready || !roster.length) return slots.map((d) => ({ def: d, player: null }));
    const valueOf = (p: Player, d: ClassicSlotDef): number =>
      (hindsight || leagueBb.has(d.slot))
        ? scoreRow(playsForPlayer(p, SIM_WEEK).plays, p, d)
        : projectedPoints(p, d.slot, d.pos);
    const picks: ClassicPick[] = bestballFillBy([], slotNames, roster, slots, valueOf);
    const bySlot = new Map(picks.map((p) => [p.slot, p.player]));
    return slots.map((d) => ({ def: d, player: bySlot.get(d.slot) ?? null }));
  };
  const youRows = useMemo(() => fillSide(league.you), [league.you, ready, hindsight, slots, leagueBb]); // eslint-disable-line react-hooks/exhaustive-deps
  const themRows = useMemo(() => fillSide(league.opp), [league.opp, ready, hindsight, slots, leagueBb]); // eslint-disable-line react-hooks/exhaustive-deps

  const playsBySlug = useMemo(() => {
    const m = new Map<string, ReturnType<typeof playsForPlayer>['plays']>();
    for (const r of [...youRows, ...themRows]) {
      if (!r.player || m.has(r.player.id)) continue;
      m.set(r.player.id, playsForPlayer(r.player, SIM_WEEK).plays);
    }
    return m;
  }, [youRows, themRows]);

  const maxClock = useMemo(() => {
    let mx = REG_SECONDS;
    for (const plays of playsBySlug.values()) for (const p of plays) if (p.clock > mx) mx = p.clock;
    return mx;
  }, [playsBySlug]);

  const ptsAt = (r: Row): number => {
    if (!r.player) return 0;
    const plays = playsBySlug.get(r.player.id) ?? [];
    const upto = clock >= maxClock ? plays : plays.filter((p) => p.clock <= clock);
    return scoreRow(upto, r.player, r.def);
  };
  const youTotal = youRows.reduce((n, r) => n + ptsAt(r), 0);
  const themTotal = themRows.reduce((n, r) => n + ptsAt(r), 0);

  // Playback: advance to the last play, then stop.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(() => {
      setClock((c) => { const n = c + STEP; if (n >= maxClock) { setPlaying(false); return maxClock; } return n; });
    }, TICK_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, maxClock]);

  // ── the scrub track — a PanResponder over a bar, since RN has no range
  // input. Claims the gesture on start (a tap seeks too) and maps locationX
  // straight to the clock; the ref keeps maxClock current inside the
  // create-once responder.
  const trackW = useRef(1);
  const maxRef = useRef(maxClock); maxRef.current = maxClock;
  const seek = (x: number) => {
    setPlaying(false);
    setClock(Math.round(Math.min(1, Math.max(0, x / trackW.current)) * maxRef.current));
  };
  const seekRef = useRef(seek); seekRef.current = seek;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => seekRef.current(e.nativeEvent.locationX),
    onPanResponderMove: (e) => seekRef.current(e.nativeEvent.locationX),
  })).current;

  const fieldTeams = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const r of [...youRows, ...themRows]) {
      const tm = r.player?.team; if (!tm) continue;
      const f = gameFeedFor(SIM_WEEK, tm); if (!f || seen.has(f.key)) continue;
      seen.add(f.key); out.push(tm);
    }
    return out;
  }, [youRows, themRows, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const atEnd = clock >= maxClock;
  const chip = (on: boolean) => ({
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1,
    borderColor: on ? t.warn : t.bd, backgroundColor: on ? t.warn : t.surface,
  });

  const sideCol = (label: string, rows: Row[], total: number, tone: 'you' | 'opp') => (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: t.surface, borderWidth: 1, borderColor: t.bd, borderRadius: 8, padding: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '700', color: tone === 'you' ? t.you : t.opp }}>{label}</Text>
        <Mono size={14} tone="text" weight="700">{total.toFixed(1)}</Mono>
      </View>
      {rows.map((r) => {
        const p = r.player;
        const pts = ptsAt(r);
        return (
          <Pressable key={r.def.slot} onPress={p ? () => { tap(); openPlayerCard({ slug: p.id, name: p.name, pos: p.pos, team: p.team ?? '', week: SIM_WEEK }); } : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, borderTopWidth: 1, borderTopColor: t.bd + '80' }}>
            <Mono size={7.5} weight="700" tone={leagueBb.has(r.def.slot) ? 'warn' : 'faint'} style={{ width: 30 }}>{r.def.slot}</Mono>
            {p
              ? <Image source={{ uri: headshot(p.id) ?? undefined }} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.bg }} />
              : <View style={{ width: 22, height: 22 }} />}
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontWeight: '600', color: p ? t.text : t.faint }}>{p ? p.name : '—'}</Text>
            {p && <PosPill pos={p.pos} size={8} />}
            <Mono size={11} weight="700" tone={pts ? 'text' : 'faint'} style={{ width: 38, textAlign: 'right' }}>{pts.toFixed(1)}</Mono>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: t.text }}>🧪 Week 0 · Sim</Text>
          <Mono size={8.5} tone="dim" track={0.04}>2025 WEEK {SIM_WEEK} REPLAY · YOUR LEAGUE&rsquo;S SCORING, SLOTS &amp; ROSTERS</Mono>
        </View>
        <Pressable onPress={() => { tap(); league.onExit(); }}
          style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: t.surface }}>
          <Mono size={9.5} weight="700" tone="dim">WEEK 1 →</Mono>
        </Pressable>
      </View>

      {/* trait chips + hindsight toggle */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Pressable onPress={() => { tap(); setHindsight((b) => !b); }} style={chip(hindsight)}>
          <Mono size={9} weight="700" tone="dim" style={hindsight ? { color: t.onAccent } : undefined}>{hindsight ? '✓ BEST BALL' : 'BEST BALL'}</Mono>
        </Pressable>
        <Mono size={8} tone="faint">{hindsight ? 'hindsight-perfect lineup' : 'projection lineup (set pre-kick)'}</Mono>
        {leagueBb.size > 0 && <Mono size={8.5} tone="dim" style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>🎯 {leagueBb.size} BEST-BALL SPOT{leagueBb.size === 1 ? '' : 'S'}</Mono>}
        {league.golf && <Mono size={8.5} tone="dim" style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>⛳ GOLF · LOW WINS</Mono>}
      </View>

      {!ready ? (
        <Mono size={10} tone="dim" style={{ textAlign: 'center', paddingVertical: 32 }}>Loading the 2025 week…</Mono>
      ) : (
        <>
          {/* score + scrub */}
          <View style={{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.bd, borderRadius: 8, padding: 12, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <Mono size={20} weight="700" tone="you">{youTotal.toFixed(1)}</Mono>
              <Mono size={10} tone="dim">{atEnd ? 'FINAL' : qClock(clock)}</Mono>
              <Mono size={20} weight="700" tone="opp">{themTotal.toFixed(1)}</Mono>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable onPress={() => { tap(); if (atEnd) setClock(0); setPlaying((p) => !p); }}
                style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 13, paddingVertical: 8 }}>
                <Mono size={10.5} weight="700" style={{ color: t.onAccent }}>{playing ? '⏸ PAUSE' : atEnd ? '↻ REPLAY' : '▶ PLAY'}</Mono>
              </Pressable>
              {/* the track — tap or drag anywhere on it to seek */}
              <View {...pan.panHandlers} onLayout={(e) => { trackW.current = Math.max(1, e.nativeEvent.layout.width); }}
                style={{ flex: 1, height: 28, justifyContent: 'center' }} hitSlop={8}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: t.bd }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: `${100 - Math.min(100, (clock / maxClock) * 100)}%`, height: 4, borderRadius: 2, backgroundColor: t.you }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: `${Math.min(100, (clock / maxClock) * 100)}%`, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: t.you }} />
              </View>
              <Pressable onPress={() => { tap(); setPlaying(false); setClock(maxClock); }} hitSlop={8}>
                <Mono size={12} tone="dim">⏭</Mono>
              </Pressable>
            </View>
          </View>

          {/* lineups — stacked on a phone */}
          {sideCol(league.youName, youRows, youTotal, 'you')}
          {sideCol(league.oppName, themRows, themTotal, 'opp')}
          <Mono size={8} tone="faint" style={{ lineHeight: 12 }}>
            a rehearsal, not a result — your league scored on last season&rsquo;s Week {SIM_WEEK}. A 2026 rookie has no 2025 plays and scores 0; an empty spot means nobody on the roster fits it.
          </Mono>

          {/* fields — every game with a starter, at the current clock */}
          <Mono size={9} weight="700" tone="dim" track={0.08}>▦ FIELDS · {fieldTeams.length} GAME{fieldTeams.length === 1 ? '' : 'S'}</Mono>
          {fieldTeams.length === 0
            ? <Mono size={9.5} tone="faint">No games on the bundled feed.</Mono>
            : fieldTeams.map((tm) => <FieldView key={tm} week={SIM_WEEK} team={tm} clock={clock} />)}
        </>
      )}
    </ScrollView>
  );
}
