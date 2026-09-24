// THE ALERTS AND FIELDS WIDGETS (v0.505.0) — what repaints them.
//
// Same headless task as the matchup widget (widgetTask.ts routes here by the
// widget's name), same rule: PAINT FIRST, FETCH SECOND. Every wake draws the
// last remembered picture at once, then reads, then draws again; a read that
// fails keeps the picture and marks it offline rather than replacing a real
// number with an apology.
//
//   ALERTS reads every league the widget may show (Settings' picker) through
//     the matchup widget's own feed — so its numbers are the ones the matchup
//     card shows — and remembers each league's snapshot as that feed does.
//   FIELDS reads the week's slate and game feeds (the All fields sheet's
//     read), and marks MY players from those remembered snapshots, which
//     costs nothing more.
import React from 'react';
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { getSession, friendlyError } from '@drip/core/data/liveApi';
import { widgetSnapshot, recallSnapshot, recallLeagues, allWidgetLeagues, shownWidgetLeagues, cacheGet, cacheSet, type WidgetSnapshot } from '@drip/core/data/widgetFeed';
import { alertsSummary, fieldGames, minesByTeam, loadFieldsWeek, type FieldGame } from '@drip/core/data/widgetExtras';
import { AlertsWidget, FieldsWidget, ALERTS_WIDGET_NAME, FIELDS_WIDGET_NAME, type AlertsState, type FieldsState } from './ExtraWidgets';
import { WIDGET_CLICK } from './MatchupWidget';

const HOUR = 3_600_000;
const BUDGET_MS = 18_000;

/** The shown leagues' remembered snapshots — no network. */
function rememberedSnaps(): { leagues: number; snaps: WidgetSnapshot[] } | null {
  const leagues = recallLeagues();
  if (!leagues?.length) return null;
  const snaps = leagues.map((l) => recallSnapshot(l.id)?.snapshot).filter((s): s is WidgetSnapshot => !!s);
  return { leagues: leagues.length, snaps };
}

// ── ALERTS ──────────────────────────────────────────────────────────────────

function rememberedAlerts(): AlertsState | null {
  const r = rememberedSnaps();
  return r && r.snaps.length ? { kind: 'ok', summary: alertsSummary(r.snaps), leagues: r.leagues, stale: true } : null;
}

async function alertsState(fresh: boolean): Promise<AlertsState> {
  const session = await getSession();
  if (!session) return { kind: 'signed-out' };
  const leagues = shownWidgetLeagues(await allWidgetLeagues(fresh));
  if (!leagues.length) return { kind: 'no-leagues' };
  const snaps: WidgetSnapshot[] = [];
  let offline = false;
  // One league at a time: each read is several queries, a phone waking a
  // headless task is no place for a burst of them, and a classic read installs
  // its league's scoring rules module-wide while it runs (widgetSnapshot), so
  // two at once could score one league by the other's rules. The library gives
  // the task 30 s (RNWidgetBackgroundTaskWorker); past BUDGET_MS the leagues
  // not yet read are counted off their remembered pictures instead.
  const until = Date.now() + BUDGET_MS;
  for (const l of leagues) {
    if (Date.now() > until) {
      const r = recallSnapshot(l.id);
      if (r) snaps.push(r.snapshot);
      continue;
    }
    try {
      const { snapshot } = await widgetSnapshot(l.id, session.user.id, fresh);
      if (snapshot) snaps.push(snapshot);
    } catch {
      offline = true;
      const r = recallSnapshot(l.id);
      if (r) snaps.push(r.snapshot);
    }
  }
  return { kind: 'ok', summary: alertsSummary(snaps), leagues: leagues.length, offline };
}

// ── FIELDS ──────────────────────────────────────────────────────────────────

const FIELDS_KEY = 'fields';
function rememberedFields(): Extract<FieldsState, { kind: 'ok' }> | null {
  const r = cacheGet<{ week: number; games: FieldGame[] }>(FIELDS_KEY, 12 * HOUR);
  return r ? { kind: 'ok', week: r.week, games: r.games, stale: true } : null;
}

async function fieldsState(): Promise<FieldsState> {
  try {
    const week = await loadFieldsWeek();
    if (week == null) return { kind: 'empty' };
    const mine = minesByTeam(rememberedSnaps()?.snaps ?? []);
    const games = fieldGames(week, mine);
    cacheSet(FIELDS_KEY, { week, games });
    return { kind: 'ok', week, games };
  } catch (e) {
    return { kind: 'error', message: friendlyError(e) };
  }
}

// ── the task ────────────────────────────────────────────────────────────────

export const isExtraWidget = (name: string) => name === ALERTS_WIDGET_NAME || name === FIELDS_WIDGET_NAME;

async function paint(name: string, render: (el: React.JSX.Element) => void, opts: { fresh?: boolean; tapped?: boolean }) {
  if (name === ALERTS_WIDGET_NAME) {
    const now = rememberedAlerts();
    if (now) render(<AlertsWidget state={now} />);
    try {
      render(<AlertsWidget state={await alertsState(!!opts.fresh)} />);
    } catch {
      if (now && now.kind === 'ok') render(<AlertsWidget state={{ ...now, offline: true }} />);
    }
    return;
  }
  const now = rememberedFields();
  if (now) render(<FieldsWidget state={now} />);
  else if (opts.tapped) render(<FieldsWidget state={{ kind: 'loading' }} />);
  const fresh = await fieldsState();
  if (fresh.kind === 'error' && now) { render(<FieldsWidget state={{ ...now, offline: true }} />); return; }
  render(<FieldsWidget state={fresh} />);
}

/** The task handler for these two (widgetTask.ts hands them over). */
export async function extraHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, clickAction } = props;
  const render = (el: React.JSX.Element) => props.renderWidget(el);
  if (widgetAction === 'WIDGET_DELETED') return;
  if (widgetAction === 'WIDGET_CLICK') {
    // OPEN_URI / OPEN_APP are native; ⟳ (and the ✓ card) are ours.
    if (clickAction === WIDGET_CLICK.refresh) await paint(widgetInfo.widgetName, render, { fresh: true, tapped: true });
    return;
  }
  await paint(widgetInfo.widgetName, render, {});
}

/** Repaint every alerts and fields widget on the home screen (the push and
 *  the app's foreground call this after the matchup widgets, whose reads
 *  leave the snapshots these draw from). Cheap when there are none. */
export async function refreshExtraWidgets(opts: { fresh?: boolean } = {}): Promise<void> {
  try {
    await requestWidgetUpdate({
      widgetName: ALERTS_WIDGET_NAME,
      renderWidget: async () => {
        try { return <AlertsWidget state={await alertsState(!!opts.fresh)} />; } catch {
          const now = rememberedAlerts();
          return <AlertsWidget state={now && now.kind === 'ok' ? { ...now, offline: true } : { kind: 'no-leagues' }} />;
        }
      },
    });
  } catch { /* no widget host */ }
  try {
    await requestWidgetUpdate({
      widgetName: FIELDS_WIDGET_NAME,
      renderWidget: async () => {
        const fresh = await fieldsState();
        const now = rememberedFields();
        return <FieldsWidget state={fresh.kind === 'error' && now ? { ...now, offline: true } : fresh} />;
      },
    });
  } catch { /* no widget host */ }
}
