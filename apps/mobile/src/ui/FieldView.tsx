// The field visual, natively — a drive chart for one NFL game, driven by the
// same clock as the rest of the board.
//
// Ported from the web's FieldView (src/app/FieldView.tsx) at the SAME geometry:
// a 400×130 user-space viewBox, end zones 26 wide, the 100 yards between them,
// 21 yard lines. Keeping the numbers identical means the two fields can be
// compared side by side and any difference is a real difference.
//
// The play-selection logic is a straight port and deliberately so: which play is
// current, where the ball ends up (the NEXT play's start is authoritative — it
// accounts for penalties and spots), where the first-down line goes, whether the
// game is over. Those rules were learned from real feeds, including the one that
// read a live halftime as game over, and re-deriving them here would be inviting
// the same bugs back.
//
// THIS IS `fvdraw` FINALLY GETTING ITS SUBJECT. I said the stroke-draw animation
// had no port because there was no field to draw on; here is the field. One
// honest caveat: react-native-svg props cannot go through the native driver, so
// unlike every other animation in this app the arc draw and the ball slide run
// on the JS thread (useNativeDriver: false). They are short and small, and the
// alternative — faking a stroke reveal with an overlaid mask — would be worse.
// It is still the one place where a busy JS tick could show.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, View, StyleSheet } from 'react-native';
import Svg, { Circle, G, Image as SvgImage, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { gameFeedFor, type GamePlay, type TeamGameFeed } from '@drip/core/data/gameFeed';
import { teamLogo } from '@drip/core/data/media';
import { playPath, arcControlY, playSide, playSideDy } from '@drip/core/engine/playPath';
import { teamColor } from '@drip/core/data/teamColors';
import { storeGet, storeSet } from '@drip/core/platform';
import { useTheme, MONO, alpha, mix } from '../theme.native';

// Geometry (SVG user units) — identical to the web's.
const W = 400, H = 130, EZ = 26, FX = EZ, FW = W - 2 * EZ, TOP = 12, BOT = H - 16;
const MID = (TOP + BOT) / 2;
const ORD = ['', '1st', '2nd', '3rd', '4th'];

export type PlaySide = 'you' | 'their' | 'both';

const fmtQClock = (c: number): string => {
  if (c >= 3600) { const rem = 600 - ((c - 3600) % 600); return `OT ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`; }
  const q = Math.floor(c / 900) + 1; const rem = 900 - (c % 900);
  return `Q${q} ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
};

const spotText = (yte: number, tm: string, away: string, home: string): string => {
  if (yte === 50) return 'at 50';
  const opp = tm === away ? home : away;
  return yte > 50 ? `at ${tm} ${100 - yte}` : `at ${opp} ${yte}`;
};

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

/** Length of the path we're about to draw, so strokeDashoffset can run from it
 *  to zero. The web sets `pathLength={1}` and lets the browser normalise;
 *  react-native-svg doesn't implement pathLength, so the length is measured
 *  here — sampled for the quadratic, exact for the straight line. */
function pathLen(x1: number, x2: number, curved: boolean, y1: number = MID, y2: number = MID): number {
  if (!curved) return Math.hypot(x2 - x1, y2 - y1);
  // The SAME control point AND the same endpoints the path uses (v0.333.0,
  // v0.335.0). The apex scales with the throw and the far end now sits on the
  // side the play text named, so a length measured against a flat centred arc
  // would come up short and leave the stroke drawn only part way.
  const cx = (x1 + x2) / 2, cy = arcControlY(x1, x2, (y1 + y2) / 2, TOP);
  let len = 0, px = x1, py = y1;
  for (let i = 1; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
    len += Math.hypot(x - px, y - py); px = x; py = y;
  }
  return len;
}

export function FieldView({ week, team, clock, side }: {
  week: number; team?: string | null; clock: number; side?: PlaySide | null;
}) {
  const feed = gameFeedFor(week, team);
  if (!feed) return null;
  return <Field feed={feed} clock={clock} side={side ?? null} />;
}

function Field({ feed, clock, side }: { feed: TeamGameFeed; clock: number; side: PlaySide | null }) {
  const t = useTheme();
  const { away, home, plays } = feed;

  // ↔ mirrors the field to match the viewer's broadcast. Remembered per game,
  // through the platform shim rather than localStorage.
  const [flip, setFlip] = useState(() => storeGet(`fvflip:${feed.key}`) === '1');
  const toggleFlip = () => setFlip((f) => { const n = !f; storeSet(`fvflip:${feed.key}`, n ? '1' : '0'); return n; });
  const mx = (x: number) => (flip ? W - x : x);

  const idx = useMemo(() => {
    let i = -1;
    for (let j = 0; j < plays.length; j++) { if (plays[j].c <= clock) i = j; else break; }
    return i;
  }, [plays, clock]);
  const cur: GamePlay | null = idx >= 0 ? plays[idx] : null;
  const nxt: GamePlay | null = idx + 1 < plays.length ? plays[idx + 1] : null;
  // "No next play" alone reads a live halftime as game over — trust the feed's
  // own state when it has one, else require the shown play to be in late Q4.
  const over = cur != null && !nxt && (feed.st ? feed.st === 'post' : cur.c >= 3300);

  const xOf = (yte: number, tm: string) => FX + ((tm === away ? 100 - yte : yte) / 100) * FW;

  const ballTm = nxt ? nxt.tm : cur ? (cur.tm2 ?? cur.tm) : null;
  const ballX = nxt ? xOf(nxt.yl, nxt.tm) : cur ? xOf(cur.yl2, cur.tm2 ?? cur.tm) : null;
  const attacksRight = ballTm === away;
  const fdX = nxt && nxt.dn > 0 && nxt.dist > 0 && nxt.dist < nxt.yl ? xOf(nxt.yl - nxt.dist, nxt.tm) : null;
  const redZone = !over && nxt != null && nxt.dn > 0 && nxt.yl <= 20;

  const accent = side === 'you' ? t.you : side === 'their' ? t.opp : side === 'both' ? t.warn : null;

  const isPassy = cur ? /Pass|Interception|Punt|Kickoff|Field Goal/.test(cur.ty) : false;
  const incomplete = cur ? /Incompletion/.test(cur.ty) : false;
  const INCOMPLETE_DEPTH = 12;
  const arc = cur && (cur.yl !== cur.yl2 || incomplete) ? {
    x1: mx(xOf(cur.yl, cur.tm)),
    x2: incomplete
      ? mx(xOf(Math.max(0, cur.yl - INCOMPLETE_DEPTH), cur.tm))
      : mx(xOf(cur.yl2, cur.tm2 ?? cur.tm)),
    color: accent ?? (cur.sc ? t.warn : cur.to ? t.fx.nuke : t.dimstrong),
  } : null;
  // Through playPath (v0.332.0) so the two ports cannot drift on geometry
  // they each used to own a copy of — and so `overlaps`, the property that
  // made a returned kick look like a doubled line, is asserted rather than
  // eyeballed. See engine/playPath.
  const { catchX, carrying, overlaps } = playPath(cur, arc?.x1 ?? 0, arc?.x2 ?? 0, xOf);
  /** The CARRIED phase rides its own lane just under the flight path
   *  (v0.332.0). Both were drawn at MID, which is fine for a pass — the
   *  run-after continues the same way, so air and carry meet end to end — and
   *  wrong for a KICK, where the returner runs back the way the ball came and
   *  the runback retraced the arc in the same colour at the same width and y.
   *  Founder: "we've got a double line thing going on." Measured overlap at the
   *  shared geometry: 41.8px on a punt, 87.0px on a kickoff. See the web's
   *  FieldView for the full note — this is a port and must not drift from it. */
  const CARRY_DY = 4;
  // The play draws on the side its text names (v0.335.0) — see the web view.
  // The snap stays on the centre line; the far end moves to the named side.
  const SIDE_LANE = (BOT - TOP) * 0.22;
  const sideDy = playSideDy(playSide(cur?.txt), flip ? !attacksRight : attacksRight, SIDE_LANE);
  const endY = MID + sideDy;
  // The lane is for a carry that DOUBLES BACK over its own flight, not for
  // every carry — see the web view. A pass's run-after continues the same way
  // and belongs in line with the arc.
  const carryY = (overlaps ? MID + CARRY_DY : MID) + sideDy;

  const situation = over ? 'FINAL'
    : !cur ? 'AWAITING KICKOFF'
    : nxt && nxt.dn > 0 ? `${ORD[nxt.dn].toUpperCase()} & ${nxt.dist} · ${spotText(nxt.yl, nxt.tm, away, home).toUpperCase()}`
    : (cur.sc ? (/TOUCHDOWN/i.test(cur.txt) ? 'TOUCHDOWN' : 'SCORE') : (nxt ? nxt.ty.toUpperCase() : ''));
  const score = cur ? { a: cur.as, h: cur.hs } : { a: 0, h: 0 };

  const awayCol = teamColor(away), homeCol = teamColor(home);
  const ballCol = ballTm ? teamColor(ballTm) : null;
  const ezFill = (tc: ReturnType<typeof teamColor>) => tc ? mix(tc.c, 72, t.surface) : mix(t.dim, 16, t.surface);
  const ezText = (tc: ReturnType<typeof teamColor>) => tc?.t ?? t.dim;
  const ezAwayX = flip ? W - EZ : 0, ezHomeX = flip ? 0 : W - EZ;

  // ── fvdraw: the arc draws itself, keyed to the play so it replays per play ──
  const drawKey = cur ? String(cur.pid ?? cur.c) : '';
  const air = useRef(new Animated.Value(0)).current;
  const run = useRef(new Animated.Value(0)).current;
  const airLen = arc ? pathLen(arc.x1, catchX ?? arc.x2, isPassy, MID, endY) : 0;
  // + the drop into the carry lane, or the stroke animation runs out before the
  // runback is fully drawn and the line stops mid-field.
  const runLen = arc && catchX != null ? pathLen(catchX, arc.x2, false, endY, endY) + (overlaps ? CARRY_DY : 0) : 0;
  useEffect(() => {
    if (!arc) return;
    air.setValue(0); run.setValue(0);
    Animated.sequence([
      // .55s then .35s at .5s — the web's two-stage timing, so a completed pass
      // reads as "thrown, then carried" rather than one smear.
      Animated.timing(air, { toValue: 1, duration: 550, useNativeDriver: false }),
      Animated.timing(run, { toValue: 1, duration: 350, useNativeDriver: false }),
    ]).start();
  }, [drawKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ball marker slides to each new spot rather than teleporting.
  const bx = useRef(new Animated.Value(ballX == null ? 0 : mx(ballX))).current;
  useEffect(() => {
    if (ballX == null) return;
    Animated.timing(bx, { toValue: mx(ballX), duration: 550, useNativeDriver: false }).start();
  }, [ballX, flip]); // eslint-disable-line react-hooks/exhaustive-deps

  const strip = (abbr: string, hasBall: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: hasBall ? t.text : t.dim }}>{abbr}</Text>
      {hasBall && !over && <Text style={{ fontSize: 8 }}>🏈</Text>}
    </View>
  );

  return (
    <View style={{ marginTop: 5, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: accent ? mix(accent, 55, t.bd) : t.bd, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6 }}>
      {/* score + clock strip */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginBottom: 3 }}>
        {strip(away, ballTm === away)}
        <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.text }}>{score.a}</Text>
        {/* The LAST PLAY's clock, not the playback clock — a window clock can
            overshoot the real game and read a Q4 game as OT. */}
        <Text style={{ fontFamily: MONO, fontSize: 9, color: t.faint }}>{over ? 'FINAL' : fmtQClock(cur ? cur.c : clock)}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.text }}>{score.h}</Text>
        {strip(home, ballTm === home)}
        <Pressable
          onPress={toggleFlip}
          hitSlop={8}
          style={{ position: 'absolute', right: 0, borderWidth: StyleSheet.hairlineWidth, borderColor: flip ? t.you : t.bd, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: flip ? t.you : t.faint }}>↔</Text>
        </Pressable>
      </View>

      {/* The web tilts the field back — `perspective: 560` on the wrapper and
          `rotateX(20deg)` on the svg, hinged at the bottom edge. It is the
          difference between a diagram and a field you are looking down at.
          transformOrigin is what makes it hinge rather than pivot about the
          middle; without it the far end swings up instead of away. */}
      <View style={{ transform: [{ perspective: 560 }, { rotateX: '20deg' }], transformOrigin: '50% 100%' }}>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ aspectRatio: W / H }}>
        {/* turf + end zones */}
        <Rect x={FX} y={TOP} width={FW} height={BOT - TOP} fill={mix(t.you, 5, t.surface)} />
        <Rect x={ezAwayX} y={TOP} width={EZ} height={BOT - TOP} fill={ezFill(awayCol)} />
        <Rect x={ezHomeX} y={TOP} width={EZ} height={BOT - TOP} fill={ezFill(homeCol)} />
        {redZone && (
          <Rect x={(flip ? !attacksRight : attacksRight) ? W - EZ : 0} y={TOP} width={EZ} height={BOT - TOP} fill={alpha(t.fx.nuke, 32)} />
        )}
        <SvgText x={ezAwayX + EZ / 2} y={MID} fill={ezText(awayCol)} fontSize={9} fontWeight="700" textAnchor="middle"
          transform={`rotate(${ezAwayX < W / 2 ? -90 : 90} ${ezAwayX + EZ / 2} ${MID})`}>{away}</SvgText>
        <SvgText x={ezHomeX + EZ / 2} y={MID} fill={ezText(homeCol)} fontSize={9} fontWeight="700" textAnchor="middle"
          transform={`rotate(${ezHomeX < W / 2 ? -90 : 90} ${ezHomeX + EZ / 2} ${MID})`}>{home}</SvgText>

        {/* yard lines + numbers */}
        {Array.from({ length: 21 }, (_, i) => (
          <Line key={i} x1={FX + (i / 20) * FW} y1={TOP} x2={FX + (i / 20) * FW} y2={BOT}
            stroke={i % 2 ? alpha(t.bd, 55) : t.bd} strokeWidth={i === 0 || i === 20 ? 1.6 : 0.7} />
        ))}
        {[10, 20, 30, 40, 50, 40, 30, 20, 10].map((n, i) => (
          <SvgText key={i} x={FX + ((i + 1) / 10) * FW} y={BOT - 4} fill={t.faint} fontSize={6.5} textAnchor="middle">{n}</SvgText>
        ))}

        {/* first-down line */}
        {!over && fdX != null && <Line x1={mx(fdX)} y1={TOP} x2={mx(fdX)} y2={BOT} stroke={t.warn} strokeWidth={1.4} opacity={0.9} />}

        {/* last-play arc */}
        {arc && (
          <G>
            <AnimatedPath
              d={isPassy
                ? `M ${arc.x1} ${MID} Q ${(arc.x1 + (catchX ?? arc.x2)) / 2} ${arcControlY(arc.x1, catchX ?? arc.x2, (MID + endY) / 2, TOP)} ${catchX ?? arc.x2} ${endY}`
                : `M ${arc.x1} ${MID} L ${arc.x2} ${endY}`}
              fill="none" stroke={arc.color} strokeWidth={1.8} strokeLinecap="round"
              strokeDasharray={`${airLen}`}
              strokeDashoffset={air.interpolate({ inputRange: [0, 1], outputRange: [airLen, 0] }) as unknown as number}
            />
            {carrying && (
              <AnimatedPath
                d={overlaps
                  ? `M ${catchX} ${endY} L ${catchX} ${carryY} L ${arc.x2} ${carryY}`
                  : `M ${catchX} ${endY} L ${arc.x2} ${endY}`}
                fill="none" stroke={arc.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={`${runLen}`}
                strokeDashoffset={run.interpolate({ inputRange: [0, 1], outputRange: [runLen, 0] }) as unknown as number}
              />
            )}
            {cur && teamLogo(cur.tm)
              ? <SvgImage href={{ uri: teamLogo(cur.tm)! }} x={arc.x1 - 5.5} y={MID - 5.5} width={11} height={11} />
              : <Circle cx={arc.x1} cy={MID} r={3} fill={arc.color} />}
            {incomplete
              ? <SvgText x={arc.x2} y={endY + 3} fill={t.fx.nuke} fontSize={9} fontWeight="800" textAnchor="middle">✕</SvgText>
              : <SvgText x={arc.x2} y={(carrying ? carryY : endY) + 2.5} fontSize={7} textAnchor="middle">🏈</SvgText>}
          </G>
        )}

        {/* line of scrimmage + ball marker */}
        {ballX != null && !over && (
          <AnimatedG x={bx as unknown as number}>
            <Line x1={0} y1={TOP} x2={0} y2={BOT} stroke={ballCol?.c ?? accent ?? t.dimstrong} strokeWidth={1.4} />
            <Circle cx={0} cy={MID} r={10.5} fill={ballCol ? mix(ballCol.c, 30, t.surface) : t.surface} stroke={ballCol?.c ?? accent ?? t.dimstrong} strokeWidth={1.4} />
            <SvgText x={0} y={MID + 2.5} fill={t.text} fontSize={6} fontWeight="700" textAnchor="middle">{ballTm}</SvgText>
            {ballTm && teamLogo(ballTm) && <SvgImage href={{ uri: teamLogo(ballTm)! }} x={-10} y={MID - 10} width={20} height={20} />}
            <SvgText x={(flip ? !attacksRight : attacksRight) ? 15 : -15} y={MID + 2.5} fill={ballCol?.c ?? t.faint} fontSize={8} fontWeight="700" textAnchor="middle">
              {(flip ? !attacksRight : attacksRight) ? '▶' : '◀'}
            </SvgText>
          </AnimatedG>
        )}
      </Svg>
      </View>

      {/* situation chip + play text */}
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: t.surface }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, color: accent ?? (cur?.sc ? t.warn : t.you) }}>{situation}</Text>
        </View>
      </View>
      {!!cur && (
        <Text style={{ fontSize: 10.5, lineHeight: 14, color: t.text, textAlign: 'center', marginTop: 4 }}>
          {accent ? <Text style={{ color: accent }}>● </Text> : null}{cur.txt}
        </Text>
      )}
    </View>
  );
}
