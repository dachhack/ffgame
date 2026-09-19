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
import { FlexWidget, TextWidget, type ColorProp } from 'react-native-android-widget';
import type { WidgetSnapshot, WidgetView, WidgetWindow } from '@drip/core/data/widgetFeed';

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
  | { kind: 'ok'; snap: WidgetSnapshot; leagues: number };

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
 *  anywhere opens the app, which is the fix for all three. */
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Frame clickAction="OPEN_APP">
      <Header left="DRIP FANTASY" />
      <FlexWidget style={{ flexDirection: 'column' }}>
        <TextWidget text={title} maxLines={1} style={{ fontSize: 16, color: C.text, fontWeight: 'bold' }} />
        <TextWidget text={body} maxLines={2} style={{ fontSize: 11, color: C.dim }} />
      </FlexWidget>
      <Header left="" right="OPEN →" rightColor={C.you} />
    </Frame>
  );
}

function Chips({ snap, leagues, view }: { snap: WidgetSnapshot; leagues: number; view: WidgetView }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
      {snap.assessable ? <Chip text={view === 'score' ? '⇄ lineup' : '⇄ score'} action={WIDGET_CLICK.flip} /> : null}
      {leagues > 1 ? <Chip text="▸ next league" action={WIDGET_CLICK.next} /> : null}
      <Chip text="⟳" action={WIDGET_CLICK.refresh} color={C.you} />
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

function ScoreView({ snap, leagues, tier, view }: { snap: WidgetSnapshot; leagues: number; tier: Tier; view: WidgetView }) {
  const lineColor: ColorProp = snap.phase === 'live' ? C.live : snap.phase === 'final' ? C.dim : snap.phase === 'bye' ? C.faint : C.warn;
  const leading = snap.them ? (snap.me.score > snap.them.score ? 'me' : snap.me.score < snap.them.score ? 'them' : null) : null;
  const left = leftLine(snap);
  return (
    <Frame clickAction={WIDGET_CLICK.open} clickActionData={{ uri: matchupDeepLink(snap.leagueId, snap.rosterId) }}>
      <Header left={`${snap.leagueName.toUpperCase()} · ${snap.weekLabel.toUpperCase()}`} right={snap.line.toUpperCase()} rightColor={lineColor} />
      {snap.them ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
          <Side name={snap.me.name} score={snap.me.score} color={leading === 'them' ? C.dim : C.you} align="left" />
          <TextWidget text="vs" style={{ fontSize: 11, color: C.faint, paddingHorizontal: 10 }} />
          <Side name={snap.them.name} score={snap.them.score} color={leading === 'me' ? C.dim : C.opp} align="right" />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          <TextWidget text={snap.me.name} maxLines={1} style={{ fontSize: 16, color: C.text, fontWeight: 'bold' }} />
          <TextWidget text="On a bye this week — nothing to sweat." maxLines={1} style={{ fontSize: 11, color: C.dim }} />
        </FlexWidget>
      )}
      {snap.them && snap.windows.length > 0 ? <Strip windows={snap.windows} /> : null}
      {tier !== 'compact' && snap.them ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          {left ? <Line text={left} /> : null}
          {snap.hot > 0 ? <Line text={`🔥 ${snap.hot} of yours ${snap.hot === 1 ? 'is' : 'are'} hot`} color={C.you} /> : null}
          {snap.alarm && snap.alarm.empty > 0 ? <Line text={`⚠ ${snap.alarm.empty} empty in ${snap.alarm.winLabel} · locks ${clock(snap.alarm.lockMs)}`} color={C.warn} /> : null}
        </FlexWidget>
      ) : null}
      {tier === 'tall' && snap.them ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          {snap.windows.map((w) => (
            <FlexWidget key={w.id} style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between' }}>
              <TextWidget text={w.label} style={{ fontSize: 10, color: w.phase === 'live' ? C.live : C.faint, fontWeight: 'bold' }} />
              <TextWidget text={w.phase === 'setup' ? 'sealed' : `${fmt(w.me)} – ${fmt(w.them)}`} style={{ fontSize: 10, color: w.phase === 'setup' ? C.faint : C.text }} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
      <Chips snap={snap} leagues={leagues} view={view} />
    </Frame>
  );
}

function LineupView({ snap, leagues, tier, view }: { snap: WidgetSnapshot; leagues: number; tier: Tier; view: WidgetView }) {
  const n = snap.fixes.length;
  const ready = n === 0;
  const max = tier === 'compact' ? 2 : tier === 'roomy' ? 4 : 8;
  const shown = snap.fixes.slice(0, max);
  const more = n - shown.length;
  const lockLine = snap.alarm ? `${snap.alarm.winLabel} locks ${clock(snap.alarm.lockMs)}` : 'Every window is locked';
  return (
    <Frame clickAction={WIDGET_CLICK.open} clickActionData={{ uri: matchupDeepLink(snap.leagueId, snap.rosterId) }}>
      <Header left={`${snap.leagueName.toUpperCase()} · ${snap.weekLabel.toUpperCase()}`} right={lockLine.toUpperCase()} rightColor={ready ? C.dim : C.warn} />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        <TextWidget text={ready ? 'READY ✓' : `${n} FIX${n === 1 ? '' : 'ES'}`} maxLines={1} style={{ fontSize: 26, color: ready ? C.ok : C.warn, fontWeight: 'bold' }} />
        <TextWidget text={ready ? '  your lineup is set' : `  vs ${snap.them?.name ?? 'bye'}`} truncate="END" maxLines={1} style={{ fontSize: 11, color: C.dim }} />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
        {shown.map((f, i) => <Line key={`${f.win}-${f.kind}-${i}`} text={`${f.winLabel} · ${f.text}`} color={f.kind === 'empty' || f.kind === 'injury' ? C.warn : C.text} />)}
        {more > 0 ? <Line text={`+${more} more`} color={C.faint} size={9.5} /> : null}
        {ready && tier !== 'compact' && snap.left ? <Line text={`${snap.left.me.waiting + snap.left.me.playing} starters in · ${snap.hot ? `${snap.hot} hot` : 'all sealed'}`} /> : null}
      </FlexWidget>
      <Chips snap={snap} leagues={leagues} view={view} />
    </Frame>
  );
}

export function MatchupWidget({ state, heightDp = 110, view }: { state: WidgetState; heightDp?: number; /** The manager's flip, or undefined for the feed's lead. */ view?: WidgetView }) {
  if (state.kind === 'signed-out') return <Notice title="Sign in to see your matchup" body="Your live score, right here, once you're signed in." />;
  if (state.kind === 'no-leagues') return <Notice title="No league yet" body="Join or create a league and your matchup lands here." />;
  if (state.kind === 'error') return <Notice title="Couldn’t reach the league" body={state.message} />;
  const { snap, leagues } = state;
  const tier = tierFor(heightDp);
  const shown: WidgetView = snap.assessable ? (view ?? snap.lead) : 'score';
  return shown === 'lineup'
    ? <LineupView snap={snap} leagues={leagues} tier={tier} view={shown} />
    : <ScoreView snap={snap} leagues={leagues} tier={tier} view={shown} />;
}
