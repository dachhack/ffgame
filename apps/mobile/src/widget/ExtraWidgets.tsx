// THE ALERTS AND FIELDS WIDGETS (v0.505.0) — the pictures.
//
// Founder: "Can you also make a 1 by 1 widget that give you just line up
// warnings for all your selected leagues and a widget the same size as the
// current but with all fields view so you can track games and stats."
//
//   ALERTS — one cell. The number of lineup warnings across every league the
//     widget may show (Settings → Home-screen widget) and the soonest lock;
//     a green ✓ when there are none. It SCROLLS (v0.506.0, founder: "make the
//     alert 1x1 scrollable so you can scroll to see exactly which leagues need
//     attention"): under the number, one row per league with its count and
//     lock, each opening that league.
//   FIELDS — the matchup widget's size. A pinned header (‹ the week ›, how
//     many games are live / to come / final, whose players are starred, ⟳)
//     over a list of every game: live first, each with its score and clock,
//     who has the ball on a strip of field, the last play, and MY players in
//     it — injury tag, name, and a number coloured by where he is: projected
//     grey, live white, final blue (v0.506.0). A game row opens ▦ All fields.
//
// Same RemoteViews limits and palette as the matchup widget (MatchupWidget.tsx).
// Two rules of the library's tree builder (build-widget-tree.ts), learned the
// hard way before they cost a blank widget: NO FRAGMENTS (it calls every
// element's type as a function, and a fragment's type is a symbol), and NO
// COMPONENT THAT RETURNS null (same call, on null). Children arrays are fine —
// it flattens them — so siblings go in arrays and a maybe-nothing is decided
// at the call site.
import React from 'react';
import { FlexWidget, TextWidget, ImageWidget, ListWidget, type ColorProp } from 'react-native-android-widget';
import type { AlertsSummary, FieldGame } from '@drip/core/data/widgetExtras';
import { spotLabel } from '@drip/core/data/widgetExtras';
import { weekLabel } from '@drip/core/data/nflSlate';
import { C, fmt, Chip, shortClock, matchupDeepLink, WIDGET_CLICK } from './MatchupWidget';
import type { LeagueAlert, FieldMine } from '@drip/core/data/widgetExtras';

export const ALERTS_WIDGET_NAME = 'Alerts';
export const FIELDS_WIDGET_NAME = 'Fields';
/** The deep link a fields tap opens: App.tsx shows ▦ All fields. */
export const FIELDS_DEEP_LINK = 'dripfantasy://fields';
/** The fields widget's own chips (v0.506.0): step the week, back to now, whose players. */
export const FIELDS_CLICK = { prev: 'FIELDS_PREV', next: 'FIELDS_NEXT', now: 'FIELDS_NOW', league: 'FIELDS_LEAGUE' } as const;

// ── ALERTS ──────────────────────────────────────────────────────────────────

export type AlertsState =
  | { kind: 'signed-out' }
  | { kind: 'no-leagues' }
  | { kind: 'ok'; summary: AlertsSummary; leagues: number; offline?: boolean; stale?: boolean };

/** ET, as the matchup widget prints locks: "1:00p", or "Sun 1:00p" when the
 *  lock is not today. */
const lockWhen = (ms: number) => {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' });
  return day.format(new Date(ms)) === day.format(new Date()) ? shortClock(ms) : `${day.format(new Date(ms))} ${shortClock(ms)}`;
};

export function AlertsWidget({ state }: { state: AlertsState }) {
  const frame = (children: React.ReactNode[], clickAction: string, clickActionData?: Record<string, unknown>) => (
    <FlexWidget clickAction={clickAction} clickActionData={clickActionData}
      style={{ width: 'match_parent', height: 'match_parent', backgroundColor: C.card, borderRadius: 16, padding: 4, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      {children}
    </FlexWidget>
  );
  if (state.kind === 'signed-out') {
    return frame([
      <TextWidget key="t" text="DRIP" style={{ fontSize: 10, color: C.faint, fontWeight: 'bold' }} />,
      <TextWidget key="b" text="sign in" style={{ fontSize: 9, color: C.dim }} />,
    ], 'OPEN_APP');
  }
  if (state.kind === 'no-leagues') {
    return frame([
      <TextWidget key="t" text="—" style={{ fontSize: 22, color: C.faint, fontWeight: 'bold' }} />,
      <TextWidget key="b" text="no leagues" style={{ fontSize: 8.5, color: C.dim }} />,
    ], 'OPEN_APP');
  }
  const { summary, leagues, offline } = state;
  if (summary.total === 0) {
    return frame([
      <TextWidget key="t" text="✓" style={{ fontSize: 26, color: C.ok, fontWeight: 'bold' }} />,
      <TextWidget key="b" text={leagues === 1 ? 'lineup set' : `${leagues} set`} maxLines={1} style={{ fontSize: 8.5, color: C.dim, fontWeight: 'bold' }} />,
      offline ? <TextWidget key="o" text="offline" style={{ fontSize: 7.5, color: C.warn }} /> : null,
    ], WIDGET_CLICK.refresh);
  }
  // THE LIST (v0.506.0): the total first — what a 1×1 shows before a scroll —
  // then a row per league, most to fix first, each opening its league.
  const top = summary.leagues[0];
  const open = (l: LeagueAlert) => ({ clickAction: WIDGET_CLICK.open, clickActionData: { uri: matchupDeepLink(l.leagueId, l.rosterId) } });
  return (
    <FlexWidget style={{ width: 'match_parent', height: 'match_parent', backgroundColor: C.card, borderRadius: 16, padding: 4, flexDirection: 'column' }}>
      <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
        <FlexWidget {...open(top)} style={{ width: 'match_parent', flexDirection: 'column', alignItems: 'center', paddingBottom: 4 }}>
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextWidget text="⚠" style={{ fontSize: 12, color: C.warn, fontWeight: 'bold', marginRight: 2 }} />
            <TextWidget text={String(summary.total)} maxLines={1} style={{ fontSize: 24, color: C.warn, fontWeight: 'bold' }} />
          </FlexWidget>
          <TextWidget text={summary.leagues.length === 1 ? top.name : `${summary.leagues.length} leagues ▾`} truncate="END" maxLines={1} style={{ fontSize: 8, color: C.text, fontWeight: 'bold' }} />
          {summary.lockMs != null ? <TextWidget text={`locks ${lockWhen(summary.lockMs)}`} truncate="END" maxLines={1} style={{ fontSize: 7.5, color: C.dim }} /> : null}
          {offline ? <TextWidget text="offline" style={{ fontSize: 7.5, color: C.warn }} /> : null}
        </FlexWidget>
        {summary.leagues.map((l) => (
          <FlexWidget key={l.leagueId} {...open(l)}
            style={{ width: 'match_parent', flexDirection: 'column', backgroundColor: C.bg, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 3, marginTop: 3 }}>
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
              <TextWidget text={`⚠ ${l.n}`} maxLines={1} style={{ fontSize: 9, color: C.warn, fontWeight: 'bold', marginRight: 4 }} />
              <FlexWidget style={{ flex: 1 }}>
                <TextWidget text={l.name} truncate="END" maxLines={1} style={{ fontSize: 8.5, color: C.text, fontWeight: 'bold' }} />
              </FlexWidget>
            </FlexWidget>
            {l.lockMs != null ? <TextWidget text={`locks ${lockWhen(l.lockMs)}`} truncate="END" maxLines={1} style={{ fontSize: 7.5, color: C.dim }} /> : null}
          </FlexWidget>
        ))}
      </ListWidget>
    </FlexWidget>
  );
}

// ── FIELDS ──────────────────────────────────────────────────────────────────

export interface FieldsNav {
  /** The week the fields read as now (Wednesday turnover), and whether ‹ › can move. */
  current: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** Whose players are starred: a league's name, or "All leagues". */
  leagueLabel: string;
}
export type FieldsState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | ({ kind: 'ok'; week: number; games: FieldGame[]; offline?: boolean; stale?: boolean } & Partial<FieldsNav>);

/** A small team logo — ESPN's resizer, so the widget fetches 36px, not 500. */
const logo = (team: string) => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${team.toLowerCase()}.png&h=36&w=36`;

function TeamSide({ team, score, lead, align, showScore }: { team: string; score: number; lead: boolean; align: 'left' | 'right'; showScore: boolean }) {
  const face = <ImageWidget key="f" image={logo(team) as `https:${string}`} imageWidth={16} imageHeight={16} />;
  const name = <TextWidget key="n" text={team} maxLines={1} style={{ fontSize: 11, color: lead ? C.text : C.dim, fontWeight: 'bold', marginLeft: align === 'left' ? 4 : 0, marginRight: align === 'right' ? 4 : 0 }} />;
  const pts = showScore ? <TextWidget key="p" text={String(score)} maxLines={1} style={{ fontSize: 14, color: lead ? C.text : C.dim, fontWeight: 'bold', marginLeft: align === 'left' ? 6 : 0, marginRight: align === 'right' ? 6 : 0 }} /> : null;
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
      {align === 'left' ? [face, name, pts] : [pts, name, face]}
    </FlexWidget>
  );
}

/** Where the ball is: the offense's march as a filled strip, the spot a tick.
 *  Drawn only when the caller has a possession and a spot (see the header:
 *  a component here must never return null). */
function FieldStrip({ g }: { g: FieldGame & { poss: string; toGo: number } }) {
  const opp = g.poss === g.home ? g.away : g.home;
  const gained = Math.max(1, 100 - g.toGo), left = Math.max(1, g.toGo);
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
      <TextWidget text={`● ${g.poss} · ${spotLabel(g.poss, opp, g.toGo)}`} maxLines={1} style={{ fontSize: 8.5, color: C.live, fontWeight: 'bold', marginRight: 6 }} />
      <FlexWidget style={{ flex: 1, height: 6, flexDirection: 'row', backgroundColor: C.line, borderRadius: 3 }}>
        <FlexWidget style={{ flex: gained, height: 6, backgroundColor: C.you, borderRadius: 3 }} />
        <FlexWidget style={{ width: 3, height: 6, backgroundColor: C.text }} />
        <FlexWidget style={{ flex: left, height: 6 }} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** INJ tag colours, as the matchup tiles use them: Q amber, anything that sits him pink. */
const injColor = (t: string): ColorProp => (t === 'Q' ? C.warn : C.opp);

/** One of my players on a game card (v0.506.0): the injury tag, the name, and
 *  his number in the colour of where he is — projected grey, live white,
 *  final blue. */
function MineLine({ m }: { m: FieldMine }) {
  const state = m.state ?? (m.live ? 'live' : m.pts != null ? 'final' : 'pre');
  const num = state === 'pre' ? (m.proj != null ? fmt(m.proj) : '') : `${state === 'live' ? '● ' : ''}${fmt(m.pts ?? 0)}`;
  const color: ColorProp = state === 'pre' ? C.faint : state === 'live' ? C.text : C.you;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
      <TextWidget text="★" style={{ fontSize: 8.5, color: C.you, marginRight: 3 }} />
      {m.injury ? <TextWidget text={m.injury} maxLines={1}
        style={{ fontSize: 7.5, color: C.bg, backgroundColor: injColor(m.injury), fontWeight: 'bold', borderRadius: 3, paddingHorizontal: 2, marginRight: 3 }} /> : null}
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget text={m.name} truncate="END" maxLines={1} style={{ fontSize: 9, color: C.text, fontWeight: 'bold' }} />
      </FlexWidget>
      {num ? <TextWidget text={num} maxLines={1} style={{ fontSize: 9, color, fontWeight: 'bold' }} /> : null}
    </FlexWidget>
  );
}

function GameRow({ g, last }: { g: FieldGame; last: boolean }) {
  const live = g.state === 'live';
  const lead = (a: number, b: number) => g.state !== 'pre' && a > b;
  const clockText = g.state === 'pre' ? (g.kickoff != null ? lockWhen(g.kickoff) : 'TBD') : g.clock ?? '';
  const clockColor: ColorProp = live ? C.live : g.state === 'final' ? C.faint : C.dim;
  const mine = g.mine.slice(0, 4);
  const more = g.mine.length - mine.length;
  return (
    <FlexWidget clickAction={WIDGET_CLICK.open} clickActionData={{ uri: FIELDS_DEEP_LINK }}
      style={{ width: 'match_parent', flexDirection: 'column', backgroundColor: C.bg, borderRadius: 10, padding: 7, marginBottom: last ? 0 : 5,
        borderWidth: 1, borderColor: live ? C.live : C.line }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TeamSide team={g.away} score={g.as} lead={lead(g.as, g.hs)} align="left" showScore={g.state !== 'pre'} />
        <TextWidget text={clockText} maxLines={1} style={{ fontSize: 9, color: clockColor, fontWeight: 'bold' }} />
        <TeamSide team={g.home} score={g.hs} lead={lead(g.hs, g.as)} align="right" showScore={g.state !== 'pre'} />
      </FlexWidget>
      {live && g.poss != null && g.toGo != null ? <FieldStrip g={g as FieldGame & { poss: string; toGo: number }} /> : null}
      {g.last && g.state !== 'final' ? (
        <TextWidget text={g.last} truncate="END" maxLines={2}
          style={{ fontSize: 8.5, color: g.big === 'score' ? C.you : g.big === 'turnover' ? C.opp : C.dim, marginTop: 3 }} />
      ) : null}
      {mine.map((m, i) => <MineLine key={`${m.name}-${i}`} m={m} />)}
      {more > 0 ? <TextWidget text={`+${more} more of yours`} style={{ fontSize: 8, color: C.faint, marginTop: 1 }} /> : null}
    </FlexWidget>
  );
}

export function FieldsWidget({ state }: { state: FieldsState }) {
  const frame = (head: React.ReactNode, body: React.ReactNode) => (
    <FlexWidget style={{ width: 'match_parent', height: 'match_parent', backgroundColor: C.card, borderRadius: 18, padding: 10, flexDirection: 'column' }}>
      {head}
      <FlexWidget style={{ flex: 1, width: 'match_parent' }}>{body}</FlexWidget>
    </FlexWidget>
  );
  const refresh = (offline?: boolean) => (offline
    ? <Chip text="⟳ offline" action={WIDGET_CLICK.refresh} color={C.warn} />
    : <Chip text="⟳" action={WIDGET_CLICK.refresh} color={C.you} />);
  if (state.kind !== 'ok') {
    const msg = state.kind === 'loading' ? 'Reading the week…' : state.kind === 'empty' ? 'No games on the slate yet.' : state.message;
    return frame(
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginBottom: 6 }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
          <FlexWidget style={{ flex: 1 }}><TextWidget text="▦ ALL FIELDS" maxLines={1} style={{ fontSize: 12, color: C.text, fontWeight: 'bold' }} /></FlexWidget>
          {refresh(state.kind === 'error')}
        </FlexWidget>
        <TextWidget text={msg} truncate="END" maxLines={1} style={{ fontSize: 10, color: state.kind === 'error' ? C.warn : C.dim, fontWeight: 'bold', marginTop: 3 }} />
      </FlexWidget>,
      null,
    );
  }
  const { games, week, offline } = state;
  const n = (s: FieldGame['state']) => games.filter((g) => g.state === s).length;
  const live = n('live'), pre = n('pre'), fin = n('final');
  const bits = [live ? `${live} live` : null, pre ? `${pre} to come` : null, fin ? `${fin} final` : null].filter(Boolean).join(' · ');
  const minesLive = games.filter((g) => g.state === 'live').reduce((k, g) => k + g.mine.length, 0);
  const isNow = state.current == null || state.current === week;
  // ‹ › step the week (a dim arrow at the slate's end still answers, and
  // does nothing); the week's name taps back to NOW when it is not now.
  const arrow = (text: string, action: string, can: boolean | undefined) => (
    <TextWidget text={text} clickAction={action}
      style={{ fontSize: 13, color: can === false ? C.line : C.you, fontWeight: 'bold', backgroundColor: C.bg, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 2 }} />
  );
  const head = (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginBottom: 6 }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        {arrow('‹', FIELDS_CLICK.prev, state.hasPrev)}
        <FlexWidget clickAction={FIELDS_CLICK.now} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <TextWidget text={`▦ ${weekLabel(week).toUpperCase()}`} maxLines={1} style={{ fontSize: 12, color: C.text, fontWeight: 'bold' }} />
          <TextWidget text={isNow ? '  NOW' : '  ↺ NOW'} maxLines={1} style={{ fontSize: 8.5, color: isNow ? C.faint : C.you, fontWeight: 'bold' }} />
        </FlexWidget>
        {arrow('›', FIELDS_CLICK.next, state.hasNext)}
        {refresh(offline)}
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget text={`${bits || 'no games'}${minesLive ? ` · ★ ${minesLive} playing` : ''}`} truncate="END" maxLines={1}
            style={{ fontSize: 9.5, color: live ? C.live : C.dim, fontWeight: 'bold' }} />
        </FlexWidget>
        <TextWidget text={`★ ${state.leagueLabel ?? 'All leagues'} ▸`} clickAction={FIELDS_CLICK.league} truncate="END" maxLines={1}
          style={{ fontSize: 9, color: C.you, fontWeight: 'bold', backgroundColor: C.bg, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 6 }} />
      </FlexWidget>
    </FlexWidget>
  );
  return frame(head,
    <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
      {games.map((g, i) => <GameRow key={g.key} g={g} last={i === games.length - 1} />)}
    </ListWidget>,
  );
}
