// THE CONTEST SQUAD, web (v0.664.0) — docs/dfs-bullseye.md §13.
//
// One screen for every contest league: the builder before kickoff, the live
// numbers after. The spots are the league's own roster builder spots (S1…Sn
// from contest_state — a FLEX, an HC, a rookie-only RB are just spots), the
// budget is the league's, and the pick sheet sorts the way the contest
// scores: HIGH by projection, GOLF by the smallest real projection, BULLSEYE
// by how close a projection lands to the spot's number. Saving goes through
// save_contest_entry, which re-checks everything (position, the spot's
// filter, the pool filter, the seat's rule, the budget, the locks).
//
// The pre-0466 BullseyeSquad (BullseyeContest.tsx) stays for a salary-cap
// league that merely plays Bullseye; this one is for contest leagues.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  contestState, saveContestEntry, podSalaries, weekGameLocks, friendlyError,
  type ContestState, type PodSalaryRow,
} from '@drip/core/data/liveApi';
import {
  contestConfigOf, contestCard, contestSquadOf, contestTiebreak, contestSlotLabels, contestSlotAllows, CONTEST_MIN_SALARY, CONTEST_WORD,
  type ContestConfig,
} from '@drip/core/engine/contest';
import { classicSlotsFromSpec, type ClassicSlotDef, type ClassicScoring } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { projectedRing, tiebreakDistance } from '@drip/core/engine/dfsBullseye';
import { ringLabel } from '@drip/core/engine/bullseye';
import { PlayerImg } from '../app/ui';

const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean, dim = false): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--on-accent, var(--bg))' : dim ? 'var(--faint)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: `1px solid ${on ? 'var(--you)' : 'color-mix(in srgb, var(--you) 45%, var(--bd))'}`, borderRadius: 999, padding: '5px 12px',
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const head: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' };

/** How this contest scores, in a sentence. */
export function contestHowTo(cfg: ContestConfig): string {
  if (cfg.contest === 'golf') return 'Lowest score wins. Build the squad you think scores the FEWEST points — but a player who posts a zero banks the spot’s penalty, so a no-show is no bargain.';
  if (cfg.contest === 'high') return 'Highest score wins. Build the squad you think scores the most points under the budget.';
  const radius = cfg.bullseye?.radius ?? 10;
  return cfg.bullseye?.variant === 'total'
    ? `Build a squad whose points land as close to the card's total as you can. Dead-on doubles your score; any player who posts a zero costs ${radius}.`
    : `Every spot has a number. Pick the player you think lands closest to it: ${radius} points for dead-on plus ${radius} more for a bullseye, less the farther off. A zero costs ${radius}.`;
}

/** The league's spots and config from a contest_state read — what every
 *  room of a contest league needs to draw its squad. */
export function contestSetupOf(st: ContestState) {
  const slots = classicSlotsFromSpec(st.slots ?? null) ?? [];
  const cfg = contestConfigOf({ contest: st.contest, contest_format: st.format, budget: st.budget, roster_slots: st.slots, bullseye: st.variant, bullseye_radius: st.radius }, st.kind);
  const catalog = leagueCatalogOf({ scoring: (st.scoring_classic ?? null) as Partial<ClassicScoring> | null, ppr: st.ppr ?? null });
  return { slots, cfg, catalog, labels: contestSlotLabels(slots) };
}

/** Their squad, one row per spot: a player once his game locked, else sealed. */
function sealedRows(entry: unknown, slots: ClassicSlotDef[]): { slot: string; slug: string | null }[] {
  const rows = Array.isArray(entry) ? entry as { slot?: unknown; player_slug?: unknown; sealed?: unknown }[] : [];
  const bySlot = new Map<string, string | null>();
  for (const r of rows) if (typeof r?.slot === 'string') bySlot.set(r.slot, r.sealed ? null : (typeof r.player_slug === 'string' ? r.player_slug : null));
  return slots.map((d) => ({ slot: d.slot, slug: bySlot.get(d.slot) ?? null }));
}

export function ContestSquad({ leagueId, week: weekProp, onBack, embedded }: { leagueId: string; week?: number; onBack: () => void;
  /** Inside the league's own frame: no back row, no outer padding. */
  embedded?: boolean }) {
  const [st, setSt] = useState<ContestState | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[] | null>(null);
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const load = useCallback(async () => {
    const s = await contestState(leagueId, weekProp);
    setSt(s);
    if (!s.ok || s.week == null) return;
    const slots = classicSlotsFromSpec(s.slots ?? null) ?? [];
    setPicks(contestSquadOf(s.entry, slots));
    const [rows, lk] = await Promise.all([podSalaries(s.week).catch(() => []), weekGameLocks(s.week).catch(() => new Map<string, number>())]);
    setBoard(rows); setLocks(lk);
  }, [leagueId, weekProp]);
  useEffect(() => { void load().catch((e) => setNote(friendlyError(e))); }, [load]);
  // Live numbers: re-read while the week is being played.
  useEffect(() => {
    if (!st?.started || st.matchup?.status === 'final') return;
    const id = setInterval(() => { void contestState(leagueId, weekProp).then(setSt).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [st?.started, st?.matchup?.status, leagueId, weekProp]);

  const bySlug = useMemo(() => new Map((board ?? []).map((r) => [r.slug, r])), [board]);
  const setup = useMemo(() => (st?.ok ? contestSetupOf(st) : null), [st]);
  const theCard = useMemo(() => (setup?.cfg?.contest === 'bullseye' && st?.week != null ? contestCard(leagueId, st.week, setup.slots, setup.catalog) : null), [leagueId, st?.week, setup]);
  const locked = (slug: string | null) => { if (!slug) return false; const t = locks.get(bySlug.get(slug)?.team ?? ''); return t != null && t <= now; };
  const spent = Object.values(picks).reduce((s, slug) => s + (slug ? bySlug.get(slug)?.salary ?? 0 : 0), 0);
  const filled = Object.values(picks).filter(Boolean).length;
  const projTotal = Object.values(picks).reduce((s, slug) => s + (slug ? bySlug.get(slug)?.proj ?? 0 : 0), 0);

  if (!st) return <div className="mono" style={{ padding: 24, ...small }}>Loading…</div>;
  if (!st.ok) return <div style={{ padding: 24 }}><div className="mono" style={{ color: 'var(--warn, #c66)', fontSize: 12 }}>{st.error}</div><button onClick={onBack} style={{ marginTop: 10 }}>← BACK</button></div>;
  if (!setup?.cfg || !setup.slots.length) return <div style={{ padding: 24 }}><div className="mono" style={small}>This league has no spots to fill yet — its commissioner sets the roster.</div><button onClick={onBack}>← BACK</button></div>;
  const { slots, cfg, labels } = setup;
  const n = slots.length;
  const budget = cfg.budget;
  const bull = cfg.contest === 'bullseye';
  const isTotal = bull && cfg.bullseye?.variant === 'total';
  const radius = cfg.bullseye?.radius ?? 10;
  const scoreWord = bull ? 'ring' : 'pts';
  const mySide: 'home' | 'away' = st.matchup && st.matchup.home !== st.roster_id ? 'away' : 'home';
  const live = st.state?.slots?.filter((r) => r.side === mySide) ?? [];
  const liveOf = (slot: string) => live.find((r) => r.slot === slot);
  const myScore = st.matchup?.status === 'final' ? (mySide === 'home' ? st.matchup.home_final : st.matchup.away_final) : st.state ? (mySide === 'home' ? st.state.home : st.state.away) : null;
  const theirScore = st.opponent && st.state ? (mySide === 'home' ? st.state.away : st.state.home) : null;
  const myPoints = live.reduce((s, r) => s + (r.score || 0), 0);
  const editable = st.matchup?.status !== 'final';
  // THE TIE-BREAKER (v0.660.1), Bullseye only: my own spot and number, known before I build.
  const myTb = theCard && st.roster_id != null && st.week != null ? contestTiebreak(leagueId, st.week, st.roster_id, theCard, slots) : null;
  const tbLive = myTb ? liveOf(myTb.slot) : undefined;
  const myTbDist = st.matchup?.status === 'final'
    ? (mySide === 'home' ? st.matchup.home_tb : st.matchup.away_tb) ?? null
    : tbLive && myTb ? tiebreakDistance(tbLive.score, myTb.target, radius) : null;
  const tieBroken = bull && st.matchup?.status === 'final' && st.opponent && myScore != null && theirScore != null && Math.abs(Number(myScore) - Number(theirScore)) < 0.0101 && Number(myScore) !== Number(theirScore);
  const theirSquad = st.opponent ? sealedRows(st.opponent.entry, slots) : [];

  const save = async () => {
    if (st.week == null) return;
    if (filled < n) { setNote(`Fill all ${n} spots first.`); return; }
    setBusy(true); setNote(null);
    try {
      const r = await saveContestEntry(leagueId, st.week, picks as Record<string, string>);
      setNote(r.ok ? '✓ squad saved' : (r.error ?? 'Didn’t save.'));
      if (r.ok) await load();
    } catch (e) { setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const candidates = (slot: string) => {
    const def = slots.find((d) => d.slot === slot)!;
    const target = theCard?.targets[slot] ?? 0;
    const taken = new Set(Object.entries(picks).filter(([s, v]) => s !== slot && v).map(([, v]) => v));
    const room = budget - spent + (picks[slot] ? bySlug.get(picks[slot]!)?.salary ?? 0 : 0) - (n - filled - (picks[slot] ? 0 : 1)) * CONTEST_MIN_SALARY;
    const needle = search.trim().toLowerCase();
    return (board ?? [])
      .filter((r) => contestSlotAllows(def, r) && !taken.has(r.slug) && (!needle || r.name.toLowerCase().includes(needle) || r.team.toLowerCase().includes(needle)))
      .map((r) => ({ r, dist: Math.abs(r.proj - target), afford: r.salary <= room, lock: locked(r.slug) }))
      .sort((a, b) => (bull && !isTotal ? a.dist - b.dist : cfg.contest === 'golf' ? (a.r.proj > 0 ? a.r.proj : 999) - (b.r.proj > 0 ? b.r.proj : 999) : b.r.proj - a.r.proj) || a.r.salary - b.r.salary);
  };
  const sortedNote = bull && !isTotal ? 'Sorted by how close his projection lands to the number.' : cfg.contest === 'golf' ? 'Sorted by projection, lowest first — a zero is a penalty, not a score.' : 'Sorted by projection.';

  return (
    <div style={embedded ? { display: 'grid', gap: 12 } : { maxWidth: 760, margin: '0 auto', padding: '14px 14px 60px', display: 'grid', gap: 12 }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={onBack} className="mono" style={chip(false)}>← BACK</button>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>{st.name ?? 'CONTEST'}</span>
          <span className="mono" style={small}>{`Week ${st.week} · ${CONTEST_WORD[cfg.contest]}`}</span>
        </div>
      )}

      {/* the card, or the rule */}
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={head}>{bull ? 'THIS WEEK’S CARD' : CONTEST_WORD[cfg.contest]}</span>
          {isTotal && theCard && <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--you)' }}>{theCard.total}</span>}
        </div>
        {bull && !isTotal && theCard && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {slots.map((d) => (
              <span key={d.slot} className="mono" style={{ fontSize: 11, border: '1px solid var(--bd)', borderRadius: 6, padding: '3px 8px' }}>
                {labels[d.slot]} <b style={{ color: 'var(--you)' }}>{theCard.targets[d.slot]}</b>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.45 }}>{contestHowTo(cfg)}</div>
        {myTb && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
            ⚖️ TIE-BREAKER: your <b style={{ color: 'var(--you)' }}>{labels[myTb.slot]}</b> aims at <b style={{ color: 'var(--you)' }}>{myTb.target}</b> — it only counts if you tie, and closer wins.
            {myTbDist != null && <span>{` Now ${myTbDist.toFixed(1)} off.`}</span>}
          </div>
        )}
      </div>

      {/* the score, once the week is on */}
      {st.started && (
        <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="mono" style={head}>{st.matchup?.status === 'final' ? 'FINAL' : 'LIVE'}</span>
          <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--you)' }}>{myScore != null ? Number(myScore).toFixed(1) : '—'}</span>
          {bull && <span className="mono" style={small}>{`${myPoints.toFixed(1)} pts${isTotal && theCard ? ` · target ${theCard.total} · ${Math.abs(myPoints - theCard.total).toFixed(1)} off` : ''}`}</span>}
          {st.opponent && (
            <span className="mono" style={{ ...small, marginLeft: 'auto' }}>{`vs ${st.opponent.team ?? 'opponent'} · ${theirScore != null ? Number(theirScore).toFixed(1) : '—'}`}</span>
          )}
          {tieBroken && (
            <span className="mono" style={{ ...small, flexBasis: '100%' }}>{`Tied on rings — settled by the tie-breaker (${myTbDist?.toFixed(1) ?? '—'} off vs ${(mySide === 'home' ? st.matchup!.away_tb : st.matchup!.home_tb)?.toFixed(1) ?? '—'} off).`}</span>
          )}
        </div>
      )}

      {/* the squad */}
      <div style={{ ...card, display: 'grid', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span className="mono" style={head}>MY SQUAD</span>
          <span className="mono" style={{ fontSize: 11, color: spent > budget ? 'var(--warn, #c66)' : 'var(--dim)' }}>
            {`${fmt$(spent)} / ${fmt$(budget)}${!st.started ? ` · projects ${projTotal.toFixed(1)}${isTotal && theCard ? ` vs ${theCard.total}` : ''}` : ''}`}
          </span>
        </div>
        {slots.map((d) => {
          const slug = picks[d.slot];
          const p = slug ? bySlug.get(slug) : null;
          const target = theCard?.targets[d.slot];
          const lv = liveOf(d.slot);
          const isLocked = locked(slug);
          return (
            <div key={d.slot} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr) 92px', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--bd)' }}>
              <button onClick={() => { if (editable && !isLocked) { setActive(d.slot); setSearch(''); } }} disabled={!editable || isLocked} className="mono"
                style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 4px', cursor: editable && !isLocked ? 'pointer' : 'default', color: 'var(--text)' }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{labels[d.slot]}</div>
                {bull && !isTotal && target != null && <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--you)' }}>{target}</div>}
                {!bull && d.zeroPts != null && <div title="a scoreless spot banks this" style={{ fontSize: 9, color: 'var(--dim)' }}>{`0 → ${d.zeroPts}`}</div>}
                {myTb?.slot === d.slot && <div title="tie-breaker" style={{ fontSize: 9, color: 'var(--dim)' }}>{`⚖️ ${myTb.target}`}</div>}
              </button>
              {p ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <PlayerImg playerId={p.slug} team={p.team} pos={p.pos} size={28} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}{isLocked ? ' 🔒' : ''}</div>
                    <div className="mono" style={small}>{`${p.pos} · ${p.team} · ${fmt$(p.salary)} · proj ${p.proj.toFixed(1)}`}</div>
                  </div>
                </div>
              ) : (
                <button onClick={() => { if (editable) { setActive(d.slot); setSearch(''); } }} disabled={!editable} className="mono"
                  style={{ background: 'none', border: 'none', textAlign: 'left', color: 'var(--you)', cursor: 'pointer', fontSize: 12 }}>+ PICK {labels[d.slot]}</button>
              )}
              <div className="mono" style={{ textAlign: 'right' }}>
                {lv ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{lv.score.toFixed(1)}</div>
                    {lv.aim && <div style={{ fontSize: 9.5, color: lv.aim.ring > 0 ? 'var(--you)' : 'var(--faint)' }}>{`${ringLabel(lv.aim.dist, radius)} +${lv.aim.ring}`}</div>}
                  </>
                ) : p && bull && !isTotal && target != null ? (
                  <div style={small}>{`aims ${projectedRing(p.proj, target, radius).toFixed(1)}`}</div>
                ) : null}
              </div>
            </div>
          );
        })}
        {editable && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => void save()} disabled={busy || filled < n || spent > budget} className="mono" style={chip(true)}>SAVE SQUAD</button>
            <span className="mono" style={small}>{filled < n ? `${n - filled} to fill · ${fmt$(budget - spent)} left` : `${fmt$(budget - spent)} left`}</span>
            {note && <span className="mono" style={{ fontSize: 11, color: note.startsWith('✓') ? 'var(--you)' : 'var(--warn, #c66)' }}>{note}</span>}
          </div>
        )}
      </div>

      {/* THEIR SQUAD, SEALED (v0.660.1): each player shows once his game locks. */}
      {st.opponent && (
        <div style={{ ...card, display: 'grid', gap: 2 }}>
          <span className="mono" style={{ ...head, marginBottom: 4 }}>{`${(st.opponent.team ?? 'OPPONENT').toUpperCase()}’S SQUAD`}</span>
          {theirSquad.map((r) => {
            const lv = st.state?.slots?.find((x) => x.side !== mySide && x.slot === r.slot);
            const p = r.slug ? bySlug.get(r.slug) : null;
            return (
              <div key={r.slot} className="mono" style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) 70px', gap: 8, fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                <span style={{ color: 'var(--faint)' }}>{labels[r.slot]}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.slug ? 'var(--text)' : 'var(--faint)' }}>{r.slug ? (p?.name ?? r.slug) : '🔒 sealed until his game locks'}</span>
                <span style={{ textAlign: 'right' }}>{lv ? `${lv.score.toFixed(1)}${bull ? '' : ` ${scoreWord}`}` : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* the pick sheet */}
      {active && (
        <div onClick={() => setActive(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(640px, 100%)', maxHeight: '80vh', overflowY: 'auto', borderRadius: '12px 12px 0 0', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{labels[active]}{bull && !isTotal && theCard ? ` · aim at ${theCard.targets[active]}` : ''}</span>
              <span style={{ flex: 1 }} />
              {picks[active] && <button onClick={() => { setPicks({ ...picks, [active]: null }); setActive(null); }} className="mono" style={chip(false, true)}>CLEAR</button>}
              <button onClick={() => setActive(null)} className="mono" style={chip(false)}>✕</button>
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search players or teams…"
              style={{ fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6 }} />
            <div className="mono" style={small}>{sortedNote}</div>
            {candidates(active).slice(0, 120).map(({ r, dist, afford, lock }) => (
              <button key={r.slug} disabled={!afford || lock} onClick={() => { setPicks({ ...picks, [active]: r.slug }); setActive(null); }}
                style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '6px 2px', background: 'none', border: 'none', borderTop: '1px solid var(--bd)', textAlign: 'left', color: 'var(--text)', cursor: afford && !lock ? 'pointer' : 'not-allowed', opacity: afford && !lock ? 1 : 0.45 }}>
                <PlayerImg playerId={r.slug} team={r.team} pos={r.pos} size={26} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                  <span className="mono" style={{ ...small, marginLeft: 6 }}>{r.pos} · {r.team}{lock ? ' · locked' : !afford ? ' · over budget' : ''}</span>
                </span>
                <span className="mono" style={{ fontSize: 11, textAlign: 'right' }}>
                  {`${fmt$(r.salary)} · ${r.proj.toFixed(1)}`}
                  {bull && !isTotal && <span style={{ color: dist <= radius / 5 ? 'var(--you)' : 'var(--faint)' }}>{` · ${dist.toFixed(1)} off`}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
