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
import { C, fmt, shortClock, matchupDeepLink, WIDGET_CLICK } from './MatchupWidget';
import type { LeagueAlert, FieldMine } from '@drip/core/data/widgetExtras';

export const ALERTS_WIDGET_NAME = 'Alerts';
export const FIELDS_WIDGET_NAME = 'Fields';
/** The deep link a fields tap opens: App.tsx shows ▦ All fields. */
export const FIELDS_DEEP_LINK = 'dripfantasy://fields';
/** The fields widget's own chips (v0.506.0): step the week, back to now, whose players. */
export const FIELDS_CLICK = { prev: 'FIELDS_PREV', next: 'FIELDS_NEXT', now: 'FIELDS_NOW', league: 'FIELDS_LEAGUE', toggle: 'FIELDS_TOGGLE' } as const;

// ── ALERTS ──────────────────────────────────────────────────────────────────

export type AlertsState =
  | { kind: 'signed-out' }
  | { kind: 'no-leagues' }
  | { kind: 'ok'; summary: AlertsSummary; leagues: number; offline?: boolean; stale?: boolean; /** A tap is being answered (v0.507.0). */ busy?: boolean };

/** ET, as the matchup widget prints locks: "1:00p", or "Sun 1:00p" when the
 *  lock is not today. */
const lockWhen = (ms: number) => {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' });
  return day.format(new Date(ms)) === day.format(new Date()) ? shortClock(ms) : `${day.format(new Date(ms))} ${shortClock(ms)}`;
};

/** Below this width the widget is the old 1×1 and stacks; at 2×1 (v0.511.0)
 *  the total sits in a block on the left and the leagues scroll beside it. */
const ALERTS_WIDE_DP = 100;

export function AlertsWidget({ state, widthDp = 0 }: { state: AlertsState; widthDp?: number }) {
  if (state.kind === 'ok' && widthDp >= ALERTS_WIDE_DP) return <AlertsWide state={state} />;
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
      <TextWidget key="t" text={state.busy ? '…' : '✓'} style={{ fontSize: 26, color: state.busy ? C.dim : C.ok, fontWeight: 'bold' }} />,
      <TextWidget key="b" text={state.busy ? 'checking' : leagues === 1 ? 'lineup set' : `${leagues} set`} maxLines={1} style={{ fontSize: 8.5, color: C.dim, fontWeight: 'bold' }} />,
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

/** THE 2×1 (v0.511.0). Founder: "Let's make the line up alert widget 2 by 1.
 *  Change the layout to fit and still scroll." One cell tall, two wide: the
 *  total and the soonest lock in a block on the left (a tap opens the league
 *  with the most to fix), and beside it the leagues that need attention, one
 *  row each — count, name, lock — scrolling when there are more than fit,
 *  each row opening its league. All set: ✓ and how many leagues, one tap to
 *  re-check. */
function AlertsWide({ state }: { state: Extract<AlertsState, { kind: 'ok' }> }) {
  const { summary, leagues, offline, busy } = state;
  const frame = (children: React.ReactNode[], clickAction?: string) => (
    <FlexWidget clickAction={clickAction}
      style={{ width: 'match_parent', height: 'match_parent', backgroundColor: C.card, borderRadius: 16, padding: 5, flexDirection: 'row', alignItems: 'center' }}>
      {children}
    </FlexWidget>
  );
  if (summary.total === 0) {
    return frame([
      <TextWidget key="t" text={busy ? '…' : '✓'} style={{ fontSize: 26, color: busy ? C.dim : C.ok, fontWeight: 'bold', marginHorizontal: 8 }} />,
      <FlexWidget key="w" style={{ flex: 1, flexDirection: 'column' }}>
        <TextWidget text={busy ? 'checking…' : 'Lineups set'} maxLines={1} style={{ fontSize: 11, color: C.text, fontWeight: 'bold' }} />
        <TextWidget text={offline ? 'offline · tap to retry' : leagues === 1 ? '1 league' : `${leagues} leagues`} maxLines={1} style={{ fontSize: 8.5, color: offline ? C.warn : C.dim }} />
      </FlexWidget>,
    ], WIDGET_CLICK.refresh);
  }
  const top = summary.leagues[0];
  const open = (l: LeagueAlert) => ({ clickAction: WIDGET_CLICK.open, clickActionData: { uri: matchupDeepLink(l.leagueId, l.rosterId) } });
  return frame([
    <FlexWidget key="n" {...open(top)}
      style={{ width: 52, height: 'match_parent', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, borderRadius: 11 }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextWidget text="⚠" style={{ fontSize: 10, color: C.warn, fontWeight: 'bold', marginRight: 1 }} />
        <TextWidget text={String(summary.total)} maxLines={1} style={{ fontSize: 20, color: C.warn, fontWeight: 'bold' }} />
      </FlexWidget>
      <TextWidget text={offline ? 'offline' : summary.lockMs != null ? shortClock(summary.lockMs) : 'fix'} maxLines={1} style={{ fontSize: 7.5, color: offline ? C.warn : C.dim, fontWeight: 'bold' }} />
    </FlexWidget>,
    <FlexWidget key="l" style={{ flex: 1, height: 'match_parent', marginLeft: 5 }}>
      <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
        {summary.leagues.map((l, i) => (
          <FlexWidget key={l.leagueId} {...open(l)}
            style={{ width: 'match_parent', flexDirection: 'column', backgroundColor: C.bg, borderRadius: 7, paddingHorizontal: 5, paddingVertical: 2, marginTop: i ? 3 : 0 }}>
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
              <TextWidget text={String(l.n)} maxLines={1} style={{ fontSize: 10, color: C.warn, fontWeight: 'bold', marginRight: 4 }} />
              <FlexWidget style={{ flex: 1 }}>
                <TextWidget text={l.name} truncate="END" maxLines={1} style={{ fontSize: 9, color: C.text, fontWeight: 'bold' }} />
              </FlexWidget>
            </FlexWidget>
            {l.lockMs != null ? <TextWidget text={`locks ${lockWhen(l.lockMs)}`} truncate="END" maxLines={1} style={{ fontSize: 7.5, color: C.dim }} /> : null}
          </FlexWidget>
        ))}
      </ListWidget>
    </FlexWidget>,
  ]);
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
  | ({ kind: 'ok'; week: number; games: FieldGame[]; offline?: boolean; stale?: boolean;
      /** A tap is being answered (v0.507.0): the header says so, the frame is inert. */ busy?: boolean;
      /** The game opened in place (v0.508.0), by key. */ openKey?: string | null } & Partial<FieldsNav>);

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
      <TextWidget text={`● ${g.poss}${g.dd ? ` · ${g.dd}` : ''} · ${g.spot ?? spotLabel(g.poss, opp, g.toGo)}`} maxLines={1} style={{ fontSize: 8.5, color: C.live, fontWeight: 'bold', marginRight: 6 }} />
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
        style={{ fontSize: 7.5, color: C.onAccent, backgroundColor: injColor(m.injury), fontWeight: 'bold', borderRadius: 3, paddingHorizontal: 2, marginRight: 3 }} /> : null}
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget text={m.name} truncate="END" maxLines={1} style={{ fontSize: 9, color: C.text, fontWeight: 'bold' }} />
      </FlexWidget>
      {num ? <TextWidget text={num} maxLines={1} style={{ fontSize: 9, color, fontWeight: 'bold' }} /> : null}
    </FlexWidget>
  );
}

const CAT_LABEL: Record<string, string> = { pass: 'PASS', rush: 'RUSH', rec: 'REC' };

/** An OPENED game (v0.508.0). Founder: "Is click to expand a thing in
 *  widgets? It would be cool to click a game and see the current player stats
 *  or last couple play details." A widget cannot animate, but a tap can
 *  redraw: the game's card grows the last three plays (newest first, the
 *  clock beside each), each side's passing / rushing / receiving leader in
 *  ESPN's own line, and a button for the app's full view. Tap the card again
 *  to close it. */
function OpenedGame({ g }: { g: FieldGame }) {
  const recent = g.recent ?? [];
  const byTeam = (t: string) => (g.leaders ?? []).filter((l) => l.team === t);
  const section = (t: string) => <TextWidget text={t} maxLines={1} style={{ fontSize: 7.5, color: C.faint, fontWeight: 'bold', letterSpacing: 0.12, marginTop: 6 }} />;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginTop: 4, borderTopWidth: 1, borderColor: C.line }}>
      {recent.length ? section('LAST PLAYS') : null}
      {recent.map((p, i) => (
        <FlexWidget key={`p${i}`} style={{ width: 'match_parent', flexDirection: 'row', marginTop: 2 }}>
          <TextWidget text={p.clock} maxLines={1} style={{ fontSize: 8, color: C.faint, fontWeight: 'bold', width: 52 }} />
          <FlexWidget style={{ flex: 1 }}>
            <TextWidget text={p.txt} truncate="END" maxLines={3} style={{ fontSize: 8.5, color: p.big === 'score' ? C.you : p.big === 'turnover' ? C.opp : C.text }} />
          </FlexWidget>
        </FlexWidget>
      ))}
      {(g.leaders ?? []).length ? section('LEADERS') : null}
      {/* flatMap, not map-in-map: the tree builder flattens exactly one level. */}
      {[g.away, g.home].flatMap((t) => byTeam(t).map((l) => (
        <FlexWidget key={`${t}-${l.cat}`} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <TextWidget text={`${t} ${CAT_LABEL[l.cat] ?? ''}`} maxLines={1} style={{ fontSize: 7.5, color: C.faint, fontWeight: 'bold', width: 52 }} />
          <TextWidget text={l.name} maxLines={1} style={{ fontSize: 8.5, color: C.text, fontWeight: 'bold', marginRight: 5 }} />
          <FlexWidget style={{ flex: 1 }}>
            <TextWidget text={l.line} truncate="END" maxLines={1} style={{ fontSize: 8.5, color: C.dim }} />
          </FlexWidget>
        </FlexWidget>
      )))}
      {!recent.length && !(g.leaders ?? []).length ? (
        <TextWidget text={g.state === 'pre' ? 'Not kicked off yet — plays and leaders land here once it does.' : 'No plays on the feed yet.'} maxLines={2}
          style={{ fontSize: 8.5, color: C.dim, marginTop: 5 }} />
      ) : null}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 }}>
        <TextWidget text="▴ tap to close" maxLines={1} style={{ fontSize: 8, color: C.faint }} />
        <TextWidget text="OPEN IN APP ↗" clickAction={WIDGET_CLICK.open} clickActionData={{ uri: FIELDS_DEEP_LINK }} maxLines={1}
          style={{ fontSize: 9, color: C.you, fontWeight: 'bold', backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 }} />
      </FlexWidget>
    </FlexWidget>
  );
}

function GameRow({ g, last, open }: { g: FieldGame; last: boolean; open: boolean }) {
  const live = g.state === 'live';
  const lead = (a: number, b: number) => g.state !== 'pre' && a > b;
  const clockText = g.state === 'pre' ? (g.kickoff != null ? lockWhen(g.kickoff) : 'TBD') : g.clock ?? '';
  const clockColor: ColorProp = live ? C.live : g.state === 'final' ? C.faint : C.dim;
  const mine = g.mine.slice(0, 4);
  const more = g.mine.length - mine.length;
  return (
    // A tap opens or closes the game in place (v0.508.0); the app is one
    // button away inside the opened card.
    <FlexWidget clickAction={FIELDS_CLICK.toggle} clickActionData={{ key: g.key }}
      style={{ width: 'match_parent', flexDirection: 'column', backgroundColor: C.bg, borderRadius: 10, padding: 7, marginBottom: last ? 0 : 5,
        borderWidth: 1, borderColor: open ? C.you : live ? C.live : C.line }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TeamSide team={g.away} score={g.as} lead={lead(g.as, g.hs)} align="left" showScore={g.state !== 'pre'} />
        <TextWidget text={`${clockText} ${open ? '▴' : '▾'}`} maxLines={1} style={{ fontSize: 9, color: clockColor, fontWeight: 'bold' }} />
        <TeamSide team={g.home} score={g.hs} lead={lead(g.hs, g.as)} align="right" showScore={g.state !== 'pre'} />
      </FlexWidget>
      {live && g.poss != null && g.toGo != null ? <FieldStrip g={g as FieldGame & { poss: string; toGo: number }} /> : null}
      {!open && g.last && g.state !== 'final' ? (
        <TextWidget text={g.last} truncate="END" maxLines={2}
          style={{ fontSize: 8.5, color: g.big === 'score' ? C.you : g.big === 'turnover' ? C.opp : C.dim, marginTop: 3 }} />
      ) : null}
      {mine.map((m, i) => <MineLine key={`${m.name}-${i}`} m={m} />)}
      {more > 0 ? <TextWidget text={`+${more} more of yours`} style={{ fontSize: 8, color: C.faint, marginTop: 1 }} /> : null}
      {open ? <OpenedGame g={g} /> : null}
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
  // Header buttons big enough to hit (v0.507.0), dimmed with … while a tap is answered.
  // THE HEADER, ONE ROW (v0.510.0). Founder: "Let's make the league select a
  // taller button on the top row. We don't need the '16 to come' text." Five
  // blocks of one height — ‹, the week (tap for NOW), ›, ★ whose players, ⟳ —
  // each big enough to hit (v0.507.0), dimmed while a tap is answered.
  const BTN = 38;
  const busy = state.kind === 'ok' && state.busy;
  // Widths sized so the week keeps ~55dp at the widget's 250dp minimum.
  const block = (children: React.ReactNode, action: string, width: number | null, dim?: boolean, first?: boolean) => (
    <FlexWidget clickAction={action}
      style={{ ...(width != null ? { width } : { flex: 1 }), height: BTN, flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        backgroundColor: dim ? C.line : C.bg, borderRadius: 10, marginLeft: first ? 0 : 4, paddingHorizontal: 3 }}>
      {children}
    </FlexWidget>
  );
  const glyph = (text: string, color: ColorProp, size = 16) => <TextWidget text={text} maxLines={1} style={{ fontSize: size, color, fontWeight: 'bold' }} />;
  const refresh = (offline?: boolean) => block(glyph(busy ? '…' : offline ? '⟳ !' : '⟳', busy ? C.dim : offline ? C.warn : C.you), WIDGET_CLICK.refresh, 36, !!busy);
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
  const isNow = state.current == null || state.current === week;
  const arrow = (text: string, action: string, can: boolean | undefined, first?: boolean) =>
    block(glyph(text, can === false || busy ? C.line : C.you, 18), action, 30, false, first);
  const head = (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
      {arrow('‹', FIELDS_CLICK.prev, state.hasPrev, true)}
      <FlexWidget clickAction={FIELDS_CLICK.now}
        style={{ flex: 1, height: BTN, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
        <TextWidget text={`▦ ${weekLabel(week).toUpperCase()}`} truncate="END" maxLines={1} style={{ fontSize: 11.5, color: C.text, fontWeight: 'bold' }} />
        <TextWidget text={busy ? 'LOADING…' : isNow ? 'NOW' : '↺ NOW'} truncate="END" maxLines={1} style={{ fontSize: 8, color: busy ? C.dim : isNow ? C.faint : C.you, fontWeight: 'bold' }} />
      </FlexWidget>
      {arrow('›', FIELDS_CLICK.next, state.hasNext)}
      {block([
        <TextWidget key="s" text="★" maxLines={1} style={{ fontSize: 11, color: busy ? C.dim : C.you, fontWeight: 'bold' }} />,
        <TextWidget key="l" text={state.leagueLabel ?? 'All leagues'} truncate="END" maxLines={1} style={{ fontSize: 8.5, color: busy ? C.dim : C.you, fontWeight: 'bold' }} />,
      ], FIELDS_CLICK.league, 64, !!busy)}
      {refresh(offline)}
    </FlexWidget>
  );
  return frame(head,
    <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
      {games.map((g, i) => <GameRow key={g.key} g={g} last={i === games.length - 1} open={state.openKey === g.key} />)}
    </ListWidget>,
  );
}
