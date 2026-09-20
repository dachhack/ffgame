// THE WIDGET'S TASK (v0.421.0, v0.422.0, v0.422.1) — what repaints it, and when.
//
// Android repaints a widget through a HEADLESS JS task: no screen, no React
// tree, just this handler with the widget's id and why it woke. It wakes for
// four reasons, all of which end in a repaint:
//   • Android's own timer (updatePeriodMillis in app.json; 30 min is the
//     floor Android allows),
//   • a tap on the card's chips (WIDGET_CLICK: next league, refresh, flip),
//   • the app coming to the foreground or a board saving (App.tsx calls
//     refreshMatchupWidgets),
//   • the worker's SILENT push (kind 'widget'), which expo-notifications hands
//     to the background task registered below even when the app is killed.
//     That push carries no score — it only says "repaint" — so the widget can
//     never draw a number older than the read it makes right now.
//
// PAINT FIRST, FETCH SECOND (v0.422.1). Founder: "There's a lot of lag when
// you press the buttons. Almost unusable." A tap used to wake a cold task
// that made nine reads before it drew a pixel. Now every wake draws the last
// remembered picture at once — a flip needs nothing else and never fetches;
// a ▸ draws the next league's remembered picture, or a "switching" card —
// and only then reads, and draws again if anything changed. The cold start
// of the JS context itself is Android's and stays; what we control is that
// nothing waits on the network to show a frame.
//
// Two per-widget preferences live in the app's own storage (MMKV through
// core's platform seam), keyed by the widget id Android gives it: which
// league it shows, and whether the manager flipped it to the score or the
// lineup view. Unflipped, the feed decides which view leads.
import React from 'react';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { registerWidgetTaskHandler, requestWidgetUpdate, type WidgetTaskHandlerProps, type WidgetInfo } from 'react-native-android-widget';
import { platform } from '@drip/core/platform';
import { getSession, friendlyError } from '@drip/core/data/liveApi';
import { widgetSnapshot, nextWidgetLeague, recallSnapshot, recallLeagues, type WidgetView } from '@drip/core/data/widgetFeed';
import { MatchupWidget, MATCHUP_WIDGET_NAME, WIDGET_CLICK, type WidgetState } from './MatchupWidget';

const PREF_LEAGUE = (widgetId: number) => `widget:league:${widgetId}`;
const PREF_VIEW = (widgetId: number) => `widget:view:${widgetId}`;

const store = () => platform().storage;
const readView = (widgetId: number): WidgetView | undefined => {
  try { const v = store().get(PREF_VIEW(widgetId)); return v === 'score' || v === 'lineup' ? v : undefined; } catch { return undefined; }
};
const readLeague = (widgetId: number): string | null => { try { return store().get(PREF_LEAGUE(widgetId)); } catch { return null; } };

/** The remembered picture for what this widget shows, if there is one. The
 *  instant frame: no session check, no network. */
function rememberedState(widgetId: number): Extract<WidgetState, { kind: 'ok' }> | null {
  const leagues = recallLeagues();
  const want = readLeague(widgetId) ?? leagues?.[0]?.id ?? null;
  if (!want) return null;
  const r = recallSnapshot(want);
  return r ? { kind: 'ok', snap: r.snapshot, leagues: r.leagues.length, stale: true } : null;
}

/** Build the picture for one widget, reading the world. Never throws: a
 *  failed read draws the error card, because a widget that silently keeps
 *  yesterday's score is worse than one that says it couldn't look. */
export async function widgetState(widgetId: number, opts: { fresh?: boolean } = {}): Promise<WidgetState> {
  try {
    const session = await getSession();
    if (!session) return { kind: 'signed-out' };
    const want = readLeague(widgetId);
    const { leagues, snapshot } = await widgetSnapshot(want, session.user.id, opts.fresh);
    if (!snapshot) return { kind: 'no-leagues' };
    // Remember what we showed, so a stored league that vanished is replaced
    // by the one that took its place rather than re-resolved every time.
    if (snapshot.leagueId !== want) { try { store().set(PREF_LEAGUE(widgetId), snapshot.leagueId); } catch { /* ignore */ } }
    return { kind: 'ok', snap: snapshot, leagues: leagues.length };
  } catch (e) {
    return { kind: 'error', message: friendlyError(e) };
  }
}

const el = (state: WidgetState, info: WidgetInfo, view?: WidgetView) =>
  React.createElement(MatchupWidget, { state, heightDp: info.height, view: view ?? readView(info.widgetId) });

/** The standard wake: the remembered frame now, the fresh one when it lands.
 *
 *  A READ THAT FAILS (v0.433.1). Founder, on a home screen that said
 *  "Couldn't reach the league" more often than not: "If it's not connected,
 *  can we just have a press to reconnect." With a remembered picture, the
 *  picture stays and is marked `offline`, so the ⟳ chip says so and is the
 *  retry. Without one, the error card is drawn — and that card is itself
 *  the retry (a tap anywhere on it is a REFRESH click), with a
 *  "Reconnecting…" frame painted the instant it is tapped so the press is
 *  seen before the read returns. */
async function paintThenFetch(info: WidgetInfo, render: (s: WidgetState) => void, opts: { fresh?: boolean; tapped?: boolean } = {}) {
  const now = rememberedState(info.widgetId);
  if (now) render(now);
  else if (opts.tapped) render({ kind: 'loading', title: 'Reconnecting…', body: 'Reading the matchup.' });
  const fresh = await widgetState(info.widgetId, opts);
  // An error after a good remembered frame would replace a real score with
  // an apology; keep the picture, say the read failed, and let the chip (or
  // the next wake) try again.
  if (fresh.kind === 'error' && now) { render({ ...now, offline: true }); return; }
  render(fresh);
}

async function handler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, clickAction } = props;
  if (widgetInfo.widgetName !== MATCHUP_WIDGET_NAME) return;
  const render = (s: WidgetState, view?: WidgetView) => props.renderWidget(el(s, widgetInfo, view));
  switch (widgetAction) {
    case 'WIDGET_DELETED':
      try { store().remove(PREF_LEAGUE(widgetInfo.widgetId)); store().remove(PREF_VIEW(widgetInfo.widgetId)); } catch { /* ignore */ }
      return;
    case 'WIDGET_CLICK': {
      // OPEN_URI is handled natively (it opens the app); only our own actions
      // reach here.
      if (clickAction === WIDGET_CLICK.flip) {
        // A flip is a redraw of what we already have. Relative to what is
        // SHOWING — the stored flip if any, else the feed's lead — so the
        // first tap always changes the picture. No network.
        const now = rememberedState(widgetInfo.widgetId);
        const showing = readView(widgetInfo.widgetId) ?? (now?.kind === 'ok' ? now.snap.lead : 'score');
        const next: WidgetView = showing === 'score' ? 'lineup' : 'score';
        try { store().set(PREF_VIEW(widgetInfo.widgetId), next); } catch { /* ignore */ }
        if (now && now.kind === 'ok') { render({ ...now, stale: false }, next); return; }
        render(await widgetState(widgetInfo.widgetId), next);
        return;
      }
      if (clickAction === WIDGET_CLICK.next) {
        // ▸: pick the next league off the remembered list, point the widget
        // at it, and draw its remembered picture at once (or say we're
        // switching); the fresh read follows.
        const leagues = recallLeagues() ?? [];
        const current = readLeague(widgetInfo.widgetId);
        const next = nextWidgetLeague(leagues, current);
        if (next) {
          try { store().set(PREF_LEAGUE(widgetInfo.widgetId), next.id); store().remove(PREF_VIEW(widgetInfo.widgetId)); } catch { /* ignore */ }
          const r = recallSnapshot(next.id);
          render(r ? { kind: 'ok', snap: r.snapshot, leagues: leagues.length, stale: true } : { kind: 'loading', title: `Switching to ${next.name}…`, body: 'Reading the matchup.' });
        }
        render(await widgetState(widgetInfo.widgetId));
        return;
      }
      if (clickAction === WIDGET_CLICK.refresh) { await paintThenFetch(widgetInfo, render, { tapped: true }); return; }
      return;
    }
    default:
      // WIDGET_ADDED, WIDGET_UPDATE (the timer), WIDGET_RESIZED
      await paintThenFetch(widgetInfo, render);
  }
}

/** Repaint every Matchup widget on the home screen. Cheap when there are
 *  none (one native call), so callers need not check first. `fresh` skips
 *  the caches — the app in the foreground knows things first. */
export async function refreshMatchupWidgets(opts: { fresh?: boolean } = {}): Promise<void> {
  try {
    await requestWidgetUpdate({
      widgetName: MATCHUP_WIDGET_NAME,
      renderWidget: async (info) => {
        // THIS WAS WHERE THE APOLOGY CAME FROM (v0.433.1). The silent push
        // and the app's foreground both repaint through here, and until now
        // this path drew whatever the read returned — so a push that landed
        // while the radio was asleep, or a foreground on a dead signal,
        // replaced a good remembered score with "Couldn't reach the league",
        // where it then sat until the next wake. The same rule as the task's
        // own wakes now: a failed read keeps the remembered picture, marked
        // offline, and the error card is drawn only when there is nothing
        // better to show.
        const fresh = await widgetState(info.widgetId, opts);
        if (fresh.kind === 'error') {
          const now = rememberedState(info.widgetId);
          if (now) return el({ ...now, offline: true }, info);
        }
        return el(fresh, info);
      },
    });
  } catch { /* no widget host, or a build without the module — nothing to repaint */ }
}

// ── the silent push ─────────────────────────────────────────────────────────
// The worker enqueues kind 'widget' while a matchup's state is being written
// (see server/src/push.js detectWidget): a data-only FCM message, no
// notification, so nothing appears in the shade. expo-notifications routes a
// data-only message to this task in the background. We repaint on ANY message
// that reaches the task rather than parsing the payload shape, which has
// changed across SDKs: a spare repaint costs one read.
const PUSH_TASK = 'drip-widget-push';

TaskManager.defineTask(PUSH_TASK, async () => { await refreshMatchupWidgets(); });

/** Wire both halves. Called once from index.ts, after the platform adapter is
 *  installed (storage) and before the root component registers (HeadlessJS
 *  needs the task handler in place when the bundle loads). */
export function registerMatchupWidget(): void {
  registerWidgetTaskHandler(handler);
  Notifications.registerTaskAsync(PUSH_TASK).catch(() => { /* Expo Go / a build without notifications */ });
}
