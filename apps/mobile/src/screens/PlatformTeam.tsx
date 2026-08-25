// ⇄ MY TEAM for an EXTERNAL league (v0.356.5, founder: "We also need a my
// team page for drip leagues native and external. External won't have
// waivers or trades.")
//
// A platform league's roster is MANAGED on its platform — Sleeper, ESPN,
// Fleaflicker — but the sync already carries it here every week
// (sleeper_lineup, read through the shared pool reader), so the app can at
// least SHOW it: your identity, and who you're holding, grouped the way the
// native team screen groups them. Deliberately read-only: no waivers, no
// trades, no rename — those live on the platform, and a control that would
// drift from it is worse than none.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { myEnrollments, myLatestPool, type PoolPlayer } from '@drip/core/data/liveApi';
import { useTheme, MONO, fs } from '../theme.native';
import { Card, Display, Mono } from '../ui/prims';
import { openPlayerCard } from '../ui/PlayerCardSheet';
import { Pressable } from 'react-native';
import { tap } from '../ui/feedback';
import { useLeagueScroll } from '../ui/scrollChrome';

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
const GROUPS: { id: PoolPlayer['grp']; label: string }[] = [
  { id: 'start', label: 'STARTERS' },
  { id: 'bench', label: 'BENCH' },
  { id: 'ir', label: 'INJURED RESERVE' },
  { id: 'taxi', label: 'TAXI SQUAD' },
];
const PROVIDER_NAME: Record<string, string> = { sleeper: 'Sleeper', espn: 'ESPN', fleaflicker: 'Fleaflicker' };

export function PlatformTeam({ leagueId, rosterId }: { leagueId: string; rosterId: number }) {
  const t = useTheme();
  const chromeScroll = useLeagueScroll();   // the shell's folding chrome (v0.356.0)
  const [pool, setPool] = useState<{ week: number; players: PoolPlayer[] } | null | 'loading'>('loading');
  const [me, setMe] = useState<{ team: string; avatar: string | null; provider: string } | null>(null);
  useEffect(() => {
    let dead = false;
    myLatestPool(leagueId, rosterId).then((p) => { if (!dead) setPool(p); }).catch(() => { if (!dead) setPool(null); });
    myEnrollments('').then((rows) => {
      const e = rows.find((r) => r.league_id === leagueId && r.sleeper_roster_id === rosterId);
      if (!dead && e) setMe({ team: e.team_name, avatar: e.avatar_url, provider: e.league?.provider ?? 'sleeper' });
    }).catch(() => {});
    return () => { dead = true; };
  }, [leagueId, rosterId]);

  const provider = PROVIDER_NAME[me?.provider ?? ''] ?? 'your platform';
  const players = pool !== 'loading' && pool ? pool.players : [];
  const byGroup = GROUPS.map((g) => ({
    ...g,
    players: players.filter((p) => p.grp === g.id)
      .sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || a.full.localeCompare(b.full)),
  })).filter((g) => g.players.length > 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} {...chromeScroll} contentContainerStyle={{ padding: 12, paddingBottom: 104, gap: 10 }}>
      {me && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: t.you }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {me.avatar
              ? <Image source={{ uri: me.avatar }} style={{ width: 42, height: 42, borderRadius: 9, backgroundColor: t.bg }} />
              : <View style={{ width: 42, height: 42, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 17 }}>🧢</Text>
                </View>}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Display size={16}>{me.team}</Display>
              <Mono size={8.5} tone="faint" style={{ marginTop: 2 }}>managed on {provider} — rosters, waivers & trades live there</Mono>
            </View>
          </View>
        </Card>
      )}

      <Card>
        {pool === 'loading' && <ActivityIndicator color={t.you} />}
        {pool !== 'loading' && !pool && (
          <Mono size={10} tone="faint" style={{ lineHeight: fs(15) }}>
            No synced roster yet — it arrives with the league's first weekly sync from {provider}.
          </Mono>
        )}
        {pool !== 'loading' && pool && (
          <>
            <Mono size={9} tone="faint" track={0.12}>MY ROSTER ({players.length}) · synced wk {pool.week}</Mono>
            {byGroup.map((g) => (
              <View key={g.id}>
                {(byGroup.length > 1 || g.id !== 'start') && (
                  <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 12 }}>{g.label} ({g.players.length})</Mono>
                )}
                {g.players.map((p) => (
                  <Pressable key={`${g.id}-${p.slug}-${p.full}`}
                    onPress={() => { tap(); openPlayerCard({ slug: p.slug, name: p.full, pos: p.pos, team: p.team }); }}
                    style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 5 }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.dim, width: 30 }}>{p.pos === 'DEF' ? 'DST' : p.pos}</Text>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12.5), color: t.text }}>{p.full}</Text>
                    <Text style={{ fontFamily: MONO, fontSize: fs(9), color: t.faint }}>{p.team}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </>
        )}
      </Card>
    </ScrollView>
  );
}
