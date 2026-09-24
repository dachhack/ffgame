// A WIDGET PICTURE THAT IGNORES TAPS (v0.507.0).
//
// Founder: "It also can take a couple seconds to load the next team so can we
// make sure to change the state of the widget or the button so the user
// doesn't hit the button again? Also would be good if the widget and button
// were inactive while loading so double taps and errant clicks don't do
// anything. Same for the refresh button."
//
// A tap on a home-screen widget is a PendingIntent the launcher fires, and a
// view has one only if its element carried a `clickAction`. So a picture drawn
// with every clickAction stripped is inert: nothing on it answers until the
// next picture — the fresh one — is drawn with its taps back. The task draws
// its "loading" frames through this.
//
// It walks the tree the way the library's builder does (build-widget-tree.ts):
// a function component is called until the element is one of the library's
// widgets (they carry `__name__`), then its props are copied minus the click,
// and its children walked. The children keep their shape — arrays stay arrays
// — because the builder flattens exactly one level.
import React from 'react';
import { platform } from '@drip/core/platform';

type El = React.ReactElement<Record<string, unknown>> & { type: unknown };

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk);
  if (!node || typeof node !== 'object' || !('type' in (node as object))) return node;
  let el = node as El;
  // Resolve our own components down to the library's widgets.
  while (typeof el.type === 'function' && !(el.type as { __name__?: string }).__name__) {
    const next = (el.type as (p: unknown) => unknown)(el.props);
    if (!next || typeof next !== 'object') return next;
    el = next as El;
  }
  const { clickAction: _a, clickActionData: _d, children, ...rest } = el.props ?? {};
  return React.createElement(el.type as React.ElementType, { ...rest, key: el.key ?? undefined, children: walk(children) as React.ReactNode });
}

/** The same picture, with no tap on it doing anything. */
export function inert(el: React.JSX.Element): React.JSX.Element {
  return walk(el) as React.JSX.Element;
}

// ── THE TAP LOCK ────────────────────────────────────────────────────────────
// The inert frame stops taps once it is ON the screen, but the first frame
// after a tap takes a moment (the headless task has to wake), and a quick
// second tap lands before it. Each widget holds a lock while a tap is being
// answered; a tap that finds it held is dropped. The lock is a timestamp, and
// one older than LOCK_MS is ignored, so a task that died mid-read can never
// leave a widget deaf.
const LOCK_MS = 20_000;
const LOCK = (widgetId: number) => `widget:busy:${widgetId}`;
/** Take the widget's lock, or false when a tap is already being answered. */
export function takeTapLock(widgetId: number, nowMs: number = Date.now()): boolean {
  try {
    const held = Number(platform().storage.get(LOCK(widgetId)));
    if (Number.isFinite(held) && held > 0 && nowMs - held < LOCK_MS) return false;
    platform().storage.set(LOCK(widgetId), String(nowMs));
  } catch { /* no storage: never block a tap */ }
  return true;
}
export function releaseTapLock(widgetId: number): void {
  try { platform().storage.remove(LOCK(widgetId)); } catch { /* best-effort */ }
}
