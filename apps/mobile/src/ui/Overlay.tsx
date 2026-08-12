// A floating overlay card — the web's modal shape.
//
// The pickers were full-screen `presentationStyle="pageSheet"` modals, which is
// the iOS-native idiom but not this product's: on the web they are cards that
// float over a dimmed board, so you keep your place and the board stays visible
// behind them. That context matters when you are choosing a player FOR a
// specific slot in a specific window.
//
// `transparent` + a dimmed backdrop reproduces it. Tapping the backdrop closes,
// tapping the card does not.
//
// The backdrop is an absolutely-positioned SIBLING of the card, not its parent.
// It used to wrap the card — the "swallow the press with an inner Pressable"
// trick, since RN has no stopPropagation — and that put a Pressable ancestor
// above every sheet's content. A Pressable competes for the touch responder on
// a drag, so a scrollable list inside a sheet would not scroll: the roster
// opened and then sat there. As siblings, nothing above the card handles
// touches at all, and tap-to-dismiss still works because the backdrop covers
// the whole screen behind it.
import { type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, MONO } from '../theme.native';

/** SHEET BODY SIZING — why there is no number here any more.
 *
 *  Every sheet holds a list inside a card capped at 88% of the screen, and each
 *  was picking its own height for that list: 420, 380, 460, and in one case
 *  nothing. That became `sheetBodyMax(chrome)`, where `chrome` was a per-sheet
 *  ESTIMATE of the title, filter rows and footer around it — which is the same
 *  guess wearing a helper function. It guessed low on the roster sheet (300
 *  against an actual ~360, and the estimate also forgot the 12pt the card is
 *  inset by), the card overflowed its cap, and `overflow: hidden` took the
 *  bottom off the OPPONENT ROSTER button.
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Inset by the safe area, not a flat 12. The card is centred, so on most
          screens this changes nothing — but a sheet whose content fills the 88%
          cap ends its last 12pt under the home indicator, and the last 12pt of
          a sheet is where the footer button lives. */}
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 12, paddingTop: Math.max(12, insets.top), paddingBottom: Math.max(12, insets.bottom) }}>
        <Pressable
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.62)' }]}
        />
        <View
          style={{
            maxHeight: '88%',
            backgroundColor: t.surface,
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.bdh,
            borderRadius: 14, overflow: 'hidden',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
            {titleLeft}
            <View style={{ flex: 1, minWidth: 0 }}>
              {typeof title === 'string'
                ? <Text style={{ fontSize: 19, fontWeight: '700', color: t.text }}>{title}</Text>
                : title}
              {typeof subtitle === 'string'
                ? <Text numberOfLines={2} style={{ fontFamily: MONO, fontSize: 10, color: t.dim, letterSpacing: 0.8, marginTop: 3 }}>{subtitle}</Text>
                : subtitle}
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ fontSize: 22, color: t.dim, lineHeight: 24 }}>✕</Text>
            </Pressable>
          </View>

          {/* The only child that may shrink, so it absorbs the overflow and the
              footer below it is never the thing that gets cut. minHeight: 0 is
              required for that — without it a flex child refuses to shrink
              below its content and the clipping comes straight back. */}
          <View style={{ flexShrink: 1, minHeight: 0 }}>{children}</View>

          {!!footer && (
            <View style={{ padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>{footer}</View>
          )}
        </View>
      </View>
    </Modal>
  );
}
