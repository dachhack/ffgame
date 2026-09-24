// THE LIVE MATCHUP WIDGET (v0.421.0, v0.422.0) — the picture on the home screen.
//
// Founder: "Let's do the Android live matchup widget." Then: "We can include
// a lot more info in that widget… a lineup assessment widget would be a
// second add or make it a selection in the current widget."
//
// Three cards, by the league on show. The first two share a pinned header
// (▸ next, league, record and place, ⟳; the week, the opponent, the score;
// the roster alerts) over a list that scrolls.
//   DRIP (v0.500.0) — the week's windows, each a box of player tiles, packed
//            into rows by the widget's width. It replaced the score/lineup
//            pair and its ⇄ flip.
//   CLASSIC (v0.501.0) — projected finals in the header; the two teams face
//            to face (avatar, live score, done / live / up), the win bar, and
//            the spots that want attention.
//   SCORE  — any seat with nothing else to show (a bye, no matchup, picks
//            unread): league and week, both teams and scores, the state line.
//            Height picks the tier: a 4×2 shows the essentials, taller
//            widgets add rows — Android tells the task the height.
//
// It is RemoteViews under the hood, so what can be drawn is what
// react-native-android-widget can express: flex boxes and text, no fonts we
// ship, no animation, no clock. Colours are fixed to the app's dark palette:
// a widget has no ThemeCtx, and a home screen is not the app.
import React from 'react';
import { FlexWidget, TextWidget, ImageWidget, ListWidget, type ColorProp } from 'react-native-android-widget';
import { packRows, type WidgetSnapshot, type WidgetWindow, type WidgetCard, type SideLeft } from '@drip/core/data/widgetFeed';
import { crestInitial } from '@drip/core/data/crest';

/** The widgets' palette — the app's dark theme, fixed (exported v0.505.0 for
 *  the alerts and fields widgets). */
export const C = {
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
      offline?: boolean;
      /** A tap is being answered (v0.507.0): ▸ NEXT or ⟳ says so, and the
       *  task draws this frame inert (inert.ts) so nothing answers a second
       *  tap until the fresh picture lands. */
      busy?: 'next' | 'refresh' };

export const MATCHUP_WIDGET_NAME = 'Matchup';
export const WIDGET_CLICK = { open: 'OPEN_URI', next: 'NEXT_LEAGUE', refresh: 'REFRESH' } as const;

/** Height tiers, in dp: what a 4×2 gets, what a 4×3 adds, what a 4×4 adds. */
export type Tier = 'compact' | 'roomy' | 'tall';
export const tierFor = (heightDp: number): Tier => (heightDp >= 250 ? 'tall' : heightDp >= 150 ? 'roomy' : 'compact');

/** The deep link a tap opens: App.tsx routes it to that seat's board. */
export const matchupDeepLink = (leagueId: string, rosterId: number) =>
  `dripfantasy://matchup?league=${encodeURIComponent(leagueId)}&roster=${rosterId}`;

export const fmt = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
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
function BigChip({ text, action, color, busy }: { text: string; action: string; color: ColorProp; busy: boolean }) {
  return (
    <TextWidget text={text} clickAction={action} maxLines={1}
      style={{ fontSize: 11, color: busy ? C.dim : color, fontWeight: 'bold', backgroundColor: busy ? C.line : C.bg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginLeft: 6 }} />
  );
}

function Chips({ leagues, offline, busy }: { leagues: number; offline?: boolean; busy?: 'next' | 'refresh' }) {
  return (
    // Big enough to hit (v0.507.0), and saying so while a tap is answered.
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
      {leagues > 1 ? <BigChip text={busy === 'next' ? '… LOADING' : '▸ NEXT LEAGUE'} action={WIDGET_CLICK.next} color={C.dim} busy={busy === 'next'} /> : null}
      <BigChip text={busy === 'refresh' ? '…' : offline ? '⟳ RETRY' : '⟳'} action={WIDGET_CLICK.refresh} color={offline ? C.warn : C.you} busy={busy === 'refresh'} />
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

function ScoreView({ snap, leagues, tier, offline, busy }: { snap: WidgetSnapshot; leagues: number; tier: Tier; offline?: boolean; busy?: 'next' | 'refresh' }) {
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
      <Chips leagues={leagues} offline={offline} busy={busy} />
    </Frame>
  );
}

/** THE DRIP LEAGUE CARD (v0.500.0) — replaces the score/lineup pair for a
 *  drip seat. Founder, with a sketch: "We build windows and fit them on lines
 *  within the widget without wrap or getting cut off. If a window can fit
 *  next to another window without getting cut off, they can occupy the same
 *  row, if not, the window starts a new row. The widget can scroll down to
 *  show the rest of the windows… pin the scores and league as a header so it
 *  doesn't scroll… a refresh button at the top with the roster alerts."
 *
 *  So: a HEADER that never moves (▸ next, the league, my record and place, ⟳;
 *  the week, the opponent and the score; the alert line), and under it a
 *  ListWidget — the one thing a home-screen widget can scroll — whose items
 *  are ROWS of windows, packed here in JS against the width Android reports.
 *  Each window is a box of player tiles: the face, the name, and one line
 *  that says what he is doing — his points (🔥 when hot), his kickoff, or,
 *  for a Field General who scores nothing himself, FG. An empty slot is
 *  UNSET when the bench can fill it and NONE AVAILABLE when nobody on the
 *  roster plays in that window. A window too wide for any row takes a row of
 *  its own and runs its tiles onto a second line inside its box — a window
 *  is never cut. */
const PAD = 10;
const TILE_W = 60;   // holds a FACE_W (50) headshot inside its padding and border
const TILE_GAP = 4;
const WIN_PAD = 4;
const WIN_GAP = 6;
const FACE = 36;
/** A headshot's width at FACE tall (v0.501.1). Founder: "the player head shots
 *  appear a little stretched out tall." The widget library scales a picture
 *  to EXACTLY the box it is given (createScaledBitmap — resizeMode never gets
 *  a say), and every headshot is ESPN's 600×436, so a square box squeezed
 *  them narrow. The box now has their shape. */
const FACE_W = Math.round(FACE * 600 / 436);

/** The width a window's box takes with `n` tiles on one line, border included. */
const boxWidth = (n: number) => n * TILE_W + Math.max(0, n - 1) * TILE_GAP + 2 * WIN_PAD + 2;
/** How many tiles fit on one line of a box `inner` dp wide (never fewer than one). */
const tilesPerLine = (inner: number) => Math.max(1, Math.floor((inner - 2 * WIN_PAD - 2 + TILE_GAP) / (TILE_W + TILE_GAP)));

interface PackedWindow { win: WidgetWindow; cards: WidgetCard[] }
/** The week's windows as rows `inner` dp wide (core's packRows), in kickoff
 *  order; windows with no slots are left out. */
function packWindows(windows: WidgetWindow[], cards: WidgetCard[], inner: number): PackedWindow[][] {
  const boxes = windows.map((win) => ({ win, cards: cards.filter((c) => c.win === win.id) })).filter((b) => b.cards.length);
  return packRows(boxes.map((b) => boxWidth(b.cards.length)), inner, WIN_GAP).map((row) => row.map((i) => boxes[i]));
}

const ordinal = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
};
/** "1:00p" — the kickoff, ET, short enough for a tile. */
export const shortClock = (ms: number) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  .format(new Date(ms)).replace(/\s?([AP])M$/i, (_, m: string) => m.toLowerCase());

interface TileLook { face: string; name: string; foot: string; footColor: ColorProp; border: ColorProp; dim?: boolean }
function tileLook(c: WidgetCard): TileLook {
  const fg = c.metricId === 'fg';
  const pts = c.points != null ? fmt(c.points) : '0.0';
  const when = c.kick != null ? shortClock(c.kick) : null;
  // A CLASSIC card (v0.503.0) carries a projection: before his game it is the
  // number the tile shows, after it the points he scored.
  const classic = c.proj != null || c.bestball != null;
  if (classic) {
    switch (c.status) {
      case 'empty': return { face: '✕', name: 'Empty', foot: 'START ONE', footColor: C.warn, border: C.warn };
      case 'missed': return { face: '—', name: 'Empty', foot: '0.0', footColor: C.faint, border: C.line, dim: true };
      case 'set': return { face: c.pos ?? '?', name: c.name, foot: c.bye ? 'BYE' : `P ${fmt(c.proj ?? 0)}`, footColor: c.bye ? C.warn : C.dim, border: c.bye ? C.warn : C.line };
      case 'live': return { face: c.pos ?? '?', name: c.name, foot: `● ${pts}`, footColor: C.live, border: C.live };
      default: return { face: c.pos ?? '?', name: c.name, foot: pts, footColor: C.text, border: C.line };
    }
  }
  switch (c.status) {
    case 'empty': return { face: '✕', name: 'Unset', foot: 'SET IT', footColor: C.warn, border: C.warn };
    case 'none': return { face: '∅', name: 'None', foot: 'AVAILABLE', footColor: C.warn, border: C.warn };
    case 'missed': return { face: '—', name: 'Missed', foot: 'NO PICK', footColor: C.faint, border: C.line, dim: true };
    case 'unsealed': return { face: c.pos ?? '?', name: c.name, foot: 'NO METRIC', footColor: C.warn, border: C.warn };
    case 'set': case 'sealed':
      return { face: c.pos ?? '?', name: c.name, foot: fg ? `⚡FG${when ? ` ${when}` : ''}` : when ?? (c.status === 'set' ? 'SET ✓' : 'SEALED'), footColor: C.dim, border: C.line };
    case 'live':
      return { face: c.pos ?? '?', name: c.name, foot: fg ? '⚡ FG' : `${pts}${c.hot ? ' 🔥' : ''}`, footColor: c.hot ? C.you : C.live, border: C.live };
    default:
      return { face: c.pos ?? '?', name: c.name, foot: fg ? 'FG ✓' : pts, footColor: C.text, border: C.line };
  }
}

/** THE INJURY TAG (v0.503.0). Founder: "We also need injury designations on
 *  each player across all screens." The sheet's own letters, shortened to
 *  fit a tile: Q in amber (he may play), anything that sits him — D, O, IR,
 *  PUP, SUS — in the opponent's pink. */
const INJ_SHORT: Record<string, string> = { QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'O', PROBABLE: 'P' };
function injuryTag(tag: string | null | undefined): { text: string; color: ColorProp } | null {
  if (!tag) return null;
  const t = INJ_SHORT[tag.toUpperCase()] ?? tag.toUpperCase().slice(0, 3);
  return { text: t, color: t === 'Q' || t === 'P' ? C.warn : C.opp };
}

function Tile({ c, last }: { c: WidgetCard; last: boolean }) {
  const t = tileLook(c);
  const placeholder = c.status === 'empty' || c.status === 'none' || c.status === 'missed';
  const inj = placeholder ? null : injuryTag(c.injury);
  // A classic card names its spot on top: "RB 2", or "BB·FLEX" for a
  // best-ball spot the resolver fills.
  const spot = c.proj != null || c.bestball != null ? `${c.bestball ? 'BB·' : ''}${c.winLabel}` : null;
  return (
    <FlexWidget style={{ width: TILE_W, flexDirection: 'column', alignItems: 'center', backgroundColor: C.bg, borderRadius: 8, borderWidth: 1, borderColor: t.border,
      paddingVertical: 3, paddingHorizontal: 2, marginRight: last ? 0 : TILE_GAP }}>
      {spot ? <TextWidget text={spot} truncate="END" maxLines={1} style={{ fontSize: 8, color: c.bestball ? C.you : C.faint, fontWeight: 'bold', marginBottom: 2 }} /> : null}
      {c.image && !placeholder
        ? <ImageWidget image={c.image as `https:${string}`} imageWidth={FACE_W} imageHeight={FACE} radius={7} />
        : <TextWidget text={t.face} maxLines={1}
            style={{ width: FACE, height: FACE, fontSize: placeholder ? 16 : 11, color: placeholder && !t.dim ? C.warn : C.faint, fontWeight: 'bold', textAlign: 'center', backgroundColor: C.card, borderRadius: 7 }} />}
      <TextWidget text={t.name} truncate="END" maxLines={1}
        style={{ fontSize: 9, color: t.dim ? C.faint : placeholder ? C.warn : C.text, fontWeight: 'bold', marginTop: 2 }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        {inj ? <TextWidget text={inj.text} maxLines={1}
          style={{ fontSize: 8, color: C.bg, backgroundColor: inj.color, fontWeight: 'bold', borderRadius: 3, paddingHorizontal: 2, marginRight: 3 }} /> : null}
        <TextWidget text={t.foot} truncate="END" maxLines={1} style={{ fontSize: 8.5, color: t.footColor, fontWeight: 'bold' }} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** One window's box: its label (● live, ✓ won, ✗ lost), then its tiles, as
 *  many lines as the row's width needs. */
function WindowBox({ win, cards, perLine, last }: { win: WidgetWindow; cards: WidgetCard[]; perLine: number; last: boolean }) {
  const scored = win.me > 0 || win.them > 0;
  const lead = scored ? (win.me > win.them ? 'me' : win.me < win.them ? 'them' : 'tie') : null;
  const mark = win.phase === 'live' ? ' ●' : win.phase === 'final' ? (lead === 'me' ? ' ✓' : lead === 'them' ? ' ✗' : ' –') : '';
  const color: ColorProp = win.phase === 'live' ? C.live : win.phase === 'setup' ? C.dim : lead === 'me' ? C.you : lead === 'them' ? C.opp : C.faint;
  const warn = cards.some((c) => c.status === 'empty' || c.status === 'none' || c.status === 'unsealed');
  const lines: WidgetCard[][] = [];
  for (let i = 0; i < cards.length; i += perLine) lines.push(cards.slice(i, i + perLine));
  const score = win.phase === 'setup' || win.phase === 'locked' ? '' : `  ${fmt(win.me)}–${fmt(win.them)}`;
  return (
    <FlexWidget style={{ flexDirection: 'column', padding: WIN_PAD, borderRadius: 10, borderWidth: 1, borderColor: warn ? C.warn : win.phase === 'live' ? C.live : C.line,
      marginRight: last ? 0 : WIN_GAP }}>
      <TextWidget text={`${win.label}${mark}${score}`} maxLines={1} style={{ fontSize: 9, color, fontWeight: 'bold', marginBottom: 3 }} />
      {lines.map((line, i) => (
        <FlexWidget key={i} style={{ flexDirection: 'row', marginTop: i ? TILE_GAP : 0 }}>
          {line.map((c, j) => <Tile key={`${c.win}-${c.slot}`} c={c} last={j === line.length - 1} />)}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

/** The alert line: what to fix, or — nothing to fix — where the week stands. */
function alertLine(snap: WidgetSnapshot): { text: string; color: ColorProp } {
  const cards = snap.cards ?? [];
  const unset = cards.filter((c) => c.status === 'empty').length;
  const none = cards.filter((c) => c.status === 'none').length;
  const metric = cards.filter((c) => c.status === 'unsealed').length;
  const hurt = snap.fixes.filter((f) => f.kind === 'injury' || f.kind === 'bye').length;
  const bits: string[] = [];
  if (unset) bits.push(`${unset} unset`);
  if (none) bits.push(`${none} none available`);
  if (metric) bits.push(`${metric} no metric`);
  if (hurt) bits.push(`${hurt} out/bye`);
  if (bits.length) {
    const lock = snap.alarm ? ` · ${snap.alarm.winLabel} locks ${clock(snap.alarm.lockMs)}` : '';
    return { text: `⚠ ${bits.join(' · ')}${lock}`, color: C.warn };
  }
  const color: ColorProp = snap.phase === 'live' ? C.live : snap.phase === 'final' ? C.dim : C.ok;
  return { text: snap.phase === 'pre' ? `✓ Lineup set · ${snap.line}` : snap.line, color };
}

/** THE PINNED HEADER, both games (v0.500.0, shared v0.501.0): ▸ NEXT, the
 *  league, my record and place, ⟳; the week, the opponent and the score
 *  (PROJ in a classic league, whose header scores are the projected finals);
 *  the alert line. It sits outside the list, so it never scrolls. */
/** THE HEADER'S TWO BUTTONS (v0.507.0). Founder: "Can we make the next button
 *  two rows high instead of one? It's kinda hard to press because it's so
 *  small... Same for the refresh button." Each is a block the height of the
 *  header's two top rows — ▸ NEXT on the left, ⟳ on the right — and while its
 *  tap is being answered it says so (LOADING / …) in a dimmed block. */
const BTN_H = 42;
function HeaderButton({ glyph, label, action, color, busy, width }: { glyph: string; label?: string; action: string; color: ColorProp; busy: boolean; width: number }) {
  return (
    <FlexWidget clickAction={action}
      style={{ width, height: BTN_H, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: busy ? C.line : C.bg, borderRadius: 10 }}>
      <TextWidget text={busy ? '…' : glyph} maxLines={1} style={{ fontSize: busy ? 14 : 16, color: busy ? C.dim : color, fontWeight: 'bold' }} />
      {label || busy ? <TextWidget text={busy ? 'LOADING' : label ?? ''} maxLines={1} style={{ fontSize: 7.5, color: busy ? C.dim : color, fontWeight: 'bold', letterSpacing: 0.06 }} /> : null}
    </FlexWidget>
  );
}

function LeagueHeader({ snap, leagues, offline, alert, busy }: { snap: WidgetSnapshot; leagues: number; offline?: boolean; alert: { text: string; color: ColorProp }; busy?: 'next' | 'refresh' }) {
  const open = openMatchup(snap);
  const st = snap.standing;
  const record = st ? `${st.wins}-${st.losses}${st.ties ? `-${st.ties}` : ''} · ${ordinal(st.place)}` : '';
  const leading = snap.them ? (snap.me.score > snap.them.score ? 'me' : snap.me.score < snap.them.score ? 'them' : null) : null;
  const proj = snap.projected === true && snap.phase !== 'final';
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        {leagues > 1 ? <HeaderButton glyph="▸" label="NEXT" action={WIDGET_CLICK.next} color={C.dim} busy={busy === 'next'} width={48} /> : null}
        <FlexWidget {...open} style={{ flex: 1, flexDirection: 'column', marginLeft: leagues > 1 ? 8 : 0, marginRight: 8 }}>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
            <TextWidget text={snap.leagueName} truncate="END" maxLines={1} style={{ fontSize: 12, color: C.text, fontWeight: 'bold' }} />
            {record ? <TextWidget text={`  ${record}`} maxLines={1} style={{ fontSize: 10, color: C.dim, fontWeight: 'bold' }} /> : null}
          </FlexWidget>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            <FlexWidget style={{ flex: 1 }}>
              <TextWidget text={`${snap.weekLabel.toUpperCase()} · vs ${snap.them?.name ?? 'nobody'}`} truncate="END" maxLines={1}
                style={{ fontSize: 10.5, color: C.dim, fontWeight: 'bold' }} />
            </FlexWidget>
            {snap.them ? (
              <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
                {proj ? <TextWidget text={snap.themLive ? 'PROJ · LIVE  ' : 'PROJ  '} maxLines={1} style={{ fontSize: 8.5, color: C.faint, fontWeight: 'bold' }} /> : null}
                <TextWidget text={fmt(snap.me.score)} maxLines={1} style={{ fontSize: 16, color: leading === 'them' ? C.dim : C.you, fontWeight: 'bold' }} />
                <TextWidget text=" – " maxLines={1} style={{ fontSize: 12, color: C.faint }} />
                <TextWidget text={fmt(snap.them.score)} maxLines={1} style={{ fontSize: 16, color: leading === 'me' ? C.dim : C.opp, fontWeight: 'bold' }} />
              </FlexWidget>
            ) : null}
          </FlexWidget>
        </FlexWidget>
        <HeaderButton glyph="⟳" label={offline ? 'RETRY' : undefined} action={WIDGET_CLICK.refresh} color={offline ? C.warn : C.you} busy={busy === 'refresh'} width={42} />
      </FlexWidget>
      <TextWidget {...open} text={alert.text} truncate="END" maxLines={1} style={{ fontSize: 10, color: alert.color, fontWeight: 'bold', marginTop: 5, marginBottom: 6 }} />
    </FlexWidget>
  );
}

const openMatchup = (snap: WidgetSnapshot) => ({ clickAction: WIDGET_CLICK.open, clickActionData: { uri: matchupDeepLink(snap.leagueId, snap.rosterId) } });

/** The card's frame: the header on top, and under it the one part that
 *  scrolls — a ListWidget, each child one item. */
function PinnedFrame({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <FlexWidget style={{ width: 'match_parent', height: 'match_parent', backgroundColor: C.card, borderRadius: 18, padding: PAD, flexDirection: 'column' }}>
      {header}
      <FlexWidget style={{ flex: 1, width: 'match_parent' }}>
        <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>{children}</ListWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

function DripView({ snap, leagues, widthDp, offline, busy }: { snap: WidgetSnapshot; leagues: number; widthDp: number; offline?: boolean; busy?: 'next' | 'refresh' }) {
  const open = openMatchup(snap);
  const inner = widthDp - 2 * PAD;
  const rows = packWindows(snap.windows, snap.cards ?? [], inner);
  const perLine = tilesPerLine(inner);
  return (
    <PinnedFrame header={<LeagueHeader snap={snap} leagues={leagues} offline={offline} alert={alertLine(snap)} busy={busy} />}>
      {rows.map((row, i) => (
        <FlexWidget key={row.map((r) => r.win.id).join('+')} {...open}
          style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-start', paddingBottom: i === rows.length - 1 ? 0 : 6 }}>
          {row.map((r, j) => <WindowBox key={r.win.id} win={r.win} cards={r.cards} perLine={perLine} last={j === row.length - 1} />)}
        </FlexWidget>
      ))}
    </PinnedFrame>
  );
}

/** THE CLASSIC LEAGUE CARD (v0.501.0). Founder: "The header is pretty much
 *  the same except it shows projected score rather than the actual. Instead
 *  of cards, just have the avatar for the user vs the avatar for the user's
 *  opponent with the current score and number of players finished, in
 *  progress, upcoming by team." Then: "win probability bar would be good."
 *
 *  Under the shared header (projected finals there), the list holds: the two
 *  teams face to face — avatar, name, the LIVE score, and DONE / LIVE / UP
 *  counts — then the win bar, then the spots that want attention (empty,
 *  out/bye, a bench upgrade), one line each. It scrolls, so a 4×2 shows the
 *  faces and a thumb reaches the rest. */
const AVATAR = 42;

function TeamFace({ name, avatar, score, left, color, align }: { name: string; avatar?: string | null; score: number; left?: SideLeft | null; color: ColorProp; align: 'left' | 'right' }) {
  const counts: [string, number | null][] = [['DONE', left?.done ?? null], ['LIVE', left?.playing ?? null], ['UP', left?.waiting ?? null]];
  const face = avatar
    ? <ImageWidget image={avatar as `https:${string}`} imageWidth={AVATAR} imageHeight={AVATAR} radius={AVATAR / 2} resizeMode="cover" />
    : <TextWidget text={crestInitial(name)} maxLines={1}
        style={{ width: AVATAR, height: AVATAR, fontSize: 18, color, fontWeight: 'bold', textAlign: 'center', backgroundColor: C.bg, borderRadius: AVATAR / 2 }} />;
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      {/* The face on the outside edge, the score toward the middle. */}
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        {align === 'left' ? face : null}
        <TextWidget text={fmt(score)} maxLines={1} style={{ fontSize: 24, color, fontWeight: 'bold', marginLeft: align === 'left' ? 8 : 0, marginRight: align === 'right' ? 8 : 0 }} />
        {align === 'right' ? face : null}
      </FlexWidget>
      <TextWidget text={name} truncate="END" maxLines={1} style={{ fontSize: 10, color: C.text, fontWeight: 'bold', marginTop: 3, textAlign: align }} />
      <FlexWidget style={{ flexDirection: 'row', marginTop: 3 }}>
        {counts.map(([label, n], i) => (
          <FlexWidget key={label} style={{ flexDirection: 'column', alignItems: 'center', marginLeft: i ? 8 : 0 }}>
            <TextWidget text={n == null ? '–' : String(n)} maxLines={1} style={{ fontSize: 12, color: label === 'LIVE' && n ? C.live : C.text, fontWeight: 'bold' }} />
            <TextWidget text={label} maxLines={1} style={{ fontSize: 7.5, color: C.faint, fontWeight: 'bold', letterSpacing: 0.08 }} />
          </FlexWidget>
        ))}
      </FlexWidget>
    </FlexWidget>
  );
}

/** The win bar: my share in my colour, theirs in theirs, the numbers under it. */
function WinBar({ pct }: { pct: number }) {
  const me = Math.round(pct * 100);
  // A sliver either side, so a 99% still shows the other colour.
  const a = Math.max(2, Math.min(98, me));
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginTop: 8 }}>
      <FlexWidget style={{ width: 'match_parent', height: 7, flexDirection: 'row' }}>
        <FlexWidget style={{ flex: a, height: 7, backgroundColor: C.you, borderRadius: 3, marginRight: 2 }} />
        <FlexWidget style={{ flex: 100 - a, height: 7, backgroundColor: C.opp, borderRadius: 3 }} />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <TextWidget text={`${me}% WIN`} maxLines={1} style={{ fontSize: 9, color: C.you, fontWeight: 'bold' }} />
        <TextWidget text={`${100 - me}%`} maxLines={1} style={{ fontSize: 9, color: C.opp, fontWeight: 'bold' }} />
      </FlexWidget>
    </FlexWidget>
  );
}

function classicAlert(snap: WidgetSnapshot): { text: string; color: ColorProp } {
  const n = (k: string) => snap.fixes.filter((f) => f.kind === k).length;
  const empty = n('empty'), hurt = n('injury') + n('bye'), swap = n('swap');
  const bits: string[] = [];
  if (empty) bits.push(`${empty} empty`);
  if (hurt) bits.push(`${hurt} out/bye`);
  if (swap) bits.push(`${swap} upgrade${swap === 1 ? '' : 's'}`);
  if (bits.length) return { text: `⚠ ${bits.join(' · ')}`, color: empty || hurt ? C.warn : C.you };
  const color: ColorProp = snap.phase === 'live' ? C.live : snap.phase === 'final' ? C.dim : C.ok;
  return { text: snap.phase === 'pre' ? `✓ Lineup set · ${snap.line}` : snap.line, color };
}

function ClassicView({ snap, leagues, widthDp, offline, busy }: { snap: WidgetSnapshot; leagues: number; widthDp: number; offline?: boolean; busy?: 'next' | 'refresh' }) {
  const open = openMatchup(snap);
  // THE LINEUP (v0.503.0): every starting spot as a card, best-ball spots
  // included, as many to a line as the width holds — one list item a line.
  const perLine = tilesPerLine(widthDp - 2 * PAD + 2 * WIN_PAD + 2);
  const cards = snap.cards ?? [];
  const lines: WidgetCard[][] = [];
  for (let i = 0; i < cards.length; i += perLine) lines.push(cards.slice(i, i + perLine));
  const them = snap.them!;
  const live = snap.actual ?? { me: snap.me.score, them: them.score };
  const leading = live.me > live.them ? 'me' : live.me < live.them ? 'them' : null;
  return (
    <PinnedFrame header={<LeagueHeader snap={snap} leagues={leagues} offline={offline} alert={classicAlert(snap)} busy={busy} />}>
      <FlexWidget {...open} style={{ width: 'match_parent', flexDirection: 'column' }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-start' }}>
          <TeamFace name={snap.me.name} avatar={snap.me.avatar} score={live.me} left={snap.left?.me} color={leading === 'them' ? C.dim : C.you} align="left" />
          <TextWidget text="vs" maxLines={1} style={{ fontSize: 10, color: C.faint, paddingHorizontal: 6, marginTop: 14 }} />
          <TeamFace name={them.name} avatar={them.avatar} score={live.them} left={snap.themLive ? null : snap.left?.them} color={leading === 'me' ? C.dim : C.opp} align="right" />
        </FlexWidget>
        {snap.winPct != null ? <WinBar pct={snap.winPct} /> : null}
      </FlexWidget>
      {snap.fixes.map((f, i) => (
        <FlexWidget key={`${f.win}-${f.kind}-${i}`} {...open} style={{ width: 'match_parent', marginTop: i ? 2 : 8 }}>
          <Line text={`${f.winLabel} · ${f.text}`} color={f.kind === 'swap' ? C.you : C.warn} />
        </FlexWidget>
      ))}
      {lines.length ? (
        <FlexWidget {...open} style={{ width: 'match_parent', marginTop: 10, marginBottom: 4 }}>
          <TextWidget text="LINEUP" maxLines={1} style={{ fontSize: 9, color: C.faint, fontWeight: 'bold', letterSpacing: 0.12 }} />
        </FlexWidget>
      ) : null}
      {lines.map((line, i) => (
        <FlexWidget key={`line-${i}`} {...open} style={{ width: 'match_parent', flexDirection: 'row', paddingBottom: TILE_GAP }}>
          {line.map((c, j) => <Tile key={c.slot} c={c} last={j === line.length - 1} />)}
        </FlexWidget>
      ))}
    </PinnedFrame>
  );
}

export function MatchupWidget({ state, heightDp = 110, widthDp = 320 }: { state: WidgetState; heightDp?: number; widthDp?: number }) {
  if (state.kind === 'signed-out') return <Notice title="Sign in to see your matchup" body="Your live score, right here, once you're signed in." />;
  if (state.kind === 'no-leagues') return <Notice title="No league yet" body="Join or create a league and your matchup lands here." />;
  if (state.kind === 'error') return <Notice title="Couldn’t reach the league" body={state.message} retry />;
  if (state.kind === 'loading') return <Notice title={state.title} body={state.body} />;
  const { snap, leagues, offline, busy } = state;
  // A drip seat with its picks read gets the drip card, a classic seat with
  // an opponent the classic card; everything else (a bye, no matchup, picks
  // unread) keeps the score card.
  if (snap.assessable && (snap.cards ?? []).length > 0) return <DripView snap={snap} leagues={leagues} widthDp={widthDp} offline={offline} busy={busy} />;
  if (snap.projected && snap.them) return <ClassicView snap={snap} leagues={leagues} widthDp={widthDp} offline={offline} busy={busy} />;
  return <ScoreView snap={snap} leagues={leagues} tier={tierFor(heightDp)} offline={offline} busy={busy} />;
}
