// DFS BULLSEYE, web (v0.660.0) — docs/dfs-bullseye.md.
//
// Three pieces: the open weekly contest's card on the leagues home (join,
// build, standings; the admin's SLOTS/TOTAL switch), the SQUAD screen — the
// builder before kickoff, the live darts after, for the open contest and for
// a salary-cap league playing Bullseye alike — and the contest's leaderboard.
//
// The builder is the salary-cap builder (PodBuilder) with the game changed:
// every slot carries the card's number, the pick sheet sorts by how close a
// projection lands to it, and the row previews what that projection would
// bank. Saving goes through save_bullseye_entry, which re-checks everything.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  bullseyeContest, joinBullseyeContest, saveBullseyeEntry, dfsBullseyeState, bullseyeContestBoard, setBullseyeContest,
  podSalaries, weekGameLocks, isAdmin, friendlyError, commishOverview, setDfsBullseye,
  type BullseyeContest, type DfsBullseyeState, type PodSalaryRow, type BullseyeBoardRow, type DfsVariant,
} from '@drip/core/data/liveApi';
import {
  DFS_SLOTS, DFS_CAP, DFS_MIN_SALARY, dfsCard, dfsSlotsOf, dfsSlotLabel, projectedRing, dfsBullseyeConfigOf,
  dfsTiebreak, tiebreakDistance, sealedSquadOf, type DfsSlot,
} from '@drip/core/engine/dfsBullseye';
import { ringLabel } from '@drip/core/engine/bullseye';
import { PlayerImg } from '../app/ui';
import { PodBuilder } from './PodBuilder';

const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean, dim = false): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--on-accent, var(--bg))' : dim ? 'var(--faint)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: `1px solid ${on ? 'var(--you)' : 'color-mix(in srgb, var(--you) 45%, var(--bd))'}`, borderRadius: 999, padding: '5px 12px',
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const VARIANT_WORD: Record<DfsVariant, string> = { slots: 'SLOT TARGETS', total: 'ONE TEAM TOTAL' };
const howTo = (v: DfsVariant, radius: number) => v === 'total'
  ? `Build a squad whose points land as close to the card's total as you can. Dead-on doubles your score; any player who posts a zero costs ${radius}.`
  : `Every slot has a number. Pick the player you think lands closest to it: ${radius} points for dead-on plus ${radius} more for a bullseye, less the farther off. A zero costs ${radius}.`;

// ── the leagues home ───────────────────────────────────────────────────────
export function BullseyeContestCard({ onOpen }: { onOpen: (leagueId: string, week: number) => void }) {
  const [c, setC] = useState<BullseyeContest | null>(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => bullseyeContest().then(setC).catch(() => {}), []);
  useEffect(() => { void load(); isAdmin().then((a) => setAdmin(!!a)).catch(() => {}); }, [load]);
  if (!c?.ok || !c.league_id || c.week == null) return null;
  const join = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await joinBullseyeContest();
      if (!r.ok || !r.league_id) { setErr(r.error ?? 'Couldn’t join.'); return; }
      onOpen(r.league_id, r.week ?? c.week!);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const switchVariant = async (v: DfsVariant) => {
    setBusy(true); setErr(null);
    const r = await setBullseyeContest(c.week!, v, c.radius ?? 10).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'Couldn’t change it.'); else await load();
    setBusy(false);
  };
  const entered = !!c.me?.entered;
  return (
    <div style={{ ...card, marginBottom: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>🎯 WEEKLY BULLSEYE</span>
        <span className="mono" style={small}>{`Week ${c.week} · ${VARIANT_WORD[c.variant ?? 'slots']} · ${c.entries ?? 0} ${c.entries === 1 ? 'entry' : 'entries'}`}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.45 }}>
        A $50,000 squad aimed at this week’s numbers, against everyone. Closest wins.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {c.me ? (
          <button onClick={() => onOpen(c.league_id!, c.week!)} className="mono" style={chip(!entered)}>
            {c.started ? (entered ? 'MY DARTS & STANDINGS' : 'STANDINGS') : entered ? 'EDIT MY SQUAD' : 'BUILD MY SQUAD'}
          </button>
        ) : (
          <button onClick={() => void join()} disabled={busy} className="mono" style={chip(true)}>{c.started ? 'JOIN — LATE GAMES STILL OPEN' : 'JOIN THIS WEEK'}</button>
        )}
        {admin && !c.started && (
          <span className="mono" style={{ ...small, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            ADMIN:
            {(['slots', 'total'] as const).map((v) => (
              <button key={v} disabled={busy} onClick={() => void switchVariant(v)} className="mono" style={chip(c.variant === v, true)}>{v.toUpperCase()}</button>
            ))}
          </span>
        )}
      </div>
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</div>}
    </div>
  );
}

// ── a salary-cap league: Bullseye squad or the plain builder ──────────────
/** The podbuild route asks this: a league playing Bullseye gets its squad
 *  screen, any other salary-cap league the builder it always had. */
export function SquadScreen(props: { leagueId: string; rosterId: number; week?: number; leagueName?: string; onBack: () => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [variant, setVariant] = useState<DfsVariant | null>(null);
  const [commish, setCommish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const read = useCallback(() => dfsBullseyeState(props.leagueId, props.week)
    .then((s) => { setOn(!!(s.ok && s.on)); setVariant(s.ok && s.on ? s.variant ?? 'slots' : null); })
    .catch(() => setOn(false)), [props.leagueId, props.week]);
  useEffect(() => {
    void read();
    commishOverview().then((ls) => setCommish(ls.some((l) => l.league_id === props.leagueId))).catch(() => {});
  }, [read, props.leagueId]);
  if (on === null) return <div className="mono" style={{ padding: 24, ...small }}>Loading…</div>;
  // THE COMMISSIONER'S SWITCH (0462) for a league made before Bullseye, or
  // one that wants it off again — refused while a week is being played.
  const pick = async (v: DfsVariant | null) => {
    setBusy(true); setErr(null);
    const r = await setDfsBullseye(props.leagueId, v).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'Couldn’t change it.'); else await read();
    setBusy(false);
  };
  const sw = commish && (
    <div style={{ maxWidth: 760, margin: '10px auto 0', padding: '0 14px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="mono" style={small}>COMMISSIONER · 🎯 BULLSEYE</span>
      {([[null, 'OFF'], ['slots', 'SLOTS'], ['total', 'TOTAL']] as const).map(([v, l]) => (
        <button key={l} disabled={busy} onClick={() => void pick(v)} className="mono" style={chip(variant === v, true)}>{l}</button>
      ))}
      {err && <span className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</span>}
    </div>
  );
  return <>{sw}{on ? <BullseyeSquad key={variant ?? 'off'} leagueId={props.leagueId} week={props.week} onBack={props.onBack} /> : <PodBuilder {...props} />}</>;
}

// ── the squad ──────────────────────────────────────────────────────────────
export function BullseyeSquad({ leagueId, week: weekProp, onBack, embedded }: { leagueId: string; week?: number; onBack: () => void;
  /** Inside a Bullseye league's own frame (v0.663.2): no back row, no outer padding. */
  embedded?: boolean }) {
  const [st, setSt] = useState<DfsBullseyeState | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[] | null>(null);
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [picks, setPicks] = useState<Record<DfsSlot, string | null>>(() => dfsSlotsOf(null));
  const [active, setActive] = useState<DfsSlot | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const load = useCallback(async () => {
    const s = await dfsBullseyeState(leagueId, weekProp);
    setSt(s);
    if (!s.ok || !s.on || s.week == null) return;
    setPicks(dfsSlotsOf(s.entry));
    const [rows, lk] = await Promise.all([podSalaries(s.week).catch(() => []), weekGameLocks(s.week).catch(() => new Map<string, number>())]);
    setBoard(rows); setLocks(lk);
  }, [leagueId, weekProp]);
  useEffect(() => { void load().catch((e) => setNote(friendlyError(e))); }, [load]);
  // Live darts: re-read while the week is being played.
  useEffect(() => {
    if (!st?.started || st.matchup?.status === 'final') return;
    const id = setInterval(() => { void dfsBullseyeState(leagueId, weekProp).then(setSt).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [st?.started, st?.matchup?.status, leagueId, weekProp]);

  const bySlug = useMemo(() => new Map((board ?? []).map((r) => [r.slug, r])), [board]);
  const cfg = st?.on ? dfsBullseyeConfigOf({ dfs_bullseye: true, bullseye: st.variant, bullseye_radius: st.radius }) : null;
  const theCard = useMemo(() => (st?.week != null ? dfsCard(leagueId, st.week) : null), [leagueId, st?.week]);
  const locked = (slug: string | null) => { if (!slug) return false; const t = locks.get(bySlug.get(slug)?.team ?? ''); return t != null && t <= now; };
  const spent = Object.values(picks).reduce((s, slug) => s + (slug ? bySlug.get(slug)?.salary ?? 0 : 0), 0);
  const filled = Object.values(picks).filter(Boolean).length;
  const projTotal = Object.values(picks).reduce((s, slug) => s + (slug ? bySlug.get(slug)?.proj ?? 0 : 0), 0);

  if (!st) return <div className="mono" style={{ padding: 24, ...small }}>Loading…</div>;
  if (!st.ok) return <div style={{ padding: 24 }}><div className="mono" style={{ color: 'var(--warn, #c66)', fontSize: 12 }}>{st.error}</div><button onClick={onBack} style={{ marginTop: 10 }}>← BACK</button></div>;
  if (!st.on || !cfg || !theCard) return <div style={{ padding: 24 }}><div className="mono" style={small}>This league doesn’t play Bullseye.</div><button onClick={onBack}>← BACK</button></div>;

  const isTotal = cfg.variant === 'total';
  const mySide: 'home' | 'away' = st.matchup && st.matchup.home !== st.roster_id ? 'away' : 'home';
  const live = st.state?.slots?.filter((r) => r.side === mySide) ?? [];
  const liveOf = (slot: string) => live.find((r) => r.slot === slot);
  const myRing = st.matchup?.status === 'final' ? (mySide === 'home' ? st.matchup.home_final : st.matchup.away_final) : st.state ? (mySide === 'home' ? st.state.home : st.state.away) : null;
  const theirRing = st.opponent && st.state ? (mySide === 'home' ? st.state.away : st.state.home) : null;
  const myPoints = live.reduce((s, r) => s + (r.score || 0), 0);
  const editable = st.matchup?.status !== 'final';
  // THE TIE-BREAKER (v0.660.1): my own spot and number, known before I build.
  const myTb = st.roster_id != null && st.week != null ? dfsTiebreak(leagueId, st.week, st.roster_id, theCard) : null;
  const tbLive = myTb ? liveOf(myTb.slot) : undefined;
  const myTbDist = st.matchup?.status === 'final'
    ? (mySide === 'home' ? st.matchup.home_tb : st.matchup.away_tb) ?? null
    : tbLive ? tiebreakDistance(tbLive.score, myTb!.target, cfg.radius) : null;
  const tieBroken = st.matchup?.status === 'final' && st.opponent && myRing != null && theirRing != null && Math.abs(Number(myRing) - Number(theirRing)) < 0.0101 && Number(myRing) !== Number(theirRing);
  const theirSquad = st.opponent ? sealedSquadOf(st.opponent.entry) : [];

  const save = async () => {
    if (st.week == null) return;
    if (filled < 9) { setNote('Fill all nine slots first.'); return; }
    setBusy(true); setNote(null);
    try {
      const r = await saveBullseyeEntry(leagueId, st.week, picks as Record<string, string>);
      setNote(r.ok ? '✓ squad saved' : (r.error ?? 'Didn’t save.'));
      if (r.ok) await load();
    } catch (e) { setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const candidates = (slot: DfsSlot) => {
    const pos = DFS_SLOTS.find((d) => d.slot === slot)!.pos[0];
    const target = theCard.targets[slot];
    const taken = new Set(Object.entries(picks).filter(([s, v]) => s !== slot && v).map(([, v]) => v));
    const room = DFS_CAP - spent + (picks[slot] ? bySlug.get(picks[slot]!)?.salary ?? 0 : 0) - (9 - filled - (picks[slot] ? 0 : 1)) * DFS_MIN_SALARY;
    const needle = search.trim().toLowerCase();
    return (board ?? [])
      .filter((r) => r.pos === pos && !taken.has(r.slug) && (!needle || r.name.toLowerCase().includes(needle) || r.team.toLowerCase().includes(needle)))
      .map((r) => ({ r, dist: Math.abs(r.proj - target), afford: r.salary <= room, lock: locked(r.slug) }))
      .sort((a, b) => (isTotal ? b.r.proj - a.r.proj : a.dist - b.dist) || a.r.salary - b.r.salary);
  };

  return (
    <div style={embedded ? { display: 'grid', gap: 12 } : { maxWidth: 760, margin: '0 auto', padding: '14px 14px 60px', display: 'grid', gap: 12 }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={onBack} className="mono" style={chip(false)}>← BACK</button>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>🎯 {st.name ?? 'BULLSEYE'}</span>
          <span className="mono" style={small}>{`Week ${st.week} · ${VARIANT_WORD[cfg.variant]}`}</span>
        </div>
      )}

      {/* the card */}
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>THIS WEEK’S CARD</span>
          {isTotal && <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--you)' }}>{theCard.total}</span>}
        </div>
        {!isTotal && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DFS_SLOTS.map((d) => (
              <span key={d.slot} className="mono" style={{ fontSize: 11, border: '1px solid var(--bd)', borderRadius: 6, padding: '3px 8px' }}>
                {dfsSlotLabel(d.slot)} <b style={{ color: 'var(--you)' }}>{theCard.targets[d.slot]}</b>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.45 }}>{howTo(cfg.variant, cfg.radius)}</div>
        {myTb && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
            ⚖️ TIE-BREAKER: your <b style={{ color: 'var(--you)' }}>{dfsSlotLabel(myTb.slot)}</b> aims at <b style={{ color: 'var(--you)' }}>{myTb.target}</b> — it only counts if you tie, and closer wins.
            {myTbDist != null && <span>{` Now ${myTbDist.toFixed(1)} off.`}</span>}
          </div>
        )}
      </div>

      {/* the score, once the week is on */}
      {st.started && (
        <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>{st.matchup?.status === 'final' ? 'FINAL' : 'LIVE'}</span>
          <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--you)' }}>{myRing != null ? Number(myRing).toFixed(1) : '—'}</span>
          <span className="mono" style={small}>{`${myPoints.toFixed(1)} pts${isTotal ? ` · target ${theCard.total} · ${Math.abs(myPoints - theCard.total).toFixed(1)} off` : ''}`}</span>
          {st.opponent && (
            <span className="mono" style={{ ...small, marginLeft: 'auto' }}>{`vs ${st.opponent.team ?? 'opponent'} · ${theirRing != null ? Number(theirRing).toFixed(1) : '—'}`}</span>
          )}
          {tieBroken && (
            <span className="mono" style={{ ...small, flexBasis: '100%' }}>{`Tied on rings — settled by the tie-breaker (${myTbDist?.toFixed(1) ?? '—'} off vs ${(mySide === 'home' ? st.matchup!.away_tb : st.matchup!.home_tb)?.toFixed(1) ?? '—'} off).`}</span>
          )}
        </div>
      )}

      {/* the squad */}
      <div style={{ ...card, display: 'grid', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>MY SQUAD</span>
          <span className="mono" style={{ fontSize: 11, color: spent > DFS_CAP ? 'var(--warn, #c66)' : 'var(--dim)' }}>
            {`${fmt$(spent)} / ${fmt$(DFS_CAP)}${isTotal && !st.started ? ` · projects ${projTotal.toFixed(1)} vs ${theCard.total}` : ''}`}
          </span>
        </div>
        {DFS_SLOTS.map((d) => {
          const slug = picks[d.slot];
          const p = slug ? bySlug.get(slug) : null;
          const target = theCard.targets[d.slot];
          const lv = liveOf(d.slot);
          const isLocked = locked(slug);
          return (
            <div key={d.slot} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr) 92px', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--bd)' }}>
              <button onClick={() => { if (editable && !isLocked) { setActive(d.slot); setSearch(''); } }} disabled={!editable || isLocked} className="mono"
                style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 4px', cursor: editable && !isLocked ? 'pointer' : 'default', color: 'var(--text)' }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{dfsSlotLabel(d.slot)}</div>
                {!isTotal && <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--you)' }}>{target}</div>}
                {myTb?.slot === d.slot && <div title="tie-breaker" style={{ fontSize: 9, color: 'var(--dim)' }}>{`⚖️ ${myTb.target}`}</div>}
              </button>
              {p ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <PlayerImg playerId={p.slug} team={p.team} pos={p.pos} size={28} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}{isLocked ? ' 🔒' : ''}</div>
                    <div className="mono" style={small}>{`${p.team} · ${fmt$(p.salary)} · proj ${p.proj.toFixed(1)}`}</div>
                  </div>
                </div>
              ) : (
                <button onClick={() => { if (editable) { setActive(d.slot); setSearch(''); } }} disabled={!editable} className="mono"
                  style={{ background: 'none', border: 'none', textAlign: 'left', color: 'var(--you)', cursor: 'pointer', fontSize: 12 }}>+ PICK {dfsSlotLabel(d.slot)}</button>
              )}
              <div className="mono" style={{ textAlign: 'right' }}>
                {lv ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{lv.score.toFixed(1)}</div>
                    {lv.aim && <div style={{ fontSize: 9.5, color: lv.aim.ring > 0 ? 'var(--you)' : 'var(--faint)' }}>{`${ringLabel(lv.aim.dist, cfg.radius)} +${lv.aim.ring}`}</div>}
                  </>
                ) : p && !isTotal ? (
                  <div style={small}>{`aims ${projectedRing(p.proj, target, cfg.radius).toFixed(1)}`}</div>
                ) : null}
              </div>
            </div>
          );
        })}
        {editable && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => void save()} disabled={busy || filled < 9 || spent > DFS_CAP} className="mono" style={chip(true)}>SAVE SQUAD</button>
            <span className="mono" style={small}>{filled < 9 ? `${9 - filled} to fill · ${fmt$(DFS_CAP - spent)} left` : `${fmt$(DFS_CAP - spent)} left`}</span>
            {note && <span className="mono" style={{ fontSize: 11, color: note.startsWith('✓') ? 'var(--you)' : 'var(--warn, #c66)' }}>{note}</span>}
          </div>
        )}
      </div>

      {/* THEIR SQUAD, SEALED (v0.660.1): each player shows once his game locks. */}
      {st.opponent && (
        <div style={{ ...card, display: 'grid', gap: 2 }}>
          <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', marginBottom: 4 }}>{`${(st.opponent.team ?? 'OPPONENT').toUpperCase()}’S SQUAD`}</span>
          {theirSquad.map((r) => {
            const lv = st.state?.slots?.find((x) => x.side !== mySide && x.slot === r.slot);
            const p = r.slug ? bySlug.get(r.slug) : null;
            return (
              <div key={r.slot} className="mono" style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) 70px', gap: 8, fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                <span style={{ color: 'var(--faint)' }}>{dfsSlotLabel(r.slot)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.slug ? 'var(--text)' : 'var(--faint)' }}>{r.slug ? (p?.name ?? r.slug) : '🔒 sealed until his game locks'}</span>
                <span style={{ textAlign: 'right' }}>{lv ? lv.score.toFixed(1) : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {st.kind === 'bullseye' && !embedded && <BullseyeLeaderboard leagueId={leagueId} />}

      {/* the pick sheet */}
      {active && (
        <div onClick={() => setActive(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(640px, 100%)', maxHeight: '80vh', overflowY: 'auto', borderRadius: '12px 12px 0 0', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{dfsSlotLabel(active)}{!isTotal ? ` · aim at ${theCard.targets[active]}` : ''}</span>
              <span style={{ flex: 1 }} />
              {picks[active] && <button onClick={() => { setPicks({ ...picks, [active]: null }); setActive(null); }} className="mono" style={chip(false, true)}>CLEAR</button>}
              <button onClick={() => setActive(null)} className="mono" style={chip(false)}>✕</button>
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search players or teams…"
              style={{ fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6 }} />
            <div className="mono" style={small}>{isTotal ? 'Sorted by projection.' : 'Sorted by how close his projection lands to the number.'}</div>
            {candidates(active).map(({ r, dist, afford, lock }) => (
              <button key={r.slug} disabled={!afford || lock} onClick={() => { setPicks({ ...picks, [active]: r.slug }); setActive(null); }}
                style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '6px 2px', background: 'none', border: 'none', borderTop: '1px solid var(--bd)', textAlign: 'left', color: 'var(--text)', cursor: afford && !lock ? 'pointer' : 'not-allowed', opacity: afford && !lock ? 1 : 0.45 }}>
                <PlayerImg playerId={r.slug} team={r.team} pos={r.pos} size={26} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                  <span className="mono" style={{ ...small, marginLeft: 6 }}>{r.team}{lock ? ' · locked' : !afford ? ' · over budget' : ''}</span>
                </span>
                <span className="mono" style={{ fontSize: 11, textAlign: 'right' }}>
                  {`${fmt$(r.salary)} · ${r.proj.toFixed(1)}`}
                  {!isTotal && <span style={{ color: dist <= cfg.radius / 5 ? 'var(--you)' : 'var(--faint)' }}>{` · ${dist.toFixed(1)} off`}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── the open contest's standings ───────────────────────────────────────────
export function BullseyeLeaderboard({ leagueId }: { leagueId: string }) {
  const [b, setB] = useState<{ started?: boolean; entries?: number; rows?: BullseyeBoardRow[]; me?: BullseyeBoardRow | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => bullseyeContestBoard(leagueId).then((r) => { if (alive && r.ok) setB(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [leagueId]);
  if (!b) return null;
  return (
    <div style={{ ...card, display: 'grid', gap: 4 }}>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>{`STANDINGS · ${b.entries ?? 0} ${b.entries === 1 ? 'ENTRY' : 'ENTRIES'}`}</span>
      {!b.started && <span className="mono" style={small}>Squads and scores show once the week’s first game locks.</span>}
      {(b.rows ?? []).map((r) => (
        <div key={r.roster_id} className="mono" style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) 110px 64px', gap: 8, fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--bd)', color: r.me ? 'var(--you)' : 'var(--text)', fontWeight: r.me ? 700 : 400 }}>
          <span>{r.rank}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.team_name ?? `Team ${r.roster_id}`}</span>
          <span style={{ textAlign: 'right', color: 'var(--faint)' }} title={r.tb != null ? 'tie-break distance — lower wins a tie' : undefined}>{`${Number(r.points).toFixed(1)} pts${r.tb != null && (b.rows ?? []).some((o) => o.roster_id !== r.roster_id && Number(o.ring) === Number(r.ring)) ? ` · ⚖️${Number(r.tb).toFixed(1)}` : ''}`}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{Number(r.ring).toFixed(1)}</span>
        </div>
      ))}
      {b.me && !(b.rows ?? []).some((r) => r.me) && (
        <div className="mono" style={{ fontSize: 12, color: 'var(--you)', fontWeight: 700, paddingTop: 6, borderTop: '1px dashed var(--bd)' }}>{`You: #${b.me.rank} · ${Number(b.me.ring).toFixed(1)}`}</div>
      )}
    </div>
  );
}
