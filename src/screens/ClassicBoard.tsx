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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pos } from '@drip/core/types';
import { leagueSlotDefs, leagueBestball, slotAllows, isRetSlot, slotDisplayNames, slotAcceptsLabel, slotFilterLabel, planSpotMove, autoSlotPlan, slateAwareProj, CLASSIC_WIN, classicPoints, bestballFill, bestballFillBy, type ClassicPick, type ClassicScoring, type SlotSpec } from '@drip/core/engine/classic';
import { setLeagueFlags } from '@drip/core/data/commish';
import { setLeagueScoring, parseScoring } from '@drip/core/engine/leagueScoring';
import { setLeagueGolf } from '@drip/core/engine/golf';
import { buildMatchupBoard, gameFor, entryState, venueTeam, isPrimetime, isBye, type BoardEntry } from '@drip/core/engine/matchupBoard';
import { roofFor, ROOF_LABEL } from '@drip/core/data/stadiums';
import { PROJ_2026 } from '@drip/core/data/proj2026';
import { injuryFor } from '@drip/core/data/injuries';
import { slugMeta, setSlugMetaOverrides } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { setLivePlays, liveRowsToPbp } from '@drip/core/data/realPbp';
import { setLiveGameFeed, feedRowsToWeek, gameFeedFor } from '@drip/core/data/gameFeed';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, getRevealedPicks, matchupTeams,
  liveSlate, leagueStandings,
  leagueGameMode, weekLivePlays, weekGameFeeds, friendlyError, playerFlags, leaguePoolExp, leagueScoringGet,
  type LiveMatchup, type PoolPlayer, type TeamInfo, type GameFeedRow,
  nativeRosters, loadLiveInjuries, playoffState,
} from '@drip/core/data/liveApi';
import { PlayerImg, PosPill } from '../app/ui';
import { openPlayerCard } from '../app/playerCard';
import { FieldBoard, type FieldBoardEntry } from '../app/FieldView';
import { FieldGame } from './FieldGame';

/** The sub-card under a name: WHERE and WHEN the game is, and the number.
 *
 *  Sleeper's board puts three things on this line — kickoff, venue conditions
 *  and the score. We show two of them. The third is WEATHER, which we have no
 *  feed for, so the markers here are only the two facts we actually hold: a
 *  roof (data/stadiums.ts) and a night kickoff (isPrimetime). A made-up sun
 *  icon would be worse than none.
 *
 *  The NUMBER changes meaning with the clock and says which it is, because a
 *  bare figure beside "Yet to play" is ambiguous exactly when the manager is
 *  deciding something: before kickoff it reads `proj 15.3` in the quiet colour;
 *  once the ball is live it's points, in full. */
function GameCard({ e, align, onOpen }: { e: BoardEntry | null; align: 'left' | 'right'; onOpen?: () => void }) {
  const right = align === 'right';
  const box: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8,
    padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
    flexDirection: right ? 'row-reverse' : 'row',
    // A game line with a feed is a DOOR (v0.270.0): it opens that game's live
    // field + play log as a card over the board.
    ...(onOpen ? { cursor: 'pointer' } : {}),
  };
  if (!e) return <div style={{ ...box, opacity: 0.5 }}><span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>—</span></div>;
  const bye = e.opponent === 'BYE';
  const pre = e.state === 'pre';
  const roof = e.roof && e.roof !== 'open' ? e.roof : null;
  return (
    <div style={box} onClick={onOpen} title={onOpen ? "open this game's live field + play log" : undefined}>
      <div style={{ flex: 1, minWidth: 0, textAlign: right ? 'right' : 'left' }}>
        <div className="mono" style={{ fontSize: 10, color: bye ? 'var(--warn, #c66)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bye ? 'BYE' : (`${e.kickoff ?? ''} ${e.opponent ?? ''}`.trim() || 'no game listed')}
          {roof && <span title={ROOF_LABEL[roof]} style={{ marginLeft: 5 }}>🏟</span>}
          {e.primetime && <span title="Primetime kickoff" style={{ marginLeft: 4 }}>☾</span>}
        </div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 2 }}>
          {bye ? 'No game this week' : e.state === 'done' ? 'Final' : e.state === 'live' ? 'In progress' : 'Yet to play'}
          {onOpen && <span style={{ color: 'var(--you)', marginLeft: 5 }}>▦ field</span>}
        </div>
      </div>
      {/* NO "proj" LABEL (founder, v0.241.0): the number alone. Before kickoff
          it is the projection and after it is points — carried by the quiet
          colour and by the status line beneath, not by a word taking up room. */}
      <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: pre ? 'var(--faint)' : 'var(--text)', whiteSpace: 'nowrap' }}>
        {pre ? e.proj.toFixed(1) : e.live.toFixed(2)}
      </span>
    </div>
  );
}

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mkPlayer = (slug: string) => {
  const m = slugMeta(slug);
  return { id: slug, name: slug, full: slug, pos: m.pos, team: m.team, stats: { ...ZERO } };
};

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 };

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


/** One team's identity in the scoreboard: crest, name, record + seed, live
 *  score with the projected final beneath it. */
function TeamHead({ side, align, accent, mode }: {
  side: import('@drip/core/engine/matchupBoard').BoardSide;
  align: 'left' | 'right'; accent: string;
  /** 'live' — the game is on, show points. 'proj' — nothing has kicked off, so
   *  the projected total IS the headline number. 'hidden' — the opponent's
   *  lineup is sealed until kickoff (RLS, not shyness), so there is no number
   *  to show and pretending otherwise would read as "they have nobody". */
  mode: 'live' | 'proj' | 'hidden';
}) {
  const rec = side.record;
  const big = mode === 'hidden' ? '—' : mode === 'proj' ? side.projected.toFixed(1) : side.live.toFixed(2);
  const sub = mode === 'hidden' ? 'sealed until kickoff' : mode === 'proj' ? 'projected' : side.projected.toFixed(1);
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
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: mode === 'hidden' ? 'var(--faint)' : 'var(--text)' }}>{big}</div>
      <div className="mono" style={{ fontSize: 9.5, color: mode === 'hidden' ? 'var(--faint)' : accent }}>{sub}</div>
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
function BoardCell({ e, align, onName }: {
  e: import('@drip/core/engine/matchupBoard').BoardEntry | null; align: 'left' | 'right';
  /** The NAME opens the player card (v0.283.0, founder) — reading about a
   *  player and changing his spot are different intentions, so the row stops
   *  being one big button. */
  onName?: () => void;
}) {
  const right = align === 'right';
  if (!e) return <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', textAlign: align }}>Empty</div>;
  const dim = e.state === 'done';
  return (
    <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {/* The face goes on the OUTER edge so both sides read outward from the
          centre pill, the same way the names and scores do. PlayerImg already
          degrades headshot → team logo → position pill, so a missing portrait
          costs the picture and never the row. */}
      <PlayerImg playerId={e.slug} team={e.team} pos={e.pos as Pos} size={32} />
      <div style={{ textAlign: align, minWidth: 0, flex: 1 }}>
      <div onClick={onName ? (ev) => { ev.stopPropagation(); onName(); } : undefined}
        title={onName ? 'open the player card' : undefined}
        style={{ fontSize: 14, fontWeight: 700, color: dim ? 'var(--dim)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: onName ? 'pointer' : undefined }}>{e.name}</div>
      <div className="mono" style={{ fontSize: 9.5, marginTop: 2, color: 'var(--faint)' }}>
        <span style={{ color: `var(--pos-${e.pos}-fg, var(--dim))`, fontWeight: 700 }}>{e.pos}</span>
        {e.team ? ` · ${e.team}` : ''}
        {e.injury ? <span style={{ color: 'var(--warn, #c66)', fontWeight: 700 }}> {e.injury}</span> : null}
      </div>
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
  // Golf as REACT state as well as an engine install: the board has to SAY so
  // on screen, because a total that means the opposite of what it looks like
  // is the one thing this screen must never let happen.
  const [golf, setGolf] = useState(false);
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
  // ▦ FIELDS (v0.270.0): the all-fields overlay, plus the game feeds as STATE —
  // setLiveGameFeed writes a module cache React cannot see, and the row count
  // here is what ties the fields to a re-render when the feeds land.
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // One game's field + play log, as a CARD over the board (v0.271.0 — the
  // founder walked back v0.270.0's new tab: "just a card"). Team abbr locates
  // the game.
  const [fieldGame, setFieldGame] = useState<string | null>(null);
  const [gameFeeds, setGameFeeds] = useState<GameFeedRow[]>([]);
  // ── WALKING THE SEASON (v0.299.1, founder: "it would be good if you could go
  //    to the next week all the way through the last week of the regular season
  //    and back. A swipe action would be cool.") ──────────────────────────────
  // null means "whatever week the league is on" — the board's own default, and
  // what it opens on. A number is a week the manager asked for.
  const [weekWanted, setWeekWanted] = useState<number | null>(null);
  // The last regular-season week: the playoff start minus one. Read from the
  // league rather than assumed, because 14 is a default and not a rule.
  const [lastRegWeek, setLastRegWeek] = useState<number | null>(null);
  // The live injury report is a MODULE cache React cannot see; this is the
  // re-render signal, same shape as flagsVer above.
  const [injuryVer, setInjuryVer] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        setState('loading'); setErr(null);
        const r = leagueId && rosterId != null ? { leagueId, rosterId } : await myRoster(userId);
        if (!r) { setState('none'); return; }
        setRos(r);
        const m = await myMatchup(r.leagueId, r.rosterId, weekWanted ?? undefined);
        if (!m) { setState('none'); return; }
        setMatchup(m);
        nativeRosters(r.leagueId).then((rows) => {
          setStashed(new Set(rows.filter((x) => x.spot && x.spot !== 'active').map((x) => x.slug)));
          setStashReady(true);
        }).catch(() => {});
        leagueGameMode(r.leagueId).then(async (gm) => {
          if (gm.ok && gm.ppr != null) setPpr(Number(gm.ppr));
          // GOLF (v0.303.0) rides the same load: it is a league setting the
          // engine reads at scoring time, installed exactly like the scoring
          // adjustments below and cleared on exit with them.
          if (gm.ok) { setBestball(leagueBestball(gm)); setScoring(gm.scoring ?? {}); setRoster(gm.roster ?? {}); setSlotsSpec(gm.slots ?? null); setLeagueGolf(gm.golf === true); setGolf(gm.golf === true); }
          // A spot with a tenure window (0172) needs years_exp from league_pool.
          // Awaited rather than fired-and-forgotten so the auto-slot below can't
          // run against an empty tenure map and leave every filtered spot blank.
          if (gm.ok && (gm.slots ?? []).some((s) => s.min_exp != null || s.max_exp != null)) {
            try { setExpMap(await leaguePoolExp(r.leagueId)); } catch { return; }
          }
          if (gm.ok) setSetupReady(true);
        }).catch(() => {});
        // Flag rules (0144) bite classic scoring (bonus_mult / bonus_pts) and
        // the best-ball fill (no_start) — same cache the drip screens keep.
        playerFlags(r.leagueId).then((f) => {
          if (Array.isArray(f)) { setLeagueFlags(r.leagueId, f); setFlagsVer((v) => v + 1); }
        }).catch(() => {});
        // SCOPED rules (0145) reach classic as of v0.277.0 — classicPoints
        // reads them, so the board has to install the league's before it
        // scores anything, or it would draw numbers the worker doesn't.
        // flagsVer is the same recompute signal; scoring and flags are both
        // module caches React cannot see.
        leagueScoringGet(r.leagueId).then((sc) => {
          if (sc?.ok) { setLeagueScoring(parseScoring(sc)); setFlagsVer((v) => v + 1); }
        }).catch(() => {});
        const oppRoster = m.home_roster_id === r.rosterId ? m.away_roster_id : m.home_roster_id;
        matchupTeams(r.leagueId, [r.rosterId, oppRoster]).then((t: Record<number, TeamInfo>) => {
          setNames({ me: t[r.rosterId]?.team_name || 'YOU', opp: t[oppRoster]?.team_name || 'OPPONENT' });
          setAvatars({ me: t[r.rosterId]?.avatar ?? null, opp: t[oppRoster]?.avatar ?? null });
        }).catch(() => {});
        // THE LIVE INJURY REPORT (v0.299.1, founder: "we also need any injury
        // designations on players in the matchup view"). Nothing on this screen
        // had ever loaded it: `injuryFor` was answering out of the BAKED 2025
        // report, so one player wore last year's Q and everybody else wore
        // nothing. It is a module cache, so the version bump is what redraws.
        loadLiveInjuries(m.week).then((n) => { if (n) setInjuryVer((v) => v + 1); }).catch(() => {});
        // The last regular-season week — the playoff start minus one — so the
        // week stepper knows where the season ends.
        playoffState(r.leagueId).then((ps) => {
          if (ps?.playoff_start_week) setLastRegWeek(Math.max(1, ps.playoff_start_week - 1));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, leagueId, rosterId, weekWanted]);

  // THE WEEK IS UNDERWAY — the only thing this flag still decides is
  // PRESENTATION (live scores rather than projections, the win bar, the
  // best-ball fill). It is no longer permission to edit: since 0178 a classic
  // lineup locks one player at a time, at his own kickoff, so editability is a
  // per-row question answered by `canEdit` below.
  //
  // Read off the SLATE's first kickoff rather than matchup.lock_at, because
  // lock_at is deliberately an hour early (the drip lead) and "nothing locks
  // before kick off" now includes not calling the week live before it is.
  const firstKick = useMemo(() => {
    const ks = slate.map((g) => (g.kickoff ? Date.parse(g.kickoff) : NaN)).filter(Number.isFinite);
    return ks.length ? Math.min(...ks) : null;
  }, [slate]);
  const locked = Object.values(sealedSlots).some(Boolean)
    || (matchup?.status != null && matchup.status !== 'scheduled')
    || (firstKick != null && firstKick <= nowTs);
  useEffect(() => {
    const t = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  // Escape closes the picker and the game-field card — a dialog you can only
  // dismiss with a mouse is a dialog a keyboard user is stuck in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPickerSlot(null); setFieldGame(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The opponent's lineup + roster (best ball fills from it) + the week's live
  // plays, on a minute cadence. Since 0178 a classic league's lineups are OPEN
  // — sealed_pick's policy hands them over whether or not they're locked — so
  // this runs from the moment the screen opens rather than waiting for lock.
  useEffect(() => {
    if (!matchup || !ros) return;
    let stop = false;
    const oppRoster = matchup.home_roster_id === ros.rosterId ? matchup.away_roster_id : matchup.home_roster_id;
    // The opponent's ROSTER, always — not just in best-ball leagues. Since
    // v0.248.0 an unmanaged seat (no app_user_id, so sealed_pick has nowhere to
    // store a lineup) fields its best projected lineup from its roster, and
    // without this the board would show that seat empty while the resolver
    // scored it. In the founder's own leagues that is seven seats in eight.
    myPool(ros.leagueId, matchup.week, oppRoster).then((p) => { if (!stop) { setOppPool(p); setSlugMetaOverrides(p.map((x) => ({ slug: x.slug, pos: x.pos, team: x.team }))); } }).catch(() => {});
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
        // exclusivity rule as the drip board: a live week never falls through
        // to baked 2025 drives (a plausible, wrong field). Empty rows install
        // an empty overlay, deliberately.
        setLiveGameFeed(matchup.week, feedRowsToWeek(gf));
        setGameFeeds(gf);
        setPlaysAt(Date.now());
      } catch { /* transient — next tick retries */ }
    };
    void load();
    const t = window.setInterval(() => { void load(); }, 60_000);
    return () => { stop = true; window.clearInterval(t); };
  }, [matchup, userId, ros]);

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
    // The SPOT rides along (v0.300.0): a scoped bonus can name one, so the
    // same player is worth different numbers in different spots and the board
    // has to score him where he is standing.
    return (slug: string | null | undefined, slotPos?: string[], slot?: string) =>
      (slug ? classicPoints(mkPlayer(slug), matchup.week, sc, slotPos && isRetSlot(slotPos) ? 'RET' : undefined, slot) : 0);
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
        // 'BYE' is a CLAIM, and it needs proof: a known team and a loaded
        // slate. Without both this says nothing — a player the bake doesn't
        // know used to read "BYE" on the day he played his opener.
        opponent: g ? `${g.home ? 'vs' : '@'} ${g.opponent}` : (isBye(m.team, slate) ? 'BYE' : null),
        injury: injuryFor(matchup?.week ?? 1, slug),
        // Where the game is played, and whether it's a night game — both facts,
        // both read off the slate the board already has. NOT weather (0237).
        roof: g && m.team ? roofFor(venueTeam(m.team, g)) : null,
        primetime: isPrimetime(g?.kickoff),
      };
    };
    // injuryVer: the live report is a module cache, so its arrival is a version bump.
  }, [slate, pts, nowTs, finalTeams, matchup, playsAt, flagsVer, injuryVer]);

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
      home: mkSide(ros.rosterId, names.me, avatars.me, effective.mine, benchOf(pool, effective.mine)),
      // THEIR BENCH TOO (v0.249.0, founder). Classic lineups are open all week
      // (0178) and the board already fills their spots from that same roster —
      // so there was never anything here to withhold, only a column nobody had
      // wired up.
      away: mkSide(oppRoster, names.opp, avatars.opp, effective.theirs, benchOf(oppPool, effective.theirs)),
    });
  }, [matchup, ros, slotDefs, effective, names, avatars, records, pool, oppPool, stashed, entryFor, locked]);

  // ── ▦ FIELDS (v0.270.0) ──────────────────────────────────────────────────
  /** One entry per starter with a published feed, both sides — the all-fields
   *  overlay's input. clock = MAX: a live board always shows the latest play
   *  there is. No pids: classic has no per-play outcome log to tint from, so
   *  the plays render neutral (the fields themselves are the point here). */
  const fieldEntries = useMemo<FieldBoardEntry[]>(() => {
    if (!matchup || !board || !gameFeeds.length) return [];
    const list: FieldBoardEntry[] = [];
    for (const row of board.starters) {
      if (row.home?.team) list.push({ playerId: row.home.slug, team: row.home.team, side: 'you', clock: Number.MAX_SAFE_INTEGER });
      if (row.away?.team) list.push({ playerId: row.away.slug, team: row.away.team, side: 'their', clock: Number.MAX_SAFE_INTEGER });
    }
    return list;
  }, [matchup, board, gameFeeds]);
  /** A game line's opener — that game's live field + play log as a card over
   *  the board (the same dismissal grammar as the picker: backdrop, ✕,
   *  Escape). Offered only when the game has a published feed, so the door
   *  never opens onto nothing. */
  const stepBtn: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4,
    color: 'var(--dim)', fontSize: 12, lineHeight: 1, padding: '3px 7px', cursor: 'pointer',
  };
  const fieldOpener = (e: BoardEntry | null): (() => void) | undefined => {
    if (!e?.team || !matchup || !gameFeeds.length || !gameFeedFor(matchup.week, e.team)) return undefined;
    const team = e.team;
    return () => setFieldGame(team);
  };

  /** ── THE WEEK STEPPER ─────────────────────────────────────────────────
   *  Weeks 1 … the last regular-season one. The bound comes from the league's
   *  playoff start; until that read lands the forward arrow simply doesn't
   *  offer a week the board can't fill, because `myMatchup` for a week with no
   *  game returns nothing and the screen would empty. */
  const canGo = (d: -1 | 1): boolean => {
    const w = matchup?.week;
    if (w == null) return false;
    const next = w + d;
    if (next < 1) return false;
    if (lastRegWeek != null && next > lastRegWeek) return false;
    return true;
  };
  const goWeek = (d: -1 | 1) => { if (canGo(d) && matchup) setWeekWanted(matchup.week + d); };

  /** SWIPE (founder: "a swipe action would be cool"). Left goes forward, the
   *  way pages move under a thumb. Guarded on the vertical component so a
   *  scroll down a long board is never read as a week change, and on a
   *  distance that a tap can't reach by accident. */
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t0 = e.touches[0];
    touch.current = t0 ? { x: t0.clientX, y: t0.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current; touch.current = null;
    const t0 = e.changedTouches[0];
    if (!start || !t0) return;
    const dx = t0.clientX - start.x, dy = t0.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 45) return;
    goWeek(dx < 0 ? 1 : -1);
  };

  /** Has this player's game started? The one question that decides everything
   *  editable on this screen now. A player with no game (bye) never starts. */
  const kickedOff = (slug: string | null | undefined): boolean => {
    if (!slug) return false;
    const e = entryFor(slug);
    return !!e && e.state !== 'pre';
  };
  /** May I still change this spot? Sealed by the server, or holding a player
   *  whose game has begun, means no — everything else is fair game, including
   *  mid-week once other players have played. */
  const canEdit = (slot: string): boolean =>
    !sealedSlots[slot] && !bb.has(slot) && !kickedOff(effective.mine[slot]);

  /** Write one or more spots in a single save. A MOVE touches two (the target
   *  and the spot the player left), and they have to travel together — writing
   *  only the target would leave the same player standing in two spots until
   *  the next poll. */
  const applyMove = async (writes: { slot: string; player: string | null }[]) => {
    if (!matchup || !writes.length) return;
    const before = mine;
    const next = { ...mine };
    for (const w of writes) next[w.slot] = w.player;
    setMine(next); setPickerSlot(null); setSaving(true); setSaveNote(null);
    try {
      await savePicks(matchup.id, userId, writes.map((w) => ({
        game_window: CLASSIC_WIN, roster_slot: w.slot, player_slug: w.player, metric_id: null,
      })));
      setSaveNote('saved');
    } catch (e) {
      setMine(before); // revert — the server refused (kicked off, cap, …)
      setSaveNote(friendlyError(e));
    } finally { setSaving(false); }
  };
  const assign = (slot: string, slug: string | null) => applyMove([{ slot, player: slug }]);
  /** Picking someone already starting elsewhere is a MOVE, and core decides
   *  whether the displaced player can swap back into the vacated spot. */
  const pickInto = (slot: string, slug: string) =>
    applyMove(planSpotMove(slotDefs, effective.mine, slot, slug,
      (target, cand) => {
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
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{ maxWidth: 720, margin: '0 auto', padding: '12px 12px 40px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button onClick={onBack} className="mono" style={{ background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, color: 'var(--dim)', cursor: 'pointer' }}>← LEAGUE</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* THE WEEK IS NAVIGATION NOW (v0.299.1), not a status line. The
              founder: "we don't need the classic, week 1, full ppr line" — the
              game mode and the PPR setting are league settings you set once and
              read on the league page, not facts about the game in front of you.
              What was worth keeping is the WEEK, and it earns its place by
              being the control that moves you through the season. */}
          {matchup && (
            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--faint)' }}>
              <button onClick={() => goWeek(-1)} disabled={!canGo(-1)} aria-label="previous week"
                style={{ ...stepBtn, opacity: canGo(-1) ? 1 : 0.3 }}>‹</button>
              <span style={{ fontWeight: 700, color: 'var(--dim)', minWidth: 52, textAlign: 'center' }}>WEEK {matchup.week}</span>
              <button onClick={() => goWeek(1)} disabled={!canGo(1)} aria-label="next week"
                style={{ ...stepBtn, opacity: canGo(1) ? 1 : 0.3 }}>›</button>
            </span>
          )}
          {/* ▦ FIELDS (founder) — the drip board's all-fields idea, fed by
              classic's starters. Offered only once feeds exist: a button into
              an empty overlay would read as broken. */}
          {fieldEntries.length > 0 && (
            <button onClick={() => setFieldsOpen(true)} title="Every game with a starter, as live field visuals" className="mono"
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ▦ FIELDS
            </button>
          )}
        </div>
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
            <TeamHead side={board.home} align="left" accent="var(--you)" mode={locked ? 'live' : 'proj'} />
            {/* NO LOCK REMINDER (v0.299.1, founder: "we also don't need the
                lock reminder or time"). Each spot already says its own kickoff
                on its own row — which is where the answer belongs, since 0178
                made locking per-spot — so a second countdown in the middle of
                the scoreboard was the same fact, further from the thing it is
                about. LIVE stays: that is the game's STATE, not a reminder. */}
            {/* GOLF (v0.303.0) has to be SAID here. Two numbers side by side
                read as "bigger is winning" in every scoreboard anyone has ever
                looked at, and in this league that is backwards — so the one
                place the totals meet is the one place the rule belongs. */}
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', textAlign: 'center', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
              {locked ? 'LIVE' : ''}
              {golf && <div style={{ color: 'var(--warn)', fontWeight: 700 }}>⛳ LOW WINS</div>}
            </div>
            <TeamHead side={board.away} align="right" accent="var(--opp, var(--dim))" mode={locked ? 'live' : 'proj'} />
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

      {/* ── STARTERS, head to head ─────────────────────────────────────────
          Since v0.237.0 this renders BEFORE the lock too, on the founder's
          Sleeper reference: a manager wants to see the week — kickoffs,
          projections, who's on a bye — while they still have time to do
          something about it, not only once it's too late.

          Two things the pre-lock board must be honest about, and is:
          • YOUR rows stay SETTABLE. Sleeper can be read-only here because it
            sets lineups on another screen; this screen is the only one we have,
            so every row of yours is still a button into the picker.
          • THEIR rows are SEALED, not empty. sealed_pick's RLS hands out an
            opponent's picks only once locked ("THE security boundary", 0001) —
            so the away column says so rather than rendering blanks that read
            as "they haven't set a lineup". */}
      {board && (
        <>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '10px 14px 6px' }}>
              <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>STARTERS</span>
              {/* 0178: both lineups are open all week, and each spot locks at
                  its own player's kickoff. Said once, here, because it is the
                  rule of the screen rather than a property of any one row. */}
              {!locked && <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>open lineups · each spot locks at its own kickoff</span>}
            </div>
            {board.starters.map((row) => {
              const auto = bb.has(row.slot);
              const settable = canEdit(row.slot);
              return (
                <div key={row.slot} style={{ padding: '10px 14px 12px', borderTop: '1px solid var(--bd)' }}>
                  {/* tier 1 — who, either side of the spot pill. Pre-lock there
                      is no opponent column to mirror (their picks are sealed),
                      so the row spans the width instead of leaving half the
                      screen blank beside a one-sided lineup. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}>
                    {row.home ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <BoardCell e={row.home} align="left"
                          onName={() => openPlayerCard({ slug: row.home!.slug, name: row.home!.name, pos: row.home!.pos, team: row.home!.team ?? '', week: matchup?.week, userId })} />
                        {/* ⇄ THE SWAP, its own small control (founder). The row
                            used to be one button into the picker, which left no
                            way to simply READ about the player in it. */}
                        {settable && (
                          <button onClick={() => setPickerSlot(pickerSlot === row.slot ? null : row.slot)} title="change this spot" className="mono"
                            style={{ flex: 'none', fontSize: 10, fontWeight: 700, color: 'var(--you)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 7px', cursor: 'pointer' }}>⇄</button>
                        )}
                      </div>
                    ) : settable ? (
                      <button onClick={() => setPickerSlot(pickerSlot === row.slot ? null : row.slot)} title="set this spot"
                        style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', minWidth: 0 }}>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--you)' }}>+ SET {row.label}</span>
                      </button>
                    ) : <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{auto ? '🎯 BEST BALL — nobody eligible yet' : 'Empty'}</span>}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <SlotPill pos={row.pos} label={row.label} />
                      {auto && <span className="mono" title="best ball — fills itself with your best eligible player" style={{ fontSize: 8, color: 'var(--you)' }}>🎯 AUTO</span>}
                    </div>
                    <BoardCell e={row.away} align="right"
                      onName={row.away ? () => openPlayerCard({ slug: row.away!.slug, name: row.away!.name, pos: row.away!.pos, team: row.away!.team ?? '', week: matchup?.week, userId }) : undefined} />
                  </div>
                  {/* tier 2 — where and when, and the number */}
                  {(row.home || row.away) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 7 }}>
                      {row.home ? <GameCard e={row.home} align="left" onOpen={fieldOpener(row.home)} /> : <div />}
                      {row.away ? <GameCard e={row.away} align="right" onOpen={fieldOpener(row.away)} /> : <div />}
                    </div>
                  )}
                  {!row.home && settable && (() => {
                    const d = slotDefs.find((x) => x.slot === row.slot);
                    const accepts = d ? slotAcceptsLabel(d) || d.pos.join('/') : '';
                    return accepts
                      ? <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 5 }}>takes {accepts}</div>
                      : null;
                  })()}
                </div>
              );
            })}
          </div>
          {/* BENCH and the stashes, BOTH SIDES (v0.249.0, founder). Classic
              lineups are open all week (0178), so there was never anything to
              withhold here — the board already fills their starting spots from
              this very roster. Rows pair by INDEX and nothing more, because two
              benches are just two lists: whichever side runs out first leaves
              its half of the row empty rather than stretching to match. */}
          {(['bench', 'ir'] as const).map((k) => {
            const rows = Math.max(board[k].home.length, board[k].away.length);
            if (!rows) return null;
            return (
              <div key={k} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', padding: '10px 14px 6px' }}>
                  {k === 'bench' ? 'BENCH' : 'TAXI / IR'}
                </div>
                {Array.from({ length: rows }, (_, i) => {
                  const h = board[k].home[i] ?? null;
                  const a = board[k].away[i] ?? null;
                  return (
                    <div key={i} style={{ padding: '9px 14px 11px', borderTop: '1px solid var(--bd)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}>
                        {h ? <BoardCell e={h} align="left" onName={() => openPlayerCard({ slug: h.slug, name: h.name, pos: h.pos, team: h.team ?? '', week: matchup?.week, userId })} /> : <span />}
                        <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', border: '1px solid var(--bd)', borderRadius: 999, padding: '2px 8px' }}>
                          {k === 'bench' ? 'BN' : 'IR'}
                        </span>
                        {a ? <BoardCell e={a} align="right" onName={() => openPlayerCard({ slug: a.slug, name: a.name, pos: a.pos, team: a.team ?? '', week: matchup?.week, userId })} /> : <span />}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 7 }}>
                        {h ? <GameCard e={h} align="left" onOpen={fieldOpener(h)} /> : <span />}
                        {a ? <GameCard e={a} align="right" onOpen={fieldOpener(a)} /> : <span />}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}

      {/* The plain setter grid, now the FALLBACK ONLY: the board covers both
          sides of the lock since v0.237.0, but if it can't assemble (no
          matchup, no roster) this is still a working lineup editor rather
          than a blank screen. */}
      {!board && (
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {slotDefs.map((d, i) => {
          const auto = bb.has(d.slot);
          const my = effective.mine[d.slot];
          const their = effective.theirs[d.slot];
          // The spot as the commissioner built it: what it's CALLED, and — when
          // the name doesn't already say it — what it ACCEPTS. A custom label
          // ("Only NFC Players") hides eligibility entirely, which is exactly
          // when a manager needs the positions spelled out.
          const accepts = slotAcceptsLabel(d);
          return (
            <div key={d.slot} style={{ display: 'grid', gridTemplateColumns: '104px 1fr 52px 52px 1fr', alignItems: 'center', gap: 6, padding: '8px 12px', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
              <div style={{ minWidth: 0 }}>
                <div className="mono" title={nameOf(d)} style={{ fontSize: 9.5, fontWeight: 700, color: auto ? 'var(--you)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(d)}{auto ? ' 🎯' : ''}</div>
                {accepts && <div className="mono" title={accepts} style={{ fontSize: 8, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accepts}</div>}
              </div>
              {auto && !locked ? (
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>BEST BALL — fills itself with your top scorer</span>
              ) : !canEdit(d.slot) ? <PlayerCell slug={my} /> : (
                <button onClick={() => setPickerSlot(pickerSlot === d.slot ? null : d.slot)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, color: 'inherit' }}>
                  {my ? <PlayerCell slug={my} /> : <span className="mono" style={{ fontSize: 10, color: 'var(--you)' }}>+ SET</span>}
                </button>
              )}
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, textAlign: 'right', color: 'var(--you)' }}>{locked || my ? r1(pts(my, d.pos, d.slot)) : ''}</span>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, textAlign: 'right', color: 'var(--dim)' }}>{locked ? r1(pts(their, d.pos, d.slot)) : ''}</span>
              <div style={{ textAlign: 'right' }}>{locked && <PlayerCell slug={their} right />}</div>
            </div>
          );
        })}
      </div>
      )}
      {saveNote && <div className="mono" style={{ fontSize: 9.5, color: saveNote === 'saved' ? 'var(--faint)' : 'var(--warn, #c66)' }}>{saveNote === 'saved' ? (saving ? 'saving…' : '✓ lineup saved') : saveNote}</div>}

      {/* ── THE PICKER, as a card over the board ───────────────────────────
          It used to render inline UNDER the whole board, which meant tapping a
          spot near the top scrolled the answer off screen: you pressed a thing
          and nothing appeared to happen. A spot is a question ("who goes
          here?"), so the answer belongs over the question — dismissed by the
          backdrop, ✕, or Escape, like the draft room's player card.

          It lists ONLY what may legally go in this spot: the spot's own
          position + filter rules (slotAllows), minus anyone already started,
          minus anyone whose game has kicked off — because the database would
          refuse all three and a picker that offers a refusal is a trap. */}
      {pickerSlot && canEdit(pickerSlot) && (() => {
        const d = slotDefs.find((x) => x.slot === pickerSlot);
        const f = slotFilterLabel(d?.flt);
        // EVERY eligible player on the roster, not just the bench (founder):
        // "put my TE in the flex" was a two-step dance — empty the TE spot,
        // then fill the flex — when it is one move. A player already starting
        // shows where he stands, and choosing him moves him.
        const spotOf = new Map<string, string>();
        for (const x of slotDefs) { const sl = effective.mine[x.slot]; if (sl) spotOf.set(sl, x.slot); }
        const eligible = pool
          .filter((p) => !stashed.has(p.slug))                       // taxi/IR can't start
          .filter((p) => d && slotAllows(d, { pos: p.pos, team: p.team, exp: expMap[p.slug] ?? null }))
          .filter((p) => !kickedOff(p.slug))
          .filter((p) => spotOf.get(p.slug) !== pickerSlot)          // already here
          // If he is starting somewhere his game has locked, he cannot leave —
          // the DB would refuse the vacating write, so don't offer the move.
          .filter((p) => { const from = spotOf.get(p.slug); return !from || canEdit(from); });
        return (
          <div onClick={() => setPickerSlot(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 420, maxHeight: '80vh', overflowY: 'auto', padding: 14, boxShadow: '0 18px 50px rgba(0,0,0,0.55)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <div>
                  <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{d ? nameOf(d) : pickerSlot}</div>
                  <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 3 }}>
                    takes {d?.pos.join(' / ')}
                    {f ? <span style={{ color: 'var(--you)' }}> · {f}</span> : null}
                  </div>
                </div>
                <button onClick={() => setPickerSlot(null)} className="mono" aria-label="close"
                  style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 15, cursor: 'pointer', lineHeight: 1, padding: 2 }}>✕</button>
              </div>
              {mine[pickerSlot] && (
                <button onClick={() => { void assign(pickerSlot, null); }} className="mono"
                  style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 10.5, padding: '8px 9px', marginBottom: 6, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--dim)', cursor: 'pointer' }}>
                  ✕ LEAVE THIS SPOT EMPTY
                </button>
              )}
              {eligible.length === 0 && (
                <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.6, padding: '6px 2px' }}>
                  Nobody on your roster can fill this spot right now — everyone eligible has already kicked off.
                </div>
              )}
              {eligible.map((p) => (
                <button key={p.slug} onClick={() => { void pickInto(pickerSlot, p.slug); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 9px', marginBottom: 2, background: 'none', border: '1px solid transparent', borderRadius: 6, cursor: 'pointer', color: 'inherit' }}>
                  <PlayerImg playerId={p.slug} team={p.team} pos={p.pos as Pos} size={26} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>
                    {shortName(p.full)}
                    {spotOf.get(p.slug) && (
                      <span className="mono" style={{ fontSize: 8.5, color: 'var(--you)', marginLeft: 6 }}>
                        in {slotName.get(spotOf.get(p.slug)!) ?? spotOf.get(p.slug)}
                      </span>
                    )}
                  </span>
                  <PosPill pos={p.pos as Pos} />
                  <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 30, textAlign: 'right' }}>{p.team}</span>
                  <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)', width: 34, textAlign: 'right' }}>{(PROJ_2026.get(p.slug) ?? 0).toFixed(1)}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Bench, as chips — the FALLBACK's bench. The board draws its own with
          game lines, so this would otherwise be the same players twice. */}
      {!board && (
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
      )}

      {/* ▦ ALL FIELDS — the drip board's full-screen field grid, over classic's
          starters. Same component, so follow mode and the flip memory ride
          along for free. */}
      {fieldsOpen && matchup && (
        <FieldBoard week={matchup.week} entries={fieldEntries} onClose={() => setFieldsOpen(false)} />
      )}

      {/* ── ONE GAME'S FIELD + PLAY LOG, as a card over the board ──────────
          The picker's pattern exactly: backdrop, ✕, Escape. FieldGame is
          self-contained (loads and polls its own feed), so the card just
          hosts it. */}
      {fieldGame && matchup && (
        <div onClick={() => setFieldGame(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ ...card, width: '100%', maxWidth: 560, maxHeight: '86vh', overflowY: 'auto', padding: 14, boxShadow: '0 18px 50px rgba(0,0,0,0.55)' }}>
            <FieldGame week={matchup.week} team={fieldGame} onClose={() => setFieldGame(null)} />
          </div>
        </div>
      )}

      <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', lineHeight: 1.6 }}>
        CLASSIC MODE — standard scoring across every stat ({ppr === 1 ? '1 pt' : ppr === 0.5 ? '½ pt' : 'no points'} per catch), live play by play.
        LINEUPS ARE OPEN: everyone in the league can see them, and each spot locks when THAT player's game kicks off —
        so a Thursday game never freezes your Sunday picks. No windows, no power-ups, no bonuses.
        {bb.size > 0 && (bb.size >= slotDefs.length
          ? ' FULL BEST BALL: every slot takes your highest scorer automatically — nothing to set.'
          : ' 🎯 slots are BEST BALL: they automatically take your highest-scoring player who isn\'t already started.')}
      </div>
    </div>
  );
}
