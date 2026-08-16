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
import { buildMatchupBoard, gameFor, entryState, type BoardEntry } from '@drip/core/engine/matchupBoard';
import { PROJ_2026 } from '@drip/core/data/proj2026';
import { injuryFor } from '@drip/core/data/injuries';
import { slugMeta } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { setLivePlays, liveRowsToPbp } from '@drip/core/data/realPbp';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, getRevealedPicks, matchupTeams,
  liveSlate, leagueStandings,
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

/** "Sun 1:00 PM" — the player row's game line. Local to the reader, because
 *  a kickoff time is only useful in the timezone they're sitting in. */
const fmtKick = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
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

/** One team's identity in the scoreboard: crest, name, record + seed, live
 *  score with the projected final beneath it. */
function TeamHead({ side, align, accent, scoreless = false }: {
  side: import('@drip/core/engine/matchupBoard').BoardSide;
  align: 'left' | 'right'; accent: string; scoreless?: boolean;
}) {
  const rec = side.record;
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
        {side.avatar
          ? <img src={side.avatar} alt="" width={26} height={26} style={{ borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
          : <span style={{ width: 26, height: 26, borderRadius: 5, background: 'var(--bg)', border: '1px solid var(--bd)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--faint)', flexShrink: 0 }}>{(side.team || '?').charAt(0).toUpperCase()}</span>}
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{side.team}</span>
      </div>
      {rec && (
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 3 }}>
          {rec.wins}-{rec.losses}{rec.ties ? `-${rec.ties}` : ''}{rec.rank ? ` (#${rec.rank})` : ''}
        </div>
      )}
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: 'var(--text)' }}>{scoreless ? '—' : side.live.toFixed(2)}</div>
      {!scoreless && (
        <div className="mono" style={{ fontSize: 9.5, color: accent }}>proj {side.projected.toFixed(1)}</div>
      )}
    </div>
  );
}

/** The slot marker down the middle: the ELIGIBLE POSITIONS as colour bands
 *  plus the spot's real name underneath.
 *
 *  The first cut truncated the name to four characters to fit a fixed pill,
 *  which quietly destroyed exactly the thing the commissioner had just built:
 *  "NFC Flex" became "NFC ", "Rookie Only" became "Rook". A custom spot label
 *  is a rule the league agreed on — it has to survive to the board, at full
 *  length, or the builder's label feature stops meaning anything once the
 *  games start. The positions are named as well as coloured, because colour
 *  alone asks the reader to have memorised the palette. */
function SlotPill({ pos, label }: { pos: string[]; label: string }) {
  // FLEX-style spots list what they accept; a single-position spot would just
  // repeat itself, so it shows the name alone.
  const posLine = pos.length > 1 ? pos.map((p) => (p === 'DEF' ? 'D/ST' : p)).join('/') : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }}>
      <div style={{ display: 'flex', width: 54, height: 6, borderRadius: 3, overflow: 'hidden', border: '1px solid var(--bd)' }}>
        {pos.slice(0, 6).map((p) => (
          <span key={p} style={{ flex: 1, background: `var(--pos-${p}-bg, var(--bg))` }} />
        ))}
      </div>
      <span className="mono" title={posLine ? `${label} — ${posLine}` : label}
        style={{ fontSize: 9.5, fontWeight: 700, color: `var(--pos-${pos[0]}-fg, var(--text))`, textAlign: 'center', lineHeight: 1.25, maxWidth: 86 }}>
        {label}
      </span>
      {posLine && (
        <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', textAlign: 'center', lineHeight: 1.2, maxWidth: 86 }}>{posLine}</span>
      )}
    </div>
  );
}

/** A player on one side of a row: name, position line, game line, score.
 *  Mirrored for the away side so both read outward from the centre pill. */
function BoardCell({ e, align }: { e: import('@drip/core/engine/matchupBoard').BoardEntry | null; align: 'left' | 'right' }) {
  if (!e) return <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', textAlign: align }}>Empty</div>;
  const dim = e.state === 'done';
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: dim ? 'var(--dim)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
      <div className="mono" style={{ fontSize: 9.5, marginTop: 2, color: 'var(--faint)' }}>
        <span style={{ color: `var(--pos-${e.pos}-fg, var(--dim))`, fontWeight: 700 }}>{e.pos}</span>
        {e.team ? ` · ${e.team}` : ''}
        {e.injury ? <span style={{ color: 'var(--warn, #c66)', fontWeight: 700 }}> {e.injury}</span> : null}
      </div>
      <div className="mono" style={{ fontSize: 9.5, marginTop: 2, color: e.opponent === 'BYE' ? 'var(--warn, #c66)' : 'var(--faint)' }}>
        {e.opponent === 'BYE' ? 'BYE' : `${e.kickoff ?? ''} ${e.opponent ?? ''}`.trim()}
      </div>
    </div>
  );
}

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
  // MATCHUP BOARD inputs (v0.228.0) — the extra reads the head-to-head view
  // needs beyond the lineup itself. All optional: every one degrades to a
  // quieter row rather than an empty board, because a missing kickoff or a
  // slate the worker hasn't synced must never blank out the scores.
  const [slate, setSlate] = useState<{ home: string; away: string; kickoff?: string | null }[]>([]);
  const [records, setRecords] = useState<Record<number, { wins: number; losses: number; ties: number; rank: number }>>({});
  const [avatars, setAvatars] = useState<{ me: string | null; opp: string | null }>({ me: null, opp: null });
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
        matchupTeams(r.leagueId, [r.rosterId, oppRoster]).then((t: Record<number, TeamInfo>) => {
          setNames({ me: t[r.rosterId]?.team_name || 'YOU', opp: t[oppRoster]?.team_name || 'OPPONENT' });
          setAvatars({ me: t[r.rosterId]?.avatar ?? null, opp: t[oppRoster]?.avatar ?? null });
        }).catch(() => {});
        // The week's NFL slate drives every player's kickoff, opponent and —
        // by absence — their bye. Scoped to the matchup's own season/week.
        liveSlate(m.week, '2026').then(setSlate).catch(() => {});
        // Records for the header. Rank is the standings order the RPC already
        // returns (wins desc, PF desc), so it matches the playoff seeding
        // rather than inventing a second ordering.
        leagueStandings(r.leagueId).then((rows) => {
          const map: Record<number, { wins: number; losses: number; ties: number; rank: number }> = {};
          (Array.isArray(rows) ? rows : []).forEach((row, i) => {
            map[row.roster_id] = { wins: row.wins, losses: row.losses, ties: row.ties, rank: i + 1 };
          });
          setRecords(map);
        }).catch(() => {});
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

  // ── The head-to-head board (v0.228.0) ────────────────────────────────────
  // A game is treated as FINAL 3h20m after kickoff. The slate carries no
  // status column, and without SOME end signal `entryState` would call every
  // started game 'live' forever — which keeps the projection floating instead
  // of settling on the real score, the one thing a finished matchup must not
  // do. 3h20m is the long side of an NFL game including stoppages; erring
  // long means a game in overtime stays 'live' rather than being called early.
  const finalTeams = useMemo(() => {
    const out = new Set<string>();
    for (const g of slate) {
      const t = g.kickoff ? Date.parse(g.kickoff) : NaN;
      if (Number.isFinite(t) && nowTs - t > 3.34 * 3600_000) { out.add(g.home?.toUpperCase()); out.add(g.away?.toUpperCase()); }
    }
    return out;
  }, [slate, nowTs]);

  const entryFor = useMemo(() => {
    void playsAt; void flagsVer;
    return (slug: string | null | undefined, slotPos?: string[]): BoardEntry | null => {
      if (!slug) return null;
      const m = slugMeta(slug);
      const g = gameFor(m.team, slate);
      return {
        slug,
        name: prettySlug(slug),
        pos: m.pos ?? '',
        team: m.team ?? null,
        live: pts(slug, slotPos),
        // Season PPG is the projection. It is honest about what it is — a
        // per-game average, not a matchup-adjusted forecast — and it's the
        // same number the draft board already shows, so a manager never sees
        // two different "projected" figures for one player.
        proj: PROJ_2026.get(slug) ?? 0,
        state: g ? entryState(g.kickoff, m.team, nowTs, finalTeams) : 'pre',
        kickoff: g?.kickoff ? fmtKick(g.kickoff) : null,
        opponent: g ? `${g.home ? 'vs' : '@'} ${g.opponent}` : 'BYE',
        injury: injuryFor(matchup?.week ?? 1, slug),
      };
    };
  }, [slate, pts, nowTs, finalTeams, matchup, playsAt, flagsVer]);

  const board = useMemo(() => {
    if (!matchup || !ros) return null;
    const oppRoster = matchup.home_roster_id === ros.rosterId ? matchup.away_roster_id : matchup.home_roster_id;
    const mkSide = (rid: number, team: string, avatar: string | null, lineup: Record<string, string | null>, benchList: PoolPlayer[]) => ({
      rosterId: rid, team, avatar,
      record: records[rid] ? { ...records[rid], rank: records[rid].rank } : null,
      starters: Object.fromEntries(slotDefs.map((d) => [d.slot, entryFor(lineup[d.slot], d.pos)])),
      bench: benchList.filter((p) => !stashed.has(p.slug)).map((p) => entryFor(p.slug)).filter((e): e is BoardEntry => !!e),
      ir: benchList.filter((p) => stashed.has(p.slug)).map((p) => entryFor(p.slug)).filter((e): e is BoardEntry => !!e),
    });
    return buildMatchupBoard({
      week: matchup.week, locked, slots: slotDefs, labelFor: slotDisplayName,
      home: mkSide(ros.rosterId, names.me, avatars.me, effective.mine, bench),
      // The opponent's bench is not readable pre-lock (and shouldn't be) —
      // their rows exist only as starters, which is what the board shows.
      away: mkSide(oppRoster, names.opp, avatars.opp, effective.theirs, []),
    });
  }, [matchup, ros, slotDefs, effective, names, avatars, records, bench, stashed, entryFor, locked]);

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

  // The totals now come from the board (which counts them the same way but
  // also knows about projections and empty spots) — the fallback grid below
  // still needs its own, so they're derived from the board when it exists.
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

      {/* ── SCOREBOARD (v0.228.0) ──────────────────────────────────────────
          Live score big, projected final under it, and a win bar that reads
          the projections rather than the raw margin — 12 up with eight to
          play is not the same as 12 up with everyone done, and a bare margin
          can't tell you which one you're looking at. Pre-lock the whole
          projection half is hidden: nothing has happened, so a win % would be
          asserting something about a lineup that can still change. */}
      {board && (
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}>
            <TeamHead side={board.home} align="left" accent="var(--you)" />
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', textAlign: 'center', whiteSpace: 'nowrap' }}>
              {locked ? 'LIVE' : 'LOCKS'}
              {!locked && <div style={{ fontSize: 9, marginTop: 3 }}>{fmtLock(matchup?.lock_at ?? null)}</div>}
            </div>
            <TeamHead side={board.away} align="right" accent="var(--opp, var(--dim))" scoreless={!locked} />
          </div>
          {locked && (
            <>
              <div style={{ display: 'flex', gap: 4, marginTop: 10, height: 5 }}>
                <div style={{ flex: Math.max(0.02, board.home.winPct), background: 'var(--you)', borderRadius: 3 }} />
                <div style={{ flex: Math.max(0.02, board.away.winPct), background: 'var(--opp, var(--dim))', borderRadius: 3 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--you)' }}>{Math.round(board.home.winPct * 100)}% WIN</span>
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--opp, var(--dim))' }}>{Math.round(board.away.winPct * 100)}% WIN</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 10 }}>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', lineHeight: 1.5 }}>
                  yet to play ({board.home.yetToPlay}){board.home.yetToPlayBreakdown ? <><br />{board.home.yetToPlayBreakdown}</> : null}
                </span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', textAlign: 'right', lineHeight: 1.5 }}>
                  yet to play ({board.away.yetToPlay}){board.away.yetToPlayBreakdown ? <><br />{board.away.yetToPlayBreakdown}</> : null}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STARTERS, head to head (v0.228.0) ──────────────────────────────
          Only once locked. Pre-lock this screen is a LINEUP SETTER and the
          old editable grid below is the right tool — a read-only head-to-head
          would take away the one thing you came here to do. */}
      {locked && board && (
        <>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', padding: '10px 14px 6px' }}>STARTERS</div>
            {board.starters.map((row) => (
              <div key={row.slot} style={{ display: 'grid', gridTemplateColumns: '1fr 44px 92px 44px 1fr', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: '1px solid var(--bd)' }}>
                <BoardCell e={row.home} align="left" />
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, textAlign: 'right', color: 'var(--text)' }}>{row.home ? row.home.live.toFixed(2) : '—'}</span>
                <span style={{ position: 'relative', display: 'inline-flex', justifyContent: 'center' }}><SlotPill pos={row.pos} label={row.label} /></span>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{row.away ? row.away.live.toFixed(2) : '—'}</span>
                <BoardCell e={row.away} align="right" />
              </div>
            ))}
          </div>
          {/* BENCH and the stashes — mine only. The opponent's bench isn't
              readable (nor should it be); showing an empty column beside mine
              would imply they had nobody rather than that I can't see it. */}
          {(['bench', 'ir'] as const).map((k) => (
            board[k].home.length > 0 && (
              <div key={k} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', padding: '10px 14px 6px' }}>
                  {k === 'bench' ? 'BENCH' : 'TAXI / IR'}
                </div>
                {board[k].home.map((e) => (
                  <div key={e.slug} style={{ display: 'grid', gridTemplateColumns: '1fr 60px', alignItems: 'center', gap: 8, padding: '9px 14px', borderTop: '1px solid var(--bd)' }}>
                    <BoardCell e={e} align="left" />
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', color: 'var(--dim)' }}>{e.live.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )
          ))}
        </>
      )}

      {/* Lineup: one row per classic slot — the SETTER (pre-lock), and the
          fallback whenever the board can't assemble. */}
      {!(locked && board) && (
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
      )}
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
