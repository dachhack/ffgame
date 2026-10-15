// A LEAGUE OR TEAM CREST — moved out of screens/Leagues.tsx (v0.722.0) so the
// league tools bar's suggested trades can show each league's avatar too.
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { crestInitial } from '@drip/core/data/crest';
import { useTheme, MONO } from '../theme.native';

/** A league or team crest.
 *
 *  The URL was already being fetched by `myEnrollments` and thrown away here —
 *  the row rendered as text only while the art sat in the response. Commissioners
 *  pick these, and `importLeague` fills a random first-party tile when Sleeper
 *  has none, so most rows have one.
 *
 *  The fallback is an initial rather than an empty square: a blank tile in a
 *  list of pictures reads as an image that failed to load. It also covers the
 *  case a URL is present but 404s, since `onError` swaps to it. */
export function Crest({ url, name, size }: { url?: string | null; name?: string | null; size: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const radius = Math.max(3, Math.round(size * 0.19));
  const show = url && !failed;
  return (
    <View
      style={{
        width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0,
        backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {show ? (
        <Image source={{ uri: url }} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <Text style={{ fontFamily: MONO, fontSize: Math.round(size * 0.42), fontWeight: '700', color: t.faint }}>
          {crestInitial(name)}
        </Text>
      )}
    </View>
  );
}

