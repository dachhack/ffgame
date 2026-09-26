// THE COMMISSIONER'S DESK (0320) — the six Sleeper commissioner powers the
// console lacked, each as its own small panel so the tab that owns it can
// place it beside what it already shows:
//   · CommissionersPanel — co-commissioners and a hand-over (SEATS)
//   · LocksPanel         — the league-wide wire lock and per-team locks (SEATS)
//   · WaiverOrderPanel   — the waiver order, set at once (WAIVERS & TRADES)
//   · MedianGamePanel    — the extra game against the league median (same)
//   · TradeFloorPanel    — 0321: the review mode, the vote and the offer clock (same)
//   · AwardsPanel        — 0325: the league's own weekly awards and badges (ENGAGE)
//   · PublicApiPanel     — 0326: publish this league to the anonymous read API,
//                          and 0462: the league id itself, click to copy (same)
//   · ScoresPanel        — a final week's scores, edited by hand (MATCHUPS)
//   · WeeklyReportPanel  — 0339: repost any week's report into chat (same)
//   · DuesPanel          — dues, and who has paid (SEATS)
// Every panel loads its own state and saves on the click, the way the pick-
// trading switch does: none of these are drafts of a change.
import { useEffect, useRef, useState } from 'react';
import { mono, linkBtn, btn, inp, subhead, errMsg } from './adminUi';
import { rescoreHeadline, autofillWarning, sideLine } from '@drip/core/data/rescore';
import { fixSlots, fixChosen, fixOptions, fixPayload, fixChanged, type FixSlot } from '@drip/core/data/lineupFix';
import {
  leagueCommissioners, addCommissioner, removeCommissioner, transferCommissioner, type CommissionerRow,
  rosterRules, leaguePublicApi, commishSetWireLock, commishLockTeam, type AdminMember,
  nativeTeamState, commishSetWaiverPriority, commishSetMedianGame, commishSetTradeRules,
  leagueAwards, commishSetAward, commishDeleteAward, commishSetPublicApi, publicApiUrl,
  leagueWriteApi, commishSetWriteApi,
  commishSetBadge, commishDeleteBadge, commishGrantBadge, commishRevokeBadge,
  type TradeReview, type LeagueAwards, type AwardDef,
  commishWeekScores, commishSetMatchupScore, type WeekScoreRow,
  leagueReportWeeks, commishRequestWeekReport, commishSetReportChat, type ReportWeek,
  commishRequestRescore, leagueRescoreState, leagueGameMode, type RescoreState,
  leaguePlayerAdjustments, commishSetPlayerAdjustment, type PlayerAdjustment, type AdjustCandidate,
  commishWeekLineup, commishSetWeekLineup, type LineupFixCandidate,
  commishOpenSchedule, commishSwapOpponents, type RedrawWeek, type RedrawTeam,
  scoreAsIsState, commishBackdateSeason, commishScoreAsIs, playedWeekName, scoreAsIsLine, type ScoreAsIsState,
  leagueTxnLimits, commishSetTxnLimits,
  leagueWaiverHolds, commishSetWaiverHold, type HeldPlayer,
  leagueDues, setLeagueDues, commishSetDuesPaid, type DuesRow,
} from '@drip/core/data/liveApi';
import { weekTitle, weekName } from '@drip/core/data/nflSlate';

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

// ── 📏 TRANSACTION LIMITS (0358) ─────────────────────────────────────────────
// Three optional caps, blank = none. The week turns at the league's turnover
// (the after-games waiver run), so a weekly cap resets when the week does.
// A commissioner's own moves never count, and drops are never limited.
export function TxnLimitsPanel({ leagueId }: { leagueId: string }) {
  const [wk, setWk] = useState('');
  const [sn, setSn] = useState('');
  const [tr, setTr] = useState('');
  const [init, setInit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const str = (n: number | null | undefined) => (n == null ? '' : String(n));
  const load = () => leagueTxnLimits(leagueId).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    setWk(str(r.max_adds_week)); setSn(str(r.max_adds_season)); setTr(str(r.max_trades_season));
    setInit([str(r.max_adds_week), str(r.max_adds_season), str(r.max_trades_season)].join('|'));
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))) || null);
  const save = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await commishSetTxnLimits(leagueId, num(wk), num(sn), num(tr)); setMsg(r.ok ? '✓ saved — the league was told' : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); void load(); }
  };
  const field = (label: string, v: string, set: (x: string) => void) => (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input value={v} onChange={(e) => set(e.target.value.replace(/[^0-9]/g, ''))} placeholder="none" inputMode="numeric"
        style={{ ...inp, width: 56, padding: '4px 6px', fontSize: 12.5 }} />
      <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)' }}>{label}</span>
    </label>
  );
  const changed = init != null && [wk, sn, tr].join('|') !== init;
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>TRANSACTION LIMITS</div>
      <div style={{ ...small, marginBottom: 6 }}>
        Cap each team's pickups (free agents and waiver wins) per week and per season, and its trades per season. Leave a box
        empty for no limit. The week turns at your league's weekly waiver run. Your own commissioner moves never count, an
        undone move gives its add back, and drops are never limited. A waiver claim over the limit when the run reaches it is lost, with the reason.
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {field('adds / week', wk, setWk)}
        {field('adds / season', sn, setSn)}
        {field('trades / season', tr, setTr)}
        <button onClick={() => void save()} disabled={busy || !changed} className="mono" style={btn(changed)}>save</button>
        {note(msg)}
      </div>
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

// ── The public read API (0326, opened by default in 0327) ────────────────────
// One switch, and the URL it turns off. Off means 404 — the API cannot even be
// used to confirm the league exists.
/** THE LEAGUE ID, COPYABLE (v0.462.0).
 *
 *  Founder: "Where in the app and web UI can I find and easy copy the league
 *  Id?" Nowhere, was the answer. It appeared in exactly one place — inside the
 *  public API URL below — as plain text, only while the league was PUBLISHED,
 *  and the league route is `#/live` with no id in it, so the address bar did
 *  not have it either. Anyone pointing a spreadsheet, a Discord bot or a
 *  rankings site at their league was reading 36 characters off a screen.
 *
 *  Not gated on the switch: a private league has an id too, and a commissioner
 *  who is about to publish needs it before the URL exists. */
export function CopyId({ leagueId }: { leagueId: string }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(leagueId); setDone(true); setFailed(false); setTimeout(() => setDone(false), 1400); }
    // No clipboard (an insecure origin, a locked-down browser): say so rather
    // than flashing "copied ✓" over nothing. The id is on screen either way.
    catch { setFailed(true); setTimeout(() => setFailed(false), 2600); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="mono" style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', color: 'var(--dim)' }}>LEAGUE ID</span>
      <span className="mono" onClick={() => void copy()} title="click to copy"
        style={{ ...mono, fontSize: 11.5, fontWeight: 700, color: 'var(--you)', cursor: 'pointer', wordBreak: 'break-all' }}>{leagueId}</span>
      <button onClick={() => void copy()} className="mono" style={{ ...btn(false), padding: '2px 8px', fontSize: 10.5 }}>
        {done ? '✓ copied' : failed ? '⚠ select it by hand' : '⧉ copy'}
      </button>
    </div>
  );
}

export function PublicApiPanel({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // `league_public_api`, not `roster_rules`: the latter is native-only and
  // left this switch dead on every imported league (v0.456.0).
  const load = () => leaguePublicApi(leagueId).then((v) => setOn(v === true))
    .catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  const base = publicApiUrl(leagueId);
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>PUBLIC READ API</div>
      <div style={{ marginBottom: 8 }}><CopyId leagueId={leagueId} /></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => { if (busy || on === null) return; setBusy(true); setMsg(null);
          commishSetPublicApi(leagueId, !on).then((r) => setMsg(r.ok ? '✓ saved' : r.error ?? 'failed'))
            .catch((e) => setMsg(errMsg(e, 'failed')))
            .finally(() => { setBusy(false); load(); }); }}
          disabled={busy || on === null} className="mono" style={btn(on === true)}>{on ? 'PUBLISHED' : 'PRIVATE'}</button>
        {on && <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>tap to make this league private</span>}
        {note(msg)}
      </div>
      {on && (
        <div className="mono" style={{ ...small, marginTop: 6, wordBreak: 'break-all', color: 'var(--you)' }}>{base}</div>
      )}
      <div style={{ ...small, marginTop: 6 }}>
        Published — the default — means anyone holding this league's link can read it: settings, rosters, standings, scores, the register, completed trades, the draft, history and awards, with no login, from anything that can make a web request. It is how rankings sites, spreadsheets and Discord bots plug in. There is no directory: a league is readable only by whoever has its id, so this means "if you have the link", not "listed anywhere". Never served either way: hidden picks before they reveal, pending waiver bids, trade offers in flight, email addresses, invite codes and chat. Make it private and every endpoint returns a 404 identical to a league that does not exist. Leagues imported from Sleeper, ESPN or Yahoo start private — they are a mirror of somebody else's system, not ours to publish.
      </div>
    </div>
  );
}

// ── THE WRITE API (0352) — the commissioner's opt-in ────────────────────────
// Off by default, for every league. On, every manager may mint a key under
// ⚙ → 🔑 API keys that lets an outside tool act as them; off, every key in the
// league stops on its next call and starts again when this goes back on.
export function WriteApiPanel({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueWriteApi(leagueId).then((v) => setOn(v === true))
    .catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>WRITE API</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => {
          if (busy || on === null) return;
          if (!on && !window.confirm('Let managers in this league run their teams from outside tools? Each manager makes their own key, and a key can do only what its owner can.')) return;
          setBusy(true); setMsg(null);
          commishSetWriteApi(leagueId, !on).then((r) => setMsg(r.ok ? '✓ saved' : r.error ?? 'failed'))
            .catch((e) => setMsg(errMsg(e, 'failed')))
            .finally(() => { setBusy(false); load(); }); }}
          disabled={busy || on === null} className="mono" style={btn(on === true)}>{on ? 'ON' : 'OFF'}</button>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{on ? 'tap to switch every key off' : 'tap to let managers make keys'}</span>
        {note(msg)}
      </div>
      <div style={{ ...small, marginTop: 6 }}>
        Keyed control of the league from outside the app, the way ESPN's API works: set lineups, add and drop, file and cancel waiver claims, propose and answer trades. Each manager makes their own key under ⚙ → 🔑 API keys, and a key acts as that person with exactly their powers — a TEAM key reaches only their own team. Your own LEAGUE-scope key also reaches every team and your tools: run waivers, approve or veto trades, move players, set the waiver order. Every write is logged where you can see it, and you can revoke any key. Switching this off stops every key at once; switching it back on restores them.
      </div>
    </div>
  );
}

// ── The league's own awards and badges (0325) ────────────────────────────────
// Three choices make an award — what it measures, which end of it wins, and
// whether it only counts a win or a loss — and between them they cover every
// award a league has ever invented: HIGH SCORE is points/high/any, the sad
// sack is points/low/any, and "highest score that still lost" is
// points/high/loss, which is the one every league writes into its group chat
// and no platform lets it write down.
//
// A league that has configured nothing runs four built-ins, marked as such
// here; the first save writes them down as real rows so renaming one does not
// delete the others.
const METRICS: [AwardDef['metric'], string][] = [
  ['points', 'their score'], ['points_against', 'what they gave up'],
  ['margin', 'the margin'], ['combined', 'the game total'],
];
const ONLYS: [AwardDef['only_result'], string][] = [['any', 'ANY WEEK'], ['win', 'A WIN'], ['loss', 'A LOSS']];

export function AwardsPanel({ leagueId }: { leagueId: string }) {
  const [st, setSt] = useState<LeagueAwards | null>(null);
  const [teams, setTeams] = useState<{ roster_id: number; team: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: string; name: string; icon: string }>({ key: '', name: '', icon: '🏅' });
  const [badge, setBadge] = useState<{ key: string; name: string; icon: string }>({ key: '', name: '', icon: '🎖' });
  const [grantTo, setGrantTo] = useState<Record<string, number | ''>>({});
  const load = () => Promise.all([
    leagueAwards(leagueId).then((r) => { if (!r.error) setSt(r); else setMsg(r.error); }),
    nativeTeamState(leagueId).then((t) => setTeams((t.waiver_order ?? []).map((w) => ({ roster_id: w.roster_id, team: w.team })))),
  ]).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, done = '✓ saved') => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await f(); setMsg(r.ok ? done : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); void load(); }
  };
  const awards = st?.awards ?? [];
  const badges = st?.badges ?? [];
  const grants = st?.grants ?? [];
  const isDefault = awards.some((a) => a.is_default);
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>WEEKLY AWARDS</div>
      {isDefault && (
        <div style={{ ...small, marginTop: 2 }}>These four are the built-ins. Change any of them and they become yours — rename them, repoint them, switch them off, add your own.</div>
      )}
      {awards.map((a) => (
        <div key={a.key} style={{ ...row, flexWrap: 'wrap' }}>
          <input defaultValue={a.icon} onBlur={(e) => { if (e.target.value !== a.icon) void run(() => commishSetAward(leagueId, a.key, { icon: e.target.value })); }}
            style={{ ...inp, width: 40, fontSize: 15, padding: '3px 5px', textAlign: 'center' }} />
          <input defaultValue={a.name} key={`${a.key}-${a.name}`}
            onBlur={(e) => { if (e.target.value.trim() && e.target.value !== a.name) void run(() => commishSetAward(leagueId, a.key, { name: e.target.value })); }}
            style={{ ...inp, flex: '1 1 140px', fontSize: 13, padding: '4px 6px' }} />
          <select value={a.metric} onChange={(e) => void run(() => commishSetAward(leagueId, a.key, { metric: e.target.value as AwardDef['metric'] }))}
            className="mono" style={{ ...inp, fontSize: 12, padding: '4px 6px' }}>
            {METRICS.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
          </select>
          <button onClick={() => void run(() => commishSetAward(leagueId, a.key, { direction: a.direction === 'high' ? 'low' : 'high' }))}
            disabled={busy} className="mono" style={btn(a.direction === 'high')}>{a.direction === 'high' ? 'MOST' : 'LEAST'}</button>
          <select value={a.only_result} onChange={(e) => void run(() => commishSetAward(leagueId, a.key, { onlyResult: e.target.value as AwardDef['only_result'] }))}
            className="mono" style={{ ...inp, fontSize: 12, padding: '4px 6px' }}>
            {ONLYS.map(([o, label]) => <option key={o} value={o}>{label}</option>)}
          </select>
          <input defaultValue={String(a.coin ?? 0)} key={`${a.key}-coin-${a.coin}`} title="drip coin paid to the winner"
            onBlur={(e) => { const n = Number(e.target.value.replace(/[^0-9]/g, '')) || 0; if (n !== a.coin) void run(() => commishSetAward(leagueId, a.key, { coin: n })); }}
            style={{ ...inp, width: 54, fontSize: 12, padding: '4px 6px' }} />
          <button onClick={() => void run(() => commishSetAward(leagueId, a.key, { active: false }), '✓ switched off')}
            disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--dim)' }}>off</button>
          <button onClick={() => { if (window.confirm(`Retire ${a.name}? What it has already handed out is kept.`)) void run(() => commishDeleteAward(leagueId, a.key), '✓ retired'); }}
            disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} placeholder="🏅"
          style={{ ...inp, width: 40, fontSize: 15, padding: '3px 5px', textAlign: 'center' }} />
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="The Brown Jug"
          style={{ ...inp, fontSize: 13, padding: '4px 6px', width: 200 }} />
        <button onClick={() => void run(async () => {
          const key = draft.key.trim() || draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
          const r = await commishSetAward(leagueId, key, { name: draft.name.trim(), icon: draft.icon.trim() || '🏅' });
          if (r.ok) setDraft({ key: '', name: '', icon: '🏅' });
          return r;
        }, '✓ added')} disabled={busy || !draft.name.trim()} className="mono" style={btn(true)}>＋ add an award</button>
        {note(msg)}
      </div>
      <div style={{ ...small, marginTop: 6 }}>Handed out when every game of a week is final — the league hears about it in chat. A prize in coin is optional and paid once. Switching an award off or retiring it keeps every trophy it has already given.</div>

      <div style={{ ...subhead, marginTop: 14 }}>BADGES</div>
      {badges.map((b) => (
        <div key={b.key} style={{ ...row, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, width: 24, textAlign: 'center' }}>{b.icon}</span>
          <span style={cell}>{b.name}{b.note ? <span style={{ color: 'var(--faint)' }}> · {b.note}</span> : null}</span>
          <select value={grantTo[b.key] ?? ''} onChange={(e) => setGrantTo({ ...grantTo, [b.key]: e.target.value === '' ? '' : Number(e.target.value) })}
            className="mono" style={{ ...inp, fontSize: 12, padding: '4px 6px' }}>
            <option value="">pin on…</option>
            {teams.map((t) => <option key={t.roster_id} value={t.roster_id}>{t.team ?? `Team ${t.roster_id}`}</option>)}
          </select>
          <button onClick={() => { const rid = grantTo[b.key]; if (rid !== '' && rid != null) void run(() => commishGrantBadge(leagueId, rid, b.key), '✓ pinned'); }}
            disabled={busy || grantTo[b.key] === '' || grantTo[b.key] == null} className="mono" style={btn(true)}>pin</button>
          <button onClick={() => { if (window.confirm(`Delete ${b.name}? Everyone holding it loses it.`)) void run(() => commishDeleteBadge(leagueId, b.key), '✓ deleted'); }}
            disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>✕</button>
        </div>
      ))}
      {grants.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {grants.map((g) => (
            <div key={`${g.key}-${g.roster_id}-${g.season}`} style={row}>
              <span style={cell}>{g.icon} {g.name} <span style={{ color: 'var(--faint)' }}>· {g.team} · {g.season}</span></span>
              <button onClick={() => void run(() => commishRevokeBadge(leagueId, g.roster_id, g.key, g.season), '✓ taken back')}
                disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>take it back</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <input value={badge.icon} onChange={(e) => setBadge({ ...badge, icon: e.target.value })} placeholder="🐐"
          style={{ ...inp, width: 40, fontSize: 15, padding: '3px 5px', textAlign: 'center' }} />
        <input value={badge.name} onChange={(e) => setBadge({ ...badge, name: e.target.value })} placeholder="The GOAT"
          style={{ ...inp, fontSize: 13, padding: '4px 6px', width: 200 }} />
        <button onClick={() => void run(async () => {
          const key = badge.key.trim() || badge.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
          const r = await commishSetBadge(leagueId, key, { name: badge.name.trim(), icon: badge.icon.trim() || '🎖' });
          if (r.ok) setBadge({ key: '', name: '', icon: '🎖' });
          return r;
        }, '✓ added')} disabled={busy || !badge.name.trim()} className="mono" style={btn(true)}>＋ add a badge</button>
      </div>
      <div style={{ ...small, marginTop: 6 }}>Badges are yours to hand out and take back. Each one is stamped with the season it was earned, so the same badge can be won again next year, and they ride every manager's line in 🏛 League history.</div>
    </div>
  );
}

// ── The weekly report, reposted (0339) ───────────────────────────────────────
// Founder: "Maybe have an option for commish to regen any weekly report and
// post in chat."
//
// The worker already posts a week's report on its own once every matchup is
// final and stamped, and 0277 already had a force-it queue — locked to
// super-admins. This is the commissioner's door onto the same queue, so a
// league that never got its report (a week the worker skipped, a report that
// went out wrong) is not an errand for somebody else.
//
// Every line is a WEEK, because "which week?" is the only question, and it
// answers itself: whether the report has been posted, when, and if it has not,
// what is standing in the way. Asking twice REPLACES the chat line rather than
// adding one — the worker deletes the old message before posting the new — so
// the button is safe to press again, and the copy says so.
export function WeeklyReportPanel({ leagueId }: { leagueId: string }) {
  const [weeks, setWeeks] = useState<ReportWeek[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // 0348: does this league want the report ANNOUNCED in chat? Off keeps
  // building and storing every week — only the chat line stops.
  const [chatOn, setChatOn] = useState(true);
  const [flipping, setFlipping] = useState(false);
  // 0353: the week whose RE-SCORE box is open, and whether this league can
  // be re-scored at all (classic only — a drip week cannot be rebuilt).
  const [rescoreWeek, setRescoreWeek] = useState<number | null>(null);
  const [classic, setClassic] = useState(false);
  useEffect(() => { leagueGameMode(leagueId).then((g) => setClassic(g.mode === 'classic')).catch(() => {}); }, [leagueId]);
  const load = () => leagueReportWeeks(leagueId).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    setWeeks(r.weeks ?? []);
    setChatOn(r.report_chat !== false);
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  // While a request is open the worker is a minute away; poll so the line
  // flips to posted in front of whoever pressed it, rather than leaving them
  // wondering whether it took.
  const pending = (weeks ?? []).some((w) => w.request && !w.request.done_at);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (w: ReportWeek) => {
    if (busy != null) return;
    setBusy(w.week); setMsg(null);
    const r = await commishRequestWeekReport(leagueId, w.week).catch(() => null);
    setBusy(null);
    if (!r?.ok) { setMsg(r?.error ?? 'could not post'); return; }
    setMsg(`✓ week ${w.week}: ${r.note ?? 'queued'}`);
    void load();
  };
  // WHY a week cannot be posted, in the order a commissioner would ask. Null
  // means it can — the button is live and the reason line is the state.
  const blocker = (w: ReportWeek): string | null => {
    if (w.stamped === 0) return 'no finals stamped yet — nothing to report';
    if (!w.week_state.complete) {
      return w.week_state.live > 0
        ? `${w.week_state.live} game${w.week_state.live === 1 ? '' : 's'} still being played`
        : `the feed holds ${w.week_state.feed} of ${w.week_state.slate} games`;
    }
    return null;
  };
  return (
    <div style={{ marginTop: 14 }}>
      <div className="mono" style={subhead}>📋 WEEKLY REPORT</div>
      <div style={{ ...small, marginBottom: 4 }}>
        Build a week's report from the finals as they stand and post it into league chat. Posting a week again
        REPLACES its chat line rather than adding a second one, so this is safe to press twice. A week still being
        played is refused — a report built mid-game freezes those scores, which is how a week went out wrong once.
      </div>
      {/* 0348 · THE ANNOUNCEMENT IS OPTIONAL, THE RECORD IS NOT. Founder:
          "give the commish option to turn off reports posting in chat." Off
          stops the weekly chat line and nothing else — the week is still built
          and stored, the report screen still opens it, the history survives.
          A setting that deleted the season because somebody quieted a
          notification would be a trap. And ↻ REPOST still posts: that is a
          person asking for this week on purpose, not the standing schedule. */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '8px 0 10px', cursor: 'pointer' }}>
        <input type="checkbox" checked={chatOn} disabled={flipping}
          onChange={async (ev) => {
            const on = ev.target.checked;
            setFlipping(true); setChatOn(on); setMsg(null);
            const r = await commishSetReportChat(leagueId, on).catch(() => null);
            setFlipping(false);
            if (!r?.ok) { setChatOn(!on); setMsg(r?.error ?? 'could not save'); return; }
            setMsg(on ? '✓ the weekly report will post in chat' : '✓ the weekly report will be written but not posted in chat');
          }} />
        <span style={{ ...small, marginBottom: 0 }}>
          <b style={{ color: 'var(--text)' }}>Post the weekly report in chat</b><br />
          Off, the week is still written up and the report screen still opens it — it just doesn’t interrupt
          chat. Pressing ↻ REPOST below posts anyway, because that’s you asking.
        </span>
      </label>
      {weeks == null && <div style={small}>loading…</div>}
      {weeks?.length === 0 && <div style={small}>No weeks with matchups yet.</div>}
      {weeks?.map((w) => {
        const block = blocker(w);
        const open = !!w.request && !w.request.done_at;
        // RE-SCORE (0353): a classic week whose games are over and whose
        // finals are stamped. Anything else has nothing a re-score could fix.
        const canRescore = classic && w.stamped > 0 && w.week_state.complete;
        // FIX MID-WEEK (v0.499.0): a point adjustment or a lineup fix is as
        // useful on Sunday as after the week — the Thursday crash is fixed
        // before Monday, not after it. Any classic week that has started gets
        // the box; only a finished, stamped one gets the re-score in it.
        const canFix = classic && (w.stamped > 0 || w.week_state.feed > 0 || w.week_state.live > 0);
        return (
          <div key={w.week}>
          <div style={row}>
            <span className="mono" style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: 'var(--text)', minWidth: 64 }}>{weekTitle(w.week)}</span>
            <span style={{ ...cell, fontSize: 11.5, color: 'var(--faint)' }}>
              {w.stamped}/{w.matchups} stamped
              {w.posted_at
                ? ` · posted ${new Date(w.posted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                : ' · never posted'}
              {block ? ` · ${block}` : ''}
              {w.request?.error ? ` · ⚠ last try: ${w.request.error}` : ''}
            </span>
            {w.drifted > 0 && (
              <span className="mono" title="These matchups' stored finals do not match the sum of their own window rows — either the stamp was taken early, or you edited the score by hand. The report repeats whatever is stored."
                style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: 'var(--warn)', whiteSpace: 'nowrap' }}>
                ⚠ {w.drifted} edited or stale
              </span>
            )}
            {/* 0345. A DIFFERENT ACCUSATION FROM `drifted`, and the one that
                catches the week that went out early: these finals were
                computed before the week's last play arrived. Reposting will
                faithfully repeat them — only a re-score changes the number,
                which since 0353 is the commissioner's own ⟳ RE-SCORE in a
                classic league (a drip week cannot be rebuilt). */}
            {w.stale > 0 && (
              <span className="mono" title={`Scored ${w.scored_at ? new Date(w.scored_at).toLocaleString() : '—'}, but the week's last play arrived ${w.last_play_at ? new Date(w.last_play_at).toLocaleString() : '—'}. These finals were computed without it. Reposting repeats them; ${classic ? '⟳ re-score recomputes them.' : 'a drip week cannot be re-scored after the fact.'}`}
                style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: 'var(--warn)', whiteSpace: 'nowrap' }}>
                ⚠ {w.stale} scored before the last play
              </span>
            )}
            <button onClick={() => void post(w)} disabled={busy != null || !!block || open} className="mono"
              title={block ?? (w.posted_at ? 'Rebuild and replace this week\u2019s chat line' : 'Build and post this week\u2019s report into chat')}
              style={{ ...btn(!block && !open), opacity: block || open ? 0.45 : 1, whiteSpace: 'nowrap' }}>
              {busy === w.week ? '…' : open ? '⏳ queued' : w.posted_at ? '↻ repost' : '📋 post'}
            </button>
            {canFix && (
              <button onClick={() => setRescoreWeek(rescoreWeek === w.week ? null : w.week)} className="mono"
                title="Adjust a player's points or fix a lineup for this week, and recompute the week's scores from the plays as they stand now — preview first, nothing changes until you apply"
                style={{ ...btn(rescoreWeek === w.week), whiteSpace: 'nowrap' }}>{canRescore ? '⟳ re-score · ✏️ fix' : '✏️ fix'}</button>
            )}
          </div>
          {rescoreWeek === w.week && (canRescore
            ? <RescoreBox leagueId={leagueId} week={w.week} onApplied={() => void load()} />
            : <WeekFixBox leagueId={leagueId} week={w.week} />)}
          </div>
        );
      })}
      {note(msg)}
    </div>
  );
}

// ── WAIVER HOLDS (0354) ──────────────────────────────────────────────────────
// A player's hold, by hand: free him now, send him back to waivers until the
// next run, or hold him until a chosen moment. Every player on waivers right
// now is listed soonest first, with the claims waiting on him; a search finds
// the free agents a commissioner might want to put on waivers. Each change is
// announced in chat — a player becoming claimable is the league's business.
const etShort = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
  : '—');
export function WaiverHoldsPanel({ leagueId }: { leagueId: string }) {
  const [held, setHeld] = useState<HeldPlayer[] | null>(null);
  const [found, setFound] = useState<HeldPlayer[]>([]);
  const [nextRun, setNextRun] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = (search = q) => leagueWaiverHolds(leagueId, search.trim() || undefined).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    setHeld(r.held ?? []); setFound(r.found ?? []); setNextRun(r.next_run ?? null);
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { void load(''); /* eslint-disable-next-line */ }, [leagueId]);
  const set = async (p: HeldPlayer, mode: 'free' | 'next_run' | 'until') => {
    if (busy) return;
    let at: string | undefined;
    if (mode === 'until') {
      if (!until) { setMsg('pick a date and time first'); return; }
      at = new Date(until).toISOString();
    }
    setBusy(p.slug); setMsg(null);
    try { const r = await commishSetWaiverHold(leagueId, p.slug, mode, at); setMsg(r.ok ? `✓ ${r.note ?? 'saved'}` : r.error ?? 'failed'); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(null); void load(); }
  };
  const line = (p: HeldPlayer) => (
    <div key={p.slug} style={{ ...row, flexWrap: 'wrap' }}>
      <span style={{ ...cell, flex: '1 1 160px' }}>{p.name} <span style={{ color: 'var(--faint)' }}>{p.pos} · {p.team}</span></span>
      <span className="mono" style={{ ...mono, fontSize: 11, color: p.until ? 'var(--warn)' : 'var(--faint)' }}>
        {p.until ? `on waivers until ${etShort(p.until)}` : 'free agent'}{p.claims ? ` · ${p.claims} claim${p.claims === 1 ? '' : 's'}` : ''}
      </span>
      {p.until && <button onClick={() => void set(p, 'free')} disabled={!!busy} className="mono" style={btn(false)}>free now</button>}
      <button onClick={() => void set(p, 'next_run')} disabled={!!busy} className="mono" style={btn(false)} title={`until ${etShort(nextRun)}`}>to next run</button>
      <button onClick={() => void set(p, 'until')} disabled={!!busy || !until} className="mono" style={btn(false)}>hold until ↓</button>
    </div>
  );
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>WAIVER HOLDS</div>
      <div style={{ ...small, marginBottom: 6 }}>
        Free a player now, send him to waivers until the next run ({etShort(nextRun)}), or hold him until the time below.
        Claims already on him wait for his new hold. Each change is posted in league chat.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)' }}>HOLD UNTIL</span>
        <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} style={{ ...inp, padding: '4px 6px', fontSize: 12 }} />
        <span style={{ ...small, marginBottom: 0 }}>your local time, within two weeks</span>
      </div>
      {held == null && <div style={small}>loading…</div>}
      {held?.length === 0 && <div style={small}>Nobody is on waivers right now.</div>}
      {held?.map(line)}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
          placeholder="find a free agent to put on waivers" style={{ ...inp, flex: 1, padding: '5px 8px', fontSize: 12.5 }} />
        <button onClick={() => void load()} className="mono" style={btn(false)}>search</button>
      </div>
      {found.filter((p) => !(held ?? []).some((h) => h.slug === p.slug)).map(line)}
      {note(msg)}
    </div>
  );
}

// ── ⟳ RE-SCORE A WEEK (0353) ─────────────────────────────────────────────────
// Founder: "Build the re-score button first." The worker does the scoring —
// the same resolver the week was stamped with — so this files a request and
// watches it. PREVIEW changes nothing and lists what would move, what would
// change hands, and which seats saved no lineup (fielded from today's roster);
// APPLY confirms that preview, rewrites the finals, rebuilds the week's
// report and tells the league in chat.
// A week still being played (or played but not yet scored): the fixes
// without the re-score, which only a finished, stamped week can take. The
// worker's next tick scores what is saved here, and the week's final stamp
// keeps it.
function WeekFixBox({ leagueId, week }: { leagueId: string; week: number }) {
  return (
    <div style={{ margin: '4px 0 10px', padding: '10px 12px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg)' }}>
      <div style={{ ...small, maxWidth: 'none', marginBottom: 8 }}>
        {weekName(week)} is still being scored: a fix here counts on the next scoring pass, within a minute or two, and the week's final score keeps it.
        Re-scoring opens once every game is final.
      </div>
      <AdjustBox leagueId={leagueId} week={week} />
      <LineupFixBox leagueId={leagueId} week={week} />
    </div>
  );
}

function RescoreBox({ leagueId, week, onApplied }: { leagueId: string; week: number; onApplied: () => void }) {
  const [st, setSt] = useState<RescoreState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // The last state seen, outside React's updater: an apply that finishes
  // between two polls moves the league's own numbers, so the panel reloads —
  // once, not once per render.
  const last = useRef<RescoreState | null>(null);
  const load = () => leagueRescoreState(leagueId, week).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    const prev = last.current?.request;
    if (prev && !prev.done_at && r.request?.id === prev.id && r.request.done_at && r.request.apply) onApplied();
    last.current = r;
    setSt(r);
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId, week]);
  const req = st?.request ?? null;
  const running = !!req && !req.done_at;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const ask = async (apply: boolean) => {
    if (busy) return;
    if (apply && !window.confirm(`Rewrite week ${week}'s final scores? Standings, the weekly report and the league chat will all show the new numbers.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishRequestRescore(leagueId, week, apply);
      setMsg(r.ok ? `✓ ${r.note ?? 'queued'}` : r.error ?? 'failed');
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); void load(); }
  };
  const res = req?.done_at && !req.error ? req.result : null;
  const moved = (res?.matchups ?? []).filter((m) => m.moved);
  const warn = req && !req.apply ? autofillWarning(res) : null;
  return (
    <div style={{ margin: '4px 0 10px', padding: '10px 12px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg)' }}>
      <div style={{ ...small, maxWidth: 'none', marginBottom: 8 }}>
        Recompute week {week} from the plays as they stand now, with the lineups your managers saved and today's scoring settings.
        Preview first: nothing changes until you apply.
      </div>
      <AdjustBox leagueId={leagueId} week={week} />
      <LineupFixBox leagueId={leagueId} week={week} />
      {running && <div style={small}>⏳ {req!.apply ? 'Applying' : 'Previewing'} — the worker picks this up within a minute…</div>}
      {req?.error && <div style={{ ...small, color: 'var(--opp)' }}>⚠ Last {req.apply ? 'apply' : 'preview'} failed: {req.error}</div>}
      {res && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ ...cell, fontWeight: 700, marginBottom: 4 }}>
            {req!.apply ? '✓ Applied. ' : 'Preview: '}{rescoreHeadline(res, req!.apply)}
            {req!.apply && res.report === 'rebuilt' ? ' The weekly report was rebuilt.' : ''}
          </div>
          {moved.map((m) => (
            <div key={m.id} className="mono" style={{ ...mono, fontSize: 11.5, padding: '3px 0', color: m.flipped ? 'var(--warn)' : 'var(--text)' }}>
              {sideLine(m.home_team || `Roster ${m.home_roster_id}`, m.was.home, m.now.home)}
              {'  vs  '}
              {sideLine(m.away_team || `Roster ${m.away_roster_id}`, m.was.away, m.now.away)}
              {m.flipped ? (req!.apply ? '  · result changed' : '  · result would change') : ''}
            </div>
          ))}
          {warn && <div style={{ ...small, color: 'var(--warn)', maxWidth: 'none', marginTop: 6 }}>⚠ {warn}</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => void ask(false)} disabled={busy || running} className="mono" style={btn(false)}>
          {req && !req.apply && req.done_at ? '⟳ preview again' : '⟳ preview'}
        </button>
        {st?.can_apply && !running && (
          <button onClick={() => void ask(true)} disabled={busy} className="mono" style={btn(true)}>
            ✓ apply — rewrite week {week}
          </button>
        )}
        {note(msg)}
      </div>
    </div>
  );
}

// ── ✏️ POINT ADJUSTMENTS (0355) ──────────────────────────────────────────────
// Points on or off one player's week, with the reason the league will read.
// Lives in the re-score box because on a finished week that is where it lands:
// the adjustment is saved at once and counted by every board, and the stored
// finals follow when the week is re-scored below.
function AdjustBox({ leagueId, week }: { leagueId: string; week: number }) {
  const [rows, setRows] = useState<PlayerAdjustment[] | null>(null);
  const [found, setFound] = useState<AdjustCandidate[]>([]);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ slug: string; name: string } | null>(null);
  const [pts, setPts] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = (search?: string) => leaguePlayerAdjustments(leagueId, week, search?.trim() || undefined).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    setRows(r.adjustments ?? []); setFound(r.found ?? []);
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId, week]);
  const save = async (slug: string, points: number, note: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetPlayerAdjustment(leagueId, week, slug, points, note);
      if (!r.ok) { setMsg(r.error ?? 'failed'); return; }
      setMsg(`✓ saved${r.rescore ? ` — week ${week}'s finals change when you re-score it below` : ''}`);
      setPick(null); setPts(''); setWhy(''); setFound([]); setQ('');
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); void load(); }
  };
  const n = Number(pts);
  return (
    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--bd)' }}>
      <div className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--dim)', marginBottom: 4 }}>✏️ POINT ADJUSTMENTS · {weekTitle(week)}</div>
      <div style={{ ...small, maxWidth: 'none', marginBottom: 6 }}>
        Add or take points from one player for this week — a stat correction, a ruling. It counts wherever his points count
        (a starting spot, not the bench), every board shows it with your reason, and the league chat is told.
      </div>
      {rows?.map((a) => (
        <div key={a.slug} style={{ ...row, flexWrap: 'wrap' }}>
          <span style={{ ...cell, flex: '1 1 160px' }}>{a.name} <b style={{ color: a.points > 0 ? 'var(--you)' : 'var(--warn)' }}>{a.points > 0 ? '+' : ''}{a.points}</b>
            <span style={{ color: 'var(--faint)' }}> — {a.note}</span></span>
          <button onClick={() => void save(a.slug, 0, '')} disabled={busy} className="mono" style={btn(false)}>remove</button>
        </div>
      ))}
      {pick ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ ...cell, fontWeight: 700 }}>{pick.name}</span>
          <input value={pts} onChange={(e) => setPts(e.target.value)} placeholder="+6 or -2" inputMode="decimal"
            style={{ ...inp, width: 80, padding: '5px 8px', fontSize: 12.5 }} />
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="why — the league sees this" maxLength={200}
            style={{ ...inp, flex: 1, minWidth: 160, padding: '5px 8px', fontSize: 12.5 }} />
          <button onClick={() => void save(pick.slug, n, why)} disabled={busy || !Number.isFinite(n) || n === 0 || !why.trim()}
            className="mono" style={btn(true)}>save</button>
          <button onClick={() => setPick(null)} className="mono" style={btn(false)}>cancel</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(q); }}
            placeholder="find a player to adjust" style={{ ...inp, flex: 1, padding: '5px 8px', fontSize: 12.5 }} />
          <button onClick={() => void load(q)} className="mono" style={btn(false)}>search</button>
        </div>
      )}
      {!pick && found.map((p) => (
        <div key={p.slug} style={row}>
          <span style={{ ...cell, flex: 1 }}>{p.name} <span style={{ color: 'var(--faint)' }}>{p.pos} · {p.team}{p.owner ? ` · ${p.owner}` : ' · free agent'}</span></span>
          <button onClick={() => { const had = rows?.find((a) => a.slug === p.slug); setPick(p); setPts(had ? String(had.points) : ''); setWhy(had?.note ?? ''); }}
            className="mono" style={btn(false)}>adjust</button>
        </div>
      ))}
      {note(msg)}
    </div>
  );
}

// ── 🧾 FIX A LINEUP (0356) ───────────────────────────────────────────────────
// One seat's lineup for this week, past the kickoff locks: the start a crashed
// app never saved, a ruling the league made. Each spot offers only the seat's
// own players that week (the server's rule) who fit it (core's slotAllows).
// A reason is required, the league is told who came in and who went out, and
// a stamped week's finals follow when it is re-scored below.
function LineupFixBox({ leagueId, week }: { leagueId: string; week: number }) {
  const [teams, setTeams] = useState<{ roster_id: number; name: string }[] | null>(null);
  const [rid, setRid] = useState<number | null>(null);
  const [slots, setSlots] = useState<FixSlot[]>([]);
  const [cands, setCands] = useState<LineupFixCandidate[]>([]);
  const [stored, setStored] = useState<Record<string, string | null>>({});
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [author, setAuthor] = useState(true);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setTeams(null); setRid(null);
    commishWeekLineup(leagueId, week).then((r) => { if (r.ok) setTeams(r.teams ?? []); else setMsg(r.error ?? 'could not load'); })
      .catch((e) => setMsg(errMsg(e, 'could not load')));
    leagueGameMode(leagueId).then((gm) => { if (gm.ok) setSlots(fixSlots(gm)); }).catch(() => {});
  }, [leagueId, week]);
  const open = (r: number | null) => {
    setRid(r); setMsg(null);
    if (r == null) return;
    commishWeekLineup(leagueId, week, r).then((x) => {
      if (!x.ok) { setMsg(x.error ?? 'could not load'); return; }
      setCands(x.candidates ?? []); setRaw(x.stored ?? []); setAuthor(x.has_author !== false);
    }).catch((e) => setMsg(errMsg(e, 'could not load')));
  };
  // The stored rows meet the league's spots once both have loaded.
  const [raw, setRaw] = useState<{ slot: string; slug: string | null }[]>([]);
  useEffect(() => { const c = fixChosen(slots, raw); setStored(c); setChosen(c); }, [slots, raw]);
  const save = async () => {
    if (busy || rid == null) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetWeekLineup(leagueId, week, rid, fixPayload(slots, chosen), why);
      if (!r.ok) { setMsg(r.error ?? 'failed'); return; }
      setWhy('');
      setMsg(`✓ saved${r.rescore ? ` — week ${week}'s finals change when you re-score it below` : ''}`);
      open(rid);
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };
  const nameOf = (slug: string | null) => (slug ? cands.find((c) => c.slug === slug)?.name ?? slug : '—');
  const changed = fixChanged(slots, stored, chosen);
  return (
    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--bd)' }}>
      <div className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--dim)', marginBottom: 4 }}>🧾 FIX A LINEUP · {weekTitle(week)}</div>
      <div style={{ ...small, maxWidth: 'none', marginBottom: 6 }}>
        Set a team's lineup for this week past the kickoff locks — the start an app never saved, a ruling your league made.
        Only that team's own players that week are offered. The league sees who came in, who went out, and your reason.
      </div>
      <select value={rid ?? ''} onChange={(e) => open(e.target.value ? Number(e.target.value) : null)}
        style={{ ...inp, padding: '5px 8px', fontSize: 12.5, marginBottom: 6 }}>
        <option value="">{teams == null ? 'loading…' : 'choose a team…'}</option>
        {(teams ?? []).map((t) => <option key={t.roster_id} value={t.roster_id}>{t.name}</option>)}
      </select>
      {rid != null && !author && <div style={small}>This seat has nobody to field a lineup for — its lineup is computed from its roster.</div>}
      {rid != null && author && slots.map((s) => {
        const opts = fixOptions(slots, s.slot, cands, chosen);
        const cur = chosen[s.slot] ?? null;
        return (
          <div key={s.slot} style={{ ...row, gap: 8 }}>
            <span className="mono" style={{ ...mono, fontSize: 11, width: 64, color: 'var(--faint)' }}>{s.name}</span>
            {s.bestball
              ? <span style={{ ...small, marginBottom: 0 }}>🎯 best ball — fills itself</span>
              : (
                <select value={cur ?? ''} onChange={(e) => setChosen({ ...chosen, [s.slot]: e.target.value || null })}
                  style={{ ...inp, flex: 1, padding: '4px 6px', fontSize: 12.5, fontWeight: cur !== (stored[s.slot] ?? null) ? 700 : 400 }}>
                  <option value="">— empty —</option>
                  {cur && !opts.some((c) => c.slug === cur) && <option value={cur}>{nameOf(cur)} (doesn't fit this spot)</option>}
                  {opts.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name} · {c.pos} {c.team}{c.spot && c.spot !== 'active' ? ` · ${c.spot.toUpperCase()}` : ''}{c.why === 'left' ? ' · since dropped or traded' : ''}
                    </option>
                  ))}
                </select>
              )}
          </div>
        );
      })}
      {rid != null && author && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="why — the league sees this" maxLength={200}
            style={{ ...inp, flex: 1, padding: '5px 8px', fontSize: 12.5 }} />
          <button onClick={() => void save()} disabled={busy || !changed || !why.trim()} className="mono" style={btn(true)}>save lineup</button>
          {changed && <button onClick={() => setChosen(stored)} className="mono" style={btn(false)}>reset</button>}
        </div>
      )}
      {note(msg)}
    </div>
  );
}

// ── 🔀 REDRAW A WEEK (0357) ──────────────────────────────────────────────────
// Swap two teams' opponents in a week that hasn't started: tap one team, then
// the other. A team on bye can be swapped in. Saved lineups follow their team;
// a drip power-up already armed against an opponent blocks the swap.
export function SchedulePanel({ leagueId }: { leagueId: string }) {
  const [weeks, setWeeks] = useState<RedrawWeek[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [pick, setPick] = useState<RedrawTeam[]>([]);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => commishOpenSchedule(leagueId).then((r) => {
    if (!r.ok) { setMsg(r.error ?? 'could not load'); return; }
    const ws = r.weeks ?? [];
    setWeeks(ws);
    setWeek((w) => (w != null && ws.some((x) => x.week === w) ? w : ws[0]?.week ?? null));
  }).catch((e) => setMsg(errMsg(e, 'could not load')));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  const wk = weeks?.find((w) => w.week === week) ?? null;
  const tap = (t: RedrawTeam) => {
    setMsg(null);
    if (pick.some((p) => p.roster_id === t.roster_id)) setPick(pick.filter((p) => p.roster_id !== t.roster_id));
    else setPick(pick.length >= 2 ? [t] : [...pick, t]);
  };
  const swap = async () => {
    if (busy || pick.length !== 2 || week == null) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSwapOpponents(leagueId, week, pick[0].roster_id, pick[1].roster_id, why);
      if (!r.ok) { setMsg(r.error ?? 'failed'); return; }
      setMsg(`✓ ${r.note ?? 'swapped'}`); setPick([]); setWhy('');
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); void load(); }
  };
  const team = (t: RedrawTeam) => {
    const on = pick.some((p) => p.roster_id === t.roster_id);
    return (
      <button key={t.roster_id} onClick={() => tap(t)} className="mono"
        style={{ ...btn(on), flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</button>
    );
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div className="mono" style={subhead}>🔀 REDRAW A WEEK</div>
      <div style={{ ...small, marginBottom: 6 }}>
        Swap two teams' opponents in a week that hasn't kicked off: tap one team, then the other. A team on bye can be
        swapped in, and the other team takes the bye. Saved lineups follow their team. Playoff weeks follow the seeds and aren't listed here.
        Each change is posted in league chat.
      </div>
      {weeks == null && <div style={small}>loading…</div>}
      {weeks?.length === 0 && <div style={small}>No week is open to redraw — every scheduled week has started, or there's no schedule yet.</div>}
      {!!weeks?.length && (
        <select value={week ?? ''} onChange={(e) => { setWeek(Number(e.target.value)); setPick([]); }}
          style={{ ...inp, padding: '5px 8px', fontSize: 12.5, marginBottom: 8 }}>
          {weeks.map((w) => <option key={w.week} value={w.week}>{weekName(w.week)}</option>)}
        </select>
      )}
      {wk?.games.map((g) => (
        <div key={g.id} style={{ ...row, gap: 8 }}>
          {team(g.home)}<span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>vs</span>{team(g.away)}
        </div>
      ))}
      {!!wk?.byes.length && (
        <div style={{ ...row, gap: 8 }}>
          <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>BYE</span>{wk.byes.map(team)}
        </div>
      )}
      {pick.length === 2 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ ...cell, fontWeight: 700 }}>Swap {pick[0].name} ⇄ {pick[1].name}</span>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="why — the league sees this" maxLength={200}
            style={{ ...inp, flex: 1, minWidth: 160, padding: '5px 8px', fontSize: 12.5 }} />
          <button onClick={() => void swap()} disabled={busy || !why.trim()} className="mono" style={btn(true)}>swap</button>
        </div>
      )}
      {note(msg)}
    </div>
  );
}

// ── Weeks already played (0378) ──────────────────────────────────────────────
export function PlayedWeeksPanel({ leagueId }: { leagueId: string }) {
  const [st, setSt] = useState<ScoreAsIsState | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => scoreAsIsState(leagueId).then((r) => { setSt(r); setStart(r.first_week ?? null); }).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  // While a request is with the worker, look again every few seconds.
  const pending = st?.weeks?.some((w) => w.request && !w.request.done_at);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [pending]);
  if (!st?.ok || !st.classic) return null;
  const lo = st.earliest ?? 1;
  const open = st.natural_open ?? null;
  const choices = open != null ? Array.from({ length: Math.max(0, open - lo) }, (_, i) => lo + i) : [];
  const backdate = async () => {
    if (busy || start == null) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishBackdateSeason(leagueId, open != null && start >= open ? null : start);
      setMsg(r.ok ? `✓ the season starts in ${playedWeekName(start)}` : (r.error ?? 'failed'));
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); void load(); }
  };
  const score = async (w: number) => {
    if (busy) return;
    if (!window.confirm(`Score ${playedWeekName(w)} with the rosters as they stand?\n\nEach team keeps the lineup it saved; a team that saved none takes the lineup it saved for its next week, and empty spots are filled by projection. A week that's over is final once scored; a week still being played keeps going. The league hears about it in chat.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishScoreAsIs(leagueId, w);
      setMsg(r.ok ? `✓ ${playedWeekName(w)} is with the worker — this updates in a moment` : (r.error ?? 'failed'));
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); void load(); }
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div className="mono" style={subhead}>⏮ WEEKS ALREADY PLAYED</div>
      <div style={{ ...small, marginBottom: 6 }}>
        A league made mid-week starts next week. Move its start back to a week already played, then score each of
        those weeks with the rosters as they stand: every team keeps its saved lineup (or the one saved for its next week),
        and empty spots are filled by projection. Only before any week is scored.
      </div>
      {st.can_backdate && choices.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="mono" style={{ ...cell, flex: 'none' }}>Season starts</span>
          <select value={start ?? ''} onChange={(e) => setStart(Number(e.target.value))}
            style={{ ...inp, padding: '5px 8px', fontSize: 12.5 }}>
            {choices.map((w) => <option key={w} value={w}>{playedWeekName(w)} (already played)</option>)}
            {open != null && <option value={open}>{playedWeekName(open)} (next week — no backdate)</option>}
          </select>
          <button onClick={() => void backdate()} disabled={busy || start == null || start === st.first_week} className="mono" style={btn(true)}>set</button>
        </div>
      )}
      {!st.drafted && <div style={small}>Scoring opens once the draft is done.</div>}
      {st.weeks?.length === 0 && <div style={small}>No week of this league has kicked off yet.</div>}
      {st.weeks?.map((w) => {
        const req = w.request;
        const busyReq = !!req && !req.done_at;
        return (
          <div key={w.week} style={row}>
            <span className="mono" style={{ ...cell, flex: 'none', minWidth: 90, fontWeight: 700 }}>{w.name}</span>
            <span className="mono" style={{ ...cell, fontSize: 11.5, color: req?.error ? 'var(--opp)' : 'var(--dim)' }}>
              {w.final ? '✓ final' : scoreAsIsLine(req)}
            </span>
            {!w.final && st.drafted && (
              <button onClick={() => void score(w.week)} disabled={busy || busyReq} className="mono" style={btn(true)}>score as-is</button>
            )}
          </div>
        );
      })}
      {note(msg)}
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
