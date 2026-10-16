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
import { stoppageLabel, liveClockLabel } from '@drip/core/data/gameView';
import { useEffect, useMemo, useRef, useState } from 'react';
import { stripSlugTag, normTeam } from '@drip/core/data/slugMeta';
import { Animated, Image, Pressable, ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Circle, Ellipse, G, Image as SvgImage, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { gameFeedFor, weekBoxGames, latestPlay, type GamePlay, type TeamGameFeed } from '@drip/core/data/gameFeed';
import { kickoffLabel } from '@drip/core/data/nflSlate';
import { gameBoxScore, boxTabRows } from '@drip/core/engine/boxScore';
import { projectedBox, type ProjectedRow } from '@drip/core/engine/projectedBox';
import { teamLogo, headshot } from '@drip/core/data/media';
import { playPath, playSide, playSideDy, targetMarkY } from '@drip/core/engine/playPath';
import {
  FIELD_W, FIELD_EZ, FIELD_TOP, FIELD_BOT, PROJ_H, BLEED_OVER, POST_COLOR,
  fieldPt, fieldY, fieldScale, fieldXRange, fieldQuad, projPolyline, projFlight, goalPost, endZoneLabel, type ProjPath,
} from '@drip/core/engine/fieldPerspective';
import { teamColor } from '@drip/core/data/teamColors';
import { storeGet, storeSet } from '@drip/core/platform';
import { useTheme, MONO, alpha, mix, fs, fsTight } from '../theme.native';
import { Overlay } from './Overlay';
import { openPlayerCard } from './PlayerCardSheet';
import { PlayByPlaySheet } from './PlayByPlaySheet';

// Geometry (SVG user units) — identical to the web's: the flat field is
// core's, and fieldPerspective projects it into the VH-tall drawing.
const W = FIELD_W, EZ = FIELD_EZ, FX = EZ, FW = W - 2 * EZ, TOP = FIELD_TOP, BOT = FIELD_BOT;
const MID = (TOP + BOT) / 2, VH = PROJ_H;
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
const AnimatedLine = Animated.createAnimatedComponent(Line);

/** Who has the ball on the shown play — drawn at the spot with his headshot
 *  and name (v0.390.3, Sleeper's K. Walker marker). The host resolves it
 *  from the box score; null draws the plain possession badge. */
export type Carrier = { slug: string; name: string } | null;

export function FieldView({ week, team, clock, side, carrierOf, pre, bleed = true }: {
  week: number; team?: string | null; clock: number; side?: PlaySide | null; carrierOf?: (p: GamePlay) => Carrier;
  /** Edge to edge, Sleeper's way (v0.730.0; the default since v0.730.5): the card spans the screen and the
   *  field runs BLEED_OVER past each edge, so its near corners are clipped. false keeps the inset card. */
  bleed?: boolean;
  /** A GAME STILL TO KICK OFF (v0.696.4, founder: "Show the field with the start time and projected point leaders"):
   *  the slate's fixture, when the feed store has nothing for it yet. The card draws the empty field with the
   *  kickoff stamped on it and each side's three highest-projected men under it. */
  pre?: { away: string; home: string; kickoff?: string | null } | null;
}) {
  const feed = gameFeedFor(week, team);
  if (!feed) {
    if (!pre) return null;
    const a = normTeam(pre.away), h = normTeam(pre.home);
    return <Field feed={{ key: `${a}@${h}`, away: a, home: h, plays: [], st: 'pre', gid: null, kickoff: pre.kickoff ?? null }} clock={clock} side={side ?? null} week={week} carrierOf={carrierOf} bleed={bleed} />;
  }
  return <Field feed={feed} clock={clock} side={side ?? null} week={week} carrierOf={carrierOf} bleed={bleed} />;
}

function Field({ feed, clock, side, week, carrierOf, bleed }: { feed: TeamGameFeed; clock: number; side: PlaySide | null; week: number; carrierOf?: (p: GamePlay) => Carrier; bleed: boolean }) {
  const t = useTheme();
  // BLEED: where this card sits in the window, so the drawing can be widened
  // to the screen plus BLEED_OVER each side and shifted back to the edge.
  const { width: winW } = useWindowDimensions();
  const holderRef = useRef<View>(null);
  const [holderX, setHolderX] = useState<number | null>(null);
  const [holderR, setHolderR] = useState(0);   // the holder's gap to the screen's right edge
  const measureHolder = () => holderRef.current?.measureInWindow((x, _y, w) => { setHolderX(x); setHolderR(Math.max(0, winW - x - w)); });
  const bleedW = bleed && holderX != null ? winW * (1 + 2 * BLEED_OVER) : null;
  // THE BOX GOES EDGE TO EDGE TOO (v0.730.5, founder: "expand the field and the box it is in so the bottom
  // corners just get clipped by the screen like sleeper"): the card is shifted back to the screen's left edge
  // and made the screen's width; the field inside it is wider still. Its controls keep to the holder's own
  // width (v0.730.6: the padding is the holder's x plus PAD), so a sheet that clips short of the screen's
  // edge — the All fields sheet does, ~9pt in — never cuts the ↔ or the strip, only the field's corners.
  const PAD = 8;
  const { away, home, plays } = feed;

  // ↔ mirrors the field to match the viewer's broadcast. Remembered per game,
  // through the platform shim rather than localStorage.
  const [boxOpen, setBoxOpen] = useState(false);
  const [pbpOpen, setPbpOpen] = useState(false); // ≣ PLAY BY PLAY sheet (v0.389.0)
  const [flip, setFlip] = useState(() => storeGet(`fvflip:${feed.key}`) === '1');
  const toggleFlip = () => setFlip((f) => { const n = !f; storeSet(`fvflip:${feed.key}`, n ? '1' : '0'); return n; });
  const mx = (x: number) => (flip ? W - x : x);

  const liveIdx = useMemo(() => {
    let i = -1;
    for (let j = 0; j < plays.length; j++) { if (plays[j].c <= clock) i = j; else break; }
    return i;
  }, [plays, clock]);
  // ‹ › STEP THE PLAYS (v0.390.2, founder: "a way to rewind or go forward
  // each play in the field view"). `pin` is an absolute play index; null
  // follows the clock (live). Pinned, the card draws that play exactly as it
  // drew it when it landed — the ball, the arc, the situation, the text —
  // and stays there while new plays arrive; › past the last play goes live.
  const [pin, setPin] = useState<number | null>(null);
  const idx = pin != null ? Math.min(pin, plays.length - 1) : liveIdx;
  const stepTo = (i: number) => setPin(i >= plays.length - 1 && i >= liveIdx ? null : Math.max(0, i));
  const cur: GamePlay | null = idx >= 0 ? plays[idx] : null;
  const nxt: GamePlay | null = idx + 1 < plays.length ? plays[idx + 1] : null;
  const carrier: Carrier = cur && carrierOf ? carrierOf(cur) : null;
  // "No next play" alone reads a live halftime as game over — trust the feed's
  // own state when it has one, else require the shown play to be in late Q4.
  const over = cur != null && !nxt && (feed.st ? feed.st === 'post' : cur.c >= 3300);
  // NOT STARTED (v0.696.4): no plays and not over — the kickoff is the clock, the field is clean, and the
  // projected leaders stand in for the box score until the first snap.
  const pre = plays.length === 0 && !over && feed.st !== 'post';
  const kickoffText = feed.kickoff ? kickoffLabel(Date.parse(feed.kickoff)).toUpperCase() : null;
  const leaders = useMemo(() => (pre ? projectedBox(home, away, week) : null), [pre, home, away, week]);
  const leaderCol = (tm: string, rows: ProjectedRow[]) => {
    const top = rows.filter((r) => r.proj != null).sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0)).slice(0, 3);
    return (
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {!!teamLogo(tm, { week }) && <Image source={{ uri: teamLogo(tm, { week })! }} style={{ width: 12, height: 12, borderRadius: 2 }} />}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', letterSpacing: 0.6, color: t.faint }}>{`${tm} · PROJECTED`}</Text>
        </View>
        {top.length === 0 && <Text style={{ fontFamily: MONO, fontSize: 9, color: t.faint }}>— no projections —</Text>}
        {top.map((r) => (
          <View key={r.slug} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: MONO, fontSize: fsTight(8), fontWeight: '700', color: t.faint, width: 24 }}>{r.pos}</Text>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: t.text }}>{boxName(r.slug)}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.dim }}>{(r.proj ?? 0).toFixed(1)}</Text>
          </View>
        ))}
      </View>
    );
  };

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
  // FIELD GOALS (v0.697.0, founder: "Made kicks should go through the uprights. Missed can finish in a dotted
  // line"): a made kick flies through the end zone and between the posts on the end line; a miss reaches the
  // goal line wide of them and finishes dotted to the end line.
  const fgKick = !!cur && /Field Goal/.test(cur.ty);
  const fgGood = fgKick && (!!cur!.sc || /\bGOOD\b/.test(cur!.txt));
  const fgDir = arc && cur ? (mx(xOf(0, cur.tm)) >= arc.x1 ? 1 : -1) : 1;
  if (arc && cur && fgKick) { const goal = mx(xOf(0, cur.tm)); arc.x2 = fgGood ? goal + fgDir * EZ : goal; }
  const fgTail = arc && fgKick && !fgGood ? arc.x2 + fgDir * (EZ - 4) : null;
  // Through playPath (v0.332.0) so the two ports cannot drift on geometry
  // they each used to own a copy of — and so `overlaps`, the property that
  // made a returned kick look like a doubled line, is asserted rather than
  // eyeballed. See engine/playPath.
  // The split point is mirrored exactly as the endpoints are (v0.390.5): the
  // arc's x1/x2 pass through mx(), so xOf here must too, or a ↔-flipped
  // field puts the catch on the wrong side of the snap.
  const { catchX, carrying, overlaps } = playPath(cur, arc?.x1 ?? 0, arc?.x2 ?? 0, (y, tm) => mx(xOf(y, tm)));
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
  const endY = fgKick ? (fgGood ? MID : MID + (((cur?.pid ?? 0) & 1) ? -1 : 1) * 15) : MID + sideDy;
  // The lane is for a carry that DOUBLES BACK over its own flight, not for
  // every carry — see the web view. A pass's run-after continues the same way
  // and belongs in line with the arc.
  const carryY = (overlaps ? MID + CARRY_DY : MID) + sideDy;

  const situation = over ? 'FINAL'
    : (stoppageLabel(feed) ?? (
    !cur ? 'AWAITING KICKOFF'
    : nxt && nxt.dn > 0 ? `${ORD[nxt.dn].toUpperCase()} & ${nxt.dist} · ${spotText(nxt.yl, nxt.tm, away, home).toUpperCase()}`
    : (cur.sc ? (/TOUCHDOWN/i.test(cur.txt) ? 'TOUCHDOWN' : 'SCORE') : (nxt ? nxt.ty.toUpperCase() : ''))));
  // Down & distance the CURRENT play was snapped on (the chip above shows the
  // resulting next snap). Goal-to-go when the sticks reach the goal line; dn 0
  // = kickoff/PAT, nothing to show. Ported from the web FieldView.
  const curDD = cur && cur.dn > 0 ? `${ORD[cur.dn]} & ${cur.dist >= cur.yl ? 'Goal' : cur.dist}` : null;
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
  // The play, projected (v0.730.0). Lengths are measured ON SCREEN, which
  // is what the stroke-draw animation runs over. A made field goal climbs to
  // the crossbar on its way to the end line: fgLift raises it, most at the end.
  const fgPost = fgGood && arc ? goalPost(fgDir > 0 ? W : 0) : null;
  const fgLift = fgPost ? (u: number) => u * u * (fgPost.base.y - fgPost.through.y) : undefined;
  const airEnd = arc ? (catchX ?? arc.x2) : 0;
  const airPath: ProjPath | null = !arc ? null : isPassy
    ? projFlight(arc.x1, MID, airEnd, endY, fgLift)
    : projPolyline([[arc.x1, MID], [arc.x2, endY]], fgLift);
  const runPath: ProjPath | null = arc && carrying && catchX != null
    ? projPolyline(overlaps ? [[catchX, endY], [catchX, carryY], [arc.x2, carryY]] : [[catchX, endY], [arc.x2, endY]])
    : null;
  const tailPath: ProjPath | null = arc && fgTail != null ? projPolyline([[arc.x2, endY], [fgTail, endY]]) : null;
  const playEnd = incomplete ? airPath?.end : (tailPath ?? runPath ?? airPath)?.end;
  const yMid = fieldY(MID);
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

  // THE STRIP READS FROM ACROSS THE ROOM (v0.607.0, web parity). Founder: "A
  // lot larger team names, score and time on the fields view." The line was
  // 9px — the smallest text on the card for the three things you glance for.
  const strip = (abbr: string, hasBall: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ fontFamily: MONO, fontSize: 14, fontWeight: '700', color: hasBall ? t.text : t.dim }}>{abbr}</Text>
      {hasBall && !over && <Text style={{ fontSize: 11 }}>🏈</Text>}
    </View>
  );

  return (
    <View ref={holderRef} onLayout={bleed ? measureHolder : undefined} style={{ opacity: bleed && holderX == null ? 0 : 1 }}>
    <View style={bleed
      ? { marginTop: 5, marginLeft: -(holderX ?? 0), width: winW, backgroundColor: t.bg, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: accent ? mix(accent, 55, t.bd) : t.bd, paddingLeft: (holderX ?? 0) + PAD, paddingRight: holderR + PAD, paddingVertical: 6, overflow: 'hidden' }
      : { marginTop: 5, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: accent ? mix(accent, 55, t.bd) : t.bd, borderRadius: 4, paddingHorizontal: PAD, paddingVertical: 6 }}>
      {/* score + clock strip */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 5, paddingRight: 30 }}>
        {strip(away, ballTm === away)}
        <Text style={{ fontFamily: MONO, fontSize: 17, fontWeight: '800', color: t.text }}>{score.a}</Text>
        {/* The LAST PLAY's clock, not the playback clock — a window clock can
            overshoot the real game and read a Q4 game as OT. */}
        <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '600', color: t.faint }}>{over ? 'FINAL' : pre ? (kickoffText ?? 'SOON') : (stoppageLabel(feed) ?? liveClockLabel(feed) ?? fmtQClock(cur ? cur.c : clock))}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 17, fontWeight: '800', color: t.text }}>{score.h}</Text>
        {strip(home, ballTm === home)}
        <Pressable
          onPress={toggleFlip}
          hitSlop={8}
          style={{ position: 'absolute', right: 0, borderWidth: StyleSheet.hairlineWidth, borderColor: flip ? t.you : t.bd, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: flip ? t.you : t.faint }}>↔</Text>
        </Pressable>
      </View>
      {plays.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 3 }}>
          <Pressable onPress={() => stepTo(idx - 1)} disabled={idx <= 0} hitSlop={6}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 3, paddingHorizontal: 9, paddingVertical: 1, opacity: idx <= 0 ? 0.35 : 1 }}>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.text }}>‹</Text>
          </Pressable>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 0.6, color: pin != null ? t.warn : t.faint }}>
            {pin != null ? `PLAY ${idx + 1}/${plays.length}` : `LIVE · ${plays.length} PLAYS`}
          </Text>
          <Pressable onPress={() => stepTo(idx + 1)} disabled={pin == null} hitSlop={6}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 3, paddingHorizontal: 9, paddingVertical: 1, opacity: pin == null ? 0.35 : 1 }}>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.text }}>›</Text>
          </Pressable>
          {pin != null && (
            <Pressable onPress={() => setPin(null)} hitSlop={6}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 1 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.you }}>LIVE ▸</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* THE FIELD IN PERSPECTIVE (v0.730.0, founder over Sleeper's game
          screen: "mirror the sleeper field view. Stretched to the edges and a
          bit over. Draw the same goal posts"). The tilt used to be an RN 3D
          transform, which laid everything down flat — a headshot by the far
          sideline came out squashed, and nothing could stand up on the grass.
          Now core's fieldPerspective projects the field's points and this
          draws them: the grass, lines and arcs on the ground, the posts, the
          ball badge and the carrier's pin standing upright at their spots.
          With `bleed` the drawing runs to the screen's edges and a little
          past, the way Sleeper's near corners sit off the screen. */}
      <View>
      <View style={bleedW != null ? { width: bleedW, marginLeft: -(holderX ?? 0) - PAD - winW * BLEED_OVER } : undefined}>
      <Svg viewBox={`0 0 ${W} ${VH}`} width={bleedW ?? '100%'} height={bleedW != null ? (bleedW * VH) / W : undefined} style={bleedW != null ? undefined : { aspectRatio: W / VH }}>
        {/* turf, its ten-yard bands, end zones */}
        <Polygon points={fieldQuad(FX, TOP, FX + FW, BOT)} fill={mix(t.you, 5, t.surface)} stroke={alpha(t.dim, 45)} strokeWidth={1} />
        {Array.from({ length: 10 }, (_, i) => i % 2 === 0 ? null : (
          <Polygon key={`band-${i}`} points={fieldQuad(FX + (i / 10) * FW, TOP, FX + ((i + 1) / 10) * FW, BOT)} fill={alpha(t.text, 5)} />
        ))}
        <Polygon points={fieldQuad(ezAwayX, TOP, ezAwayX + EZ, BOT)} fill={ezFill(awayCol)} />
        <Polygon points={fieldQuad(ezHomeX, TOP, ezHomeX + EZ, BOT)} fill={ezFill(homeCol)} />
        {redZone && (() => { const x0 = (flip ? !attacksRight : attacksRight) ? W - EZ : 0; return (
          <Polygon points={fieldQuad(x0, TOP, x0 + EZ, BOT)} fill={alpha(t.fx.nuke, 32)} />); })()}
        {/* the name runs along its end zone's slant, sized to fit it (v0.730.7) */}
        {([[ezAwayX, awayCol, away], [ezHomeX, homeCol, home]] as const).map(([ex, tc, abbr]) => {
          const l = endZoneLabel(ex, abbr.length);
          return (
            <SvgText key={`ez-${abbr}`} x={0} y={l.size * 0.35} fill={ezText(tc)} fontSize={l.size} fontWeight="800" textAnchor="middle"
              transform={`translate(${l.x} ${l.y}) rotate(${l.rot})`}>{abbr}</SvgText>
          );
        })}

        {/* yard lines + numbers — v0.590.0: every label sized to read on a
            phone; the numbers sit by the near sideline, where s ≈ 1. */}
        {Array.from({ length: 21 }, (_, i) => {
          const x = FX + (i / 20) * FW, a = fieldPt(x, TOP), b = fieldPt(x, BOT);
          return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={i % 2 ? alpha(t.bd, 55) : t.bd} strokeWidth={i === 0 || i === 20 ? 1.6 : 0.7} />;
        })}
        {[10, 20, 30, 40, 50, 40, 30, 20, 10].map((n, i) => {
          const p = fieldPt(FX + ((i + 1) / 10) * FW, BOT - 4);
          return <SvgText key={i} x={p.x} y={p.y} fill={t.dim} fontSize={10.5 * fieldScale(BOT - 4)} fontWeight="700" textAnchor="middle">{n}</SvgText>;
        })}

        {/* first-down line */}
        {!over && fdX != null && (() => { const a = fieldPt(mx(fdX), TOP), b = fieldPt(mx(fdX), BOT); return (
          <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={t.warn} strokeWidth={1.4} opacity={0.9} />); })()}

        {/* THE GOAL POSTS — Sleeper's: gold, standing on each end line. A made
            field goal's arc climbs through them (fgLift). */}
        {[0, W].map((ex) => { const g = goalPost(ex); return (
          <G key={`post-${ex}`}>
            <Ellipse cx={g.base.x} cy={g.base.y} rx={4} ry={1.4} fill={alpha('#000000', 35)} />
            <Path d={g.d} fill="none" stroke={POST_COLOR} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </G>); })}

        {/* last-play arc */}
        {arc && airPath && !over && (
          <G>
            <AnimatedPath
              d={airPath.d}
              fill="none" stroke={arc.color} strokeWidth={1.8} strokeLinecap="round"
              strokeDasharray={`${airPath.len}`}
              strokeDashoffset={air.interpolate({ inputRange: [0, 1], outputRange: [airPath.len, 0] }) as unknown as number}
            />
            {tailPath && <Path d={tailPath.d} fill="none" stroke={arc.color} strokeWidth={1.8} strokeLinecap="round" strokeDasharray="2.5 3.5" />}
            {runPath && (
              <AnimatedPath
                d={runPath.d}
                fill="none" stroke={arc.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={`${runPath.len}`}
                strokeDashoffset={run.interpolate({ inputRange: [0, 1], outputRange: [runPath.len, 0] }) as unknown as number}
              />
            )}
            {(() => { const p = fieldPt(arc.x1, MID), r = 5.5 * fieldScale(MID); return cur && teamLogo(cur.tm, { week })
              ? <SvgImage href={{ uri: teamLogo(cur.tm, { week })! }} x={p.x - r} y={p.y - r} width={2 * r} height={2 * r} />
              : <Circle cx={p.x} cy={p.y} r={3} fill={arc.color} />; })()}
            {playEnd && (incomplete
              ? <SvgText x={playEnd.x} y={playEnd.y + 3} fill={t.fx.nuke} fontSize={9} fontWeight="800" textAnchor="middle">✕</SvgText>
              : <SvgText x={playEnd.x} y={playEnd.y + 2.5} fontSize={7} textAnchor="middle">🏈</SvgText>)}
          </G>
        )}

        {/* line of scrimmage + ball marker. `bx` is the FLAT x; each row maps it
            through its own scale, which is linear in x, so it interpolates. */}
        {ballX != null && !over && (
          <G>
            <AnimatedLine x1={bx.interpolate({ inputRange: [0, W], outputRange: fieldXRange(TOP) }) as unknown as number} y1={fieldY(TOP)}
              x2={bx as unknown as number} y2={fieldY(BOT)} stroke={ballCol?.c ?? accent ?? t.dimstrong} strokeWidth={1.4} />
            <AnimatedG x={bx.interpolate({ inputRange: [0, W], outputRange: fieldXRange(MID) }) as unknown as number}>
              {/* The badge, unless the carrier's pin stands at the spot instead. */}
              {!(carrier && !(incomplete && arc)) && (
                <G>
                  <Circle cx={0} cy={yMid} r={10.5} fill={ballCol ? mix(ballCol.c, 30, t.surface) : t.surface} stroke={ballCol?.c ?? accent ?? t.dimstrong} strokeWidth={1.4} />
                  <SvgText x={0} y={yMid + 3.5} fill={t.text} fontSize={9} fontWeight="800" textAnchor="middle">{ballTm}</SvgText>
                  {ballTm && teamLogo(ballTm, { week }) && <SvgImage href={{ uri: teamLogo(ballTm, { week })! }} x={-10} y={yMid - 10} width={20} height={20} />}
                </G>
              )}
              <SvgText x={(flip ? !attacksRight : attacksRight) ? 15 : -15} y={yMid + 3.5} fill={ballCol?.c ?? t.faint} fontSize={10} fontWeight="700" textAnchor="middle">
                {(flip ? !attacksRight : attacksRight) ? '▶' : '◀'}
              </SvgText>
              {/* the ball carrier's pin, standing on the spot: headshot in a
                  ring, a point down to the grass, the name under the spot.
                  An incompletion's target sits at the ✕ instead (below). */}
              {carrier && !(incomplete && arc) && (
                <G>
                  <Path d={`M -5 ${yMid - 14} L 5 ${yMid - 14} L 0 ${yMid - 3} Z`} fill={ballCol?.c ?? t.dimstrong} />
                  <Circle cx={0} cy={yMid - 25} r={12} fill={t.surface} stroke={ballCol?.c ?? t.dimstrong} strokeWidth={1.4} />
                  {headshot(carrier.slug) && <SvgImage href={{ uri: headshot(carrier.slug)! }} x={-11} y={yMid - 36} width={22} height={22} preserveAspectRatio="xMidYMid slice" />}
                  <Rect x={-38} y={yMid + 2} width={76} height={13} rx={2} fill={alpha('#000000', 60)} />
                  <SvgText x={0} y={yMid + 12} fill="#FFFFFF" fontSize={9.5} fontWeight="700" textAnchor="middle">{carrier.name}</SvgText>
                </G>
              )}
            </AnimatedG>
          </G>
        )}
        {/* THE TARGET AT THE ✕ (v0.729.2): an incomplete pass draws who it
            was thrown to at the end of the arc, not at the spot. */}
        {carrier && incomplete && arc && playEnd && !over && (() => {
          const { ringY, plateY } = targetMarkY(playEnd.y);
          const ring = ballCol?.c ?? t.dimstrong;
          return (
            <G transform={`translate(${Math.min(W - 38, Math.max(38, playEnd.x))} 0)`}>
              <Circle cx={0} cy={ringY} r={12} fill={t.surface} stroke={ring} strokeWidth={1.4} />
              {headshot(carrier.slug) && <SvgImage href={{ uri: headshot(carrier.slug)! }} x={-11} y={ringY - 11} width={22} height={22} preserveAspectRatio="xMidYMid slice" />}
              <Rect x={-38} y={plateY} width={76} height={13} rx={2} fill={alpha('#000000', 60)} />
              <SvgText x={0} y={plateY + 10} fill="#FFFFFF" fontSize={9.5} fontWeight="700" textAnchor="middle">{carrier.name}</SvgText>
            </G>
          );
        })()}
      </Svg>
      {/* ── FINAL banner (v0.342.0, web parity) ────────────────────────────
          A finished game's field is a clean pitch — no arc, no ball spot, no
          lingering kneel-down — with the verdict stamped over it. */}
      {over && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 14, paddingVertical: 3, backgroundColor: mix(t.surface, 85, 'rgba(0, 0, 0, 0)') }}>
            <Text style={{ fontFamily: MONO, fontSize: 18, fontWeight: '800', letterSpacing: 5, color: t.text }}>FINAL</Text>
          </View>
        </View>
      )}
      {/* ── KICKS OFF banner (v0.696.4): a game still to start wears its time where a finished one wears FINAL */}
      {pre && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 14, paddingVertical: 3, backgroundColor: mix(t.surface, 85, 'rgba(0, 0, 0, 0)') }}>
            <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '800', letterSpacing: 2.5, color: t.text }}>{kickoffText ? `KICKS OFF ${kickoffText}` : 'NOT STARTED'}</Text>
          </View>
        </View>
      )}
      </View>
      </View>
      {pre && leaders && (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
          {leaderCol(away, leaders.away)}
          {leaderCol(home, leaders.home)}
        </View>
      )}

      {/* situation chip + play text — the FINAL banner carries the verdict on
          a finished game, and a kneel-down sentence under it is noise */}
      {!over && (
        <View style={{ alignItems: 'center', marginTop: 4 }}>
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: t.surface }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 0.8, color: accent ?? (cur?.sc ? t.warn : t.you) }}>{situation}</Text>
          </View>
        </View>
      )}
      {!!cur && !over && (
        <Text style={{ fontSize: 10.5, lineHeight: 14, color: t.text, textAlign: 'center', marginTop: 4 }}>
          {accent ? <Text style={{ color: accent }}>● </Text> : null}
          {curDD ? <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.dim }}>{curDD.toUpperCase()}  </Text> : null}
          {cur.txt}
        </Text>
      )}

      {/* ▤ BOX SCORE (v0.339.1) — the web has had this under its field since
          v0.336.0 and the app never did. Founder: "can we get the box score on
          the field visual in the app as well."

          It reads the SAME `gameBoxScore` the web's does, over the same clock
          this field is drawn at, so the two hosts cannot disagree about a
          number — which is the only reason a second implementation of this
          screen is acceptable at all. Everything with judgement in it (who is
          listed, in what order, how a line is phrased) lives in core; what is
          native here is the sheet. */}
      {/* ≣ PLAY BY PLAY beside it (v0.389.0, founder): every play of THIS
          game, with a voice — CATCH UP from the top or LIVE as they land. */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 6 }}>
        <Pressable onPress={() => setBoxOpen(true)}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 3, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: t.surface }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', letterSpacing: 1, color: t.dim }}>▤ BOX SCORE</Text>
        </Pressable>
        <Pressable onPress={() => setPbpOpen(true)}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 3, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: t.surface }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', letterSpacing: 1, color: t.dim }}>≣ PLAY BY PLAY 🔊</Text>
        </Pressable>
      </View>
      <BoxScoreSheet visible={boxOpen} onClose={() => setBoxOpen(false)}
        week={week} home={home} away={away} clock={pin != null && cur ? cur.c : clock} />
      <PlayByPlaySheet visible={pbpOpen} onClose={() => setPbpOpen(false)} week={week} team={home} />
    </View>
    </View>
  );
}

/** Everyone with a stat in this game, by team, at the field's clock.
 *
 *  Deliberately thin: `gameBoxScore` decides who appears, in what order and how
 *  each line reads, so this file holds only the sheet. A native re-derivation of
 *  any of that would be a second opinion, and the first argument it lost would
 *  be about whether the app or the web was lying. */
function BoxScoreSheet({ visible, week, home, away, clock, onClose }: {
  visible: boolean; week: number; home: string; away: string; clock: number; onClose: () => void;
}) {
  const t = useTheme();
  // ── EVERY GAME, ONE SHEET (v0.369.7, founder) — the web's strip, native:
  // all the week's games across the top, red dot live, faint final, plain
  // upcoming; the sheet opens on the game whose BOX SCORE chip was tapped.
  const originKey = `${normTeam(away)}@${normTeam(home)}`;
  const [sel, setSel] = useState(originKey);
  useEffect(() => { if (visible) setSel(originKey); }, [visible, originKey]);
  const games = useMemo(() => (visible ? weekBoxGames(week) : []), [visible, week, clock]);
  const cur = games.find((g) => g.key === sel) ?? games.find((g) => g.key === originKey) ?? games[0]
    ?? { key: originKey, away: normTeam(away), home: normTeam(home), kickoff: null, state: 'live' as const, feed: null };
  const effClock = cur.key === originKey ? clock : Number.MAX_SAFE_INTEGER;
  const box = useMemo(() => (visible ? gameBoxScore(week, cur.home, cur.away, effClock) : { home: [], away: [] }),
    [visible, week, cur.home, cur.away, effClock, clock]);
  const last = latestPlay(cur.feed?.plays);
  // BEFORE KICKOFF IT IS A PROJECTION (v0.413.0) — the web twin. gameBoxScore
  // accumulates from plays, so a game that has not started shows "— nothing
  // yet —" under both teams, on the one evening a manager is actually picking
  // a lineup. Founder: "the box score can contain projected starters and
  // fantasy projections until kick off."
  const notStarted = !cur.feed || cur.feed.plays.length === 0;
  const proj = useMemo(() => (visible && notStarted ? projectedBox(cur.home, cur.away, week) : null),
    [visible, notStarted, cur.home, cur.away, week]);
  // OFFENSE / DEFENSE tabs (v0.343.2, founder): the single list ran past the
  // sheet's cap and clipped — see the ScrollView note below — and even scrolled,
  // "how did the defense do" meant paging past every receiver. Membership is
  // core's boxTabRows: stat-driven, so a two-way player (the Travis Hunter
  // case) appears on BOTH tabs, phrased through each side's lens.
  const [tab, setTab] = useState<'off' | 'def'>('off');
  useEffect(() => { if (visible) setTab('off'); }, [visible]);
  const col = (label: string, rows: typeof box.home) => {
    const shown = boxTabRows(rows, tab);
    return (
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }}>
          {!!teamLogo(label, { week }) && <Image source={{ uri: teamLogo(label, { week })! }} style={{ width: 16, height: 16, borderRadius: 2 }} />}
          <Text style={{ fontFamily: MONO, fontSize: fs(12), fontWeight: '700', letterSpacing: 1, color: t.text }}>{label}</Text>
        </View>
        {shown.length === 0
          ? <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.faint }}>— nothing yet —</Text>
          : shown.map((r) => {
            // A name opens the player card (founder: "can we open up player
            // cards by clicking names on the box score?") — except the D/ST
            // and K composites, which are units, not players with cards.
            const carded = !r.slug.endsWith('-dst') && !r.slug.endsWith('-k');
            return (
            <View key={r.slug} style={{ paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: alpha(t.bd, 0.5) }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.pos?.[r.pos]?.fg ?? t.faint }}>{r.pos}</Text>
                <Text numberOfLines={1}
                  onPress={carded ? () => openPlayerCard({ slug: r.slug, name: boxName(r.slug), pos: r.pos, team: label, week }) : undefined}
                  style={{ flex: 1, fontSize: fs(13), fontWeight: '600', color: t.text, textDecorationLine: carded ? 'underline' : 'none', textDecorationStyle: 'dotted', textDecorationColor: alpha(t.dim, 0.55) }}>
                  {boxName(r.slug)}
                </Text>
              </View>
              <Text style={{ fontFamily: MONO, fontSize: fs(10.5), color: t.dimstrong, lineHeight: fs(10.5) * 1.35 }}>{r.stat}</Text>
            </View>
            );
          })}
      </View>
    );
  };
  /** The same column before anyone has played: expected starters and what THIS
   *  league's scoring projects them for. Never dressed as a stat line. */
  const projCol = (label: string, rows: NonNullable<typeof proj>['home']) => (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        {!!teamLogo(label, { week }) && <Image source={{ uri: teamLogo(label, { week })! }} style={{ width: 16, height: 16, borderRadius: 2 }} />}
        <Text style={{ fontFamily: MONO, fontSize: fs(12), fontWeight: '700', color: t.text }}>{label}</Text>
      </View>
      {rows.length === 0
        ? <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.faint }}>— no projections —</Text>
        : rows.map((r) => (
          <View key={r.slug} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.faint }}>{r.pos}</Text>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: fs(13), fontWeight: '600', color: t.text }}>{boxName(r.slug)}</Text>
            {!!r.injury && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.warn }}>{r.injury}</Text>}
            <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '700', color: t.dim }}>{r.proj != null ? r.proj.toFixed(1) : '—'}</Text>
          </View>
        ))}
    </View>
  );
  const tabBtn = (id: 'off' | 'def', label: string) => (
    <Pressable onPress={() => setTab(id)}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 4, backgroundColor: tab === id ? t.bd : 'transparent' }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '700', letterSpacing: 1, color: tab === id ? t.text : t.dim }}>{label}</Text>
    </Pressable>
  );
  return (
    <Overlay visible={visible} title="▤ BOX SCORES" onClose={onClose}>
      {/* The game strip — every game this week, horizontally scrollable.
          Red dot = on now · faint = final · plain = yet to kick. */}
      {games.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          // flexShrink 0 (v0.561.3): a ScrollView shrinks by default, so a long
          // stat list below squeezed this strip and clipped the chips' text
          // (founder's Android screenshot, CAR@CLE cut in half).
          style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingTop: 10 }}>
          {games.map((g) => (
            <Pressable key={g.key} onPress={() => setSel(g.key)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 6,
                borderWidth: StyleSheet.hairlineWidth, borderColor: g.key === cur.key ? t.you : t.bd,
                backgroundColor: g.key === cur.key ? alpha(t.you, 0.12) : t.bg,
              }}>
              {g.state === 'live' && <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: t.opp }} />}
              <Text style={{ fontFamily: MONO, fontSize: fs(12), fontWeight: '700', color: g.state === 'final' ? t.faint : t.text }}>{g.key}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {/* The selected game's own line: teams, score, where its clock stands. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 10, flexShrink: 0 }}>
        {!!teamLogo(cur.away, { week }) && <Image source={{ uri: teamLogo(cur.away, { week })! }} style={{ width: 22, height: 22, borderRadius: 2 }} />}
        <Text style={{ fontFamily: MONO, fontSize: fs(15), fontWeight: '700', color: t.text }}>{cur.away}</Text>
        {last
          ? <Text style={{ fontFamily: MONO, fontSize: fs(22), fontWeight: '800', color: t.text }}>{last.as} — {last.hs}</Text>
          : <Text style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: '700', color: t.faint }}>@</Text>}
        <Text style={{ fontFamily: MONO, fontSize: fs(15), fontWeight: '700', color: t.text }}>{cur.home}</Text>
        {!!teamLogo(cur.home, { week }) && <Image source={{ uri: teamLogo(cur.home, { week })! }} style={{ width: 22, height: 22, borderRadius: 2 }} />}
        <Text style={{ fontFamily: MONO, fontSize: fs(12), fontWeight: '700', color: cur.state === 'live' ? t.opp : t.faint }}>
          {cur.state === 'final' ? 'FINAL' : cur.state === 'live' ? (stoppageLabel(cur.feed) ?? liveClockLabel(cur.feed) ?? (last ? fmtQClock(Math.min(last.c, effClock)) : 'LIVE')) : cur.kickoff ? kickoffLabel(cur.kickoff) : 'UPCOMING'}
        </Text>
      </View>
      {/* The tab bar stays put; only the list scrolls. Before kickoff there is
          one list per side, so a tab bar would promise a cut of nothing. */}
      {!notStarted && (
        <View style={{ flexShrink: 0, flexDirection: 'row', gap: 6, margin: 12, marginBottom: 8, padding: 3, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, backgroundColor: t.bg }}>
          {tabBtn('off', 'OFFENSE')}
          {tabBtn('def', 'DEFENSE')}
        </View>
      )}
      {notStarted && !!proj && (
        <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.warn, textAlign: 'center', marginTop: 10 }}>
          ◷ PROJECTED STARTERS · NOT A STAT LINE
        </Text>
      )}
      {/* A ScrollView, not a View (v0.343.2): the sheet body clips at the
          sheet's height cap, and a full game's list is taller than any phone —
          the founder's screenshot ended mid-linebacker with no way to reach
          the rest. The Overlay's flexShrink body needs the scroll INSIDE. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        {notStarted && proj
          ? <View style={{ flexDirection: 'row', gap: 14 }}>{projCol(cur.away, proj.away)}{projCol(cur.home, proj.home)}</View>
          : <View style={{ flexDirection: 'row', gap: 14 }}>{col(cur.away, box.away)}{col(cur.home, box.home)}</View>}
        {/* Said plainly: an empty column is a player who has not touched the
            ball, not a player the box score forgot. */}
        <Text style={{ fontFamily: MONO, fontSize: fs(8), color: t.faint, marginTop: 10, lineHeight: fs(8) * 1.5 }}>
          {notStarted
            ? "the highest-projected man at each spot, scored by THIS league's rules · a projection, not a depth chart · real stats replace it at kickoff"
            : "everyone with a stat on this side of the ball · by position, by yards · two-way players appear on both tabs · follows the log's clock"}
        </Text>
      </ScrollView>
    </Overlay>
  );
}

/** A slug as a readable name — the app's copy of the web's `boxName`. */
function boxName(slug: string): string {
  return stripSlugTag(slug).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}
