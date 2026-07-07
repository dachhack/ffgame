// Native leagues: create a league in-app, draft it live, manage the roster.
// Three screens, all mounted as LiveOnboard views (no new global routes):
//   • NativeCreate — the "start a fresh league" wizard: creates the league,
//     seeds the draftable pool (baked-PBP players ranked by real production),
//     generates the round-robin schedule, and hands out the invite link.
//   • DraftRoom  — live snake draft: pick clock, autopick for absent/vacant
//     seats (any client's poll advances it via draft_tick), searchable board.
//   • TeamManage — roster, drops, free agents, waiver claims + waiver order.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PosPill, PlayerImg, Avatar, Img } from '../app/ui';
import type { Pos } from '../types';
import { buildDraftPool } from '../data/nativeLeague';
import { NFL_CODES } from '../data/kdst';
import { DRIP_AVATARS, dripAvatarUrl } from '../data/dripAvatars';
import { ADP_2026, ADP_AS_OF } from '../data/adp2026';
import { PROJ_2026, PROJ_AS_OF } from '../data/proj2026';
import { statsForSlug } from '../data/players';
import {
  createNativeLeague, createMockDraft, deleteMockDraft, seedLeaguePool, nativeGenerateSchedule,
  startDraft, draftState, makeDraftPick, draftTick,
  POS_CAP_KEYS, type PosCaps,
  leaguePool, nativeRosters, nativeTeamState, dropPlayer, addFreeAgent,
  submitWaiverClaim, cancelWaiverClaim, processWaivers, friendlyError,
  setTeamName, setTeamAvatar, setLeagueAvatar,
  setDraftQueue, myDraftQueue, setAutodraft,
  commishPauseDraft, commishResumeDraft, commishForcePick, commishUndoPick,
  nominate, placeBid, setLotProxy,
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
/** Cap stepper sentinel: values ≥ this render as ∞ and are stored as null. */
const CAP_UNLIMITED = 11;
const capsToPosCaps = (caps: Record<(typeof POS_CAP_KEYS)[number], number>): PosCaps =>
  Object.fromEntries(POS_CAP_KEYS.map((k) => [k, caps[k] >= CAP_UNLIMITED ? null : caps[k]])) as PosCaps;

/** "10 PM" from minutes-since-midnight ET. */
function fmtEtMin(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m % 60 ? ':' + String(m % 60).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Countdown text at any scale: "2d 4h", "7h 12m", "3:07". */
function fmtCountdown(secs: number): string {
  if (secs >= 86400) return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// ── Avatar picker: a preset gallery (no uploads to host) ─────────────────────
// First-party Drip art (72 tiles cut from the owner's avatar sheets, served
// from public/avatars/ on our own domain — no third-party avatar CDN) + the
// 32 NFL team logos.
function avatarOptions(): string[] {
  return [
    ...DRIP_AVATARS.map(dripAvatarUrl),
    ...NFL_CODES.map((code) => `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`),
  ];
}

function AvatarPicker({ title, onPick, onClose }: {
  title: string; onPick: (url: string | null) => void; onClose: () => void;
}) {
  const options = useMemo(() => avatarOptions(), []);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 420, maxHeight: '75vh', overflowY: 'auto' }}>
        <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 8, marginTop: 12 }}>
          {options.map((url) => (
            <button key={url} onClick={() => onPick(url)} title="use this avatar"
              style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, padding: 4, cursor: 'pointer', lineHeight: 0 }}>
              {/* a CDN that can't be reached shows a dim placeholder, not a broken image */}
              <Img src={url} size={44} radius={6} fallback={<div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--surface)', border: '1px dashed var(--bd)' }} />} />
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <button onClick={() => onPick(null)} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>remove avatar</button>
          <button onClick={onClose} className="mono" style={linkBtn}>cancel</button>
        </div>
      </div>
    </div>
  );
}

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
  // LEAGUE = the real thing (invites, schedule, season). MOCK = a practice
  // draft against named AI teams: same settings surface, no season behind it,
  // starts immediately and lands straight in the draft room.
  const [kind, setKind] = useState<'league' | 'mock'>('league');
  const [name, setName] = useState('');
  const [teams, setTeams] = useState(8);
  const [rounds, setRounds] = useState(12);
  const [clock, setClock] = useState(90);
  const [mode, setMode] = useState<'snake' | 'auction'>('snake');
  const [budget, setBudget] = useState(200);
  // Pace: LIVE = everyone in the room (seconds); SLOW = days-long drafts
  // (hour-scale clocks; queues + proxy bids keep turns fair while offline).
  const [pace, setPace] = useState<'live' | 'slow'>('live');
  const [clockHrs, setClockHrs] = useState(12);   // slow: pick/nomination window
  const [bellSecs, setBellSecs] = useState(15);   // live auction bell
  const [bellHrs, setBellHrs] = useState(8);      // slow auction bell
  const [maxLots, setMaxLots] = useState(1);      // auction: parallel lots
  const [nightOn, setNightOn] = useState(false);  // overnight quiet hours (ET)
  const [nightStart, setNightStart] = useState(22);
  const [nightEnd, setNightEnd] = useState(10);
  // Per-position roster limits. Stepping past CAP_MAX = no limit (∞, stored
  // null). Defaults mirror the pre-0071 hard-coded rules.
  const [caps, setCaps] = useState<Record<(typeof POS_CAP_KEYS)[number], number>>(
    { QB: 3, RB: CAP_UNLIMITED, WR: CAP_UNLIMITED, TE: 3, K: 1, DEF: 1 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ leagueId: string; rosterId: number; invite: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (busy || (kind === 'league' && !name.trim())) return;
    setBusy(true); setErr(null);
    try {
      const pickSecs = pace === 'slow' ? clockHrs * 3600 : clock;
      const lotSecs = pace === 'slow' ? bellHrs * 3600 : bellSecs;
      if (kind === 'mock') {
        // Mock: create vs the AI, seed the pool, start, straight into the room.
        setNote('Spinning up your AI opponents…');
        const r = await createMockDraft(teams, rounds, pickSecs, mode, budget, lotSecs,
          mode === 'auction' ? maxLots : 1, capsToPosCaps(caps));
        if (!r.ok || !r.league_id) { setErr(friendlyError(r.error ?? 'Could not create the mock draft.')); setBusy(false); return; }
        setNote('Building the 2026 player pool…');
        const pool = await seedLeaguePool(r.league_id, await buildDraftPool(setNote));
        if (!pool.ok) { setErr(friendlyError(pool.error ?? 'Could not seed the player pool.')); setBusy(false); return; }
        setNote('Starting the draft…');
        const started = await startDraft(r.league_id);
        if (!started.ok) { setErr(friendlyError(started.error ?? 'Could not start the draft.')); setBusy(false); return; }
        onDone(r.league_id, r.roster_id ?? 1);
        return;
      }
      setNote('Creating your league…');
      const r = await createNativeLeague(name, '2026', teams, rounds, pickSecs, mode, budget, lotSecs,
        mode === 'auction' ? maxLots : 1,
        nightOn ? nightStart * 60 : null, nightOn ? nightEnd * 60 : null, capsToPosCaps(caps));
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
        <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          {kind === 'mock' ? 'Run a mock draft' : 'Start a fresh league'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
          {kind === 'mock'
            ? 'Practice any draft format against AI teams. Nothing is kept — delete it when you’re done.'
            : 'Create it here, invite friends, draft in the app. No Sleeper / ESPN / Yahoo league required.'}
        </div>
      </div>
      <div style={card}>
        {/* real league vs a throwaway practice room against the AI */}
        <div className="mono" style={label}>WHAT ARE WE DRAFTING?</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 7, marginBottom: 16 }}>
          <Chip on={kind === 'league'} onClick={() => setKind('league')}>REAL LEAGUE</Chip>
          <Chip on={kind === 'mock'} onClick={() => setKind('mock')}>🤖 MOCK DRAFT</Chip>
        </div>
        {kind === 'league' && (
          <>
            <label className="mono" style={label}>LEAGUE NAME</label>
            <input value={name} autoFocus maxLength={40} onChange={(e) => { setName(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }} placeholder="e.g. Sunday Drip Society" style={{ ...input, marginTop: 7 }} />
          </>
        )}
        <div style={{ display: 'flex', gap: 18, marginTop: 16, flexWrap: 'wrap' }}>
          <div><div className="mono" style={label}>TEAMS</div><div style={{ marginTop: 7 }}>{num(teams, setTeams, 2, 14, 1)}</div></div>
          <div><div className="mono" style={label}>ROSTER SIZE</div><div style={{ marginTop: 7 }}>{num(rounds, setRounds, 5, 25, 1)}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="mono" style={label}>DRAFT TYPE</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
              <Chip on={mode === 'snake'} onClick={() => setMode('snake')}>SNAKE</Chip>
              <Chip on={mode === 'auction'} onClick={() => setMode('auction')}>AUCTION</Chip>
            </div>
          </div>
          <div>
            <div className="mono" style={label}>PACE</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
              <Chip on={pace === 'live'} onClick={() => setPace('live')}>⚡ LIVE</Chip>
              <Chip on={pace === 'slow'} onClick={() => setPace('slow')}>🐢 SLOW</Chip>
            </div>
          </div>
          {mode === 'auction' && <div><div className="mono" style={label}>BUDGET ($ / TEAM)</div><div style={{ marginTop: 7 }}>{num(budget, setBudget, 50, 1000, 25)}</div></div>}
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
          {pace === 'live'
            ? <div><div className="mono" style={label}>{mode === 'auction' ? 'NOMINATION CLOCK (SEC)' : 'PICK CLOCK (SEC)'}</div><div style={{ marginTop: 7 }}>{num(clock, setClock, 15, 600, 15)}</div></div>
            : <div><div className="mono" style={label}>{mode === 'auction' ? 'NOMINATION WINDOW (HRS)' : 'PICK CLOCK (HRS)'}</div><div style={{ marginTop: 7 }}>{num(clockHrs, setClockHrs, 1, 48, 1)}</div></div>}
          {mode === 'auction' && (pace === 'live'
            ? <div><div className="mono" style={label}>BID BELL (SEC)</div><div style={{ marginTop: 7 }}>{num(bellSecs, setBellSecs, 10, 60, 5)}</div></div>
            : <div><div className="mono" style={label}>BID WINDOW (HRS)</div><div style={{ marginTop: 7 }}>{num(bellHrs, setBellHrs, 1, 48, 1)}</div></div>)}
          {mode === 'auction' && <div><div className="mono" style={label}>LOTS AT ONCE</div><div style={{ marginTop: 7 }}>{num(maxLots, setMaxLots, 1, 4, 1)}</div></div>}
        </div>
        {/* roster limits — the max a roster may hold at each position. There is
            no positional starting lineup in Drip (the weekly board fields 8
            time-window slots, any position), so limits + roster size ARE the
            roster rules. ∞ = no limit; 0 bans the position. */}
        <div style={{ marginTop: 14 }}>
          <div className="mono" style={label}>ROSTER LIMITS — MAX PER POSITION (∞ = NO LIMIT)</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 7, flexWrap: 'wrap' }}>
            {POS_CAP_KEYS.map((k) => (
              <div key={k} style={{ textAlign: 'center' }}>
                <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>{posLabel(k)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                  <button onClick={() => setCaps({ ...caps, [k]: Math.max(0, caps[k] - 1) })} className="mono" style={{ ...ghostBtn, padding: '5px 9px' }}>−</button>
                  <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', minWidth: 24, textAlign: 'center' }}>{caps[k] >= CAP_UNLIMITED ? '∞' : caps[k]}</span>
                  <button onClick={() => setCaps({ ...caps, [k]: Math.min(CAP_UNLIMITED, caps[k] + 1) })} className="mono" style={{ ...ghostBtn, padding: '5px 9px' }}>＋</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
            Everyone fields 8 weekly starters (the game's kickoff windows — any position); the other {Math.max(0, rounds - 8)} roster spots are bench. K and D/ST are auto-filled late in every draft unless you set them to 0.
          </div>
        </div>
        {/* overnight quiet hours: clocks skip these ET hours entirely — no
            deadline can land (or expire) while the league sleeps. Mocks skip
            this — a practice room shouldn't sleep on you. */}
        {kind === 'league' && (
        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="mono" style={label}>OVERNIGHT PAUSE (ET)</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
              <Chip on={!nightOn} onClick={() => setNightOn(false)}>OFF</Chip>
              <Chip on={nightOn} onClick={() => setNightOn(true)}>🌙 ON</Chip>
            </div>
          </div>
          {nightOn && (
            <>
              <div><div className="mono" style={label}>FROM ({nightStart % 12 === 0 ? 12 : nightStart % 12} {nightStart < 12 ? 'AM' : 'PM'})</div><div style={{ marginTop: 7 }}>{num(nightStart, setNightStart, 0, 23, 1)}</div></div>
              <div><div className="mono" style={label}>UNTIL ({nightEnd % 12 === 0 ? 12 : nightEnd % 12} {nightEnd < 12 ? 'AM' : 'PM'})</div><div style={{ marginTop: 7 }}>{num(nightEnd, setNightEnd, 0, 23, 1)}</div></div>
            </>
          )}
        </div>
        )}
        {pace === 'slow' && (
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>
            Slow drafts run for days. Fairness is built in: any bid restarts the full bid window (no sniping), hidden max bids answer for you while you're away, and a missed turn nominates from your own queue.
          </div>
        )}
        <button onClick={create} disabled={busy || (kind === 'league' && !name.trim())} className="mono"
          style={{ ...btn, width: '100%', marginTop: 16, opacity: busy || (kind === 'league' && !name.trim()) ? 0.6 : 1 }}>
          {busy ? (note || 'CREATING…') : kind === 'mock' ? '🤖 START THE MOCK →' : 'CREATE LEAGUE →'}
        </button>
        {err && <div className="mono" style={errStyle}>{err}</div>}
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
          {kind === 'mock'
            ? 'You take seat 1; every other seat is an AI team that picks, nominates, and bids on its own. The draft starts the moment the room opens.'
            : 'You take seat 1 as commissioner. A 14-week head-to-head schedule is generated automatically; seats that stay empty are drafted and managed by the AI.'}
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player card: baked ADP + StatHead projection + real 2025 season line
// ─────────────────────────────────────────────────────────────────────────────
function PlayerCard({ p, onClose, action, queued, onQueue }: {
  p: LeaguePoolPlayer; onClose: () => void;
  action?: { label: string; run: () => void } | null;
  queued?: boolean; onQueue?: () => void;
}) {
  const adp = ADP_2026.get(p.slug);
  const proj = PROJ_2026.get(p.slug);
  const st = p.pos === 'K' || p.pos === 'DEF' ? null : statsForSlug(p.slug, p.pos as Pos);
  const stat = (label: string, v: string | number | null | undefined) => (
    v == null || v === '' ? null : (
      <div style={{ textAlign: 'center', minWidth: 60 }}>
        <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{v}</div>
        <div className="mono" style={{ fontSize: 7.5, letterSpacing: '0.12em', color: 'var(--faint)', marginTop: 2 }}>{label}</div>
      </div>
    )
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={56} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{p.full_name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <PosPill pos={p.pos as Pos} />
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{p.team}</span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>pool #{p.rank}</span>
            </div>
          </div>
          <button onClick={onClose} className="mono" style={{ ...linkBtn, fontSize: 14 }}>✕</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8, marginTop: 14, padding: '10px 0', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6 }}>
          {stat('ADP', adp != null ? adp.toFixed(1) : '—')}
          {stat('PROJ PPG', proj != null ? proj.toFixed(1) : '—')}
          {st && stat("'25 PPR", Math.round(st.ppr))}
          {st && stat("'25 GP", st.games)}
        </div>
        {st && (
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8, marginTop: 8, padding: '10px 0', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6 }}>
            {p.pos === 'QB' && <>{stat('PASS YDS', st.passYds)}{stat('PASS TD', st.passTds)}{stat('RUSH YDS', st.rushYds)}{stat('INT', st.ints)}</>}
            {p.pos === 'RB' && <>{stat('RUSH YDS', st.rushYds)}{stat('RUSH TD', st.rushTds)}{stat('REC', st.receptions)}{stat('REC YDS', st.recYds)}</>}
            {(p.pos === 'WR' || p.pos === 'TE') && <>{stat('REC', st.receptions)}{stat('REC YDS', st.recYds)}{stat('REC TD', st.recTds)}{stat('TGT', st.targets)}</>}
          </div>
        )}
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 8 }}>
          ADP: consensus {ADP_AS_OF} · projections: StatHead {PROJ_AS_OF} · 2025 line: real season totals
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {onQueue && <button onClick={onQueue} className="mono" style={{ ...ghostBtn, flex: 1 }}>{queued ? '★ QUEUED — REMOVE' : '☆ ADD TO QUEUE'}</button>}
          {action && <button onClick={action.run} className="mono" style={{ ...btn, flex: 1 }}>{action.label}</button>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft room
// ─────────────────────────────────────────────────────────────────────────────
type DraftTab = 'players' | 'board' | 'teams' | 'queue';

export function DraftRoom({ leagueId, onBack, onTeam }: {
  leagueId: string; onBack: () => void; onTeam: () => void;
}) {
  const [st, setSt] = useState<DraftState | null>(null);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [tab, setTab] = useState<DraftTab>('players');
  const [teamView, setTeamView] = useState<number | null>(null);
  const [cardFor, setCardFor] = useState<LeaguePoolPlayer | null>(null);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>('ALL');
  const [proxyDraft, setProxyDraft] = useState<Record<string, string>>({});   // per-lot hidden-max inputs
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
    nativeTeamState(leagueId).then((t) => {
      setTeam(t);
      if (t.my_roster_id != null) myDraftQueue(leagueId, t.my_roster_id).then(setQueue).catch(() => {});
    }).catch(() => {});
    const poll = setInterval(refresh, 3000);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => { clearInterval(poll); clearInterval(clock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Advance the room when ANY clock (nomination/pick or a lot's bell) is
  // overdue, or the acting seat is auto — draft_tick autopicks (snake), awards
  // due lots + auto-nominates (auction).
  const allDeadlines = [
    ...(st?.deadline_at ? [Date.parse(st.deadline_at)] : []),
    ...(st?.lots ?? []).map((l) => Date.parse(l.deadline_at)),
  ];
  const deadlineMs = allDeadlines.length ? Math.min(...allDeadlines) : null;
  const overdueMs = deadlineMs != null ? (now + skew.current) - deadlineMs : null;
  useEffect(() => {
    if (st?.status !== 'live' || st.paused || ticking.current) return;
    if ((overdueMs != null && overdueMs > 1200) || st.on_clock_auto) {
      ticking.current = true;
      // A failing tick must be VISIBLE: swallowing it leaves the room frozen at
      // 0:00 with nothing to go on. The 3s poll clears the banner on recovery.
      draftTick(leagueId).then((r) => {
        if (r.error) setErr(friendlyError(r.error));
        if ((r.autopicks ?? 0) + (r.lots_awarded ?? 0) > 0) refresh();
      }).catch(() => {})
        .finally(() => { ticking.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, st?.status, st?.on_clock, st?.lots?.length]);

  const byRoster = useMemo(() => {
    const m: Record<number, { team: string | null; avatar: string | null }> = {};
    for (const w of team?.waiver_order ?? []) m[w.roster_id] = { team: w.team, avatar: w.avatar ?? null };
    return m;
  }, [team]);
  const teamName = (rid: number | null | undefined) => (rid == null ? null : byRoster[rid]?.team ?? null);
  const poolBySlug = useMemo(() => new Map(pool.map((p) => [p.slug, p])), [pool]);
  const taken = useMemo(() => new Set((st?.picks ?? []).map((p) => p.slug)), [st?.picks]);
  const myRoster = team?.my_roster_id ?? null;
  const isCommish = !!team?.is_commish;
  const auction = st?.mode === 'auction';
  const myTurn = st?.status === 'live' && !st.paused && st.on_clock != null && st.on_clock === myRoster;
  const myBudget = auction ? st?.budgets?.find((b) => b.roster_id === myRoster) : null;

  // Position limits: grey out players my roster can't legally take (the server
  // enforces too — this just saves the round trip). Auction counts lots I hold.
  const myPosCount = useMemo(() => {
    const c: Record<string, number> = {};
    if (myRoster == null) return c;
    for (const pk of st?.picks ?? []) {
      if (pk.roster_id !== myRoster) continue;
      const p = poolBySlug.get(pk.slug)?.pos; if (p) c[p] = (c[p] ?? 0) + 1;
    }
    for (const l of st?.lots ?? []) {
      if (l.roster_id !== myRoster) continue;
      const p = poolBySlug.get(l.slug)?.pos; if (p) c[p] = (c[p] ?? 0) + 1;
    }
    return c;
  }, [st?.picks, st?.lots, myRoster, poolBySlug]);
  const atCap = (pos: string) => {
    const cap = st?.pos_caps?.[pos as keyof PosCaps];
    return cap != null && (myPosCount[pos] ?? 0) >= cap;
  };

  const avail = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((p) => !taken.has(p.slug)
      && (pos === 'ALL' || p.pos === pos)
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
  }, [pool, taken, q, pos]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { const r = await fn(); if (!r.ok) setErr(friendlyError(r.error ?? 'That didn’t work.')); await refresh(); }
    catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const saveQueue = (next: string[]) => {
    setQueue(next);
    if (myRoster != null) setDraftQueue(leagueId, myRoster, next).catch(() => {});
  };
  const toggleQueue = (slug: string) =>
    saveQueue(queue.includes(slug) ? queue.filter((s) => s !== slug) : [...queue, slug]);
  const moveQueue = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= queue.length) return;
    const next = queue.slice(); [next[i], next[j]] = [next[j], next[i]];
    saveQueue(next);
  };

  const act = (slug: string) => {
    if (!myTurn) return;   // auction: on_clock is null while the room is at lot capacity
    if (auction) run(() => nominate(leagueId, slug, 1));
    else run(() => makeDraftPick(leagueId, slug));
  };

  // Mock rooms are disposable — delete leaves the room, so don't refresh a
  // league that no longer exists (run() would).
  const deleteMock = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await deleteMockDraft(leagueId);
      if (r.ok) { onBack(); return; }
      setErr(friendlyError(r.error ?? 'Could not delete the mock.'));
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
  const nomMs = st.deadline_at ? Date.parse(st.deadline_at) : null;
  const nomSecsLeft = st.paused ? null : nomMs != null ? Math.max(0, Math.ceil((nomMs - (now + skew.current)) / 1000)) : null;
  const lotSecsLeft = (l: { deadline_at: string }) =>
    st.paused ? null : Math.max(0, Math.ceil((Date.parse(l.deadline_at) - (now + skew.current)) / 1000));

  const tabChip = (id: DraftTab, label: string) => (
    <Chip key={id} on={tab === id} onClick={() => setTab(id)}>{label}</Chip>
  );

  const pickRowsFor = (rid: number) => (st.picks ?? []).filter((p) => p.roster_id === rid);
  const shortName = (slug: string) => {
    const full = poolBySlug.get(slug)?.full_name ?? slug;
    const parts = full.split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : full;
  };

  return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>⛏ Draft room</div>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--faint)' }}>{auction ? 'AUCTION' : 'SNAKE'}</span>
        {st.is_mock && <span className="mono" title="practice room vs the AI — nothing is kept" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '2px 7px' }}>🤖 MOCK</span>}
        {st.paused && <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '2px 7px' }}>⏸ PAUSED</span>}
        {st.night && (
          <span className="mono" title="clocks skip these hours — deadlines never land overnight"
            style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', borderRadius: 4, padding: '2px 7px',
              color: st.night.is_night ? 'var(--warn)' : 'var(--faint)', border: `1px solid ${st.night.is_night ? 'var(--warn)' : 'var(--bd)'}` }}>
            🌙 {fmtEtMin(st.night.start_min)}–{fmtEtMin(st.night.end_min)} ET{st.night.is_night ? ' · quiet hours' : ''}
          </span>
        )}
      </div>

      {st.status === 'pending' && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Waiting to start</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
            {auction
              ? <>{st.rounds} roster spots · ${st.budget} budget per team · nomination rotates the draft order. Queue players now — empty seats auto-nominate.</>
              : <>{st.rounds} rounds · {st.pick_seconds}s per pick · snake order (randomized at start). Queue players now — your queue drafts for you if the clock runs out.</>}
          </div>
          {isCommish && <button onClick={() => run(() => startDraft(leagueId))} disabled={busy} className="mono" style={{ ...btn, width: '100%', marginTop: 12, opacity: busy ? 0.6 : 1 }}>▶ START THE DRAFT</button>}
          {isCommish && <button onClick={() => run(async () => seedLeaguePool(leagueId, await buildDraftPool()).then(async (r) => { setPool(await leaguePool(leagueId)); return r; }))} disabled={busy} className="mono" style={{ ...ghostBtn, width: '100%', marginTop: 8, opacity: busy ? 0.6 : 1 }}>↻ REFRESH PLAYER POOL (2026 ADP)</button>}
          {err && <div className="mono" style={errStyle}>{err}</div>}
        </div>
      )}

      {st.status === 'live' && (
        <div style={{ ...card, marginBottom: 12, borderLeft: '3px solid var(--you)' }}>
          {/* auction lots — up to max_lots run in parallel, each with its own bell */}
          {auction && (st.lots ?? []).map((lot, li) => {
            const lp = poolBySlug.get(lot.slug);
            const left = lotSecsLeft(lot);
            const iHold = lot.roster_id === myRoster;
            const canBidLot = myRoster != null && !iHold && (lot.my_max ?? 0) > lot.bid && !st.paused;
            const quick = canBidLot
              ? [lot.bid + 1, lot.bid + 5, lot.bid + 10].filter((a, i, arr) => a <= (lot.my_max ?? 0) && arr.indexOf(a) === i)
              : [];
            const pd = proxyDraft[lot.id] ?? '';
            return (
              <div key={lot.id} style={{ borderTop: li ? '1px solid var(--bd)' : 'none', paddingTop: li ? 10 : 0, marginTop: li ? 10 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <PlayerImg playerId={lot.slug} espnId={lp?.espn_id} team={lp?.team} pos={(lp?.pos ?? 'WR') as Pos} size={44} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{lp?.full_name ?? lot.slug}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 3 }}>
                      ${lot.bid} — {teamName(lot.roster_id) ?? `Team ${lot.roster_id}`}
                      {iHold && <span style={{ color: 'var(--you)', fontWeight: 700 }}> (you)</span>}
                    </div>
                  </div>
                  {left != null && (
                    <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: left <= 5 ? 'var(--opp)' : 'var(--you)' }}>
                      {fmtCountdown(left)}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {quick.map((a) => (
                    <button key={a} onClick={() => myRoster != null && run(() => placeBid(leagueId, myRoster, a, lot.id))} disabled={busy}
                      className="mono" style={{ ...btn, padding: '7px 12px' }}>BID ${a}</button>
                  ))}
                  {iHold && <span className="mono" style={{ fontSize: 10, color: 'var(--you)' }}>You're the high bidder.</span>}
                  {!iHold && (lot.my_max ?? 0) > 0 && <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>my max here ${lot.my_max}</span>}
                  {/* hidden max (proxy): answers rival bids second-price style
                      while you're away — nobody ever sees your ceiling */}
                  {myRoster != null && (lot.my_max ?? 0) > 0 && (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                      <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--faint)' }}>🕶 MAX</span>
                      {lot.my_proxy != null
                        ? <>
                            <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--you)' }}>${lot.my_proxy}</span>
                            <button onClick={() => run(() => setLotProxy(leagueId, myRoster, null, lot.id))} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>clear</button>
                          </>
                        : <>
                            <input value={pd} inputMode="numeric" placeholder="$"
                              onChange={(e) => setProxyDraft({ ...proxyDraft, [lot.id]: e.target.value.replace(/\D/g, '') })}
                              onKeyDown={(e) => { if (e.key === 'Enter' && pd) { run(() => setLotProxy(leagueId, myRoster, parseInt(pd, 10), lot.id)); setProxyDraft({ ...proxyDraft, [lot.id]: '' }); } }}
                              style={{ ...input, width: 60, padding: '5px 7px', fontSize: 11 }} />
                            <button onClick={() => { if (pd) { run(() => setLotProxy(leagueId, myRoster, parseInt(pd, 10), lot.id)); setProxyDraft({ ...proxyDraft, [lot.id]: '' }); } }}
                              disabled={busy || !pd} className="mono" style={{ ...ghostBtn, padding: '5px 9px', fontSize: 9 }}>SET</button>
                          </>}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* nomination / pick banner (auction shows it only when the room has
              lot capacity — on_clock is the next nominator then) */}
          {(!auction || st.on_clock != null) && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderTop: auction && (st.lots ?? []).length > 0 ? '1px solid var(--bd)' : 'none', paddingTop: auction && (st.lots ?? []).length > 0 ? 10 : 0, marginTop: auction && (st.lots ?? []).length > 0 ? 10 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {st.on_clock != null && (
                  <Avatar name={teamName(st.on_clock) ?? `Team ${st.on_clock}`} src={byRoster[st.on_clock]?.avatar} size={38} />
                )}
                <div>
                  <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--faint)' }}>
                    {auction ? `NOMINATION ${st.current_overall + (st.lots ?? []).length}` : `ROUND ${round} / ${st.rounds} · PICK ${st.current_overall}`}
                  </div>
                  <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: myTurn ? 'var(--you)' : 'var(--text)', marginTop: 4 }}>
                    {myTurn ? (auction ? 'YOUR NOMINATION — pick a player below' : 'YOUR PICK')
                      : `${auction ? 'Nominating' : 'On the clock'}: ${teamName(st.on_clock) ?? `Team ${st.on_clock} (auto)`}`}
                  </div>
                </div>
              </div>
              {nomSecsLeft != null && (
                <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: nomSecsLeft <= 10 ? 'var(--opp)' : 'var(--you)' }}>
                  {fmtCountdown(nomSecsLeft)}
                </div>
              )}
            </div>
          )}
          {auction && myBudget && (
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 8 }}>
              my budget ${myBudget.budget}{myBudget.committed > 0 ? ` · committed $${myBudget.committed}` : ''} · max new bid ${myBudget.max_bid} · {(st.lots ?? []).length}/{st.max_lots} lots open
            </div>
          )}
          {/* commish controls */}
          {isCommish && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
              <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--faint)', alignSelf: 'center' }}>⚑ COMMISH</span>
              {st.paused
                ? <button onClick={() => run(() => commishResumeDraft(leagueId))} disabled={busy} className="mono" style={{ ...ghostBtn, padding: '6px 10px', fontSize: 9.5 }}>▶ RESUME</button>
                : <button onClick={() => run(() => commishPauseDraft(leagueId))} disabled={busy} className="mono" style={{ ...ghostBtn, padding: '6px 10px', fontSize: 9.5 }}>⏸ PAUSE</button>}
              {!auction && <button onClick={() => run(() => commishForcePick(leagueId))} disabled={busy} className="mono" style={{ ...ghostBtn, padding: '6px 10px', fontSize: 9.5 }}>⏭ FORCE PICK</button>}
              {!auction && <button onClick={() => run(() => commishUndoPick(leagueId))} disabled={busy} className="mono" style={{ ...ghostBtn, padding: '6px 10px', fontSize: 9.5, color: 'var(--opp)' }}>↩ UNDO PICK</button>}
              {st.is_mock && <button onClick={deleteMock} disabled={busy} className="mono" style={{ ...ghostBtn, padding: '6px 10px', fontSize: 9.5, color: 'var(--opp)' }}>🗑 DELETE MOCK</button>}
            </div>
          )}
          {err && <div className="mono" style={errStyle}>{err}</div>}
        </div>
      )}

      {st.status === 'complete' && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--you)' }}>{st.is_mock ? 'Mock draft complete.' : 'Draft complete.'}</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
            {st.is_mock
              ? 'That was the whole show — review it on the BOARD and TEAMS tabs. Nothing carries into a season; delete the room when you’re done.'
              : 'Rosters are live and weekly lineup pools are built. Waivers and free agency are open.'}
          </div>
          {st.is_mock
            ? <button onClick={deleteMock} disabled={busy} className="mono" style={{ ...btn, width: '100%', marginTop: 12 }}>🗑 DELETE THIS MOCK</button>
            : <button onClick={onTeam} className="mono" style={{ ...btn, width: '100%', marginTop: 12 }}>⇄ MANAGE MY TEAM</button>}
          {isCommish && st.mode === 'snake' && (
            <button onClick={() => run(() => commishUndoPick(leagueId))} disabled={busy} className="mono" style={{ ...ghostBtn, width: '100%', marginTop: 8, fontSize: 9.5 }}>↩ UNDO LAST PICK (reopens the draft)</button>
          )}
        </div>
      )}

      {/* tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {tabChip('players', `PLAYERS (${avail.length})`)}
        {tabChip('board', 'BOARD')}
        {tabChip('teams', 'TEAMS')}
        {tabChip('queue', `☆ QUEUE (${queue.length})`)}
      </div>

      {/* PLAYERS — available list with ADP + projections */}
      {tab === 'players' && (
        <div style={card}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players or teams…" style={{ ...input, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {POS_FILTERS.map((p) => <Chip key={p} on={pos === p} onClick={() => setPos(p)}>{posLabel(p)}</Chip>)}
          </div>
          <div className="mono" style={{ display: 'flex', gap: 8, padding: '0 0 4px 38px', fontSize: 7.5, letterSpacing: '0.1em', color: 'var(--faint)' }}>
            <span style={{ flex: 1 }}>PLAYER</span><span style={{ width: 40, textAlign: 'right' }}>ADP</span><span style={{ width: 40, textAlign: 'right' }}>PROJ</span><span style={{ width: 84 }} />
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {avail.slice(0, 120).map((p) => {
              const adp = ADP_2026.get(p.slug); const proj = PROJ_2026.get(p.slug);
              const inQ = queue.includes(p.slug);
              return (
                <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
                  <button onClick={() => setCardFor(p)} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />
                    <PosPill pos={p.pos as Pos} />
                    <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>
                  </button>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', width: 40, textAlign: 'right' }}>{adp != null ? adp.toFixed(0) : '—'}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', width: 40, textAlign: 'right' }}>{proj != null ? proj.toFixed(1) : '—'}</span>
                  <button onClick={() => toggleQueue(p.slug)} title={inQ ? 'remove from queue' : 'add to queue'} className="mono"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: inQ ? 'var(--warn)' : 'var(--faint)', padding: '0 2px' }}>{inQ ? '★' : '☆'}</button>
                  <button onClick={() => act(p.slug)} disabled={!myTurn || busy || atCap(p.pos)} className="mono"
                    title={atCap(p.pos) ? `position limit reached (${posLabel(p.pos)})` : undefined}
                    style={{ ...btn, padding: '6px 10px', fontSize: 10, opacity: myTurn && !busy && !atCap(p.pos) ? 1 : 0.35 }}>
                    {atCap(p.pos) ? 'LIMIT' : auction ? 'NOM $1' : 'PICK'}
                  </button>
                </div>
              );
            })}
            {avail.length > 120 && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', padding: '8px 0' }}>…{avail.length - 120} more — narrow the search.</div>}
          </div>
        </div>
      )}

      {/* BOARD — the full rounds × teams grid */}
      {tab === 'board' && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: teams * 92 + 34 }}>
            <thead>
              <tr>
                <th className="mono" style={{ fontSize: 8, color: 'var(--faint)', padding: 4 }}>RD</th>
                {(st.order ?? []).map((rid) => (
                  <th key={rid} style={{ padding: 4 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <Avatar name={teamName(rid) ?? `Team ${rid}`} src={byRoster[rid]?.avatar} size={22} />
                      <span className="mono" style={{ fontSize: 8, color: rid === myRoster ? 'var(--you)' : 'var(--dim)', maxWidth: 84, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamName(rid) ?? `Team ${rid}`}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: st.rounds }, (_, r) => (
                <tr key={r}>
                  <td className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', padding: 4, textAlign: 'center' }}>{r + 1}</td>
                  {(st.order ?? []).map((rid, c) => {
                    // snake: even rounds flow right→left; auction: order-of-award per team
                    const cell = auction
                      ? pickRowsFor(rid)[r]
                      : (st.picks ?? []).find((pk) => pk.round === r + 1 && pk.roster_id === rid);
                    const overallHere = !auction && st.status === 'live'
                      && st.current_overall === r * teams + (r % 2 === 0 ? c + 1 : teams - c);
                    const pl = cell ? poolBySlug.get(cell.slug) : null;
                    return (
                      <td key={rid} style={{ padding: 3 }}>
                        <div style={{
                          width: 86, minHeight: 34, borderRadius: 5, padding: '4px 6px', boxSizing: 'border-box',
                          background: cell ? `var(--pos-${pl?.pos ?? 'WR'}-bg)` : 'var(--bg)',
                          border: `1px solid ${overallHere ? 'var(--you)' : 'var(--bd)'}`,
                          boxShadow: overallHere ? '0 0 8px color-mix(in srgb, var(--you) 45%, transparent)' : 'none',
                        }}>
                          {cell ? (
                            <>
                              <div style={{ fontSize: 9.5, fontWeight: 700, color: `var(--pos-${pl?.pos ?? 'WR'}-fg)`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(cell.slug)}</div>
                              <div className="mono" style={{ fontSize: 7.5, color: `var(--pos-${pl?.pos ?? 'WR'}-fg)`, opacity: 0.75 }}>
                                {pl?.pos ?? ''} {pl?.team ?? ''}{cell.price != null ? ` · $${cell.price}` : ''}{cell.auto ? ' 🤖' : ''}
                              </div>
                            </>
                          ) : <div className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{overallHere ? '⏱ on clock' : '—'}</div>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TEAMS — every roster so far */}
      {tab === 'teams' && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {(st.order ?? []).map((rid) => (
              <Chip key={rid} on={(teamView ?? myRoster) === rid} onClick={() => setTeamView(rid)}>
                {teamName(rid) ?? `Team ${rid}`}{auction && st.budgets ? ` $${st.budgets.find((b) => b.roster_id === rid)?.budget ?? ''}` : ''}
              </Chip>
            ))}
          </div>
          {(() => {
            const rid = teamView ?? myRoster ?? (st.order ?? [])[0];
            if (rid == null) return null;
            const rows = pickRowsFor(rid);
            return rows.length === 0
              ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No picks yet.</div>
              : rows.map((pk) => {
                const pl = poolBySlug.get(pk.slug);
                return (
                  <div key={pk.overall} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                    <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 30 }}>{auction ? `$${pk.price ?? 1}` : `R${pk.round}`}</span>
                    <PlayerImg playerId={pk.slug} espnId={pl?.espn_id} team={pl?.team} pos={(pl?.pos ?? 'WR') as Pos} size={24} />
                    <PosPill pos={(pl?.pos ?? 'WR') as Pos} />
                    <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{pl?.full_name ?? pk.slug}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{pl?.team}{pk.auto ? ' 🤖' : ''}</span>
                  </div>
                );
              });
          })()}
        </div>
      )}

      {/* QUEUE — my private wishlist + autodraft */}
      {tab === 'queue' && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div style={hdr}>MY QUEUE</div>
            {myRoster != null && (
              <Chip on={!!st.my_autodraft} onClick={() => run(() => setAutodraft(leagueId, myRoster, !st.my_autodraft))}>
                🤖 AUTODRAFT {st.my_autodraft ? 'ON' : 'OFF'}
              </Chip>
            )}
          </div>
          {queue.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>Empty — tap ☆ on any player. If your clock runs out (or autodraft is on), your queue picks for you, in order, before best-available.</div>}
          {queue.map((slug, i) => {
            const p = poolBySlug.get(slug);
            const gone = taken.has(slug);
            return (
              <div key={slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)', opacity: gone ? 0.45 : 1 }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 18 }}>{i + 1}</span>
                {p && <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />}
                <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, textDecoration: gone ? 'line-through' : 'none' }}>{p?.full_name ?? slug}</span>
                {gone && <span className="mono" style={{ fontSize: 8.5, color: 'var(--opp)' }}>TAKEN</span>}
                <button onClick={() => moveQueue(i, -1)} className="mono" style={{ ...linkBtn, padding: '0 3px' }}>↑</button>
                <button onClick={() => moveQueue(i, 1)} className="mono" style={{ ...linkBtn, padding: '0 3px' }}>↓</button>
                <button onClick={() => toggleQueue(slug)} className="mono" style={{ ...linkBtn, color: 'var(--opp)', padding: '0 3px' }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {cardFor && (
        <PlayerCard p={cardFor} onClose={() => setCardFor(null)}
          queued={queue.includes(cardFor.slug)} onQueue={() => toggleQueue(cardFor.slug)}
          action={myTurn && !taken.has(cardFor.slug) && !atCap(cardFor.pos)
            ? { label: auction ? 'NOMINATE $1' : 'DRAFT HIM', run: () => { const s = cardFor.slug; setCardFor(null); act(s); } }
            : null} />
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
  const [picking, setPicking] = useState<'team' | 'league' | null>(null);      // avatar picker target
  const [nameDraft, setNameDraft] = useState<string | null>(null);             // non-null ⇒ renaming
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

  // Team identity: avatar + name (self-serve), league crest (commissioner).
  // Rendered pre-draft too, so avatars are set before draft night shows them.
  const identityCard = myRoster != null && (
    <div style={{ ...card, marginBottom: 12, borderLeft: '3px solid var(--you)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => setPicking('team')} title="change avatar" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0 }}>
          <Avatar name={team.my_team ?? `Team ${myRoster}`} src={team.my_avatar} size={46} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          {nameDraft === null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{team.my_team ?? `Team ${myRoster}`}</span>
              <button onClick={() => setNameDraft(team.my_team ?? '')} className="mono" style={linkBtn}>✎ rename</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={nameDraft} autoFocus maxLength={40} onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && nameDraft.trim()) { run(() => setTeamName(leagueId, myRoster, nameDraft)); setNameDraft(null); } if (e.key === 'Escape') setNameDraft(null); }}
                style={{ ...input, padding: '7px 10px', fontSize: 13 }} />
              <button onClick={() => { if (nameDraft.trim()) { run(() => setTeamName(leagueId, myRoster, nameDraft)); } setNameDraft(null); }}
                disabled={busy || !nameDraft.trim()} className="mono" style={{ ...btn, padding: '7px 12px', fontSize: 10 }}>SAVE</button>
            </div>
          )}
          <button onClick={() => setPicking('team')} className="mono" style={{ ...linkBtn, color: 'var(--dim)', padding: 0, marginTop: 4 }}>change avatar</button>
        </div>
        {team.is_commish && (
          <button onClick={() => setPicking('league')} title="league crest (commissioner)"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <Avatar name="League" accent="var(--warn)" src={team.league_avatar} size={34} />
            <span className="mono" style={{ fontSize: 8, letterSpacing: '0.08em', color: 'var(--faint)' }}>LEAGUE ⚑</span>
          </button>
        )}
      </div>
    </div>
  );

  const pickers = (
    <>
      {picking === 'team' && myRoster != null && (
        <AvatarPicker title="Pick your team avatar"
          onPick={(url) => { setPicking(null); run(() => setTeamAvatar(leagueId, myRoster, url)); }}
          onClose={() => setPicking(null)} />
      )}
      {picking === 'league' && (
        <AvatarPicker title="Pick the league crest"
          onPick={(url) => { setPicking(null); run(() => setLeagueAvatar(leagueId, url)); }}
          onClose={() => setPicking(null)} />
      )}
    </>
  );

  if (team.draft_status !== 'complete') return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>⇄ Team management</div>
      {err && <div className="mono" style={{ ...errStyle, marginBottom: 10 }}>{err}</div>}
      {identityCard}
      <div style={card}>
        <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Rosters arrive at the draft</div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Waivers and free agency open once the draft is complete. Set your team name and avatar now — they show on the draft board.</div>
        <button onClick={onDraft} className="mono" style={{ ...btn, width: '100%', marginTop: 12 }}>⛏ TO THE DRAFT ROOM</button>
      </div>
      {pickers}
    </div>
  );

  const pendingClaims = team.my_claims.filter((c) => c.status === 'pending');
  const recentClaims = team.my_claims.filter((c) => c.status !== 'pending').slice(0, 5);

  return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>⇄ Team management</div>
      {err && <div className="mono" style={{ ...errStyle, marginBottom: 10 }}>{err}</div>}

      {identityCard}

      {/* my roster */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={hdr}>MY ROSTER ({mine.length}{cap != null ? `/${cap}` : ''})</div>
        {/* position usage vs the league's limits (∞ = uncapped) */}
        {team.pos_caps && mine.length > 0 && (
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginBottom: 6 }}>
            {POS_CAP_KEYS.map((k) =>
              `${posLabel(k)} ${mine.filter((p) => p.pos === k).length}/${team.pos_caps![k] ?? '∞'}`).join(' · ')}
          </div>
        )}
        {mine.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No players yet.</div>}
        {mine.map((p) => (
          <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
            <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />
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
                <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />
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
            <Avatar name={w.team ?? `Team ${w.roster_id}`} src={w.avatar} size={20} />
            <span style={{ fontSize: 12, color: w.roster_id === myRoster ? 'var(--you)' : 'var(--text)', fontWeight: w.roster_id === myRoster ? 700 : 400 }}>
              {w.team ?? `Team ${w.roster_id}`}
            </span>
          </div>
        ))}
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>Winning a claim sends you to the back of the line.</div>
      </div>

      {pickers}

      {/* roster full → choose a drop for the pending add */}
      {pendingAdd && (
        <div onClick={() => setPendingAdd(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 400, maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Roster full — drop who for {pendingAdd.full_name}?</div>
            {mine.map((p) => (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--bd)', marginTop: 6 }}>
                <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />
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
