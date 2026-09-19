// THE WIDGET'S TASK (v0.421.0, v0.422.0) — what repaints it, and when.
//
// Android repaints a widget through a HEADLESS JS task: no screen, no React
// tree, just this handler with the widget's id and why it woke. It wakes for
// four reasons, all of which end in the same repaint:
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
import { widgetSnapshot, nextWidgetLeague, type WidgetView } from '@drip/core/data/widgetFeed';
import { MatchupWidget, MATCHUP_WIDGET_NAME, WIDGET_CLICK, type WidgetState } from './MatchupWidget';

const PREF_LEAGUE = (widgetId: number) => `widget:league:${widgetId}`;
const PREF_VIEW = (widgetId: number) => `widget:view:${widgetId}`;

const readView = (widgetId: number): WidgetView | undefined => {
  try { const v = platform().storage.get(PREF_VIEW(widgetId)); return v === 'score' || v === 'lineup' ? v : undefined; } catch { return undefined; }
};

/** Build the picture for one widget, reading the world fresh. Never throws:
 *  a failed read draws the error card, because a widget that silently keeps
 *  yesterday's score is worse than one that says it couldn't look. */
export async function widgetState(widgetId: number, advance = false): Promise<WidgetState> {
  try {
    const session = await getSession();
    if (!session) return { kind: 'signed-out' };
    const store = platform().storage;
    const want = store.get(PREF_LEAGUE(widgetId));
    let { leagues, snapshot } = await widgetSnapshot(want, session.user.id);
    if (advance && leagues.length > 1) {
      const next = nextWidgetLeague(leagues, snapshot?.leagueId ?? want);
      if (next) {
        store.set(PREF_LEAGUE(widgetId), next.id);
        // A new league is a new question: forget the flip along with it.
        store.remove(PREF_VIEW(widgetId));
        ({ leagues, snapshot } = await widgetSnapshot(next.id, session.user.id));
      }
    }
    if (!snapshot) return { kind: 'no-leagues' };
    // Remember what we showed, so a stored league that vanished is replaced
    // by the one that took its place rather than re-resolved every time.
    if (snapshot.leagueId !== want) store.set(PREF_LEAGUE(widgetId), snapshot.leagueId);
    return { kind: 'ok', snap: snapshot, leagues: leagues.length };
  } catch (e) {
    return { kind: 'error', message: friendlyError(e) };
  }
}

const paint = async (info: WidgetInfo, advance = false) =>
  React.createElement(MatchupWidget, { state: await widgetState(info.widgetId, advance), heightDp: info.height, view: readView(info.widgetId) });

async function handler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, clickAction } = props;
  if (widgetInfo.widgetName !== MATCHUP_WIDGET_NAME) return;
  switch (widgetAction) {
    case 'WIDGET_DELETED':
      try { platform().storage.remove(PREF_LEAGUE(widgetInfo.widgetId)); platform().storage.remove(PREF_VIEW(widgetInfo.widgetId)); } catch { /* ignore */ }
      return;
    case 'WIDGET_CLICK': {
      // OPEN_URI is handled natively (it opens the app); only our own actions
      // reach here.
      if (clickAction === WIDGET_CLICK.flip) {
        // Flip relative to what is SHOWING: the stored flip if any, else the
        // feed's lead — so the first tap always changes the picture.
        const state = await widgetState(widgetInfo.widgetId);
        const showing = readView(widgetInfo.widgetId) ?? (state.kind === 'ok' ? state.snap.lead : 'score');
        const next: WidgetView = showing === 'score' ? 'lineup' : 'score';
        try { platform().storage.set(PREF_VIEW(widgetInfo.widgetId), next); } catch { /* ignore */ }
        props.renderWidget(React.createElement(MatchupWidget, { state, heightDp: widgetInfo.height, view: next }));
        return;
      }
      const advance = clickAction === WIDGET_CLICK.next;
      if (!advance && clickAction !== WIDGET_CLICK.refresh) return;
      props.renderWidget(await paint(widgetInfo, advance));
      return;
    }
    default:
      // WIDGET_ADDED, WIDGET_UPDATE (the timer), WIDGET_RESIZED
      props.renderWidget(await paint(widgetInfo));
  }
}

/** Repaint every Matchup widget on the home screen. Cheap when there are
 *  none (one native call), so callers need not check first. */
export async function refreshMatchupWidgets(): Promise<void> {
  try {
    await requestWidgetUpdate({ widgetName: MATCHUP_WIDGET_NAME, renderWidget: (info) => paint(info) });
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
