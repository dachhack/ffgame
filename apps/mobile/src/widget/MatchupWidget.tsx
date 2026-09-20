// THE LIVE MATCHUP WIDGET (v0.421.0, v0.422.0) — the picture on the home screen.
//
// Founder: "Let's do the Android live matchup widget." Then: "We can include
// a lot more info in that widget… a lineup assessment widget would be a
// second add or make it a selection in the current widget."
//
// One card, two views, three heights.
//   SCORE  — league and week, both teams and scores, the state line, the
//            window strip (who leads each window), who is still to play, and
//            how many of my slots are hot.
//   LINEUP — the verdict (READY, or N FIXES), the fixes by window, and when
//            the next window locks.
// The feed says which view LEADS (lineup while something needs fixing and a
// window is still open; score otherwise); the ⇄ chip flips it and the
// choice is remembered per widget. Height picks the tier: a 4×2 shows the
// essentials, taller widgets add rows — Android tells the task the height.
//
// It is RemoteViews under the hood, so what can be drawn is what
// react-native-android-widget can express: flex boxes and text, no fonts we
// ship, no animation, no clock. Colours are fixed to the app's dark palette:
// a widget has no ThemeCtx, and a home screen is not the app.
import React from 'react';
import { FlexWidget, TextWidget, ImageWidget, type ColorProp } from 'react-native-android-widget';
import type { WidgetSnapshot, WidgetView, WidgetWindow, WidgetCard } from '@drip/core/data/widgetFeed';

const C = {
  bg: '#0E1F22',
  card: '#163138',
  line: '#24474D',
  text: '#E9F5F3',
  dim: '#9FB7B4',
  faint: '#6E8886',
  you: '#34E5D9',
  opp: '#FF5C8A',
  live: '#34E5D9',
  warn: '#FFB454',
  ok: '#36D399',
} as const;

export type WidgetState =
  | { kind: 'signed-out' }
  | { kind: 'no-leagues' }
  | { kind: 'error'; message: string }
  /** Painted the instant a chip is tapped, before any read: the last picture
   *  we drew, or a one-line notice while the first read runs. */
  | { kind: 'loading'; title: string; body: string }
  | { kind: 'ok'; snap: WidgetSnapshot; leagues: number; /** True when this is the remembered picture and a fresh read is on its way. */ stale?: boolean;
      /** True when the read behind this wake FAILED and the remembered picture
       *  was kept (v0.433.1): the ⟳ chip says so, and a tap on it retries. */
      offline?: boolean };

export const MATCHUP_WIDGET_NAME = 'Matchup';
export const WIDGET_CLICK = { open: 'OPEN_URI', next: 'NEXT_LEAGUE', refresh: 'REFRESH', flip: 'FLIP_VIEW' } as const;

/** Height tiers, in dp: what a 4×2 gets, what a 4×3 adds, what a 4×4 adds. */
export type Tier = 'compact' | 'roomy' | 'tall';
export const tierFor = (heightDp: number): Tier => (heightDp >= 250 ? 'tall' : heightDp >= 150 ? 'roomy' : 'compact');

/** The deep link a tap opens: App.tsx routes it to that seat's board. */
export const matchupDeepLink = (leagueId: string, rosterId: number) =>
  `dripfantasy://matchup?league=${encodeURIComponent(leagueId)}&roster=${rosterId}`;

const fmt = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const clock = (ms: number) => {
  const d = new Date(ms);
  const p = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(d);
  return `${p} ET`;
};

function Frame({ children, clickAction, clickActionData }: { children: React.ReactNode; clickAction?: string; clickActionData?: Record<string, unknown> }) {
  return (
    <FlexWidget
      clickAction={clickAction}
      clickActionData={clickActionData}
      style={{ width: 'match_parent', height: 'match_parent', backgroundColor: C.card, borderRadius: 18, padding: 12, flexDirection: 'column', justifyContent: 'space-between' }}
    >
      {children}
    </FlexWidget>
  );
}

function Header({ left, right, rightColor }: { left: string; right?: string; rightColor?: ColorProp }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <TextWidget text={left} truncate="END" maxLines={1} style={{ fontSize: 10, color: C.faint, fontWeight: 'bold', letterSpacing: 0.12 }} />
      {right ? <TextWidget text={right} maxLines={1} style={{ fontSize: 10, color: rightColor ?? C.dim, fontWeight: 'bold', letterSpacing: 0.08 }} /> : null}
    </FlexWidget>
  );
}

function Side({ name, score, color, align }: { name: string; score: number; color: ColorProp; align: 'left' | 'right' }) {
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <TextWidget text={fmt(score)} maxLines={1} style={{ fontSize: 30, color, fontWeight: 'bold' }} />
      <TextWidget text={name} truncate="END" maxLines={1} style={{ fontSize: 11, color: C.text, fontWeight: 'bold', textAlign: align }} />
    </FlexWidget>
  );
}

function Chip({ text, action, color = C.dim }: { text: string; action: string; color?: ColorProp }) {
  return (
    <TextWidget
      text={text}
      clickAction={action}
      style={{ fontSize: 11, color, fontWeight: 'bold', backgroundColor: C.bg, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 6 }}
    />
  );
}

/** The window strip: one pill per window, coloured by who leads it. A live
 *  window carries a dot; a window nobody has scored in yet is quiet. */
function Strip({ windows }: { windows: WidgetWindow[] }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
      {windows.map((w) => {
        const scored = w.me > 0 || w.them > 0;
        const lead = scored ? (w.me > w.them ? 'me' : w.me < w.them ? 'them' : 'tie') : null;
        const color: ColorProp = w.phase === 'setup' ? C.faint : lead === 'me' ? C.you : lead === 'them' ? C.opp : C.dim;
        const bg: ColorProp = w.phase === 'live' ? C.line : C.bg;
        const mark = w.phase === 'live' ? '●' : w.phase === 'final' ? (lead === 'me' ? '✓' : lead === 'them' ? '✗' : '–') : '';
        return (
          <TextWidget key={w.id} text={`${w.label}${mark ? ` ${mark}` : ''}`} maxLines={1}
            style={{ fontSize: 9, color, fontWeight: 'bold', backgroundColor: bg, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3, marginRight: 4 }} />
        );
      })}
    </FlexWidget>
  );
}

function Line({ text, color = C.dim, size = 10.5 }: { text: string; color?: ColorProp; size?: number }) {
  return <TextWidget text={text} truncate="END" maxLines={1} style={{ fontSize: size, color }} />;
}

/** A message card: signed out, no seats, or a fetch that failed. Tapping
 *  anywhere opens the app, which is the fix for the first two. A fetch that
 *  failed is different (v0.433.1 — founder: "If it's not connected, can we
 *  just have a press to reconnect"): the card itself is the retry — a tap
 *  anywhere on it wakes the task for a fresh read, the way ⟳ does — and
 *  OPEN → in the corner still opens the app for whoever wants that. */
function Notice({ title, body, retry }: { title: string; body: string; retry?: boolean }) {
  return (
    <Frame clickAction={retry ? WIDGET_CLICK.refresh : 'OPEN_APP'}>
      <Header left="DRIP FANTASY" />
      <FlexWidget style={{ flexDirection: 'column' }}>
        <TextWidget text={title} maxLines={1} style={{ fontSize: 16, color: C.text, fontWeight: 'bold' }} />
        <TextWidget text={body} maxLines={2} style={{ fontSize: 11, color: C.dim }} />
      </FlexWidget>
      {retry ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextWidget text="⟳ TAP TO RETRY" maxLines={1} style={{ fontSize: 10, color: C.you, fontWeight: 'bold', letterSpacing: 0.08 }} />
          <TextWidget text="OPEN →" clickAction="OPEN_APP" maxLines={1}
            style={{ fontSize: 10, color: C.dim, fontWeight: 'bold', letterSpacing: 0.08, backgroundColor: C.bg, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4 }} />
        </FlexWidget>
      ) : (
        <Header left="" right="OPEN →" rightColor={C.you} />
      )}
    </Frame>
  );
}

/** `offline` (v0.433.1): the last read failed and this is the remembered
 *  picture — the ⟳ chip says so and is the retry, rather than the picture
 *  being replaced by an apology. */
function Chips({ snap, leagues, view, offline }: { snap: WidgetSnapshot; leagues: number; view: WidgetView; offline?: boolean }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
      {snap.assessable ? <Chip text={view === 'score' ? '⇄ lineup' : '⇄ score'} action={WIDGET_CLICK.flip} /> : null}
      {leagues > 1 ? <Chip text="▸ next league" action={WIDGET_CLICK.next} /> : null}
      {offline ? <Chip text="⟳ offline · retry" action={WIDGET_CLICK.refresh} color={C.warn} /> : <Chip text="⟳" action={WIDGET_CLICK.refresh} color={C.you} />}
    </FlexWidget>
  );
}

function leftLine(snap: WidgetSnapshot): string | null {
  if (!snap.left) return null;
  const part = (s: { waiting: number; playing: number }) => {
    const bits: string[] = [];
    if (s.playing) bits.push(`${s.playing} playing`);
    if (s.waiting) bits.push(`${s.waiting} to come`);
    return bits.length ? bits.join(' · ') : 'done';
  };
  return `You ${part(snap.left.me)}  ·  Them ${part(snap.left.them)}`;
}

/** CLASSIC (v0.433.2). Founder: "For classic leagues, let's show predicted
 *  score rather than current. There's still a lot of room in the widget. We
 *  can show empty starting spots, starting spots with out/bye players, and
 *  starters where a player that is projected to score 2+ more points is on
 *  the bench and could replace. No need to make this a separate view." The
 *  scores are the projected finals (the feed says so with `projected`), the
 *  "vs" reads PROJ, and the spots that want attention print on the score
 *  card in the room the window strip used — a classic week scores as one
 *  window, so the strip had nothing to say there. */
function ClassicFixes({ snap, tier }: { snap: WidgetSnapshot; tier: Tier }) {
  const max = tier === 'compact' ? 2 : tier === 'roomy' ? 4 : 8;
  const shown = snap.fixes.slice(0, max);
  const more = snap.fixes.length - shown.length;
  if (!snap.fixes.length) return tier === 'compact' ? null : <Line text="✓ lineup set — nothing to fix" color={C.ok} />;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
      {shown.map((f, i) => (
        <Line key={`${f.win}-${f.kind}-${i}`} text={`${f.winLabel} · ${f.text}`}
          color={f.kind === 'swap' ? C.you : f.kind === 'empty' || f.kind === 'injury' || f.kind === 'bye' ? C.warn : C.text} />
      ))}
      {more > 0 ? <Line text={`+${more} more`} color={C.faint} size={9.5} /> : null}
    </FlexWidget>
  );
}

function ScoreView({ snap, leagues, tier, view, offline }: { snap: WidgetSnapshot; leagues: number; tier: Tier; view: WidgetView; offline?: boolean }) {
  const lineColor: ColorProp = snap.phase === 'live' ? C.live : snap.phase === 'final' ? C.dim : snap.phase === 'bye' || snap.phase === 'idle' ? C.faint : C.warn;
  const leading = snap.them ? (snap.me.score > snap.them.score ? 'me' : snap.me.score < snap.them.score ? 'them' : null) : null;
  const left = leftLine(snap);
  const projected = snap.projected === true && snap.phase !== 'final';
  return (
    <Frame clickAction={WIDGET_CLICK.open} clickActionData={{ uri: matchupDeepLink(snap.leagueId, snap.rosterId) }}>
      <Header left={`${snap.leagueName.toUpperCase()} · ${snap.weekLabel.toUpperCase()}`} right={snap.line.toUpperCase()} rightColor={lineColor} />
      {snap.them ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
          <Side name={snap.me.name} score={snap.me.score} color={leading === 'them' ? C.dim : C.you} align="left" />
          <TextWidget text={projected ? (snap.themLive ? 'PROJ · LIVE' : 'PROJ') : 'vs'} style={{ fontSize: projected ? 9 : 11, color: C.faint, fontWeight: projected ? 'bold' : 'normal', paddingHorizontal: 10 }} />
          <Side name={snap.them.name} score={snap.them.score} color={leading === 'me' ? C.dim : C.opp} align="right" />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          <TextWidget text={snap.me.name} maxLines={1} style={{ fontSize: 16, color: C.text, fontWeight: 'bold' }} />
          <TextWidget text={snap.phase === 'bye' ? 'On a bye this week — nothing to sweat.' : 'No matchup scheduled this week yet.'} maxLines={1} style={{ fontSize: 11, color: C.dim }} />
        </FlexWidget>
      )}
      {snap.them && snap.projected ? <ClassicFixes snap={snap} tier={tier} /> : null}
      {snap.them && !snap.projected && snap.windows.length > 0 ? <Strip windows={snap.windows} /> : null}
      {tier !== 'compact' && snap.them ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          {left ? <Line text={left} /> : null}
          {snap.hot > 0 ? <Line text={`🔥 ${snap.hot} of yours ${snap.hot === 1 ? 'is' : 'are'} hot`} color={C.you} /> : null}
          {snap.alarm && snap.alarm.empty > 0 ? <Line text={`⚠ ${snap.alarm.empty} empty in ${snap.alarm.winLabel} · locks ${clock(snap.alarm.lockMs)}`} color={C.warn} /> : null}
        </FlexWidget>
      ) : null}
      {tier === 'tall' && snap.them && !snap.projected ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          {snap.windows.map((w) => (
            <FlexWidget key={w.id} style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between' }}>
              <TextWidget text={w.label} style={{ fontSize: 10, color: w.phase === 'live' ? C.live : C.faint, fontWeight: 'bold' }} />
              <TextWidget text={w.phase === 'setup' ? 'sealed' : `${fmt(w.me)} – ${fmt(w.them)}`} style={{ fontSize: 10, color: w.phase === 'setup' ? C.faint : C.text }} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
      <Chips snap={snap} leagues={leagues} view={view} offline={offline} />
    </Frame>
  );
}

/** THE CARDS (v0.433.9). Founder: "show the images of the cards of your
 *  players picked in the widget for drip scoring leagues. Have a status chip
 *  and a warning for any unfilled slots." One small card per slot: the
 *  headshot (or a position pill when there is no photo), the name, the sealed
 *  metric, and a STATUS CHIP — EMPTY in amber with a warning mark for a slot
 *  still open and unfilled, MISSED for one that locked unfilled, SET, SEALED,
 *  LIVE with the points so far, FINAL with the points banked. */
const CARD_W = 78;
const FACE = 30;

function statusChip(c: WidgetCard): { text: string; color: ColorProp; bg: ColorProp } {
  const pts = c.points != null ? fmt(c.points) : null;
  switch (c.status) {
    case 'empty': return { text: '⚠ EMPTY', color: '#1A1300', bg: C.warn };
    case 'missed': return { text: 'MISSED', color: C.faint, bg: C.bg };
    case 'unsealed': return { text: 'NO METRIC', color: '#1A1300', bg: C.warn };
    case 'set': return { text: 'SET ✓', color: C.ok, bg: C.bg };
    case 'sealed': return { text: 'SEALED', color: C.dim, bg: C.bg };
    case 'live': return { text: `${c.hot ? '🔥 ' : '● '}${pts ?? '0.0'}`, color: C.live, bg: C.bg };
    default: return { text: `${pts ?? '0.0'} ✓`, color: C.text, bg: C.bg };
  }
}

function Card({ c }: { c: WidgetCard }) {
  const chip = statusChip(c);
  const warn = c.status === 'empty' || c.status === 'unsealed';
  return (
    <FlexWidget style={{ width: CARD_W, flexDirection: 'column', alignItems: 'center', backgroundColor: C.bg, borderRadius: 10, padding: 5, marginRight: 5,
      borderWidth: 1, borderColor: warn ? C.warn : c.status === 'live' ? C.live : C.line }}>
      {c.image
        ? <ImageWidget image={c.image as `https:${string}`} imageWidth={FACE} imageHeight={FACE} radius={8} resizeMode="cover" />
        : <TextWidget text={c.pos ?? (c.status === 'empty' ? '+' : '—')} maxLines={1}
            style={{ width: FACE, height: FACE, fontSize: 12, color: warn ? C.warn : C.faint, fontWeight: 'bold', textAlign: 'center', backgroundColor: C.card, borderRadius: 8 }} />}
      <TextWidget text={c.name || (c.status === 'empty' ? 'pick one' : 'nobody')} truncate="END" maxLines={1}
        style={{ fontSize: 9.5, color: c.name ? C.text : C.faint, fontWeight: 'bold', marginTop: 3 }} />
      <TextWidget text={c.metric ?? (c.slug ? 'no metric' : ' ')} truncate="END" maxLines={1} style={{ fontSize: 8.5, color: C.dim }} />
      <TextWidget text={chip.text} maxLines={1}
        style={{ fontSize: 8.5, color: chip.color, backgroundColor: chip.bg, fontWeight: 'bold', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, marginTop: 3 }} />
    </FlexWidget>
  );
}

/** One window's row: its label down the left, its cards across. */
function CardRow({ win, cards }: { win: WidgetWindow; cards: WidgetCard[] }) {
  const color: ColorProp = win.phase === 'live' ? C.live : win.phase === 'setup' ? C.warn : C.faint;
  const empties = cards.filter((c) => c.status === 'empty').length;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
      <FlexWidget style={{ width: 44, flexDirection: 'column' }}>
        <TextWidget text={win.label} maxLines={2} style={{ fontSize: 9, color, fontWeight: 'bold' }} />
        <TextWidget text={win.phase === 'setup' ? (empties ? `${empties} open` : 'set') : win.phase.toUpperCase()} maxLines={1} style={{ fontSize: 8, color: empties && win.phase === 'setup' ? C.warn : C.faint }} />
      </FlexWidget>
      {cards.map((c) => <Card key={`${c.win}-${c.slot}`} c={c} />)}
    </FlexWidget>
  );
}

/** Which windows a tier shows: one on a 4×2, two on a 4×3, four on a 4×4 —
 *  the open ones first (there is something to do), then live, then locked,
 *  then final — drawn back in kickoff order. */
function windowsToShow(snap: WidgetSnapshot, tier: Tier): WidgetWindow[] {
  const n = tier === 'compact' ? 1 : tier === 'roomy' ? 2 : 4;
  const rank = (w: WidgetWindow) => (w.phase === 'setup' ? 0 : w.phase === 'live' ? 1 : w.phase === 'locked' ? 2 : 3);
  const order = new Map(snap.windows.map((w, i) => [w.id, i]));
  return [...snap.windows].sort((a, b) => rank(a) - rank(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).slice(0, n)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function LineupView({ snap, leagues, tier, view, offline }: { snap: WidgetSnapshot; leagues: number; tier: Tier; view: WidgetView; offline?: boolean }) {
  const n = snap.fixes.length;
  const ready = n === 0;
  const lockLine = snap.alarm ? `${snap.alarm.winLabel} locks ${clock(snap.alarm.lockMs)}` : 'Every window is locked';
  const cards = snap.cards ?? [];
  const rows = windowsToShow(snap, tier).map((w) => ({ w, cards: cards.filter((c) => c.win === w.id) })).filter((r) => r.cards.length);
  const empties = cards.filter((c) => c.status === 'empty').length;
  // Fixes the cards cannot show on their own (an OUT or BYE starter, a
  // missing metric is on the chip already) — a line each on the taller sizes.
  const notes = snap.fixes.filter((f) => f.kind === 'injury' || f.kind === 'bye').slice(0, tier === 'tall' ? 3 : tier === 'roomy' ? 1 : 0);
  return (
    <Frame clickAction={WIDGET_CLICK.open} clickActionData={{ uri: matchupDeepLink(snap.leagueId, snap.rosterId) }}>
      <Header left={`${snap.leagueName.toUpperCase()} · ${snap.weekLabel.toUpperCase()}`}
        right={ready ? lockLine.toUpperCase() : `⚠ ${empties ? `${empties} EMPTY` : `${n} FIX${n === 1 ? '' : 'ES'}`} · ${lockLine.toUpperCase()}`} rightColor={ready ? C.dim : C.warn} />
      {rows.length ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          {rows.map((r) => <CardRow key={r.w.id} win={r.w} cards={r.cards} />)}
        </FlexWidget>
      ) : (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
          <TextWidget text={ready ? 'READY ✓' : `${n} FIX${n === 1 ? '' : 'ES'}`} maxLines={1} style={{ fontSize: 26, color: ready ? C.ok : C.warn, fontWeight: 'bold' }} />
          <TextWidget text={ready ? '  your lineup is set' : `  vs ${snap.them?.name ?? 'bye'}`} truncate="END" maxLines={1} style={{ fontSize: 11, color: C.dim }} />
        </FlexWidget>
      )}
      {notes.length ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          {notes.map((f, i) => <Line key={`${f.win}-${f.kind}-${i}`} text={`${f.winLabel} · ${f.text}`} color={C.warn} size={9.5} />)}
        </FlexWidget>
      ) : null}
      <Chips snap={snap} leagues={leagues} view={view} offline={offline} />
    </Frame>
  );
}

export function MatchupWidget({ state, heightDp = 110, view }: { state: WidgetState; heightDp?: number; /** The manager's flip, or undefined for the feed's lead. */ view?: WidgetView }) {
  if (state.kind === 'signed-out') return <Notice title="Sign in to see your matchup" body="Your live score, right here, once you're signed in." />;
  if (state.kind === 'no-leagues') return <Notice title="No league yet" body="Join or create a league and your matchup lands here." />;
  if (state.kind === 'error') return <Notice title="Couldn’t reach the league" body={state.message} retry />;
  if (state.kind === 'loading') return <Notice title={state.title} body={state.body} />;
  const { snap, leagues, offline } = state;
  const tier = tierFor(heightDp);
  const shown: WidgetView = snap.assessable ? (view ?? snap.lead) : 'score';
  return shown === 'lineup'
    ? <LineupView snap={snap} leagues={leagues} tier={tier} view={shown} offline={offline} />
    : <ScoreView snap={snap} leagues={leagues} tier={tier} view={shown} offline={offline} />;
}
