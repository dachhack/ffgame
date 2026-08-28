// The card duel — one pod per game window, your cards paired against theirs.
//
// This used to live in screens/LiveBoard.tsx, the separate "LIVE BOARD" tab.
// That tab is gone: a window is now either SETUP or LIVE on the one board, the
// way the web's Matchup phases, so the duel is a component the board composes
// rather than a screen you navigate to. Two callers share it — the board's live
// windows in LivePicks, and DemoBoard's scripted replay — which is exactly why
// it was worth lifting out instead of inlining.
import { useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { windowsForWeek, windowDateLabel, windowTimeLabel, gamesInWindow, windowPhase } from '@drip/core/data/nflSlate';
import { WINDOW_WIN_BONUS } from '@drip/core/engine/matchup';
import { srvSlotRow } from '@drip/core/engine/liveScore';
import { teamLogo } from '@drip/core/data/media';
import { metricById, isMetricSet } from '@drip/core/data/metrics';
import { slugMeta } from '@drip/core/data/slugMeta';
import { teamFor } from '@drip/core/data/playerTeam';
import { openPlayerCard } from './PlayerCardSheet';
import type { WindowScore, RevealedPick, PoolPlayer, TeamInfo } from '@drip/core/data/liveApi';
import type { Pos } from '@drip/core/types';
import { useTheme, MONO } from "../theme.native";
import { Card, Mono } from "./prims";
import { CardFace, CardBack } from "./cards";
import { LiveCard } from "./LiveCard";
import { LivePulse } from "./animations";
import { WindowGameLog } from './PlayLog';


export const round1 = (n: number) => Math.round(Number(n) * 10) / 10;

export function Big({ label, value, color, team }: { label: string; value: number; color: string; team?: TeamInfo }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', minWidth: 100 }}>
      <Mono size={9} tone="faint" track={0.12}>{label}</Mono>
      <Text style={{ fontSize: 38, fontWeight: '700', color, lineHeight: 44 }}>{value}</Text>
      {!!team?.team_name && (
        <Text numberOfLines={1} style={{ fontSize: 10, color: t.dim, maxWidth: 130, textAlign: 'center' }}>{team.team_name}</Text>
      )}
    </View>
  );
}

/** The card duel: one pod per game window, your cards paired against theirs.
 *
 *  The web lays this out as three columns (you | score | them). A phone is too
 *  narrow for that, so pairs stack vertically instead — the same pairing the
 *  setup board uses, which also keeps the two screens visually consistent.
 *
 *  The sealed-back count MIRRORS YOUR OWN card count, never the opponent's real
 *  one. Showing their true count before reveal would leak how many slots they
 *  filled in a window, which is information the game deliberately withholds. */
export function Duel({ mine, theirs, pool, scores, youAreHome, status, week, winLabel, winStatus, slotDetail, liveExtras, userId, onOpenSlate }: {
  mine: RevealedPick[];
  theirs: RevealedPick[];
  pool: Record<string, PoolPlayer>;
  scores: WindowScore[];
  youAreHome: boolean;
  status: string;
  week: number;
  /** Signed-in account — lights the ★ on the card a duel-card tap opens. */
  userId?: string;
  winLabel: (id: string) => string;
  /** Per-window override of the status chip. The board has one status for the
   *  whole matchup, so it doesn't pass this; a replay does, because it walks
   *  windows one at a time and a finished window shouldn't still read LIVE. */
  winStatus?: (id: string) => string | null;
  /** Rendered directly beneath a slot's card pair — the field visual and play
   *  log for that duel. A prop rather than built in, because the two callers get
   *  the underlying plays from different places: the replay has resolved engine
   *  events in hand, while the board would have to read published feeds.
   *  Returning null (the board's current answer) simply renders nothing. */
  slotDetail?: (win: string, slot: string) => ReactNode;
  /** Extra live-row text a caller can supply per side: the game and clock
   *  ("KC@LAC · Q1 9:00"), the statline, coin earned. Everything here needs data
   *  Duel doesn't have — a game feed, a StatLine — so it's the caller's to fill
   *  and the row degrades cleanly to card + metric + score without it. */
  liveExtras?: (win: string, slot: string, side: 'you' | 'their') => {
    gameLabel?: string | null; stat?: string | null; coin?: number | null;
  } | null;
  /** Opens the window's GAME SLATE sheet (v0.368.5, founder: "in the web
   *  version if you click on the slate you get a pop up of the games in the
   *  window. let's have the same in the app."). The sheet itself lives in
   *  LivePicks — the setup board already owns one, and a second copy here
   *  would drift — so the live board hands the door through. Callers without
   *  a sheet (the demo replay) omit it and the crest row stays inert. */
  onOpenSlate?: (win: string) => void;
}) {
  const t = useTheme();
  // Which DONE windows have their field + play log expanded (0182.2) —
  // collapsed by default once a window is decided.
  const [detailOpen, setDetailOpen] = useState<Record<string, boolean>>({});
  const youSide = youAreHome ? 'home' : 'away';
  const oppSide = youAreHome ? 'away' : 'home';

  // Ordered by the week's OWN windows; anything unrecognised sorts to the end
  // rather than disappearing.
  const order = windowsForWeek(week).map((w) => String(w.id));
  /** The window's long name ("Sunday Early") — the web shows it beside the id. */
  const winSub = (id: string) => windowsForWeek(week).find((w) => String(w.id) === id)?.sub ?? '';
  const wins = [...new Set([...mine, ...theirs].map((p) => p.game_window).concat(scores.map((s) => s.game_window)))]
    .sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });

  // A reveal is a TRANSITION, not a state, and the board is the only thing that
  // can tell them apart. Every card here remounts constantly — a realtime tick,
  // a pull-to-refresh, switching tabs — so a card that animated on mount would
  // replay the reveal every time you glanced at the board, which is precisely
  // how a moment stops being one. These sets remember what was already on the
  // table; only a slot that was NOT there last pass gets to flip.
  //
  // Deliberately computed during render, not in an effect. The flip has to be
  // known at the card's first mount — an effect fires a frame late, by which
  // point the card has already dealt itself in and the flip becomes a second
  // entrance for the same event. Mutating a ref mid-render is the trade; under a
  // double-invoking StrictMode the second pass would see the key as already
  // seen, so the cost is a skipped animation, never wrong data on the board.
  const seenFaces = useRef<Set<string> | null>(null);
  const seenNukes = useRef<Set<string>>(new Set());
  const firstPaint = seenFaces.current === null;
  if (firstPaint) seenFaces.current = new Set();

  /** True the first time this slot appears face-up — but never on first paint,
   *  where every card is arriving at once and deals in instead. */
  const justRevealed = (key: string): boolean => {
    const seen = seenFaces.current!;
    if (seen.has(key)) return false;
    seen.add(key);
    return !firstPaint;
  };

  /** True the first time the worker reports this slot nuked. A nuke stays true
   *  on the row for the rest of the week, so without this the burst would fire
   *  again on every refresh. */
  const justNuked = (key: string, nuked: boolean): boolean => {
    if (!nuked) return false;
    if (seenNukes.current.has(key)) return false;
    seenNukes.current.add(key);
    return true;
  };

  // The shared matching rule (engine/liveScore): roster slot first, slug as
  // the fallback — the SAME precedence the web's card lookup decodes, so the
  // two hosts can never pin different rows to the same card. This used to be
  // a hand-rolled find with either-key matching in array order (v0.339.6).
  const rowOf = (p: RevealedPick, side: 'home' | 'away') =>
    srvSlotRow(scores.find((x) => x.game_window === p.game_window)?.slot_scores, side, p.roster_slot, p.player_slug);

  /** True once the window's first game has kicked — from then on the opponent's
   *  picks are face-up by rule, so an empty half is a FACT (nobody fielded),
   *  not a secret still to reveal. Before kickoff, absence and secrecy look
   *  identical on purpose and the sealed back covers both. */
  const winKicked = (win: string) => {
    const p = windowPhase(week, win as never, Date.now());
    return p === 'live' || p === 'final';
  };

  /** A slot's live row — what the card becomes once the window is scoring.
   *  A missing or unresolvable pick renders the sealed variant BEFORE kickoff
   *  (an opponent who hasn't revealed still occupies their half) and the
   *  explicit NO PLAYER seat after — a back that says "flips at kickoff" on a
   *  window that kicked hours ago is a promise the board can't keep. */
  const liveFor = (p: RevealedPick | undefined, side: 'home' | 'away', who: 'you' | 'their', win: string, slot: string, idx: number) => {
    const player = p?.player_slug ? pool[p.player_slug] : null;
    if (!p || !player) return <LiveCard key={`${win}-${slot}-${who}`} side={who} sealed={!winKicked(win)} unopposed={winKicked(win)} idx={idx} />;
    const metric = metricById(player.pos as Pos, p.metric_id);
    const row = rowOf(p, side);
    const ex = liveExtras?.(win, p.roster_slot, who);
    return (
      <LiveCard
        key={`${win}-${slot}-${who}`}
        side={who} idx={idx}
        slug={player.slug} name={player.full} pos={player.pos} team={slugTeam(player)}
        // `||`, not `??` (v0.331.0): an empty-string metric_id sails past
        // `??` and then fails the render test, so the chip vanished with no
        // null anywhere in sight. isMetricSet is the shared predicate.
        metricName={isMetricSet(metric?.name) ? metric!.name : isMetricSet(p.metric_id) ? p.metric_id! : null}
        bank={row ? round1(Number(row.score)) : null}
        hot={!!row?.hot}
        nuked={!!row?.nuked}
        gameLabel={ex?.gameLabel}
        stat={ex?.stat}
        coin={ex?.coin}
        onPress={() => openPlayerCard({ slug: player.slug, name: player.full, pos: player.pos, team: slugTeam(player), week, userId })}
      />
    );
  };

  const faceFor = (p: RevealedPick, side: 'home' | 'away', accent: string, idx: number) => {
    const player = p.player_slug ? pool[p.player_slug] : null;
    const key = `${p.game_window}-${p.roster_slot}-${side}`;
    if (!player) return <CardBack key={key} idx={idx} />;
    const metric = metricById(player.pos as Pos, p.metric_id);
    const row = rowOf(p, side);
    return (
      <CardFace
        key={key} idx={idx}
        slug={player.slug} name={player.full} pos={player.pos} team={slugTeam(player)}
        metric={metric?.name ?? p.metric_id ?? null}
        bank={row ? round1(Number(row.score)) : null}
        accent={accent}
        flip={justRevealed(key)}
        hot={!!row?.hot}
        nuked={justNuked(key, !!row?.nuked)}
      />
    );
  };

  return (
    <>
      {wins.map((win) => {
        const my = mine.filter((p) => p.game_window === win);
        const th = theirs.filter((p) => p.game_window === win);
        const s = scores.find((x) => x.game_window === win);
        if (!my.length && !th.length && !s) return null;
        const you = s ? round1(Number(youAreHome ? s.home_score : s.away_score)) : null;
        const them = s ? round1(Number(youAreHome ? s.away_score : s.home_score)) : null;
        const sealedBacks = !th.length && status !== 'final' ? Math.max(my.length, 1) : 0;
        const hasRows = !!s?.slot_scores?.length;
        // A kicked window is never "SEALED" — from kickoff the reveal has, by
        // rule, happened; an empty opposing half from here on means UNOPPOSED.
        // And a window that has NOT kicked is never "LIVE" (v0.368.5, founder:
        // "these should be locked but not live yet"): the chip used to fall
        // back to the MATCHUP's status, so the moment the matchup went live
        // every window wore ● LIVE, kicked or not. The window's own clock
        // decides now — with `hasRows` as the feed-truth override (a sim or
        // an irregular slate can score a window the wall clock calls pre).
        // Revealed-but-not-kicked is the lock hour: 🔒 LOCKED, the web's word.
        const st = winStatus?.(win)
          ?? (status === 'final' ? 'FINAL'
            : winKicked(win) || hasRows ? '● LIVE'
            : th.length ? '🔒 LOCKED'
            : 'SEALED');
        // PAIR BY ROSTER SLOT, NOT ARRAY POSITION (v0.344.2). `revealed`
        // arrives in query-row order, and zipping my[i] against th[i] crossed
        // duels whenever the two sides' rows sorted differently — the
        // founder's app paired Fields against C.Williams while the web (and
        // the resolver's slot_scores, which decide the actual battles) paired
        // him against Maye. The slot is the key the engine scores by, so it is
        // the key the cards pair by. A window with nothing but a score (or
        // nothing but sealed backs) still renders one pair.
        const slotKeys = [...new Set([...my, ...th].map((p) => String(p.roster_slot)))]
          .sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
        if (!slotKeys.length && (sealedBacks > 0 || s)) slotKeys.push('0');
        // Done window (founder's call, 0182.2): the field + play log collapse
        // once the window is decided — they're the story of a game that's
        // over, one tap away instead of a screen of dead weight.
        const winDone = st === 'FINAL';
        const showDetail = !winDone || !!detailOpen[win];

        return (
          // Card's default 16 padding, the felt's 10 and the panel's 7 stacked
          // to 33px of dead margin on each side before the card even started —
          // width the metric labels needed more than the edges did.
          <Card key={win} style={{ marginBottom: 10, paddingHorizontal: 7, paddingVertical: 10 }}>
            {/* Window header: id, the long name, the date and the kickoff —
                the web's four-part line. The date and time matter more here
                than they look: a preseason week's windows are Thu/Fri/Sat
                clusters with nothing in their id to tell them apart. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6, flexWrap: 'wrap' }}>
              <Mono size={13} weight="700" track={0.06}>{winLabel(win)}</Mono>
              <Mono size={9} tone="dim" track={0.1}>{winSub(win)}</Mono>
              <Mono size={9} tone="mid">{windowDateLabel(week, win as never)}</Mono>
              <Mono size={9} tone="faint">{windowTimeLabel(week, win as never)}</Mono>
              <View style={{ flex: 1 }} />
              <View>
                {/* The web pulses this chip with ct-livepulse. Only while the
                    window is actually live — a permanent pulse is just chrome. */}
                {st === '● LIVE' && <LivePulse color={t.you} />}
                <Mono size={9} weight="700" tone={st === '● LIVE' ? 'you' : st === '🔒 LOCKED' ? 'warn' : 'faint'}>{st}</Mono>
              </View>
            </View>

            {/* The slate crests — which games this window actually is. A DOOR
                now (v0.368.5): tapping opens the window's Game Slate sheet —
                the setup board's own sheet, handed through onOpenSlate, the
                web popup's twin. */}
            {(() => {
              const games = gamesInWindow(week, win as never);
              if (!games.length) return null;
              const logos = [...new Set(games.flatMap((g) => [g.away, g.home]))];
              const row = (
                <>
                  {logos.slice(0, 10).map((tm) => {
                    const url = teamLogo(tm);
                    return url ? <Image key={tm} source={{ uri: url }} style={{ width: 14, height: 14 }} resizeMode="contain" />
                      : <Mono key={tm} size={8} tone="faint">{tm}</Mono>;
                  })}
                  <Mono size={8.5} tone="faint" track={0.12}>
                    SLATE · {games.length} GAME{games.length === 1 ? '' : 'S'}{onOpenSlate ? ' ›' : ''}
                  </Mono>
                </>
              );
              const rowStyle = { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8, flexWrap: 'wrap' } as const;
              return onOpenSlate
                ? <Pressable hitSlop={6} onPress={() => onOpenSlate(win)} style={rowStyle}>{row}</Pressable>
                : <View style={rowStyle}>{row}</View>;
            })()}

            {/* WINDOW BATTLE — the web's bar, not a bare "x VS y". The bar is
                the point: a window is a head-to-head worth a bonus, and the
                proportional fill says who is winning it at a glance. */}
            {(you != null || them != null) && (() => {
              const yTot = you ?? 0, tTot = them ?? 0;
              const total = yTot + tTot;
              const yPct = total > 0 ? Math.max(4, Math.min(96, (yTot / total) * 100)) : 50;
              const even = Math.abs(yTot - tTot) < 0.05;
              const leadYou = yTot > tTot;
              const done = st === 'FINAL';
              const leadColor = even ? t.dim : leadYou ? t.you : t.opp;
              const label = done ? (even ? 'EVEN' : leadYou ? '★ WON' : 'LOST')
                : (even ? 'DEAD EVEN' : leadYou ? 'YOU LEAD' : 'THEY LEAD');
              return (
                <View style={{ backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                    <Mono size={8.5} weight="700" tone="faint" track={0.1}>
                      ⚔ WINDOW BATTLE{done ? '' : ` · win for +${WINDOW_WIN_BONUS}`}
                    </Mono>
                    <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.7, color: leadColor }}>
                      {label}{done && !even ? ` +${WINDOW_WIN_BONUS}` : ''}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: t.you, minWidth: 38, textAlign: 'right' }}>{yTot.toFixed(1)}</Text>
                    <View style={{ flex: 1, height: 6, borderRadius: 4, overflow: 'hidden', backgroundColor: t.opp }}>
                      <View style={{ width: `${yPct}%`, height: '100%', backgroundColor: t.you }} />
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: t.opp, minWidth: 38 }}>{tTot.toFixed(1)}</Text>
                  </View>
                </View>
              );
            })()}

            {/* The window's TV feed — every ingested play, collapsed by
                default (the founder's "where is the log under each match").
                Only once the window kicked: before that there are no plays
                and the closed header is an empty promise. */}
            {winKicked(win) && <WindowGameLog week={week} win={win} />}

            {/* Row gap and padding both allow for the floating cards, which
                overhang their panels by 12 — without the clearance adjacent
                duels overlap and the felt clips the top and bottom rows. */}
            <View style={{ gap: 22, paddingHorizontal: 4, paddingVertical: 18 }}>
              {slotKeys.map((slot, i) => {
                const mp = my.find((p) => String(p.roster_slot) === slot);
                const tp = th.find((p) => String(p.roster_slot) === slot);
                return (
                  <View key={slot} style={{ gap: 8 }}>
                    {/* Two portrait cards until the window has scored, then the
                        compact live rows — the web's switch, and the reveal
                        flip depends on it. At kickoff the opponent's card is
                        revealed but no play has landed, so this is still card
                        mode and the flip plays; the first score converts the
                        pair. Convert on reveal instead and the flip is skipped
                        entirely, which is how the moment gets lost. */}
                    {hasRows ? (
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                        {liveFor(mp, youSide, 'you', win, slot, i)}
                        {liveFor(tp, oppSide, 'their', win, slot, i)}
                      </View>
                    ) : (
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                      {mp ? faceFor(mp, youSide, t.you, i) : <CardBack label="—" idx={i} />}
                      {/* Post-kick, an empty opposing half is a fact: NO PICK,
                          not a SEALED back promising a flip that never comes
                          (the founder watched one promise all night). */}
                      {tp ? faceFor(tp, oppSide, t.opp, i) : <CardBack label={winKicked(win) ? 'NO PICK' : 'SEALED'} idx={i} />}
                    </View>
                    )}
                    {/* The duel's game(s) and play log, directly under the pair
                        they belong to — the web's arrangement, and the reason
                        it's here rather than in a panel below the board: the
                        field only means anything next to the cards whose score
                        it explains. */}
                    {showDetail && slotDetail?.(win, slot)}
                  </View>
                );
              })}
            </View>
            {winDone && !!slotDetail && (
              <Pressable hitSlop={6}
                onPress={() => setDetailOpen((cur) => ({ ...cur, [win]: !cur[win] }))}
                style={{ alignSelf: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 5, marginTop: 2 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.dim }}>
                  {detailOpen[win] ? '▾ HIDE FIELD & PLAY LOG' : '▸ FIELD & PLAY LOG'}
                </Text>
              </Pressable>
            )}
          </Card>
        );
      })}

    </>
  );
}

/** The entry's own team first (rookies aren't in the baked 2025 table), then
 *  the LIVE layer (fresh directory bake + worker overrides, 0142), then the
 *  2025 bake as the last resort. */
function slugTeam(p: PoolPlayer): string {
  return p.team || teamFor(p.slug) || slugMeta(p.slug).team;
}
