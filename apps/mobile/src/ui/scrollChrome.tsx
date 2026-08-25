// The LinkedIn pattern (v0.356.0, founder: "their menu at the bottom ...
// hides down when you scroll the page down but comes back up again when you
// scroll up. The top folds up too"): the app chrome — the header above a
// league screen and the room bar below it — gets out of the way while you
// read DOWN a page, and comes home the moment you pull UP, wherever you are.
//
// The driver tracks scroll DELTAS, not absolute position, so entering a
// screen mid-scroll or hopping between tabs never strands the chrome.
//
// v0.356.1 (founder: "it's kinda twitchy"): the chrome is TWO STATES with
// hysteresis, not a 1:1 shadow of the finger. The first cut moved the fold
// with every scroll frame — micro-jitters in a touch wiggled it, and since
// the header fold is a LAYOUT change (the viewport grows as it folds),
// per-frame updates fed the scroll position back into itself. Now travel
// ACCUMULATES per direction (a reversal resets the count): ~HIDE_PX down
// triggers one smooth hide, ~SHOW_PX up one smooth show, and nothing at all
// happens in between.
//
// Screens opt in by spreading useLeagueScroll() onto their MAIN ScrollView:
//   <ScrollView {...useLeagueScroll()} ...>
// A screen that never scrolls (or never spreads) simply keeps the chrome —
// outside a league the context is absent and the spread is empty.
import { createContext, useContext, useRef } from 'react';
import { Animated } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** Accumulated downward travel that folds the chrome away. */
const HIDE_PX = 28;
/** Accumulated upward travel that brings it home — smaller, so the return
 *  feels eager (the LinkedIn half the founder liked most). */
const SHOW_PX = 12;
/** Below this offset the chrome is always home — the page top owns it. */
const HOME_PX = 40;
/** A jump larger than this is a tab switch or programmatic scroll, not a
 *  finger — ignore it rather than slamming the chrome. */
const JUMP_PX = 240;

export interface ScrollChromeHandlers {
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollEndDrag: () => void;
  onMomentumScrollEnd: () => void;
  scrollEventThrottle: number;
}

export const ScrollChromeCtx = createContext<ScrollChromeHandlers | null>(null);

/** The handlers a league screen spreads onto its main ScrollView. Empty when
 *  no chrome driver is mounted above (e.g. web preview, tests). */
export function useLeagueScroll(): Partial<ScrollChromeHandlers> {
  return useContext(ScrollChromeCtx) ?? {};
}

/** Mounted ONCE by the app shell. `shift` runs 0 (chrome home) → 1 (folded);
 *  interpolate it into translateY/opacity on the header and the bottom bar. */
export function useScrollChromeDriver(): {
  shift: Animated.Value;
  handlers: ScrollChromeHandlers;
  reset: () => void;
} {
  const shift = useRef(new Animated.Value(0)).current;
  const st = useRef({ hidden: false, lastY: 0, acc: 0 });

  const ref = useRef<{ shift: Animated.Value; handlers: ScrollChromeHandlers; reset: () => void } | undefined>(undefined);
  if (!ref.current) {
    const setHidden = (h: boolean, animate = true) => {
      if (st.current.hidden === h) return;
      st.current.hidden = h;
      if (animate) Animated.timing(shift, { toValue: h ? 1 : 0, duration: 190, useNativeDriver: false }).start();
      else shift.setValue(h ? 1 : 0);
    };
    const settle = () => { st.current.acc = 0; };
    ref.current = {
      shift,
      handlers: {
        onScroll: (e) => {
          const s = st.current;
          const y = Math.max(0, e.nativeEvent.contentOffset.y);
          const dy = y - s.lastY;
          s.lastY = y;
          if (Math.abs(dy) > JUMP_PX) { s.acc = 0; return; }
          if (y < HOME_PX) { s.acc = 0; setHidden(false); return; }
          // A direction reversal starts the count over — this is the
          // hysteresis that keeps micro-jitter from ever reaching the chrome.
          if ((dy > 0) !== (s.acc > 0)) s.acc = 0;
          s.acc += dy;
          if (s.acc > HIDE_PX) setHidden(true);
          else if (s.acc < -SHOW_PX) setHidden(false);
        },
        onScrollEndDrag: settle,
        onMomentumScrollEnd: settle,
        scrollEventThrottle: 16,
      },
      reset: () => { st.current.lastY = 0; st.current.acc = 0; setHidden(false, false); },
    };
  }
  return ref.current;
}
