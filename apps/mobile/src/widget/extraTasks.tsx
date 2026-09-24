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
import { alertsSummary, fieldGames, minesByTeam, loadFieldsWeek } from '@drip/core/data/widgetExtras';
import { AlertsWidget, FieldsWidget, ALERTS_WIDGET_NAME, FIELDS_WIDGET_NAME, FIELDS_CLICK, type AlertsState, type FieldsState } from './ExtraWidgets';
import { platform } from '@drip/core/platform';
import { inert, takeTapLock, releaseTapLock } from './inert';
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
// Two per-widget choices (v0.506.0), in the app's storage like the matchup
// widget's league: how many weeks off NOW it is looking (‹ ›, relative, so a
// widget left on "now" follows the Wednesday turnover), and whose players it
// stars (a league id, or nothing for every league).
const PREF_OFFSET = (id: number) => `widget:fields:offset:${id}`;
const PREF_STAR = (id: number) => `widget:fields:league:${id}`;
/** The game opened in place (v0.508.0), by key. */
const PREF_OPEN = (id: number) => `widget:fields:open:${id}`;
const readNum = (k: string) => { try { const v = Number(platform().storage.get(k)); return Number.isFinite(v) ? v : 0; } catch { return 0; } };
const readStr = (k: string) => { try { return platform().storage.get(k) || null; } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v == null) platform().storage.remove(k); else platform().storage.set(k, v); } catch { /* best-effort */ } };

/** Whose players are starred, as the chip says it; a picked league that has
 *  since been hidden or left reads as every league. */
function starOf(widgetId: number): { id: string | null; label: string } {
  const want = readStr(PREF_STAR(widgetId));
  const l = want ? (recallLeagues() ?? []).find((x) => x.id === want) : null;
  return l ? { id: l.id, label: l.name } : { id: null, label: 'All leagues' };
}

const FIELDS_KEY = (id: number) => `fields:${id}`;
type FieldsOk = Extract<FieldsState, { kind: 'ok' }>;
function rememberedFields(widgetId: number): FieldsOk | null {
  const r = cacheGet<Omit<FieldsOk, 'kind'>>(FIELDS_KEY(widgetId), 12 * HOUR);
  return r ? { ...r, kind: 'ok', stale: true, leagueLabel: starOf(widgetId).label, openKey: readStr(PREF_OPEN(widgetId)) } : null;
}

async function fieldsState(widgetId: number): Promise<FieldsState> {
  try {
    const at = await loadFieldsWeek(readNum(PREF_OFFSET(widgetId)));
    if (!at) return { kind: 'empty' };
    const star = starOf(widgetId);
    const mine = minesByTeam(rememberedSnaps()?.snaps ?? [], { week: at.week, leagueId: star.id });
    const games = fieldGames(at.week, mine);
    const ok: FieldsOk = { kind: 'ok', week: at.week, games, current: at.current, hasPrev: at.hasPrev, hasNext: at.hasNext, leagueLabel: star.label, openKey: readStr(PREF_OPEN(widgetId)) };
    const { kind: _k, openKey: _o, ...keep } = ok;
    cacheSet(FIELDS_KEY(widgetId), keep);
    return ok;
  } catch (e) {
    return { kind: 'error', message: friendlyError(e) };
  }
}

// ── the task ────────────────────────────────────────────────────────────────

export const isExtraWidget = (name: string) => name === ALERTS_WIDGET_NAME || name === FIELDS_WIDGET_NAME;

async function paint(name: string, widgetId: number, render: (el: React.JSX.Element) => void, opts: { fresh?: boolean; tapped?: boolean }) {
  if (name === ALERTS_WIDGET_NAME) {
    const now = rememberedAlerts();
    // A tap is answered visibly and inertly (v0.507.0).
    if (now) render(opts.tapped && now.kind === 'ok' ? inert(<AlertsWidget state={{ ...now, busy: true }} />) : <AlertsWidget state={now} />);
    try {
      render(<AlertsWidget state={await alertsState(!!opts.fresh)} />);
    } catch {
      if (now && now.kind === 'ok') render(<AlertsWidget state={{ ...now, offline: true }} />);
    }
    return;
  }
  const now = rememberedFields(widgetId);
  if (now) render(opts.tapped ? inert(<FieldsWidget state={{ ...now, busy: true }} />) : <FieldsWidget state={now} />);
  else if (opts.tapped) render(inert(<FieldsWidget state={{ kind: 'loading' }} />));
  const fresh = await fieldsState(widgetId);
  if (fresh.kind === 'error' && now) { render(<FieldsWidget state={{ ...now, offline: true }} />); return; }
  render(<FieldsWidget state={fresh} />);
}

/** The task handler for these two (widgetTask.ts hands them over). */
export async function extraHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, clickAction, clickActionData } = props;
  const render = (el: React.JSX.Element) => props.renderWidget(el);
  const id = widgetInfo.widgetId;
  if (widgetAction === 'WIDGET_DELETED') { write(PREF_OFFSET(id), null); write(PREF_STAR(id), null); write(PREF_OPEN(id), null); return; }
  if (widgetAction === 'WIDGET_CLICK') {
    // OPEN_URI / OPEN_APP are native; ⟳ (and the ✓ card) and the fields chips
    // are ours — one at a time (v0.507.0): a tap while another is answered is
    // dropped, and the frames in between are inert.
    const ours = clickAction === WIDGET_CLICK.refresh || Object.values(FIELDS_CLICK).includes(clickAction as never);
    if (!ours || !takeTapLock(id)) return;
    try { await answer(clickAction as string); } finally { releaseTapLock(id); }
    return;
  }
  await paint(widgetInfo.widgetName, id, render, {});

  async function answer(clickAction: string): Promise<void> {
    if (clickAction === FIELDS_CLICK.toggle) {
      // Open or close a game in place (v0.508.0): a redraw of the remembered
      // week with that card grown or shrunk — no read, so it is instant. The
      // next timer or push repaints it with fresh plays, still open.
      const key = typeof clickActionData?.key === 'string' ? clickActionData.key : null;
      if (!key) return;
      write(PREF_OPEN(id), readStr(PREF_OPEN(id)) === key ? null : key);
      const had = rememberedFields(id);
      if (had) render(<FieldsWidget state={{ ...had, stale: false }} />);
      else await paint(widgetInfo.widgetName, id, render, {});
      return;
    }
    if (clickAction === WIDGET_CLICK.refresh) { await paint(widgetInfo.widgetName, id, render, { fresh: true, tapped: true }); return; }
    if (clickAction === FIELDS_CLICK.prev || clickAction === FIELDS_CLICK.next || clickAction === FIELDS_CLICK.now) {
      // The remembered picture knows whether the slate ends here; an arrow at
      // the end is a no-op rather than a read that lands on the same week.
      const had = rememberedFields(id);
      if (clickAction === FIELDS_CLICK.prev && had?.hasPrev === false) return;
      if (clickAction === FIELDS_CLICK.next && had?.hasNext === false) return;
      const off = clickAction === FIELDS_CLICK.now ? 0 : readNum(PREF_OFFSET(id)) + (clickAction === FIELDS_CLICK.prev ? -1 : 1);
      write(PREF_OFFSET(id), off ? String(off) : null);
      // `tapped`: the remembered frame goes up busy and inert, never live.
      await paint(widgetInfo.widgetName, id, render, { tapped: true });
      return;
    }
    if (clickAction === FIELDS_CLICK.league) {
      // All leagues → each shown league in turn → back to all. The chip
      // changes on the instant frame; the stars follow with the fresh read.
      const leagues = recallLeagues() ?? [];
      const cur = starOf(id).id;
      const at = cur ? leagues.findIndex((l) => l.id === cur) : -1;
      const nextId = at + 1 < leagues.length ? leagues[at + 1].id : null;
      write(PREF_STAR(id), nextId);
      await paint(widgetInfo.widgetName, id, render, { tapped: true });
    }
  }
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
      renderWidget: async (info) => {
        const fresh = await fieldsState(info.widgetId);
        const now = rememberedFields(info.widgetId);
        return <FieldsWidget state={fresh.kind === 'error' && now ? { ...now, offline: true } : fresh} />;
      },
    });
  } catch { /* no widget host */ }
}
