// CLASSIC (normie) league board, native (0157) — the app twin of web's
// src/screens/ClassicBoard.tsx. One weekly lineup, standard scoring, live
// totals; no windows, no metrics, no power-up chrome. Same logic, same
// storage: sealed_pick rows under the 'wk' pseudo-window, sealed at the
// week's first kickoff (matchup.lock_at), scored by core's classicPoints off
// the same live play stream, refreshed every 60s.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { leagueSlotDefs, leagueBestball, slotAllows, isRetSlot, slotDisplayNames, slotAcceptsLabel, slotFilterLabel, planSpotMove, autoSlotPlan, slateAwareProj, CLASSIC_WIN, classicPoints, bestballFill, bestballFillBy, type ClassicPick, type ClassicScoring, type SlotSpec } from '@drip/core/engine/classic';
import { setLeagueFlags } from '@drip/core/data/commish';
import { setLeagueScoring, parseScoring } from '@drip/core/engine/leagueScoring';
import { buildMatchupBoard, gameFor, entryState, venueTeam, isPrimetime, isBye, type BoardEntry, type BoardSide } from '@drip/core/engine/matchupBoard';
import { roofFor } from '@drip/core/data/stadiums';
import { PROJ_2026 } from '@drip/core/data/proj2026';
import { injuryFor } from '@drip/core/data/injuries';
import { slugMeta, setSlugMetaOverrides } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { headshot } from '@drip/core/data/media';
import { setLivePlays, liveRowsToPbp } from '@drip/core/data/realPbp';
import { setLiveGameFeed, feedRowsToWeek, gameFeedFor } from '@drip/core/data/gameFeed';
import {
  myMatchup, myPool, myPicks, savePicks, getRevealedPicks, matchupTeams,
  liveSlate, leagueStandings,
  leagueGameMode, weekLivePlays, weekGameFeeds, friendlyError, playerFlags, leaguePoolExp, leagueScoringGet,
  type LiveMatchup, type PoolPlayer, type TeamInfo, type GameFeedRow,
  nativeRosters,
} from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
import { tap, commit } from './feedback';
import { Card, Chip, Display, Mono, PosPill } from './prims';
import { Overlay } from './Overlay';
import { FieldView } from './FieldView';
import { openPlayerCard } from './PlayerCardSheet';

/** One team in the scoreboard: crest, name, record + seed, and the headline
 *  number.
 *
 *  `mode`: 'live' — points. 'proj' — nothing has kicked off, so the projected
 *  total is the headline. 'hidden' — the opponent's lineup is sealed until
 *  kickoff (RLS, not shyness), so there is no number to show and a 0.00 would
 *  read as "they have nobody". */
function TeamHead({ side, align, mode }: { side: BoardSide; align: 'left' | 'right'; mode: 'live' | 'proj' | 'hidden' }) {
  const t = useTheme();
  const rec = side.record;
  const right = align === 'right';
  const big = mode === 'hidden' ? '—' : mode === 'proj' ? side.projected.toFixed(1) : side.live.toFixed(2);
  const sub = mode === 'hidden' ? 'sealed until kickoff' : mode === 'proj' ? 'projected' : side.projected.toFixed(1);
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
      <Display size={24} style={{ marginTop: 3 }}>{big}</Display>
      <Mono size={8.5} tone={mode === 'hidden' ? 'faint' : 'dim'}>{sub}</Mono>
    </View>
  );
}

/** The centre slot marker: eligible positions as colour bands, plus the
 *  spot's REAL NAME under them.
 *
 *  The first cut truncated the name to four characters, which quietly
 *  destroyed the thing the commissioner had just built — "NFC Flex" became
 *  "NFC ", "Rookie Only" became "Rook". A custom label is a rule the league
 *  agreed on; it has to reach the board intact or the builder's label feature
 *  stops meaning anything once the games start. Positions are NAMED as well as
 *  coloured, since colour alone asks the reader to have memorised the palette. */
function SlotPill({ pos, label }: { pos: string[]; label: string }) {
  const t = useTheme();
  const posLine = pos.length > 1 ? pos.map((p) => (p === 'DEF' ? 'D/ST' : p)).join('/') : null;
  const first = t.pos[pos[0] as keyof typeof t.pos];
  return (
    <View style={{ width: 66, alignItems: 'center', gap: 2 }}>
      <View style={{ flexDirection: 'row', width: 40, height: 4, borderRadius: 3, overflow: 'hidden', borderWidth: 1, borderColor: t.bd }}>
        {pos.slice(0, 6).map((p) => (
          <View key={p} style={{ flex: 1, backgroundColor: t.pos[p as keyof typeof t.pos]?.bg ?? t.bg }} />
        ))}
      </View>
      <Text numberOfLines={2} style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: first?.fg ?? t.text, textAlign: 'center' }}>{label}</Text>
      {!!posLine && <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 7, color: t.faint, textAlign: 'center' }}>{posLine}</Text>}
    </View>
  );
}

/** The round portrait, with the team code as its fallback — a missing headshot
 *  costs the picture, never the row. Module level: it is used by BoardCell, the
 *  setter and the picker, and defining it inside the screen made React treat it
 *  as a new component type on every render. */
function Face({ slug, size = 26 }: { slug: string; size?: number }) {
  const t = useTheme();
  const uri = headshot(slug);
  return uri
    ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg }} />
    : (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Mono size={7} tone="faint">{slugMeta(slug).team || '?'}</Mono>
      </View>
    );
}

/** A player on one side of a row, mirrored so both read outward from the pill.
 *  `onGame` makes the game line its own tap target — into the live field +
 *  play log for that NFL game — without stealing the row's picker tap. */
function BoardCell({ e, align, onGame, onName }: {
  e: BoardEntry | null; align: 'left' | 'right'; onGame?: () => void;
  /** The NAME opens the player card (v0.283.0, founder). It is its own target
   *  so the row can stop being one big button: reading about a player and
   *  changing the spot he sits in are different intentions. */
  onName?: () => void;
}) {
  const t = useTheme();
  const right = align === 'right';
  if (!e) return <View style={{ flex: 1 }}><Mono size={10} tone="faint" style={{ textAlign: right ? 'right' : 'left' }}>Empty</Mono></View>;
  // NO PORTRAIT HERE, deliberately (founder, v0.241.0): a phone's board is a
  // dense mirrored list, and a face per side costs height for identity the name
  // already carries. The PICKER keeps its faces — that sheet exists to pick a
  // player out of a list, and it has the room. The web board keeps them too.
  //
  // The game line lives on this cell now rather than in a boxed sub-card below,
  // which is most of what made the rows tall.
  // A blank game line reads as a rendering fault, so an unplaceable player
  // says so rather than showing nothing (and rather than claiming a bye).
  const line = e.opponent === 'BYE' ? 'BYE' : (`${e.kickoff ?? ''} ${e.opponent ?? ''}`.trim() || 'no game listed');
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {onName ? (
        <Pressable hitSlop={6} onPress={() => { tap(); onName(); }} style={{ alignSelf: right ? 'flex-end' : 'flex-start' }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: e.state === 'done' ? t.dim : t.text, textAlign: right ? 'right' : 'left' }}>{e.name}</Text>
        </Pressable>
      ) : (
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: e.state === 'done' ? t.dim : t.text, textAlign: right ? 'right' : 'left' }}>{e.name}</Text>
      )}
      <Text numberOfLines={1} style={{ fontSize: 9, marginTop: 1, color: t.faint, textAlign: right ? 'right' : 'left' }}>
        <Text style={{ color: t.pos[e.pos as keyof typeof t.pos]?.fg ?? t.dim, fontWeight: '700' }}>{e.pos}</Text>
        {e.team ? ` · ${e.team}` : ''}
        {e.injury ? <Text style={{ color: t.warn, fontWeight: '700' }}>{` ${e.injury}`}</Text> : null}
      </Text>
      {onGame ? (
        <Pressable hitSlop={6} onPress={() => { tap(); onGame(); }} style={{ alignSelf: right ? 'flex-end' : 'flex-start' }}>
          <Text numberOfLines={1} style={{ fontSize: 8.5, marginTop: 1, color: t.you, textAlign: right ? 'right' : 'left' }}>
            {right ? `▸ ${line}${roofMark(e)}` : `${line}${roofMark(e)} ▸`}
          </Text>
        </Pressable>
      ) : (
        <Text numberOfLines={1} style={{ fontSize: 8.5, marginTop: 1, color: e.opponent === 'BYE' ? t.warn : t.faint, textAlign: right ? 'right' : 'left' }}>
          {`${line}${roofMark(e)}`}
        </Text>
      )}
    </View>
  );
}

/** The game-line markers, as text so they cost no layout: 🏟 roofed, ☾ night. */
function roofMark(e: BoardEntry): string {
  const roofed = e.roof && e.roof !== 'open';
  return `${roofed ? '  \u{1F3DF}' : ''}${e.primetime ? '  \u263E' : ''}`;
}

/** The figure on a row: points once the ball is live, the projection before it.
 *  No "proj" label — the founder wanted the number alone — so the difference is
 *  carried by colour (quiet before kickoff) rather than by a word. */
function scoreOf(e: BoardEntry | null): string {
  if (!e) return '—';
  return e.state === 'pre' ? e.proj.toFixed(1) : e.live.toFixed(2);
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
/** "Q2 8:41" from game-elapsed seconds — the play log's clock column (the same
 *  arithmetic FieldView uses for its score strip). */
const fmtQClock = (c: number): string => {
  if (c >= 3600) { const rem = 600 - ((c - 3600) % 600); return `OT ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`; }
  const q = Math.floor(c / 900) + 1; const rem = 900 - (c % 900);
  return `Q${q} ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
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
  // AUTO-SLOT PRE-CONDITIONS (v0.247.0). The fill below writes to the server,
  // so it must not run on half-loaded inputs: the spot list decides what is
  // legal, tenure decides who clears a filtered spot, and a stash the DB would
  // refuse takes the whole batch down. Each flag is set only on the SUCCESS
  // path of its own load — a failed read leaves the fill to the worker rather
  // than guessing from an empty default.
  const [setupReady, setSetupReady] = useState(false);
  const [stashReady, setStashReady] = useState(false);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [oppPool, setOppPool] = useState<PoolPlayer[]>([]);
  const [mine, setMine] = useState<Record<string, string | null>>({});
  // Which of MY spots the server has sealed (0178: one player at a time, at
  // his own kickoff — so this is per slot, not one flag for the week).
  const [sealedSlots, setSealedSlots] = useState<Record<string, boolean>>({});
  const [theirs, setTheirs] = useState<Record<string, string>>({});
  const [names, setNames] = useState<{ me: string; opp: string }>({ me: 'YOU', opp: 'OPPONENT' });
  const [playsAt, setPlaysAt] = useState(0);
  const [pickerSlot, setPickerSlot] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  // ▦ FIELDS (v0.270.0): the all-fields sheet, and one game's field + play log
  // (opened from a tapped game line). gameFeeds is state — not just the module
  // cache — because setLiveGameFeed writes a map React cannot see; the row
  // count here is what ties the fields to a re-render when the feeds land.
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fieldGame, setFieldGame] = useState<string | null>(null); // team abbr locating the game
  const [gameFeeds, setGameFeeds] = useState<GameFeedRow[]>([]);
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
          setStashReady(true);
        }).catch(() => {});
        leagueGameMode(leagueId).then(async (gm) => {
          if (gm.ok) { if (gm.ppr != null) setPpr(Number(gm.ppr)); setBestball(leagueBestball(gm)); setScoring(gm.scoring ?? {}); setRosterCfg(gm.roster ?? {}); setSlotsSpec(gm.slots ?? null); }
          // A spot with a tenure window (0172) needs years_exp from league_pool.
          // Awaited rather than fired-and-forgotten so the auto-slot below can't
          // run against an empty tenure map and leave every filtered spot blank.
          if (gm.ok && (gm.slots ?? []).some((s) => s.min_exp != null || s.max_exp != null)) {
            try { setExpMap(await leaguePoolExp(leagueId)); } catch { return; }
          }
          if (gm.ok) setSetupReady(true);
        }).catch(() => {});
        // Flag rules (0144) bite classic scoring (bonus_mult / bonus_pts) and
        // the best-ball fill (no_start) — same cache the drip screens keep.
        playerFlags(leagueId).then((f) => {
          if (Array.isArray(f)) { setLeagueFlags(leagueId, f); setFlagsVer((v) => v + 1); }
        }).catch(() => {});
        // SCOPED rules (0145) reach classic as of v0.277.0 — classicPoints
        // reads them, so the board installs the league's before it scores
        // anything, or it draws numbers the worker doesn't. flagsVer is the
        // shared recompute signal: both are module caches React can't see.
        leagueScoringGet(leagueId).then((sc) => {
          if (sc?.ok) { setLeagueScoring(parseScoring(sc)); setFlagsVer((v) => v + 1); }
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
        // The league's OWN roster meta beats the bake (0200.1): a 2026 rookie
        // the baked slug map has never heard of otherwise resolves to WR with
        // an EMPTY team — which reads as a bye on the board and scores as a WR
        // in classicPoints. The pool row knows his real position and team.
        setSlugMetaOverrides(pl.map((x) => ({ slug: x.slug, pos: x.pos, team: x.team })));
        const map: Record<string, string | null> = {};
        const seal: Record<string, boolean> = {};
        for (const p of pk) {
          if (p.game_window !== CLASSIC_WIN) continue;
          map[p.roster_slot] = p.player_slug;
          seal[p.roster_slot] = !!p.locked;
        }
        setMine(map);
        setSealedSlots(seal);
        setState('ready');
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load.'); setState('error');
      }
    })();
  }, [userId, leagueId, rosterId]);

  // THE WEEK IS UNDERWAY — presentation only (live scores rather than
  // projections, the win bar, the best-ball fill). Since 0178 it is NOT
  // permission to edit: a classic lineup locks one player at a time, at his own
  // kickoff, so editability is the per-row `canEdit` below. Read off the
  // SLATE's first kickoff, not matchup.lock_at, which is deliberately an hour
  // early — "nothing locks before kick off" includes not calling the week live
  // before it is.
  const firstKick = useMemo(() => {
    const ks = slate.map((g) => (g.kickoff ? Date.parse(g.kickoff) : NaN)).filter(Number.isFinite);
    return ks.length ? Math.min(...ks) : null;
  }, [slate]);
  const locked = Object.values(sealedSlots).some(Boolean)
    || (matchup?.status != null && matchup.status !== 'scheduled')
    || (firstKick != null && firstKick <= nowTs);
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The opponent's lineup + roster + the week's live plays. Since 0178 a
  // classic league's lineups are OPEN — sealed_pick's policy hands them over
  // sealed or not — so this runs from the moment the screen opens.
  useEffect(() => {
    if (!matchup) return;
    let stop = false;
    // Best ball fills from the opponent's FULL roster, so fetch it once.
    const oppRoster = matchup.home_roster_id === rosterId ? matchup.away_roster_id : matchup.home_roster_id;
    // The opponent's ROSTER, always — not just in best-ball leagues. Since
    // v0.248.0 an unmanaged seat (no app_user_id, so sealed_pick has nowhere to
    // store a lineup) fields its best projected lineup from its roster, and
    // without this the board would show that seat empty while the resolver
    // scored it. In the founder's own leagues that is seven seats in eight.
    myPool(leagueId, matchup.week, oppRoster).then((p) => { if (!stop) { setOppPool(p); setSlugMetaOverrides(p.map((x) => ({ slug: x.slug, pos: x.pos, team: x.team }))); } }).catch(() => {});
    const load = async () => {
      try {
        const [rev, rows, gf] = await Promise.all([
          getRevealedPicks(matchup.id), weekLivePlays(matchup.week),
          weekGameFeeds(matchup.week).catch(() => [] as GameFeedRow[]),
        ]);
        if (stop) return;
        const opp: Record<string, string> = {};
        for (const p of rev) {
          if (p.app_user_id === userId || p.game_window !== CLASSIC_WIN || !p.player_slug) continue;
          opp[p.roster_slot] = p.player_slug;
        }
        setTheirs(opp);
        setLivePlays(matchup.week, liveRowsToPbp(rows));
        // Install the week's per-game feeds so gameFeedFor() resolves — same
        // exclusivity rule as the drip board: a live week must never fall
        // through to baked 2025 drives, which would draw a plausible, wrong
        // field. Empty rows install an empty overlay, deliberately.
        setLiveGameFeed(matchup.week, feedRowsToWeek(gf));
        setGameFeeds(gf);
        setPlaysAt(Date.now());
      } catch { /* transient — next tick retries */ }
    };
    void load();
    const id = setInterval(() => { void load(); }, 60_000);
    return () => { stop = true; clearInterval(id); };
  }, [matchup, userId, leagueId, rosterId]);

  const sc = useMemo<Partial<ClassicScoring>>(() => ({ ...scoring, ppr }), [scoring, ppr]);
  // The league's configured lineup (0161) — slot names, types, eligibility.
  const slotDefs = useMemo(() => leagueSlotDefs({ roster, slots: slotsSpec }), [roster, slotsSpec]);
  // What each spot is CALLED on screen. The stored name (S1, RB2) is a storage
  // key, not something to set a lineup against — this is the commissioner's own
  // label (0174) or the derived one, with repeats numbered so two identical
  // rows can be told apart. One map, so the setter, the picker and the locked
  // board can never disagree about what a spot is called.
  const slotName = useMemo(() => {
    const names = slotDisplayNames(slotDefs);
    return new Map(slotDefs.map((d, i) => [d.slot, names[i]]));
  }, [slotDefs]);
  const nameOf = (d: { slot: string; label?: string; pos: string[] }) => slotName.get(d.slot) ?? d.slot;
  const pts = useMemo(() => {
    void playsAt; void flagsVer;
    if (!matchup) return () => 0;
    // RET spots (0171) score their occupant return-only — mirror the resolver.
    return (slug: string | null | undefined, slotPos?: string[]) =>
      (slug ? classicPoints(mkPlayer(slug), matchup.week, sc, slotPos && isRetSlot(slotPos) ? 'RET' : undefined) : 0);
  }, [matchup, sc, playsAt, flagsVer]);

  const bb = useMemo(() => new Set(bestball), [bestball]);
  // What a player is WORTH to the auto-fills (v0.252.0): the projection,
  // zeroed for a proven bye (this board's own slate) or a player ruled OUT
  // (the live injury feed; O/IR only — Q and D still play too often to
  // auto-bench). No slate or no feed means no claim, which is exactly the old
  // behavior — this can only ever bench someone on EVIDENCE.
  const fillValue = useMemo(
    () => slateAwareProj(matchup?.week ?? 1, slate, (slug) => {
      const st = injuryFor(matchup?.week ?? 1, slug);
      return st === 'O' || st === 'IR';
    }),
    [matchup, slate],
  );

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
      // exp rides along (0172) so tenure-filtered spots fill honestly.
      const ros = rosterSlugs.filter((x) => !stashed.has(x)).map((x) => ({ ...mkPlayer(x), exp: expMap[x] ?? null }));
      // THE SEAT NOBODY MANAGES (v0.248.0). sealed_pick hangs off a user, so a
      // seat with no claimed manager cannot store a lineup at all — the worker's
      // auto-slot never reaches it. The engine fields its best projected lineup
      // from the roster instead (classicLineup), and this is the same call, so
      // what this board draws is what the resolver scores. Only when the side
      // stored NOTHING: a seat with rows is managed, and everything it stored
      // stands, empty spots included.
      if (!Object.keys(manual).length && ros.length) {
        for (const r of autoSlotPlan(slotDefs, bestball, {}, ros, fillValue)) {
          out[r.slot] = r.player;
          manualPicks.push({ slot: r.slot, player: mkPlayer(r.player) });
        }
      }
      if (matchup && bb.size) {
        // BEFORE KICKOFF, rank by PROJECTION (founder). A best-ball spot fills
        // itself with whoever scores most, so before anyone has scored it used
        // to render empty and count ZERO toward the projected total —
        // understating a best-ball team by however many spots it auto-fills.
        // Same algorithm either way (bestballFillBy owns eligibility, the
        // manual-start exclusion, one-player-one-spot and the fill order); only
        // the number it sorts on changes, so the preview and the real fill can
        // never disagree about who is ALLOWED, just about who is best.
        const fills = locked
          ? bestballFill(manualPicks, bestball, ros, matchup.week, sc, slotDefs)
          : bestballFillBy(manualPicks, bestball, ros, slotDefs, fillValue);
        for (const f of fills) out[f.slot] = f.player.id;
      }
      return out;
    };
    return {
      mine: build(mine, pool.map((p) => p.slug)),
      theirs: build(theirs, oppPool.map((p) => p.slug)),
    };
  }, [mine, theirs, pool, oppPool, bb, bestball, locked, matchup, sc, slotDefs, playsAt, flagsVer, stashed, expMap, fillValue]);

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
        // 'BYE' is a CLAIM, and it needs proof: a known team and a loaded
        // slate. Without both this says nothing — a player the bake doesn't
        // know used to read "BYE" on the day he played his opener.
        opponent: g ? `${g.home ? 'vs' : '@'} ${g.opponent}` : (isBye(meta.team, slate) ? 'BYE' : null),
        injury: injuryFor(matchup?.week ?? 1, slug),
        // Where the game is played, and whether it's a night game — both facts,
        // both read off the slate the board already has. NOT weather (0237).
        roof: g && meta.team ? roofFor(venueTeam(meta.team, g)) : null,
        primetime: isPrimetime(g?.kickoff),
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
    // Benched = on the roster and NOT in the EFFECTIVE lineup. Deliberately not
    // the stored picks: a best-ball spot's occupant and an unmanaged seat's
    // auto-filled starter have no row of their own, so keying off stored picks
    // listed them under BENCH and in a starting spot at the same time.
    const benchOf = (roster: PoolPlayer[], lineup: Record<string, string | null>) => {
      const starting = new Set(Object.values(lineup).filter(Boolean) as string[]);
      return roster.filter((p) => !starting.has(p.slug));
    };
    return buildMatchupBoard({
      week: matchup.week, locked, slots: slotDefs, labelFor: nameOf,
      home: mkSide(rosterId, names.me, avatars.me, effective.mine, benchOf(pool, effective.mine)),
      // THEIR BENCH TOO (v0.249.0, founder). Classic lineups are open all week
      // (0178) and the board already fills their spots from that same roster —
      // so there was never anything here to withhold, only a column nobody had
      // wired up.
      away: mkSide(oppRoster, names.opp, avatars.opp, effective.theirs, benchOf(oppPool, effective.theirs)),
    });
  }, [matchup, rosterId, slotDefs, effective, names, avatars, records, pool, oppPool, stashed, entryFor, locked]);

  // ── ▦ FIELDS (v0.270.0) ──────────────────────────────────────────────────
  /** Every NFL game with a STARTER on either side, deduped by game — the
   *  all-fields sheet's list. gameFeeds (state) is the re-render tie. */
  const fieldGames = useMemo(() => {
    if (!matchup || !board || !gameFeeds.length) return [] as { key: string; away: string; home: string; team: string }[];
    const seen = new Set<string>();
    const out: { key: string; away: string; home: string; team: string }[] = [];
    const add = (e: BoardEntry | null) => {
      if (!e?.team) return;
      const f = gameFeedFor(matchup.week, e.team);
      if (!f || seen.has(f.key)) return;
      seen.add(f.key);
      out.push({ key: f.key, away: f.away, home: f.home, team: e.team });
    };
    for (const row of board.starters) { add(row.home); add(row.away); }
    return out;
  }, [matchup, board, gameFeeds]);
  /** A game line's tap handler — only when that game has a published feed, so
   *  the line never opens onto an empty sheet. */
  const gameOpener = (e: BoardEntry | null): (() => void) | undefined => {
    if (!e?.team || !matchup || !gameFeeds.length || !gameFeedFor(matchup.week, e.team)) return undefined;
    const team = e.team;
    return () => setFieldGame(team);
  };
  const fieldFeed = fieldGame && matchup ? gameFeedFor(matchup.week, fieldGame) : null;

  /** The next kickoff that will freeze one of MY spots — the honest
   *  replacement for a league-wide lock time that no longer exists. */
  const nextLockLabel = useMemo(() => {
    const ks = slotDefs
      .map((d) => effective.mine[d.slot])
      .filter(Boolean)
      .map((slug) => gameFor(slugMeta(slug!).team, slate)?.kickoff)
      .map((k) => (k ? Date.parse(k) : NaN))
      .filter((ms) => Number.isFinite(ms) && ms > nowTs);
    if (!ks.length) return 'nothing left to lock';
    return fmtLock(new Date(Math.min(...ks)).toISOString());
  }, [slotDefs, effective, slate, nowTs]);

  /** Has this player's game started? The one question that decides everything
   *  editable on this screen now. A player with no game (bye) never starts. */
  const kickedOff = (slug: string | null | undefined): boolean => {
    if (!slug) return false;
    const e = entryFor(slug);
    return !!e && e.state !== 'pre';
  };
  /** May I still change this spot? Sealed by the server, or holding a player
   *  whose game has begun, means no. */
  const canEdit = (slot: string): boolean =>
    !sealedSlots[slot] && !bb.has(slot) && !kickedOff(effective.mine[slot]);

  /** Write one or more spots in a single save. A MOVE touches two — the target
   *  and the spot the player left — and they must travel together, or the same
   *  player stands in two spots until the next poll. */
  const applyMove = async (writes: { slot: string; player: string | null }[]) => {
    if (!matchup || !writes.length) return;
    const before = mine;
    const next = { ...mine };
    for (const w of writes) next[w.slot] = w.player;
    setMine(next); setPickerSlot(null); setSaveNote(null);
    try {
      await savePicks(matchup.id, userId, writes.map((w) => ({
        game_window: CLASSIC_WIN, roster_slot: w.slot, player_slug: w.player, metric_id: null,
      })));
      commit();
      setSaveNote('✓ saved');
    } catch (e) {
      setMine(before);
      setSaveNote(friendlyError(e));
    }
  };
  const assign = (slot: string, slug: string | null) => applyMove([{ slot, player: slug }]);
  /** Picking someone already starting elsewhere is a MOVE; core decides whether
   *  the displaced player can swap back into the vacated spot. */
  const pickInto = (slot: string, slug: string) =>
    applyMove(planSpotMove(slotDefs, effective.mine, slot, slug, (target, cand) => {
      const d = slotDefs.find((x) => x.slot === target);
      const p = pool.find((x) => x.slug === cand);
      return !!d && !!p && slotAllows(d, { pos: p.pos, team: p.team, exp: expMap[cand] ?? null });
    }));

  // ── AUTO-SLOT ON OPEN (v0.247.0) ─────────────────────────────────────────
  // The worker sets every classic team's lineup each week (autoSlotClassic-
  // Lineups), which is what makes an OPPONENT's board worth looking at. This
  // does the same thing for the manager who is standing right here, so opening
  // the screen shows a lineup rather than nine dashes and a wait for the next
  // tick. Same function, same projections, same roster — the two can only
  // agree.
  //
  // `mine` is exactly the map autoSlotPlan wants: a key exists iff that spot
  // has a stored row. So a spot the manager EMPTIED holds null, is a key, and
  // is never re-filled — the distinction the whole feature rests on. Runs at
  // most once per mount (a second pass would have nothing to write anyway,
  // which is the real guard; the ref just avoids the round trip).
  const autoSlotted = useRef(false);
  useEffect(() => {
    if (autoSlotted.current || state !== 'ready' || locked || !matchup) return;
    // The slate gates the WRITE path too (v0.252.0): rows written bye-blind
    // would stand — a spot with a row is never revisited. The worker fills
    // within a tick if the client never gets a slate.
    if (!setupReady || !stashReady || !pool.length || !slotDefs.length || !slate.length) return;
    const roster = pool
      .filter((p) => !stashed.has(p.slug))                       // taxi/IR: the DB would refuse the row
      .map((p) => ({ id: p.slug, pos: p.pos, team: p.team, exp: expMap[p.slug] ?? null }));
    const plan = autoSlotPlan(slotDefs, bestball, mine, roster, fillValue);
    autoSlotted.current = true;
    if (!plan.length) return;
    // Deliberately NOT applyMove: this is not something the manager did, so it
    // gets no "saved" flash, and — unlike a manual pick — the board is updated
    // only AFTER the write lands. An optimistic lineup that failed to save
    // would read as set while the server still had nine empty spots, which is
    // the one thing this screen must never do. A failed write is simply left to
    // the worker, which sets the same lineup on its next tick.
    savePicks(matchup.id, userId, plan.map((r) => ({
      game_window: CLASSIC_WIN, roster_slot: r.slot, player_slug: r.player, metric_id: null,
    }))).then(() => {
      setMine((prev) => {
        const next = { ...prev };
        for (const r of plan) if (next[r.slot] === undefined) next[r.slot] = r.player;
        return next;
      });
    }).catch(() => {});
  }, [state, locked, matchup, userId, setupReady, stashReady, pool, slotDefs, bestball, mine, stashed, expMap, slate, fillValue]);


  if (state === 'loading') return <View style={{ padding: 32, alignItems: 'center' }}><ActivityIndicator color={t.you} /></View>;
  if (state === 'none') return <View style={{ padding: 24 }}><Mono size={10} tone="faint">No matchup this week.</Mono></View>;
  if (state === 'error') return <View style={{ padding: 24 }}><Mono size={10} tone="warn">{err}</Mono></View>;

  // Totals now come from the board (same arithmetic, plus projections and
  // empty-spot handling); the fallback grid below computes its own inline.

  const slotDef = pickerSlot ? slotDefs.find((d) => d.slot === pickerSlot) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <Mono size={9} tone="faint" track={0.1}>
          CLASSIC · WEEK {matchup?.week} · {ppr === 1 ? 'FULL PPR' : ppr === 0.5 ? 'HALF PPR' : 'NON-PPR'}
        </Mono>
        {/* ▦ FIELDS (founder) — the same all-fields idea the drip board has,
            fed by classic's starters. Only offered once feeds exist: a chip
            into an empty sheet would read as broken. */}
        {fieldGames.length > 0 && <Chip label="▦ FIELDS" onPress={() => { tap(); setFieldsOpen(true); }} />}
      </View>

      {/* ── SCOREBOARD (v0.229.0) ─────────────────────────────────────────
          The web board's header, in RN. Pre-lock the projection half stays
          hidden: nothing has happened, so a win % would be asserting
          something about a lineup that can still change. */}
      {board && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TeamHead side={board.home} align="left" mode={locked ? 'live' : 'proj'} />
            <View style={{ alignItems: 'center' }}>
              {/* NO OVERALL LOCK IN CLASSIC (founder). Since 0178 each spot
                  locks at its own player's kickoff, so one "LOCKS Wed 8:20 PM"
                  was untrue — that was matchup.lock_at, the drip lead, which
                  now only decides when the matchup flips live. */}
              <Mono size={8.5} tone="faint">{locked ? 'LIVE' : 'NEXT LOCK'}</Mono>
              {!locked && <Mono size={8} tone="faint" style={{ marginTop: 2 }}>{nextLockLabel}</Mono>}
            </View>
            <TeamHead side={board.away} align="right" mode={locked ? 'live' : 'proj'} />
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

      {/* ── STARTERS, head to head ─────────────────────────────────────────
          Renders BEFORE the lock too (v0.237.0): a manager wants the week —
          kickoffs, projections, byes — while they can still act on it. YOUR
          rows stay tappable into the picker (this is the only lineup screen
          the app has), and THEIR column is absent rather than blank, because
          sealed_pick's RLS hands out an opponent's picks only once locked. */}
      {board && (
        <>
          <Card style={{ paddingVertical: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 6 }}>
              <Mono size={8.5} tone="faint" weight="700" track={0.1}>STARTERS</Mono>
              {/* 0178: both lineups are open all week, each spot locking at its
                  own player's kickoff. The rule of the screen, said once. */}
              {!locked && <Mono size={8} tone="faint" numberOfLines={1} style={{ flexShrink: 1 }}>open · each spot locks at its own kickoff</Mono>}
            </View>
            {board.starters.map((row) => {
              const auto = bb.has(row.slot);
              const settable = canEdit(row.slot);
              const d = slotDefs.find((x) => x.slot === row.slot);
              const accepts = d ? slotAcceptsLabel(d) || d.pos.join('/') : '';
              return (
                <View key={row.slot}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.bd }}>
                  {row.home ? (
                    <>
                      <BoardCell e={row.home} align="left" onGame={gameOpener(row.home)}
                        onName={() => openPlayerCard({ slug: row.home!.slug, name: row.home!.name, pos: row.home!.pos, team: row.home!.team ?? '', week: matchup?.week, userId })} />
                      {/* ⇄ THE SWAP, as its own small chip (founder). The row
                          used to be one button that opened the picker, which
                          left no way to simply READ about the player standing
                          in it. */}
                      {settable && (
                        <Pressable hitSlop={8} onPress={() => { tap(); setPickerSlot(pickerSlot === row.slot ? null : row.slot); }}
                          style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3 }}>
                          <Mono size={9} tone="you" weight="700">⇄</Mono>
                        </Pressable>
                      )}
                    </>
                  ) : (
                    <Pressable onPress={() => { if (settable) { tap(); setPickerSlot(pickerSlot === row.slot ? null : row.slot); } }} style={{ flex: 1 }}>
                      <Mono size={10} tone={settable ? 'you' : 'faint'}>{auto ? '🎯 BEST BALL' : settable ? `+ SET ${row.label}` : 'Empty'}</Mono>
                      {settable && !!accepts && <Mono size={8} tone="faint" numberOfLines={1}>{`takes ${accepts}`}</Mono>}
                    </Pressable>
                  )}
                  <Mono size={11} weight="700" tone={row.home && row.home.state === 'pre' ? 'faint' : 'text'} style={{ width: 38, textAlign: 'right' }}>
                    {scoreOf(row.home)}
                  </Mono>
                  <View style={{ alignItems: 'center' }}>
                    <SlotPill pos={row.pos} label={row.label} />
                    {auto && <Mono size={7} tone="you">🎯 AUTO</Mono>}
                  </View>
                  <Mono size={11} weight="700" tone={row.away && row.away.state === 'pre' ? 'faint' : 'dim'} style={{ width: 38 }}>
                    {scoreOf(row.away)}
                  </Mono>
                  <BoardCell e={row.away} align="right" onGame={gameOpener(row.away)}
                    onName={row.away ? () => openPlayerCard({ slug: row.away!.slug, name: row.away!.name, pos: row.away!.pos, team: row.away!.team ?? '', week: matchup?.week, userId }) : undefined} />
                </View>
              );
            })}
          </Card>
          {/* BENCH and the stashes, BOTH SIDES (v0.249.0, founder). Classic
              lineups are open all week (0178), so there was never anything to
              withhold here — the board already fills their starting spots from
              this very roster. Rows pair by INDEX and nothing more, because two
              benches are just two lists: whichever side runs out first leaves
              its half of the row empty rather than stretching to match.
              Column widths mirror the STARTERS rows above so the two cards read
              as one board rather than two tables. */}
          {(['bench', 'ir'] as const).map((k) => {
            const rows = Math.max(board[k].home.length, board[k].away.length);
            if (!rows) return null;
            return (
              <Card key={k} style={{ paddingVertical: 2 }}>
                <Mono size={8.5} tone="faint" weight="700" track={0.1} style={{ paddingVertical: 6 }}>
                  {k === 'bench' ? 'BENCH' : 'TAXI / IR'}
                </Mono>
                {Array.from({ length: rows }, (_, i) => {
                  const h = board[k].home[i] ?? null;
                  const a = board[k].away[i] ?? null;
                  return (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.bd }}>
                      {h ? <BoardCell e={h} align="left" onGame={gameOpener(h)}
                             onName={() => openPlayerCard({ slug: h.slug, name: h.name, pos: h.pos, team: h.team ?? '', week: matchup?.week, userId })} /> : <View style={{ flex: 1 }} />}
                      <Mono size={11} weight="700" tone={h && h.state === 'pre' ? 'faint' : 'dim'} style={{ width: 38, textAlign: 'right' }}>
                        {h ? scoreOf(h) : ''}
                      </Mono>
                      <Mono size={8} tone="faint" weight="700">{k === 'bench' ? 'BN' : 'IR'}</Mono>
                      <Mono size={11} weight="700" tone={a && a.state === 'pre' ? 'faint' : 'dim'} style={{ width: 38 }}>
                        {a ? scoreOf(a) : ''}
                      </Mono>
                      {a ? <BoardCell e={a} align="right" onGame={gameOpener(a)}
                             onName={() => openPlayerCard({ slug: a.slug, name: a.name, pos: a.pos, team: a.team ?? '', week: matchup?.week, userId })} /> : <View style={{ flex: 1 }} />}
                    </View>
                  );
                })}
              </Card>
            );
          })}
        </>
      )}

      {/* The plain setter grid, now the FALLBACK ONLY: the board covers both
          sides of the lock since v0.237.0, but if it can't assemble this is
          still a working lineup editor rather than a blank screen. */}
      {!board && (
      <Card style={{ paddingVertical: 2 }}>
        {slotDefs.map((d, i) => {
          const auto = bb.has(d.slot);
          const my = effective.mine[d.slot];
          const their = effective.theirs[d.slot];
          const accepts = slotAcceptsLabel(d);
          return (
          <View key={d.slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.bd }}>
            {/* The spot as the commissioner built it: what it's CALLED, and —
                when the name doesn't already say it — what it ACCEPTS. A custom
                label ("Only NFC Players") hides eligibility entirely, which is
                exactly when a manager needs the positions spelled out. */}
            <View style={{ width: 76 }}>
              <Mono size={9} tone={auto ? 'you' : 'dim'} weight="700" numberOfLines={1}>{nameOf(d)}{auto ? ' 🎯' : ''}</Mono>
              {!!accepts && <Mono size={8} tone="faint" numberOfLines={1}>{accepts}</Mono>}
            </View>
            <Pressable
              onPress={() => { if (canEdit(d.slot)) { tap(); setPickerSlot(pickerSlot === d.slot ? null : d.slot); } }}
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
                <Mono size={10} tone={canEdit(d.slot) ? 'you' : 'faint'}>{canEdit(d.slot) ? '+ SET' : '—'}</Mono>
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

      {/* ── THE PICKER, as a sheet over the board ──────────────────────────
          It used to render inline BELOW the whole board, so tapping a spot near
          the top scrolled the answer off screen — you pressed a thing and
          nothing appeared to happen. A spot is a question ("who goes here?"),
          so the answer comes up over it, in the app's own bottom-sheet idiom
          (ui/Overlay: enters from the thumb's edge, drag to dismiss).

          It lists ONLY what may legally go in this spot: the spot's own
          position + filter rules (slotAllows), minus anyone already starting,
          minus anyone whose game has kicked off — the database refuses all
          three, and a picker that offers a refusal is a trap. */}
      <Overlay
        visible={!!(pickerSlot && slotDef && canEdit(pickerSlot))}
        title={slotDef ? nameOf(slotDef) : 'Set spot'}
        subtitle={slotDef
          ? `TAKES ${slotDef.pos.join(' / ')}${slotFilterLabel(slotDef.flt) ? ` · ${slotFilterLabel(slotDef.flt)}` : ''}`
          : undefined}
        onClose={() => setPickerSlot(null)}>
        {pickerSlot && slotDef && (() => {
          // EVERY eligible player on the roster, not just the bench (founder):
          // "put my TE in the flex" was a two-step dance when it is one move.
          const spotOf = new Map<string, string>();
          for (const x of slotDefs) { const sl = effective.mine[x.slot]; if (sl) spotOf.set(sl, x.slot); }
          const eligible = pool
            .filter((p) => !stashed.has(p.slug))
            .filter((p) => slotAllows(slotDef, { pos: p.pos, team: p.team, exp: expMap[p.slug] ?? null }))
            .filter((p) => !kickedOff(p.slug))
            .filter((p) => spotOf.get(p.slug) !== pickerSlot)
            // Starting in a spot that has locked means he cannot leave it: the
            // DB refuses the vacating write, so don't offer the move.
            .filter((p) => { const from = spotOf.get(p.slug); return !from || canEdit(from); });
          return (
            // The body must be able to SHRINK or the sheet clips its own bottom
            // — the one contract ui/Overlay asks of every caller, and the bug
            // the founder hit: `flexShrink: 1` on a ScrollView, not a View.
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
              {!!mine[pickerSlot] && (
                <Pressable onPress={() => { tap(); void assign(pickerSlot, null); setPickerSlot(null); }}
                  style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                  <Mono size={10} tone="dim">✕ LEAVE THIS SPOT EMPTY</Mono>
                </Pressable>
              )}
              {eligible.length === 0 && (
                <Mono size={10} tone="faint" style={{ lineHeight: 16, paddingVertical: 8 }}>
                  Nobody on your roster can fill this spot right now — everyone eligible has already kicked off.
                </Mono>
              )}
              {eligible.map((p) => (
                <Pressable key={p.slug} onPress={() => { tap(); void pickInto(pickerSlot, p.slug); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                  <Face slug={p.slug} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Display size={12.5}>{shortName(p.full)}</Display>
                    {!!spotOf.get(p.slug) && (
                      <Mono size={8} tone="you">{`in ${slotName.get(spotOf.get(p.slug)!) ?? spotOf.get(p.slug)}`}</Mono>
                    )}
                  </View>
                  <PosPill pos={p.pos} />
                  <Mono size={8.5} tone="faint" style={{ width: 28, textAlign: 'right' }}>{p.team}</Mono>
                  <Mono size={10} tone="dim" weight="700" style={{ width: 32, textAlign: 'right' }}>
                    {(PROJ_2026.get(p.slug) ?? 0).toFixed(1)}
                  </Mono>
                </Pressable>
              ))}
            </ScrollView>
          );
        })()}
      </Overlay>

      {/* ── ▦ ALL FIELDS, in a sheet (v0.270.0) ────────────────────────────
          Every NFL game with a starter on either side, one live drive chart
          each — the drip board's all-fields sheet, fed by classic's lineup.
          Tapping a field goes deeper: it closes this sheet and opens that
          game's field + full play log (stacked Modals are flaky on Android,
          so the sheets take turns instead). */}
      <Overlay
        visible={fieldsOpen}
        title="All fields"
        subtitle="EVERY GAME WITH A STARTER · LIVE DRIVES"
        onClose={() => setFieldsOpen(false)}>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 30 }}>
          {fieldGames.length === 0 && (
            <Mono size={10.5} tone="dim" style={{ textAlign: 'center', paddingVertical: 16 }}>No live games with starters yet.</Mono>
          )}
          {fieldGames.map((g) => (
            <Pressable key={g.key} onPress={() => { tap(); setFieldsOpen(false); setFieldGame(g.team); }} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Mono size={9.5} weight="700" track={0.08}>{g.away} @ {g.home}</Mono>
                <Mono size={8} tone="faint">play log ▸</Mono>
              </View>
              <FieldView week={matchup?.week ?? 0} team={g.team} clock={Number.MAX_SAFE_INTEGER} />
            </Pressable>
          ))}
        </ScrollView>
      </Overlay>

      {/* ── One game's field + PLAY LOG (v0.270.0, founder) ────────────────
          Opened from a tapped game line (or a field above): the live drive
          chart on top, then every play of the game newest first — quarter
          clock, description, and the score after each scoring play. */}
      <Overlay
        visible={!!fieldGame}
        title={fieldFeed ? `${fieldFeed.away} @ ${fieldFeed.home}` : 'Game field'}
        subtitle="LIVE FIELD · FULL PLAY LOG"
        onClose={() => setFieldGame(null)}>
        {!!fieldGame && !!matchup && (
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
            <FieldView week={matchup.week} team={fieldGame} clock={Number.MAX_SAFE_INTEGER} />
            {!fieldFeed?.plays.length && (
              <Mono size={10} tone="faint" style={{ marginTop: 12, textAlign: 'center' }}>No plays yet — the log fills in live.</Mono>
            )}
            {!!fieldFeed && [...fieldFeed.plays].reverse().map((p, i) => (
              <View key={p.pid ?? `${p.c}-${i}`} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <View style={{ width: 58 }}>
                  <Mono size={8.5} tone="faint">{fmtQClock(p.c)}</Mono>
                  <Mono size={8} tone="faint" style={{ marginTop: 1 }}>{p.tm}</Mono>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 11, lineHeight: 15, color: p.sc ? t.warn : p.to ? t.opp : t.text }}>{p.txt}</Text>
                  {!!p.sc && (
                    <Mono size={8.5} tone="warn" style={{ marginTop: 1 }}>{`${fieldFeed.away} ${p.as} — ${p.hs} ${fieldFeed.home}`}</Mono>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </Overlay>

      {/* Bench, as chips — the FALLBACK's bench. The board draws its own with
          game lines, so this would otherwise be the same players twice. */}
      {!board && (
      <Card>
        <Mono size={9} tone="faint" weight="700" style={{ marginBottom: 8 }}>BENCH</Mono>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {bench.map((p) => (
            <Chip key={p.slug} label={`${shortName(p.full)} · ${p.pos}${locked ? ` · ${r1(pts(p.slug))}` : ''}`} dim onPress={() => {}} />
          ))}
          {!bench.length && <Mono size={10} tone="faint">everyone's starting</Mono>}
        </View>
      </Card>
      )}

      <Mono size={8.5} tone="faint" style={{ lineHeight: 14 }}>
        CLASSIC MODE — standard scoring across every stat ({ppr === 1 ? '1 pt' : ppr === 0.5 ? '½ pt' : 'no points'} per catch), live play by play.
        LINEUPS ARE OPEN: everyone in the league can see them, and each spot locks when THAT player's game kicks off —
        so a Thursday game never freezes your Sunday picks. No windows, no power-ups, no bonuses.
        {bb.size > 0 ? (bb.size >= slotDefs.length
          ? ' FULL BEST BALL: every slot takes your highest scorer automatically — nothing to set.'
          : " 🎯 slots are BEST BALL: they automatically take your highest-scoring player who isn't already started.") : ''}
      </Mono>
    </ScrollView>
  );
}
