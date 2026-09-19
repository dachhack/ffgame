// THE LIVE MATCHUP WIDGET (v0.421.0) — the picture on the home screen.
//
// Founder: "Let's do the Android live matchup widget."
//
// One 4×2 card: the league, the two teams and their scores, the state line
// ("LIVE · SUN 1PM", "Locks Sun, Sep 21 1:00 PM", "FINAL · W 121.4–98.2").
// It is RemoteViews under the hood, so what can be drawn is what
// react-native-android-widget can express: flex boxes and text, no fonts we
// ship, no animation, no clock. Tapping the card opens the app on that
// matchup; the ▸ chip walks to the next league you're in; ⟳ repaints now.
//
// Colours are fixed to the app's dark palette rather than the theme tokens:
// a widget has no ThemeCtx, and a home screen is not the app.
import React from 'react';
import { FlexWidget, TextWidget, type ColorProp } from 'react-native-android-widget';
import type { WidgetSnapshot } from '@drip/core/data/widgetFeed';

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
} as const;

export type WidgetState =
  | { kind: 'signed-out' }
  | { kind: 'no-leagues' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; snap: WidgetSnapshot; leagues: number };

export const MATCHUP_WIDGET_NAME = 'Matchup';
export const WIDGET_CLICK = { open: 'OPEN_URI', next: 'NEXT_LEAGUE', refresh: 'REFRESH' } as const;

/** The deep link a tap opens: App.tsx routes it to that seat's board. */
export const matchupDeepLink = (leagueId: string, rosterId: number) =>
  `dripfantasy://matchup?league=${encodeURIComponent(leagueId)}&roster=${rosterId}`;

const fmt = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

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

export function MatchupWidget({ state }: { state: WidgetState }) {
  if (state.kind === 'signed-out') return <Notice title="Sign in to see your matchup" body="Your live score, right here, once you're signed in." />;
  if (state.kind === 'no-leagues') return <Notice title="No league yet" body="Join or create a league and your matchup lands here." />;
  if (state.kind === 'error') return <Notice title="Couldn’t reach the league" body={state.message} />;

  const { snap, leagues } = state;
  const lineColor = snap.phase === 'live' ? C.live : snap.phase === 'final' ? C.dim : snap.phase === 'bye' ? C.faint : C.warn;
  const leading = snap.them ? (snap.me.score > snap.them.score ? 'me' : snap.me.score < snap.them.score ? 'them' : null) : null;
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
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
        {leagues > 1 ? <Chip text="▸ next league" action={WIDGET_CLICK.next} /> : null}
        <Chip text="⟳" action={WIDGET_CLICK.refresh} color={C.you} />
      </FlexWidget>
    </Frame>
  );
}
