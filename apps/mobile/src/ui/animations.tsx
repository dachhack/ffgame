// The moments — flip, nuke, hot, live.
//
// Ported from the web's CSS keyframes (app/cardTable.tsx, DemoBoard.tsx) with
// their real durations and easings, not approximations:
//
//   ct-flipin    .55s cubic-bezier(.3,1.4,.5,1)   rotateY 180° → 0
//   ct-wob       4.8s ease-in-out infinite alt    rotateZ ±.9°, translateY -2px
//   nukeburst    .9s  cubic-bezier(.2,1.6,.4,1)   scale .25 → 1.45 → .94 → 1
//   shake        .6s  ease                        translateX ±3px
//   ct-livepulse 1.6s infinite                    an expanding ring
//
// STILL ON RN's OWN `Animated`, AND THAT IS NOW A CONCLUSION RATHER THAN A
// DEFERRAL. The open question was whether these moments would force
// react-native-reanimated. They don't: every one is a declarative timing or
// sequence over `opacity` and `transform`, which is exactly the set
// `useNativeDriver: true` hands to the UI thread. Nothing here is gesture-driven
// or needs to read a value back on the JS thread mid-flight, which is where
// Reanimated actually earns its keep. A slow JS tick — a realtime board refresh
// landing mid-burst — cannot stutter any of it.
//
// TWO THINGS THAT ARE NOT DIRECT PORTS, both deliberate:
//
// · ct-livepulse animates `box-shadow`, which the native driver cannot touch (it
//   isn't a transform, and off-thread shadow interpolation doesn't exist). The
//   ring is a real sibling View that scales and fades instead — same read, and
//   it stays on the UI thread rather than trading the effect for JS-driven
//   shadow tweening.
//
// · fvdraw (the field-view stroke draw) has NO port here. It animates
//   `stroke-dashoffset` on an SVG path, and this app has no FieldView to draw —
//   there is no react-native-svg dependency and no field surface on any ported
//   screen. Rather than fake it with a scaling rectangle, it waits for the field
//   view itself. That is the one of the three named animations that is genuinely
//   absent, and it's absent because its subject is.
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { MONO } from '../theme.native';

// The web's cubic-beziers, verbatim. Both overshoot (y > 1), which is what gives
// the flip its snap and the burst its punch — linear-ing them out would land the
// same pixels in the same time and feel like a different game.
const FLIP_EASE = Easing.bezier(0.3, 1.4, 0.5, 1);
const BURST_EASE = Easing.bezier(0.2, 1.6, 0.4, 1);

/** ct-flipin — the sealed card turning face-up.
 *
 *  `play` is passed rather than inferred from mount because these cards mount
 *  constantly: switching tabs, a realtime refresh, or simply opening the board
 *  remounts every face on screen. Flipping on mount would replay the reveal
 *  every time you look at the board, which drains the moment of the one thing
 *  that makes it a moment. The caller decides, by remembering which slots it had
 *  already seen revealed — see LiveBoard's `seenRevealed`. */
export function useFlipIn(play: boolean) {
  const v = useRef(new Animated.Value(play ? 0 : 1)).current;
  useEffect(() => {
    if (!play) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 550, easing: FLIP_EASE, useNativeDriver: true }).start();
  }, [play, v]);
  return {
    // perspective MUST precede rotateY in the transform list — without it the
    // card rotates orthographically and reads as a horizontal squash, not a flip.
    transform: [
      { perspective: 800 },
      { rotateY: v.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '0deg'] }) },
    ],
  };
}

/** ct-wob — the idle wobble that makes the table feel like objects on felt.
 *
 *  Staggered by slot index instead of randomised: `Math.random()` in a render is
 *  a new phase on every re-render, so cards would jump when the board refreshes.
 *  An index-derived offset is stable for the life of the card. */
export function useWobble(idx = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 4800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 4800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const t = setTimeout(() => loop.start(), (idx % 5) * 260);
    return () => { clearTimeout(t); loop.stop(); };
  }, [idx, v]);
  return {
    transform: [
      { rotateZ: v.interpolate({ inputRange: [0, 1], outputRange: ['-0.9deg', '0.9deg'] }) },
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
    ],
  };
}

/** shake — the victim's card taking the hit. */
export function useShake(play: boolean) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!play) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 600, easing: Easing.ease, useNativeDriver: true }).start();
  }, [play, v]);
  return {
    transform: [{
      translateX: v.interpolate({
        inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1],
        outputRange: [0, -3, 3, -3, 3, 0],
      }),
    }],
  };
}

/** nukeburst — 💥 and the NUKED chip over the card that got hit.
 *
 *  The live board publishes `nuked` as a bare boolean (server/src/resolve.js),
 *  with no points figure — so unlike the demo board's "NUKED −4.2" this shows
 *  the verdict without the number. Inventing one, or digging a delta out of
 *  successive score snapshots, would be guessing at the scoreboard. */
export function NukeBurst({ play }: { play: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!play) return;
    v.setValue(0); fade.setValue(1);
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 900, easing: BURST_EASE, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(fade, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [play, v, fade]);
  if (!play) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 3,
        alignItems: 'center', justifyContent: 'center', gap: 6,
        opacity: fade,
        transform: [{
          // The web's four-stop keyframe, kept as four stops: the 1.45 overshoot
          // at 45% and the 0.94 undershoot at 70% ARE the punch.
          scale: v.interpolate({ inputRange: [0, 0.45, 0.7, 1], outputRange: [0.25, 1.45, 0.94, 1] }),
        }],
      }}
    >
      <Animated.Text style={{ fontSize: 34, opacity: v }}>💥</Animated.Text>
      <View style={{ borderWidth: 1, borderColor: '#FF4F62', borderRadius: 6, paddingHorizontal: 11, paddingVertical: 4, backgroundColor: 'rgba(20,10,12,0.8)' }}>
        <Text style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '800', letterSpacing: 2, color: '#FF4F62' }}>NUKED</Text>
      </View>
    </Animated.View>
  );
}

/** ct-livepulse — the expanding ring behind a LIVE chip.
 *
 *  A View rather than an animated box-shadow; see the header. Sits behind its
 *  sibling, so the caller wraps the chip and this together. */
export function LivePulse({ color = '#E9B959' }: { color?: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left: -4, right: -4, top: -4, bottom: -4,
        borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
      }}
    />
  );
}

/** A soft breathing glow for a HOT slot — the web's card-level hot state, which
 *  is a box-shadow there and so gets the same sibling-View treatment. */
export function HotGlow({ color = '#E9B959' }: { color?: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left: -2, right: -2, top: -2, bottom: -2,
        borderRadius: 10, borderWidth: 2, borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.9] }),
      }}
    />
  );
}

/** A score that just moved — a brief pop, so a bank ticking up is noticed
 *  without the board needing a diff readout. Fires on CHANGE, not on mount:
 *  a first render is not a score going up. */
export function useScoreTick(value: number | null | undefined) {
  const v = useRef(new Animated.Value(1)).current;
  const prev = useRef(value);
  useEffect(() => {
    const had = prev.current;
    prev.current = value;
    if (had == null || value == null || value === had) return;
    Animated.sequence([
      Animated.timing(v, { toValue: 1.35, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [value, v]);
  return { transform: [{ scale: v }] };
}
