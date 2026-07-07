// Native leagues: create a league in-app, draft it live, manage the roster.
// Three screens, all mounted as LiveOnboard views (no new global routes):
//   • NativeCreate — the "start a fresh league" wizard: creates the league,
//     seeds the draftable pool (baked-PBP players ranked by real production),
//     generates the round-robin schedule, and hands out the invite link.
//   • DraftRoom  — live snake draft: pick clock, autopick for absent/vacant
//     seats (any client's poll advances it via draft_tick), searchable board.
//   • TeamManage — roster, drops, free agents, waiver claims + waiver order.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PosPill } from '../app/ui';
import type { Pos } from '../types';
import { buildDraftPool } from '../data/nativeLeague';
import {
  createNativeLeague, seedLeaguePool, nativeGenerateSchedule,
  startDraft, draftState, makeDraftPick, draftTick,
  leaguePool, nativeRosters, nativeTeamState, dropPlayer, addFreeAgent,
  submitWaiverClaim, cancelWaiverClaim, processWaivers, friendlyError,
  type DraftState, type LeaguePoolPlayer, type NativeTeamState,
} from '../data/liveApi';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 };
const label: React.CSSProperties = { fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 };
const input: React.CSSProperties = { fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' };
const btn: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '11px 16px', cursor: 'pointer', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { ...btn, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const errStyle: React.CSSProperties = { fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 };
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 8 };

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const posLabel = (p: string) => (p === 'DEF' ? 'D/ST' : p);

function Chip({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="mono" style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
      color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--surface)',
      border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 999, padding: '5px 11px',
    }}>{children}</button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create wizard
// ─────────────────────────────────────────────────────────────────────────────
export function NativeCreate({ onDone, onBack }: {
  onDone: (leagueId: string, rosterId: number) => void; onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [teams, setTeams] = useState(8);
  const [rounds, setRounds] = useState(12);
  const [clock, setClock] = useState(90);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ leagueId: string; rosterId: number; invite: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setErr(null);
    try {
      setNote('Creating your league…');
      const r = await createNativeLeague(name, '2026', teams, rounds, clock);
      if (!r.ok || !r.league_id) { setErr(friendlyError(r.error ?? 'Could not create the league.')); setBusy(false); return; }
      setNote('Building the 2026 player pool…');
      const pool = await seedLeaguePool(r.league_id, await buildDraftPool(setNote));
      if (!pool.ok) { setErr(friendlyError(pool.error ?? 'Could not seed the player pool.')); setBusy(false); return; }
      setNote('Generating the season schedule…');
      const sched = await nativeGenerateSchedule(r.league_id, 14);
      if (!sched.ok) { setErr(friendlyError(sched.error ?? 'Could not build the schedule.')); setBusy(false); return; }
      setMade({ leagueId: r.league_id, rosterId: r.roster_id ?? 1, invite: r.invite_code ?? '' });
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  if (made) {
    const joinLink = `${window.location.origin}${window.location.pathname}?live=1&code=${made.invite}`;
    return (
      <div style={card}>
        <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, color: 'var(--you)' }}>League created.</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
          {name} · {teams} teams · {rounds}-round draft. Share the invite link — friends who open it sign in and grab an open seat. No other fantasy app needed.
        </div>
        <button onClick={() => { navigator.clipboard?.writeText(joinLink); setCopied(true); }}
          className="mono" style={{ ...btn, width: '100%', marginTop: 14 }}>{copied ? '✓ invite link copied' : '⛓ Copy invite link'}</button>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>
          Or share the code <span style={{ color: 'var(--text)', fontWeight: 700, letterSpacing: '0.1em' }}>{made.invite}</span>. Empty seats autodraft, so you can start whenever.
        </div>
        <button onClick={() => onDone(made.leagueId, made.rosterId)} className="mono" style={{ ...btn, width: '100%', marginTop: 14 }}>→ OPEN THE DRAFT ROOM</button>
      </div>
    );
  }

  const num = (v: number, set: (n: number) => void, min: number, max: number, step: number) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={() => set(Math.max(min, v - step))} className="mono" style={{ ...ghostBtn, padding: '7px 12px' }}>−</button>
      <span className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', minWidth: 42, textAlign: 'center' }}>{v}</span>
      <button onClick={() => set(Math.min(max, v + step))} className="mono" style={{ ...ghostBtn, padding: '7px 12px' }}>＋</button>
    </div>
  );

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Start a fresh league</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Create it here, invite friends, draft in the app. No Sleeper / ESPN / Yahoo league required.</div>
      </div>
      <div style={card}>
        <label className="mono" style={label}>LEAGUE NAME</label>
        <input value={name} autoFocus maxLength={40} onChange={(e) => { setName(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }} placeholder="e.g. Sunday Drip Society" style={{ ...input, marginTop: 7 }} />
        <div style={{ display: 'flex', gap: 18, marginTop: 16, flexWrap: 'wrap' }}>
          <div><div className="mono" style={label}>TEAMS</div><div style={{ marginTop: 7 }}>{num(teams, setTeams, 2, 14, 1)}</div></div>
          <div><div className="mono" style={label}>ROSTER SIZE</div><div style={{ marginTop: 7 }}>{num(rounds, setRounds, 5, 25, 1)}</div></div>
          <div><div className="mono" style={label}>PICK CLOCK (SEC)</div><div style={{ marginTop: 7 }}>{num(clock, setClock, 15, 600, 15)}</div></div>
        </div>
        <button onClick={create} disabled={busy || !name.trim()} className="mono"
          style={{ ...btn, width: '100%', marginTop: 16, opacity: busy || !name.trim() ? 0.6 : 1 }}>
          {busy ? (note || 'CREATING…') : 'CREATE LEAGUE →'}
        </button>
        {err && <div className="mono" style={errStyle}>{err}</div>}
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
          You take seat 1 as commissioner. A 14-week head-to-head schedule is generated automatically; seats that stay empty are drafted and managed by the AI.
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft room
// ─────────────────────────────────────────────────────────────────────────────
export function DraftRoom({ leagueId, onBack, onTeam }: {
  leagueId: string; onBack: () => void; onTeam: () => void;
}) {
  const [st, setSt] = useState<DraftState | null>(null);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>('ALL');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0); // serverNow − clientNow, for an honest countdown
  const ticking = useRef(false);

  const refresh = async () => {
    try {
      const s = await draftState(leagueId);
      if (s.error) { setErr(friendlyError(s.error)); return; }
      skew.current = Date.parse(s.server_now) - Date.now();
      setSt(s); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => {
    refresh();
    leaguePool(leagueId).then(setPool).catch(() => {});
    nativeTeamState(leagueId).then(setTeam).catch(() => {});
    const poll = setInterval(refresh, 4000);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => { clearInterval(poll); clearInterval(clock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Advance the draft when the on-clock seat is overdue (vacant seats, expired
  // clocks). draft_tick is idempotent + advisory-locked, so any member may call.
  const deadlineMs = st?.deadline_at ? Date.parse(st.deadline_at) : null;
  const overdueMs = deadlineMs != null ? (now + skew.current) - deadlineMs : null;
  useEffect(() => {
    if (st?.status !== 'live' || ticking.current) return;
    if ((overdueMs != null && overdueMs > 1500) || st.on_clock_auto) {
      ticking.current = true;
      draftTick(leagueId).then((r) => { if ((r.autopicks ?? 0) > 0) refresh(); }).catch(() => {})
        .finally(() => { ticking.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, st?.status, st?.on_clock]);

  const byRoster = useMemo(() => {
    const m: Record<number, { team: string | null }> = {};
    for (const w of team?.waiver_order ?? []) m[w.roster_id] = { team: w.team };
    return m;
  }, [team]);
  const teamName = (rid: number | null | undefined) => (rid == null ? null : byRoster[rid]?.team ?? null);
  const poolBySlug = useMemo(() => new Map(pool.map((p) => [p.slug, p])), [pool]);
  const taken = useMemo(() => new Set((st?.picks ?? []).map((p) => p.slug)), [st?.picks]);
  const myRoster = team?.my_roster_id ?? null;
  const myTurn = st?.status === 'live' && st.on_clock != null && st.on_clock === myRoster;

  const avail = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((p) => !taken.has(p.slug)
      && (pos === 'ALL' || p.pos === pos)
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
  }, [pool, taken, q, pos]);

  const mine = useMemo(() => (st?.picks ?? []).filter((p) => p.roster_id === myRoster), [st?.picks, myRoster]);

  const pick = async (slug: string) => {
    if (busy || !myTurn) return;
    setBusy(true); setErr(null);
    try {
      const r = await makeDraftPick(leagueId, slug);
      if (!r.ok) setErr(friendlyError(r.error ?? 'Could not make the pick.'));
      await refresh();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const begin = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await startDraft(leagueId);
      if (!r.ok) setErr(friendlyError(r.error ?? 'Could not start the draft.'));
      await refresh();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  // Pre-draft pool refresh: rebuilds from the live Sleeper directory + baked
  // 2026 ADP, picking up rookie signings / ADP moves since the league was
  // created. Commissioner-only (the RPC enforces it).
  const [reseedNote, setReseedNote] = useState<string | null>(null);
  const reseed = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setReseedNote(null);
    try {
      const players = await buildDraftPool(setReseedNote);
      const r = await seedLeaguePool(leagueId, players);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not refresh the pool.')); }
      else { setReseedNote(`Pool refreshed — ${r.players} players.`); setPool(await leaguePool(leagueId)); }
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  if (!st) return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)' }}>{err ?? 'Loading the draft…'}</div>
    </div>
  );

  const teams = st.order?.length ?? 0;
  const round = teams ? Math.min(st.rounds, Math.floor((st.current_overall - 1) / teams) + 1) : 1;
  const secsLeft = deadlineMs != null ? Math.max(0, Math.ceil((deadlineMs - (now + skew.current)) / 1000)) : null;
  const recent = (st.picks ?? []).slice(-4).reverse();

  return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>⛏ Draft room</div>

      {st.status === 'pending' && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Waiting to start</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
            {st.rounds} rounds · {st.pick_seconds}s per pick · snake order (randomized at start). Invite your league from the league card first — seats still empty when you start are drafted by the AI.
          </div>
          <button onClick={begin} disabled={busy} className="mono" style={{ ...btn, width: '100%', marginTop: 12, opacity: busy ? 0.6 : 1 }}>▶ START THE DRAFT</button>
          <button onClick={reseed} disabled={busy} className="mono" style={{ ...ghostBtn, width: '100%', marginTop: 8, opacity: busy ? 0.6 : 1 }}>↻ REFRESH PLAYER POOL (2026 ADP)</button>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8 }}>Commissioner only — everyone else sees the board light up. Refresh picks up ADP moves and free-agent signings since the league was created.</div>
          {reseedNote && <div className="mono" style={{ fontSize: 10, color: 'var(--you)', marginTop: 8 }}>{reseedNote}</div>}
          {err && <div className="mono" style={errStyle}>{err}</div>}
        </div>
      )}

      {st.status === 'live' && (
        <div style={{ ...card, marginBottom: 12, borderLeft: '3px solid var(--you)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--faint)' }}>ROUND {round} / {st.rounds} · PICK {st.current_overall}</div>
              <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: myTurn ? 'var(--you)' : 'var(--text)', marginTop: 4 }}>
                {myTurn ? 'YOUR PICK' : `On the clock: ${teamName(st.on_clock) ?? `Team ${st.on_clock} (auto)`}`}
              </div>
            </div>
            {secsLeft != null && (
              <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: secsLeft <= 10 ? 'var(--opp)' : 'var(--you)' }}>
                {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')}
              </div>
            )}
          </div>
          {recent.length > 0 && (
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 10, lineHeight: 1.6 }}>
              {recent.map((p) => (
                <div key={p.overall}>
                  #{p.overall} {teamName(p.roster_id) ?? `Team ${p.roster_id}`} → <span style={{ color: 'var(--text)' }}>{poolBySlug.get(p.slug)?.full_name ?? p.slug}</span>{p.auto ? ' 🤖' : ''}
                </div>
              ))}
            </div>
          )}
          {err && <div className="mono" style={errStyle}>{err}</div>}
        </div>
      )}

      {st.status === 'complete' && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--you)' }}>Draft complete.</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
            Rosters are live and weekly lineup pools are built. Run your team from the roster screen — waivers and free agency are open.
          </div>
          <button onClick={onTeam} className="mono" style={{ ...btn, width: '100%', marginTop: 12 }}>⇄ MANAGE MY TEAM</button>
        </div>
      )}

      {/* my roster so far */}
      {mine.length > 0 && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={hdr}>MY PICKS ({mine.length}/{st.rounds})</div>
          {mine.map((p) => {
            const pl = poolBySlug.get(p.slug);
            return (
              <div key={p.overall} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 30 }}>R{p.round}</span>
                <PosPill pos={(pl?.pos ?? 'WR') as Pos} />
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{pl?.full_name ?? p.slug}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{pl?.team}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* the board */}
      {st.status !== 'complete' && (
        <div style={card}>
          <div style={hdr}>AVAILABLE ({avail.length})</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players or teams…" style={{ ...input, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {POS_FILTERS.map((p) => <Chip key={p} on={pos === p} onClick={() => setPos(p)}>{posLabel(p)}</Chip>)}
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {avail.slice(0, 120).map((p) => (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 30 }}>#{p.rank}</span>
                <PosPill pos={p.pos as Pos} />
                <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', width: 34 }}>{p.team}</span>
                <button onClick={() => pick(p.slug)} disabled={!myTurn || busy} className="mono"
                  style={{ ...btn, padding: '6px 12px', fontSize: 10, opacity: myTurn && !busy ? 1 : 0.35 }}>PICK</button>
              </div>
            ))}
            {avail.length > 120 && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', padding: '8px 0' }}>…{avail.length - 120} more — narrow the search.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Team management — roster / free agents / waivers
// ─────────────────────────────────────────────────────────────────────────────
export function TeamManage({ leagueId, onBack, onDraft }: {
  leagueId: string; onBack: () => void; onDraft: () => void;
}) {
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [rosters, setRosters] = useState<{ roster_id: number; slug: string }[]>([]);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>('ALL');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<LeaguePoolPlayer | null>(null); // roster full → pick a drop
  const skew = useRef(0);

  const refresh = async () => {
    try {
      // Clearing due waiver claims first keeps this screen self-driving even
      // with no worker running (process_waivers is idempotent).
      await processWaivers(leagueId).catch(() => {});
      const [t, r, p] = await Promise.all([nativeTeamState(leagueId), nativeRosters(leagueId), leaguePool(leagueId)]);
      if (t.error) { setErr(friendlyError(t.error)); return; }
      skew.current = Date.parse(t.server_now) - Date.now();
      setTeam(t); setRosters(r); setPool(p); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const poolBySlug = useMemo(() => new Map(pool.map((p) => [p.slug, p])), [pool]);
  const rostered = useMemo(() => new Set(rosters.map((r) => r.slug)), [rosters]);
  const myRoster = team?.my_roster_id ?? null;
  const mine = useMemo(() => rosters.filter((r) => r.roster_id === myRoster)
    .map((r) => poolBySlug.get(r.slug)).filter(Boolean) as LeaguePoolPlayer[], [rosters, myRoster, poolBySlug]);
  const cap = team?.roster_cap ?? null;
  const full = cap != null && mine.length >= cap;

  const free = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((p) => !rostered.has(p.slug)
      && (pos === 'ALL' || p.pos === pos)
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
  }, [pool, rostered, q, pos]);

  const waivedFor = (p: LeaguePoolPlayer): number | null => {
    if (!p.waived_until) return null;
    const ms = Date.parse(p.waived_until) - (Date.now() + skew.current);
    return ms > 0 ? ms : null;
  };
  const fmtLeft = (ms: number) => {
    const h = Math.floor(ms / 3_600_000), m = Math.ceil((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { const r = await fn(); if (!r.ok) setErr(friendlyError(r.error ?? 'That didn’t work.')); await refresh(); }
    catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const doAdd = (p: LeaguePoolPlayer, dropSlug?: string) => {
    if (myRoster == null) return;
    setPendingAdd(null);
    const onWaivers = waivedFor(p) != null;
    return run(() => onWaivers
      ? submitWaiverClaim(leagueId, myRoster, p.slug, dropSlug)
      : addFreeAgent(leagueId, myRoster, p.slug, dropSlug));
  };
  const addOrClaim = (p: LeaguePoolPlayer) => { if (full) setPendingAdd(p); else doAdd(p); };

  if (!team) return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)' }}>{err ?? 'Loading your team…'}</div>
    </div>
  );

  if (team.draft_status !== 'complete') return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div style={card}>
        <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Rosters arrive at the draft</div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Waivers and free agency open once the draft is complete.</div>
        <button onClick={onDraft} className="mono" style={{ ...btn, width: '100%', marginTop: 12 }}>⛏ TO THE DRAFT ROOM</button>
      </div>
    </div>
  );

  const pendingClaims = team.my_claims.filter((c) => c.status === 'pending');
  const recentClaims = team.my_claims.filter((c) => c.status !== 'pending').slice(0, 5);

  return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>⇄ Team management</div>
      {err && <div className="mono" style={{ ...errStyle, marginBottom: 10 }}>{err}</div>}

      {/* my roster */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={hdr}>MY ROSTER ({mine.length}{cap != null ? `/${cap}` : ''})</div>
        {mine.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No players yet.</div>}
        {mine.map((p) => (
          <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
            <PosPill pos={p.pos as Pos} />
            <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', width: 34 }}>{p.team}</span>
            <button onClick={() => myRoster != null && run(() => dropPlayer(leagueId, myRoster, p.slug))} disabled={busy}
              className="mono" style={{ ...ghostBtn, padding: '5px 10px', fontSize: 9.5, color: 'var(--opp)' }}>DROP</button>
          </div>
        ))}
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>
          Dropped players sit on waivers for 24h (claims beat first-come). Roster changes apply from the next unlocked week — a week already underway keeps its lineup pool.
        </div>
      </div>

      {/* pending + recent claims */}
      {(pendingClaims.length > 0 || recentClaims.length > 0) && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={hdr}>MY WAIVER CLAIMS</div>
          {pendingClaims.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>
                ＋ {poolBySlug.get(c.add_slug)?.full_name ?? c.add_slug}
                {c.drop_slug && <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}> · dropping {poolBySlug.get(c.drop_slug)?.full_name ?? c.drop_slug}</span>}
              </span>
              <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 3, padding: '2px 5px' }}>PENDING</span>
              <button onClick={() => run(() => cancelWaiverClaim(c.id))} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>cancel</button>
            </div>
          ))}
          {recentClaims.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
              <span style={{ fontSize: 12, color: 'var(--dim)', flex: 1 }}>＋ {poolBySlug.get(c.add_slug)?.full_name ?? c.add_slug}{c.note ? ` — ${c.note}` : ''}</span>
              <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: c.status === 'won' ? 'var(--you)' : 'var(--faint)', border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 5px' }}>{c.status.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}

      {/* free agents / waiver wire */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={hdr}>PLAYER POOL ({free.length} available)</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players or teams…" style={{ ...input, marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {POS_FILTERS.map((p) => <Chip key={p} on={pos === p} onClick={() => setPos(p)}>{posLabel(p)}</Chip>)}
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {free.slice(0, 100).map((p) => {
            const left = waivedFor(p);
            return (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 30 }}>#{p.rank}</span>
                <PosPill pos={p.pos as Pos} />
                <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>
                {left != null && <span className="mono" style={{ fontSize: 8.5, color: 'var(--warn)' }} title="on waivers">⏳ {fmtLeft(left)}</span>}
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', width: 34 }}>{p.team}</span>
                <button onClick={() => addOrClaim(p)} disabled={busy || myRoster == null} className="mono"
                  style={{ ...btn, padding: '6px 10px', fontSize: 10, opacity: busy || myRoster == null ? 0.5 : 1 }}>
                  {left != null ? 'CLAIM' : 'ADD'}
                </button>
              </div>
            );
          })}
          {free.length > 100 && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', padding: '8px 0' }}>…{free.length - 100} more — narrow the search.</div>}
        </div>
      </div>

      {/* waiver order */}
      <div style={card}>
        <div style={hdr}>WAIVER ORDER</div>
        {[...team.waiver_order].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map((w, i) => (
          <div key={w.roster_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', width: 16 }}>{i + 1}</span>
            <span style={{ fontSize: 12, color: w.roster_id === myRoster ? 'var(--you)' : 'var(--text)', fontWeight: w.roster_id === myRoster ? 700 : 400 }}>
              {w.team ?? `Team ${w.roster_id}`}
            </span>
          </div>
        ))}
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>Winning a claim sends you to the back of the line.</div>
      </div>

      {/* roster full → choose a drop for the pending add */}
      {pendingAdd && (
        <div onClick={() => setPendingAdd(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 400, maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Roster full — drop who for {pendingAdd.full_name}?</div>
            {mine.map((p) => (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--bd)', marginTop: 6 }}>
                <PosPill pos={p.pos as Pos} />
                <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1 }}>{p.full_name}</span>
                <button onClick={() => doAdd(pendingAdd, p.slug)} disabled={busy} className="mono" style={{ ...ghostBtn, padding: '5px 10px', fontSize: 9.5, color: 'var(--opp)' }}>DROP</button>
              </div>
            ))}
            <div style={{ textAlign: 'center', marginTop: 12 }}><button onClick={() => setPendingAdd(null)} className="mono" style={linkBtn}>cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
