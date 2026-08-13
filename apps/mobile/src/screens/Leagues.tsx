// The landing screen once you're signed in: your leagues.
//
// Replaces jumping straight into a lineup. That shortcut only made sense while
// this app had one screen — it picked `myRoster()`, the FIRST enrolled
// membership, which is arbitrary the moment you're in more than one league, and
// it gave you no way to reach the others.
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { myEnrollments, claimMyRosters, commishOverview, friendlyError, myWaitlist, type AdminLeague, type Enrollment, type WaitlistRow } from '@drip/core/data/liveApi';
import { useTheme, MONO, alpha } from '../theme.native';
import { tap } from '../ui/feedback';
import { Card, Display, LinkButton, Mono } from '../ui/prims';
import { BrandLoading } from '../ui/BrandLoading';

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
function Crest({ url, name, size }: { url?: string | null; name?: string | null; size: number }) {
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
          {(name ?? '?').trim().charAt(0).toUpperCase() || '?'}
        </Text>
      )}
    </View>
  );
}

export function Leagues({ userId, onOpen, onBoard }: {
  userId: string;
  /** rosterId is null for a league you commission WITHOUT a team — it opens
   *  into management (draft + team tools), not a lineup it doesn't have. */
  onOpen: (leagueId: string, rosterId: number | null, name: string, native: boolean, pickUserId?: string) => void;
  /** Open the league board — browse open leagues, post yours, recruit. */
  onBoard: () => void;
}) {
  const t = useTheme();
  const [rows, setRows] = useState<Enrollment[] | null>(null);
  // Native leagues I commission but hold no seat in. A commissioner does not
  // need a team (0039 — redeeming the code is the whole qualification), and
  // before this list a seatless commissioner had no door into their league on
  // the phone at all: enrollments was the only source.
  const [managed, setManaged] = useState<AdminLeague[]>([]);
  // Leagues joined but not seated — full-league joins wait here (0125) until
  // the commissioner deals them in as an owner or a co-manager.
  const [waiting, setWaiting] = useState<WaitlistRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // Same order the web uses: claim any rosters this account owns but hasn't
      // been linked to yet, THEN read enrollments — otherwise a freshly
      // assigned team doesn't appear until the next load.
      await claimMyRosters().catch(() => {});
      const enr = await myEnrollments(userId);
      setRows(enr);
      const enrolledIds = new Set(enr.map((e) => e.league_id));
      // Only native leagues: they're the ones the app can actually manage. A
      // commissioned Sleeper league's tools live on the web.
      const cl = await commishOverview().catch(() => [] as AdminLeague[]);
      setManaged(cl.filter((l) => l.provider === 'native' && !enrolledIds.has(l.league_id)));
      setWaiting(await myWaitlist().catch(() => []));
    } catch (e) {
      setErr(friendlyError(e));
      setRows([]);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (rows === null) {
    return (
      <BrandLoading label="Loading your leagues…" />
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
            onPress={() => { tap(); onOpen(e.league_id, e.sleeper_roster_id, lg?.name ?? 'League', lg?.provider === 'native', e.pick_user_id); }}
            android_ripple={{ color: alpha(t.you, 16) }}
            style={({ pressed }) => ({
              backgroundColor: t.surface, overflow: 'hidden',
              borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
              borderLeftWidth: 3, borderLeftColor: t.you,
              borderRadius: 12, padding: 14, gap: 4,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <Crest url={lg?.avatar_url} name={lg?.name} size={42} />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '700', color: t.text }}>
                    {lg?.name ?? 'League'}
                  </Text>
                  {!!e.comanager && <Mono size={8.5} tone="warn" track={0.08}>CO-MGR</Mono>}
                  {!!lg?.is_mock && <Mono size={8.5} tone="faint" track={0.08}>MOCK</Mono>}
                  {!!kind && <Mono size={8.5} tone="warn" track={0.08}>{kind}</Mono>}
                </View>
                {/* Your own team crest, small, beside the team it belongs to —
                    the same pairing the web's league card uses, with the sizes
                    swapped because there the TEAM is the heading and here the
                    LEAGUE is. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {!!e.avatar_url && <Crest url={e.avatar_url} name={e.team_name} size={16} />}
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: t.mid }}>{e.team_name}</Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Mono size={9} tone="faint" track={0.06}>
                {lg?.season ?? ''}{lg?.provider ? ` · ${lg.provider.toUpperCase()}` : ''}
              </Mono>
              <View style={{ flex: 1 }} />
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.you }}>SET LINEUP →</Text>
            </View>
          </Pressable>
        );
      })}

      {/* Leagues I run without playing in — the commissioner-without-a-team
          case. Amber accent instead of green: this is a management door, not a
          lineup to set. */}
      {managed.map((l) => (
        <Pressable
          key={`mgmt-${l.league_id}`}
          onPress={() => { tap(); onOpen(l.league_id, null, l.name, true); }}
          android_ripple={{ color: alpha(t.warn, 16) }}
          style={({ pressed }) => ({
            backgroundColor: t.surface, overflow: 'hidden',
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
            borderLeftWidth: 3, borderLeftColor: t.warn,
            borderRadius: 12, padding: 14, gap: 4,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            <Crest url={l.avatar_url} name={l.name} size={42} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', color: t.text }}>{l.name}</Text>
              <Text numberOfLines={1} style={{ fontSize: 12, color: t.mid, marginTop: 2 }}>
                Commissioner — no team · {l.enrolled}/{l.rosters} enrolled
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Mono size={9} tone="faint" track={0.06}>{l.season}</Mono>
            <View style={{ flex: 1 }} />
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.warn }}>⚑ MANAGE →</Text>
          </View>
        </Pressable>
      ))}

      {/* Waiting on a seat: joined, not dealt in yet. Read-only by design —
          the commissioner's move, not yours. */}
      {waiting.map((w) => (
        <View key={`wait-${w.league_id}`} style={{ backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderStyle: 'dashed', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
          <Crest url={w.avatar_url} name={w.name} size={42} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: t.text }}>{w.name}</Text>
            <Text style={{ fontSize: 11.5, color: t.mid, marginTop: 2 }}>You're in — waiting on a team assignment from the commissioner.</Text>
          </View>
          <Mono size={9} tone="warn" weight="700" track={0.06}>⏳ WAITING</Mono>
        </View>
      ))}

      {/* The league board: browse open leagues, post yours, recruit friends.
          Below the league list because your own leagues are the daily visit;
          finding a new one is the occasional one. */}
      <Pressable
        onPress={() => { tap(); onBoard(); }}
        android_ripple={{ color: alpha(t.you, 16) }}
        style={({ pressed }) => ({
          backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
          borderStyle: 'dashed', borderRadius: 12, padding: 14,
          flexDirection: 'row', alignItems: 'center', gap: 11, opacity: pressed ? 0.85 : 1,
        })}
      >
        <View style={{ width: 42, height: 42, borderRadius: 8, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 18 }}>🔎</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: t.text }}>League board</Text>
          <Text style={{ fontSize: 11.5, color: t.mid, marginTop: 2 }}>Find an open league · post yours · recruit friends</Text>
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.you }}>→</Text>
      </Pressable>

      <View style={{ alignItems: 'center', marginTop: 8 }}>
        <LinkButton label="↻ refresh" onPress={refresh} />
      </View>
    </ScrollView>
  );
}
