// CLASSIC (normie) league board, native (0157) — the app twin of web's
// src/screens/ClassicBoard.tsx. One weekly lineup, standard scoring, live
// totals; no windows, no metrics, no power-up chrome. Same logic, same
// storage: sealed_pick rows under the 'wk' pseudo-window, sealed at the
// week's first kickoff (matchup.lock_at), scored by core's classicPoints off
// the same live play stream, refreshed every 60s.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import type { Pos } from '@drip/core/types';
import { CLASSIC_SLOTS, CLASSIC_WIN, classicPoints, bestballFill, type ClassicPick, type ClassicScoring } from '@drip/core/engine/classic';
import { setLeagueFlags } from '@drip/core/data/commish';
import { slugMeta } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { headshot } from '@drip/core/data/media';
import { setLivePlays, liveRowsToPbp } from '@drip/core/data/realPbp';
import {
  myMatchup, myPool, myPicks, savePicks, getRevealedPicks, matchupTeams,
  leagueGameMode, weekLivePlays, friendlyError, playerFlags,
  type LiveMatchup, type PoolPlayer, type TeamInfo,
} from '@drip/core/data/liveApi';
import { useTheme } from '../theme.native';
import { tap, commit } from './feedback';
import { Card, Chip, Display, Mono, PosPill } from './prims';

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

export function ClassicBoard({ userId, leagueId, rosterId }: { userId: string; leagueId: string; rosterId: number }) {
  const t = useTheme();
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [ppr, setPpr] = useState(1);
  const [scoring, setScoring] = useState<Record<string, number>>({});
  const [flagsVer, setFlagsVer] = useState(0);
  const [bestball, setBestball] = useState<string[]>([]);
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

  useEffect(() => {
    (async () => {
      try {
        setState('loading'); setErr(null);
        const m = await myMatchup(leagueId, rosterId);
        if (!m) { setState('none'); return; }
        setMatchup(m);
        leagueGameMode(leagueId).then((gm) => { if (gm.ok) { if (gm.ppr != null) setPpr(Number(gm.ppr)); setBestball(gm.bestball ?? []); setScoring(gm.scoring ?? {}); } }).catch(() => {});
        // Flag rules (0144) bite classic scoring (bonus_mult / bonus_pts) and
        // the best-ball fill (no_start) — same cache the drip screens keep.
        playerFlags(leagueId).then((f) => {
          if (Array.isArray(f)) { setLeagueFlags(leagueId, f); setFlagsVer((v) => v + 1); }
        }).catch(() => {});
        const oppRoster = m.home_roster_id === rosterId ? m.away_roster_id : m.home_roster_id;
        matchupTeams(leagueId, [rosterId, oppRoster]).then((tm: Record<number, TeamInfo>) => setNames({
          me: tm[rosterId]?.team_name || 'YOU', opp: tm[oppRoster]?.team_name || 'OPPONENT',
        })).catch(() => {});
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
  const pts = useMemo(() => {
    void playsAt; void flagsVer;
    if (!matchup) return () => 0;
    return (slug: string | null | undefined) => (slug ? classicPoints(mkPlayer(slug), matchup.week, sc) : 0);
  }, [matchup, sc, playsAt, flagsVer]);

  const bb = useMemo(() => new Set(bestball), [bestball]);
  // The EFFECTIVE lineup per side: manual picks in non-best-ball slots plus
  // the engine's fills — the same bestballFill the worker scores with.
  const effective = useMemo(() => {
    void playsAt;
    const build = (manual: Record<string, string | null | undefined>, rosterSlugs: string[]) => {
      const out: Record<string, string | null> = {};
      const manualPicks: ClassicPick[] = [];
      for (const d of CLASSIC_SLOTS) {
        if (bb.has(d.slot)) { out[d.slot] = null; continue; }
        out[d.slot] = manual[d.slot] ?? null;
        if (manual[d.slot]) manualPicks.push({ slot: d.slot, player: mkPlayer(manual[d.slot]!) });
      }
      if (locked && matchup && bb.size) {
        for (const f of bestballFill(manualPicks, bestball, rosterSlugs.map(mkPlayer), matchup.week, sc)) out[f.slot] = f.player.id;
      }
      return out;
    };
    return {
      mine: build(mine, pool.map((p) => p.slug)),
      theirs: build(theirs, oppPool.map((p) => p.slug)),
    };
  }, [mine, theirs, pool, oppPool, bb, bestball, locked, matchup, sc, playsAt, flagsVer]);

  // Only MANUAL starters reserve players; best-ball slots never block the picker.
  const used = useMemo(() => new Set(
    CLASSIC_SLOTS.filter((d) => !bb.has(d.slot)).map((d) => mine[d.slot]).filter(Boolean) as string[],
  ), [mine, bb]);
  const bench = useMemo(() => pool.filter((p) => !used.has(p.slug)), [pool, used]);

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

  const myTotal = CLASSIC_SLOTS.reduce((s, d) => s + pts(effective.mine[d.slot]), 0);
  const oppTotal = CLASSIC_SLOTS.reduce((s, d) => s + pts(effective.theirs[d.slot]), 0);

  const Face = ({ slug, size = 26 }: { slug: string; size?: number }) => {
    const uri = headshot(slug);
    return uri
      ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg }} />
      : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}><Mono size={7} tone="faint">{slugMeta(slug).team || '?'}</Mono></View>;
  };

  const slotDef = pickerSlot ? CLASSIC_SLOTS.find((d) => d.slot === pickerSlot) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48, gap: 10 }}>
      <Mono size={9} tone="faint" track={0.1} style={{ textAlign: 'center' }}>
        CLASSIC · WEEK {matchup?.week} · {ppr === 1 ? 'FULL PPR' : ppr === 0.5 ? 'HALF PPR' : 'NON-PPR'}
      </Mono>

      {/* Scoreboard */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Mono size={8.5} tone="you" weight="700">{names.me}</Mono>
            <Display size={26}>{r1(myTotal)}</Display>
          </View>
          <Mono size={8.5} tone="faint">{locked ? 'LIVE' : `LOCKS ${fmtLock(matchup?.lock_at ?? null)}`}</Mono>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Mono size={8.5} tone="dim" weight="700">{names.opp}</Mono>
            <Display size={26}>{locked ? r1(oppTotal) : '—'}</Display>
          </View>
        </View>
      </Card>

      {/* Lineup */}
      <Card style={{ paddingVertical: 2 }}>
        {CLASSIC_SLOTS.map((d, i) => {
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
            <Mono size={12} tone="you" weight="700">{locked || my ? r1(pts(my)) : ''}</Mono>
            {locked && (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }}>
                <Mono size={12} tone="dim" weight="700">{r1(pts(their))}</Mono>
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
      {saveNote && <Mono size={9} tone={saveNote.startsWith('✓') ? 'faint' : 'warn'}>{saveNote}</Mono>}

      {/* Picker */}
      {!locked && pickerSlot && slotDef && (
        <Card>
          <Mono size={9} tone="faint" weight="700" style={{ marginBottom: 8 }}>SET {pickerSlot} — {slotDef.pos.join(' / ')}</Mono>
          {mine[pickerSlot] && (
            <Pressable onPress={() => { void assign(pickerSlot, null); }} style={{ paddingVertical: 7 }}>
              <Mono size={10} tone="dim">✕ CLEAR SLOT</Mono>
            </Pressable>
          )}
          {bench.filter((p) => slotDef.pos.includes(p.pos as Pos)).map((p) => (
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
        {bb.size > 0 ? (bb.size === CLASSIC_SLOTS.length
          ? ' FULL BEST BALL: every slot takes your highest scorer automatically — nothing to set.'
          : " 🎯 slots are BEST BALL: they automatically take your highest-scoring player who isn't already started.") : ''}
      </Mono>
    </ScrollView>
  );
}
