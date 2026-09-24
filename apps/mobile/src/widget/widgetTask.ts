// THE WIDGET'S TASK (v0.421.0, v0.422.0, v0.422.1) — what repaints it, and when.
//
// Android repaints a widget through a HEADLESS JS task: no screen, no React
// tree, just this handler with the widget's id and why it woke. It wakes for
// four reasons, all of which end in a repaint:
//   • Android's own timer (updatePeriodMillis in app.json; 30 min is the
//     floor Android allows),
//   • a tap on the card's chips (WIDGET_CLICK: next league, refresh),
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
// remembered picture at once — a ▸ draws the next league's remembered
// picture, or a "switching" card —
// and only then reads, and draws again if anything changed. The cold start
// of the JS context itself is Android's and stays; what we control is that
// nothing waits on the network to show a frame.
//
// One per-widget preference lives in the app's own storage (MMKV through
// core's platform seam), keyed by the widget id Android gives it: which
// league it shows. (The ⇄ score/lineup flip went with v0.500.0's drip card.)
import React from 'react';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { registerWidgetTaskHandler, requestWidgetUpdate, type WidgetTaskHandlerProps, type WidgetInfo } from 'react-native-android-widget';
import { platform } from '@drip/core/platform';
import { getSession, friendlyError } from '@drip/core/data/liveApi';
import { widgetSnapshot, nextWidgetLeague, recallSnapshot, recallLeagues } from '@drip/core/data/widgetFeed';
import { MatchupWidget, MATCHUP_WIDGET_NAME, syncWidgetTheme, WIDGET_CLICK, type WidgetState } from './MatchupWidget';
import { extraHandler, isExtraWidget, refreshExtraWidgets } from './extraTasks';
import { inert, takeTapLock, releaseTapLock } from './inert';

const PREF_LEAGUE = (widgetId: number) => `widget:league:${widgetId}`;
/** The retired ⇄ flip's stored choice (v0.422.0–v0.499): read no more, only
 *  cleared when its widget goes. */
const PREF_VIEW = (widgetId: number) => `widget:view:${widgetId}`;

const store = () => platform().storage;
const readLeague = (widgetId: number): string | null => { try { return store().get(PREF_LEAGUE(widgetId)); } catch { return null; } };

/** The remembered picture for what this widget shows, if there is one. The
 *  instant frame: no session check, no network. */
function rememberedState(widgetId: number): Extract<WidgetState, { kind: 'ok' }> | null {
  const leagues = recallLeagues();
  // A stored league the manager has since hidden in Settings is not drawn,
  // not even for the instant frame (v0.503.0).
  const stored = readLeague(widgetId);
  const want = (stored && (!leagues || leagues.some((l) => l.id === stored)) ? stored : null) ?? leagues?.[0]?.id ?? null;
  if (!want) return null;
  const r = recallSnapshot(want);
  // The league COUNT is today's (hiding one drops ▸ NEXT at two), not the
  // count remembered with the picture.
  return r ? { kind: 'ok', snap: r.snapshot, leagues: (leagues ?? r.leagues).length, stale: true } : null;
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

/** A frame drawn while a tap is answered (a `busy` picture, or the loading
 *  notice) is drawn INERT (v0.507.0) — no tap on it does anything until the
 *  fresh picture replaces it. */
const el = (state: WidgetState, info: WidgetInfo) => {
  const pic = React.createElement(MatchupWidget, { state, heightDp: info.height, widthDp: info.width });
  return (state.kind === 'ok' && state.busy) || state.kind === 'loading' ? inert(pic) : pic;
};

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
  // A tap is answered visibly: the picture with ⟳ reading LOADING, inert.
  if (now) render(opts.tapped ? { ...now, busy: 'refresh' } : now);
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
  // Every paint wears the app's current colour theme (v0.513.0).
  syncWidgetTheme();
  // The alerts and fields widgets (v0.505.0) have their own painter.
  if (isExtraWidget(widgetInfo.widgetName)) { await extraHandler(props); return; }
  if (widgetInfo.widgetName !== MATCHUP_WIDGET_NAME) return;
  const render = (s: WidgetState) => props.renderWidget(el(s, widgetInfo));
  switch (widgetAction) {
    case 'WIDGET_DELETED':
      try { store().remove(PREF_LEAGUE(widgetInfo.widgetId)); store().remove(PREF_VIEW(widgetInfo.widgetId)); } catch { /* ignore */ }
      return;
    case 'WIDGET_CLICK': {
      // OPEN_URI is handled natively (it opens the app); only our own actions
      // reach here.
      // ONE TAP AT A TIME (v0.507.0): a tap that lands while another is being
      // answered is dropped (the lock), and the frames drawn meanwhile are
      // inert (el), so a double tap is one tap.
      const ours = clickAction === WIDGET_CLICK.next || clickAction === WIDGET_CLICK.refresh;
      if (!ours) return;
      if (!takeTapLock(widgetInfo.widgetId)) return;
      try {
        if (clickAction === WIDGET_CLICK.next) {
          // ▸: pick the next league off the remembered list, point the widget
          // at it, and draw its remembered picture at once (or say we're
          // switching); the fresh read follows.
          const leagues = recallLeagues() ?? [];
          const current = readLeague(widgetInfo.widgetId);
          const next = nextWidgetLeague(leagues, current);
          if (next) {
            try { store().set(PREF_LEAGUE(widgetInfo.widgetId), next.id); } catch { /* ignore */ }
            const r = recallSnapshot(next.id);
            render(r ? { kind: 'ok', snap: r.snapshot, leagues: leagues.length, stale: true, busy: 'next' } : { kind: 'loading', title: `Switching to ${next.name}…`, body: 'Reading the matchup.' });
          }
          render(await widgetState(widgetInfo.widgetId));
          return;
        }
        await paintThenFetch(widgetInfo, render, { tapped: true });
        return;
      } finally { releaseTapLock(widgetInfo.widgetId); }
    }
    default:
      // WIDGET_ADDED, WIDGET_UPDATE (the timer), WIDGET_RESIZED
      await paintThenFetch(widgetInfo, render);
  }
}

/** Repaint every Drip widget on the home screen — matchup, then alerts and
 *  fields (v0.505.0). Cheap when there are none (one native call each), so
 *  callers need not check first. `fresh` skips
 *  the caches — the app in the foreground knows things first. */
export async function refreshMatchupWidgets(opts: { fresh?: boolean } = {}): Promise<void> {
  syncWidgetTheme();
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
  // Then the alerts and fields widgets (v0.505.0): after, because the reads
  // above leave the league snapshots they count and mark players from.
  await refreshExtraWidgets(opts);
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
