// The landing screen once you're signed in: your leagues.
//
// Replaces jumping straight into a lineup. That shortcut only made sense while
// this app had one screen — it picked `myRoster()`, the FIRST enrolled
// membership, which is arbitrary the moment you're in more than one league, and
// it gave you no way to reach the others.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { myEnrollments, claimMyRosters, friendlyError, type Enrollment } from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
import { Card, Display, LinkButton, Mono } from '../ui/prims';

export function Leagues({ userId, onOpen }: {
  userId: string;
  onOpen: (leagueId: string, rosterId: number, name: string) => void;
}) {
  const t = useTheme();
  const [rows, setRows] = useState<Enrollment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // Same order the web uses: claim any rosters this account owns but hasn't
      // been linked to yet, THEN read enrollments — otherwise a freshly
      // assigned team doesn't appear until the next load.
      await claimMyRosters().catch(() => {});
      setRows(await myEnrollments(userId));
    } catch (e) {
      setErr(friendlyError(e));
      setRows([]);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (rows === null) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={11}>Loading your leagues…</Mono>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.you} />}
    >
      <View style={{ paddingHorizontal: 4, paddingTop: 4, paddingBottom: 2 }}>
        <Display size={22}>Your leagues</Display>
        <Mono size={9.5} tone="faint">Pull down to refresh.</Mono>
      </View>

      {!!err && <Mono size={10.5} tone="opp">{err}</Mono>}

      {rows.length === 0 && !err && (
        <Card>
          <Display size={15}>No leagues yet</Display>
          <Mono size={10.5} style={{ marginTop: 8 }}>
            Join with an invite code at dripfantasy.com — it's the same account, and your
            leagues show up here straight after. Pull down once you've joined.
          </Mono>
        </Card>
      )}

      {rows.map((e) => {
        const lg = e.league;
        const kind = lg?.kind && lg.kind !== 'league' ? lg.kind.toUpperCase() : null;
        return (
          <Pressable
            key={`${e.league_id}-${e.sleeper_roster_id}`}
            onPress={() => onOpen(e.league_id, e.sleeper_roster_id, lg?.name ?? 'League')}
            style={{
              backgroundColor: t.surface,
              borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
              borderLeftWidth: 3, borderLeftColor: t.you,
              borderRadius: 8, padding: 14, gap: 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '700', color: t.text }}>
                {lg?.name ?? 'League'}
              </Text>
              {!!lg?.is_mock && <Mono size={8.5} tone="faint" track={0.08}>MOCK</Mono>}
              {!!kind && <Mono size={8.5} tone="warn" track={0.08}>{kind}</Mono>}
            </View>
            <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.mid }}>{e.team_name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Mono size={9} tone="faint" track={0.06}>
                {lg?.season ?? ''}{lg?.provider ? ` · ${lg.provider.toUpperCase()}` : ''}
              </Mono>
              <View style={{ flex: 1 }} />
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.you }}>SET LINEUP →</Text>
            </View>
          </Pressable>
        );
      })}

      <View style={{ alignItems: 'center', marginTop: 8 }}>
        <LinkButton label="↻ refresh" onPress={refresh} />
      </View>
    </ScrollView>
  );
}
