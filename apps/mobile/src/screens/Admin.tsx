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
// MATCHUPS earned its way in after the read-only rule above was written: on a
// game night the admin question isn't just "is it running" but "did this
// matchup lock / can I force it" — and the moment that matters most is exactly
// when only the phone is in reach. Open/Lock/Final mirror the web's three
// buttons; RESET is the one destructive act here and hides behind a native
// confirm that says what it erases.
//
// Still NOT here: deletion, forced resolution, lineup rewrites. Those keep
// needing a keyboard and a moment's thought.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  adminHealth, adminOverview, adminAudit, adminCodeRequests, adminSetCodeRequestHandled, friendlyError,
  adminLeagueMembers, adminAssignRoster, commishOverview, getSession, redeemCommish,
  adminMatchups, adminSetMatchup, adminResetMatchup, adminPickReadiness,
  type AdminHealth, type AdminLeague, type AdminAudit, type AdminMatchup, type AdminMember, type CodeRequest, type PickReadiness,
} from '@drip/core/data/liveApi';
import { useTheme } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono } from '../ui/prims';
import { Overlay } from '../ui/Overlay';

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

type Tab = 'health' | 'leagues' | 'matchups' | 'requests' | 'audit';

export function Admin({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('health');
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [leagues, setLeagues] = useState<AdminLeague[] | null>(null);
  const [audit, setAudit] = useState<AdminAudit[] | null>(null);
  const [reqs, setReqs] = useState<CodeRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // League ids whose commissioner seat is PERSONALLY mine. Deliberately not
  // admin_overview's `commissioner` — that is `commissioner_id is not null`,
  // "somebody runs this league", and gating on it hid the web's take-seat
  // button in exactly the case that needed it (#336).
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [seatFor, setSeatFor] = useState<AdminLeague | null>(null);   // seat-picker target
  const [seats, setSeats] = useState<AdminMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    // Independently, so one failing RPC doesn't blank the other three — the
    // health tab is the reason to be here and must survive a bad audit read.
    adminHealth().then(setHealth).catch((e) => setErr(friendlyError(e)));
    adminOverview().then(setLeagues).catch(() => setLeagues([]));
    adminAudit(40).then(setAudit).catch(() => setAudit([]));
    adminCodeRequests().then(setReqs).catch(() => setReqs([]));
    commishOverview().then((ls) => setMine(new Set(ls.map((l) => l.league_id)))).catch(() => {});
    getSession().then((s) => setMyEmail(s?.user.email ?? null)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // Take a league's commissioner seat — the same redeem_commish spend as the
  // web console button: the code IS the authorization, and the admin already
  // holds every code. No second becoming-commissioner path to keep in step.
  const takeCommish = async (l: AdminLeague) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await redeemCommish(l.commish_code);
      if (r.ok) { commit(); setNote(`✓ you are the commissioner of ${l.name}`); load(); }
      else { warn(); setNote(r.error ?? 'could not take the seat'); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const openSeats = (l: AdminLeague) => {
    tap();
    setSeatFor(l); setSeats(null);
    adminLeagueMembers(l.league_id).then(setSeats).catch((e) => { setNote(friendlyError(e)); setSeatFor(null); });
  };
  // Claim a seat as myself — admin_assign_roster by my own email, any provider.
  const takeSeat = async (rosterId: number) => {
    if (busy || !seatFor || !myEmail) return;
    setBusy(true); setNote(null);
    try {
      const r = await adminAssignRoster(seatFor.league_id, rosterId, myEmail);
      if (r.ok) { commit(); setNote(`✓ seated in ${seatFor.name} — it's on your leagues screen`); setSeatFor(null); load(); }
      else { warn(); setNote(r.error ?? 'could not take the seat'); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  // ── MATCHUPS: game-night controls ──────────────────────────────────────────
  const [mLeague, setMLeague] = useState<string | null>(null);
  const [matchups, setMatchups] = useState<AdminMatchup[] | null>(null);
  const [ready, setReady] = useState<PickReadiness[] | null>(null);
  const loadMatchups = useCallback((leagueId: string) => {
    setMLeague(leagueId); setMatchups(null); setReady(null);
    adminMatchups(leagueId).then((ms) => {
      setMatchups(ms);
      // Readiness for the week that's actually in play: the earliest week with
      // a non-final matchup (finals need no readiness), else the last week.
      const active = ms.filter((m) => m.status !== 'final').map((m) => m.week);
      const wk = active.length ? Math.min(...active) : ms.length ? Math.max(...ms.map((m) => m.week)) : null;
      if (wk != null) adminPickReadiness(leagueId, wk).then(setReady).catch(() => setReady([]));
      else setReady([]);
    }).catch((e) => { setNote(friendlyError(e)); setMatchups([]); });
  }, []);
  const setStatus = async (m: AdminMatchup, status: string, lockNow = false) => {
    if (busy || !mLeague) return;
    setBusy(true); setNote(null);
    try {
      const r = await adminSetMatchup(m.id, status, lockNow);
      if (r.ok) { commit(); setNote(`✓ week ${m.week} → ${status}`); } else { warn(); setNote(r.error ?? 'failed'); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); if (mLeague) loadMatchups(mLeague); }
  };
  const resetMatchup = (m: AdminMatchup) => {
    Alert.alert(`Reset week ${m.week}?`,
      'Back to scheduled: seals reopen and this matchup\'s window scores are erased. Picks themselves survive.',
      [
        { text: 'cancel', style: 'cancel' },
        { text: 'reset', style: 'destructive', onPress: async () => {
          if (busy || !mLeague) return;
          setBusy(true); setNote(null);
          try {
            const r = await adminResetMatchup(m.id);
            if (r.ok) { commit(); setNote(`✓ week ${m.week} reset → scheduled`); } else { warn(); setNote(r.error ?? 'failed'); }
          } catch (e) { warn(); setNote(friendlyError(e)); }
          finally { setBusy(false); if (mLeague) loadMatchups(mLeague); }
        } },
      ]);
  };

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
        {(['health', 'leagues', 'matchups', 'requests', 'audit'] as const).map((id) => (
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
            {/* The three that answer that question, first and large. A worker
                that stopped shows here as an ingest and a publish that have
                both gone stale, which is the actual symptom behind "my score
                isn't moving".
                LAST SYNC is the one that works on a WEDNESDAY: ingest and
                publish only move during games, so between slates they read
                stale on a healthy worker and tell you nothing. The weekly sync
                runs on boot and every few hours regardless, which makes it the
                only liveness signal that means anything out of season hours. */}
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
              <Stat label="LAST PLAY IN" value={ago(health.last_play_ingest)} big />
              <Stat label="LAST PUBLISH" value={ago(health.last_state_update)} big />
            </View>
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 12 }}>
              <Stat label="LAST SYNC" value={ago(health.last_lineup_sync)} big />
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

      {tab === 'leagues' && !!note && (
        <Mono size={10} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginBottom: 8 }}>{note}</Mono>
      )}
      {tab === 'leagues' && (leagues ?? []).map((l) => (
        <Card key={l.league_id} style={{ marginBottom: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.text }}>{l.name}</Text>
          <Mono size={9} tone="faint" style={{ marginTop: 3 }}>
            {l.season} · {l.provider ?? 'sleeper'} · {l.enrolled}/{l.rosters} enrolled
            {l.preseason_at ? ' · 🏈 preseason' : ''}
          </Mono>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {mine.has(l.league_id)
              ? <Mono size={9} tone="you" weight="700">⚑ you run this</Mono>
              : <Chip label={l.commissioner ? '⚑ TAKE COMMISH SEAT' : '⚑ MAKE ME COMMISH'} onPress={() => { tap(); void takeCommish(l); }} />}
            {l.enrolled < l.rosters && <Chip label="＋ TAKE A SEAT" onPress={() => openSeats(l)} />}
          </View>
        </Card>
      ))}

      {/* seat picker: every seat, open ones tappable — claimed ones shown so
          the admin can see who holds what before wading in */}
      <Overlay visible={!!seatFor} title={seatFor ? `Take a seat in ${seatFor.name}` : ''}
        subtitle={myEmail ? `Assigns the seat to ${myEmail} — the same admin_assign_roster the web console uses.` : undefined}
        onClose={() => setSeatFor(null)}>
        {seats === null ? <ActivityIndicator color={t.you} /> : (
          <ScrollView style={{ maxHeight: 420 }}>
            {seats.map((m) => {
              const openSeat = !m.enrolled && !m.claim_email;
              return (
                <View key={m.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '700', color: openSeat ? t.text : t.dim }}>
                      {m.team ?? `Roster ${m.roster_id}`}
                    </Text>
                    <Mono size={8.5} tone="faint">
                      {m.enrolled ? (m.email ?? m.sleeper ?? 'taken') : m.claim_email ? `pending: ${m.claim_email}` : 'open'}
                    </Mono>
                  </View>
                  {openSeat && <Chip label="＋ ME" on onPress={() => { tap(); void takeSeat(m.roster_id); }} />}
                </View>
              );
            })}
          </ScrollView>
        )}
      </Overlay>

      {tab === 'matchups' && (
        <>
          {!!note && <Mono size={10} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginBottom: 8 }}>{note}</Mono>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
            {(leagues ?? []).map((l) => (
              <Chip key={l.league_id} label={l.name} on={mLeague === l.league_id} onPress={() => { tap(); loadMatchups(l.league_id); }} />
            ))}
          </ScrollView>
          {mLeague === null && <Card><Mono size={10} tone="faint">Pick a league.</Mono></Card>}
          {mLeague !== null && matchups === null && <Card><ActivityIndicator color={t.you} /></Card>}

          {/* pick readiness for the active week — the "is everyone in" read */}
          {!!ready?.length && (
            <Card style={{ marginBottom: 8 }}>
              <Mono size={9} tone="faint" track={0.12}>WEEK {ready[0].week} — PICKS IN?</Mono>
              {ready.map((r) => (
                <View key={r.matchup_id} style={{ paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
                  {([r.home, r.away] as const).map((s, i) => {
                    const short = s.picks_set < s.lineup_size;
                    return (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: t.text }}>
                          {s.team ?? `Roster ${s.roster_id}`}{s.controller === 'ai' ? ' 🤖' : ''}
                        </Text>
                        <Mono size={9.5} weight="700" tone={short ? 'warn' : 'you'}>
                          {s.picks_set}/{s.lineup_size}
                        </Mono>
                      </View>
                    );
                  })}
                </View>
              ))}
            </Card>
          )}

          {(matchups ?? []).map((m) => (
            <Card key={m.id} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 12.5, fontWeight: '700', color: t.text }}>Week {m.week}</Text>
                <Mono size={8.5} tone={m.status === 'live' ? 'you' : m.status === 'final' ? 'faint' : 'warn'} track={0.08}>
                  {m.status.toUpperCase()}
                </Mono>
                <View style={{ flex: 1 }} />
                {m.home_final != null && m.away_final != null && (
                  <Mono size={10} weight="700">{m.home_final}–{m.away_final}</Mono>
                )}
              </View>
              <Mono size={8.5} tone="faint" style={{ marginTop: 3 }}>
                rosters {m.home_roster_id} vs {m.away_roster_id}
                {m.lock_at ? ` · locks ${new Date(m.lock_at).toLocaleString()}` : ' · no lock_at'}
              </Mono>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <Chip label="OPEN" on={m.status === 'scheduled'} onPress={() => { tap(); void setStatus(m, 'scheduled'); }} />
                <Chip label="LOCK" on={m.status === 'live'} onPress={() => { tap(); void setStatus(m, 'live', true); }} />
                <Chip label="FINAL" on={m.status === 'final'} onPress={() => { tap(); void setStatus(m, 'final'); }} />
                <Chip label="↺ RESET" onPress={() => { tap(); resetMatchup(m); }} />
              </View>
            </Card>
          ))}
        </>
      )}

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
