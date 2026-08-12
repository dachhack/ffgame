// A BOTTOM SHEET — the phone idiom for "more about this, without leaving here".
//
// This started as the web's modal: a card floating in the middle of a dimmed
// page, faded in. That was a faithful port and it is why the app read as a web
// page. A centred fading card is a browser dialog; a phone slides a sheet up
// from the edge your thumb is already at, gives it a handle, and lets you throw
// it back down. Same information, and the difference is most of "feels native".
//
// What changed, and why each part matters:
//   · It ENTERS from the bottom edge instead of appearing. Direction is what
//     tells you where the thing came from and where it will go back to.
//   · It is anchored to that edge, full width, rounded only on top — so it
//     reads as attached to the screen rather than floating over it.
//   · A grab handle, and a DRAG to dismiss. The ✕ stays for reach, but the
//     gesture is the one people try first.
//   · The backdrop fades with the slide rather than snapping.
//
// The backdrop is still an absolutely-positioned SIBLING of the card, not its
// parent. It used to wrap the card — the "swallow the press with an inner
// Pressable" trick, since RN has no stopPropagation — and that put a Pressable
// ancestor above every sheet's content. A Pressable competes for the touch
// responder on a drag, so a scrollable list inside a sheet would not scroll: the
// roster opened and then sat there. As siblings, nothing above the card handles
// touches at all, and tap-to-dismiss still works because the backdrop covers the
// whole screen behind it.
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme.native';

/** SHEET BODY SIZING — why there is no number here any more.
 *
 *  Every sheet holds a list inside a card capped at 88% of the screen, and each
 *  was picking its own height for that list: 420, 380, 460, and in one case
 *  nothing. That became `sheetBodyMax(chrome)`, where `chrome` was a per-sheet
 *  ESTIMATE of the title, filter rows and footer around it — which is the same
 *  guess wearing a helper function. It guessed low on the roster sheet, the card
 *  overflowed its cap, and `overflow: hidden` took the bottom off the OPPONENT
 *  ROSTER button.
 *
 *  Both failure modes look the same to a player: too big and the card clips
 *  (a footer with its bottom sliced off, a list that will not reach its end),
 *  too small and the sheet floats with empty space around a body scrolling a
 *  row at a time.
 *
 *  So nothing measures anything now. The card is a flex column with a max
 *  height; the header and footer size to their content; the body is the one
 *  child that may SHRINK, so it takes exactly what is left and not a point
 *  more. A sheet's body just has to be able to shrink — `flexShrink: 1` on the
 *  ScrollView — which is a property, not an arithmetic. */

/** Far enough down, or fast enough, to mean it. Either alone is wrong: a slow
 *  deliberate drag past halfway is a dismiss even at zero velocity, and a quick
 *  flick is a dismiss even if it barely moved. */
const DISMISS_DY = 110;
const DISMISS_VY = 0.75;

export function Overlay({ visible, title, subtitle, titleLeft, onClose, children, footer }: {
  visible: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Rendered left of the title — the web puts the player's team crest here. */
  titleLeft?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // 0 = seated, 1 = fully off the bottom. One value drives the slide AND the
  // backdrop, so they can never disagree about how open the sheet is.
  const anim = useRef(new Animated.Value(1)).current;
  const H = Dimensions.get('window').height;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 0 : 1,
      duration: visible ? 260 : 180,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  /** Dragging works in PIXELS while `anim` is a 0–1 ratio, so the gesture writes
   *  through a second value and the two are summed in the transform. Mixing them
   *  into one would make the release animation fight whatever the finger left
   *  behind. */
  const drag = useRef(new Animated.Value(0)).current;
  const settle = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();

  const pan = useRef(
    PanResponder.create({
      // Claim only a clear DOWNWARD drag on the handle area. onMoveShouldSet, not
      // onStartShouldSet: grabbing on touch-down would steal every tap in the
      // header, including the ✕.
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { if (g.dy > 0) drag.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_DY || g.vy > DISMISS_VY) { drag.setValue(0); onClose(); }
        else settle();
      },
      onPanResponderTerminate: settle,
    }),
  ).current;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: '#000', opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.62, 0] }) },
          ]}
        >
          <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>

        <Animated.View
          style={{
            // Never taller than 92% — a sheet that reaches the status bar reads
            // as a screen, and the point of a sheet is that the board is still
            // behind it.
            maxHeight: '92%',
            backgroundColor: t.surface,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.bdh,
            overflow: 'hidden',
            transform: [{
              translateY: Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [0, H] }), drag),
            }],
          }}
        >
          {/* The handle and the title share the drag region: on a real sheet the
              whole header is draggable, not a 4pt bar you have to hit. */}
          <View {...pan.panHandlers}>
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
              <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: t.bd }} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
              {titleLeft}
              <View style={{ flex: 1, minWidth: 0 }}>
                {typeof title === 'string'
                  ? <Text style={{ fontSize: 20, fontWeight: '700', color: t.text }}>{title}</Text>
                  : title}
                {/* System font, not mono: this is a sentence about the sheet, and
                    mono on prose is the dashboard look we are getting away from.
                    Mono stays where it belongs — on the data inside. */}
                {typeof subtitle === 'string'
                  ? <Text numberOfLines={2} style={{ fontSize: 12, color: t.dim, marginTop: 3, lineHeight: 16 }}>{subtitle}</Text>
                  : subtitle}
              </View>
              <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                <Text style={{ fontSize: 22, color: t.dim, lineHeight: 24 }}>✕</Text>
              </Pressable>
            </View>
          </View>

          {/* The only child that may shrink, so it absorbs the overflow and the
              footer below it is never the thing that gets cut. minHeight: 0 is
              required for that — without it a flex child refuses to shrink
              below its content and the clipping comes straight back. */}
          <View style={{ flexShrink: 1, minHeight: 0 }}>{children}</View>

          {/* The safe-area inset lives INSIDE the sheet now. The sheet is flush
              to the bottom edge, so without this its last row — which is where
              the footer button is — sits under the home indicator. */}
          <View style={{ paddingBottom: insets.bottom }}>
            {!!footer && (
              <View style={{ padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>{footer}</View>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
