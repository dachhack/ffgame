// THE COMMISSIONER'S DESK (0320), for the thumb — the same six panels the web
// console grew in src/screens/CommishDesk.tsx, as bottom-sheet cards on the
// commissioner map: commissioners and a hand-over, the two locks, the waiver
// order, the median game, a final week's scores, and dues — plus 0321's trade
// floor and 0339's weekly report. Each card loads its own state and saves on
// the tap.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, Alert } from 'react-native';
import {
  leagueCommissioners, addCommissioner, removeCommissioner, transferCommissioner, type CommissionerRow,
  rosterRules, commishSetWireLock, commishLockTeam, adminLeagueMembers, type AdminMember,
  nativeTeamState, commishSetWaiverPriority, commishSetMedianGame, commishSetTradeRules,
  leagueAwards, commishSetAward, commishDeleteAward, commishSetPublicApi, publicApiUrl, leaguePublicApi,
  leagueWriteApi, commishSetWriteApi,
  commishSetBadge, commishDeleteBadge, commishGrantBadge, commishRevokeBadge,
  type TradeReview, type LeagueAwards, type AwardDef,
  commishWeekScores, commishSetMatchupScore, type WeekScoreRow,
  leagueReportWeeks, commishRequestWeekReport, commishSetReportChat, type ReportWeek,
  commishRequestRescore, leagueRescoreState, leagueGameMode, type RescoreState,
  leagueWaiverHolds, commishSetWaiverHold, type HeldPlayer,
  leaguePlayerAdjustments, commishSetPlayerAdjustment, type PlayerAdjustment, type AdjustCandidate,
  commishWeekLineup, commishSetWeekLineup, type LineupFixCandidate,
  commishOpenSchedule, commishSwapOpponents, type RedrawWeek, type RedrawTeam,
  leagueDues, setLeagueDues, commishSetDuesPaid, type DuesRow,
  friendlyError,
} from '@drip/core/data/liveApi';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { copyText } from './copy';
import { Card, Chip, Mono, PrimaryButton } from './prims';
import { LabelInfo } from './InfoChip';
import { rescoreHeadline, autofillWarning, sideLine } from '@drip/core/data/rescore';
import { fixSlots, fixChosen, fixOptions, fixPayload, fixChanged, type FixSlot } from '@drip/core/data/lineupFix';

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
/** THE LEAGUE ID, COPYABLE (v0.462.0) — the web CopyId's twin.
 *
 *  Founder: "Where in the app and web UI can I find and easy copy the league
 *  Id?" On the phone it was worse than nowhere: the id showed only inside the
 *  public API URL, only while the league was PUBLISHED, as text the app had no
 *  clipboard to copy. Retyping 36 hex characters off a screen is not a
 *  feature. `selectable` as well as the button, so a long-press still works if
 *  the clipboard is refused. */
export function CopyIdRow({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const go = async () => {
    const ok = await copyText(leagueId);
    if (ok) { setDone(true); setTimeout(() => setDone(false), 1400); }
    else { setFailed(true); setTimeout(() => setFailed(false), 2600); }
  };
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono size={9} tone="faint" track={0.1}>LEAGUE ID</Mono>
        <View style={{ flex: 1 }} />
        <Chip label={done ? '✓ COPIED' : failed ? '⚠ LONG-PRESS IT' : '⧉ COPY'} on={done}
          onPress={() => { tap(); void go(); }} />
      </View>
      <Text selectable style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.you, marginTop: 4, lineHeight: 14 }}>{leagueId}</Text>
    </View>
  );
}

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
      {/* Not gated on the switch: a private league has an id too, and a
          commissioner about to publish needs it before the URL exists. */}
      <CopyIdRow leagueId={leagueId} />
      {on && <Mono size={8.5} tone="you" style={{ marginTop: 6 }}>{publicApiUrl(leagueId)}</Mono>}
      <Note msg={msg} />
    </Card>
  );
}

// ── THE WRITE API (0352) — the web's WriteApiPanel ──────────────────────────
export function WriteApiCard({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueWriteApi(leagueId).then((v) => setOn(v === true))
    .catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const flip = async () => {
    if (busy || on === null) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetWriteApi(leagueId, !on); if (r.ok) { commit(); setMsg('✓ saved'); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); } }
    catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const toggle = () => {
    if (on) { void flip(); return; }
    Alert.alert('Switch on the write API?',
      'Managers will be able to run their teams from outside tools. Each makes their own key, and a key can do only what its owner can.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Switch on', onPress: () => { void flip(); } }]);
  };
  return (
    <Card>
      <LabelInfo label="WRITE API" info={'Keyed control of the league from outside the app, the way ESPN\'s API works: set lineups, add and drop, file and cancel waiver claims, propose and answer trades. Each manager makes their own key under the league menu → 🔑 API keys, and a key acts as that person with exactly their powers — a TEAM key reaches only their own team. Your own LEAGUE-scope key also reaches every team and your tools: run waivers, approve or veto trades, move players, set the waiver order. Every write is logged, and you can revoke any key. Off stops every key at once; back on restores them.'} />
      <Row>
        <Chip label={on ? 'ON' : 'OFF'} on={on === true} disabled={busy || on === null}
          onPress={() => { tap(); toggle(); }} />
      </Row>
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
  // 0348: does the report ANNOUNCE itself in chat? Off stops the chat line and
  // nothing else — the week is still built, stored and openable.
  const [chatOn, setChatOn] = useState<boolean | null>(null);
  const [flipping, setFlipping] = useState(false);
  // 0353: the week whose RE-SCORE box is open; classic leagues only.
  const [rescoreWeek, setRescoreWeek] = useState<number | null>(null);
  const [classic, setClassic] = useState(false);
  useEffect(() => { leagueGameMode(leagueId).then((g) => setClassic(g.mode === 'classic')).catch(() => {}); }, [leagueId]);
  const load = () => leagueReportWeeks(leagueId).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    setWeeks(r.weeks ?? []);
    setChatOn(r.report_chat !== false);
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
  const toggleChat = async () => {
    if (flipping || chatOn === null) return;
    const on = !chatOn;
    setFlipping(true); setMsg(null);
    try {
      const r = await commishSetReportChat(leagueId, on);
      if (r.ok) { commit(); setChatOn(on); setMsg(on ? '✓ the report will post in chat' : '✓ written, but not posted in chat'); }
      else { warn(); setMsg(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setFlipping(false); void load(); }
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
      {/* 0348 · THE ANNOUNCEMENT IS OPTIONAL, THE RECORD IS NOT. Founder:
          "give the commish option to turn off reports posting in chat." OFF
          stops the weekly chat line only — the week is still written up and
          the report screen still opens it, so quieting a notification never
          stops recording the season. ↻ REPOST posts regardless: that is a
          person asking for this week on purpose. */}
      <Mono size={9} tone="faint" style={{ marginTop: 12 }}>POST THE REPORT IN CHAT</Mono>
      <Row>
        <Chip label={chatOn === null ? '…' : chatOn ? 'ON' : 'OFF'} on={chatOn === true}
          disabled={flipping || chatOn === null} onPress={() => { tap(); void toggleChat(); }} />
      </Row>
      <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: fs(13) }}>
        Off, the week is still written up and the report screen still opens it — it just doesn’t interrupt chat.
        Tapping ↻ REPOST below posts anyway, because that’s you asking.
      </Mono>
      {weeks == null && <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Loading…</Mono>}
      {weeks?.length === 0 && <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>No weeks with matchups yet.</Mono>}
      {weeks?.map((w) => {
        const block = blocker(w);
        const open = !!w.request && !w.request.done_at;
        const canRescore = classic && w.stamped > 0 && w.week_state.complete;
        return (
          <View key={w.week} style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mono size={10} weight="700">WEEK {w.week}</Mono>
              <View style={{ flex: 1 }} />
              {canRescore && (
                <Chip label="⟳ RE-SCORE · ✏️" on={rescoreWeek === w.week}
                  onPress={() => { tap(); setRescoreWeek(rescoreWeek === w.week ? null : w.week); }} />
              )}
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
            {/* 0345. NOT THE SAME ACCUSATION as `drifted`, and the one that
                catches a week that closed mid-game: these finals were
                computed before the week's last play landed. A repost
                faithfully repeats them — only a re-score changes the number,
                which since 0353 is the commissioner's ⟳ RE-SCORE in a classic
                league (a drip week cannot be rebuilt). */}
            {w.stale > 0 && (
              <Mono size={8.5} tone="warn" style={{ marginTop: 2, lineHeight: fs(12) }}>
                ⚠ {w.stale} final{w.stale === 1 ? ' was' : 's were'} scored BEFORE this week's last play arrived
                {w.scored_at && w.last_play_at
                  ? ` (scored ${new Date(w.scored_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, last play ${new Date(w.last_play_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
                  : ''}. Reposting repeats them — {classic ? 'tap ⟳ RE-SCORE to recompute them.' : 'a drip week can’t be re-scored after the fact.'}
              </Mono>
            )}
            {w.request?.error ? <Mono size={8.5} tone="opp" style={{ marginTop: 2 }}>⚠ last try: {w.request.error}</Mono> : null}
            {rescoreWeek === w.week && <RescoreBox leagueId={leagueId} week={w.week} onApplied={() => void load()} />}
          </View>
        );
      })}
      <Note msg={msg} />
    </Card>
  );
}

// ── WAIVER HOLDS (0354) — the web's WaiverHoldsPanel ────────────────────────
// The app has no date picker (a native module for one field is a new native
// dependency — see Draft.tsx), so "hold until" is a choice of how long from
// now; the web takes any moment inside the same two weeks.
const HOLD_DAYS = [1, 2, 3, 7] as const;
const etShort = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
  : '—');
export function WaiverHoldsCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [held, setHeld] = useState<HeldPlayer[] | null>(null);
  const [found, setFound] = useState<HeldPlayer[]>([]);
  const [nextRun, setNextRun] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = (search = q) => leagueWaiverHolds(leagueId, search.trim() || undefined).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    setHeld(r.held ?? []); setFound(r.found ?? []); setNextRun(r.next_run ?? null);
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const set = async (p: HeldPlayer, mode: 'free' | 'next_run' | 'until', days?: number) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const at = mode === 'until' && days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined;
      const r = await commishSetWaiverHold(leagueId, p.slug, mode, at);
      if (r.ok) { commit(); setMsg(`✓ ${r.note ?? 'saved'}`); setOpen(null); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const line = (p: HeldPlayer) => (
    <View key={p.slug} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingVertical: 7, gap: 5 }}>
      <Pressable onPress={() => { tap(); setOpen(open === p.slug ? null : p.slug); }}>
        <Text style={{ fontSize: fs(12.5), color: t.text }}>{p.name} <Text style={{ color: t.faint }}>{`${p.pos} · ${p.team}`}</Text></Text>
        <Mono size={8.5} tone={p.until ? 'warn' : 'faint'}>
          {`${p.until ? `on waivers until ${etShort(p.until)}` : 'free agent'}${p.claims ? ` · ${p.claims} claim${p.claims === 1 ? '' : 's'}` : ''}`}
        </Mono>
      </Pressable>
      {open === p.slug && (
        <Row>
          {!!p.until && <Chip label="FREE NOW" on={false} disabled={busy} onPress={() => { tap(); void set(p, 'free'); }} />}
          <Chip label="TO NEXT RUN" on={false} disabled={busy} onPress={() => { tap(); void set(p, 'next_run'); }} />
          {HOLD_DAYS.map((d) => (
            <Chip key={d} label={`+${d}D`} on={false} disabled={busy} onPress={() => { tap(); void set(p, 'until', d); }} />
          ))}
        </Row>
      )}
    </View>
  );
  return (
    <Card>
      <LabelInfo label="WAIVER HOLDS" info={`Free a player now, send him to waivers until the next run (${etShort(nextRun)}), or hold him for a day or more. Claims already on him wait for his new hold. Each change is posted in league chat. Tap a player for his options.`} />
      {held == null && <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Loading…</Mono>}
      {held?.length === 0 && <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Nobody is on waivers right now.</Mono>}
      {held?.map(line)}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => void load()} placeholder="find a free agent" placeholderTextColor={t.faint}
          style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, fontSize: fs(12.5), color: t.text }} />
        <Chip label="SEARCH" on={false} onPress={() => { tap(); void load(); }} />
      </View>
      {found.filter((p) => !(held ?? []).some((h) => h.slug === p.slug)).map(line)}
      <Note msg={msg} />
    </Card>
  );
}

// ── ⟳ RE-SCORE A WEEK (0353) — the web's RescoreBox ─────────────────────────
// PREVIEW changes nothing; APPLY confirms it, rewrites the finals, rebuilds the
// week's report and tells the league. The worker does the scoring.
function RescoreBox({ leagueId, week, onApplied }: { leagueId: string; week: number; onApplied: () => void }) {
  const t = useTheme();
  const [st, setSt] = useState<RescoreState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const last = useRef<RescoreState | null>(null);
  const load = () => leagueRescoreState(leagueId, week).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    const prev = last.current?.request;
    if (prev && !prev.done_at && r.request?.id === prev.id && r.request.done_at && r.request.apply) onApplied();
    last.current = r;
    setSt(r);
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId, week]);
  const req = st?.request ?? null;
  const running = !!req && !req.done_at;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (apply: boolean) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishRequestRescore(leagueId, week, apply);
      if (r.ok) { commit(); setMsg(`✓ ${r.note ?? 'queued'}`); } else { warn(); setMsg(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const ask = (apply: boolean) => {
    if (!apply) { void send(false); return; }
    Alert.alert(`Rewrite week ${week}'s scores?`,
      'Standings, the weekly report and the league chat will all show the new numbers.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Apply', style: 'destructive', onPress: () => { void send(true); } }]);
  };
  const res = req?.done_at && !req.error ? req.result : null;
  const moved = (res?.matchups ?? []).filter((m) => m.moved);
  const warning = req && !req.apply ? autofillWarning(res) : null;
  return (
    <View style={{ marginTop: 8, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, gap: 6 }}>
      <Mono size={8.5} tone="faint" style={{ lineHeight: fs(13) }}>
        {`Recompute week ${week} from the plays as they stand now, with the lineups your managers saved and today's scoring settings. Preview first — nothing changes until you apply.`}
      </Mono>
      <AdjustBox leagueId={leagueId} week={week} />
      <LineupFixBox leagueId={leagueId} week={week} />
      {running && <Mono size={9} tone="dim">{`⏳ ${req!.apply ? 'Applying' : 'Previewing'} — the worker picks this up within a minute…`}</Mono>}
      {req?.error ? <Mono size={9} tone="opp">{`⚠ Last ${req.apply ? 'apply' : 'preview'} failed: ${req.error}`}</Mono> : null}
      {res && (
        <View style={{ gap: 3 }}>
          <Mono size={9.5} weight="700">
            {`${req!.apply ? '✓ Applied. ' : 'Preview: '}${rescoreHeadline(res, req!.apply)}${req!.apply && res.report === 'rebuilt' ? ' The weekly report was rebuilt.' : ''}`}
          </Mono>
          {moved.map((m) => (
            <Mono key={m.id} size={9} tone={m.flipped ? 'warn' : 'text'} style={{ lineHeight: fs(13) }}>
              {`${sideLine(m.home_team || `Roster ${m.home_roster_id}`, m.was.home, m.now.home)}  vs  ${sideLine(m.away_team || `Roster ${m.away_roster_id}`, m.was.away, m.now.away)}${m.flipped ? (req!.apply ? '  · result changed' : '  · result would change') : ''}`}
            </Mono>
          ))}
          {warning && <Mono size={8.5} tone="warn" style={{ lineHeight: fs(13) }}>{`⚠ ${warning}`}</Mono>}
        </View>
      )}
      <Row>
        <Chip label={req && !req.apply && req.done_at ? '⟳ PREVIEW AGAIN' : '⟳ PREVIEW'} on={false}
          disabled={busy || running} onPress={() => { tap(); ask(false); }} />
        {st?.can_apply && !running && (
          <Chip label={`✓ APPLY — REWRITE WEEK ${week}`} on disabled={busy} onPress={() => { tap(); ask(true); }} />
        )}
      </Row>
      <Note msg={msg} />
    </View>
  );
}

// ── ✏️ POINT ADJUSTMENTS (0355) — the web's AdjustBox ───────────────────────
// Points on or off one player's week, with the reason the league reads. Saved
// at once and counted by every board; a finished week's finals follow when it
// is re-scored just below.
function AdjustBox({ leagueId, week }: { leagueId: string; week: number }) {
  const t = useTheme();
  const [rows, setRows] = useState<PlayerAdjustment[] | null>(null);
  const [found, setFound] = useState<AdjustCandidate[]>([]);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ slug: string; name: string } | null>(null);
  const [pts, setPts] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = (search?: string) => leaguePlayerAdjustments(leagueId, week, search?.trim() || undefined).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    setRows(r.adjustments ?? []); setFound(r.found ?? []);
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId, week]);
  const save = async (slug: string, points: number, note: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetPlayerAdjustment(leagueId, week, slug, points, note);
      if (!r.ok) { warn(); setMsg(friendlyError(r.error ?? 'failed')); return; }
      commit();
      setMsg(`✓ saved${r.rescore ? ` — week ${week}'s finals change when you re-score it below` : ''}`);
      setPick(null); setPts(''); setWhy(''); setFound([]); setQ('');
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const n = Number(pts);
  const input = { borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, fontSize: fs(12.5), color: t.text } as const;
  return (
    <View style={{ gap: 6, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.bd }}>
      <Mono size={9.5} weight="700" tone="dim">{`✏️ POINT ADJUSTMENTS · WEEK ${week}`}</Mono>
      <Mono size={8.5} tone="faint" style={{ lineHeight: fs(13) }}>
        Add or take points from one player for this week — a stat correction, a ruling. It counts wherever his points count (a starting spot, not the bench), every board shows it with your reason, and the league chat is told.
      </Mono>
      {rows?.map((a) => (
        <View key={a.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontSize: fs(12), color: t.text }}>
            {a.name}<Text style={{ fontWeight: '700', color: a.points > 0 ? t.you : t.warn }}>{` ${a.points > 0 ? '+' : ''}${a.points}`}</Text>
            <Text style={{ color: t.faint }}>{` — ${a.note}`}</Text>
          </Text>
          <Chip label="REMOVE" on={false} disabled={busy} onPress={() => { tap(); void save(a.slug, 0, ''); }} />
        </View>
      ))}
      {pick ? (
        <View style={{ gap: 6 }}>
          <Mono size={10} weight="700">{pick.name}</Mono>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={pts} onChangeText={setPts} placeholder="+6 or -2" placeholderTextColor={t.faint}
              keyboardType="numbers-and-punctuation" style={{ ...input, width: 80 }} />
            <TextInput value={why} onChangeText={setWhy} placeholder="why — the league sees this" placeholderTextColor={t.faint}
              maxLength={200} style={{ ...input, flex: 1 }} />
          </View>
          <Row>
            <Chip label="SAVE" on disabled={busy || !Number.isFinite(n) || n === 0 || !why.trim()}
              onPress={() => { tap(); void save(pick.slug, n, why); }} />
            <Chip label="CANCEL" on={false} onPress={() => { tap(); setPick(null); }} />
          </Row>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => void load(q)} placeholder="find a player to adjust"
            placeholderTextColor={t.faint} style={{ ...input, flex: 1 }} />
          <Chip label="SEARCH" on={false} onPress={() => { tap(); void load(q); }} />
        </View>
      )}
      {!pick && found.map((p) => (
        <Pressable key={p.slug} onPress={() => {
          tap(); const had = rows?.find((a) => a.slug === p.slug);
          setPick(p); setPts(had ? String(had.points) : ''); setWhy(had?.note ?? '');
        }} style={{ paddingVertical: 6 }}>
          <Text style={{ fontSize: fs(12), color: t.text }}>
            {p.name}<Text style={{ color: t.faint }}>{` ${p.pos} · ${p.team}${p.owner ? ` · ${p.owner}` : ' · free agent'}  ›`}</Text>
          </Text>
        </Pressable>
      ))}
      <Note msg={msg} />
    </View>
  );
}

// ── 🧾 FIX A LINEUP (0356) — the web's LineupFixBox ─────────────────────────
// One seat's lineup for this week past the kickoff locks. Tap a spot for the
// seat's own players who fit it; a reason is required and the league is told.
function LineupFixBox({ leagueId, week }: { leagueId: string; week: number }) {
  const t = useTheme();
  const [teams, setTeams] = useState<{ roster_id: number; name: string }[] | null>(null);
  const [rid, setRid] = useState<number | null>(null);
  const [slots, setSlots] = useState<FixSlot[]>([]);
  const [cands, setCands] = useState<LineupFixCandidate[]>([]);
  const [raw, setRaw] = useState<{ slot: string; slug: string | null }[]>([]);
  const [stored, setStored] = useState<Record<string, string | null>>({});
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [author, setAuthor] = useState(true);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setTeams(null); setRid(null);
    commishWeekLineup(leagueId, week).then((r) => { if (r.ok) setTeams(r.teams ?? []); else setMsg(friendlyError(r.error ?? 'could not load')); })
      .catch((e) => setMsg(friendlyError(e)));
    leagueGameMode(leagueId).then((gm) => { if (gm.ok) setSlots(fixSlots(gm)); }).catch(() => {});
  }, [leagueId, week]);
  // The stored rows meet the league's spots once both have loaded.
  useEffect(() => { const c = fixChosen(slots, raw); setStored(c); setChosen(c); }, [slots, raw]);
  const open = (r: number | null) => {
    setRid(r); setMsg(null); setOpenSlot(null);
    if (r == null) return;
    commishWeekLineup(leagueId, week, r).then((x) => {
      if (!x.ok) { setMsg(friendlyError(x.error ?? 'could not load')); return; }
      setCands(x.candidates ?? []); setRaw(x.stored ?? []); setAuthor(x.has_author !== false);
    }).catch((e) => setMsg(friendlyError(e)));
  };
  const save = async () => {
    if (busy || rid == null) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetWeekLineup(leagueId, week, rid, fixPayload(slots, chosen), why);
      if (!r.ok) { warn(); setMsg(friendlyError(r.error ?? 'failed')); return; }
      commit(); setWhy('');
      setMsg(`✓ saved${r.rescore ? ` — week ${week}'s finals change when you re-score it below` : ''}`);
      open(rid);
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const nameOf = (slug: string | null) => (slug ? cands.find((c) => c.slug === slug)?.name ?? slug : '— empty —');
  const changed = fixChanged(slots, stored, chosen);
  return (
    <View style={{ gap: 6, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.bd }}>
      <Mono size={9.5} weight="700" tone="dim">{`🧾 FIX A LINEUP · WEEK ${week}`}</Mono>
      <Mono size={8.5} tone="faint" style={{ lineHeight: fs(13) }}>
        Set a team's lineup for this week past the kickoff locks — the start an app never saved, a ruling your league made. Only that team's own players that week are offered. The league sees who came in, who went out, and your reason.
      </Mono>
      {teams == null && <Mono size={9} tone="faint">Loading…</Mono>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(teams ?? []).map((tm) => (
          <Chip key={tm.roster_id} label={tm.name} on={rid === tm.roster_id} onPress={() => { tap(); open(rid === tm.roster_id ? null : tm.roster_id); }} />
        ))}
      </View>
      {rid != null && !author && <Mono size={9} tone="faint">This seat has nobody to field a lineup for — its lineup is computed from its roster.</Mono>}
      {rid != null && author && slots.map((s) => {
        const cur = chosen[s.slot] ?? null;
        const moved = cur !== (stored[s.slot] ?? null);
        return (
          <View key={s.slot}>
            <Pressable disabled={s.bestball} onPress={() => { tap(); setOpenSlot(openSlot === s.slot ? null : s.slot); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 }}>
              <Mono size={9.5} tone="faint" style={{ width: 56 }}>{s.name}</Mono>
              <Text style={{ flex: 1, fontSize: fs(12), color: s.bestball ? t.faint : t.text, fontWeight: moved ? '700' : '400' }}>
                {s.bestball ? '🎯 best ball — fills itself' : `${nameOf(cur)}  ›`}
              </Text>
            </Pressable>
            {openSlot === s.slot && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 64, paddingBottom: 6 }}>
                <Chip label="EMPTY" on={cur == null} onPress={() => { tap(); setChosen({ ...chosen, [s.slot]: null }); setOpenSlot(null); }} />
                {fixOptions(slots, s.slot, cands, chosen).map((c) => (
                  <Chip key={c.slug} on={cur === c.slug}
                    label={`${c.name} · ${c.pos}${c.spot && c.spot !== 'active' ? ` · ${c.spot.toUpperCase()}` : ''}${c.why === 'left' ? ' · since left' : ''}`}
                    onPress={() => { tap(); setChosen({ ...chosen, [s.slot]: c.slug }); setOpenSlot(null); }} />
                ))}
              </View>
            )}
          </View>
        );
      })}
      {rid != null && author && (
        <View style={{ gap: 6 }}>
          <TextInput value={why} onChangeText={setWhy} placeholder="why — the league sees this" placeholderTextColor={t.faint} maxLength={200}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, fontSize: fs(12.5), color: t.text }} />
          <Row>
            <Chip label="SAVE LINEUP" on disabled={busy || !changed || !why.trim()} onPress={() => { tap(); void save(); }} />
            {changed && <Chip label="RESET" on={false} onPress={() => { tap(); setChosen(stored); }} />}
          </Row>
        </View>
      )}
      <Note msg={msg} />
    </View>
  );
}

// ── 🔀 REDRAW A WEEK (0357) — the web's SchedulePanel ───────────────────────
export function ScheduleCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [weeks, setWeeks] = useState<RedrawWeek[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [pick, setPick] = useState<RedrawTeam[]>([]);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => commishOpenSchedule(leagueId).then((r) => {
    if (!r.ok) { setMsg(friendlyError(r.error ?? 'could not load')); return; }
    const ws = r.weeks ?? [];
    setWeeks(ws);
    setWeek((w) => (w != null && ws.some((x) => x.week === w) ? w : ws[0]?.week ?? null));
  }).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const wk = weeks?.find((w) => w.week === week) ?? null;
  const toggle = (x: RedrawTeam) => {
    setMsg(null);
    if (pick.some((p) => p.roster_id === x.roster_id)) setPick(pick.filter((p) => p.roster_id !== x.roster_id));
    else setPick(pick.length >= 2 ? [x] : [...pick, x]);
  };
  const swap = async () => {
    if (busy || pick.length !== 2 || week == null) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSwapOpponents(leagueId, week, pick[0].roster_id, pick[1].roster_id, why);
      if (!r.ok) { warn(); setMsg(friendlyError(r.error ?? 'failed')); return; }
      commit(); setMsg(`✓ ${r.note ?? 'swapped'}`); setPick([]); setWhy('');
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const team = (x: RedrawTeam) => (
    <Chip key={x.roster_id} label={x.name} on={pick.some((p) => p.roster_id === x.roster_id)} onPress={() => { tap(); toggle(x); }} />
  );
  return (
    <Card>
      <LabelInfo label="REDRAW A WEEK" info="Swap two teams' opponents in a week that hasn't kicked off: tap one team, then the other. A team on bye can be swapped in, and the other team takes the bye. Saved lineups follow their team. Playoff weeks follow the seeds and aren't listed. Each change is posted in league chat." />
      {weeks == null && <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Loading…</Mono>}
      {weeks?.length === 0 && <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>No week is open to redraw — every scheduled week has started, or there's no schedule yet.</Mono>}
      {!!weeks?.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {weeks.map((w) => <Chip key={w.week} label={`WK ${w.week}`} on={w.week === week} onPress={() => { tap(); setWeek(w.week); setPick([]); }} />)}
        </View>
      )}
      <View style={{ gap: 6, marginTop: 8 }}>
        {wk?.games.map((g) => (
          <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {team(g.home)}<Mono size={9} tone="faint">vs</Mono>{team(g.away)}
          </View>
        ))}
        {!!wk?.byes.length && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">BYE</Mono>{wk.byes.map(team)}
          </View>
        )}
      </View>
      {pick.length === 2 && (
        <View style={{ gap: 6, marginTop: 10 }}>
          <Mono size={10} weight="700">{`Swap ${pick[0].name} ⇄ ${pick[1].name}`}</Mono>
          <TextInput value={why} onChangeText={setWhy} placeholder="why — the league sees this" placeholderTextColor={t.faint} maxLength={200}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, fontSize: fs(12.5), color: t.text }} />
          <Row><Chip label="SWAP" on disabled={busy || !why.trim()} onPress={() => { tap(); void swap(); }} /></Row>
        </View>
      )}
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
