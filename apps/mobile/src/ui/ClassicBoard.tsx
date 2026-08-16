// CLASSIC (normie) league board, native (0157) — the app twin of web's
// src/screens/ClassicBoard.tsx. One weekly lineup, standard scoring, live
// totals; no windows, no metrics, no power-up chrome. Same logic, same
// storage: sealed_pick rows under the 'wk' pseudo-window, sealed at the
// week's first kickoff (matchup.lock_at), scored by core's classicPoints off
// the same live play stream, refreshed every 60s.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { leagueSlotDefs, leagueBestball, slotAllows, isRetSlot, slotDisplayName, CLASSIC_WIN, classicPoints, bestballFill, type ClassicPick, type ClassicScoring, type SlotSpec, type SlotFilter } from '@drip/core/engine/classic';
import { setLeagueFlags } from '@drip/core/data/commish';
import { buildMatchupBoard, gameFor, entryState, type BoardEntry, type BoardSide } from '@drip/core/engine/matchupBoard';
import { PROJ_2026 } from '@drip/core/data/proj2026';
import { injuryFor } from '@drip/core/data/injuries';
import { slugMeta } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { headshot } from '@drip/core/data/media';
import { setLivePlays, liveRowsToPbp } from '@drip/core/data/realPbp';
import {
  myMatchup, myPool, myPicks, savePicks, getRevealedPicks, matchupTeams,
  liveSlate, leagueStandings,
  leagueGameMode, weekLivePlays, friendlyError, playerFlags, leaguePoolExp,
  type LiveMatchup, type PoolPlayer, type TeamInfo,
  nativeRosters,
} from '@drip/core/data/liveApi';
import { useTheme } from '../theme.native';
import { tap, commit } from './feedback';
import { Card, Chip, Display, Mono, PosPill } from './prims';

/** One team in the scoreboard: crest, name, record + seed, live score, and
 *  the projected final beneath it. */
function TeamHead({ side, align, scoreless = false }: { side: BoardSide; align: 'left' | 'right'; scoreless?: boolean }) {
  const t = useTheme();
  const rec = side.record;
  const right = align === 'right';
  return (
    <View style={{ flex: 1, alignItems: right ? 'flex-end' : 'flex-start', minWidth: 0 }}>
      <View style={{ flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
        {side.avatar
          ? <Image source={{ uri: side.avatar }} style={{ width: 22, height: 22, borderRadius: 4 }} />
          : <View style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: t.bg, borderWidth: 1, borderColor: t.bd, alignItems: 'center', justifyContent: 'center' }}>
              <Mono size={9} tone="faint" weight="700">{(side.team || '?').charAt(0).toUpperCase()}</Mono>
            </View>}
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text, flexShrink: 1 }}>{side.team}</Text>
      </View>
      {!!rec && (
        <Mono size={8} tone="faint" style={{ marginTop: 2 }}>
          {rec.wins}-{rec.losses}{rec.ties ? `-${rec.ties}` : ''}{rec.rank ? ` (#${rec.rank})` : ''}
        </Mono>
      )}
      <Display size={24} style={{ marginTop: 3 }}>{scoreless ? '—' : side.live.toFixed(2)}</Display>
      {!scoreless && <Mono size={8.5} tone="dim">proj {side.projected.toFixed(1)}</Mono>}
    </View>
  );
}

/** The centre slot pill. RN has no gradients without a dependency, so the
 *  eligible positions are STACKED BANDS behind the label — same information as
 *  the web's gradient (a FLEX reads as the set it accepts) with nothing new
 *  to install. */
function SlotPill({ pos, label }: { pos: string[]; label: string }) {
  const t = useTheme();
  const use = pos.slice(0, 3);
  const first = t.pos[use[0] as keyof typeof t.pos];
  return (
    <View style={{ width: 40, height: 28, borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: t.bd, flexDirection: 'row' }}>
      {use.map((p) => (
        <View key={p} style={{ flex: 1, backgroundColor: t.pos[p as keyof typeof t.pos]?.bg ?? t.bg }} />
      ))}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Mono size={8.5} weight="700" style={{ color: first?.fg ?? t.text }}>{label.length > 4 ? label.slice(0, 4) : label}</Mono>
      </View>
    </View>
  );
}

/** A player on one side of a row, mirrored so both read outward from the pill. */
function BoardCell({ e, align }: { e: BoardEntry | null; align: 'left' | 'right' }) {
  const t = useTheme();
  const right = align === 'right';
  if (!e) return <View style={{ flex: 1 }}><Mono size={10} tone="faint" style={{ textAlign: right ? 'right' : 'left' }}>Empty</Mono></View>;
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: e.state === 'done' ? t.dim : t.text, textAlign: right ? 'right' : 'left' }}>{e.name}</Text>
      <Text numberOfLines={1} style={{ fontSize: 9, marginTop: 1, color: t.faint, textAlign: right ? 'right' : 'left' }}>
        <Text style={{ color: t.pos[e.pos as keyof typeof t.pos]?.fg ?? t.dim, fontWeight: '700' }}>{e.pos}</Text>
        {e.team ? ` · ${e.team}` : ''}
        {e.injury ? <Text style={{ color: t.warn, fontWeight: '700' }}>{` ${e.injury}`}</Text> : null}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 9, marginTop: 1, color: e.opponent === 'BYE' ? t.warn : t.faint, textAlign: right ? 'right' : 'left' }}>
        {e.opponent === 'BYE' ? 'BYE' : `${e.kickoff ?? ''} ${e.opponent ?? ''}`.trim()}
      </Text>
    </View>
  );
}

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mkPlayer = (slug: string) => {
  const m = slugMeta(slug);
  return { id: slug, name: slug, full: slug, pos: m.pos, team: m.team, stats: { ...ZERO } };
};
const prettySlug = (slug: string): string => {
  if (slug.endsWith('-dst')) return `${slugMeta(slug).team} D/ST`;
  if (slug.endsWith('-k')) return `${slugMeta(slug).team} K`;
  return shortName(slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '));
};
const fmtLock = (iso: string | null) => {
  if (!iso) return 'first kickoff';
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};
const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
/** "Sun 1:00 PM" — the row's game line, in the reader's own timezone. */
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

export function ClassicBoard({ userId, leagueId, rosterId }: { userId: string; leagueId: string; rosterId: number }) {
  const t = useTheme();
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [ppr, setPpr] = useState(1);
  const [scoring, setScoring] = useState<Record<string, number>>({});
  const [roster, setRosterCfg] = useState<Record<string, number>>({});
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
  const [lockedRow, setLockedRow] = useState(false);
  const [theirs, setTheirs] = useState<Record<string, string>>({});
  const [names, setNames] = useState<{ me: string; opp: string }>({ me: 'YOU', opp: 'OPPONENT' });
  const [playsAt, setPlaysAt] = useState(0);
  const [pickerSlot, setPickerSlot] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  // MATCHUP BOARD inputs (v0.229.0) — same three optional reads the web board
  // takes. Each degrades to a quieter row, never to a blank board.
  const [slate, setSlate] = useState<{ home: string; away: string; kickoff?: string | null }[]>([]);
  const [records, setRecords] = useState<Record<number, { wins: number; losses: number; ties: number; rank: number }>>({});
  const [avatars, setAvatars] = useState<{ me: string | null; opp: string | null }>({ me: null, opp: null });

  useEffect(() => {
    (async () => {
      try {
        setState('loading'); setErr(null);
        const m = await myMatchup(leagueId, rosterId);
        if (!m) { setState('none'); return; }
        setMatchup(m);
        nativeRosters(leagueId).then((rows) => {
          setStashed(new Set(rows.filter((x) => x.spot && x.spot !== 'active').map((x) => x.slug)));
        }).catch(() => {});
        leagueGameMode(leagueId).then((gm) => {
          if (gm.ok) { if (gm.ppr != null) setPpr(Number(gm.ppr)); setBestball(leagueBestball(gm)); setScoring(gm.scoring ?? {}); setRosterCfg(gm.roster ?? {}); setSlotsSpec(gm.slots ?? null); }
          // A spot with a tenure window (0172) needs years_exp from league_pool.
          if (gm.ok && (gm.slots ?? []).some((s) => s.min_exp != null || s.max_exp != null)) {
            leaguePoolExp(leagueId).then(setExpMap).catch(() => {});
          }
        }).catch(() => {});
        // Flag rules (0144) bite classic scoring (bonus_mult / bonus_pts) and
        // the best-ball fill (no_start) — same cache the drip screens keep.
        playerFlags(leagueId).then((f) => {
          if (Array.isArray(f)) { setLeagueFlags(leagueId, f); setFlagsVer((v) => v + 1); }
        }).catch(() => {});
        const oppRoster = m.home_roster_id === rosterId ? m.away_roster_id : m.home_roster_id;
        liveSlate(m.week, '2026').then(setSlate).catch(() => {});
        leagueStandings(leagueId).then((rows) => {
          const map: Record<number, { wins: number; losses: number; ties: number; rank: number }> = {};
          (Array.isArray(rows) ? rows : []).forEach((row, i) => {
            map[row.roster_id] = { wins: row.wins, losses: row.losses, ties: row.ties, rank: i + 1 };
          });
          setRecords(map);
        }).catch(() => {});
        matchupTeams(leagueId, [rosterId, oppRoster]).then((tm: Record<number, TeamInfo>) => {
          setAvatars({ me: tm[rosterId]?.avatar ?? null, opp: tm[oppRoster]?.avatar ?? null });
          setNames({ me: tm[rosterId]?.team_name || 'YOU', opp: tm[oppRoster]?.team_name || 'OPPONENT' });
        }).catch(() => {});
        const [pl, pk] = await Promise.all([myPool(leagueId, m.week, rosterId), myPicks(m.id, userId)]);
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
    const id = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!locked || !matchup) return;
    let stop = false;
    // Best ball fills from the opponent's FULL roster, so fetch it once.
    const oppRoster = matchup.home_roster_id === rosterId ? matchup.away_roster_id : matchup.home_roster_id;
    if (bestball.length) myPool(leagueId, matchup.week, oppRoster).then((p) => { if (!stop) setOppPool(p); }).catch(() => {});
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
    const id = setInterval(() => { void load(); }, 60_000);
    return () => { stop = true; clearInterval(id); };
  }, [locked, matchup, userId, leagueId, rosterId, bestball.length]);

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
  // The EFFECTIVE lineup per side: manual picks in non-best-ball slots plus
  // the engine's fills — the same bestballFill the worker scores with.
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

  // ── The head-to-head board (v0.229.0) ───────────────────────────────────
  // Same three steps as the web board, and deliberately the same numbers:
  // every figure comes out of buildMatchupBoard, so a manager comparing the
  // phone against the site can never find a discrepancy to argue about.
  //
  // FINAL is inferred at 3h20m past kickoff — the slate carries no status
  // column, and without an end signal every started game reads 'live' forever
  // and the projection never settles on the real score.
  const finalTeams = useMemo(() => {
    const out = new Set<string>();
    for (const g of slate) {
      const t = g.kickoff ? Date.parse(g.kickoff) : NaN;
      if (Number.isFinite(t) && nowTs - t > 3.34 * 3600_000) { out.add((g.home ?? '').toUpperCase()); out.add((g.away ?? '').toUpperCase()); }
    }
    return out;
  }, [slate, nowTs]);

  const entryFor = useMemo(() => {
    void playsAt; void flagsVer;
    return (slug: string | null | undefined, slotPos?: string[]): BoardEntry | null => {
      if (!slug) return null;
      const meta = slugMeta(slug);
      const g = gameFor(meta.team, slate);
      return {
        slug,
        name: prettySlug(slug),
        pos: meta.pos ?? '',
        team: meta.team ?? null,
        live: pts(slug, slotPos),
        proj: PROJ_2026.get(slug) ?? 0,
        state: g ? entryState(g.kickoff, meta.team, nowTs, finalTeams) : 'pre',
        kickoff: g?.kickoff ? fmtKick(g.kickoff) : null,
        opponent: g ? `${g.home ? 'vs' : '@'} ${g.opponent}` : 'BYE',
        injury: injuryFor(matchup?.week ?? 1, slug),
      };
    };
  }, [slate, pts, nowTs, finalTeams, matchup, playsAt, flagsVer]);

  const board = useMemo(() => {
    if (!matchup) return null;
    const oppRoster = matchup.home_roster_id === rosterId ? matchup.away_roster_id : matchup.home_roster_id;
    const mkSide = (rid: number, team: string, avatar: string | null, lineup: Record<string, string | null>, benchList: PoolPlayer[]) => ({
      rosterId: rid, team, avatar,
      record: records[rid] ?? null,
      starters: Object.fromEntries(slotDefs.map((d) => [d.slot, entryFor(lineup[d.slot], d.pos)])),
      bench: benchList.filter((p) => !stashed.has(p.slug)).map((p) => entryFor(p.slug)).filter((e): e is BoardEntry => !!e),
      ir: benchList.filter((p) => stashed.has(p.slug)).map((p) => entryFor(p.slug)).filter((e): e is BoardEntry => !!e),
    });
    return buildMatchupBoard({
      week: matchup.week, locked, slots: slotDefs, labelFor: slotDisplayName,
      home: mkSide(rosterId, names.me, avatars.me, effective.mine, bench),
      // The opponent's bench isn't readable, and shouldn't be — an empty
      // column beside mine would imply they had nobody, not that I can't see.
      away: mkSide(oppRoster, names.opp, avatars.opp, effective.theirs, []),
    });
  }, [matchup, rosterId, slotDefs, effective, names, avatars, records, bench, stashed, entryFor, locked]);

  const assign = async (slot: string, slug: string | null) => {
    if (!matchup) return;
    const prev = mine;
    setMine({ ...mine, [slot]: slug }); setPickerSlot(null); setSaveNote(null);
    try {
      await savePicks(matchup.id, userId, [{ game_window: CLASSIC_WIN, roster_slot: slot, player_slug: slug, metric_id: null }]);
      commit();
      setSaveNote('✓ lineup saved');
    } catch (e) {
      setMine(prev);
      setSaveNote(friendlyError(e));
    }
  };

  if (state === 'loading') return <View style={{ padding: 32, alignItems: 'center' }}><ActivityIndicator color={t.you} /></View>;
  if (state === 'none') return <View style={{ padding: 24 }}><Mono size={10} tone="faint">No matchup this week.</Mono></View>;
  if (state === 'error') return <View style={{ padding: 24 }}><Mono size={10} tone="warn">{err}</Mono></View>;

  // Totals now come from the board (same arithmetic, plus projections and
  // empty-spot handling); the fallback grid below computes its own inline.

  const Face = ({ slug, size = 26 }: { slug: string; size?: number }) => {
    const uri = headshot(slug);
    return uri
      ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg }} />
      : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}><Mono size={7} tone="faint">{slugMeta(slug).team || '?'}</Mono></View>;
  };

  const slotDef = pickerSlot ? slotDefs.find((d) => d.slot === pickerSlot) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48, gap: 10 }}>
      <Mono size={9} tone="faint" track={0.1} style={{ textAlign: 'center' }}>
        CLASSIC · WEEK {matchup?.week} · {ppr === 1 ? 'FULL PPR' : ppr === 0.5 ? 'HALF PPR' : 'NON-PPR'}
      </Mono>

      {/* ── SCOREBOARD (v0.229.0) ─────────────────────────────────────────
          The web board's header, in RN. Pre-lock the projection half stays
          hidden: nothing has happened, so a win % would be asserting
          something about a lineup that can still change. */}
      {board && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TeamHead side={board.home} align="left" />
            <View style={{ alignItems: 'center' }}>
              <Mono size={8.5} tone="faint">{locked ? 'LIVE' : 'LOCKS'}</Mono>
              {!locked && <Mono size={8} tone="faint" style={{ marginTop: 2 }}>{fmtLock(matchup?.lock_at ?? null)}</Mono>}
            </View>
            <TeamHead side={board.away} align="right" scoreless={!locked} />
          </View>
          {locked && (
            <>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 9, height: 5 }}>
                <View style={{ flex: Math.max(0.02, board.home.winPct), backgroundColor: t.you, borderRadius: 3 }} />
                <View style={{ flex: Math.max(0.02, board.away.winPct), backgroundColor: t.opp, borderRadius: 3 }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Mono size={9} tone="you" weight="700">{Math.round(board.home.winPct * 100)}% WIN</Mono>
                <Mono size={9} tone="opp" weight="700">{Math.round(board.away.winPct * 100)}% WIN</Mono>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7, gap: 10 }}>
                <Mono size={8.5} tone="faint" style={{ flex: 1, lineHeight: 12 }}>
                  {`yet to play (${board.home.yetToPlay})${board.home.yetToPlayBreakdown ? `\n${board.home.yetToPlayBreakdown}` : ''}`}
                </Mono>
                <Mono size={8.5} tone="faint" style={{ flex: 1, textAlign: 'right', lineHeight: 12 }}>
                  {`yet to play (${board.away.yetToPlay})${board.away.yetToPlayBreakdown ? `\n${board.away.yetToPlayBreakdown}` : ''}`}
                </Mono>
              </View>
            </>
          )}
        </Card>
      )}

      {/* ── STARTERS, head to head. Locked only: pre-lock this screen is a
          LINEUP SETTER and the editable grid below is the right tool. ── */}
      {locked && board && (
        <>
          <Card style={{ paddingVertical: 2 }}>
            <Mono size={8.5} tone="faint" weight="700" track={0.1} style={{ paddingVertical: 6 }}>STARTERS</Mono>
            {board.starters.map((row) => (
              <View key={row.slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.bd }}>
                <BoardCell e={row.home} align="left" />
                <Mono size={11} weight="700" style={{ width: 42, textAlign: 'right' }}>{row.home ? row.home.live.toFixed(2) : '—'}</Mono>
                <SlotPill pos={row.pos} label={row.label} />
                <Mono size={11} weight="700" style={{ width: 42 }}>{row.away ? row.away.live.toFixed(2) : '—'}</Mono>
                <BoardCell e={row.away} align="right" />
              </View>
            ))}
          </Card>
          {(['bench', 'ir'] as const).map((k) => (
            board[k].home.length > 0 ? (
              <Card key={k} style={{ paddingVertical: 2 }}>
                <Mono size={8.5} tone="faint" weight="700" track={0.1} style={{ paddingVertical: 6 }}>
                  {k === 'bench' ? 'BENCH' : 'TAXI / IR'}
                </Mono>
                {board[k].home.map((e) => (
                  <View key={e.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.bd }}>
                    <BoardCell e={e} align="left" />
                    <Mono size={10.5} tone="dim" weight="700" style={{ width: 52, textAlign: 'right' }}>{e.live.toFixed(2)}</Mono>
                  </View>
                ))}
              </Card>
            ) : null
          ))}
        </>
      )}

      {/* Lineup — the SETTER (pre-lock), and the fallback whenever the board
          can't assemble. */}
      {!(locked && board) && (
      <Card style={{ paddingVertical: 2 }}>
        {slotDefs.map((d, i) => {
          const auto = bb.has(d.slot);
          const my = effective.mine[d.slot];
          const their = effective.theirs[d.slot];
          return (
          <View key={d.slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.bd }}>
            <Mono size={9} tone={auto ? 'you' : 'dim'} weight="700" style={{ width: 34 }}>{auto ? `${d.slot}\n🎯` : d.slot}</Mono>
            <Pressable
              onPress={() => { if (!locked && !auto) { tap(); setPickerSlot(pickerSlot === d.slot ? null : d.slot); } }}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              {auto && !locked ? (
                <Mono size={9} tone="faint">BEST BALL — fills itself{'\n'}with your top scorer</Mono>
              ) : my ? (
                <>
                  <Face slug={my} />
                  <View style={{ flexShrink: 1 }}>
                    <Display size={12.5}>{prettySlug(my)}</Display>
                    <Mono size={8} tone="faint">{slugMeta(my).team}</Mono>
                  </View>
                </>
              ) : (
                <Mono size={10} tone={locked || auto ? 'faint' : 'you'}>{locked || auto ? '—' : `+ SET ${d.slot}`}</Mono>
              )}
            </Pressable>
            <Mono size={12} tone="you" weight="700">{locked || my ? r1(pts(my, d.pos)) : ''}</Mono>
            {locked && (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }}>
                <Mono size={12} tone="dim" weight="700">{r1(pts(their, d.pos))}</Mono>
                {their
                  ? <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
                      <Display size={12.5}>{prettySlug(their)}</Display>
                    </View>
                  : <Mono size={10} tone="faint">—</Mono>}
              </View>
            )}
          </View>
          );
        })}
      </Card>
      )}
      {saveNote && <Mono size={9} tone={saveNote.startsWith('✓') ? 'faint' : 'warn'}>{saveNote}</Mono>}

      {/* Picker */}
      {!locked && pickerSlot && slotDef && (
        <Card>
          <Mono size={9} tone="faint" weight="700" style={{ marginBottom: 8 }}>SET {slotDisplayName(slotDef)} — {slotDef.pos.join(' / ')}{fltLabel(slotDef.flt) ? ` · ${fltLabel(slotDef.flt)}` : ''}</Mono>
          {mine[pickerSlot] && (
            <Pressable onPress={() => { void assign(pickerSlot, null); }} style={{ paddingVertical: 7 }}>
              <Mono size={10} tone="dim">✕ CLEAR SLOT</Mono>
            </Pressable>
          )}
          {bench.filter((p) => slotAllows(slotDef, { pos: p.pos, team: p.team, exp: expMap[p.slug] ?? null })).map((p) => (
            <Pressable key={p.slug} onPress={() => { void assign(pickerSlot, p.slug); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 }}>
              <Face slug={p.slug} />
              <Display size={12.5} style={{ flexShrink: 1 }}>{shortName(p.full)}</Display>
              <PosPill pos={p.pos} />
              <Mono size={8.5} tone="faint">{p.team}</Mono>
            </Pressable>
          ))}
        </Card>
      )}

      {/* Bench */}
      <Card>
        <Mono size={9} tone="faint" weight="700" style={{ marginBottom: 8 }}>BENCH</Mono>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {bench.map((p) => (
            <Chip key={p.slug} label={`${shortName(p.full)} · ${p.pos}${locked ? ` · ${r1(pts(p.slug))}` : ''}`} dim onPress={() => {}} />
          ))}
          {!bench.length && <Mono size={10} tone="faint">everyone's starting</Mono>}
        </View>
      </Card>

      <Mono size={8.5} tone="faint" style={{ lineHeight: 14 }}>
        CLASSIC MODE — standard scoring across every stat ({ppr === 1 ? '1 pt' : ppr === 0.5 ? '½ pt' : 'no points'} per catch), live play by play.
        The whole lineup locks at the week's first kickoff. No windows, no power-ups, no bonuses.
        {bb.size > 0 ? (bb.size >= slotDefs.length
          ? ' FULL BEST BALL: every slot takes your highest scorer automatically — nothing to set.'
          : " 🎯 slots are BEST BALL: they automatically take your highest-scoring player who isn't already started.") : ''}
      </Mono>
    </ScrollView>
  );
}
