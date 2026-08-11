// A real 2025 week, replayed on the real board.
//
// WHY: the flip, the nuke burst and the hot glow only happen when live state
// changes — an opponent's card turning face-up at kickoff, `nuked`/`hot`
// arriving on a slot row from the worker. Outside a game day none of them can be
// made to happen, so they can't be demoed, reviewed, or caught regressing.
//
// WHAT IT IS NOT: a mock-up. It feeds props to the SAME `Duel` the live board
// renders, which renders the same `CardFace`, running the same animations. The
// numbers are not invented either — this is the baked Drip Test League's real
// 2025 week 8, resolved by the real engine (`buildMatchup`) against real
// play-by-play, and the clock is a genuine scrub through those events via
// `banksAtClock` and `liveCardFlags`. If a moment looks right here it looks
// right on Thursday; if one breaks, this breaks with it. Worth protecting: the
// value is precisely that this screen owns no copy of the board.
//
// WHY WEEK 8, PHINS vs TITANS: chosen by scanning all 14 baked weeks × every
// team pairing (1,260 in total) for the one that actually exercises the moments
// — two nukes (SUN 1PM), a hot streak, no empty windows, and a last window that
// decides it. Most pairings show none of that, so re-run the scan rather than
// guessing if the baked play-by-play is ever regenerated.
//
// The banked total this board reaches (126.9–132.2) is NOT the engine's final
// for the week (141.9–142.2). That gap is real and correct: banks are what has
// been scored play by play, while the final adds end-of-week awards — window-win
// bonuses and the like — that no clock position can show. The live board sums
// window banks exactly the same way, so the demo is faithful to it rather than
// to the scoreboard.
//
// SIZE: one week's play-by-play is ~190 KB in a ~30 MB APK. Adding more weeks is
// cheap if the demo ever wants a menu; it's one file per week under assets/pbp.
//
// GLOBAL STATE: `resetToDemoLeague()` swaps core's ACTIVE league. That is safe
// here only because this app never loads a live league into core — LivePicks and
// LiveBoard read everything from Supabase and touch core's league registry not
// at all. If that ever changes, this screen has to restore what it replaced.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { resetToDemoLeague, getActiveLeague } from '@drip/core/data/league';
import { installRealWeek } from '@drip/core/data/realPbp';
import { installGameFeedWeek } from '@drip/core/data/gameFeed';
import {
  defaultLineup, aiLineup, buildMatchup, banksAtClock, liveCardFlags,
  type ResolvedMatchup,
} from '@drip/core/engine/matchup';
import type { RevealedPick, WindowScore, PoolPlayer, SlotScoreRow } from '@drip/core/data/liveApi';
import { useTheme, MONO, alpha } from '../theme.native';
import { Card, Display, Mono } from '../ui/prims';
import { Duel } from './LiveBoard';
import { FieldView } from '../ui/FieldView';
import { PlayLog } from '../ui/PlayLog';

const WEEK = 8;
const YOU_TEAM = 'Gone Fishing Phins';
const OPP_TEAM = 'Taco Time Titans';

// Game-clock seconds per real second. A window's clock runs to ~3900, so 1× is
// about 40 seconds of watching and 8× about 5 — the range between "talk over it"
// and "get to the point".
const SPEEDS = [1, 2, 4, 8] as const;
const BASE_RATE = 100;
const TICK_MS = 100;

interface Built {
  resolved: ResolvedMatchup;
  /** Highest event clock per window — when a window is over. */
  winMax: number[];
  mine: RevealedPick[];
  theirs: RevealedPick[];
  pool: Record<string, PoolPlayer>;
  label: Record<string, string>;
  wins: string[];
  youName: string;
  oppName: string;
}

function build(): Built {
  resetToDemoLeague();
  // Metro bundles this JSON and require() hands it back already parsed, so
  // there is nothing to fetch — which is the whole reason installRealWeek exists
  // alongside loadRealWeek (that one goes through platform().assetUrl, which
  // throws on native by design).
  installRealWeek(WEEK, require('../../assets/pbp/w8.json'));
  // The parallel per-GAME feed, which only the field visual reads — the engine
  // never touches it. Same reason it has to be installed rather than fetched.
  installGameFeedWeek(WEEK, require('../../assets/gamefeed/w8.json'));

  const lg = getActiveLeague();
  const you = lg.teams.find((t) => t.name === YOU_TEAM) ?? lg.teams[0];
  const opp = lg.teams.find((t) => t.name === OPP_TEAM) ?? lg.teams[1];

  const resolved = buildMatchup(
    you.id, opp.id, WEEK,
    defaultLineup(you.id, WEEK),
    aiLineup(opp.id, you.id, WEEK),
    {}, {}, {}, {}, {},
    true, // realResolve — cross-game effects resolve in real-time order
  );

  const mine: RevealedPick[] = [];
  const theirs: RevealedPick[] = [];
  const pool: Record<string, PoolPlayer> = {};
  const label: Record<string, string> = {};
  const seat = (win: string, i: number, who: string, p: { player: { id: string; name: string; pos: string }; metricId: string }): RevealedPick => {
    pool[p.player.id] = { slug: p.player.id, full: p.player.name, pos: p.player.pos };
    return { app_user_id: who, game_window: win, roster_slot: String(i), player_slug: p.player.id, metric_id: p.metricId, locked: true };
  };

  for (const w of resolved.windows) {
    label[w.window.id] = `${w.window.label} · ${w.window.sub ?? ''}`.trim().replace(/ ·\s*$/, '');
    for (const s of w.slots) {
      if (s.you) mine.push(seat(w.window.id, s.slotIndex, 'you', s.you));
      if (s.their) theirs.push(seat(w.window.id, s.slotIndex, 'them', s.their));
    }
  }

  return {
    resolved,
    winMax: resolved.windows.map((w) => w.slots.reduce((m, s) => s.events.reduce((a, e) => Math.max(a, e.clock), m), 0)),
    mine, theirs, pool, label,
    wins: resolved.windows.map((w) => w.window.id),
    youName: you.name, oppName: opp.name,
  };
}

export function DemoBoard() {
  const t = useTheme();
  // Built once. Resolving a matchup walks every play of every slot, so this is
  // not something to redo on a clock tick.
  const b = useMemo(build, []);

  // -1 is PRE-KICKOFF: your lineup showing, every opponent card face-down.
  // Without it the demo opens with the first window already revealed and its
  // flip — the one moment people most want to see — never plays.
  const [wi, setWi] = useState(-1);
  const [clock, setClock] = useState(0);    // game clock within the live window
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(2);
  // Duel remembers which cards it has already seen face-up so a refresh doesn't
  // replay every reveal. Restarting has to remount it or the second run of a
  // demo shows no flips at all.
  const [run, setRun] = useState(0);

  const done = wi >= b.wins.length - 1 && clock >= b.winMax[b.wins.length - 1];

  const tick = useRef<(() => void) | null>(null);
  tick.current = () => {
    // Leaving pre-kickoff is its own step, so the first window's reveal gets a
    // frame of its own rather than being overwritten by the same tick's clock.
    if (wi < 0) { setWi(0); setClock(0); return; }
    const max = b.winMax[wi] ?? 0;
    const next = clock + BASE_RATE * speed * (TICK_MS / 1000);
    if (next < max) { setClock(next); return; }
    if (wi < b.wins.length - 1) { setWi(wi + 1); setClock(0); return; }
    setClock(max);
    setPlaying(false);
  };

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => tick.current?.(), TICK_MS);
    return () => clearInterval(id);
  }, [playing]);

  const restart = useCallback(() => {
    setWi(-1); setClock(0); setRun((r) => r + 1); setPlaying(true);
  }, []);

  const jump = useCallback((i: number) => {
    setPlaying(false);
    // Backwards means un-seeing reveals, which only a remount can do.
    setRun((r) => (i <= wi ? r + 1 : r));
    setWi(i); setClock(0);
  }, [wi]);

  // The board state at the current position. Windows before the live one are
  // complete; the live one is scrubbed to `clock`; later ones have no rows at
  // all, so Duel renders their opponent cards face-down.
  const { scores, revealed } = useMemo(() => {
    const out: WindowScore[] = [];
    const shown: RevealedPick[] = [];
    b.resolved.windows.forEach((w, i) => {
      if (i > wi) return;
      const at = i < wi ? (b.winMax[i] ?? 0) : clock;
      const rows: SlotScoreRow[] = [];
      let home = 0, away = 0;
      for (const s of w.slots) {
        const bank = banksAtClock(s.events, at);
        if (s.you) {
          const f = liveCardFlags(s.events, 'you', at);
          rows.push({ side: 'home', slot: String(s.slotIndex), slug: s.you.player.id, metric: s.you.metricId, score: bank.you, ...(f.hot ? { hot: true } : {}), ...(f.nuked ? { nuked: true } : {}) });
          home += bank.you;
        }
        if (s.their) {
          const f = liveCardFlags(s.events, 'their', at);
          rows.push({ side: 'away', slot: String(s.slotIndex), slug: s.their.player.id, metric: s.their.metricId, score: bank.their, ...(f.hot ? { hot: true } : {}), ...(f.nuked ? { nuked: true } : {}) });
          away += bank.their;
        }
      }
      out.push({ game_window: w.window.id, home_score: home, away_score: away, slot_scores: rows });
      for (const p of b.theirs) if (p.game_window === w.window.id) shown.push(p);
    });
    return { scores: out, revealed: shown };
  }, [b, wi, clock]);

  const winStatus = useCallback((id: string) => {
    const i = b.wins.indexOf(id);
    if (i < 0 || i > wi) return 'SEALED';
    if (i < wi) return 'FINAL';
    return clock >= (b.winMax[wi] ?? 0) ? 'FINAL' : '● LIVE';
  }, [b, wi, clock]);

  // Each duel's game and play log, rendered by Duel directly under that duel's
  // card pair. Windows that haven't kicked off get nothing — there is no game to
  // show and no plays to log, and an empty expander on a sealed window invites
  // taps that do nothing.
  const slotDetail = useCallback((win: string, slot: string) => {
    const i = b.wins.indexOf(win);
    if (i < 0 || i > wi) return null;
    const s = b.resolved.windows[i]?.slots.find((x) => String(x.slotIndex) === slot);
    if (!s || (!s.you && !s.their)) return null;
    // A finished window shows its whole game; the live one shows only as far as
    // the clock has reached.
    const at = i < wi ? (b.winMax[i] ?? 0) : clock;
    return <SlotDetail slot={s} clock={at} youName={b.youName} oppName={b.oppName} />;
  }, [b, wi, clock]);

  const live = scores[wi];
  const mm = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
      <Card style={{ marginBottom: 10, borderColor: t.you }}>
        <Display size={15}>{b.youName} vs {b.oppName}</Display>
        <Mono size={9.5} tone="warn" style={{ marginTop: 4 }}>
          DEMO — DRIP TEST LEAGUE, REAL 2025 WEEK {WEEK}. NOT YOUR MATCHUP.
        </Mono>
        <Text style={{ fontSize: 12, color: t.mid, lineHeight: 18, marginTop: 8 }}>
          Real play-by-play through the real engine, on the live board’s own
          components. Watch SUN 1PM for two nukes, and MNF for the hot streak
          that decides it.
        </Text>
      </Card>

      <Card style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Mono size={11} weight="700" tone="you" track={0.14}>
            {wi < 0 ? 'PRE-KICKOFF · SEALED' : `${b.label[b.wins[wi]] ?? b.wins[wi]} · ${mm(Math.min(clock, b.winMax[wi] ?? 0))}`}
          </Mono>
          <Mono size={11} weight="700">
            {live ? `${Math.round(scores.reduce((n, s) => n + s.home_score, 0) * 10) / 10} – ${Math.round(scores.reduce((n, s) => n + s.away_score, 0) * 10) / 10}` : '0 – 0'}
          </Mono>
        </View>

        {/* Window progress, and a way to jump straight to a moment. */}
        <View style={{ flexDirection: 'row', gap: 4, marginBottom: 10 }}>
          <Pressable
            onPress={() => jump(-1)}
            style={{
              flex: 1, paddingVertical: 6, borderRadius: 5, alignItems: 'center',
              backgroundColor: wi < 0 ? t.you : t.surface,
              borderWidth: StyleSheet.hairlineWidth, borderColor: wi < 0 ? t.you : t.bd,
            }}
          >
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: wi < 0 ? t.onAccent : t.dim }}>
              SEALED
            </Text>
          </Pressable>
          {b.wins.map((w, i) => (
            <Pressable
              key={w}
              onPress={() => jump(i)}
              style={{
                flex: 1, paddingVertical: 6, borderRadius: 5, alignItems: 'center',
                backgroundColor: i < wi ? t.sh : i === wi ? t.you : t.surface,
                borderWidth: StyleSheet.hairlineWidth, borderColor: i === wi ? t.you : t.bd,
              }}
            >
              <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: i === wi ? t.onAccent : t.dim }}>
                {w.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Btn
            label={playing ? '❚❚ PAUSE' : done ? '↻ REPLAY' : '▶ PLAY'}
            primary
            onPress={() => { if (playing) setPlaying(false); else if (done) restart(); else setPlaying(true); }}
          />
          <Btn label="↺ RESTART" onPress={restart} />
        </View>

        <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
          {SPEEDS.map((s) => (
            <Btn key={s} label={`${s}×`} small active={speed === s} onPress={() => setSpeed(s)} />
          ))}
        </View>
      </Card>

      <Duel
        key={`replay-${run}`}
        mine={b.mine}
        theirs={revealed}
        pool={b.pool}
        scores={scores}
        youAreHome
        status={done ? 'final' : 'live'}
        week={WEEK}
        winLabel={(id) => b.label[id] ?? id.toUpperCase()}
        winStatus={winStatus}
        slotDetail={slotDetail}
      />
    </ScrollView>
  );
}

/** One duel's detail, sitting directly under its card pair: the field its
 *  players' game is on, and the play log behind their banks.
 *
 *  COLLAPSED BY DEFAULT, like the web's FieldCollapse. A window can hold three
 *  duels and each carries a field plus a log; expanded by default that is a
 *  board nobody can see the shape of. The toggle keeps the cards — which ARE the
 *  board — as the thing you scroll through, with the explanation one tap away. */
function SlotDetail({ slot, clock, youName, oppName }: {
  slot: ResolvedMatchup['windows'][number]['slots'][number];
  clock: number; youName: string; oppName: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  // Only what has happened by now — the log is a record, not a spoiler.
  const events = slot.events.filter((e) => e.clock <= clock);
  // The two players are often in the SAME game (a QB against the opposing RB),
  // where one field covers both. Dedupe by team so that duel shows one field,
  // not the same one twice.
  const games = [...new Set([slot.you?.player.team, slot.their?.player.team].filter(Boolean) as string[])];
  if (!games.length) return null;

  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: open ? t.you : t.bd, backgroundColor: open ? alpha(t.you, 12) : 'transparent' }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, color: open ? t.you : t.dim }}>
          {open ? 'HIDE ▲' : `● FIELD ▾  ${games.join(' · ')}`}
        </Text>
      </Pressable>

      {open && (
        <View style={{ marginTop: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Mono size={9.5} weight="700" tone="you">{slot.you?.player.name ?? '—'}</Mono>
            <Mono size={8} tone="faint">VS</Mono>
            <Mono size={9.5} weight="700" style={{ color: t.opp }}>{slot.their?.player.name ?? 'unopposed'}</Mono>
          </View>
          {games.map((tm) => <FieldView key={tm} week={WEEK} team={tm} clock={clock} />)}
          <PlayLog events={events} gameLabel={games.join(' · ')} youName={youName} theirName={oppName} />
        </View>
      )}
    </View>
  );
}

function Btn({ label, onPress, primary, small, active }: {
  label: string; onPress: () => void; primary?: boolean; small?: boolean; active?: boolean;
}) {
  const t = useTheme();
  const on = primary || active;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, alignItems: 'center', paddingVertical: small ? 7 : 10, borderRadius: 6,
        backgroundColor: on ? t.you : t.surface,
        borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: small ? 9 : 10, fontWeight: '700', letterSpacing: 0.6, color: on ? t.onAccent : t.dim }}>
        {label}
      </Text>
    </Pressable>
  );
}
