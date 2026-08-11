// A scripted window, for showing the board's moments on demand.
//
// WHY THIS EXISTS: the flip, the nuke burst and the hot glow are all driven by
// live state — an opponent's card turning face-up at kickoff, `nuked`/`hot`
// arriving on a slot row from the worker. Outside a live slate none of them can
// be made to happen, which makes them impossible to show, review, or check for
// regressions on any day that isn't a game day.
//
// IT DRIVES THE REAL BOARD. This screen feeds hand-written props to the SAME
// `Duel` component the live board renders, which renders the same `CardFace`,
// which runs the same animations. Nothing here is a mock-up of the board or a
// second copy of its layout — if a moment looks right in this screen it looks
// right on Thursday, and if one breaks, this breaks with it. That property is
// the entire point, and it's worth protecting: resist the temptation to "just
// tweak" the demo's own copy of anything.
//
// The data is real players with real headshots and real metric ids, but the
// matchup is invented, so the screen says so plainly at the top. Nobody should
// be able to mistake this for their week.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RevealedPick, WindowScore, PoolPlayer, SlotScoreRow } from '@drip/core/data/liveApi';
import { slugMeta } from '@drip/core/data/slugMeta';
import { useTheme, MONO } from '../theme.native';
import { Card, Display, Mono } from '../ui/prims';
import { Duel } from './LiveBoard';

const WIN = 'early';
const WEEK = 1;

interface Seat { slug: string; full: string; metric: string; score: number }

// Real slugs, so headshots and team logos resolve exactly as they do live.
const MINE: Seat[] = [
  { slug: 'patrick-mahomes', full: 'Patrick Mahomes', metric: 'pass', score: 21.4 },
  { slug: 'saquon-barkley', full: 'Saquon Barkley', metric: 'rush', score: 14.8 },
  { slug: 'justin-jefferson', full: 'Justin Jefferson', metric: 'recyd', score: 9.6 },
];
const THEIRS: Seat[] = [
  { slug: 'josh-allen', full: 'Josh Allen', metric: 'pass', score: 18.2 },
  { slug: 'christian-mccaffrey', full: 'Christian McCaffrey', metric: 'rush', score: 16.1 },
  { slug: 'jamarr-chase', full: 'Ja’Marr Chase', metric: 'recyd', score: 12.7 },
];

const pool: Record<string, PoolPlayer> = Object.fromEntries(
  [...MINE, ...THEIRS].map((s) => [s.slug, { slug: s.slug, full: s.full, pos: slugMeta(s.slug).pos }]),
);

const pick = (s: Seat, i: number, who: string): RevealedPick => ({
  app_user_id: who, game_window: WIN, roster_slot: String(i),
  player_slug: s.slug, metric_id: s.metric, locked: true,
});

const MY_PICKS = MINE.map((s, i) => pick(s, i, 'you'));
const THEIR_PICKS = THEIRS.map((s, i) => pick(s, i, 'them'));

/** Each beat is a whole board state, not a delta — so stepping to a beat gives
 *  the same result whether you arrived by autoplay, by tapping forward, or by
 *  replaying. Deltas would make the demo's behaviour depend on its history,
 *  which is exactly the bug class a demo exists to rule out. */
interface Beat {
  name: string;
  note: string;
  /** Milliseconds to dwell here before autoplay advances. */
  hold: number;
  theirs: RevealedPick[];
  status: string;
  rows: SlotScoreRow[];
}

const row = (side: 'home' | 'away', i: number, s: Seat, score: number, extra: Partial<SlotScoreRow> = {}): SlotScoreRow =>
  ({ side, slot: String(i), slug: s.slug, metric: s.metric, score, ...extra });

const scored = (f: number, extra: Record<number, Partial<SlotScoreRow>> = {}): SlotScoreRow[] => [
  ...MINE.map((s, i) => row('home', i, s, Math.round(s.score * f * 10) / 10, extra[i] ?? {})),
  ...THEIRS.map((s, i) => row('away', i, s, Math.round(s.score * f * 10) / 10)),
];

const BEATS: Beat[] = [
  {
    name: 'SEALED', hold: 2200,
    note: 'Pre-kickoff. You see your own three; theirs are face-down — the game’s whole premise.',
    theirs: [], status: 'scheduled', rows: [],
  },
  {
    name: 'KICKOFF', hold: 2600,
    note: 'The window opens and their cards turn over — ct-flipin, 550ms, rotateY 180°→0. The chip starts pulsing.',
    theirs: THEIR_PICKS, status: 'live', rows: [],
  },
  {
    name: 'SCORING', hold: 2400,
    note: 'Banks land and every score pops as it changes.',
    theirs: THEIR_PICKS, status: 'live', rows: scored(0.45),
  },
  {
    name: 'HOT', hold: 2600,
    note: 'The worker flags a slot hot; the card breathes until it cools.',
    theirs: THEIR_PICKS, status: 'live', rows: scored(0.75, { 1: { hot: true } }),
  },
  {
    name: 'NUKE', hold: 3400,
    note: 'A nuke lands on your QB — the card takes the hit and the burst plays over it.',
    theirs: THEIR_PICKS, status: 'live', rows: scored(0.9, { 0: { nuked: true }, 1: { hot: true } }),
  },
  {
    name: 'FINAL', hold: 3200,
    note: 'Window closed, banks settled.',
    theirs: THEIR_PICKS, status: 'final', rows: scored(1),
  },
];

export function DemoBoard() {
  const t = useTheme();
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Remounting Duel resets the "which slots have I already seen face-up"
  // bookkeeping that stops a reveal replaying on every refresh. Stepping
  // BACKWARD has to bump this or the flip is a one-time event per app launch and
  // the second run of a demo shows nothing.
  const [run, setRun] = useState(0);

  // Going backwards remounts; going forwards never does. So the reveal replays
  // by returning to SEALED and stepping forward — which is also the only place
  // the reveal means anything, since a flip is the SEALED→KICKOFF edge rather
  // than a property of the KICKOFF beat.
  const go = useCallback((next: number) => {
    const n = Math.max(0, Math.min(BEATS.length - 1, next));
    if (n <= at) setRun((r) => r + 1);
    setAt(n);
  }, [at]);

  useEffect(() => {
    if (!playing) return;
    if (at >= BEATS.length - 1) { setPlaying(false); return; }
    const id = setTimeout(() => setAt((cur) => Math.min(cur + 1, BEATS.length - 1)), BEATS[at].hold);
    return () => clearTimeout(id);
  }, [at, playing]);

  const beat = BEATS[at];

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
      <Card style={{ marginBottom: 10, borderColor: t.you }}>
        <Display size={15}>Demo window</Display>
        <Mono size={9.5} tone="warn" style={{ marginTop: 4 }}>
          NOT YOUR MATCHUP — a scripted window, real players, invented result.
        </Mono>
        <Text style={{ fontSize: 12, color: t.mid, lineHeight: 18, marginTop: 8 }}>
          Every moment below is the live board’s own component running its own
          animation. Nothing here is a mock-up.
        </Text>
      </Card>

      <Card style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Mono size={11} weight="700" tone="you" track={0.14}>{at + 1}/{BEATS.length} · {beat.name}</Mono>
        </View>
        <Text style={{ fontSize: 12.5, color: t.text, lineHeight: 18, minHeight: 54 }}>{beat.note}</Text>

        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
          <Btn label="◀ BACK" onPress={() => { setPlaying(false); go(at - 1); }} disabled={at === 0} />
          <Btn
            label={playing ? '❚❚ PAUSE' : at >= BEATS.length - 1 ? '↻ REPLAY' : '▶ PLAY'}
            primary
            onPress={() => {
              if (playing) { setPlaying(false); return; }
              if (at >= BEATS.length - 1) { go(0); }
              setPlaying(true);
            }}
          />
          <Btn label="NEXT ▶" onPress={() => { setPlaying(false); go(at + 1); }} disabled={at >= BEATS.length - 1} />
        </View>
      </Card>

      <Duel
        key={`demo-${run}`}
        mine={MY_PICKS}
        theirs={beat.theirs}
        pool={pool}
        scores={[{
          game_window: WIN,
          home_score: beat.rows.filter((r) => r.side === 'home').reduce((n, r) => n + r.score, 0),
          away_score: beat.rows.filter((r) => r.side === 'away').reduce((n, r) => n + r.score, 0),
          slot_scores: beat.rows,
        }] as WindowScore[]}
        youAreHome
        status={beat.status}
        week={WEEK}
        winLabel={() => 'SUN 1PM · DEMO'}
      />
    </ScrollView>
  );
}

function Btn({ label, onPress, disabled, primary }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 6,
        backgroundColor: primary ? t.you : t.surface,
        borderWidth: StyleSheet.hairlineWidth, borderColor: primary ? t.you : t.bd,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: primary ? t.onAccent : t.dim }}>
        {label}
      </Text>
    </Pressable>
  );
}
