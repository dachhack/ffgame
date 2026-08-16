// CLASSIC (normie) league board, web (0157): one weekly lineup, standard
// scoring, live totals — traditional fantasy on the drip spine.
//
// Replaces the whole drip board for a classic league (LivePicks branches here
// on league_game_mode): no windows, no metrics, no power-up chrome. Pre-lock
// it's a lineup setter — nine named slots filled from your roster, saved as
// sealed_pick rows under the 'wk' pseudo-window. From the week's first kickoff
// (matchup.lock_at) the lineup seals and the board turns into the live view:
// your starters vs theirs, each scoring classicPoints off the same live play
// stream the drip boards run on, refreshed every 60s.
import { useEffect, useMemo, useState } from 'react';
import type { Pos } from '@drip/core/types';
import { leagueSlotDefs, leagueBestball, slotAllows, isRetSlot, slotDisplayName, CLASSIC_WIN, classicPoints, bestballFill, type ClassicPick, type ClassicScoring, type SlotSpec, type SlotFilter } from '@drip/core/engine/classic';
import { setLeagueFlags } from '@drip/core/data/commish';
import { slugMeta } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { setLivePlays, liveRowsToPbp } from '@drip/core/data/realPbp';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, getRevealedPicks, matchupTeams,
  leagueGameMode, weekLivePlays, friendlyError, playerFlags, leaguePoolExp,
  type LiveMatchup, type PoolPlayer, type TeamInfo,
  nativeRosters,
} from '@drip/core/data/liveApi';
import { PlayerImg, PosPill } from '../app/ui';

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mkPlayer = (slug: string) => {
  const m = slugMeta(slug);
  return { id: slug, name: slug, full: slug, pos: m.pos, team: m.team, stats: { ...ZERO } };
};

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 };
const mono: React.CSSProperties = { fontFamily: 'var(--mono, monospace)', letterSpacing: '0.08em' };

// Display name straight from the slug (the opponent's side arrives as bare
// slugs). Team units read as units, not as capitalized slug fragments.
const prettySlug = (slug: string): string => {
  if (slug.endsWith('-dst')) return `${slugMeta(slug).team} D/ST`;
  if (slug.endsWith('-k')) return `${slugMeta(slug).team} K`;
  return shortName(slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '));
};

// Short human label for a spot's player filter (0172): "KC/SF · ROOKIES".
const fltLabel = (f?: SlotFilter | null): string => {
  if (!f) return '';
  const parts: string[] = [];
  if (f.teams?.length) parts.push(f.teams.join('/'));
  if (f.min_exp != null || f.max_exp != null) {
    parts.push(f.max_exp === 0 ? 'ROOKIES ONLY' : `${f.min_exp ?? 0}–${f.max_exp ?? '30'} YRS`);
  }
  return parts.join(' · ');
};

const fmtLock = (iso: string | null) => {
  if (!iso) return 'first kickoff';
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};

export function ClassicBoard({ userId, leagueId, rosterId, onBack }: { userId: string; leagueId?: string; rosterId?: number; onBack: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [ros, setRos] = useState<{ leagueId: string; rosterId: number } | null>(null);
  const [ppr, setPpr] = useState(1);
  const [scoring, setScoring] = useState<Record<string, number>>({});
  const [roster, setRoster] = useState<Record<string, number>>({});
  const [flagsVer, setFlagsVer] = useState(0);
  const [bestball, setBestball] = useState<string[]>([]);
  const [slotsSpec, setSlotsSpec] = useState<SlotSpec[] | null>(null);
  // TAXI/IR stashes (0164): stashed players can't start or best-ball fill —
  // the DB refuses them; filtering here keeps the picker and fills honest.
  const [stashed, setStashed] = useState<Set<string>>(new Set());
  // Tenure by slug (0172) — loaded only when a spot actually filters on it.
  const [expMap, setExpMap] = useState<Record<string, number>>({});
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [oppPool, setOppPool] = useState<PoolPlayer[]>([]);
  const [mine, setMine] = useState<Record<string, string | null>>({});
  const [lockedRow, setLockedRow] = useState(false); // server sealed any 'wk' row
  const [theirs, setTheirs] = useState<Record<string, string>>({});
  const [names, setNames] = useState<{ me: string; opp: string }>({ me: 'YOU', opp: 'OPPONENT' });
  const [playsAt, setPlaysAt] = useState(0); // bump → recompute points
  const [pickerSlot, setPickerSlot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    (async () => {
      try {
        setState('loading'); setErr(null);
        const r = leagueId && rosterId != null ? { leagueId, rosterId } : await myRoster(userId);
        if (!r) { setState('none'); return; }
        setRos(r);
        const m = await myMatchup(r.leagueId, r.rosterId);
        if (!m) { setState('none'); return; }
        setMatchup(m);
        nativeRosters(r.leagueId).then((rows) => {
          setStashed(new Set(rows.filter((x) => x.spot && x.spot !== 'active').map((x) => x.slug)));
        }).catch(() => {});
        leagueGameMode(r.leagueId).then((gm) => {
          if (gm.ok && gm.ppr != null) setPpr(Number(gm.ppr));
          if (gm.ok) { setBestball(leagueBestball(gm)); setScoring(gm.scoring ?? {}); setRoster(gm.roster ?? {}); setSlotsSpec(gm.slots ?? null); }
          // A spot with a tenure window (0172) needs years_exp from league_pool.
          if (gm.ok && (gm.slots ?? []).some((s) => s.min_exp != null || s.max_exp != null)) {
            leaguePoolExp(r.leagueId).then(setExpMap).catch(() => {});
          }
        }).catch(() => {});
        // Flag rules (0144) bite classic scoring (bonus_mult / bonus_pts) and
        // the best-ball fill (no_start) — same cache the drip screens keep.
        playerFlags(r.leagueId).then((f) => {
          if (Array.isArray(f)) { setLeagueFlags(r.leagueId, f); setFlagsVer((v) => v + 1); }
        }).catch(() => {});
        const oppRoster = m.home_roster_id === r.rosterId ? m.away_roster_id : m.home_roster_id;
        matchupTeams(r.leagueId, [r.rosterId, oppRoster]).then((t: Record<number, TeamInfo>) => setNames({
          me: t[r.rosterId]?.team_name || 'YOU', opp: t[oppRoster]?.team_name || 'OPPONENT',
        })).catch(() => {});
        const [pl, pk] = await Promise.all([myPool(r.leagueId, m.week, r.rosterId), myPicks(m.id, userId)]);
        setPool(pl);
        const map: Record<string, string | null> = {};
        let sealed = false;
        for (const p of pk) {
          if (p.game_window !== CLASSIC_WIN) continue;
          map[p.roster_slot] = p.player_slug;
          if (p.locked) sealed = true;
        }
        setMine(map);
        setLockedRow(sealed);
        setState('ready');
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load.'); setState('error');
      }
    })();
  }, [userId, leagueId, rosterId]);

  const locked = lockedRow || (matchup?.lock_at != null && Date.parse(matchup.lock_at) <= nowTs);
  useEffect(() => {
    const t = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Post-lock: opponent's revealed lineup + roster (best ball fills from it)
  // + the week's live plays, minute cadence.
  useEffect(() => {
    if (!locked || !matchup || !ros) return;
    let stop = false;
    const oppRoster = matchup.home_roster_id === ros.rosterId ? matchup.away_roster_id : matchup.home_roster_id;
    if (bestball.length) myPool(ros.leagueId, matchup.week, oppRoster).then((p) => { if (!stop) setOppPool(p); }).catch(() => {});
    const load = async () => {
      try {
        const [rev, rows] = await Promise.all([getRevealedPicks(matchup.id), weekLivePlays(matchup.week)]);
        if (stop) return;
        const opp: Record<string, string> = {};
        for (const p of rev) {
          if (p.app_user_id === userId || p.game_window !== CLASSIC_WIN || !p.player_slug) continue;
          opp[p.roster_slot] = p.player_slug;
        }
        setTheirs(opp);
        setLivePlays(matchup.week, liveRowsToPbp(rows));
        setPlaysAt(Date.now());
      } catch { /* transient — next tick retries */ }
    };
    void load();
    const t = window.setInterval(() => { void load(); }, 60_000);
    return () => { stop = true; window.clearInterval(t); };
  }, [locked, matchup, userId, ros, bestball.length]);

  const sc = useMemo<Partial<ClassicScoring>>(() => ({ ...scoring, ppr }), [scoring, ppr]);
  // The league's configured lineup (0161) — slot names, types, eligibility.
  const slotDefs = useMemo(() => leagueSlotDefs({ roster, slots: slotsSpec }), [roster, slotsSpec]);
  const pts = useMemo(() => {
    void playsAt; void flagsVer;
    if (!matchup) return () => 0;
    // RET spots (0171) score their occupant return-only — mirror the resolver.
    return (slug: string | null | undefined, slotPos?: string[]) =>
      (slug ? classicPoints(mkPlayer(slug), matchup.week, sc, slotPos && isRetSlot(slotPos) ? 'RET' : undefined) : 0);
  }, [matchup, sc, playsAt, flagsVer]);

  const bb = useMemo(() => new Set(bestball), [bestball]);
  // The EFFECTIVE lineup per side: manual picks in non-best-ball slots, plus
  // the engine's fills — the same bestballFill the worker scores with. Fills
  // only exist once locked (pre-lock there are no scores to chase).
  const effective = useMemo(() => {
    void playsAt;
    const build = (manual: Record<string, string | null | undefined>, rosterSlugs: string[]) => {
      const out: Record<string, string | null> = {};
      const manualPicks: ClassicPick[] = [];
      for (const d of slotDefs) {
        if (bb.has(d.slot)) { out[d.slot] = null; continue; }
        out[d.slot] = manual[d.slot] ?? null;
        if (manual[d.slot]) manualPicks.push({ slot: d.slot, player: mkPlayer(manual[d.slot]!) });
      }
      if (locked && matchup && bb.size) {
        // exp rides along (0172) so tenure-filtered spots fill honestly.
        const ros = rosterSlugs.filter((x) => !stashed.has(x)).map((x) => ({ ...mkPlayer(x), exp: expMap[x] ?? null }));
        for (const f of bestballFill(manualPicks, bestball, ros, matchup.week, sc, slotDefs)) out[f.slot] = f.player.id;
      }
      return out;
    };
    return {
      mine: build(mine, pool.map((p) => p.slug)),
      theirs: build(theirs, oppPool.map((p) => p.slug)),
    };
  }, [mine, theirs, pool, oppPool, bb, bestball, locked, matchup, sc, slotDefs, playsAt, flagsVer, stashed, expMap]);

  // Only MANUAL starters reserve players; best-ball slots never block the picker.
  const used = useMemo(() => new Set(
    slotDefs.filter((d) => !bb.has(d.slot)).map((d) => mine[d.slot]).filter(Boolean) as string[],
  ), [mine, bb, slotDefs]);
  const bench = useMemo(() => pool.filter((p) => !used.has(p.slug)), [pool, used]);

  const assign = async (slot: string, slug: string | null) => {
    if (!matchup) return;
    const next = { ...mine, [slot]: slug };
    setMine(next); setPickerSlot(null); setSaving(true); setSaveNote(null);
    try {
      await savePicks(matchup.id, userId, [{ game_window: CLASSIC_WIN, roster_slot: slot, player_slug: slug, metric_id: null }]);
      setSaveNote('saved');
    } catch (e) {
      setMine(mine); // revert — the server refused (locked, cap, …)
      setSaveNote(friendlyError(e));
    } finally { setSaving(false); }
  };

  if (state === 'loading') return <div className="mono" style={{ padding: 24, fontSize: 11, color: 'var(--faint)' }}>Loading…</div>;
  if (state === 'none') return <div className="mono" style={{ padding: 24, fontSize: 11, color: 'var(--faint)' }}>No matchup this week.</div>;
  if (state === 'error') return (
    <div style={{ padding: 24 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</div>
      <button onClick={onBack} style={{ marginTop: 12 }}>← BACK</button>
    </div>
  );

  const myTotal = slotDefs.reduce((s, d) => s + pts(effective.mine[d.slot], d.pos), 0);
  const oppTotal = slotDefs.reduce((s, d) => s + pts(effective.theirs[d.slot], d.pos), 0);
  const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

  const PlayerCell = ({ slug, right }: { slug: string | null | undefined; right?: boolean }) => {
    if (!slug) return <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>—</span>;
    const meta = slugMeta(slug);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexDirection: right ? 'row-reverse' : 'row' }}>
        <PlayerImg playerId={slug} team={meta.team} pos={meta.pos as Pos} size={24} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{prettySlug(slug)}</span>
        <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{meta.team}</span>
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '12px 12px 40px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <button onClick={onBack} className="mono" style={{ background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, color: 'var(--dim)', cursor: 'pointer' }}>← LEAGUE</button>
        <span className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)' }}>
          CLASSIC · WEEK {matchup?.week} · {ppr === 1 ? 'FULL PPR' : ppr === 0.5 ? 'HALF PPR' : 'NON-PPR'}
        </span>
      </div>

      {/* Scoreboard header */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8 }}>
        <div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--you)', fontWeight: 700 }}>{names.me}</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{r1(myTotal)}</div>
        </div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{locked ? 'LIVE' : `LOCKS ${fmtLock(matchup?.lock_at ?? null)}`}</div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 9, color: 'var(--opp, var(--dim))', fontWeight: 700 }}>{names.opp}</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{locked ? r1(oppTotal) : '—'}</div>
        </div>
      </div>

      {/* Lineup: one row per classic slot */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {slotDefs.map((d, i) => {
          const auto = bb.has(d.slot);
          const my = effective.mine[d.slot];
          const their = effective.theirs[d.slot];
          return (
            <div key={d.slot} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 52px 52px 1fr', alignItems: 'center', gap: 6, padding: '8px 12px', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
              <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: auto ? 'var(--you)' : 'var(--dim)' }}>{d.slot}{auto ? ' 🎯' : ''}</span>
              {auto && !locked ? (
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>BEST BALL — fills itself with your top scorer</span>
              ) : locked || auto ? <PlayerCell slug={my} /> : (
                <button onClick={() => setPickerSlot(pickerSlot === d.slot ? null : d.slot)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, color: 'inherit' }}>
                  {my ? <PlayerCell slug={my} /> : <span className="mono" style={{ fontSize: 10, color: 'var(--you)' }}>+ SET {d.slot}</span>}
                </button>
              )}
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, textAlign: 'right', color: 'var(--you)' }}>{locked || my ? r1(pts(my, d.pos)) : ''}</span>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, textAlign: 'right', color: 'var(--dim)' }}>{locked ? r1(pts(their, d.pos)) : ''}</span>
              <div style={{ textAlign: 'right' }}>{locked && <PlayerCell slug={their} right />}</div>
            </div>
          );
        })}
      </div>
      {saveNote && <div className="mono" style={{ fontSize: 9.5, color: saveNote === 'saved' ? 'var(--faint)' : 'var(--warn, #c66)' }}>{saveNote === 'saved' ? (saving ? 'saving…' : '✓ lineup saved') : saveNote}</div>}

      {/* Picker: eligible, unused roster players for the open slot */}
      {!locked && pickerSlot && (
        <div style={card}>
          <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--faint)', marginBottom: 8 }}>
            SET {(() => { const d = slotDefs.find((x) => x.slot === pickerSlot); return d ? slotDisplayName(d) : pickerSlot; })()} — {slotDefs.find((d) => d.slot === pickerSlot)?.pos.join(' / ')}
            {(() => { const l = fltLabel(slotDefs.find((d) => d.slot === pickerSlot)?.flt); return l ? <span style={{ color: 'var(--you)' }}> · {l}</span> : null; })()}
          </div>
          {mine[pickerSlot] && (
            <button onClick={() => { void assign(pickerSlot, null); }} className="mono"
              style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 10.5, padding: '7px 8px', marginBottom: 4, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--dim)', cursor: 'pointer' }}>
              ✕ CLEAR SLOT
            </button>
          )}
          {bench.filter((p) => slotAllows(slotDefs.find((d) => d.slot === pickerSlot)!, { pos: p.pos, team: p.team, exp: expMap[p.slug] ?? null })).map((p) => (
            <button key={p.slug} onClick={() => { void assign(pickerSlot, p.slug); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 8px', marginBottom: 2, background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', color: 'inherit' }}>
              <PlayerImg playerId={p.slug} team={p.team} pos={p.pos as Pos} size={26} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{shortName(p.full)}</span>
              <PosPill pos={p.pos as Pos} />
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{p.team}</span>
            </button>
          ))}
        </div>
      )}

      {/* Bench */}
      <div style={card}>
        <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--faint)', marginBottom: 8 }}>BENCH</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {bench.map((p) => (
            <span key={p.slug} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 9px' }}>
              {shortName(p.full)} <span style={{ color: 'var(--faint)', fontSize: 8.5 }}>{p.pos}</span>
              {locked && <span style={{ color: 'var(--dim)', fontWeight: 700 }}>{r1(pts(p.slug))}</span>}
            </span>
          ))}
          {!bench.length && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>everyone's starting</span>}
        </div>
      </div>

      <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', lineHeight: 1.6 }}>
        CLASSIC MODE — standard scoring across every stat ({ppr === 1 ? '1 pt' : ppr === 0.5 ? '½ pt' : 'no points'} per catch), live play by play.
        The whole lineup locks at the week's first kickoff. No windows, no power-ups, no bonuses.
        {bb.size > 0 && (bb.size >= slotDefs.length
          ? ' FULL BEST BALL: every slot takes your highest scorer automatically — nothing to set.'
          : ' 🎯 slots are BEST BALL: they automatically take your highest-scoring player who isn\'t already started.')}
      </div>
    </div>
  );
}
