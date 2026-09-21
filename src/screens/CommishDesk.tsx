// THE COMMISSIONER'S DESK (0320) — the six Sleeper commissioner powers the
// console lacked, each as its own small panel so the tab that owns it can
// place it beside what it already shows:
//   · CommissionersPanel — co-commissioners and a hand-over (SEATS)
//   · LocksPanel         — the league-wide wire lock and per-team locks (SEATS)
//   · WaiverOrderPanel   — the waiver order, set at once (WAIVERS & TRADES)
//   · MedianGamePanel    — the extra game against the league median (same)
//   · TradeFloorPanel    — 0321: the review mode, the vote and the offer clock (same)
//   · ScoresPanel        — a final week's scores, edited by hand (MATCHUPS)
//   · DuesPanel          — dues, and who has paid (SEATS)
// Every panel loads its own state and saves on the click, the way the pick-
// trading switch does: none of these are drafts of a change.
import { useEffect, useState } from 'react';
import { mono, linkBtn, btn, inp, subhead, errMsg } from './adminUi';
import {
  leagueCommissioners, addCommissioner, removeCommissioner, transferCommissioner, type CommissionerRow,
  rosterRules, commishSetWireLock, commishLockTeam, type AdminMember,
  nativeTeamState, commishSetWaiverPriority, commishSetMedianGame, commishSetTradeRules,
  type TradeReview,
  commishWeekScores, commishSetMatchupScore, type WeekScoreRow,
  leagueDues, setLeagueDues, commishSetDuesPaid, type DuesRow,
} from '@drip/core/data/liveApi';

const note = (msg: string | null) => msg && (
  <span className="mono" style={{ ...mono, fontSize: 11.5, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{msg}</span>
);
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' };
const cell: React.CSSProperties = { ...mono, fontSize: 12.5, color: 'var(--text)', flex: 1 };
const small: React.CSSProperties = { ...mono, fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5, maxWidth: 520 };

// ── Commissioners ────────────────────────────────────────────────────────────
export function CommissionersPanel({ leagueId }: { leagueId: string }) {
  const [primary, setPrimary] = useState<CommissionerRow | null>(null);
  const [co, setCo] = useState<CommissionerRow[]>([]);
  const [isPrimary, setIsPrimary] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueCommissioners(leagueId).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    setPrimary(r.primary ?? null); setCo(r.co ?? []); setIsPrimary(r.you_are_primary === true);
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await f(); setMsg(r.ok ? done : r.error ?? 'failed'); if (r.ok) setEmail(''); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>COMMISSIONERS</div>
      <div style={row}>
        <span style={cell}>👑 {primary?.name ?? primary?.email ?? '—'} <span style={{ color: 'var(--faint)' }}>· commissioner</span></span>
      </div>
      {co.map((c) => (
        <div key={c.app_user_id} style={row}>
          <span style={cell}>{c.name ?? c.email ?? c.app_user_id.slice(0, 8)} <span style={{ color: 'var(--faint)' }}>· co-commissioner</span></span>
          {isPrimary && (
            <button disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}
              onClick={() => { if (window.confirm(`Hand the league to ${c.name ?? c.email}? You stay on as a co-commissioner.`)) void run(() => transferCommissioner(leagueId, c.app_user_id), '✓ handed over'); }}>
              👑 hand over
            </button>
          )}
          <button disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}
            onClick={() => void run(() => removeCommissioner(leagueId, c.app_user_id), '✓ removed')}>✕ remove</button>
        </div>
      ))}
      {isPrimary ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cocommish@email.com"
            onKeyDown={(e) => { if (e.key === 'Enter') void run(() => addCommissioner(leagueId, email.trim()), '✓ added'); }}
            style={{ ...inp, fontSize: 13, padding: '5px 7px', width: 220 }} />
          <button onClick={() => void run(() => addCommissioner(leagueId, email.trim()), '✓ added')} disabled={busy || !email.trim()}
            className="mono" style={{ ...btn(true), opacity: busy || !email.trim() ? 0.6 : 1 }}>＋ add commissioner</button>
          {note(msg)}
        </div>
      ) : <div style={{ marginTop: 6 }}>{note(msg)}</div>}
      <div style={{ ...small, marginTop: 6 }}>A co-commissioner can do everything on this console except add or remove commissioners, hand the league over, or delete it. An account must exist before it can be added.</div>
    </div>
  );
}

// ── Locks ────────────────────────────────────────────────────────────────────
export function LocksPanel({ leagueId, members }: { leagueId: string; members: AdminMember[] }) {
  const [wire, setWire] = useState<boolean | null>(null);
  const [locked, setLocked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => rosterRules(leagueId).then((r) => { if (r.ok) { setWire(r.wire_lock === true); setLocked(r.locked_rosters ?? []); } }).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  const toggleWire = async () => {
    if (busy || wire === null) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetWireLock(leagueId, !wire); setMsg(r.ok ? (wire ? '✓ wire reopened' : '✓ wire locked') : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  const toggleTeam = async (rid: number) => {
    if (busy) return;
    const on = !locked.includes(rid);
    setBusy(true); setMsg(null);
    try { const r = await commishLockTeam(leagueId, rid, on); if (!r.ok) setMsg(r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>LOCKS</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => void toggleWire()} disabled={busy || wire === null} className="mono" style={btn(wire === true)}>
          {wire ? '🔒 ALL FREE AGENT & WAIVER MOVES LOCKED' : '🔓 FREE AGENT & WAIVER MOVES OPEN'}
        </button>
        {note(msg)}
      </div>
      <div style={{ ...small, marginTop: 6 }}>The league-wide lock shuts every add, drop and claim, including the worker's. Your own force-moves on the ROSTERS tab still work. A locked team also cannot offer or accept a trade.</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        {members.map((m) => {
          const on = locked.includes(m.roster_id);
          return (
            <button key={m.roster_id} onClick={() => void toggleTeam(m.roster_id)} disabled={busy} className="mono"
              style={{ ...btn(on), fontSize: 11.5, padding: '4px 9px' }} title={on ? 'Unlock this team' : 'Lock this team'}>
              {on ? '🔒 ' : ''}{m.team ?? `Roster ${m.roster_id}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Waiver order ─────────────────────────────────────────────────────────────
export function WaiverOrderPanel({ leagueId }: { leagueId: string }) {
  const [order, setOrder] = useState<{ roster_id: number; team: string | null }[] | null>(null);
  const [init, setInit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => nativeTeamState(leagueId).then((t) => {
    const rows = [...(t.waiver_order ?? [])].sort((a, b) => (a.priority ?? 1e9) - (b.priority ?? 1e9) || a.roster_id - b.roster_id)
      .map((r) => ({ roster_id: r.roster_id, team: r.team }));
    setOrder(rows); setInit(JSON.stringify(rows.map((r) => r.roster_id)));
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  if (!order) return <div style={{ marginTop: 14 }}>{note(msg) ?? <span className="mono" style={small}>loading the order…</span>}</div>;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; setOrder(next);
  };
  const changed = JSON.stringify(order.map((r) => r.roster_id)) !== init;
  const save = async () => {
    if (busy || !changed) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetWaiverPriority(leagueId, order.map((r) => r.roster_id)); setMsg(r.ok ? '✓ order saved' : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>WAIVER ORDER</div>
      {order.map((r, i) => (
        <div key={r.roster_id} style={row}>
          <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', width: 22 }}>{i + 1}</span>
          <span style={cell}>{r.team ?? `Roster ${r.roster_id}`}</span>
          <button onClick={() => move(i, -1)} disabled={i === 0} className="mono" style={{ ...linkBtn, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
          <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="mono" style={{ ...linkBtn, opacity: i === order.length - 1 ? 0.3 : 1 }}>▼</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button onClick={() => void save()} disabled={busy || !changed} className="mono" style={{ ...btn(true), opacity: busy || !changed ? 0.6 : 1 }}>SAVE ORDER</button>
        {note(msg)}
      </div>
      <div style={{ ...small, marginTop: 6 }}>First pick first. In a reverse-standings league the order is recomputed at every run; in FAAB it only breaks ties.</div>
    </div>
  );
}

// ── The median game ──────────────────────────────────────────────────────────
export function MedianGamePanel({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => rosterRules(leagueId).then((r) => { if (r.ok) setOn(r.median_game === true); }).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  const toggle = async () => {
    if (busy || on === null) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetMedianGame(leagueId, !on); setMsg(r.ok ? '✓ saved' : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>EXTRA GAME AGAINST THE LEAGUE MEDIAN</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => void toggle()} disabled={busy || on === null} className="mono" style={btn(on === true)}>{on ? 'ON' : 'OFF'}</button>
        {note(msg)}
      </div>
      <div style={{ ...small, marginTop: 6 }}>Every regular-season week each team also plays the league's median score: above it a win, below it a loss. Points for and against are untouched. Standings recompute the moment this changes.</div>
    </div>
  );
}

// ── The trade floor (0321) ───────────────────────────────────────────────────
// Four knobs that only make sense beside each other: who rules on a trade, and
// — where that is the league — how long the vote runs and how many vetoes kill
// it; how long an offer stands by default; and whether FAAB may ride a deal.
// The vote's two numbers are hidden while nobody votes, because a window and a
// bar mean nothing under commissioner review.
export function TradeFloorPanel({ leagueId }: { leagueId: string }) {
  const [review, setReview] = useState<TradeReview | null>(null);
  const [hours, setHours] = useState('');
  const [votes, setVotes] = useState('');          // '' = a majority of the teams outside the trade
  const [days, setDays] = useState('');
  const [faab, setFaab] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => rosterRules(leagueId).then((r) => {
    if (r.error) { setMsg(r.error); return; }
    setReview((r.trade_review as TradeReview) ?? 'none');
    setHours(String(r.trade_review_hours ?? 24));
    setVotes(r.trade_veto_votes_set == null ? '' : String(r.trade_veto_votes_set));
    setDays(String(r.trade_offer_days ?? 0));
    setFaab(r.faab_trading !== false);
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, done = '✓ saved') => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await f(); setMsg(r.ok ? done : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  const modes: [TradeReview, string][] = [['none', 'NOBODY'], ['commish', 'COMMISSIONER'], ['league', 'THE LEAGUE VOTES']];
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>TRADE REVIEW</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {modes.map(([m, lbl]) => (
          <button key={m} onClick={() => void run(() => commishSetTradeRules(leagueId, m))} disabled={busy || review === null}
            className="mono" style={btn(review === m)}>{lbl}</button>
        ))}
        {note(msg)}
      </div>
      {review === 'league' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>vote runs</span>
          <input value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ ...inp, fontSize: 13, padding: '5px 7px', width: 56 }} />
          <span style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>hours · vetoes needed</span>
          <input value={votes} placeholder="majority" onChange={(e) => setVotes(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ ...inp, fontSize: 13, padding: '5px 7px', width: 80 }} />
          <button onClick={() => void run(() => commishSetTradeRules(leagueId, null, Number(hours) || 24,
            votes.trim() === '' ? -1 : Number(votes)))} disabled={busy} className="mono" style={btn(true)}>save</button>
        </div>
      )}
      <div style={{ ...subhead, marginTop: 12 }}>OFFERS</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>an offer stands</span>
        <input value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))}
          style={{ ...inp, fontSize: 13, padding: '5px 7px', width: 56 }} />
        <span style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>days (0 = until it is answered)</span>
        <button onClick={() => void run(() => commishSetTradeRules(leagueId, null, null, null, Number(days) || 0))}
          disabled={busy} className="mono" style={btn(true)}>save</button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>FAAB dollars may be traded</span>
        <button onClick={() => void run(() => commishSetTradeRules(leagueId, null, null, null, null, !faab))}
          disabled={busy || faab === null} className="mono" style={btn(faab === true)}>{faab ? 'ON' : 'OFF'}</button>
      </div>
      <div style={{ ...small, marginTop: 6 }}>With the league voting, an accepted trade waits out its window while every team outside it may veto or allow. It dies the moment the vetoes reach the bar, and goes through as soon as they cannot. You can still rule over a vote in progress. FAAB trading applies to FAAB leagues only.</div>
    </div>
  );
}

// ── Scores ───────────────────────────────────────────────────────────────────
export function ScoresPanel({ leagueId }: { leagueId: string }) {
  const [week, setWeek] = useState<number | null>(null);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [rows, setRows] = useState<WeekScoreRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { h: string; a: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = (w: number | null) => commishWeekScores(leagueId, w ?? 1).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    const ws = r.weeks ?? []; setWeeks(ws);
    const cur = w ?? ws[0] ?? 1;
    if (w == null && ws.length) { setWeek(cur); if (cur !== 1) { void load(cur); return; } }
    setRows(r.matchups ?? []);
    const d: Record<string, { h: string; a: string }> = {};
    for (const m of r.matchups ?? []) d[m.matchup_id] = { h: m.home_final == null ? '' : String(m.home_final), a: m.away_final == null ? '' : String(m.away_final) };
    setDraft(d);
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { void load(null); /* eslint-disable-next-line */ }, [leagueId]);
  const save = async (m: WeekScoreRow) => {
    if (busy) return;
    const d = draft[m.matchup_id]; const h = Number(d?.h), a = Number(d?.a);
    if (!Number.isFinite(h) || !Number.isFinite(a)) { setMsg('both scores are needed'); return; }
    setBusy(true); setMsg(null);
    try { const r = await commishSetMatchupScore(m.matchup_id, h, a); setMsg(r.ok ? `✓ week ${week} saved` : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); void load(week); }
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>EDIT SCORES</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={week ?? ''} onChange={(e) => { const w = Number(e.target.value); setWeek(w); void load(w); }} style={{ ...inp, padding: '5px 7px', fontSize: 13 }}>
          {weeks.map((w) => <option key={w} value={w}>week {w}</option>)}
        </select>
        {note(msg)}
      </div>
      {rows.map((m) => {
        const final = m.status === 'final';
        const d = draft[m.matchup_id] ?? { h: '', a: '' };
        const dirty = d.h !== (m.home_final == null ? '' : String(m.home_final)) || d.a !== (m.away_final == null ? '' : String(m.away_final));
        return (
          <div key={m.matchup_id} style={row}>
            <span style={{ ...cell, flex: 2 }}>{m.home ?? m.home_roster_id}{m.is_playoff ? ' 🏆' : ''}</span>
            <input value={d.h} disabled={!final} onChange={(e) => setDraft({ ...draft, [m.matchup_id]: { ...d, h: e.target.value } })} style={{ ...inp, width: 64, padding: '4px 6px', fontSize: 13, textAlign: 'right' }} />
            <span className="mono" style={{ ...mono, color: 'var(--faint)' }}>–</span>
            <input value={d.a} disabled={!final} onChange={(e) => setDraft({ ...draft, [m.matchup_id]: { ...d, a: e.target.value } })} style={{ ...inp, width: 64, padding: '4px 6px', fontSize: 13 }} />
            <span style={{ ...cell, flex: 2 }}>{m.away ?? m.away_roster_id}</span>
            {final
              ? <button onClick={() => void save(m)} disabled={busy || !dirty} className="mono" style={{ ...btn(dirty), fontSize: 11.5, padding: '4px 9px', opacity: busy || !dirty ? 0.6 : 1 }}>save</button>
              : <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)' }}>{m.status}</span>}
          </div>
        );
      })}
      <div style={{ ...small, marginTop: 6 }}>Only a final week's scores can be edited. Standings follow at once; the league chat is told. A playoff round already drawn is not re-drawn.</div>
    </div>
  );
}

// ── Dues ─────────────────────────────────────────────────────────────────────
export function DuesPanel({ leagueId }: { leagueId: string }) {
  const [amount, setAmount] = useState('');
  const [dnote, setDnote] = useState('');
  const [teams, setTeams] = useState<DuesRow[]>([]);
  const [init, setInit] = useState<{ amount: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueDues(leagueId).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    const a = r.amount == null ? '' : String(r.amount); const n = r.note ?? '';
    setAmount(a); setDnote(n); setInit({ amount: a, note: n }); setTeams(r.teams ?? []);
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  const changed = init && (amount !== init.amount || dnote !== init.note);
  const save = async () => {
    if (busy || !changed) return;
    setBusy(true); setMsg(null);
    try { const r = await setLeagueDues(leagueId, amount === '' ? null : Number(amount), dnote); setMsg(r.ok ? '✓ dues saved' : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  const flip = async (t: DuesRow) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetDuesPaid(leagueId, t.roster_id, !t.paid); if (!r.ok) setMsg(r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  const paid = teams.filter((t) => t.paid).length;
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>LEAGUE DUES{teams.length ? ` — ${paid}/${teams.length} PAID` : ''}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--dim)' }}>$</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="0" style={{ ...inp, width: 70, padding: '5px 7px', fontSize: 13 }} />
        <input value={dnote} onChange={(e) => setDnote(e.target.value)} placeholder="how to pay — Venmo @…, by week 1" style={{ ...inp, width: 260, padding: '5px 7px', fontSize: 13 }} />
        <button onClick={() => void save()} disabled={busy || !changed} className="mono" style={{ ...btn(true), opacity: busy || !changed ? 0.6 : 1 }}>save</button>
        {note(msg)}
      </div>
      {teams.map((t) => (
        <div key={t.roster_id} style={row}>
          <span style={cell}>{t.team ?? `Roster ${t.roster_id}`}{!t.enrolled && <span style={{ color: 'var(--faint)' }}> · empty seat</span>}</span>
          {t.paid && t.paid_at && <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)' }}>{new Date(t.paid_at).toLocaleDateString()}</span>}
          <button onClick={() => void flip(t)} disabled={busy} className="mono" style={{ ...btn(t.paid), fontSize: 11.5, padding: '4px 9px' }}>{t.paid ? '✓ PAID' : 'UNPAID'}</button>
        </div>
      ))}
      <div style={{ ...small, marginTop: 6 }}>Every member can see the tracker. Leave the amount blank to hide it.</div>
    </div>
  );
}
