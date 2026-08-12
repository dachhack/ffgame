// Super admin, phone edition.
//
// The web console has five tabs and every lever in the product — users, system
// flags, premium tiers, solo passes, per-league deletion, matchup boards,
// forced resolution. This is not that either, and the choice of what to bring
// is the interesting part.
//
// What a phone is actually for here is ANSWERING A QUESTION AT A BAD TIME:
// is the thing running? So HEALTH leads — matchup counts by status, whether
// plays are still landing, when the worker last published state. That is the
// screen you want at 1pm on a Sunday when someone says "my score isn't moving",
// and it is read-only, so wanting it badly costs nothing.
//
// After that: the league list (what exists, who's enrolled), pending code
// requests (people waiting to be let in — time-sensitive, and handling one is a
// single reversible flag), and the audit tail (what changed recently).
//
// NOT here, deliberately: anything that deletes, resets, force-resolves, or
// rewrites a lineup. Those need a keyboard, a wide screen, and a moment's
// thought — none of which is what a phone in a pocket provides.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  adminHealth, adminOverview, adminAudit, adminCodeRequests, adminSetCodeRequestHandled, friendlyError,
  type AdminHealth, type AdminLeague, type AdminAudit, type CodeRequest,
} from '@drip/core/data/liveApi';
import { useTheme } from '../theme.native';
import { Card, Chip, Display, LinkButton, Mono } from '../ui/prims';

const ago = (iso: string | null): string => {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'never';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

type Tab = 'health' | 'leagues' | 'requests' | 'audit';

export function Admin({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('health');
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [leagues, setLeagues] = useState<AdminLeague[] | null>(null);
  const [audit, setAudit] = useState<AdminAudit[] | null>(null);
  const [reqs, setReqs] = useState<CodeRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    // Independently, so one failing RPC doesn't blank the other three — the
    // health tab is the reason to be here and must survive a bad audit read.
    adminHealth().then(setHealth).catch((e) => setErr(friendlyError(e)));
    adminOverview().then(setLeagues).catch(() => setLeagues([]));
    adminAudit(40).then(setAudit).catch(() => setAudit([]));
    adminCodeRequests().then(setReqs).catch(() => setReqs([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const pending = (reqs ?? []).filter((r) => !r.handled).length;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.you} onRefresh={() => { setRefreshing(true); load(); setTimeout(() => setRefreshing(false), 700); }} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Display size={17}>◆ Admin</Display>
        <LinkButton label="← back" onPress={onBack} />
      </View>

      {!!err && <Mono size={10.5} tone="opp" style={{ marginBottom: 10 }}>⚠ {err}</Mono>}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
        {(['health', 'leagues', 'requests', 'audit'] as const).map((id) => (
          <Chip
            key={id}
            label={id === 'requests' && pending ? `REQUESTS ${pending}` : id.toUpperCase()}
            on={tab === id}
            onPress={() => setTab(id)}
          />
        ))}
      </ScrollView>

      {tab === 'health' && (
        health === null ? <Card><ActivityIndicator color={t.you} /></Card> : (
          <Card>
            <Mono size={9} weight="700" track={0.14} tone="faint">IS IT RUNNING</Mono>
            {/* The two that answer that question, first and large. A worker
                that stopped shows here as an ingest and a publish that have
                both gone stale, which is the actual symptom behind "my score
                isn't moving". */}
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
              <Stat label="LAST PLAY IN" value={ago(health.last_play_ingest)} big />
              <Stat label="LAST PUBLISH" value={ago(health.last_state_update)} big />
            </View>
            <View style={{ height: 1, backgroundColor: t.bd, marginVertical: 12 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              <Stat label="LIVE MATCHUPS" value={String(health.live_matchups)} />
              <Stat label="LEAGUES" value={String(health.leagues)} />
              <Stat label="ENROLLED" value={String(health.enrolled)} />
              <Stat label="LIVE PLAYS" value={String(health.live_play_count)} />
              <Stat label="SIM PLAYS" value={String(health.sim_play_count)} />
            </View>
            <Mono size={9} weight="700" track={0.14} tone="faint" style={{ marginTop: 14 }}>MATCHUPS BY STATUS</Mono>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              {Object.entries(health.matchups_by_status ?? {}).map(([k, v]) => (
                <Mono key={k} size={10} tone="dim">{k}: <Text style={{ color: t.text, fontWeight: '700' }}>{v}</Text></Mono>
              ))}
            </View>
          </Card>
        )
      )}

      {tab === 'leagues' && (leagues ?? []).map((l) => (
        <Card key={l.league_id} style={{ marginBottom: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.text }}>{l.name}</Text>
          <Mono size={9} tone="faint" style={{ marginTop: 3 }}>
            {l.season} · {l.provider ?? 'sleeper'} · {l.enrolled}/{l.rosters} enrolled
            {l.preseason_at ? ' · 🏈 preseason' : ''}
          </Mono>
        </Card>
      ))}

      {tab === 'requests' && (
        (reqs ?? []).length === 0
          ? <Card><Mono size={10.5} tone="faint">No code requests.</Mono></Card>
          : (reqs ?? []).map((r) => (
            <Card key={r.id} style={{ marginBottom: 8, opacity: r.handled ? 0.55 : 1 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{r.email ?? r.sleeper_username ?? 'unknown'}</Text>
              <Mono size={9} tone="faint" style={{ marginTop: 3 }}>{r.league_name ?? r.league_ref ?? '—'} · {ago(r.created_at)}</Mono>
              {!!r.note && <Mono size={9.5} tone="dim" style={{ marginTop: 4 }}>{r.note}</Mono>}
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                {/* The one action here, and it's a reversible flag rather than
                    anything that grants access. */}
                <Chip
                  label={r.handled ? '↺ reopen' : '✓ handled'}
                  on={!r.handled}
                  onPress={() => {
                    adminSetCodeRequestHandled(r.id, !r.handled)
                      .then(() => adminCodeRequests().then(setReqs))
                      .catch((e) => setErr(friendlyError(e)));
                  }}
                />
              </View>
            </Card>
          ))
      )}

      {tab === 'audit' && (
        <Card>
          {(audit ?? []).map((a, i) => (
            <View key={`${a.at}-${i}`} style={{ paddingVertical: 7, borderBottomWidth: i < (audit ?? []).length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: t.bd }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Mono size={9.5} weight="700" style={{ flex: 1 }}>{a.op} {a.table}</Mono>
                <Mono size={9} tone="faint">{ago(a.at)}</Mono>
              </View>
              {!!(a.actor || a.detail) && (
                <Mono size={9} tone="faint" style={{ marginTop: 2 }} >{[a.actor, a.detail].filter(Boolean).join(' · ')}</Mono>
              )}
            </View>
          ))}
          {!(audit ?? []).length && <Mono size={10.5} tone="faint">Nothing recent.</Mono>}
        </Card>
      )}

      <Mono size={9} tone="faint" style={{ marginTop: 10, lineHeight: 15 }}>
        Read-only, by choice. Deleting a league, resetting or force-resolving a matchup and rewriting someone’s picks all stay on the web — they’re irreversible and a phone is the wrong place to be sure.
      </Mono>
    </ScrollView>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ minWidth: big ? 120 : 76 }}>
      <Mono size={8.5} tone="faint" track={0.12}>{label}</Mono>
      <Text style={{ fontSize: big ? 20 : 15, fontWeight: '700', color: t.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}
