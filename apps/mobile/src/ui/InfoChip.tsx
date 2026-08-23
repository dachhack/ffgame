// ⓘ — the explainer, folded away (v0.350.2).
//
// Founder, on the MODE sheet: "instead of explaining everything, let's have
// info chips with pop ups." Settings screens had grown a paragraph under
// every control — correct, and unreadable in aggregate. The rule now: a
// control gets its LABEL and, when it needs explaining, one ⓘ beside it;
// the paragraph lives in a sheet that opens on demand and closes with a
// swipe. Dynamic STATUS lines ("cap tightens to $15", "no fresh blood this
// week") stay inline — state is not explanation.
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme, MONO, fs } from '../theme.native';
import { tap } from './feedback';
import { Overlay } from './Overlay';

/** A small ⓘ that opens a pop-up with the full story. Put it beside a
 *  section label; pass the explanation as children (plain string is fine —
 *  paragraphs separated by blank lines read best). */
export function InfoChip({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable hitSlop={10} accessibilityLabel={`About ${title}`}
        onPress={() => { tap(); setOpen(true); }}
        style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '700', color: t.dim }}>ⓘ</Text>
      </Pressable>
      <Overlay visible={open} title={title} onClose={() => setOpen(false)}>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {typeof children === 'string'
            ? <Text style={{ fontSize: fs(13.5), lineHeight: fs(20), color: t.text }}>{children}</Text>
            : children}
        </ScrollView>
      </Overlay>
    </>
  );
}

/** A section label with its ⓘ — the common arrangement, in one line. */
export function LabelInfo({ label, title, info, tone }: {
  label: string;
  /** Sheet title; defaults to the label. */
  title?: string;
  info: ReactNode;
  tone?: 'faint' | 'dim';
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', letterSpacing: 1.1, color: tone === 'dim' ? t.dim : t.faint }}>
        {label}
      </Text>
      <InfoChip title={title ?? label}>{info}</InfoChip>
    </View>
  );
}
