// Commissioner tools.
//
// SCOPE, stated plainly: the web's AdminPage is 2,453 lines across nine
// per-league tabs — overview, draft room, native rosters, playoffs, matchups,
// members, audit, readiness, K/DST — and this is not that. It is the part a
// commissioner needs while holding a phone: who has joined, the link to get the
// rest of them in, and the week sync that makes a board exist. The rest is
// desk work and stays on the desk.
//
// Deliberately absent, and not from laziness: delete league, reset matchup,
// force-resolve, and per-user pick overrides. Those are irreversible and they
// sit one mis-tap away from each other on a screen this size. They stay on the
// web, where there is room to be careful.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import {
  commishOverview, adminLeagueMembers, adminMatchups, friendlyError,
  type AdminLeague, type AdminMember, type AdminMatchup,
} from '@drip/core/data/liveApi';
import { syncWeek } from '@drip/core/data/sleeperAdmin';
import { useTheme } from '../theme.native';
import { Card, Chip, Display, LinkButton, Mono } from '../ui/prims';
import { Overlay } from '../ui/Overlay';

/** The same link the web's ⛓ invite button copies. Hard-coded origin because a
 *  phone has no window.location to read it from, and an invite has to land
 *  somewhere a non-player can actually open. */
const inviteLink = (code: string) => `https://dripfantasy.com/?live=1&code=${code}`;

export function Commish({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const [leagues, setLeagues] = useState<AdminLeague[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<AdminLeague | null>(null);

  const load = useCallback(async () => {
    try { setLeagues(await commishOverview()); setErr(null); }
    // Keep what's already on screen if a refresh fails — a commissioner losing
    // the list because the network blinked is worse than a stale list.
    catch (e) { setErr(friendlyError(e)); setLeagues((cur) => cur ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (leagues === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={11}>Loading your leagues…</Mono>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.you} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Display size={17}>⚑ Leagues you run</Display>
          <LinkButton label="← back" onPress={onBack} />
        </View>

        {!!err && <Mono size={10.5} tone="opp" style={{ marginBottom: 10 }}>⚠ {err}</Mono>}

        {!leagues.length && (
          <Card>
            <Mono size={10.5} tone="faint" style={{ lineHeight: 16 }}>
              None yet. Verify ownership with “I’m the commissioner” on the web, and ask the admin to import the league if it isn’t listed.
            </Mono>
          </Card>
        )}

        {leagues.map((l) => (
          <Card key={l.league_id} style={{ marginBottom: 10 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: t.text }}>{l.name}</Text>
            <Mono size={9.5} tone="faint" style={{ marginTop: 3 }}>
              {l.season} · {l.provider ?? 'sleeper'} · {l.enrolled}/{l.rosters} ENROLLED
            </Mono>

            <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <Chip
                label="⛓ share invite"
                onPress={() => { Share.share({ message: `Join my Drip Fantasy league: ${inviteLink(l.invite_code)}` }).catch(() => {}); }}
              />
              <Chip label="⚙ manage" on onPress={() => setOpen(l)} />
            </View>
          </Card>
        ))}

        <Mono size={9} tone="faint" style={{ marginTop: 6, lineHeight: 15 }}>
          Drafts, playoffs, K/DST assignment and matchup editing stay on the web — they need more room than a phone has.
        </Mono>
      </ScrollView>

      <LeagueSheet league={open} onClose={() => setOpen(null)} onChanged={load} />
    </>
  );
}

/** One league's phone-sized management: who's in, and the week sync. */
function LeagueSheet({ league, onClose, onChanged }: {
  league: AdminLeague | null; onClose: () => void; onChanged: () => void;
}) {
  const t = useTheme();
  const [tab, setTab] = useState<'members' | 'matchups'>('members');
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [matchups, setMatchups] = useState<AdminMatchup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!league) { setMembers(null); setMatchups(null); setNote(null); setTab('members'); return; }
    adminLeagueMembers(league.league_id).then(setMembers).catch(() => setMembers([]));
    adminMatchups(league.league_id).then(setMatchups).catch(() => setMatchups([]));
  }, [league]);

  if (!league) return null;

  /** Mirror this week's Sleeper schedule + pools. The same client-side syncWeek
   *  the web's manage card calls — NOT the server CLI, which is a different
   *  code path with K/DST fill and lock_at derivation. Worth knowing when the
   *  two disagree. */
  const runSync = async (week: number) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await syncWeek(league.league_id, league.sleeper_league_id, week);
      setNote(`✓ week ${week}: ${r.pairs} matchups, ${r.rosters} rosters`);
      adminMatchups(league.league_id).then(setMatchups).catch(() => {});
      onChanged();
    } catch (e) { setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const weeks = [...new Set((matchups ?? []).map((m) => m.week))].sort((a, b) => a - b);

  return (
    <Overlay
      visible
      title={league.name}
      subtitle={`${league.enrolled}/${league.rosters} ENROLLED · ${league.season}`}
      onClose={onClose}
    >
      <View style={{ flexDirection: 'row', gap: 6, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
        {(['members', 'matchups'] as const).map((id) => (
          <Pressable
            key={id}
            onPress={() => setTab(id)}
            style={{
              flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 6,
              backgroundColor: tab === id ? t.sh : 'transparent',
              borderWidth: StyleSheet.hairlineWidth, borderColor: tab === id ? t.you : t.bd,
            }}
          >
            <Mono size={10} weight="700" tone={tab === id ? 'you' : 'dim'} track={0.08}>{id.toUpperCase()}</Mono>
          </Pressable>
        ))}
      </View>

      {!!note && <Mono size={10} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ paddingHorizontal: 14, paddingTop: 10 }}>{note}</Mono>}

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
        {tab === 'members' && (members ?? []).map((m) => (
          <View key={m.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 10 }}>
            <Mono size={9} tone="faint" style={{ width: 20 }}>{m.roster_id}</Mono>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{m.team || `Roster ${m.roster_id}`}</Text>
              <Mono size={9} tone="faint">{m.owner ?? m.sleeper ?? m.email ?? 'unclaimed'}</Mono>
            </View>
            {/* Drift is advisory (0117): the seat's occupant is no longer the
                roster's Sleeper owner. Flagged, never auto-corrected. */}
            {m.drifted && <Mono size={8.5} tone="warn" weight="700">⚠ DRIFT</Mono>}
            <Mono size={9} weight="700" tone={m.enrolled ? 'you' : 'faint'}>{m.enrolled ? 'ENROLLED' : '—'}</Mono>
          </View>
        ))}
        {tab === 'members' && members?.length === 0 && <Mono size={10.5} tone="faint">No seats yet — import the league first.</Mono>}

        {tab === 'matchups' && (
          <>
            <Mono size={9} tone="faint" style={{ lineHeight: 15 }}>
              Mirror a week from Sleeper: pairings and each manager’s pool. Safe to re-run — it upserts.
            </Mono>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {[1, 2, 3, 4, 5].map((w) => (
                <Chip key={w} label={busy ? '…' : `↻ week ${w}`} disabled={busy} onPress={() => runSync(w)} />
              ))}
            </View>
            <View style={{ height: 6 }} />
            {weeks.map((w) => {
              const ms = (matchups ?? []).filter((m) => m.week === w);
              const live = ms.filter((m) => m.status === 'live').length;
              const final = ms.filter((m) => m.status === 'final').length;
              return (
                <View key={w} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 10 }}>
                  <Mono size={10} weight="700" style={{ width: 54 }}>WK {w}</Mono>
                  <Mono size={9.5} tone="faint" style={{ flex: 1 }}>{ms.length} matchup{ms.length === 1 ? '' : 's'}</Mono>
                  {!!live && <Mono size={9} tone="you" weight="700">{live} LIVE</Mono>}
                  {!!final && <Mono size={9} tone="dim">{final} FINAL</Mono>}
                </View>
              );
            })}
            {!weeks.length && <Mono size={10.5} tone="faint">No matchups yet — sync a week above.</Mono>}
          </>
        )}
      </ScrollView>
    </Overlay>
  );
}
