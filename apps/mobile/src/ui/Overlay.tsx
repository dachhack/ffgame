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
import { useTheme, MONO } from '../theme.native';

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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'center', padding: 12 }}>
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

          {children}

          {!!footer && (
            <View style={{ padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>{footer}</View>
          )}
        </View>
      </View>
    </Modal>
  );
}
