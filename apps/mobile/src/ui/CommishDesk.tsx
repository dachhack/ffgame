// THE COMMISSIONER'S DESK (0320), for the thumb — the same six panels the web
// console grew in src/screens/CommishDesk.tsx, as bottom-sheet cards on the
// commissioner map: commissioners and a hand-over, the two locks, the waiver
// order, the median game, a final week's scores, and dues — plus 0321's trade
// floor. Each card loads its own state and saves on the tap.
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View, Alert } from 'react-native';
import {
  leagueCommissioners, addCommissioner, removeCommissioner, transferCommissioner, type CommissionerRow,
  rosterRules, commishSetWireLock, commishLockTeam, adminLeagueMembers, type AdminMember,
  nativeTeamState, commishSetWaiverPriority, commishSetMedianGame, commishSetTradeRules,
  type TradeReview,
  commishWeekScores, commishSetMatchupScore, type WeekScoreRow,
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
