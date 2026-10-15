// A PLAYER'S FACE (v0.722.0): his headshot in a ring, or his initials when
// there's no photo (or it fails). The tools bar's waiver targets and
// suggested trades draw it; the tone says whose side he's on.
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { MONO, alpha } from '../theme.native';

const initials = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

export function PlayerFace({ image, name, size = 30, tone }: { image?: string | null; name: string; size?: number; tone: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', flexShrink: 0, backgroundColor: alpha(tone, 16), alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: tone }}>
      {image && !failed
        ? <Image source={{ uri: image }} onError={() => setFailed(true)} style={{ width: size, height: size }} resizeMode="cover" />
        : <Text style={{ fontFamily: MONO, fontSize: size * 0.34, fontWeight: '700', color: tone }}>{initials(name)}</Text>}
    </View>
  );
}
