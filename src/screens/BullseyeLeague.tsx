// CONTEST LEAGUES, web (v0.661.0 as Bullseye; v0.664.0 any contest) —
// docs/dfs-bullseye.md §9 and §13.
//
// Founder: "this is just a version of dfs, but with a target. Let's build
// regular highest score dfs and golf dfs while we are at it." One league type
// — a classic league whose squads are rebuilt every week from the salary
// board — scored one of three ways (HIGHEST SCORE, GOLF, BULLSEYE), played
// head-to-head or on a leaderboard, with every classic commissioner option:
// the roster builder, scoped scoring, the pool filter, seat rules, HC/FB.
//
// Two pieces: the START screen (make one, or join one with its code) and the
// LEAGUE itself, with the rooms every league has —
//   MATCHUP   this week's squad and numbers (ContestSquad), any week's
//   LEAGUE    who's in, the week's standings and (a season league) the season's
//   MY TEAM   my weeks — score, rank — and my team's name
//   CHAT      league chat (0147), the same panel every league opens
//   SETTINGS  the rules, and leaving
//   COMMISH   the classic commissioner's console, trimmed, with a CONTEST card
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  contestLeague, contestBoard, bullseyeMyWeeks, createContestLeague, joinContest, contestState,
  setTeamName, leaveLeague, postLeagueListing,
  isAdmin, myFeatures, bullseyeMaxSeats, contestLeagueLine, friendlyError,
  type BullseyeLeague, type BullseyeLeagueBoard, type ContestMyWeek, type ContestInfo, type ContestKind, type ContestFormat, type DfsVariant, type BullseyeSpan,
} from '@drip/core/data/liveApi';
import { contestCard, contestTiebreak, CONTEST_WORD, CONTEST_FORMAT_WORD, CONTEST_EMOJI, CONTEST_BUDGET_DEFAULT, contestCredit } from '@drip/core/engine/contest';
import { ContestSquad, contestSetupOf } from './ContestSquad';
import { CommishDash } from './CommishDash';
import { LeagueStrip, type StripRoom } from '../app/LeagueStrip';
import { useWide } from './adminUi';

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean, dim = false): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--on-accent, var(--bg))' : dim ? 'var(--faint)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: `1px solid ${on ? 'var(--you)' : 'color-mix(in srgb, var(--you) 45%, var(--bd))'}`, borderRadius: 999, padding: '5px 12px',
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const label: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' };
const input: CSSProperties = { fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
const errStyle: CSSProperties = { fontSize: 11, color: 'var(--warn, #c66)' };
const n0 = (n: number) => n.toLocaleString('en-US');
const fmt$ = (n: number) => `$${n0(n)}`;
const joinLink = (code: string) => `${typeof window !== 'undefined' ? window.location.origin : 'https://dripfantasy.com'}/?bullseye=${encodeURIComponent(code)}`;
const copy = (s: string) => { try { void navigator.clipboard.writeText(s); } catch { /* ignore */ } };

export type BullseyeRoom = 'matchup' | 'league' | 'team' | 'settings' | 'commish';
type ContestLeague = BullseyeLeague & { kind?: string; bullseye?: ContestInfo };

const CONTEST_BLURB: Record<ContestKind, string> = {
  high: 'Each week everyone builds a squad under the budget from the week’s salary board. Most points wins.',
  golf: 'Each week everyone builds a squad under the budget. FEWEST points wins — but a scoreless spot banks a penalty, so no-shows are no bargain.',
  bullseye: 'Each week everyone builds a squad aimed at the week’s numbers. Closest wins.',
};
/** The budget as a form reads it: thousands, 10–500. */
const BUDGETS = [10000, 20000, 30000, 40000, 50000, 60000, 75000, 100000, 150000, 200000, 500000];

// ── start: make one, or join one ───────────────────────────────────────────
export function BullseyeStart({ initialCode, onOpen, onBack }: { initialCode?: string; onOpen: (leagueId: string) => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [contest, setContest] = useState<ContestKind>('high');
  const [format, setFormat] = useState<ContestFormat>('h2h');
  const [span, setSpan] = useState<BullseyeSpan>('season');
  const [variant, setVariant] = useState<DfsVariant>('slots');
  const [budget, setBudget] = useState(CONTEST_BUDGET_DEFAULT);
  const [max, setMax] = useState(12);
  const [cap, setCap] = useState(32);
  const [team, setTeam] = useState('');
  const [list, setList] = useState(true);
  const [blurb, setBlurb] = useState('');
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([isAdmin().catch(() => false), myFeatures().catch(() => ({} as Record<string, boolean>))])
      .then(([a, f]) => setCap(bullseyeMaxSeats(!!a, f))).catch(() => {});
  }, []);
  // HEAD-TO-HEAD pairs its seats: an even count, at most 32.
  const top = format === 'h2h' ? 32 : cap;
  const sizeOk = (n: number) => Math.max(2, Math.min(top, format === 'h2h' ? n - (n % 2) : n));
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await createContestLeague({ name, contest, format, span, max: sizeOk(max), budget, variant, teamName: team || null });
      if (!r.ok || !r.league_id) { setErr(r.error ?? 'Couldn’t make it.'); return; }
      if (list) await postLeagueListing(r.league_id, blurb.trim() || null, null).catch(() => {});
      onOpen(r.league_id);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const join = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await joinContest(code, team || null);
      if (!r.ok || !r.league_id) { setErr(r.error ?? 'Couldn’t join.'); return; }
      onOpen(r.league_id);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '14px 14px 60px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} className="mono" style={chip(false)}>← BACK</button>
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>{`${CONTEST_EMOJI[contest]} WEEKLY SQUAD LEAGUE`}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.5 }}>
        {CONTEST_BLURB[contest]} You run it: who’s in, the roster, the scoring, the budget, and whether it’s on the board.
      </div>
      {contestCredit(contest) && <CreditChip contest={contest} />}

      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div className="mono" style={label}>START ONE</div>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="League name" style={input} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="mono" style={small}>WINS BY</span>
          {(['high', 'golf', 'bullseye'] as const).map((c) => (
            <button key={c} onClick={() => setContest(c)} className="mono" style={chip(contest === c)}>{`${CONTEST_EMOJI[c]} ${CONTEST_WORD[c]}`}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="mono" style={small}>PLAYS</span>
          <button onClick={() => { setFormat('h2h'); setMax((m) => sizeOk(Math.min(m, 32))); }} className="mono" style={chip(format === 'h2h')}>HEAD-TO-HEAD</button>
          <button onClick={() => setFormat('board')} className="mono" style={chip(format === 'board')}>LEADERBOARD</button>
          <span className="mono" style={small}>{format === 'h2h' ? 'paired each week · wins and losses' : 'everyone ranked each week'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="mono" style={small}>RUNS</span>
          <button onClick={() => setSpan('season')} className="mono" style={chip(span === 'season')}>ALL SEASON</button>
          <button onClick={() => setSpan('week')} className="mono" style={chip(span === 'week')}>THIS WEEK ONLY</button>
        </div>
        {contest === 'bullseye' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="mono" style={small}>CARD</span>
            <button onClick={() => setVariant('slots')} className="mono" style={chip(variant === 'slots')}>SLOT TARGETS</button>
            <button onClick={() => setVariant('total')} className="mono" style={chip(variant === 'total')}>ONE TEAM TOTAL</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono" style={small}>BUDGET</span>
          <select value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mono" style={{ ...input, width: 130 }}>
            {BUDGETS.map((b) => <option key={b} value={b}>{fmt$(b)}</option>)}
          </select>
          <span className="mono" style={small}>per squad · the default nine spots (QB, 2 RB, 3 WR, TE, K, D/ST) — change the roster in COMMISH</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono" style={small}>{format === 'h2h' ? 'TEAMS (even, 2–32)' : `UP TO (2–${n0(cap)})`}</span>
          <input type="number" min={2} max={top} step={format === 'h2h' ? 2 : 1} value={max} onChange={(e) => setMax(Math.max(2, Math.min(top, Number(e.target.value) || 2)))} onBlur={() => setMax((m) => sizeOk(m))} style={{ ...input, width: 110 }} />
          <span className="mono" style={small}>{format === 'h2h' ? 'empty seats play as the CPU until someone takes them' : 'people'}</span>
        </div>
        <input value={team} onChange={(e) => setTeam(e.target.value)} maxLength={30} placeholder="Your team name (optional)" style={input} />
        <label className="mono" style={{ ...small, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={list} onChange={(e) => setList(e.target.checked)} /> POST IT ON THE LEAGUE BOARD SO ANYONE CAN FIND IT
        </label>
        {list && <input value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={200} placeholder="Board blurb (optional)" style={input} />}
        <button onClick={() => void create()} disabled={busy} className="mono" style={{ ...chip(true), justifySelf: 'start' }}>{busy ? 'MAKING IT…' : 'START THE LEAGUE →'}</button>
      </div>

      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div className="mono" style={label}>HAVE A CODE?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD1234" className="mono" style={{ ...input, flex: 1 }} />
          <button onClick={() => void join()} disabled={busy || code.trim().length < 4} className="mono" style={chip(true)}>JOIN</button>
        </div>
        <div className="mono" style={small}>Or find one on the league board — FIND on your leagues page.</div>
      </div>
      {err && <div className="mono" style={errStyle}>{err}</div>}
    </div>
  );
}

// ── the league ─────────────────────────────────────────────────────────────
export function BullseyeLeaguePage({ leagueId, initialRoom, onBack: _onBack, onGone }: {
  leagueId: string; initialRoom?: BullseyeRoom; onBack: () => void;
  /** Left or deleted: back to the leagues list, refreshed. */
  onGone: () => void;
}) {
  const [lg, setLg] = useState<ContestLeague | null>(null);
  const [room, setRoom] = useState<BullseyeRoom>(initialRoom ?? 'matchup');
  const [week, setWeek] = useState<number | null>(null);
  const wide = useWide(900);
  const load = useCallback(() => contestLeague(leagueId).then((r) => { setLg(r); return r; }), [leagueId]);
  useEffect(() => { void load().then((r) => { if (r.ok && r.week != null) setWeek((w) => w ?? r.week!); }).catch(() => {}); }, [load]);
  if (!lg) return <div className="mono" style={{ padding: 24, ...small }}>Loading…</div>;
  if (!lg.ok || !lg.bullseye) return <div style={{ padding: 24 }}><div className="mono" style={errStyle}>{lg.error ?? 'Couldn’t open the league.'}</div></div>;
  const b = lg.bullseye;
  // The weeks this league has played, plus the one in play: the MATCHUP and
  // standings arrows walk these.
  const weeks = [...new Set([...(lg.weeks ?? []), ...(lg.week != null ? [lg.week] : [])])].sort((x, y) => x - y);
  const seated = !!lg.me;
  // THE LEAGUE'S OWN FRAME (v0.663.2, founder: "Why does it have this skinny
  // stripped down league view. Match the other leagues please."): the hub's
  // header — crest, name, type line, COMMISH badge, ⚙ SETTINGS — and the
  // room bar every league has (LeagueStrip: LEAGUE · MATCHUP · MY TEAM ·
  // CHAT), at the hub's width.
  const strip: StripRoom | null = room === 'league' ? 'home' : room === 'matchup' ? 'matchup' : room === 'team' ? 'team' : null;
  return (
    <div style={{ maxWidth: wide ? 1080 : 560, margin: '0 auto', display: 'grid', gap: 12, paddingBottom: 24 }}>
      <LeagueStrip leagueId={leagueId} name={lg.name ?? 'Contest'} hideName rosterId={lg.me?.roster_id ?? null} native={false}
        here={strip} onGo={(r) => setRoom(r === 'home' ? 'league' : r === 'team' ? 'team' : 'matchup')} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="grotesk" style={{ width: 52, height: 52, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 24 }}>{CONTEST_EMOJI[b.contest ?? 'bullseye']}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lg.name}</div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2, letterSpacing: '0.06em' }}>{contestLeagueLine(b)}</div>
        </div>
        {lg.commish && (
          <button onClick={() => setRoom('commish')} className="mono" title="Commissioner tools"
            style={{ flex: 'none', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: room === 'commish' ? 'var(--on-accent, var(--bg))' : 'var(--you)', background: room === 'commish' ? 'var(--you)' : 'transparent', border: '1px solid var(--you)', borderRadius: 5, padding: '4px 8px', cursor: 'pointer' }}>COMMISH</button>
        )}
        <button onClick={() => setRoom('settings')} className="mono" title="League settings & info"
          style={{ flex: 'none', fontSize: 11, fontWeight: 700, color: room === 'settings' ? 'var(--you)' : 'var(--dim)', background: 'var(--bg)', border: `1px solid ${room === 'settings' ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 999, padding: '5px 12px', cursor: 'pointer' }}>
          ⚙ SETTINGS
        </button>
      </div>

      {room === 'matchup' && seated && (
        // Two columns on a wide screen, as the hub: the squad, and the
        // standings it is playing for.
        <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0, 3fr) minmax(0, 2fr)' : '1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <WeekArrows weeks={weeks} week={week} current={lg.week ?? null} onWeek={setWeek} />
            {week != null && <ContestSquad key={week} leagueId={leagueId} week={week} embedded onBack={() => setRoom('league')} />}
          </div>
          {wide && <div style={{ display: 'grid', gap: 12 }}><LeagueRoom lg={lg} weeks={weeks} week={week} onWeek={setWeek} compact /></div>}
        </div>
      )}
      {(room === 'league' || (room === 'matchup' && !seated) || (room === 'team' && !seated)) && <LeagueRoom lg={lg} weeks={weeks} week={week} onWeek={setWeek} />}
      {room === 'team' && seated && <TeamRoom leagueId={leagueId} lg={lg} onOpenWeek={(w) => { setWeek(w); setRoom('matchup'); }} onRenamed={() => void load()} />}
      {room === 'settings' && <SettingsRoom lg={lg} onLeft={onGone} />}
      {room === 'commish' && lg.commish && (
        // THE CLASSIC COMMISSIONER'S CONSOLE (v0.664.0, founder: "all the
        // classic league options"), trimmed by CommishDash/LeagueRow for a
        // contest league, with its CONTEST card (ContestCommish.tsx).
        <CommishDash focusId={leagueId} onBack={() => { setRoom('league'); void load(); }} onDeleted={onGone} />
      )}
    </div>
  );
}

// ── CREDIT WHERE IT'S DUE: the chip, and the line it opens ─────────────────
// A TINY "i" (founder: "Don't have the full idea chip, just a tiny i chip"):
// an 18px ring that opens the line beneath it.
function CreditChip({ contest }: { contest: ContestKind }) {
  const credit = contestCredit(contest);
  const [open, setOpen] = useState(false);
  if (!credit) return null;
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
      <button onClick={() => setOpen((o) => !o)} className="mono" title={credit.title} aria-label={credit.title} aria-expanded={open}
        style={{ width: 18, height: 18, borderRadius: 999, padding: 0, fontSize: 10, fontWeight: 700, fontStyle: 'italic', lineHeight: '16px', textAlign: 'center', cursor: 'pointer',
          color: open ? 'var(--on-accent, var(--bg))' : 'var(--faint)', background: open ? 'var(--you)' : 'transparent', border: `1px solid ${open ? 'var(--you)' : 'var(--bd)'}` }}>{credit.chip}</button>
      {open && <div style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.5 }}>{credit.line}</div>}
    </div>
  );
}

function WeekArrows({ weeks, week, current, onWeek }: { weeks: number[]; week: number | null; current: number | null; onWeek: (w: number) => void }) {
  if (week == null || weeks.length < 2) return null;
  const i = weeks.indexOf(week);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
      <button disabled={i <= 0} onClick={() => onWeek(weeks[i - 1])} className="mono" style={chip(false, i <= 0)}>◀</button>
      <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{`WEEK ${week}${week === current ? ' · THIS WEEK' : ''}`}</span>
      <button disabled={i < 0 || i >= weeks.length - 1} onClick={() => onWeek(weeks[i + 1])} className="mono" style={chip(false, i < 0 || i >= weeks.length - 1)}>▶</button>
    </div>
  );
}

// ── LEAGUE: who's in, the week, the season ─────────────────────────────────
function LeagueRoom({ lg, weeks, week, onWeek, compact }: { lg: ContestLeague; weeks: number[]; week: number | null; onWeek: (w: number) => void;
  /** Beside the squad (wide matchup): just the standings, no arrows or invite. */
  compact?: boolean }) {
  const [bd, setBd] = useState<BullseyeLeagueBoard | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => contestBoard(lg.league_id!, week).then((r) => { if (alive) setBd(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [lg.league_id, week]);
  const b = lg.bullseye!;
  const bull = b.contest === 'bullseye';
  const h2h = b.format === 'h2h';
  const flash = (k: string, s: string) => { copy(s); setCopied(k); setTimeout(() => setCopied(null), 1500); };
  return (
    <>
      {!compact && <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span><span style={{ fontSize: 22, fontWeight: 800, color: 'var(--you)' }}>{n0(b.seats_taken)}</span><span className="mono" style={small}>{` of ${n0(b.max_seats)} in`}</span></span>
          <span className="mono" style={small}>{b.span === 'week' ? `Week ${b.week} only` : `All season — every week’s ${bull ? 'ring' : 'score'} adds up`}</span>
          {lg.listed && <span className="mono" style={{ ...small, color: 'var(--you)' }}>ON THE BOARD</span>}
        </div>
        {lg.invite_code && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono" style={small}>INVITE CODE</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em' }}>{lg.invite_code}</span>
            <button onClick={() => flash('code', lg.invite_code!)} className="mono" style={chip(false)}>{copied === 'code' ? '✓ COPIED' : 'COPY'}</button>
            <button onClick={() => flash('link', joinLink(lg.invite_code!))} className="mono" style={chip(false)}>{copied === 'link' ? '✓ COPIED' : 'COPY LINK'}</button>
          </div>
        )}
        {bull && <CreditChip contest={b.contest} />}
      </div>}

      {!compact && <WeekArrows weeks={weeks} week={week} current={lg.week ?? null} onWeek={onWeek} />}
      <div style={{ ...card, display: 'grid', gap: 4 }}>
        <span className="mono" style={label}>{`WEEK ${bd?.week ?? week ?? ''} · ${bd?.entries ?? 0} ${bd?.entries === 1 ? 'SQUAD' : 'SQUADS'}${h2h ? ' · HEAD-TO-HEAD' : ''}`}</span>
        {bd && !bd.started && <span className="mono" style={small}>Squads and scores show once the week’s first game locks.</span>}
        {(bd?.rows ?? []).map((r) => (
          <div key={r.roster_id} className="mono" style={{ display: 'grid', gridTemplateColumns: bull ? '40px minmax(0,1fr) 100px 64px' : '40px minmax(0,1fr) 64px', gap: 8, fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--bd)', color: r.me ? 'var(--you)' : 'var(--text)', fontWeight: r.me ? 700 : 400 }}>
            <span>{r.rank}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.team_name ?? `Team ${r.roster_id}`}</span>
            {bull && <span style={{ textAlign: 'right', color: 'var(--faint)' }}>{`${Number(r.points).toFixed(1)} pts`}</span>}
            <span style={{ textAlign: 'right', fontWeight: 700 }}>{Number(r.ring).toFixed(1)}</span>
          </div>
        ))}
        {bd?.me && !(bd.rows ?? []).some((r) => r.me) && (
          <div className="mono" style={{ fontSize: 12, color: 'var(--you)', fontWeight: 700, paddingTop: 6, borderTop: '1px dashed var(--bd)' }}>{`You: #${bd.me.rank} · ${Number(bd.me.ring).toFixed(1)}`}</div>
        )}
      </div>

      {bd?.season && (
        <div style={{ ...card, display: 'grid', gap: 4 }}>
          <span className="mono" style={label}>SEASON STANDINGS</span>
          {bd.season.rows.map((r) => (
            <div key={r.roster_id} className="mono" style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) 90px 70px', gap: 8, fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--bd)', color: r.me ? 'var(--you)' : 'var(--text)', fontWeight: r.me ? 700 : 400 }}>
              <span>{r.rank}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.team_name ?? `Team ${r.roster_id}`}</span>
              <span style={{ textAlign: 'right', color: 'var(--faint)' }}>{`${r.weeks} wk${r.weeks === 1 ? '' : 's'}${r.best != null ? ` · best ${Number(r.best).toFixed(0)}` : ''}`}</span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{Number(r.total).toFixed(1)}</span>
            </div>
          ))}
          {bd.season.me && !bd.season.rows.some((r) => r.me) && (
            <div className="mono" style={{ fontSize: 12, color: 'var(--you)', fontWeight: 700, paddingTop: 6, borderTop: '1px dashed var(--bd)' }}>{`You: #${bd.season.me.rank} · ${Number(bd.season.me.total).toFixed(1)}`}</div>
          )}
        </div>
      )}
    </>
  );
}

// ── MY TEAM: my weeks, my name ─────────────────────────────────────────────
function TeamRoom({ leagueId, lg, onOpenWeek, onRenamed }: { leagueId: string; lg: ContestLeague; onOpenWeek: (w: number) => void; onRenamed: () => void }) {
  const [weeks, setWeeks] = useState<ContestMyWeek[] | null>(null);
  const [name, setName] = useState(lg.me?.team ?? '');
  const [note, setNote] = useState<string | null>(null);
  const [tbLine, setTbLine] = useState<string | null>(null);
  useEffect(() => { bullseyeMyWeeks(leagueId).then((r) => setWeeks(r.ok ? (r.weeks ?? []) as ContestMyWeek[] : [])).catch(() => setWeeks([])); }, [leagueId]);
  const rid = lg.me?.roster_id;
  const bull = lg.bullseye?.contest === 'bullseye';
  // My tie-break spot this week, known before I build (v0.660.1) — dealt
  // over the league's own spots, so it needs the state read.
  useEffect(() => {
    if (!bull || rid == null || lg.week == null) { setTbLine(null); return; }
    contestState(leagueId, lg.week).then((s) => {
      if (!s.ok) return;
      const { slots, catalog, labels } = contestSetupOf(s);
      const tb = contestTiebreak(leagueId, lg.week!, rid, contestCard(leagueId, lg.week!, slots, catalog), slots);
      setTbLine(tb ? `⚖️ This week’s tie-breaker: your ${labels[tb.slot]} aims at ${tb.target}.` : null);
    }).catch(() => {});
  }, [bull, leagueId, lg.week, rid]);
  const rename = async () => {
    if (rid == null) return;
    const r = await setTeamName(leagueId, rid, name).catch((e) => ({ ok: false, error: friendlyError(e) }));
    setNote(r.ok ? '✓ renamed' : (r.error ?? 'Didn’t rename.'));
    if (r.ok) onRenamed();
  };
  const total = (weeks ?? []).filter((w) => w.status === 'final').reduce((s, w) => s + Number(w.ring ?? 0), 0);
  const wl = useMemo(() => {
    const golf = lg.bullseye?.contest === 'golf';
    let w = 0, l = 0, t = 0;
    for (const x of weeks ?? []) {
      if (x.status !== 'final' || x.opp == null || x.ring == null || x.opp_ring == null) continue;
      const a = Number(x.ring), bb = Number(x.opp_ring);
      if (a === bb) t++; else if (golf ? a < bb : a > bb) w++; else l++;
    }
    return w + l + t ? `${w}–${l}${t ? `–${t}` : ''}` : null;
  }, [weeks, lg.bullseye?.contest]);
  return (
    <>
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div className="mono" style={label}>MY TEAM</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} style={{ ...input, flex: 1 }} />
          <button onClick={() => void rename()} disabled={!name.trim() || name.trim() === lg.me?.team} className="mono" style={chip(true)}>RENAME</button>
        </div>
        {note && <span className="mono" style={{ fontSize: 11, color: note.startsWith('✓') ? 'var(--you)' : 'var(--warn, #c66)' }}>{note}</span>}
        {tbLine && <div className="mono" style={{ ...small, color: 'var(--dim)' }}>{tbLine}</div>}
      </div>
      <div style={{ ...card, display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="mono" style={label}>MY WEEKS</span>
          <span className="mono" style={small}>{[wl ? `record ${wl}` : null, lg.bullseye?.span === 'season' ? `season ${total.toFixed(1)}` : null].filter(Boolean).join(' · ')}</span>
        </div>
        {weeks && !weeks.length && <span className="mono" style={small}>No squads yet — build this week’s on MATCHUP.</span>}
        {(weeks ?? []).map((w) => (
          <button key={w.week} onClick={() => onOpenWeek(w.week)} className="mono"
            style={{ display: 'grid', gridTemplateColumns: '70px minmax(0,1fr) 110px 64px', gap: 8, fontSize: 12, padding: '6px 0', background: 'none', border: 'none', borderTop: '1px solid var(--bd)', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
            <span>{`Week ${w.week}`}</span>
            <span style={{ color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.status === 'final' ? 'final' : w.status === 'live' ? 'live' : 'squad set'}{w.opp != null ? ` · vs ${w.opp_team ?? `Team ${w.opp}`}${w.opp_ring != null ? ` ${Number(w.opp_ring).toFixed(1)}` : ''}` : ''}</span>
            <span style={{ textAlign: 'right', color: 'var(--faint)' }}>{w.rank != null ? `#${w.rank} of ${n0(w.entries)}` : ''}</span>
            <span style={{ textAlign: 'right', fontWeight: 700 }}>{w.ring != null ? Number(w.ring).toFixed(1) : '—'}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ── SETTINGS: the rules, and leaving ───────────────────────────────────────
function SettingsRoom({ lg, onLeft }: { lg: ContestLeague; onLeft: () => void }) {
  const b = lg.bullseye!;
  const [err, setErr] = useState<string | null>(null);
  const [spotsLine, setSpotsLine] = useState<string | null>(null);
  useEffect(() => {
    contestState(lg.league_id!, lg.week).then((s) => {
      if (!s.ok) return;
      const { slots, labels } = contestSetupOf(s);
      setSpotsLine(slots.length ? `A squad of ${slots.length} — ${slots.map((d) => labels[d.slot]).join(', ')} — under a ${fmt$(b.budget)} budget, from the week’s salary board.` : null);
    }).catch(() => {});
  }, [lg.league_id, lg.week, b.budget]);
  const leave = async () => {
    if (!window.confirm(`Leave ${lg.name}? Your squads stay in the standings.`)) return;
    const r = await leaveLeague(lg.league_id!).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'Couldn’t leave.'); else onLeft();
  };
  const rule = b.contest === 'golf'
    ? 'Golf: the LOWEST score wins. A spot whose player posts nothing banks its penalty, so a no-show is no bargain.'
    : b.contest === 'high'
      ? 'The highest score wins.'
      : b.variant === 'total'
        ? `One number for the whole squad. Land your points close to it: dead-on doubles your score; any player who posts a zero costs ${b.radius}.`
        : `Every spot has its own number. Each player scores ${b.radius} for dead-on plus ${b.radius} more for a bullseye, less the farther off; a zero costs ${b.radius}.`;
  return (
    <div style={{ ...card, display: 'grid', gap: 10 }}>
      <div className="mono" style={label}>HOW THIS LEAGUE PLAYS</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--dim)', lineHeight: 1.6 }}>
        <li>{`${CONTEST_EMOJI[b.contest]} ${CONTEST_WORD[b.contest]} · ${CONTEST_FORMAT_WORD[b.format]}${b.format === 'h2h' ? ' — paired against one opponent each week' : ' — everyone ranked each week'}.`}</li>
        {spotsLine && <li>{spotsLine}</li>}
        <li>{rule}</li>
        <li>Each player locks an hour before his own game. Until then you can swap him.</li>
        {b.format === 'h2h' && <li>Your opponent’s picks are sealed: each shows once his game locks.</li>}
        {b.contest === 'bullseye' && <li>Ties are settled by your tie-breaker: one RB or WR spot with its own number, shown before you build. Closer wins.</li>}
        <li>{b.span === 'week' ? `It plays week ${b.week} only.` : `It plays every week. Season standings add up every week’s ${b.contest === 'bullseye' ? 'ring total' : 'score'}; a week without a squad scores nothing.`}</li>
        {contestCredit(b.contest) && <li>{`💡 ${contestCredit(b.contest)!.line}`}</li>}
      </ul>
      {lg.me && !lg.commish && (
        <button onClick={() => void leave()} className="mono" style={{ ...chip(false, true), justifySelf: 'start' }}>LEAVE THE LEAGUE</button>
      )}
      {err && <div className="mono" style={errStyle}>{err}</div>}
    </div>
  );
}
