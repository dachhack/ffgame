// THE CONTEST CARD, web (v0.664.0) — the commissioner's console destination
// that is a contest league's own: what wins, how it plays, the budget, the
// Bullseye card, the size, the league board. Everything else a contest
// league's commissioner sets — the roster, scoring, the pool filter, seat
// rules, the name, deleting — is the classic console's, unchanged.
import { useEffect, useState, type CSSProperties } from 'react';
import {
  contestLeague, setContestRules, setDfsBullseye, setBullseyeSize, postLeagueListing, closeLeagueListing, leagueListingState,
  isAdmin, myFeatures, bullseyeMaxSeats, friendlyError,
  contestWeekList, commishVoidWeek, commishContestSquad, commishSetContestSquad, contestBoard, contestBoardFind, podSalaries,
  type ContestInfo, type ContestKind, type ContestFormat, type ContestWeekRow, type CommishContestSquad, type PodSalaryRow,
} from '@drip/core/data/liveApi';
import { CONTEST_WORD, CONTEST_EMOJI, CONTEST_LATE_WORD, CONTEST_DEADLINE_WORD, contestLateEntryDefault, contestSquadOf, contestSlotLabels, type ContestLateEntry, type ContestEntryDeadline } from '@drip/core/engine/contest';
import { classicSlotsFromSpec } from '@drip/core/engine/classic';
import { RescoreBox, AdjustBox } from './CommishDesk';

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean, dim = false): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--on-accent, var(--bg))' : dim ? 'var(--faint)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: `1px solid ${on ? 'var(--you)' : 'color-mix(in srgb, var(--you) 45%, var(--bd))'}`, borderRadius: 999, padding: '5px 12px',
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const label: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' };
const input: CSSProperties = { fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
const n0 = (n: number) => n.toLocaleString('en-US');
export const CONTEST_BUDGETS = [0, 10000, 20000, 30000, 40000, 50000, 60000, 75000, 100000, 150000, 200000, 500000];   // 0 = NO CAP (0469)
/** The minimum spend (0469): golf's constraint. 0 = none. */
export const CONTEST_MIN_SPENDS = [0, 10000, 20000, 30000, 40000, 45000, 50000, 60000, 75000, 100000];
export const moneyChip = (v: number, none: string) => (v ? `$${Math.round(v / 1000)}k` : none);

export function ContestCommishPanel({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const [b, setB] = useState<ContestInfo | null>(null);
  const [span, setSpan] = useState<'season' | 'week'>('season');
  const [played, setPlayed] = useState(false);
  const [cap, setCap] = useState(32);
  const [size, setSize] = useState(12);
  const [budget, setBudget] = useState(50000);
  const [minSpend, setMinSpend] = useState(0);
  const [radius, setRadius] = useState(10);
  const [listed, setListed] = useState(false);
  const [blurb, setBlurb] = useState('');
  const [dues, setDues] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => contestLeague(leagueId).then((r) => {
    if (!r.ok || !r.bullseye) { setNote(r.error ?? 'Couldn’t read the league.'); return; }
    setB(r.bullseye); setSize(r.bullseye.max_seats); setBudget(r.bullseye.budget); setMinSpend(r.bullseye.min_spend ?? 0); setRadius(r.bullseye.radius);
    setSpan(r.bullseye.span); setPlayed((r.weeks ?? []).length > 0); setListed(!!r.listed);
  }).catch((e) => setNote(friendlyError(e)));
  useEffect(() => {
    void load();
    Promise.all([isAdmin().catch(() => false), myFeatures().catch(() => ({} as Record<string, boolean>))])
      .then(([a, f]) => setCap(bullseyeMaxSeats(!!a, f))).catch(() => {});
    leagueListingState(leagueId).then((s) => { if (s.ok) { setListed(!!s.listed); setBlurb(s.blurb ?? ''); setDues(s.dues ?? ''); } }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [leagueId]);
  const act = async (p: Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true); setNote(null);
    const r = await p.catch((e) => ({ ok: false, error: friendlyError(e) }));
    setBusy(false);
    setNote(r.ok ? `✓ ${done}` : (r.error ?? 'That didn’t work.'));
    if (r.ok) { await load(); onChanged?.(); }
    return r.ok;
  };
  if (!b) return <div style={{ ...card }}><span className="mono" style={small}>{note ?? 'Loading…'}</span></div>;
  const h2h = b.format === 'h2h';
  const top = h2h ? 32 : cap;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div className="mono" style={label}>WINS BY</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['high', 'golf', 'bullseye'] as ContestKind[]).map((c) => (
            <button key={c} disabled={busy} onClick={() => void act(setContestRules(leagueId, { contest: c }), `now ${CONTEST_WORD[c].toLowerCase()}`)} className="mono" style={chip(b.contest === c)}>{`${CONTEST_EMOJI[c]} ${CONTEST_WORD[c]}`}</button>
          ))}
        </div>
        <div className="mono" style={small}>{b.contest === 'golf' ? 'Lowest score wins. Set each spot’s 0 → penalty on ROSTER so a scoreless player costs something.' : b.contest === 'high' ? 'Highest score wins.' : 'Closest to the week’s card wins; the dart scores each spot.'} Takes effect from the next week; not while a week is being played.</div>
        <div className="mono" style={label}>PLAYS</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['h2h', 'board'] as ContestFormat[]).map((f) => (
            <button key={f} disabled={busy || played} onClick={() => void act(setContestRules(leagueId, { format: f }), f === 'h2h' ? 'head-to-head' : 'leaderboard')} className="mono" style={chip(b.format === f, played && b.format !== f)}>{f === 'h2h' ? 'HEAD-TO-HEAD' : 'LEADERBOARD'}</button>
          ))}
          <span className="mono" style={small}>{played ? 'Set once the league has played a week.' : 'Head-to-head pairs an even number of seats, up to 32; the CPU plays an empty seat.'}</span>
        </div>
        <div className="mono" style={label}>BUDGET</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mono" style={{ ...input, width: 130 }}>
            {[...new Set([...CONTEST_BUDGETS, b.budget])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v ? `$${n0(v)}` : 'NO CAP'}</option>)}
          </select>
          <button disabled={busy || budget === b.budget} onClick={() => void act(setContestRules(leagueId, { budget }), 'budget changed')} className="mono" style={chip(true)}>SET</button>
          <span className="mono" style={small}>per squad, from the next week. Add or remove spots on ROSTER — a bigger squad wants a bigger budget. NO CAP suits Bullseye: the card does the limiting.</span>
        </div>
        <div className="mono" style={label}>MIN SPEND</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={minSpend} onChange={(e) => setMinSpend(Number(e.target.value))} className="mono" style={{ ...input, width: 130 }}>
            {[...new Set([...CONTEST_MIN_SPENDS, b.min_spend ?? 0])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v ? `$${n0(v)}` : 'NONE'}</option>)}
          </select>
          <button disabled={busy || minSpend === (b.min_spend ?? 0)} onClick={() => void act(setContestRules(leagueId, { minSpend }), 'minimum spend changed')} className="mono" style={chip(true)}>SET</button>
          <span className="mono" style={small}>{b.contest === 'golf' ? 'Golf’s real constraint: a squad must spend at least this, so cheap no-names aren’t the whole game.' : 'A floor a squad must spend; mostly for golf.'}</span>
        </div>
        <div className="mono" style={label}>RULED OUT</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button disabled={busy} onClick={() => void act(setContestRules(leagueId, { autoSub: true }), 'auto-sub on')} className="mono" style={chip(!!b.auto_sub)}>SWAP HIM FOR ME</button>
          <button disabled={busy} onClick={() => void act(setContestRules(leagueId, { autoSub: false }), 'auto-sub off')} className="mono" style={chip(!b.auto_sub)}>LEAVE IT TO ME</button>
          <span className="mono" style={small}>Every player locks at his own kickoff, so a ruled-out pick can be swapped until then. SWAP HIM FOR ME puts the best affordable body in his spot in the minutes before his game if nobody has; LEAVE IT TO ME banks the zero.</span>
        </div>
        <div className="mono" style={label}>NO SQUAD BY LOCK</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(h2h ? ['cpu', 'zero'] as ContestLateEntry[] : ['cpu', 'zero', 'drop'] as ContestLateEntry[]).map((v) => (
            <button key={v} disabled={busy} onClick={() => void act(setContestRules(leagueId, { lateEntry: v }), `a no-show ${CONTEST_LATE_WORD[v].toLowerCase()}`)} className="mono" style={chip((b.late_entry ?? contestLateEntryDefault(b.format)) === v)}>{CONTEST_LATE_WORD[v]}</button>
          ))}
          <span className="mono" style={small}>{`A seat with no squad at the week’s first kickoff: ${h2h ? 'the CPU builds one so its opponent has a game, or it forfeits with a zero' : 'the CPU builds one, it scores a zero, or it sits the week out with no row at all'}.${b.contest === 'golf' ? ' In golf a scoreless squad is the best score, so SCORES ZERO needs every spot’s 0 → penalty set on ROSTER.' : ''}`}</span>
        </div>
        <div className="mono" style={label}>ENTRIES</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['open', 'first'] as ContestEntryDeadline[]).map((v) => (
            <button key={v} disabled={busy} onClick={() => void act(setContestRules(leagueId, { entryDeadline: v }), v === 'first' ? 'entries close at the first kickoff' : 'entries open until each player’s game')} className="mono" style={chip((b.entry_deadline ?? 'open') === v)}>{CONTEST_DEADLINE_WORD[v]}</button>
          ))}
          <span className="mono" style={small}>A new squad can go in until its players kick off, or not at all once the week’s first game has — a saved squad still swaps its unlocked players either way.</span>
        </div>
      </div>

      {b.contest === 'bullseye' && (
        <div style={{ ...card, display: 'grid', gap: 10 }}>
          <div className="mono" style={label}>THE CARD</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['slots', 'total'] as const).map((v) => (
              <button key={v} disabled={busy} onClick={() => void act(setDfsBullseye(leagueId, v, radius), 'card changed')} className="mono" style={chip(b.variant === v)}>{v === 'slots' ? 'SLOT TARGETS' : 'ONE TEAM TOTAL'}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono" style={small}>RADIUS (2–50) — points for dead-on, and the zero penalty</span>
            <input type="number" min={2} max={50} value={radius} onChange={(e) => setRadius(Number(e.target.value) || 10)} style={{ ...input, width: 80 }} />
            <button disabled={busy || radius === b.radius} onClick={() => void act(setDfsBullseye(leagueId, b.variant, radius), 'radius changed')} className="mono" style={chip(true)}>SET</button>
          </div>
          <div className="mono" style={small}>Not while a week is being played — change it once that week is final.</div>
        </div>
      )}

      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div className="mono" style={label}>WHO CAN GET IN</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono" style={small}>{h2h ? 'TEAMS (even, 2–32)' : `UP TO (2–${n0(cap)})`}</span>
          <input type="number" min={2} max={top} step={h2h ? 2 : 1} value={size} onChange={(e) => setSize(Number(e.target.value) || 2)} style={{ ...input, width: 110 }} />
          <button disabled={busy || size === b.max_seats} onClick={() => void act(setBullseyeSize(leagueId, size), 'size changed')} className="mono" style={chip(true)}>SET</button>
          <span className="mono" style={small}>{`${n0(b.seats_taken)} in now${h2h ? ' · an added seat plays as the CPU until someone takes it' : ''}`}</span>
        </div>
        <div className="mono" style={label}>THE LEAGUE BOARD</div>
        <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={200} rows={2} placeholder="Blurb (optional)" style={{ ...input, resize: 'vertical' }} />
        <input value={dues} onChange={(e) => setDues(e.target.value)} maxLength={120} placeholder="Dues (optional) — the platform prints it, never collects it" style={input} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => void act(postLeagueListing(leagueId, blurb.trim() || null, dues.trim()), listed ? 'board post updated' : 'posted to the board').then((ok) => { if (ok) setListed(true); })} className="mono" style={chip(true)}>{listed ? 'UPDATE THE POST' : 'POST IT TO THE BOARD'}</button>
          {listed && <button disabled={busy} onClick={() => void act(closeLeagueListing(leagueId), 'taken off the board').then((ok) => { if (ok) setListed(false); })} className="mono" style={chip(false)}>TAKE IT DOWN</button>}
        </div>
        {span === 'week' && <div className="mono" style={small}>A one-week league leaves the board once its week kicks off.</div>}
      </div>
      {played && <ContestFixWeekPanel leagueId={leagueId} />}
      {note && <div className="mono" style={{ fontSize: 11, color: note.startsWith('✓') ? 'var(--you)' : 'var(--warn, #c66)' }}>{note}</div>}
    </div>
  );
}

// ── FIX A WEEK (0474) ───────────────────────────────────────────────────────
// Void a week that shouldn't count (final only; restore is the undo), correct
// a player's points (0355, now reaching the board), set a seat's squad past
// the locks, and re-score the week (0353) — the classic console's boxes where
// they apply, the contest's own where they don't. Every fix is announced in
// chat with the reason.
export function ContestFixWeekPanel({ leagueId }: { leagueId: string }) {
  const [weeks, setWeeks] = useState<ContestWeekRow[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () => contestWeekList(leagueId).then((r) => {
    if (!r.ok) { setNote(r.error ?? 'Couldn’t read the weeks.'); return; }
    setWeeks(r.weeks ?? []);
  }).catch((e) => setNote(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const w = weeks?.find((x) => x.week === week) ?? null;
  const voidIt = async (on: boolean) => {
    if (w == null || busy) return;
    if (on && !window.confirm(`Void week ${w.week}? It stops counting in the standings and the league is told why. You can restore it later.`)) return;
    setBusy(true); setNote(null);
    const r = await commishVoidWeek(leagueId, w.week, on, why).catch((e) => ({ ok: false, error: friendlyError(e) }));
    setBusy(false);
    setNote(r.ok ? `✓ week ${w.week} ${on ? 'voided' : 'restored'}` : (r.error ?? 'That didn’t work.'));
    if (r.ok) { setWhy(''); void load(); }
  };
  return (
    <div style={{ ...card, display: 'grid', gap: 10 }}>
      <div className="mono" style={label}>FIX A WEEK</div>
      <div className="mono" style={small}>Void a week that shouldn’t count, correct a player’s points after a stat correction, set a member’s squad, and re-score the week from the plays as they stand. Every fix is announced in the league chat with your reason.</div>
      {weeks && !weeks.length && <span className="mono" style={small}>No weeks yet.</span>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(weeks ?? []).map((x) => (
          <button key={x.week} onClick={() => setWeek(week === x.week ? null : x.week)} className="mono" style={chip(week === x.week)}>
            {`WEEK ${x.week}${x.void ? ' · VOIDED' : x.final ? '' : ` · ${x.status.toUpperCase()}`}`}
          </button>
        ))}
      </div>
      {w && (
        <>
          <div className="mono" style={small}>
            {w.final ? `${w.stamped} of ${w.matchups} final scores stamped` : `${w.status} — ${w.matchups} ${w.matchups === 1 ? 'matchup' : 'matchups'}`}
            {` · ${n0(w.entries)} ${w.entries === 1 ? 'squad' : 'squads'}`}
            {w.void ? ` · VOIDED — ${w.void_note ?? ''}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {w.void ? (
              <button disabled={busy} onClick={() => void voidIt(false)} className="mono" style={chip(false)}>{`↩️ RESTORE WEEK ${w.week}`}</button>
            ) : (
              <>
                <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} placeholder="why void it — the league sees this" style={{ ...input, flex: 1, minWidth: 200 }} />
                <button disabled={busy || !w.final || !why.trim()} onClick={() => void voidIt(true)} className="mono" style={chip(false, !w.final || !why.trim())}>{`🚫 VOID WEEK ${w.week}`}</button>
              </>
            )}
            <span className="mono" style={small}>{w.void ? 'A voided week stays on the board, marked, and counts for nothing.' : w.final ? 'Voiding keeps the scores but takes the week out of the standings and records.' : 'A week can be voided once it’s final.'}</span>
          </div>
          {w.final && w.stamped > 0
            ? <RescoreBox leagueId={leagueId} week={w.week} onApplied={() => void load()} contest fix={<SquadFixBox leagueId={leagueId} week={w.week} />} />
            : (
              <div style={{ padding: '10px 12px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg)' }}>
                <div className="mono" style={{ ...small, marginBottom: 8 }}>{`Week ${w.week} is still being scored: a fix here counts on the next scoring pass, within a minute or two. Re-scoring opens once every game is final.`}</div>
                <AdjustBox leagueId={leagueId} week={w.week} />
                <SquadFixBox leagueId={leagueId} week={w.week} />
              </div>
            )}
        </>
      )}
      {note && <div className="mono" style={{ fontSize: 11, color: note.startsWith('✓') ? 'var(--you)' : 'var(--warn, #c66)' }}>{note}</div>}
    </div>
  );
}

// ── 🧾 SET A SQUAD (0474) — the contest twin of the classic lineup fix ──────
// Pick the seat (the board's rows, or find one by name on a big board), then a
// player per spot from the week's priced board; the spend is shown against the
// budget. A reason is required; the league is told who came in and out.
type Seat = { roster_id: number; team_name: string | null };
function SquadFixBox({ leagueId, week }: { leagueId: string; week: number }) {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [findQ, setFindQ] = useState('');
  const [rid, setRid] = useState<number | null>(null);
  const [sq, setSq] = useState<CommishContestSquad | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[]>([]);
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    contestBoard(leagueId, week, 500).then((b) => {
      const rows = (b.season?.rows ?? b.rows ?? []) as Seat[];
      setSeats(rows.map((r) => ({ roster_id: r.roster_id, team_name: r.team_name })).sort((a, b2) => (a.team_name ?? '').localeCompare(b2.team_name ?? '')));
    }).catch(() => {});
  }, [leagueId, week]);
  useEffect(() => {
    const q = findQ.trim();
    if (!q) return;
    const id = setTimeout(() => contestBoardFind(leagueId, week, q).then((r) => {
      if (!r.ok) return;
      const hits = (r.season.length ? r.season : r.found) as Seat[];
      setSeats(hits.map((h) => ({ roster_id: h.roster_id, team_name: h.team_name })));
    }).catch(() => {}), 300);
    return () => clearTimeout(id);
  }, [findQ, leagueId, week]);
  useEffect(() => {
    if (rid == null) { setSq(null); return; }
    Promise.all([commishContestSquad(leagueId, week, rid), podSalaries(week)]).then(([s, rows]) => {
      if (!s.ok) { setMsg(s.error ?? 'could not load'); return; }
      setSq(s); setBoard(rows);
      setPicks(contestSquadOf(s.entry, classicSlotsFromSpec(s.slots ?? null) ?? []));
    }).catch((e) => setMsg(friendlyError(e)));
  }, [leagueId, week, rid]);
  const defs = classicSlotsFromSpec(sq?.slots ?? null) ?? [];
  const labels = contestSlotLabels(defs);
  const bySlug = new Map(board.map((r) => [r.slug, r]));
  const spent = defs.reduce((sum, d) => sum + (bySlug.get(picks[d.slot] ?? '')?.salary ?? 0), 0);
  const budget = sq?.budget ?? 0;
  const save = async () => {
    if (rid == null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetContestSquad(leagueId, week, rid, picks, why);
      if (!r.ok) { setMsg(r.error ?? 'failed'); return; }
      setMsg(`✓ saved — in ${r.in?.length ? r.in.join(', ') : 'nobody'}; out ${r.out?.length ? r.out.join(', ') : 'nobody'}${r.rescore ? ` — week ${week}'s finals change when you re-score it below` : ''}`);
      setWhy('');
    } catch (e) { setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--bd)' }}>
      <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', marginBottom: 4 }}>{`🧾 SET A SQUAD · WEEK ${week}`}</div>
      <div className="mono" style={{ ...small, marginBottom: 6 }}>One seat’s squad for this week, past the kickoff locks — the app that died at 12:58, the ruling the league made. The budget, the floor and each spot’s rules still apply. The league is told who came in and who went out, with your reason.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={rid ?? ''} onChange={(e) => setRid(e.target.value ? Number(e.target.value) : null)} className="mono" style={{ ...input, width: 220 }}>
          <option value="">— pick a seat —</option>
          {seats.map((s) => <option key={s.roster_id} value={s.roster_id}>{s.team_name ?? `Team ${s.roster_id}`}</option>)}
        </select>
        <input value={findQ} onChange={(e) => setFindQ(e.target.value)} maxLength={30} placeholder="find a team…" style={{ ...input, width: 160 }} />
      </div>
      {sq && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {defs.map((d) => {
            const want = new Set(d.pos.map((p) => String(p).toUpperCase()));
            const opts = board.filter((r) => want.has(String(r.pos).toUpperCase())).sort((a, b) => b.salary - a.salary);
            const cur = picks[d.slot] ?? '';
            if (cur && !opts.some((o) => o.slug === cur) && bySlug.has(cur)) opts.unshift(bySlug.get(cur)!);
            return (
              <div key={d.slot} style={{ display: 'grid', gridTemplateColumns: '90px minmax(0,1fr)', gap: 8, alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{labels[d.slot] ?? d.slot}</span>
                <select value={cur} onChange={(e) => setPicks((p) => ({ ...p, [d.slot]: e.target.value || null }))} className="mono" style={input}>
                  <option value="">— empty —</option>
                  {opts.map((o) => <option key={o.slug} value={o.slug}>{`${o.name} · ${o.pos} ${o.team} · $${n0(o.salary)}`}</option>)}
                </select>
              </div>
            );
          })}
          <div className="mono" style={{ ...small, color: budget > 0 && spent > budget ? 'var(--warn, #c66)' : 'var(--faint)' }}>
            {`$${n0(spent)} of ${budget > 0 ? `$${n0(budget)}` : 'no cap'}${sq.min_spend ? ` · min spend $${n0(sq.min_spend)}` : ''}${sq.stamped ? ' · this seat’s week is stamped — re-score after saving' : ''}`}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} placeholder="why — the league sees this" style={{ ...input, flex: 1, minWidth: 180 }} />
            <button onClick={() => void save()} disabled={busy || !why.trim()} className="mono" style={chip(true, !why.trim())}>SET THE SQUAD</button>
          </div>
        </div>
      )}
      {msg && <div className="mono" style={{ fontSize: 11, marginTop: 6, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--warn, #c66)' }}>{msg}</div>}
    </div>
  );
}
