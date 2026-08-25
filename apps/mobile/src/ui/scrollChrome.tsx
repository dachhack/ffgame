// The LinkedIn pattern (v0.356.0, founder: "their menu at the bottom ...
// hides down when you scroll the page down but comes back up again when you
// scroll up. The top folds up too"): the app chrome — the header above a
// league screen and the room bar below it — gets out of the way while you
// read DOWN a page, and comes home the moment you pull UP, wherever you are.
//
// The driver tracks scroll DELTAS, not absolute position, so entering a
// screen mid-scroll or hopping between tabs never strands the chrome: a
// finger's downward travel folds it over ~FOLD_PX of movement, any upward
// travel unfolds it, and the top of a page always shows it. When the finger
// lifts half-way the chrome SNAPS to whichever side it is nearer — a
// half-folded header reads as a rendering bug, not a state.
//
// Screens opt in by spreading useLeagueScroll() onto their MAIN ScrollView:
//   <ScrollView {...useLeagueScroll()} ...>
// A screen that never scrolls (or never spreads) simply keeps the chrome —
// outside a league the context is absent and the spread is empty.
import { createContext, useContext, useRef } from 'react';
import { Animated } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** Downward travel that fully folds the chrome. */
const FOLD_PX = 64;
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
  const val = useRef(0);
  const lastY = useRef(0);

  const ref = useRef<{ shift: Animated.Value; handlers: ScrollChromeHandlers; reset: () => void } | undefined>(undefined);
  if (!ref.current) {
    const set = (v: number) => { val.current = v; shift.setValue(v); };
    const snap = () => {
      const to = val.current >= 0.5 ? 1 : 0;
      val.current = to;
      Animated.timing(shift, { toValue: to, duration: 150, useNativeDriver: false }).start();
    };
    ref.current = {
      shift,
      handlers: {
        onScroll: (e) => {
          const y = Math.max(0, e.nativeEvent.contentOffset.y);
          const dy = y - lastY.current;
          lastY.current = y;
          if (Math.abs(dy) > JUMP_PX) return;
          if (y < HOME_PX) { set(0); return; }
          set(Math.min(1, Math.max(0, val.current + dy / FOLD_PX)));
        },
        onScrollEndDrag: snap,
        onMomentumScrollEnd: snap,
        scrollEventThrottle: 16,
      },
      reset: () => { lastY.current = 0; set(0); },
    };
  }
  return ref.current;
}
