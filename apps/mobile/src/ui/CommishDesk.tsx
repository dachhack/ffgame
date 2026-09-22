// THE COMMISSIONER'S DESK (0320), for the thumb — the same six panels the web
// console grew in src/screens/CommishDesk.tsx, as bottom-sheet cards on the
// commissioner map: commissioners and a hand-over, the two locks, the waiver
// order, the median game, a final week's scores, and dues — plus 0321's trade
// floor and 0339's weekly report. Each card loads its own state and saves on
// the tap.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View, Alert } from 'react-native';
import {
  leagueCommissioners, addCommissioner, removeCommissioner, transferCommissioner, type CommissionerRow,
  rosterRules, commishSetWireLock, commishLockTeam, adminLeagueMembers, type AdminMember,
  nativeTeamState, commishSetWaiverPriority, commishSetMedianGame, commishSetTradeRules,
  leagueAwards, commishSetAward, commishDeleteAward, commishSetPublicApi, publicApiUrl, leaguePublicApi,
  commishSetBadge, commishDeleteBadge, commishGrantBadge, commishRevokeBadge,
  type TradeReview, type LeagueAwards, type AwardDef,
  commishWeekScores, commishSetMatchupScore, type WeekScoreRow,
  leagueReportWeeks, commishRequestWeekReport, type ReportWeek,
  leagueDues, setLeagueDues, commishSetDuesPaid, type DuesRow,
  friendlyError,
} from '@drip/core/data/liveApi';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono, PrimaryButton } from './prims';
import { LabelInfo } from './InfoChip';

function inputStyle(t: ReturnType<typeof useTheme>, width = 90) {
  return { width, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: fs(13), color: t.text, backgroundColor: t.bg } as const;
}
const Row = ({ children }: { children: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>{children}</View>
);
const Note = ({ msg }: { msg: string | null }) => msg ? <Mono size={9.5} tone={msg.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5 }}>{msg}</Mono> : null;

// ── Commissioners ────────────────────────────────────────────────────────────
export function CommissionersCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [primary, setPrimary] = useState<CommissionerRow | null>(null);
  const [co, setCo] = useState<CommissionerRow[]>([]);
  const [isPrimary, setIsPrimary] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueCommissioners(leagueId).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    setPrimary(r.primary ?? null); setCo(r.co ?? []); setIsPrimary(r.you_are_primary === true);
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await f(); if (r.ok) { commit(); setMsg(done); setEmail(''); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  return (
    <Card>
      <LabelInfo label="COMMISSIONERS" info={'A co-commissioner can do everything on this map except add or remove commissioners, hand the league over, or delete it.\n\nAn account must exist before it can be added. Handing over keeps you on as a co-commissioner.'} />
      <Mono size={10} tone="text" style={{ marginTop: 8 }}>👑 {primary?.name ?? primary?.email ?? '—'} <Mono size={9} tone="faint">· commissioner</Mono></Mono>
      {co.map((c) => (
        <View key={c.app_user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <Mono size={10} tone="text" style={{ flex: 1 }}>{c.name ?? c.email ?? c.app_user_id.slice(0, 8)} <Mono size={9} tone="faint">· co-commissioner</Mono></Mono>
          {isPrimary && (
            <Chip label="👑 HAND OVER" onPress={() => {
              tap();
              Alert.alert('Hand the league over?', `${c.name ?? c.email} becomes the commissioner. You stay on as a co-commissioner.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Hand over', style: 'destructive', onPress: () => void run(() => transferCommissioner(leagueId, c.app_user_id), '✓ handed over') },
              ]);
            }} />
          )}
          <Chip label="✕" onPress={() => { tap(); void run(() => removeCommissioner(leagueId, c.app_user_id), '✓ removed'); }} />
        </View>
      ))}
      {isPrimary && (
        <Row>
          <TextInput value={email} onChangeText={setEmail} placeholder="cocommish@email.com" placeholderTextColor={t.faint}
            autoCapitalize="none" keyboardType="email-address" style={{ ...inputStyle(t, 200) }} />
          <Chip label="＋ ADD" on disabled={busy || !email.trim()} onPress={() => { tap(); void run(() => addCommissioner(leagueId, email.trim()), '✓ added'); }} />
        </Row>
      )}
      <Note msg={msg} />
    </Card>
  );
}

// ── Locks ────────────────────────────────────────────────────────────────────
export function LocksCard({ leagueId }: { leagueId: string }) {
  const [wire, setWire] = useState<boolean | null>(null);
  const [locked, setLocked] = useState<number[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => Promise.all([
    rosterRules(leagueId).then((r) => { if (r.ok) { setWire(r.wire_lock === true); setLocked(r.locked_rosters ?? []); } }),
    adminLeagueMembers(leagueId).then((m) => setMembers(Array.isArray(m) ? m : [])),
  ]).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const toggleWire = async () => {
    if (busy || wire === null) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetWireLock(leagueId, !wire); if (r.ok) { commit(); setMsg(wire ? '✓ wire reopened' : '✓ wire locked'); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const toggleTeam = async (rid: number) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await commishLockTeam(leagueId, rid, !locked.includes(rid)); if (r.ok) commit(); else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  return (
    <Card>
      <LabelInfo label="LOCKS" info={'The league-wide lock shuts every add, drop and claim — the worker\'s too. Your own force-moves under PLAYERS still work.\n\nA locked team cannot add, drop, claim, or offer and accept trades.'} />
      <Row>
        <Chip label={wire ? '🔒 ALL FA & WAIVER MOVES LOCKED' : '🔓 FA & WAIVER MOVES OPEN'} on={wire === true} disabled={busy || wire === null} onPress={() => { tap(); void toggleWire(); }} />
      </Row>
      <Mono size={9} tone="faint" style={{ marginTop: 10 }}>LOCK A TEAM</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
        {members.map((m) => (
          <Chip key={m.roster_id} label={`${locked.includes(m.roster_id) ? '🔒 ' : ''}${m.team ?? `Roster ${m.roster_id}`}`} on={locked.includes(m.roster_id)} disabled={busy}
            onPress={() => { tap(); void toggleTeam(m.roster_id); }} />
        ))}
      </View>
      <Note msg={msg} />
    </Card>
  );
}

// ── Waiver order + the median game ───────────────────────────────────────────
export function WaiverOrderCard({ leagueId }: { leagueId: string }) {
  const [order, setOrder] = useState<{ roster_id: number; team: string | null }[] | null>(null);
  const [init, setInit] = useState('');
  const [median, setMedian] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => Promise.all([
    nativeTeamState(leagueId).then((s) => {
      const rows = [...(s.waiver_order ?? [])].sort((a, b) => (a.priority ?? 1e9) - (b.priority ?? 1e9) || a.roster_id - b.roster_id)
        .map((r) => ({ roster_id: r.roster_id, team: r.team }));
      setOrder(rows); setInit(JSON.stringify(rows.map((r) => r.roster_id)));
    }),
    rosterRules(leagueId).then((r) => { if (r.ok) setMedian(r.median_game === true); }),
  ]).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const move = (i: number, d: -1 | 1) => {
    if (!order) return;
    const j = i + d; if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; setOrder(next);
  };
  const changed = !!order && JSON.stringify(order.map((r) => r.roster_id)) !== init;
  const save = async () => {
    if (busy || !order || !changed) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetWaiverPriority(leagueId, order.map((r) => r.roster_id)); if (r.ok) { commit(); setMsg('✓ order saved'); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const toggleMedian = async () => {
    if (busy || median === null) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetMedianGame(leagueId, !median); if (r.ok) { commit(); setMsg('✓ saved'); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  return (
    <Card>
      <LabelInfo label="WAIVER ORDER" info={'First pick first. In a reverse-standings league the order is recomputed at every run; in FAAB it only breaks ties.'} />
      {!order ? <Mono size={10} tone="faint" style={{ marginTop: 8 }}>Loading…</Mono> : order.map((r, i) => (
        <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <Mono size={10} tone="faint" style={{ width: 18 }}>{i + 1}</Mono>
          <Mono size={10} tone="text" style={{ flex: 1 }}>{r.team ?? `Roster ${r.roster_id}`}</Mono>
          <Chip label="▲" disabled={i === 0} onPress={() => { tap(); move(i, -1); }} a11y="move up" />
          <Chip label="▼" disabled={i === order.length - 1} onPress={() => { tap(); move(i, 1); }} a11y="move down" />
        </View>
      ))}
      <View style={{ marginTop: 10 }}>
        <PrimaryButton label={busy ? '…' : changed ? 'SAVE ORDER' : 'SAVED'} disabled={busy || !changed} onPress={() => void save()} />
      </View>
      <Mono size={9} tone="faint" style={{ marginTop: 14 }}>EXTRA GAME VS THE LEAGUE MEDIAN</Mono>
      <Row>
        <Chip label={median ? 'ON' : 'OFF'} on={median === true} disabled={busy || median === null} onPress={() => { tap(); void toggleMedian(); }} />
      </Row>
      <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: fs(13) }}>
        Every regular-season week each team also plays the league's median score: above it a win, below it a loss. Points are untouched.
      </Mono>
      <Note msg={msg} />
    </Card>
  );
}

// ── The public read API (0326, opened by default in 0327) ────────────────────
// One switch, and what it turns OFF. Off means 404 — the API cannot even be
// used to confirm the league exists.
export function PublicApiCard({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // `league_public_api`, not `roster_rules`: the latter is native-only and
  // left this switch dead on every imported league (v0.456.0).
  const load = () => leaguePublicApi(leagueId).then((v) => setOn(v === true))
    .catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const toggle = async () => {
    if (busy || on === null) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetPublicApi(leagueId, !on); if (r.ok) { commit(); setMsg('✓ saved'); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  return (
    <Card>
      <LabelInfo label="PUBLIC READ API" info={'Published — the default — means anyone holding this league\'s link can read it: settings, rosters, standings, scores, the register, completed trades, the draft, history and awards, with no login. There is no directory, so this means "if you have the link", not "listed anywhere". Never served either way: hidden picks before they reveal, pending waiver bids, trade offers in flight, emails, invite codes and chat. Make it private and every endpoint returns a 404. Imported leagues start private.'} />
      <Row>
        <Chip label={on ? 'PUBLISHED' : 'PRIVATE'} on={on === true} disabled={busy || on === null}
          onPress={() => { tap(); void toggle(); }} />
      </Row>
      {on && <Mono size={8.5} tone="you" style={{ marginTop: 6 }}>{publicApiUrl(leagueId)}</Mono>}
      <Note msg={msg} />
    </Card>
  );
}

// ── The league's own awards and badges (0325) ────────────────────────────────
// Three choices make an award — what it measures, which end wins, and whether
// it only counts a win or a loss. Between them they cover every award a league
// has ever invented, including "highest score that still lost", which is the
// one every league writes into its group chat and no platform lets it write
// down. A league that configures nothing runs four built-ins; the first save
// writes them down so renaming one does not delete the others.
const AW_METRICS: [AwardDef['metric'], string][] = [
  ['points', 'THEIR SCORE'], ['points_against', 'GAVE UP'],
  ['margin', 'MARGIN'], ['combined', 'GAME TOTAL'],
];
const AW_ONLYS: [AwardDef['only_result'], string][] = [['any', 'ANY'], ['win', 'A WIN'], ['loss', 'A LOSS']];

export function AwardsCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<LeagueAwards | null>(null);
  const [teams, setTeams] = useState<{ roster_id: number; team: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newAward, setNewAward] = useState({ name: '', icon: '🏅' });
  const [newBadge, setNewBadge] = useState({ name: '', icon: '🎖' });
  const [pinOn, setPinOn] = useState<Record<string, number | null>>({});
  const load = () => Promise.all([
    leagueAwards(leagueId).then((r) => { if (!r.error) setSt(r); else setMsg(friendlyError(r.error)); }),
    nativeTeamState(leagueId).then((x) => setTeams((x.waiver_order ?? []).map((w) => ({ roster_id: w.roster_id, team: w.team })))),
  ]).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, done = '✓ saved') => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await f(); if (r.ok) { commit(); setMsg(done); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const awards = st?.awards ?? [];
  const badges = st?.badges ?? [];
  const grants = st?.grants ?? [];
  const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return (
    <Card>
      <LabelInfo label="WEEKLY AWARDS" info={'Three choices make an award: what it measures, which end of it wins, and whether it only counts a win or a loss. "Highest score that still lost" is THEIR SCORE · MOST · A LOSS. Handed out when every game of a week is final, and announced in chat.'} />
      {awards.some((a) => a.is_default) && (
        <Mono size={8.5} tone="faint" style={{ marginTop: 4, lineHeight: fs(13) }}>
          These four are the built-ins. Change any of them and they become yours.
        </Mono>
      )}
      {awards.map((a) => (
        <View key={a.key} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 6, marginTop: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: fs(15) }}>{a.icon}</Text>
            <TextInput defaultValue={a.name} key={`${a.key}-${a.name}`}
              onEndEditing={(e) => { const v = e.nativeEvent.text.trim(); if (v && v !== a.name) void run(() => commishSetAward(leagueId, a.key, { name: v })); }}
              style={{ ...inputStyle(t, 150), flex: 1 }} />
            <Chip label={a.direction === 'high' ? 'MOST' : 'LEAST'} on={a.direction === 'high'}
              onPress={() => { tap(); void run(() => commishSetAward(leagueId, a.key, { direction: a.direction === 'high' ? 'low' : 'high' })); }} />
            <Chip label="✕" disabled={busy} onPress={() => { tap(); Alert.alert(`Retire ${a.name}?`, 'Past wins stay on the record; it stops being handed out.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retire', style: 'destructive', onPress: () => void run(() => commishDeleteAward(leagueId, a.key), '✓ retired') },
            ]); }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            {AW_METRICS.map(([m, label]) => (
              <Chip key={m} label={label} on={a.metric === m}
                onPress={() => { tap(); void run(() => commishSetAward(leagueId, a.key, { metric: m })); }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            {AW_ONLYS.map(([o, label]) => (
              <Chip key={o} label={label} on={a.only_result === o}
                onPress={() => { tap(); void run(() => commishSetAward(leagueId, a.key, { onlyResult: o })); }} />
            ))}
            <Mono size={8.5} tone="faint">PRIZE</Mono>
            <TextInput defaultValue={String(a.coin ?? 0)} key={`${a.key}-coin-${a.coin}`} keyboardType="number-pad"
              onEndEditing={(e) => { const n = Number(e.nativeEvent.text.replace(/[^0-9]/g, '')) || 0; if (n !== a.coin) void run(() => commishSetAward(leagueId, a.key, { coin: n })); }}
              style={inputStyle(t, 60)} />
          </View>
        </View>
      ))}
      <Row>
        <TextInput value={newAward.icon} onChangeText={(v) => setNewAward({ ...newAward, icon: v })} placeholder="🏅"
          placeholderTextColor={t.faint} style={inputStyle(t, 48)} />
        <TextInput value={newAward.name} onChangeText={(v) => setNewAward({ ...newAward, name: v })} placeholder="The Brown Jug"
          placeholderTextColor={t.faint} style={{ ...inputStyle(t, 150), flex: 1 }} />
        <Chip label="＋ ADD" on disabled={busy || !newAward.name.trim()}
          onPress={() => { tap(); void run(async () => {
            const r = await commishSetAward(leagueId, slug(newAward.name), { name: newAward.name.trim(), icon: newAward.icon.trim() || '🏅' });
            if (r.ok) setNewAward({ name: '', icon: '🏅' });
            return r;
          }, '✓ added'); }} />
      </Row>

      <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 16 }}>BADGES</Mono>
      {badges.map((b) => (
        <View key={b.key} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 6, marginTop: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: fs(15) }}>{b.icon}</Text>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12), color: t.text }}>{b.name}</Text>
            <Chip label="✕" disabled={busy} onPress={() => { tap(); Alert.alert(`Delete ${b.name}?`, 'Everyone holding it loses it.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void run(() => commishDeleteBadge(leagueId, b.key), '✓ deleted') },
            ]); }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            {teams.map((x) => (
              <Chip key={x.roster_id} label={x.team ?? `Team ${x.roster_id}`} on={pinOn[b.key] === x.roster_id}
                onPress={() => { tap(); setPinOn({ ...pinOn, [b.key]: x.roster_id }); }} />
            ))}
            <Chip label="PIN" on disabled={busy || pinOn[b.key] == null}
              onPress={() => { tap(); const rid = pinOn[b.key]; if (rid != null) void run(() => commishGrantBadge(leagueId, rid, b.key), '✓ pinned'); }} />
          </View>
        </View>
      ))}
      {grants.map((g) => (
        <View key={`${g.key}-${g.roster_id}-${g.season}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11), color: t.dim }}>{g.icon} {g.name} · {g.team} · {g.season}</Text>
          <Chip label="take it back" onPress={() => { tap(); void run(() => commishRevokeBadge(leagueId, g.roster_id, g.key, g.season), '✓ taken back'); }} />
        </View>
      ))}
      <Row>
        <TextInput value={newBadge.icon} onChangeText={(v) => setNewBadge({ ...newBadge, icon: v })} placeholder="🐐"
          placeholderTextColor={t.faint} style={inputStyle(t, 48)} />
        <TextInput value={newBadge.name} onChangeText={(v) => setNewBadge({ ...newBadge, name: v })} placeholder="The GOAT"
          placeholderTextColor={t.faint} style={{ ...inputStyle(t, 150), flex: 1 }} />
        <Chip label="＋ ADD" on disabled={busy || !newBadge.name.trim()}
          onPress={() => { tap(); void run(async () => {
            const r = await commishSetBadge(leagueId, slug(newBadge.name), { name: newBadge.name.trim(), icon: newBadge.icon.trim() || '🎖' });
            if (r.ok) setNewBadge({ name: '', icon: '🎖' });
            return r;
          }, '✓ added'); }} />
      </Row>
      <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(13) }}>
        Each badge is stamped with the season it was earned, so the same one can be won again next year. They ride every manager's line in 🏛 League history.
      </Mono>
      <Note msg={msg} />
    </Card>
  );
}

// ── The trade floor (0321) ───────────────────────────────────────────────────
// Who rules on a trade, and — where that is the league — how long the vote runs
// and how many vetoes kill it; how long an offer stands by default; and whether
// FAAB may ride a deal. The vote's numbers stay hidden until the league votes,
// because a window and a bar mean nothing under commissioner review.
export function TradeFloorCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [review, setReview] = useState<TradeReview | null>(null);
  const [hours, setHours] = useState('');
  const [votes, setVotes] = useState('');          // '' = a majority of the teams outside the trade
  const [days, setDays] = useState('');
  const [faab, setFaab] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => rosterRules(leagueId).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    setReview((r.trade_review as TradeReview) ?? 'none');
    setHours(String(r.trade_review_hours ?? 24));
    setVotes(r.trade_veto_votes_set == null ? '' : String(r.trade_veto_votes_set));
    setDays(String(r.trade_offer_days ?? 0));
    setFaab(r.faab_trading !== false);
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, done = '✓ saved') => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await f(); if (r.ok) { commit(); setMsg(done); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const modes: [TradeReview, string][] = [['none', 'NOBODY'], ['commish', 'COMMISSIONER'], ['league', 'THE LEAGUE']];
  return (
    <Card>
      <LabelInfo label="TRADE REVIEW" info={'With the league voting, an accepted trade waits out its window while every team outside it may veto or allow. It dies the moment the vetoes reach the bar and goes through as soon as they cannot. You can still rule over a vote in progress.'} />
      <Row>
        {modes.map(([m, lbl]) => (
          <Chip key={m} label={lbl} on={review === m} disabled={busy || review === null}
            onPress={() => { tap(); void run(() => commishSetTradeRules(leagueId, m)); }} />
        ))}
      </Row>
      {review === 'league' && (
        <Row>
          <Mono size={9} tone="faint">VOTE RUNS</Mono>
          <TextInput value={hours} keyboardType="number-pad" onChangeText={(v) => setHours(v.replace(/[^0-9]/g, ''))} style={inputStyle(t, 60)} />
          <Mono size={9} tone="faint">HOURS · VETOES</Mono>
          <TextInput value={votes} keyboardType="number-pad" placeholder="majority" placeholderTextColor={t.faint}
            onChangeText={(v) => setVotes(v.replace(/[^0-9]/g, ''))} style={inputStyle(t, 84)} />
          <Chip label="SAVE" on disabled={busy}
            onPress={() => { tap(); void run(() => commishSetTradeRules(leagueId, null, Number(hours) || 24, votes.trim() === '' ? -1 : Number(votes))); }} />
        </Row>
      )}
      <Mono size={9} tone="faint" style={{ marginTop: 14 }}>AN OFFER STANDS</Mono>
      <Row>
        <TextInput value={days} keyboardType="number-pad" onChangeText={(v) => setDays(v.replace(/[^0-9]/g, ''))} style={inputStyle(t, 60)} />
        <Mono size={9} tone="faint">DAYS (0 = UNTIL ANSWERED)</Mono>
        <Chip label="SAVE" on disabled={busy}
          onPress={() => { tap(); void run(() => commishSetTradeRules(leagueId, null, null, null, Number(days) || 0)); }} />
      </Row>
      <Mono size={9} tone="faint" style={{ marginTop: 14 }}>FAAB DOLLARS MAY BE TRADED</Mono>
      <Row>
        <Chip label={faab ? 'ON' : 'OFF'} on={faab === true} disabled={busy || faab === null}
          onPress={() => { tap(); void run(() => commishSetTradeRules(leagueId, null, null, null, null, !faab)); }} />
      </Row>
      <Note msg={msg} />
    </Card>
  );
}

// ── Scores ───────────────────────────────────────────────────────────────────
export function ScoresCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [week, setWeek] = useState<number | null>(null);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [rows, setRows] = useState<WeekScoreRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { h: string; a: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = (w: number | null) => commishWeekScores(leagueId, w ?? 1).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    const ws = r.weeks ?? []; setWeeks(ws);
    const cur = w ?? ws[0] ?? 1;
    if (w == null && ws.length) { setWeek(cur); if (cur !== 1) { void load(cur); return; } }
    setRows(r.matchups ?? []);
    const d: Record<string, { h: string; a: string }> = {};
    for (const m of r.matchups ?? []) d[m.matchup_id] = { h: m.home_final == null ? '' : String(m.home_final), a: m.away_final == null ? '' : String(m.away_final) };
    setDraft(d);
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const save = async (m: WeekScoreRow) => {
    if (busy) return;
    const d = draft[m.matchup_id]; const h = Number(d?.h), a = Number(d?.a);
    if (!Number.isFinite(h) || !Number.isFinite(a)) { setMsg('both scores are needed'); return; }
    setBusy(true); setMsg(null);
    try { const r = await commishSetMatchupScore(m.matchup_id, h, a); if (r.ok) { commit(); setMsg(`✓ week ${week} saved`); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(week); }
  };
  return (
    <Card>
      <LabelInfo label="EDIT SCORES" info={'Only a final week\'s scores can be edited. Standings follow at once and the league chat is told. A playoff round already drawn is not re-drawn.'} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {weeks.map((w) => <Chip key={w} label={`WK ${w}`} on={week === w} onPress={() => { tap(); setWeek(w); void load(w); }} />)}
      </View>
      {rows.map((m) => {
        const final = m.status === 'final';
        const d = draft[m.matchup_id] ?? { h: '', a: '' };
        const dirty = d.h !== (m.home_final == null ? '' : String(m.home_final)) || d.a !== (m.away_final == null ? '' : String(m.away_final));
        return (
          <View key={m.matchup_id} style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8 }}>
            <Mono size={9.5} tone="text">{m.home ?? m.home_roster_id} <Mono size={9} tone="faint">vs</Mono> {m.away ?? m.away_roster_id}{m.is_playoff ? ' 🏆' : ''}{final ? '' : ` · ${m.status}`}</Mono>
            <Row>
              <TextInput value={d.h} editable={final} keyboardType="decimal-pad" onChangeText={(v) => setDraft({ ...draft, [m.matchup_id]: { ...d, h: v } })} style={{ ...inputStyle(t, 80), textAlign: 'right' }} />
              <Mono size={10} tone="faint">–</Mono>
              <TextInput value={d.a} editable={final} keyboardType="decimal-pad" onChangeText={(v) => setDraft({ ...draft, [m.matchup_id]: { ...d, a: v } })} style={{ ...inputStyle(t, 80) }} />
              {final && <Chip label="SAVE" on={dirty} disabled={busy || !dirty} onPress={() => { tap(); void save(m); }} />}
            </Row>
          </View>
        );
      })}
      <Note msg={msg} />
    </Card>
  );
}

// ── The weekly report, reposted (0339) ───────────────────────────────────────
// The web panel's twin (src/screens/CommishDesk.tsx WeeklyReportPanel), same
// two RPCs and the same rule: one line per week, the button live only when
// that week can honestly be posted, and posting again REPLACES the chat line
// rather than adding a second one.
export function WeeklyReportCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [weeks, setWeeks] = useState<ReportWeek[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueReportWeeks(leagueId).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    setWeeks(r.weeks ?? []);
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  // A queued request is a minute from posting; poll so the line flips in front
  // of whoever tapped it rather than leaving them unsure it took.
  const pending = (weeks ?? []).some((w) => w.request && !w.request.done_at);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (w: ReportWeek) => {
    if (busy != null) return;
    setBusy(w.week); setMsg(null);
    try {
      const r = await commishRequestWeekReport(leagueId, w.week);
      if (r.ok) { commit(); setMsg(`✓ week ${w.week}: ${r.note ?? 'queued'}`); }
      else { warn(); setMsg(friendlyError(r.error ?? 'could not post')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(null); void load(); }
  };
  const blocker = (w: ReportWeek): string | null => {
    if (w.stamped === 0) return 'no finals stamped yet';
    if (!w.week_state.complete) {
      return w.week_state.live > 0
        ? `${w.week_state.live} game${w.week_state.live === 1 ? '' : 's'} still on`
        : `feed holds ${w.week_state.feed} of ${w.week_state.slate} games`;
    }
    return null;
  };
  return (
    <Card>
      <LabelInfo label="WEEKLY REPORT" info={'Build a week\u2019s report from the finals as they stand and post it into league chat. Posting a week again REPLACES its chat line rather than adding a second one, so it is safe to tap twice. A week still being played is refused \u2014 a report built mid-game freezes those scores, which is how a week went out wrong once.'} />
      {weeks == null && <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Loading…</Mono>}
      {weeks?.length === 0 && <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>No weeks with matchups yet.</Mono>}
      {weeks?.map((w) => {
        const block = blocker(w);
        const open = !!w.request && !w.request.done_at;
        return (
          <View key={w.week} style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mono size={10} weight="700">WEEK {w.week}</Mono>
              <View style={{ flex: 1 }} />
              <Chip label={busy === w.week ? '…' : open ? '⏳ QUEUED' : w.posted_at ? '↻ REPOST' : '📋 POST'}
                on={!block && !open} disabled={busy != null || !!block || open}
                onPress={() => { tap(); void post(w); }} />
            </View>
            <Mono size={8.5} tone="faint" style={{ marginTop: 3, lineHeight: fs(12) }}>
              {w.stamped}/{w.matchups} stamped
              {w.posted_at
                ? ` · posted ${new Date(w.posted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                : ' · never posted'}
              {block ? ` · ${block}` : ''}
            </Mono>
            {w.drifted > 0 && (
              <Mono size={8.5} tone="warn" style={{ marginTop: 2, lineHeight: fs(12) }}>
                ⚠ {w.drifted} stored final{w.drifted === 1 ? '' : 's'} differ from the live scoring — a stamp taken early, or a score you edited by hand. The report repeats what is stored.
              </Mono>
            )}
            {w.request?.error ? <Mono size={8.5} tone="opp" style={{ marginTop: 2 }}>⚠ last try: {w.request.error}</Mono> : null}
          </View>
        );
      })}
      <Note msg={msg} />
    </Card>
  );
}

// ── Dues ─────────────────────────────────────────────────────────────────────
export function DuesCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [amount, setAmount] = useState('');
  const [dnote, setDnote] = useState('');
  const [teams, setTeams] = useState<DuesRow[]>([]);
  const [init, setInit] = useState<{ amount: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueDues(leagueId).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    const a = r.amount == null ? '' : String(r.amount); const n = r.note ?? '';
    setAmount(a); setDnote(n); setInit({ amount: a, note: n }); setTeams(r.teams ?? []);
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const changed = !!init && (amount !== init.amount || dnote !== init.note);
  const save = async () => {
    if (busy || !changed) return;
    setBusy(true); setMsg(null);
    try { const r = await setLeagueDues(leagueId, amount === '' ? null : Number(amount), dnote); if (r.ok) { commit(); setMsg('✓ dues saved'); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const flip = async (d: DuesRow) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetDuesPaid(leagueId, d.roster_id, !d.paid); if (r.ok) commit(); else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const paid = teams.filter((d) => d.paid).length;
  return (
    <Card>
      <LabelInfo label={`LEAGUE DUES${teams.length ? ` — ${paid}/${teams.length} PAID` : ''}`} info={'Every member can see the tracker. Leave the amount blank to hide it.'} />
      <Row>
        <Mono size={9} tone="faint">$</Mono>
        <TextInput value={amount} keyboardType="number-pad" onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} placeholder="0" placeholderTextColor={t.faint} style={{ ...inputStyle(t, 70) }} />
        <TextInput value={dnote} onChangeText={setDnote} placeholder="how to pay — Venmo @…, by week 1" placeholderTextColor={t.faint} style={{ ...inputStyle(t, 200) }} />
      </Row>
      <View style={{ marginTop: 8 }}>
        <PrimaryButton label={busy ? '…' : changed ? 'SAVE DUES' : 'SAVED'} disabled={busy || !changed} onPress={() => void save()} />
      </View>
      {teams.map((d) => (
        <View key={d.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Mono size={10} tone="text" style={{ flex: 1 }}>{d.team ?? `Roster ${d.roster_id}`}{!d.enrolled ? <Mono size={9} tone="faint"> · empty seat</Mono> : null}</Mono>
          {d.paid && d.paid_at ? <Mono size={9} tone="faint">{new Date(d.paid_at).toLocaleDateString()}</Mono> : null}
          <Chip label={d.paid ? '✓ PAID' : 'UNPAID'} on={d.paid} disabled={busy} onPress={() => { tap(); void flip(d); }} />
        </View>
      ))}
      <Note msg={msg} />
    </Card>
  );
}
