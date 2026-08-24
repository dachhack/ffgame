// Native leagues: create a league in-app, draft it live, manage the roster.
// Three screens, all mounted as LiveOnboard views (no new global routes):
//   • NativeCreate — the "start a fresh league" wizard: creates the league,
//     seeds the draftable pool (baked-PBP players ranked by real production),
//     generates the round-robin schedule, and hands out the invite link.
//   • DraftRoom  — live snake draft: pick clock, autopick for absent/vacant
//     seats (any client's poll advances it via draft_tick), searchable board.
//   • TeamManage — roster, drops, free agents, waiver claims + waiver order.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PosPill, PlayerImg, Avatar, FlagChip } from '../app/ui';
import { setCardLeague, openPlayerCard } from '../app/playerCard';
import { AvatarPicker } from '../app/AvatarPicker';
import type { Pos } from '@drip/core/types';
import { buildDraftPool } from '@drip/core/data/nativeLeague';
import { ADP_2026, ADP_AS_OF } from '@drip/core/data/adp2026';
import { PROJ_AS_OF } from '@drip/core/data/proj2026';
import { statsForSlug } from '@drip/core/data/players';
import {
  createNativeLeague, createMockDraft, deleteMockDraft, seedLeaguePool, nativeGenerateSchedule, leagueGameMode, contractRosterDepth,
  startDraft, draftState, makeDraftPick, draftTick,
  POS_CAP_KEYS, type PosCaps,
  leaguePool, nativeRosters, nativeTeamState, addFreeAgent, setRosterSpot,
  setDraftSetup, setDraftOrder, setDraftStart, setLotteryShares, runDraftLottery, type LotteryPick,
  submitWaiverClaim, cancelWaiverClaim, processWaivers, friendlyError,
  setTeamName, setTeamAvatar, setLeagueAvatar, setLeagueName,
  setDraftQueue, myDraftQueue, setAutodraft, myQueueMaxes, setQueueMax, auctionMarketValue,
  commishPauseDraft, commishResumeDraft, commishForcePick, commishUndoPick, setDraftNight,
  commishResetDraft, commishMoveDraftSlot, leagueAutodrafts, commishEditPick,
  myPushTokens, setPushPrefs, type PushTokenRow,
  nominate, placeBid, setLotProxy,
  leagueTrades, proposeTrade, respondTrade, cancelTrade, leagueContracts, type LeagueContracts,
  setContractYears, franchiseTag, extendContract, rfaTender, rfaBid, rfaResolve, lockContracts,
  myFavorites, tradeSignals, setTradeSignal, playerFlags, leaguePoolExp,
  rosterRules, injuryTags,
  leagueMarket,
  keeperState, setKeepers, type KeeperState,
  pickAssets, type PickAssetRow, type LeagueContinuity, isDynastyContinuity,
  setLeagueFormat, type LeagueFormat,
  type DraftState, type DraftPickRow, type LeaguePoolPlayer, type NativeTeamState, type TradeRow, type TradeSignalRow, type GameModeInfo,
} from '@drip/core/data/liveApi';
import { leagueSlotDefs, assignSpots, slotDisplayNames, slotBadgeLabel, slotAcceptsLabel, leagueEligiblePos, type SpotPlayer } from '@drip/core/engine/classic';
import { sortPool, POOL_SORTS, poolSortValue, projFor, setLiveAdp, type PoolSort } from '@drip/core/data/poolSort';
import { TENURE_BANDS, tenureMatches, type TenureBand } from '@drip/core/data/tenure';
import { setLeagueFlags } from '@drip/core/data/commish';
import { setLeagueProjScoring, leagueCatalogOf } from '@drip/core/engine/projScoring';
import { onRosterChanged, notifyRosterChanged } from '@drip/core/data/rosterBus';
import { webPushState, enableWebPush, disableWebPush, type WebPushState } from '../app/webPush';
import { LabelInfo } from './adminUi';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 };
const label: React.CSSProperties = { fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 };
const input: React.CSSProperties = { fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' };
const btn: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '11px 16px', cursor: 'pointer', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { ...btn, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const errStyle: React.CSSProperties = { fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 };
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 8 };

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P'] as const;
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

function Chip({ on, children, onClick, title }: { on?: boolean; children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title} className="mono" style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
      color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--surface)',
      border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 999, padding: '5px 11px',
    }}>{children}</button>
  );
}

// ★ sort/filter over a player list, driven by the account's favorite stars
// (0139 — the same stars the player card sets). 'first' floats starred players
// to the top of whatever order the list already has; 'only' hides everyone
// else. Distinct from the draft queue's Q (a per-draft ranked wishlist):
// favorites follow the ACCOUNT across every league and both hosts.
type StarMode = 'off' | 'first' | 'only';
function starApply<T>(list: T[], mode: StarMode, favs: Set<string>, slugOf: (x: T) => string): T[] {
  if (mode === 'only') return list.filter((x) => favs.has(slugOf(x)));
  if (mode === 'first') return list.slice().sort((a, b) => (favs.has(slugOf(b)) ? 1 : 0) - (favs.has(slugOf(a)) ? 1 : 0));
  return list;
}
function StarChips({ mode, setMode }: { mode: StarMode; setMode: (m: StarMode) => void }) {
  return (
    <>
      <Chip on={mode === 'first'} onClick={() => setMode(mode === 'first' ? 'off' : 'first')}>★ FIRST</Chip>
      <Chip on={mode === 'only'} onClick={() => setMode(mode === 'only' ? 'off' : 'only')}>★ ONLY</Chip>
    </>
  );
}
const STAR_GOLD = '#E8B23A';
const starMark = (favs: Set<string>, slug: string) =>
  favs.has(slug) ? <span title="a favorite of yours" style={{ color: STAR_GOLD, fontSize: 10, marginRight: 3 }}>★</span> : null;

// ─────────────────────────────────────────────────────────────────────────────
// Create wizard
// ─────────────────────────────────────────────────────────────────────────────
export function NativeCreate({ onDone, onLeague, onBack }: {
  /** Mock created → straight into the draft room. */
  onDone: (leagueId: string, rosterId: number) => void;
  /** Real league created → its commissioner dashboard, on ROSTER settings. */
  onLeague: (leagueId: string) => void;
  onBack: () => void;
}) {
  // LEAGUE = the real thing (invites, schedule, season). MOCK = a practice
  // draft against named AI teams: same settings surface, no season behind it,
  // starts immediately and lands straight in the draft room.
  const [kind, setKind] = useState<'league' | 'mock'>('league');
  // DRIP vs NORMAL (0175). The one choice on this screen that changes what the
  // game IS — scoring, the lineup, the whole weekly loop — so it comes first,
  // and it's the only new control: everything it needs beyond a flag (roster
  // size, position caps) it sets as a DEFAULT rather than as another question.
  //
  // NO DEFAULT (v0.251.0). This used to start on 'drip', and a commissioner
  // who never tapped 🏈 NORMAL got a drip league with a normie name — which is
  // exactly how the founder's "Normie Test" happened, and the choice FREEZES
  // at the draft, so the mistake is permanent. The form now refuses to submit
  // until the game is chosen. Mocks are exempt: a mock is a draft with no
  // season behind it, so it drafts the drip shape without asking.
  const [game, setGame] = useState<'drip' | 'classic' | null>(null);
  // CONTINUITY (0185): what carries into next season — an axis on top of
  // either game, not a third game. Keeper takes a keeper count; dynasty takes
  // rookie-draft rounds (keepers implied: everyone else) and deals three
  // seasons of tradeable picks at creation.
  const [continuity, setContinuity] = useState<LeagueContinuity>('redraft');
  const [keepN, setKeepN] = useState(4);      // keeper: how many each team keeps
  const [rookieN, setRookieN] = useState(3);  // dynasty: rookie-draft rounds
  // Contract types (0218) PRESET the room: picking one forces the auction —
  // bids become salaries, so there is nothing else the draft could be.
  const contractType = continuity === 'contract' || continuity === 'contract_dynasty';
  const dynastyType = continuity === 'dynasty' || continuity === 'contract_dynasty';
  const pickContinuity = (c: LeagueContinuity) => {
    setContinuity(c);
    if (c === 'contract' || c === 'contract_dynasty') setMode('auction');
  };
  const contLabel = continuity === 'contract_dynasty' ? '📜 CONTRACT DYNASTY '
    : continuity === 'contract' ? '📜 CONTRACT '
    : continuity === 'dynasty' ? '🏰 DYNASTY '
    : continuity === 'keeper' ? '★ KEEPER ' : '';
  // FORMAT (0221/0222): how the season is WON. Guillotine presets a $1000
  // FAAB market server-side; vampire gets its seat assigned in ⚑ COMMISH.
  const [format, setFormat] = useState<LeagueFormat>('standard');
  const [name, setName] = useState('');
  const [teams, setTeams] = useState(8);
  const [clock, setClock] = useState(90);
  const [mode, setMode] = useState<'snake' | 'linear' | 'auction'>('snake');
  const [budget, setBudget] = useState(200);
  // Pace: LIVE = everyone in the room (seconds); SLOW = days-long drafts
  // (hour-scale clocks; queues + proxy bids keep turns fair while offline).
  const [pace, setPace] = useState<'live' | 'slow'>('live');
  const [clockHrs, setClockHrs] = useState(12);   // slow: pick/nomination window
  const [bellSecs, setBellSecs] = useState(15);   // live auction bell
  const [bellHrs, setBellHrs] = useState(8);      // slow auction bell
  const [maxLots, setMaxLots] = useState(1);      // auction: parallel lots
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // ── What the create screen no longer asks (v0.221.0) ──────────────────────
  // The founder's note was "we don't need so many options in this", and the
  // dividing line that fell out of checking the RPCs is EDITABILITY, not
  // importance. Draft type, pace, clock and the auction knobs have NO setter
  // after creation — get them wrong and the league is stuck with them — so
  // they stay. Roster size and per-position limits have one (set_roster_rules,
  // live until the draft starts, right there on the commissioner's ROSTER
  // tab), and overnight pause has one (set_draft_night, in the draft room), so
  // they leave. They become DEFAULTS chosen by the game type instead of six
  // steppers asked before the league even has a name.
  //
  // Drip: 12 spots, 8 of them weekly starters, with the pre-0071 position
  // limits. Classic: 15 (a starting lineup plus a real bench) and NO position
  // limits, because a classic league's shape is its starting-lineup spec —
  // capping the roster too would be two answers to one question.
  // Contract types draft DEEP (v0.352.0): the roster covers everyone the AI
  // market prices above the $1 floor at THIS budget, so startable players
  // can't fall through to free street deals.
  const rounds = contractType ? contractRosterDepth(teams, budget) : game === 'classic' ? 15 : 12;
  const caps: PosCaps | null = game === 'classic'
    ? null
    : capsToPosCaps({ QB: 3, RB: CAP_UNLIMITED, WR: CAP_UNLIMITED, TE: 3, K: 1, DEF: 1 });

  const create = async () => {
    if (busy || (kind === 'league' && (!name.trim() || !game))) return;
    // Mocks never ask — they draft the drip shape (the choice is a season
    // property, and a mock has no season).
    const chosenGame: 'drip' | 'classic' = game ?? 'drip';
    setBusy(true); setErr(null);
    try {
      const pickSecs = pace === 'slow' ? clockHrs * 3600 : clock;
      const lotSecs = pace === 'slow' ? bellHrs * 3600 : bellSecs;
      if (kind === 'mock') {
        // Mock: create vs the AI, seed the pool, start, straight into the room.
        setNote('Spinning up your AI opponents…');
        const r = await createMockDraft(teams, rounds, pickSecs, mode, budget, lotSecs,
          mode === 'auction' ? maxLots : 1, caps);
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
      // The busy note NAMES the game, so the moment of creation says what is
      // being created — the last chance to notice a wrong tap before it
      // freezes at the draft.
      setNote(`Creating your ${contLabel}${chosenGame === 'classic' ? 'NORMAL' : 'DRIP'} league…`);
      const r = await createNativeLeague(name, '2026', teams, rounds, pickSecs, mode, budget, lotSecs,
        mode === 'auction' ? maxLots : 1, null, null, caps, chosenGame,
        continuity, continuity === 'keeper' ? keepN : dynastyType ? rookieN : null);
      if (!r.ok || !r.league_id) { setErr(friendlyError(r.error ?? 'Could not create the league.')); setBusy(false); return; }
      if (format !== 'standard') {
        setNote(`Setting the ${format === 'guillotine' ? '🔪 GUILLOTINE' : '🧛 VAMPIRE'} format…`);
        const fr = await setLeagueFormat(r.league_id, format);
        if (!fr.ok) { setErr(friendlyError(fr.error ?? 'Could not set the format.')); setBusy(false); return; }
      }
      setNote('Building the 2026 player pool…');
      const pool = await seedLeaguePool(r.league_id, await buildDraftPool(setNote));
      if (!pool.ok) { setErr(friendlyError(pool.error ?? 'Could not seed the player pool.')); setBusy(false); return; }
      setNote('Generating the season schedule…');
      const sched = await nativeGenerateSchedule(r.league_id, 14);
      if (!sched.ok) { setErr(friendlyError(sched.error ?? 'Could not build the schedule.')); setBusy(false); return; }
      // Straight to the league's commissioner dashboard, on 🧢 ROSTER: the
      // draft drafts the roster the league is SHAPED for, and both the shape
      // and the draft freeze the moment it starts, so the settings come first
      // and the draft room is one destination away.
      onLeague(r.league_id);
      return;
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

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
        {/* THE GAME (0175). First question on the screen because it's the only
            one that changes what you're playing rather than how it's set up —
            and it FREEZES at the draft, so it can't be a "decide later". A
            mock is a draft with no season behind it, so the choice doesn't
            apply there. */}
        {kind === 'league' && (
          <>
            <div className="mono" style={label}>WHICH GAME?</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
              <Chip on={game === 'drip'} onClick={() => setGame('drip')}>◈ DRIP</Chip>
              <Chip on={game === 'classic'} onClick={() => setGame('classic')}>🏈 NORMAL</Chip>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
              {game === null
                ? 'Pick one — this is the choice that decides what your league plays, and it locks in at the draft.'
                : game === 'drip'
                  ? 'Drip: your 8 starters play head-to-head in real time as the games run — drips, nukes and power-ups on live play-by-play.'
                  : 'Normal: fantasy the way you already know it. A positional starting lineup, weekly point totals, standard scoring you can tune.'}
            </div>
            {/* CONTINUITY (0185): redraft / keeper / dynasty. One selection;
                the number it needs appears with it. Editable any time in
                🎮 MODE & SEASON. */}
            <div style={{ height: 14 }} />
            <div className="mono" style={label}>NEXT SEASON</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
              <Chip on={continuity === 'redraft'} onClick={() => pickContinuity('redraft')}>REDRAFT</Chip>
              <Chip on={continuity === 'keeper'} onClick={() => pickContinuity('keeper')}>★ KEEPER</Chip>
              <Chip on={continuity === 'dynasty'} onClick={() => pickContinuity('dynasty')}>🏰 DYNASTY</Chip>
              <Chip on={continuity === 'contract'} onClick={() => pickContinuity('contract')}>📜 CONTRACT</Chip>
              <Chip on={continuity === 'contract_dynasty'} onClick={() => pickContinuity('contract_dynasty')}>📜🏰 CONTRACT DYNASTY</Chip>
            </div>
            {continuity === 'keeper' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)' }}>each team keeps</span>
                {num(keepN, setKeepN, 1, rounds - 1, 1)}
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)' }}>of {rounds} into next season</span>
              </div>
            )}
            {dynastyType && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)' }}>rookie draft runs</span>
                {num(rookieN, setRookieN, 1, Math.min(9, rounds - 1), 1)}
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)' }}>rounds each season</span>
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
              {continuity === 'redraft'
                ? 'Every season starts fresh — full draft, nothing carries over.'
                : continuity === 'keeper'
                  ? `Each team carries ${keepN} player${keepN === 1 ? '' : 's'} into next season and redrafts the rest.`
                  : continuity === 'contract'
                    ? `A salary-cap league: the startup is an auction and every winning bid becomes that player’s salary. You assign each deal’s length (1–4 years) during the draft. Preset: FAAB waivers (the bid signs the contract), free agents at $1, and a deep ${contractRosterDepth(teams, budget)}-spot roster so everyone worth over $1 gets drafted.`
                    : continuity === 'contract_dynasty'
                      ? `Contracts AND dynasty: an auction startup where bids become salaries, plus a ${rookieN}-round rookie draft each season with rookies signing scale deals (4yr default — a 📜 SALARY setting) — and three seasons of tradeable picks dealt from day one.`
                      : `Teams keep everyone except ${rookieN} roster spot${rookieN === 1 ? '' : 's'} and draft rookies each year — with every team's picks for the NEXT THREE SEASONS dealt as tradeable assets from day one.`}
            </div>
            {/* FORMAT (0221/0222): how the season is won. */}
            <div style={{ height: 14 }} />
            <div className="mono" style={label}>FORMAT</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
              <Chip on={format === 'standard'} onClick={() => setFormat('standard')}>HEAD-TO-HEAD</Chip>
              <Chip on={format === 'guillotine'} onClick={() => setFormat('guillotine')}>🔪 GUILLOTINE</Chip>
              <Chip on={format === 'vampire'} onClick={() => setFormat('vampire')}>🧛 VAMPIRE</Chip>
            </div>
            {format !== 'standard' && (
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
                {format === 'guillotine'
                  ? 'Each week the lowest-scoring team is ELIMINATED and its whole roster hits waivers — a $1000 FAAB frenzy (preset). Last team standing wins. Bring extra teams: one falls per week.'
                  : 'One team is the Vampire: no waivers, no free agents — when it wins a matchup it STEALS a player from the loser’s active roster (giving one back). Appoint the vampire seat in ⚑ COMMISH after creating, where you can also require your approval per steal.'}
              </div>
            )}
            <div style={{ height: 16 }} />
            <label className="mono" style={label}>LEAGUE NAME</label>
            <input value={name} autoFocus maxLength={40} onChange={(e) => { setName(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }} placeholder="e.g. Sunday Drip Society" style={{ ...input, marginTop: 7 }} />
          </>
        )}
        <div style={{ display: 'flex', gap: 18, marginTop: 16, flexWrap: 'wrap' }}>
          <div><div className="mono" style={label}>TEAMS</div><div style={{ marginTop: 7 }}>{num(teams, setTeams, 2, 14, 1)}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="mono" style={label}>DRAFT TYPE</div>
            {/* A contract type already DECIDED this: bids become salaries, so
                the room is an auction and the other chips would be a lie. */}
            {contractType && kind === 'league' ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center' }}>
                <Chip on onClick={() => {}}>AUCTION</Chip>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>set by the contract league type</span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                <Chip on={mode === 'snake'} onClick={() => setMode('snake')}>SNAKE</Chip>
                <Chip on={mode === 'linear'} onClick={() => setMode('linear')}>LINEAR</Chip>
                <Chip on={mode === 'auction'} onClick={() => setMode('auction')}>AUCTION</Chip>
              </div>
            )}
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
        {/* What the roster looks like is now a CONSEQUENCE of the game type,
            not a question — and every part of it is editable on the
            commissioner's ROSTER tab until the draft starts. Say what you're
            getting; don't make them configure it before the league exists. */}
        <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 14, lineHeight: 1.5 }}>
          {kind === 'league' && game === null
            ? 'The roster shape follows the game you pick above.'
            : game === 'classic' && kind === 'league'
              ? `${rounds} roster spots per team. You'll set the starting lineup — QB / RB / WR / TE / FLEX / K / D/ST, and any bench, taxi or IR spots — plus scoring on the league's ROSTER and SCORING tabs before the draft.`
              : `${rounds} roster spots per team: everyone fields 8 weekly starters (the game's kickoff windows — any position), the other ${Math.max(0, rounds - 8)} are bench. Roster size, position limits and the overnight draft pause are all adjustable in league settings until the draft starts.`}
        </div>
        {pace === 'slow' && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>
            Slow drafts run for days. Fairness is built in: any bid restarts the full bid window (no sniping), hidden max bids answer for you while you're away, and a missed turn nominates from your own queue.
          </div>
        )}
        {/* The button NAMES the game it will create — the confirmation lives
            in the moment of commitment, not in a dialog after the fact. */}
        <button onClick={create} disabled={busy || (kind === 'league' && (!name.trim() || !game))} className="mono"
          style={{ ...btn, width: '100%', marginTop: 16, opacity: busy || (kind === 'league' && (!name.trim() || !game)) ? 0.6 : 1 }}>
          {busy ? (note || 'CREATING…')
            : kind === 'mock' ? '🤖 START THE MOCK →'
            : game === null ? 'PICK A GAME TO CREATE'
            : `CREATE ${contLabel}${game === 'classic' ? '🏈 NORMAL' : '◈ DRIP'} LEAGUE →`}
        </button>
        {err && <div className="mono" style={errStyle}>{err}</div>}
        <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
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
  const proj = projFor(p.slug, p.pos);
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
          {onQueue && <button onClick={onQueue} className="mono" style={{ ...ghostBtn, flex: 1 }}>{queued ? 'Q · QUEUED — REMOVE' : 'Q · ADD TO QUEUE'}</button>}
          {action && <button onClick={action.run} className="mono" style={{ ...btn, flex: 1 }}>{action.label}</button>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft setup — the commissioner's pre-draft controls (0176)
// ─────────────────────────────────────────────────────────────────────────────
/** Everything the create screen no longer asks, plus the draft order.
 *
 *  v0.221.0 trimmed league creation on the rule "anything with a setter after
 *  creation doesn't need to be asked up front" — and four controls stayed only
 *  because they had NO setter. This is that setter, and it lives in the
 *  WAITING-TO-START card because that's where a commissioner already is while
 *  seats fill: the moment you'd want to stretch the clock because half the
 *  league is at work, or switch to auction because someone asked.
 *
 *  It disappears once the draft starts. Not a limitation — the same freeze the
 *  game mode, lineup spec and roster rules all use, for the same reason:
 *  change the format at pick 40 and there's no coherent reading of the first
 *  39 picks. */
function DraftSetup({ leagueId, st, seats, onSaved, teamName }: {
  leagueId: string;
  st: DraftState;
  /** Every seat in the league, ascending — the order editor's universe. */
  seats: number[];
  onSaved: () => void;
  teamName: (rid: number) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'snake' | 'linear' | 'auction'>(st.mode);
  // A contract league's format was decided at creation (0218): bids are the
  // salaries, so the room is an auction and the server refuses anything else
  // (0234). Chips that only earn that refusal don't render.
  const [contractRoom, setContractRoom] = useState(false);
  useEffect(() => { leagueContracts(leagueId).then((c) => setContractRoom(!!c.contracts)).catch(() => {}); }, [leagueId]);
  // Slow drafts are hour-scale; showing 172800 in a seconds box helps nobody,
  // so the unit follows the value the same way the create screen's pace does.
  const slow = st.pick_seconds >= 3600;
  const [clock, setClock] = useState(String(slow ? Math.round(st.pick_seconds / 3600) : st.pick_seconds));
  const [hrs, setHrs] = useState(slow);
  const [budget, setBudget] = useState(String(st.budget ?? 200));
  const [bell, setBell] = useState(String(st.lot_seconds >= 3600 ? Math.round(st.lot_seconds / 3600) : st.lot_seconds));
  const [bellHrs, setBellHrs] = useState(st.lot_seconds >= 3600);
  const [lots, setLots] = useState(String(st.max_lots));
  // The order is DRAFTED here and only committed on save, so a mis-tap while
  // reordering isn't immediately visible to the whole league.
  const [ord, setOrd] = useState<number[] | null>(st.order);
  /** Lottery weights per seat (0189). Absent = 1, i.e. a flat draw. */
  const [shares, setShares] = useState<Record<number, number>>({});
  const [drawn, setDrawn] = useState<LotteryPick[] | null>(null);
  // datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time — the ISO the server
  // stores is UTC, so it has to be shifted back through the local offset or
  // the field would show the commissioner someone else's clock.
  const [when, setWhen] = useState(() => {
    if (!st.start_at) return '';
    const d = new Date(st.start_at);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      if (r.ok) { setMsg(done); onSaved(); } else setMsg(friendlyError(r.error ?? 'that didn’t work'));
    } catch (e) { setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const saveSetup = () => {
    const c = Math.round(Number(clock) * (hrs ? 3600 : 1));
    const b = Math.round(Number(bell) * (bellHrs ? 3600 : 1));
    if (!Number.isFinite(c) || c <= 0) { setMsg('pick clock needs a number'); return; }
    void run(() => setDraftSetup(leagueId, c, mode,
      mode === 'auction' ? Math.round(Number(budget)) : null,
      mode === 'auction' ? b : null,
      mode === 'auction' ? Math.round(Number(lots)) : null), '✓ draft setup saved');
  };

  // Reorders whatever the rows currently SHOW, seeding the draft from seat
  // order on the first move. Operating on `ord` instead left the arrows dead
  // until you'd randomized once — so hand-setting an order from scratch, which
  // is the whole point of a reveal, silently did nothing.
  const move = (i: number, d: -1 | 1) => {
    const base = ord ?? seats;
    const j = i + d;
    if (j < 0 || j >= base.length) return;
    const next = [...base];
    [next[i], next[j]] = [next[j], next[i]];
    setOrd(next);
  };

  const fieldStyle: React.CSSProperties = { ...input, width: 78, padding: '7px 9px', fontSize: 13 };
  // The order the editor works on: whatever's stored, else the seats in seat
  // order as a starting point to drag from.
  const rows = ord ?? seats;
  const stale = ord != null && (ord.length !== seats.length || seats.some((s) => !ord.includes(s)));

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
      <button onClick={() => setOpen(!open)} className="mono" style={{ ...linkBtn, fontSize: 12 }}>
        {open ? '▾' : '▸'} ⚙ DRAFT SETUP {open ? '' : '— clock, format, order'}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="mono" style={label}>DRAFT TYPE</div>
          {contractRoom ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center' }}>
              <Chip on onClick={() => {}}>AUCTION</Chip>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>set by the contract league type</span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
              <Chip on={mode === 'snake'} onClick={() => setMode('snake')}>SNAKE</Chip>
              <Chip on={mode === 'linear'} onClick={() => setMode('linear')}>LINEAR</Chip>
              <Chip on={mode === 'auction'} onClick={() => setMode('auction')}>AUCTION</Chip>
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div className="mono" style={label}>{mode === 'auction' ? 'NOMINATION CLOCK' : 'PICK CLOCK'}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center' }}>
                <input value={clock} inputMode="numeric" onChange={(e) => setClock(e.target.value.replace(/\D/g, ''))} style={fieldStyle} />
                <Chip on={!hrs} onClick={() => setHrs(false)}>SEC</Chip>
                <Chip on={hrs} onClick={() => setHrs(true)}>HRS</Chip>
              </div>
            </div>
            {mode === 'auction' && (
              <>
                <div>
                  <div className="mono" style={label}>BUDGET ($ / TEAM)</div>
                  <input value={budget} inputMode="numeric" onChange={(e) => setBudget(e.target.value.replace(/\D/g, ''))} style={{ ...fieldStyle, marginTop: 7 }} />
                </div>
                <div>
                  <div className="mono" style={label}>BID BELL</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center' }}>
                    <input value={bell} inputMode="numeric" onChange={(e) => setBell(e.target.value.replace(/\D/g, ''))} style={fieldStyle} />
                    <Chip on={!bellHrs} onClick={() => setBellHrs(false)}>SEC</Chip>
                    <Chip on={bellHrs} onClick={() => setBellHrs(true)}>HRS</Chip>
                  </div>
                </div>
                <div>
                  <div className="mono" style={label}>LOTS AT ONCE</div>
                  <input value={lots} inputMode="numeric" onChange={(e) => setLots(e.target.value.replace(/\D/g, ''))} style={{ ...fieldStyle, marginTop: 7 }} />
                </div>
              </>
            )}
            <button onClick={saveSetup} disabled={busy} className="mono" style={{ ...btn, opacity: busy ? 0.6 : 1 }}>SAVE SETUP</button>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
            Roster size and position limits live on the league's ROSTER settings; the overnight pause is the 🌙 control above. All of it, this included, locks when the draft starts.
          </div>

          {/* ── when (0177) ── */}
          <div className="mono" style={{ ...label, marginTop: 16 }}>SCHEDULED START</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* datetime-local reads and writes the BROWSER's local time, which
                is what a commissioner means by "8pm"; it's converted to a real
                instant on the way out so every member's countdown agrees. */}
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              style={{ ...input, width: 'auto', padding: '7px 9px', fontSize: 13 }} />
            <button onClick={() => {
              const ms = Date.parse(when);
              if (!when || !Number.isFinite(ms)) { setMsg('pick a date and time'); return; }
              void run(() => setDraftStart(leagueId, new Date(ms).toISOString()), '✓ draft scheduled');
            }} disabled={busy} className="mono" style={{ ...btn, opacity: busy ? 0.6 : 1 }}>SCHEDULE IT</button>
            {st.start_at && (
              <button onClick={() => { setWhen(''); void run(() => setDraftStart(leagueId, null), '✓ back to a manual start'); }}
                disabled={busy} className="mono" style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>CLEAR</button>
            )}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
            {st.start_at
              ? 'Armed. The draft opens itself at that time whether or not anyone has the app open, and everyone gets a reminder about an hour out.'
              : 'Optional. Leave it empty and the draft starts when you press the button. Set it and the draft opens itself — the league gets a reminder about an hour before.'}
            {' '}The player pool must be seeded by then (it is, unless you cleared it) and at least two seats must exist, or the start retries until they are.
          </div>

          {/* ── the order, drawn early and on purpose ── */}
          <div className="mono" style={{ ...label, marginTop: 16 }}>DRAFT ORDER</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
            {st.order
              ? 'Set — the draft will start on this order, and everyone can see it now.'
              : 'Not set. Left alone, the order is randomized the moment the draft starts. Draw it here instead and the league sees the result before anyone is on the clock.'}
          </div>
          {stale && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--warn)', marginTop: 6, lineHeight: 1.5 }}>
              ⚠ This order no longer matches the league's seats — a team joined or left since it was drawn. Randomize or re-save it; if it's still stale at start, the draft randomizes rather than leaving anyone out.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
            {rows.map((rid, i) => (
              <div key={rid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg)', borderRadius: 5 }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--faint)', width: 22 }}>{i + 1}.</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {teamName(rid) ?? `Team ${rid}`}
                </span>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="mono"
                  style={{ ...ghostBtn, padding: '3px 8px', fontSize: 11, opacity: i === 0 ? 0.35 : 1 }} title="move up">▲</button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="mono"
                  style={{ ...ghostBtn, padding: '3px 8px', fontSize: 11, opacity: i === rows.length - 1 ? 0.35 : 1 }} title="move down">▼</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => void run(async () => {
              const r = await setDraftOrder(leagueId, null);
              if (r.ok && r.order) setOrd(r.order);
              return r;
            }, '✓ order drawn')} disabled={busy} className="mono" style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>🎲 RANDOMIZE</button>
            <button onClick={() => void run(() => setDraftOrder(leagueId, rows), '✓ order saved')}
              disabled={busy} className="mono" style={{ ...btn, opacity: busy ? 0.6 : 1 }}>SAVE ORDER</button>
          </div>

          {/* ── THE LOTTERY (0189) ────────────────────────────────────────────
              🎲 RANDOMIZE above is a FLAT shuffle — every seat equal. A dynasty
              league usually wants the opposite: last year's bottom team holding
              more balls than the team that nearly won. Shares are WEIGHTS, not
              percentages ("worst 250, champion 5"), because percentages have to
              be rebalanced every time one changes.

              The DRAW IS RECORDED and shown below — a weighted lottery nobody
              can inspect afterwards is indistinguishable from a commissioner
              typing an order. */}
          <div style={{ borderTop: '1px solid var(--bd)', marginTop: 14, paddingTop: 12 }}>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)' }}>LOTTERY</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.6 }}>
              Give each team a weight and draw the order from it. Leave them equal for a flat draw; a weight of 0 means
              they take a slot behind everyone drawn.
            </div>
            <div style={{ marginTop: 8 }}>
              {rows.map((rid) => {
                const w = shares[rid] ?? 1;
                const tot = rows.reduce((n, r2) => n + (shares[r2] ?? 1), 0);
                return (
                  <div key={`share-${rid}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamName(rid) ?? `Team ${rid}`}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', width: 52, textAlign: 'right' }}>{tot > 0 ? `${((w / tot) * 100).toFixed(1)}%` : '—'}</span>
                    <input value={String(w)} inputMode="numeric" className="mono"
                      onChange={(ev) => setShares((cur) => ({ ...cur, [rid]: Math.max(0, Math.min(1000000, parseInt(ev.target.value.replace(/[^0-9]/g, ''), 10) || 0)) }))}
                      style={{ width: 72, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--text)', fontSize: 11, padding: '4px 7px', textAlign: 'right', outline: 'none' }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button onClick={() => void run(() => setLotteryShares(leagueId, shares), '✓ shares saved')}
                disabled={busy} className="mono" style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>SAVE SHARES</button>
              <button onClick={() => void run(async () => {
                const r = await setLotteryShares(leagueId, shares);
                if (!r.ok) return r;
                const d = await runDraftLottery(leagueId);
                if (d.ok && d.order) { setOrd(d.order); setDrawn(d.result ?? null); }
                return d;
              }, '✓ lottery drawn')} disabled={busy} className="mono" style={{ ...btn, opacity: busy ? 0.6 : 1 }}>🎰 RUN THE LOTTERY</button>
            </div>
            {!!drawn?.length && (
              <div style={{ marginTop: 12 }}>
                <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)' }}>THE DRAW</div>
                {drawn.map((d, i) => (
                  <div key={`drawn-${d.roster_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--you)' : 'var(--faint)', width: 22 }}>{i + 1}.</span>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{teamName(d.roster_id) ?? `Team ${d.roster_id}`}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{d.share} · {(d.odds * 100).toFixed(1)}%</span>
                  </div>
                ))}
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
                  The odds shown are the ones each team held on its own draw, not its opening odds.
                </div>
              </div>
            )}
          </div>
          {msg && <div className="mono" style={{ fontSize: 12, marginTop: 8, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft room
// ─────────────────────────────────────────────────────────────────────────────
type DraftTab = 'players' | 'teams' | 'queue';

export function DraftRoom({ leagueId, onBack, onTeam, embedded = false }: {
  leagueId: string; onBack: () => void; onTeam: () => void;
  /** Mounted inside the commish dashboard's DRAFT tab — no back link or
   *  cross-view CTAs (the dashboard provides the chrome). */
  embedded?: boolean;
}) {
  const [st, setSt] = useState<DraftState | null>(null);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  // The commissioner's console embed (v0.351.0, founder: "in the commish
  // draft area, we don't need the players, just the settings") opens on
  // TEAMS and never offers the personal tabs — the room itself is where
  // drafting happens; the console is for running it.
  const [tab, setTab] = useState<DraftTab>(embedded ? 'teams' : 'players');
  const [teamView, setTeamView] = useState<number | null>(null);
  // Classic leagues show picks against the ROSTER SPOTS they'll fill; a drip
  // league has no starting spec to map onto, so it keeps the R1..Rn list.
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  const [expMap, setExpMap] = useState<Record<string, number>>({});   // years_exp, only when a spot filters on tenure (0172)
  const [cardFor, setCardFor] = useState<LeaguePoolPlayer | null>(null);
  const [q, setQ] = useState('');
  // Multi-select positions + the sort order (v0.302.0). Empty = every position
  // the league can roster; a position the server caps at ZERO (0195 — no spot
  // accepts it) isn't offered at all, since drafting one is refused anyway.
  const [posSel, setPosSel] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<PoolSort>('rank');
  const [own, setOwn] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    // ONE CALL, BOTH NUMBERS (v0.306.1): the live market carries ESPN's ADP
    // beside the ownership share. `setLiveAdp` overlays the baked consensus, so
    // a stale feed costs freshness rather than the whole column.
    leagueMarket(leagueId).then((r) => {
      if (!r?.ok) return;
      setOwn(r.own ?? {});
      setLiveAdp(r.adp ?? null);
    }).catch(() => {});
  }, [leagueId]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [starMode, setStarMode] = useState<StarMode>('off');
  const [proxyDraft, setProxyDraft] = useState<Record<string, string>>({});   // per-lot hidden-max inputs
  // Commish player flags (0141): loaded into the module cache; the bump
  // re-renders the FlagChips (same contract as the live board).
  const [, setFlagVer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [nightOpen, setNightOpen] = useState(false);
  const [ctrlOpen, setCtrlOpen] = useState(false);
  /** Commissioner assign mode: the PLAYERS list drafts FOR the seat on the
   *  clock instead of for me. A mode rather than a second button on every row —
   *  the row's button must never be ambiguous about whose pick it makes. */
  const [assign, setAssign] = useState(false);
  const [autos, setAutos] = useState<Record<number, boolean>>({});
  // A MADE PICK, OPENED FOR EDITING (0194, founder: "I need to be able to click
  // on a pick that was made and remove it or replace it with another available
  // player"). Commissioner only; the cell itself is the door.
  const [editPick, setEditPick] = useState<DraftPickRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0); // serverNow − clientNow, for an honest countdown
  const ticking = useRef(false);
  // The board follows the draft: the on-clock cell scrolls into view per pick.
  const onClockCellRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    onClockCellRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [st?.current_overall]);

  /** Who is on autodraft, by seat — draft_state carries only my own flag and
   *  the commissioner's per-team switch needs everyone's. */
  const loadAutos = () => { leagueAutodrafts(leagueId).then(setAutos).catch(() => {}); };
  const refresh = async () => {
    try {
      const s = await draftState(leagueId);
      if (s.error) { setErr(friendlyError(s.error)); return; }
      skew.current = Date.parse(s.server_now) - Date.now();
      setSt(s); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => {
    // `alive` guards the async reads that feed the SPOT panel: switching rooms
    // must not let a slower league's lineup spec land on a newer one (the
    // v0.232.0 lesson — an unguarded effect, not a rendering bug).
    let alive = true;
    refresh();
    loadAutos();
    leaguePool(leagueId).then(setPool).catch(() => {});
    myFavorites().then(setFavs).catch(() => {});
    playerFlags(leagueId).then((f) => { if (Array.isArray(f)) { setLeagueFlags(leagueId, f); setFlagVer((v) => v + 1); } }).catch(() => {});
    // The league's game mode + starting spec (0161/0163/0172/0174). A failed
    // read leaves gm null, which shows the old R1..Rn list — never a guess at
    // a lineup shape.
    leagueGameMode(leagueId).then((g) => {
      if (!alive || !g.ok) return;
      setGm(g);
      // The league's own catalog on the projection side (v0.310.0). Set here
      // rather than at each read: every pool on this screen sorts and displays
      // through `projFor`, which reads this module global, so a screen that
      // showed projections without installing would quietly render them under
      // whichever league was opened before it.
      setLeagueProjScoring(leagueCatalogOf(g));
      if ((g.slots ?? []).some((s) => s.min_exp != null || s.max_exp != null)) {
        leaguePoolExp(leagueId).then((m) => { if (alive) setExpMap(m); }).catch(() => {});
      }
    }).catch(() => {});
    nativeTeamState(leagueId).then((t) => {
      setTeam(t);
      if (t.my_roster_id != null) {
        myDraftQueue(leagueId, t.my_roster_id).then(setQueue).catch(() => {});
        myQueueMaxes(leagueId, t.my_roster_id).then(setQMax).catch(() => {});
      }
    }).catch(() => {});
    const poll = setInterval(refresh, 3000);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => { alive = false; clearInterval(poll); clearInterval(clock); };
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
    if (st?.status !== 'live' || ticking.current) return;
    // A PAUSED room still advances its AUTODRAFT seats (0191) — the client
    // drives that too, or a phone-only league's pause would freeze the seats
    // that asked not to be waited for until the worker's next sweep.
    const pausedAuto = !!st.paused && st.on_clock != null && !!autos[st.on_clock];
    if (st.paused && !pausedAuto) return;
    if ((overdueMs != null && overdueMs > 1200) || st.on_clock_auto || pausedAuto) {
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
  }, [now, st?.status, st?.on_clock, st?.lots?.length, st?.paused, autos]);

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
  // THE WIN MOMENT reaches the web (v0.354.11, founder: "there's still no
  // visual when you win a player on web") — same watermark trick as the app:
  // baseline my picks' top `overall` on entry so rejoining never celebrates
  // an old win; a new one drops the SOLD banner.
  const [won, setWon] = useState<{ slug: string; price: number } | null>(null);
  const wonMark = useRef<number | null>(null);
  useEffect(() => {
    if (!auction || myRoster == null || !st) return;
    const mine = (st.picks ?? []).filter((pk) => pk.roster_id === myRoster);
    const top = mine.reduce((m, pk) => Math.max(m, pk.overall), 0);
    if (wonMark.current == null) { wonMark.current = top; return; }
    if (top > wonMark.current) {
      wonMark.current = top;
      const pk = mine.find((x) => x.overall === top);
      if (pk && st.status === 'live') setWon({ slug: pk.slug, price: pk.price ?? 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, myRoster, auction]);
  useEffect(() => {
    if (!won) return;
    const id = setTimeout(() => setWon(null), 3500);
    return () => clearTimeout(id);
  }, [won]);
  // Standing maxes (0228): a queued player's ceiling becomes his lot's hidden
  // proxy the moment the lot opens — the queue bids for an absent manager.
  const [qMax, setQMax] = useState<Record<string, number>>({});
  const [qMaxDraft, setQMaxDraft] = useState<Record<string, string>>({});
  const myTurn = st?.status === 'live' && !st.paused && st.on_clock != null && st.on_clock === myRoster;
  const myBudget = auction ? st?.budgets?.find((b) => b.roster_id === myRoster) : null;
  /** Assign mode is only meaningful with a snake seat actually on the clock. */
  const assigning = assign && isCommish && !auction && st?.status === 'live' && st.on_clock != null;

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

  /** A position the league caps at ZERO can't be drafted at all (0195), so it
   *  is neither offered as a chip nor listed — "no kickers if there is no
   *  kicker spot on the roster", answered off the server's own number rather
   *  than a second derivation that could disagree with it. */
  const bannedPos = (p: string) => st?.pos_caps?.[p as keyof PosCaps] === 0;
  // v0.355.1 (founder: "Let's have only the positions in the league in the
  // draft filters") — the app's v0.351.0 trim, ported: the lineup spec's
  // eligible-position set gates the chips AND the list, so a league with no
  // DL spot shows no DL filter. Null (drip / mode read outstanding) trims
  // nothing.
  const eligPos = useMemo(
    () => leagueEligiblePos({ roster: gm?.roster ?? null, slots: gm?.slots ?? null } as GameModeInfo),
    [gm]);
  const posChips = useMemo(
    () => POS_FILTERS.filter((p) => p !== 'ALL' && !bannedPos(p) && (!eligPos || eligPos.has(p))),
    [st?.pos_caps, eligPos]);
  const avail = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // A player on an OPEN LOT is not in picks, so the taken filter missed him
    // and the list still offered NOM (v0.354.14, founder: "The players I am
    // trying to nom are already up for bid") — the lots at the top are where
    // he lives until the bell.
    const onBlock = new Set((st?.lots ?? []).map((l) => l.slug));
    const base = pool.filter((p) => !taken.has(p.slug) && !onBlock.has(p.slug)
      && (posSel.size ? posSel.has(p.pos) : (!bannedPos(p.pos) && (!eligPos || eligPos.has(p.pos))))
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
    return sortPool(starApply(base, starMode, favs, (p) => p.slug), sortBy, own);
  }, [pool, taken, st?.lots, q, posSel, st?.pos_caps, eligPos, starMode, favs, sortBy, own]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { const r = await fn(); if (!r.ok) setErr(friendlyError(r.error ?? 'That didn’t work.')); await refresh(); loadAutos(); }
    catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const saveQueue = (next: string[]) => {
    setQueue(next);
    if (myRoster != null) setDraftQueue(leagueId, myRoster, next).catch(() => {});
  };
  const toggleQueue = (slug: string) =>
    saveQueue(queue.includes(slug) ? queue.filter((s) => s !== slug) : [...queue, slug]);
// Drag to reorder (v0.354.8, founder: "Let's have drag to change order in
  // the queue in all versions") — HTML5 drag & drop; the row is the handle.
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dropQueue = (to: number) => {
    const from = dragFrom.current;
    dragFrom.current = null; setDragOver(null);
    if (from == null || from === to) return;
    const next = queue.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    saveQueue(next);
  };

  const act = (slug: string) => {
    // Assign mode makes the pick FOR the seat on the clock (0067's force pick
    // has always taken a slug — until now nothing called it with one).
    if (assigning) { run(() => commishForcePick(leagueId, slug)); return; }
    // The auction gate used to be a silent return — a paused room or a full
    // lot board made NOM a dead button (v0.354.13, founder: "Everytime I
    // click nom, nothing happens"). Name the reason instead.
    if (auction) {
      if (st?.paused) { setErr('The draft is paused — nominations resume when the commissioner hits ▶ RESUME.'); return; }
      if (st?.on_clock == null) { setErr(`All ${st?.max_lots ?? ''} lots are on the block — a new nomination opens at the next bell.`); return; }
      if (st.on_clock !== myRoster) { setErr(`It's ${teamName(st.on_clock) ?? `Team ${st.on_clock}`}'s nomination, not yours.`); return; }
      run(() => nominate(leagueId, slug, 1));
      return;
    }
    if (!myTurn) return;   // snake: the board's glowing cell already says whose pick it is
    run(() => makeDraftPick(leagueId, slug));
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
      {!embedded && <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>}
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

  // The league's starting spots, in the commissioner's own order. Null for a
  // drip league (no starting spec) or while the mode read is outstanding.
  const spotDefs = gm?.mode === 'classic' ? leagueSlotDefs({ roster: gm.roster ?? null, slots: gm.slots ?? null }) : null;
  // Repeats numbered (RB 1 / RB 2) so two identical rows can be told apart —
  // the same names the lineup setter uses, from the same core helper.
  const spotNames = spotDefs ? slotDisplayNames(spotDefs) : [];
  /** A seat's picks mapped onto the spots they'll fill — see assignSpots.
   *  A pick the pool doesn't know (pos '?') matches nothing and benches, so a
   *  missing pool row costs a spot, never a row. */
  const spotsFor = (rid: number) => {
    if (!spotDefs) return null;
    const players: SpotPlayer[] = pickRowsFor(rid).map((pk) => {
      const pl = poolBySlug.get(pk.slug);
      return { id: pk.slug, pos: pl?.pos ?? '?', team: pl?.team ?? null, exp: expMap[pk.slug] ?? null };
    });
    return assignSpots(spotDefs, players);
  };

  return (
    <div>
      {!embedded && <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>}
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
              : <>{st.rounds} rounds{(st.keeper_slots ?? 0) > 0 ? <> (+{st.keeper_slots} keepers already on rosters)</> : null} · {st.pick_seconds}s per pick · snake order (randomized at start). Queue players now — your queue drafts for you if the clock runs out.</>}
          </div>
          {/* 0177: the countdown belongs to EVERY member, not the commissioner
              — the whole point of a schedule is that the league knows when to
              show up without asking. Counts down off the server's own clock
              (`server_now`), so a member with a skewed device sees the same
              number as everyone else. */}
          {st.start_at && (() => {
            const left = Math.round((Date.parse(st.start_at) - Date.parse(st.server_now)) / 1000);
            const when = new Date(st.start_at).toLocaleString(undefined,
              { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            return (
              <div className="mono" style={{
                fontSize: 12, marginTop: 10, padding: '9px 11px', borderRadius: 6, lineHeight: 1.5,
                color: left > 0 ? 'var(--you)' : 'var(--warn)',
                border: `1px solid ${left > 0 ? 'var(--you)' : 'var(--warn)'}`,
              }}>
                {left > 0
                  ? <>⏱ Drafting in <b>{fmtCountdown(left)}</b> — {when}. It opens on its own; nobody has to press anything.</>
                  : <>⏱ Scheduled for {when} — starting now. If it doesn't open in a minute, the pool or a seat is missing and the commissioner can start it by hand.</>}
              </div>
            );
          })()}
          {isCommish && <button onClick={() => run(() => startDraft(leagueId))} disabled={busy} className="mono" style={{ ...btn, width: '100%', marginTop: 12, opacity: busy ? 0.6 : 1 }}>▶ START THE DRAFT{st.start_at ? ' NOW' : ''}</button>}
          {isCommish && <button onClick={() => run(async () => {
            // 0171: reseed under the league's enabled positions + player filter.
            const gm = await leagueGameMode(leagueId).catch(() => null);
            const r = await seedLeaguePool(leagueId, await buildDraftPool(undefined, { positions: gm?.positions ?? null, filter: gm?.pool_filter ?? null }));
            setPool(await leaguePool(leagueId));
            return r;
          })} disabled={busy} className="mono" style={{ ...ghostBtn, width: '100%', marginTop: 8, opacity: busy ? 0.6 : 1 }}>↻ REFRESH PLAYER POOL (2026 ADP)</button>}
          {err && <div className="mono" style={errStyle}>{err}</div>}
          {/* 0176: the commissioner's pre-draft controls. Collapsed by default —
              most visits here are to hit START, not to re-tune the format. */}
          {isCommish && (
            <DraftSetup leagueId={leagueId} st={st} teamName={teamName}
              seats={(team?.waiver_order ?? []).map((w) => w.roster_id).sort((a, b) => a - b)}
              onSaved={() => { void refresh(); }} />
          )}
        </div>
      )}

      {st.status === 'live' && (
        <div style={{ ...card, marginBottom: 12, borderLeft: '3px solid var(--you)' }}>
          {/* MY WALLET, FIRST (v0.354.12, founder: "Budget needs to be more
              visible") — the web's most-consulted number was a 9.5px footer;
              now it leads the card at glance size, like the app. */}
          {auction && myBudget && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, borderBottom: '1px solid var(--bd)', paddingBottom: 10, marginBottom: 10 }}>
              <div>
                <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--faint)' }}>MY BUDGET</div>
                <div className="grotesk" style={{ fontSize: 28, fontWeight: 700, color: 'var(--you)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>${myBudget.budget}</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--faint)' }}>MAX BID</div>
                <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>${myBudget.max_bid}</div>
              </div>
              {myBudget.committed > 0 && (
                <div>
                  <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--faint)' }}>COMMITTED</div>
                  <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--warn)', fontVariantNumeric: 'tabular-nums' }}>${myBudget.committed}</div>
                </div>
              )}
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginLeft: 'auto' }}>{(st.lots ?? []).length}/{st.max_lots} lots open</div>
            </div>
          )}
          {/* auction lots — up to max_lots run in parallel, each with its own bell */}
          {auction && (st.lots ?? []).map((lot, li) => {
            const lp = poolBySlug.get(lot.slug);
            const left = lotSecsLeft(lot);
            const iHold = lot.roster_id === myRoster;
            const canBidLot = myRoster != null && !iHold && (lot.my_max ?? 0) > lot.bid && !st.paused;
            // The three raises hold their POSITIONS (v0.355.3, founder: "not
            // have the bids change positions") — a step past your max or on a
            // lot you already hold ghosts instead of vanishing, so a button
            // never moves out from under a hovering cursor mid-auction.
            const steps = myRoster != null ? [lot.bid + 1, lot.bid + 5, lot.bid + 10] : [];
            const pd = proxyDraft[lot.id] ?? '';
            return (
              <div key={lot.id} style={{ borderTop: li ? '1px solid var(--bd)' : 'none', paddingTop: li ? 10 : 0, marginTop: li ? 10 : 0, boxShadow: iHold ? 'inset 4px 0 0 var(--you)' : 'none', paddingLeft: iHold ? 10 : 0, borderRadius: iHold ? 4 : 0 }}>
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
                {/* the fuse (v0.354.10): the bell as a bar — full at a fresh
                    window, gone at the gavel, and it REFILLS on any bid
                    because a change resets the clock. */}
                {left != null && (
                  <div style={{ height: 4, borderRadius: 2, background: 'var(--bd)', marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, (left / Math.max(1, st.lot_seconds)) * 100))}%`, background: left <= 5 ? 'var(--opp)' : 'var(--you)', transition: 'width 0.45s linear', borderRadius: 2 }} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {steps.map((a) => {
                    const can = canBidLot && a <= (lot.my_max ?? 0) && !busy;
                    return (
                      <button key={a} onClick={() => can && myRoster != null && run(() => placeBid(leagueId, myRoster, a, lot.id))} disabled={!can}
                        className="mono" style={{ ...btn, padding: '7px 12px', minWidth: 92, fontVariantNumeric: 'tabular-nums', opacity: can ? 1 : 0.35, cursor: can ? 'pointer' : 'default' }}>BID ${a}</button>
                    );
                  })}
                  {iHold && (
                    <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--warn)', borderRadius: 5, padding: '4px 9px', letterSpacing: '0.08em' }}>
                      🔨 YOU'RE THE HIGH BIDDER — ${lot.bid}
                    </span>
                  )}
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
              <button onClick={() => setNightOpen((v) => !v)} className="mono" style={{ ...ghostBtn, padding: '6px 10px', fontSize: 9.5 }}>
                {st.night ? `🌙 ${fmtNightWin(st.night)}` : '🌙 QUIET HRS'}
              </button>
              <button onClick={() => setCtrlOpen((v) => !v)} className="mono" style={{ ...ghostBtn, padding: '6px 10px', fontSize: 9.5 }}>
                ⚑ CONTROLS {ctrlOpen ? '▴' : '▾'}
              </button>
            </div>
          )}
          {isCommish && nightOpen && (
            <NightEditorWeb current={st.night ?? null} busy={busy}
              onSet={(s, e) => { setNightOpen(false); run(() => setDraftNight(leagueId, s, e)); }}
              onClear={() => { setNightOpen(false); run(() => setDraftNight(leagueId)); }} />
          )}
          {isCommish && ctrlOpen && (
            <CommishDraftControls leagueId={leagueId} st={st} busy={busy} teamName={teamName} autos={autos}
              assign={assign} onAssign={(v) => { setAssign(v); if (v) setTab('players'); }} onRun={run} />
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
            : !embedded
              ? <button onClick={onTeam} className="mono" style={{ ...btn, width: '100%', marginTop: 12 }}>⇄ MANAGE MY TEAM</button>
              : null}
          {isCommish && st.mode !== 'auction' && (
            <button onClick={() => run(() => commishUndoPick(leagueId))} disabled={busy} className="mono" style={{ ...ghostBtn, width: '100%', marginTop: 8, fontSize: 9.5 }}>↩ UNDO LAST PICK (reopens the draft)</button>
          )}
          {isCommish && !st.is_mock && (
            <button onClick={() => setCtrlOpen((v) => !v)} className="mono" style={{ ...ghostBtn, width: '100%', marginTop: 8, fontSize: 9.5 }}>⚑ COMMISH CONTROLS {ctrlOpen ? '▴' : '▾'}</button>
          )}
          {isCommish && ctrlOpen && (
            <CommishDraftControls leagueId={leagueId} st={st} busy={busy} teamName={teamName} autos={autos}
              assign={false} onAssign={() => {}} onRun={run} />
          )}
        </div>
      )}

      {/* Desktop: board + player panel side by side; phones: stacked (the
          flex bases make the columns collapse under ~900px). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
      {/* THE BOARD — always on screen for SNAKE (Sleeper-style): one column
          per team, the view follows the on-clock pick. An AUCTION pins YOUR
          TEAM here instead (v0.354.15, founder: "We don't really need to see
          the draft board pinned on the auction draft. We do need the player's
          team they are building though.") — the board's award-order columns
          stay a TEAMS-tab read. */}
      {auction && myRoster != null && (
        <div style={{ ...card, padding: 12, flex: '1 1 320px', minWidth: 280, maxHeight: 560, overflow: 'auto', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
            <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--you)' }}>🧢 MY TEAM</div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginLeft: 'auto' }}>
              {pickRowsFor(myRoster).length}/{st.rounds} spots{myBudget ? ` · $${myBudget.budget} left` : ''}
            </div>
          </div>
          {(() => {
            const rows = pickRowsFor(myRoster);
            const pickOf = new Map(rows.map((pk) => [pk.slug, pk]));
            const mrow = (key: string | number, tag: string, slug: string) => {
              const pl = poolBySlug.get(slug);
              const pk = pickOf.get(slug);
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                  <span className="mono" title={tag} style={{ fontSize: 8.5, color: 'var(--faint)', width: 72, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                  <PlayerImg playerId={slug} espnId={pl?.espn_id} team={pl?.team} pos={(pl?.pos ?? 'WR') as Pos} size={22} />
                  <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl?.full_name ?? slug}</span>
                  <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>${pk?.price ?? 1}</span>
                </div>
              );
            };
            const fill = spotsFor(myRoster);
            if (!fill) {
              return rows.length === 0
                ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No wins yet — your players land here as the bells ring.</div>
                : rows.map((pk) => mrow(pk.overall, `$${pk.price ?? 1}`, pk.slug));
            }
            return (
              <>
                {fill.spots.map((sp, si) => (sp.player
                  ? mrow(sp.def.slot, spotNames[si], sp.player.id)
                  : (
                    <div key={sp.def.slot} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', borderTop: '1px solid var(--bd)', opacity: 0.5 }}>
                      <span className="mono" title={spotNames[si]} style={{ fontSize: 8.5, color: 'var(--faint)', width: 72, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spotNames[si]}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>— empty</span>
                    </div>
                  )))}
                {fill.bench.length > 0 && (
                  <>
                    <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: 'var(--faint)', padding: '8px 0 2px' }}>BENCH · {fill.bench.length}</div>
                    {fill.bench.map((bp) => mrow(bp.id, 'BN', bp.id))}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
      {teams > 0 && !auction && (
        <div style={{ ...card, padding: 8, flex: '1.3 1 460px', minWidth: 320, maxHeight: 560, overflow: 'auto', boxSizing: 'border-box' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${teams}, 88px)`, gap: 4, width: 'max-content' }}>
            {(st.order ?? []).map((rid) => (
              <div key={`bh-${rid}`} style={{ position: 'sticky', top: 0, zIndex: 2, background: rid === myRoster ? 'color-mix(in srgb, var(--you) 14%, var(--surface))' : 'var(--surface)', display: 'flex', alignItems: 'center', gap: 5, padding: '2px 4px 6px', borderRadius: 6, boxShadow: rid === myRoster ? 'inset 0 -2px 0 var(--you)' : 'none' }}>
                <Avatar name={teamName(rid) ?? `Team ${rid}`} src={byRoster[rid]?.avatar} size={20} />
                <div style={{ minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 8, fontWeight: 700, color: rid === myRoster ? 'var(--you)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 56 }}>{teamName(rid) ?? `Team ${rid}`}</div>
                  {auction && st.budgets && <div className="mono" style={{ fontSize: 7.5, color: 'var(--faint)' }}>${st.budgets.find((b) => b.roster_id === rid)?.budget ?? ''}</div>}
                </div>
              </div>
            ))}
            {Array.from({ length: st.rounds }, (_, r) =>
              (st.order ?? []).map((rid, c) => {
                // snake: even rounds flow right→left; auction: order-of-award per team
                const cell = auction
                  ? pickRowsFor(rid)[r]
                  : (st.picks ?? []).find((pk) => pk.round === r + 1 && pk.roster_id === rid);
                const overallHere = !auction && st.status === 'live'
                  && st.current_overall === r * teams + (r % 2 === 0 ? c + 1 : teams - c);
                const pl = cell ? poolBySlug.get(cell.slug) : null;
                const fg = `var(--pos-${pl?.pos ?? 'WR'}-fg)`;
                const nm = (pl?.full_name ?? cell?.slug ?? '').split(' ');
                const first = nm.length > 1 ? nm[0] : ' ';
                const last = nm.length > 1 ? nm.slice(1).join(' ') : nm[0];
                const canEdit = isCommish && !!cell && !auction;
                return (
                  <div key={`b-${r}-${rid}`} ref={overallHere ? onClockCellRef : undefined}
                    onClick={canEdit ? () => setEditPick(cell!) : undefined}
                    role={canEdit ? 'button' : undefined}
                    title={canEdit ? 'commish: remove or replace this pick' : undefined}
                    style={{
                    height: 50, borderRadius: 6, padding: '4px 6px', boxSizing: 'border-box', overflow: 'hidden',
                    cursor: canEdit ? 'pointer' : undefined,
                    background: cell ? `var(--pos-${pl?.pos ?? 'WR'}-bg)` : rid === myRoster ? 'color-mix(in srgb, var(--you) 7%, var(--bg))' : 'var(--bg)',
                    border: `1px solid ${overallHere ? 'var(--you)' : rid === myRoster ? 'color-mix(in srgb, var(--you) 45%, var(--bd))' : 'var(--bd)'}`,
                    boxShadow: overallHere ? '0 0 8px color-mix(in srgb, var(--you) 45%, transparent)' : 'none',
                  }}>
                    {cell ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.06em', color: fg }}>{posLabel(pl?.pos ?? '')}</span>
                          <span className="mono" style={{ fontSize: 7.5, color: fg, opacity: 0.8 }}>
                            {auction ? `$${cell.price ?? 1}` : `${cell.round}.${((cell.overall - 1) % teams) + 1}`}{cell.auto ? ' 🤖' : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: 8.5, color: fg, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{first}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last}</div>
                      </>
                    ) : (
                      <div className="mono" style={{ fontSize: 8, color: overallHere ? 'var(--you)' : 'var(--faint)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
                        <span>{overallHere ? '⏱ on clock' : auction ? '—' : `${r + 1}.${r % 2 === 0 ? c + 1 : teams - c}`}</span>
                        {!auction && !overallHere && <span style={{ opacity: 0.5 }}>{r % 2 === 0 ? '→' : '←'}</span>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* the tabbed panel (players / teams / queue) — the second column */}
      <div style={{ flex: '1 1 400px', minWidth: 320 }}>
      {/* tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {!embedded && tabChip('players', `PLAYERS (${avail.length})`)}
        {tabChip('teams', 'TEAMS')}
        {!embedded && tabChip('queue', `QUEUE (${queue.length})`)}
      </div>

      {/* PLAYERS — available list with ADP + projections. Not in the console
          embed: settings and teams only there. */}
      {tab === 'players' && !embedded && (
        <div style={card}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players or teams…" style={{ ...input, marginBottom: 10 }} />
          {/* position filters double as my roster-fill meter: taken/limit */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <Chip on={posSel.size === 0} onClick={() => setPosSel(new Set())}>
              ALL{myRoster == null ? '' : ` ${Object.values(myPosCount).reduce((a, b) => a + b, 0)}/${st.rounds}`}
            </Chip>
            {posChips.map((p) => {
              const fill = myRoster == null ? '' : ` ${myPosCount[p] ?? 0}/${st.pos_caps?.[p as keyof PosCaps] ?? '∞'}`;
              return (
                <Chip key={p} on={posSel.has(p)}
                  onClick={() => setPosSel((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n; })}>{posLabel(p)}{fill}</Chip>
              );
            })}
            <StarChips mode={starMode} setMode={setStarMode} />
          </div>
          {/* THE ORDER (v0.302.0). RANK is what the clock's autopick follows,
              so it stays the default even here where ADP and PROJ are already
              printed beside every name. */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>SORT</span>
            {POOL_SORTS.map((o) => (
              <Chip key={o.id} on={sortBy === o.id} onClick={() => setSortBy(o.id)} title={o.hint}>{o.label}</Chip>
            ))}
          </div>
          {assigning && (
            <div className="mono" style={{ fontSize: 9.5, lineHeight: 1.5, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 7, padding: '7px 9px', marginBottom: 8 }}>
              ⚑ ASSIGNING FOR {teamName(st.on_clock) ?? `Team ${st.on_clock}`} — the next player you pick becomes their pick. Tap ⚑ CONTROLS to stop.
            </div>
          )}
          <div className="mono" style={{ display: 'flex', gap: 8, padding: '0 0 4px 62px', fontSize: 7.5, letterSpacing: '0.1em', color: 'var(--faint)' }}>
            <span style={{ flex: 1 }}>PLAYER</span><span style={{ width: 38, textAlign: 'right' }}>ADP</span><span style={{ width: 38, textAlign: 'right' }}>PROJ</span><span style={{ width: 34, textAlign: 'right' }}>OWN</span><span style={{ width: 20 }} />
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {avail.slice(0, 120).map((p) => {
              const adp = ADP_2026.get(p.slug); const proj = projFor(p.slug, p.pos);
              const inQ = queue.includes(p.slug);
              return (
                <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--bd)' }}>
                  <button onClick={() => act(p.slug)} disabled={assigning ? busy : (!myTurn || busy || atCap(p.pos))} className="mono"
                    title={assigning ? `assign to ${teamName(st.on_clock) ?? `Team ${st.on_clock}`}` : atCap(p.pos) ? `position limit reached (${posLabel(p.pos)})` : undefined}
                    style={{ ...btn, padding: '7px 8px', fontSize: 9, width: 54, flexShrink: 0,
                      background: assigning ? 'var(--warn)' : btn.background,
                      opacity: (assigning ? !busy : myTurn && !busy && !atCap(p.pos)) ? 1 : 0.35 }}>
                    {assigning ? 'ASSIGN' : atCap(p.pos) ? 'LIMIT' : auction ? 'NOM $1' : 'DRAFT'}
                  </button>
                  <button onClick={() => setCardFor(p)} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={28} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{starMark(favs, p.slug)}{p.full_name}</div>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 2 }}>
                        <PosPill pos={p.pos as Pos} />
                        <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p.team} · #{p.rank}</span>
                        <FlagChip slug={p.slug} />
                      </div>
                    </div>
                  </button>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', width: 38, textAlign: 'right' }}>{adp != null ? adp.toFixed(0) : '—'}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', width: 38, textAlign: 'right' }}>{proj != null ? proj.toFixed(1) : '—'}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', width: 34, textAlign: 'right' }}
                    title="share of this platform's drafted leagues rostering him">{own ? `${own[p.slug] ?? 0}%` : '—'}</span>
                  {/* Q, not a star (v0.345.2, founder): the row already carries a
                      GOLD ★ for favorites, and a second star meaning "queued"
                      made the two systems read as one. Q says which one this is. */}
                  <button onClick={() => toggleQueue(p.slug)} title={inQ ? 'remove from queue' : 'add to queue'} className="mono"
                    style={{ cursor: 'pointer', fontSize: 10, fontWeight: 700, minWidth: 22, padding: '2px 5px', borderRadius: 4, flexShrink: 0, background: inQ ? 'var(--warn)' : 'none', border: `1px solid ${inQ ? 'var(--warn)' : 'var(--bd)'}`, color: inQ ? 'var(--on-accent)' : 'var(--faint)' }}>Q</button>
                </div>
              );
            })}
            {avail.length > 120 && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', padding: '8px 0' }}>…{avail.length - 120} more — narrow the search.</div>}
          </div>
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
            const pickOf = new Map(rows.map((pk) => [pk.slug, pk]));
            const cost = (pk: DraftPickRow) => (auction ? `$${pk.price ?? 1}` : `R${pk.round}`);
            // One row: a tag on the left (the SPOT it fills, or the round/price
            // when there are no spots to fill), the player, where he came from.
            const row = (key: string | number, tag: string, slug: string, withCost = false) => {
              const pl = poolBySlug.get(slug);
              const pk = pickOf.get(slug);
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                  <span className="mono" title={tag} style={{ fontSize: 9, color: 'var(--faint)', width: spotDefs ? 92 : 30, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                  <PlayerImg playerId={slug} espnId={pl?.espn_id} team={pl?.team} pos={(pl?.pos ?? 'WR') as Pos} size={24} />
                  <PosPill pos={(pl?.pos ?? 'WR') as Pos} />
                  <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{pl?.full_name ?? slug}</span>
                  {/* Where he came from — kept on the spot rows, since the left
                      column now says WHERE HE PLAYS rather than which round. */}
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{pl?.team}{withCost && pk ? ` · ${cost(pk)}` : ''}{pk?.auto ? ' 🤖' : ''}</span>
                </div>
              );
            };
            const fill = spotsFor(rid);
            // Drip league (or the mode read hasn't landed): the picks, as they came.
            if (!fill) {
              return rows.length === 0
                ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No picks yet.</div>
                : rows.map((pk) => row(pk.overall, cost(pk), pk.slug));
            }
            const seated = fill.spots.filter((s) => s.player).length;
            return (
              <>
                <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: 'var(--faint)', paddingBottom: 4 }}>
                  STARTING LINEUP · {seated}/{fill.spots.length} FILLED
                </div>
                {fill.spots.map((s, si) => (s.player
                  ? row(s.def.slot, spotNames[si], s.player.id, true)
                  : (
                    <div key={s.def.slot} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)', opacity: 0.55 }}>
                      <span className="mono" title={spotNames[si]} style={{ fontSize: 9, color: 'var(--faint)', width: 92, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spotNames[si]}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', flex: 1 }}>
                        — empty{slotAcceptsLabel(s.def) ? ` · ${slotAcceptsLabel(s.def)}` : ''}
                      </span>
                    </div>
                  )))}
                <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: 'var(--faint)', padding: '10px 0 4px' }}>
                  BENCH{fill.bench.length ? ` · ${fill.bench.length}` : ''}
                </div>
                {fill.bench.length === 0
                  ? <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{rows.length ? 'Every pick is starting.' : 'No picks yet.'}</div>
                  : fill.bench.map((p) => row(`b-${p.id}`, pickOf.get(p.id) ? cost(pickOf.get(p.id)!) : 'BN', p.id))}
              </>
            );
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
          {queue.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>Empty — tap Q on any player. If your clock runs out (or autodraft is on), your queue picks for you, in order, before best-available.</div>}
          {auction && queue.length > 0 && (
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 6 }}>
              🕶 MAX bids for you even while you're away: the moment his lot opens — your nomination or anyone's — it becomes your hidden ceiling, answering rivals second-price style. You pay their bid + $1, never your max. Click a player's mkt price to set it as your max in one click.
            </div>
          )}
          {/* 0191: a pause is time for PEOPLE. A seat that asked not to be
              waited for keeps picking through one. */}
          {!!st.my_autodraft && (
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--you)', lineHeight: 1.5, paddingTop: 6 }}>
              🤖 Autodraft is on — your seat keeps picking even while the commissioner has the draft paused.
            </div>
          )}
          {queue.map((slug, i) => {
            const p = poolBySlug.get(slug);
            const gone = taken.has(slug);
            return (
              <div key={slug} draggable
                onDragStart={() => { dragFrom.current = i; }}
                onDragOver={(ev) => { ev.preventDefault(); if (dragOver !== i) setDragOver(i); }}
                onDrop={() => dropQueue(i)}
                onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: dragOver === i ? '2px solid var(--you)' : '1px solid var(--bd)', opacity: gone ? 0.45 : 1, cursor: 'grab' }}>
                <span className="mono" title="drag to reorder" style={{ fontSize: 11, color: 'var(--faint)', width: 14, cursor: 'grab' }}>⠿</span>
                <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 18 }}>{i + 1}</span>
                {p && <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />}
                <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, textDecoration: gone ? 'line-through' : 'none' }}>{p?.full_name ?? slug}</span>
                {gone && <span className="mono" style={{ fontSize: 8.5, color: 'var(--opp)' }}>TAKEN</span>}
                {auction && !gone && myRoster != null && (() => {
                  const mkt = auctionMarketValue(p?.rank, st.budget);
                  return mkt != null && qMax[slug] !== mkt ? (
                    <button className="mono" title="one click sets your standing max to his market price — the value curve at his pool rank"
                      onClick={() => { void setQueueMax(leagueId, myRoster, slug, mkt).then((r) => { if (r.ok) { setQMax((m) => ({ ...m, [slug]: mkt })); setQMaxDraft((dd) => ({ ...dd, [slug]: '' })); } }).catch(() => {}); }}
                      style={{ ...linkBtn, fontSize: 9, color: 'var(--dim)', padding: '0 3px' }}>${mkt}</button>
                  ) : null;
                })()}
                {auction && !gone && myRoster != null && (qMax[slug] != null ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {([['▼', -1], ['▲', 1]] as const).map(([sym, dir]) => (
                      <button key={sym} className="mono" title={dir > 0 ? 'raise the standing max' : 'lower the standing max'}
                        onClick={() => {
                          const step = (st.budget ?? 200) >= 500 ? 5 : 1;
                          const v = Math.max(1, (qMax[slug] ?? 1) + dir * step);
                          if (v === qMax[slug]) return;
                          void setQueueMax(leagueId, myRoster, slug, v).then((r) => { if (r.ok) setQMax((m) => ({ ...m, [slug]: v })); }).catch(() => {});
                        }}
                        style={{ ...linkBtn, fontSize: 9, color: 'var(--dim)', padding: '2px 3px' }}>{sym}</button>
                    ))}
                    <button className="mono" title="clear the standing max"
                      onClick={() => { void setQueueMax(leagueId, myRoster, slug, null).then((r) => { if (r.ok) setQMax((m) => { const n = { ...m }; delete n[slug]; return n; }); }).catch(() => {}); }}
                      style={{ ...linkBtn, color: 'var(--you)', border: '1px solid var(--you)', borderRadius: 5, padding: '2px 6px', fontSize: 9.5, fontWeight: 700 }}>
                      {'🕶 $'}{qMax[slug]} ✕
                    </button>
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input value={qMaxDraft[slug] ?? ''} placeholder="max" className="mono"
                      onChange={(ev) => setQMaxDraft({ ...qMaxDraft, [slug]: ev.target.value.replace(/\D/g, '') })}
                      style={{ width: 44, padding: '3px 5px', fontSize: 10, borderRadius: 5, border: '1px solid var(--bd)', background: 'var(--bg)', color: 'var(--text)' }} />
                    {!!qMaxDraft[slug] && (
                      <button className="mono" style={{ ...linkBtn, color: 'var(--you)', fontWeight: 700, padding: '0 3px', fontSize: 9.5 }}
                        onClick={() => {
                          const v = parseInt(qMaxDraft[slug], 10);
                          if (!v) return;
                          void setQueueMax(leagueId, myRoster, slug, v).then((r) => {
                            if (r.ok) { setQMax((m) => ({ ...m, [slug]: v })); setQMaxDraft((dd) => ({ ...dd, [slug]: '' })); }
                          }).catch(() => {});
                        }}>SET</button>
                    )}
                  </span>
                ))}
                <button onClick={() => toggleQueue(slug)} className="mono" style={{ ...linkBtn, color: 'var(--opp)', padding: '0 3px' }}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      </div>{/* /tab panel column */}
      </div>{/* /board + panel row */}

      {/* the SOLD banner — fixed over the room, dismisses itself or on click */}
      {won && (() => {
        const wp = poolBySlug.get(won.slug);
        return (
          <div onClick={() => setWon(null)}
            style={{ position: 'fixed', top: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: '2px solid var(--you)', borderRadius: 12, padding: '14px 18px', boxShadow: '0 8px 28px rgba(0,0,0,0.45)', cursor: 'pointer', minWidth: 320 }}>
            <PlayerImg playerId={won.slug} espnId={wp?.espn_id} team={wp?.team} pos={(wp?.pos ?? 'WR') as Pos} size={46} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--you)' }}>🔨 SOLD — HE'S YOURS</div>
              <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{wp?.full_name ?? won.slug}</div>
            </div>
            <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, color: 'var(--you)', fontVariantNumeric: 'tabular-nums' }}>${won.price}</div>
          </div>
        );
      })()}

      {cardFor && (
        <PlayerCard p={cardFor} onClose={() => setCardFor(null)}
          queued={queue.includes(cardFor.slug)} onQueue={() => toggleQueue(cardFor.slug)}
          action={myTurn && !taken.has(cardFor.slug) && !atCap(cardFor.pos)
            ? { label: auction ? 'NOMINATE $1' : 'DRAFT HIM', run: () => { const s = cardFor.slug; setCardFor(null); act(s); } }
            : null} />
      )}

      {/* EDIT A MADE PICK (0194) — the commissioner's fix for "round 3 went to
          the wrong player", which undo could only reach by unwinding every pick
          made since. Remove leaves the cell empty; replace swaps in place. */}
      {editPick && (
        <EditPickModal leagueId={leagueId} pick={editPick} busy={busy}
          teamName={teamName(editPick.roster_id) ?? `Team ${editPick.roster_id}`}
          player={poolBySlug.get(editPick.slug) ?? null}
          available={avail}
          onClose={() => setEditPick(null)}
          onDone={(fn) => { setEditPick(null); run(fn); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Team management — roster / free agents / waivers
// ─────────────────────────────────────────────────────────────────────────────
/** Where a league-home tile wants the team screen to land (0182). */
export type TeamFocus = 'trades' | 'waivers' | 'options';
/** MY TEAM's tabs (v0.296.5) — the app's three, plus KEEPERS where the league
 *  keeps anyone. ROSTER first, always: it is what the screen is for. */
type TeamTab = 'roster' | 'waivers' | 'trades' | 'keepers' | 'contracts';

// ── Keepers (0182): declare who you carry into next season ──────────────────
// Renders nothing unless the commissioner set a keeper count. Undeclared spots
// auto-fill with the team's best-ranked players at rollover, so this card is a
// choice, never homework.
function KeepersCard({ leagueId, myRoster, mine }: {
  leagueId: string; myRoster: number; mine: (LeaguePoolPlayer & { spot: string })[];
}) {
  const [st, setSt] = useState<KeeperState | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    const s = await keeperState(leagueId);
    if (s.error || !s.ok) return;
    setSt(s);
    const minerow = s.teams.find((t) => t.roster_id === myRoster);
    setSel(new Set(minerow?.declared ?? []));
    setDirty(false);
  };
  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line */ }, [leagueId, myRoster]);
  // A DYNASTY LEAGUE KEEPS EVERYONE (v0.298.1, founder: "I still have keeper in
  // 'my team' in my dynasty team. No need for that, you keep everyone"). Its
  // keeper_count is derived — roster − rookie rounds — so the count is nonzero
  // and this card used to draw, asking a manager to DECLARE what carries when
  // the answer is "all of it". Declaring is a KEEPER-league act.
  if (!st || st.keeper_count === 0 || isDynastyContinuity(st.continuity)) return null;

  const rolled = !!st.rolled_league_id;
  const carried = st.teams.find((t) => t.roster_id === myRoster)?.keep ?? [];
  const toggle = (slug: string) => {
    if (rolled || busy) return;
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < st.keeper_count) next.add(slug);
      else return cur;                     // full — tap one off first
      return next;
    });
    setDirty(true); setNote(null);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setKeepers(leagueId, myRoster, [...sel]);
      setNote(r.ok ? '✓ saved' : (r.error ?? 'that didn’t work'));
      if (r.ok) await load();
    } catch (x) { setNote(friendlyError(x)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ ...card, marginBottom: 12, borderLeft: '3px solid var(--you)' }}>
      <div style={hdr}>★ KEEPERS{st.next_season ? ` FOR ${st.next_season}` : ''} ({rolled ? carried.length : sel.size}/{st.keeper_count})</div>
      {rolled ? (
        <>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 6 }}>
            The season rolled over — these carried into {st.next_season}:
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {carried.map((k) => (
              <span key={k.slug} className="mono" style={{ fontSize: 10.5, border: '1px solid var(--bd)', borderRadius: 5, padding: '3px 8px', color: 'var(--text)' }}>
                {k.declared ? '★ ' : ''}{mine.find((p) => p.slug === k.slug)?.full_name ?? k.slug}
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 8 }}>
            Pick up to {st.keeper_count} to carry into next season. Spots you leave open auto-fill with your best-ranked players when the commissioner rolls the league over.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {mine.map((p) => {
              const on = sel.has(p.slug);
              return (
                <button key={p.slug} onClick={() => toggle(p.slug)} disabled={busy}
                  className="mono" style={{
                    fontSize: 10.5, cursor: 'pointer', borderRadius: 5, padding: '4px 9px',
                    color: on ? 'var(--on-accent)' : 'var(--dim)',
                    background: on ? 'var(--you)' : 'var(--bg)',
                    border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`,
                  }}>
                  {on ? '★ ' : ''}{p.full_name}
                </button>
              );
            })}
          </div>
          {dirty && (
            <button onClick={save} disabled={busy} className="mono" style={{ ...btn, marginTop: 10 }}>
              {busy ? '…' : `SAVE KEEPERS (${sel.size}/${st.keeper_count})`}
            </button>
          )}
          {note && <div className="mono" style={{ fontSize: 10.5, color: note.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 6 }}>{note}</div>}
        </>
      )}
    </div>
  );
}

/** ONE ROSTER LINE — a spot badge, and who is in it (v0.285.0, web).
 *
 *  Sibling of the app's RosterRow (apps/mobile/src/screens/Team.tsx); the two
 *  say the same thing in each host's idiom, and the comment there carries the
 *  reasoning for what ISN'T here any more:
 *
 *    • no →TAXI cycle button — DESIGNATIONS are the SLOTS' job now. An empty
 *      IR/taxi place invites a player in; a filled one's badge sends him back.
 *    • no DROP button — dropping is the PLAYER CARD's job, two clicks deep,
 *      and the same button wherever you found him.
 *
 *  ONE FIXED BADGE WIDTH, as on the app (v0.289.0): the box grew with its text,
 *  so a FLEX spot's chip ran several times the width of a QB's and pushed that
 *  one row's player out of the column every other row shared. `slotBadgeLabel`
 *  drops the parenthetical eligibility ("FLEX (RB/WR/TE)" → "FLEX") so the
 *  labels FIT the box rather than being cut to fit it; a longer custom name
 *  wraps inside the same width.
 */
function RosterLine({ badge, badgePos, tone, p, busy, onSlot, slotVerb }: {
  badge: string;
  badgePos?: string;
  /** A CSS colour for the badge on IR/taxi lines; starters take their position's. */
  tone?: string;
  p: (LeaguePoolPlayer & { spot: string }) | null;
  busy: boolean;
  /** IR/taxi only: fill this place, or empty it. Absent on starters + bench. */
  onSlot?: () => void;
  slotVerb?: string;
}) {
  const fg = tone ?? (badgePos ? `var(--pos-${badgePos}-fg, var(--dim))` : 'var(--dim)');
  const bg = tone || !badgePos ? 'transparent' : `var(--pos-${badgePos}-bg, transparent)`;
  const badgeBox = (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
      width: 74, minHeight: 26, flex: 'none', textAlign: 'center', border: `1px solid ${fg}`,
      background: bg, borderRadius: 5, padding: '3px 4px', fontSize: 8.5, fontWeight: 700, color: fg, lineHeight: 1.25 }}>
      {slotBadgeLabel(badge)}{p && onSlot ? ' ↩' : ''}
    </span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
      {/* On a FILLED taxi/IR place the badge is the way out — click TX ↩ and he
          is back on the active roster. Nothing else on the line moves him. */}
      {p && onSlot
        ? <button onClick={onSlot} disabled={busy} title="back to the active roster"
            style={{ background: 'none', border: 0, padding: 0, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}>{badgeBox}</button>
        : badgeBox}
      {p ? (
        <>
          <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />
          <button onClick={() => openPlayerCard({ slug: p.slug, name: p.full_name, pos: p.pos, team: p.team })}
            style={{ background: 'none', border: 0, padding: 0, flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer' }}>
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p.pos} · {p.team}</span>
          </button>
          <FlagChip slug={p.slug} />
        </>
      ) : onSlot ? (
        <button onClick={onSlot} disabled={busy} className="mono"
          style={{ background: 'none', border: 0, padding: 0, flex: 1, textAlign: 'left', fontSize: 10.5, color: 'var(--dim)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}>
          ＋ move someone to the {slotVerb ?? 'squad'}
        </button>
      ) : (
        <span className="mono" style={{ flex: 1, fontSize: 10.5, color: 'var(--faint)' }}>Empty</span>
      )}
    </div>
  );
}

// ── 📜 The cap sheet (v0.353.2) — web port of the app's CapSheet ─────────────
// Every deal by team with payroll/room, length chips while the draft room is
// open (commissioner: any time), the offseason front office (tag / extend /
// RFA tender), retained-salary ghosts, dead money, and the RFA board.
export function CapSheet({ leagueId, myRoster, isCommish = false }: { leagueId: string; myRoster: number | null; isCommish?: boolean }) {
  const [st, setSt] = useState<LeagueContracts | null>(null);
  const [names, setNames] = useState<Record<string, LeaguePoolPlayer>>({});
  const [open, setOpen] = useState<number | null>(myRoster);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bidFor, setBidFor] = useState<string | null>(null);   // open RFA bid form, by slug
  const [bidSalary, setBidSalary] = useState('');
  const [bidYears, setBidYears] = useState(1);

  const load = () => leagueContracts(leagueId).then((r) => {
    setSt(r);
    if (r.contracts) {
      leaguePool(leagueId)
        .then((ps) => setNames(Object.fromEntries(ps.map((p) => [p.slug, p]))))
        .catch(() => {});
    }
  }).catch(() => setSt({ contracts: false }));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { if (done) setNote(done); await load(); }
      else setNote(friendlyError(r.error ?? 'that didn’t work'));
    } catch (x) { setNote(friendlyError(x)); }
    finally { setBusy(false); }
  };

  if (!st?.contracts) return null;
  const deals = st.deals ?? [];
  const yearsMax = st.years_max ?? 4;
  const canAssign = !st.locked;
  const offseason = !!st.offseason;
  const rules = st.rules;
  const tenders = st.tenders ?? [];
  const nameOf = (s: string) => names[s]?.full_name ?? s;
  const HOW: Record<string, string> = { auction: 'auction', rookie: 'rookie deal', draft: 'draft', waiver: 'waiver', fa: 'free agent', commish: 'commish' };
  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <LabelInfo label="📜 CAP SHEET"
        info={'How deals are born: auction wins sign at the exact bid, waiver wins at their FAAB bid, free agents at the $1 minimum, startup picks at the rookie scale. A move that would land a team over the cap is refused whole.\n\nWhile the draft room is open, set each of your own deals’ lengths; after it closes only the commissioner can change one (rookie-scale lengths are always fixed).\n\n"$X ghost" is salary a team retained on a player it traded away. Red lines are dead money from cuts, charged for the deal’s remaining life. "mkt $N" is HIS market price — the league’s value curve at his pool rank, scaled to the cap. Extensions discount off his market; the 🏷 tag prices off the top-5 positional salary average instead (the NFL’s own tag formula), so tagging a star costs star money.\n\nIn the OFFSEASON your expiring deals grow 🏷 TAG (one per team, at the market or a raise), ⤴ EXTEND (1–3yr at a discount of market), and 🪧 TENDER (RFA: rivals bid, you match or let him walk). Multi-year deals carry into next season at a year less; expiring deals walk unless kept one of those ways.'} />
      <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5 }}>
        ${st.salary_cap} cap · deals up to {st.years_max}yr · {deals.length} signed
        {offseason ? ' · OFFSEASON — tags, extensions & RFA are live' : ''}
      </div>
      {!!note && <div className="mono" style={{ fontSize: 10, color: note.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 4 }}>{note}</div>}
      {myRoster != null && !st.my_locked && st.lock_deadline != null && Date.parse(st.lock_deadline) > Date.now() && (
        <div style={{ marginTop: 8, border: '1px solid var(--warn)', borderRadius: 7, padding: 10 }}>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--warn)', lineHeight: 1.5, marginBottom: 8 }}>
            🔒 Waivers & free agency are closed for your team until you lock your contract lengths. Set each deal below, then lock. Unset deals stay 1 year — everything auto-locks {new Date(st.lock_deadline).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.
          </div>
          <button className="mono" disabled={busy}
            onClick={() => { void act(() => lockContracts(leagueId, myRoster), '✓ locked — your wire is open'); }}
            style={{ ...btn, padding: '8px 12px', fontSize: 10, fontWeight: 700 }}>🔒 LOCK MY CONTRACTS</button>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {(st.payrolls ?? []).map((p) => {
          const cap = p.cap ?? st.salary_cap ?? 0;
          const room = cap - p.payroll;
          const mine = p.roster_id === myRoster;
          const unfolded = open === p.roster_id;
          const team = deals.filter((d) => d.roster_id === p.roster_id);
          const ghosts = (st.retentions ?? []).filter((r) => r.roster_id === p.roster_id);
          const dead = (st.dead ?? []).filter((r) => r.roster_id === p.roster_id);
          const myTagUsed = team.some((d) => d.tagged);
          return (
            <div key={p.roster_id} style={{ borderTop: '1px solid var(--bd)' }}>
              <div onClick={() => setOpen(unfolded ? null : p.roster_id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: mine ? 'var(--you)' : 'var(--text)', fontWeight: mine ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.team ?? `Roster ${p.roster_id}`}
                  </div>
                  {!!p.cap_adjust && <div className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>cap {p.cap_adjust > 0 ? '+' : ''}${p.cap_adjust} by trade</div>}
                </div>
                {(st.locks ?? []).some((l) => l.roster_id === p.roster_id && !l.locked) && (
                  <span className="mono" style={{ fontSize: 8.5, color: 'var(--warn)' }}>🔓</span>
                )}
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: room < 0 ? 'var(--opp)' : 'var(--text)' }}>${p.payroll}/${cap}</span>
                <span className="mono" style={{ fontSize: 9, color: room < 0 ? 'var(--opp)' : 'var(--faint)', width: 62, textAlign: 'right' }}>
                  {room < 0 ? `$${-room} over` : `$${room} room`}
                </span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{unfolded ? '▾' : '▸'}</span>
              </div>
              {unfolded && team.map((d) => {
                // 0233: rookie deals and LOCKED seats never show chips — the
                // commissioner's pen works only on unlocked veteran deals.
                const seatLocked = !!(st.locks ?? []).find((lk) => lk.roster_id === p.roster_id)?.locked;
                const pickable = d.acquired !== 'rookie' && !seatLocked && (mine ? canAssign : isCommish);
                const net = d.salary - (d.retained ?? 0);
                const frontOffice = offseason && mine && d.years === 1 && !d.tagged;
                const tendered = tenders.some((x) => x.slug === d.slug && x.status === 'open');
                const bargain = (d.mkt ?? 0) > d.salary;
                return (
                  <div key={d.slug} style={{ padding: '3px 0 3px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.tagged ? '🏷 ' : ''}{nameOf(d.slug)}{names[d.slug]?.pos ? ` · ${names[d.slug].pos}` : ''}
                      </span>
                      <span className="mono" style={{ fontSize: 9.5, fontWeight: 700 }}>${net}·{d.years}yr</span>
                      {d.mkt != null && <span className="mono" style={{ fontSize: 8, color: bargain ? 'var(--you)' : 'var(--faint)' }}>mkt ${d.mkt}</span>}
                      <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', width: 70, textAlign: 'right' }}>{HOW[d.acquired] ?? d.acquired}</span>
                    </div>
                    {!!d.retained && (
                      <div className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>${d.retained} of ${d.salary} retained by a former team</div>
                    )}
                    {pickable && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '3px 0 2px' }}>
                        <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>LENGTH</span>
                        {Array.from({ length: yearsMax }, (_, i) => i + 1).map((y) => (
                          <Chip key={y} on={d.years === y}
                            title={y === 1
                              ? 'an expiring deal — after this season he walks unless tagged, extended or tendered; expiring deals cut free (no dead money)'
                              : `a ${y}-year deal — carries into next season at a year less; cutting it early leaves ${rules?.dead_pct ?? 30}% of the salary as dead money for the deal's remaining life`}
                            onClick={() => { if (!busy) void act(() => setContractYears(leagueId, d.slug, y)); }}>{y}YR</Chip>
                        ))}
                      </div>
                    )}
                    {frontOffice && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '3px 0 2px', flexWrap: 'wrap' }}>
                        {!myTagUsed && (
                          <Chip title={`franchise tag — one per team, expiring deals only: keeps him one more year at the top-5 positional salary average or salary +${rules?.tag_raise_pct ?? 20}%, whichever is higher`}
                            onClick={() => { if (!busy) void act(() => franchiseTag(leagueId, d.slug), `✓ ${nameOf(d.slug)} tagged`); }}>🏷 TAG</Chip>
                        )}
                        {!tendered && [1, 2, 3].map((y) => (
                          <Chip key={y} title={`extend ${y} more year${y === 1 ? '' : 's'} at ${rules?.ext_discount_pct ?? 85}% of HIS market — the value curve at his pool rank — locked in before he reaches the open market`}
                            onClick={() => { if (!busy) void act(() => extendContract(leagueId, d.slug, y), `✓ extended ${y}yr at ${rules?.ext_discount_pct ?? 85}% of market`); }}>⤴ EXT {y}YR</Chip>
                        ))}
                        {rules?.rfa && !tendered && (
                          <Chip title="restricted free agency — rivals bid a salary and length for him; you keep the right to match their best offer exactly, or let him walk with it"
                            onClick={() => { if (!busy) void act(() => rfaTender(leagueId, d.slug), `✓ ${nameOf(d.slug)} tendered to RFA`); }}>🪧 TENDER</Chip>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {unfolded && ghosts.map((g2) => (
                <div key={`g-${g2.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 2px 10px' }}>
                  <span style={{ flex: 1, fontSize: 10.5, color: 'var(--faint)', fontStyle: 'italic' }}>{nameOf(g2.slug)} — retained on the way out</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>${g2.amount} ghost</span>
                </div>
              ))}
              {unfolded && dead.map((dm, i) => (
                <div key={`d-${dm.slug}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 2px 10px' }}>
                  <span style={{ flex: 1, fontSize: 10.5, color: 'var(--opp)', fontStyle: 'italic' }}>{nameOf(dm.slug)} — dead money{dm.note ? ` (${dm.note})` : ''}</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--opp)' }}>${dm.amount}·{dm.years_left}yr</span>
                </div>
              ))}
              {unfolded && team.length === 0 && ghosts.length === 0 && dead.length === 0 && (
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', padding: '0 0 5px 10px' }}>no deals on the books</div>
              )}
            </div>
          );
        })}
      </div>
      {offseason && tenders.filter((x) => x.status === 'open').length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.12em' }}>🪧 RFA BOARD</div>
          {tenders.filter((x) => x.status === 'open').map((x) => {
            const ownerIsMe = x.roster_id === myRoster;
            const bidding = bidFor === x.slug;
            return (
              <div key={x.slug} style={{ padding: '5px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text)' }}>{nameOf(x.slug)}</span>
                  <span className="mono" style={{ fontSize: 9, color: x.offer_salary ? 'var(--warn)' : 'var(--faint)' }}>
                    {x.offer_salary ? `best offer $${x.offer_salary}·${x.offer_years}yr` : 'no offers yet'}
                  </span>
                </div>
                {!ownerIsMe && myRoster != null && !bidding && (
                  <Chip title="bid a salary and length for this tendered player — his owner can match your exact terms or let him walk to you"
                    onClick={() => { setBidFor(x.slug); setBidSalary(String((x.offer_salary ?? 0) + 1)); setBidYears(x.offer_years ?? 1); }}>💰 MAKE AN OFFER</Chip>
                )}
                {!ownerIsMe && bidding && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>$</span>
                    <input value={bidSalary} maxLength={5} className="mono"
                      onChange={(ev) => setBidSalary(ev.target.value.replace(/[^0-9]/g, ''))}
                      style={{ width: 58, padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--bg)', color: 'var(--text)' }} />
                    {Array.from({ length: yearsMax }, (_, i) => i + 1).map((y) => (
                      <Chip key={y} on={bidYears === y} onClick={() => setBidYears(y)}>{y}YR</Chip>
                    ))}
                    <Chip onClick={() => {
                      if (busy || !parseInt(bidSalary, 10)) return;
                      setBidFor(null);
                      void act(() => rfaBid(leagueId, myRoster!, x.slug, parseInt(bidSalary, 10), bidYears), '✓ offer in');
                    }}>✓ BID</Chip>
                  </div>
                )}
                {ownerIsMe && x.offer_salary != null && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <Chip title="keep him at the best offer's exact salary and years — your cap must fit it"
                      onClick={() => { if (!busy) void act(() => rfaResolve(leagueId, x.slug, true), `✓ matched — ${nameOf(x.slug)} stays`); }}>✓ MATCH</Chip>
                    <Chip title="he leaves at the best offer's terms — his new team carries the deal"
                      onClick={() => { if (!busy) void act(() => rfaResolve(leagueId, x.slug, false), '✓ walked — the deal moved with him'); }}>👋 LET WALK</Chip>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canAssign && (
        <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 8 }}>
          The draft room is open — set each of your deals’ lengths above before it closes.
        </div>
      )}
    </div>
  );
}

export function TeamManage({ leagueId, onBack, onDraft, focus }: {
  leagueId: string; onBack: () => void; onDraft: () => void; focus?: TeamFocus;
}) {
  // Player cards opened from this screen's roster and wire lists get the
  // league's own panels — who holds him, and the league's moves on him
  // (v0.282.0). Cleared on the way out so the context never outlives the page.
  useEffect(() => { setCardLeague(leagueId); return () => setCardLeague(null); }, [leagueId]);
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [rosters, setRosters] = useState<{ roster_id: number; slug: string; spot?: 'active' | 'taxi' | 'ir' }[]>([]);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [q, setQ] = useState('');
  // POSITIONS ARE A MULTI-SELECT NOW (v0.302.0, founder: "allow multiple select
  // in the waiver filters"). Empty = every position the league can roster,
  // which is not the same as every position — see `eligiblePos`.
  const [posSel, setPosSel] = useState<Set<string>>(new Set());
  // Waiver-wire filters beyond position (founder): tenure band and NFL team.
  const [tenure, setTenure] = useState<TenureBand>('any');
  const [nflTeam, setNflTeam] = useState('ALL');
  const [sortBy, setSortBy] = useState<PoolSort>('rank');
  const [own, setOwn] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    // ONE CALL, BOTH NUMBERS (v0.306.1): the live market carries ESPN's ADP
    // beside the ownership share. `setLiveAdp` overlays the baked consensus, so
    // a stale feed costs freshness rather than the whole column.
    leagueMarket(leagueId).then((r) => {
      if (!r?.ok) return;
      setOwn(r.own ?? {});
      setLiveAdp(r.adp ?? null);
    }).catch(() => {});
  }, [leagueId]);
  const [expMap, setExpMap] = useState<Record<string, number>>({});   // years_exp by slug
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [starMode, setStarMode] = useState<StarMode>('off');
  const [, setFlagVer] = useState(0); // commish flags landed in the cache (0141)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<LeaguePoolPlayer | null>(null); // roster full → pick a drop
  // FAAB: a waiver claim needs a blind bid — collected in a small modal.
  const [claimFor, setClaimFor] = useState<{ p: LeaguePoolPlayer; drop?: string } | null>(null);
  const [bidDraft, setBidDraft] = useState('');
  // The league's LINEUP SHAPE — what the roster lays itself out against: the
  // starting spots, and how many bench/IR/taxi places exist (v0.285.0, matching
  // the app's roster since v0.281.0).
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  const [fillFor, setFillFor] = useState<'taxi' | 'ir' | null>(null);          // an empty IR/taxi place, asking who
  // ── WHO MAY BE STASHED (0198) ───────────────────────────────────────────
  // The server has enforced both of these since 0164/0196, but no screen had
  // ever read the rules — so the picker offered every name and the rule only
  // appeared as a red error AFTER the tap. Read them here and the picker can
  // grey the row and say why in the same breath.
  const [stashRules, setStashRules] = useState<{ irTags: string[]; taxiMaxExp: number | null; taxiLocked: boolean } | null>(null);
  const [injTags, setInjTags] = useState<Record<string, string>>({});
  useEffect(() => {
    rosterRules(leagueId).then((r) => {
      if (r.ok) setStashRules({
        irTags: r.ir_tags?.length ? r.ir_tags : ['IR', 'O'],
        taxiMaxExp: r.taxi_max_exp ?? null,
        taxiLocked: !!r.taxi_locked_now,
      });
    }).catch(() => {});
    injuryTags().then(setInjTags).catch(() => {});
  }, [leagueId]);
  /** Why this player may NOT go in that place — null when he may. The wording
   *  matches the server's refusal, because the server is still the authority
   *  and a screen that disagreed with it would be worse than one that stayed
   *  quiet. The commissioner is exempt from the taxi LOCK (a deadline) and
   *  from nothing else. */
  const stashBlock = (slug: string, spot: 'taxi' | 'ir'): string | null => {
    if (!stashRules) return null;
    if (spot === 'ir') {
      const tag = injTags[slug];
      if (!tag) return `IR is for players designated ${stashRules.irTags.join('/')} — he has no designation`;
      if (!stashRules.irTags.includes(tag)) return `IR is for players designated ${stashRules.irTags.join('/')} — he is ${tag}`;
      return null;
    }
    const mx = stashRules.taxiMaxExp;
    if (mx != null) {
      const exp = expMap[slug];
      if (exp == null) return `the taxi squad is for players with ${mx} or fewer years — his experience isn't known`;
      if (exp > mx) return `the taxi squad is for players with ${mx} or fewer years — he has ${exp}`;
    }
    if (stashRules.taxiLocked && !team?.is_commish) return 'the taxi squad locked at the season’s first kickoff — you can still take players OFF it';
    return null;
  };
  const [picking, setPicking] = useState<'team' | 'league' | null>(null);      // avatar picker target
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // null = not editing; '' = editing from empty (0187 league rename).
  const [leagueDraft, setLeagueDraft] = useState<string | null>(null);             // non-null ⇒ renaming
  const skew = useRef(0);
  // ── THE TABS (v0.296.5, founder: "let's make roster, waivers, trades tabs
  //    like in the app") ────────────────────────────────────────────────────
  // This screen was one long scroll of everything, two columns wide on a
  // desktop and a mile deep on a phone. The app has been tabbed since v0.268.0
  // on the founder's same instruction ("default to roster but all the other
  // areas need to be tabbed"), and this is the web catching up — with KEEPERS
  // as a FOURTH tab rather than a card inside ROSTER, and only where the league
  // keeps anyone.
  //
  // `focus` (0182's league-home deep link) now picks the TAB instead of
  // scrolling to a section: a tab is a destination, which is what the link
  // always meant. Nothing passes a value since v0.296.2 took the hub's
  // trades/waivers tiles out, but the prop is what makes the link still work if
  // one comes back.
  const [tab, setTab] = useState<TeamTab>(focus === 'trades' ? 'trades' : focus === 'waivers' ? 'waivers' : 'roster');
  // Contract leagues get their front office ON the team screen (v0.353.2,
  // founder: "I don't see the contract tools in the web version") — until
  // now the web's only contract surfaces were the commissioner console's
  // SALARY panel and trade retention terms.
  const [hasContracts, setHasContracts] = useState(false);
  useEffect(() => { leagueContracts(leagueId).then((c) => setHasContracts(!!c.contracts)).catch(() => {}); }, [leagueId]);
  // Keepers are a KEEPER-LEAGUE feature: no count, no tab. The card hides
  // itself the same way, but a tab that opens onto nothing is worse than a tab
  // that isn't there.
  const [keeperCount, setKeeperCount] = useState(0);

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
    let alive = true;
    refresh();
    myFavorites().then(setFavs).catch(() => {});
    playerFlags(leagueId).then((f) => { if (Array.isArray(f)) { setLeagueFlags(leagueId, f); setFlagVer((v) => v + 1); } }).catch(() => {});
    // years_exp by slug — the tenure filter's data. A failed read leaves the
    // map empty, which makes every tenure band except ANY come back empty
    // rather than wrong; the filter says so via its own count.
    leaguePoolExp(leagueId).then((m) => { if (alive) setExpMap(m); }).catch(() => {});
    leagueGameMode(leagueId).then((g) => { if (alive && g.ok) { setGm(g); setLeagueProjScoring(leagueCatalogOf(g)); } }).catch(() => {});
    keeperState(leagueId).then((k) => { if (alive && k.ok) setKeeperCount(isDynastyContinuity(k.continuity) ? 0 : (k.keeper_count ?? 0)); }).catch(() => {});
    // A drop made from the PLAYER CARD (v0.285.0) has no way to call this
    // screen — the card is a module-level overlay. It rings the bus instead,
    // so the roster updates on the click rather than on the next poll.
    const off = onRosterChanged((id2) => { if (id2 === leagueId) void refresh(); });
    const id = setInterval(refresh, 15000);
    return () => { alive = false; off(); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const poolBySlug = useMemo(() => new Map(pool.map((p) => [p.slug, p])), [pool]);
  const rostered = useMemo(() => new Set(rosters.map((r) => r.slug)), [rosters]);
  const myRoster = team?.my_roster_id ?? null;
  const mine = useMemo(() => rosters.filter((r) => r.roster_id === myRoster)
    .map((r) => { const p = poolBySlug.get(r.slug); return p ? { ...p, spot: r.spot ?? 'active' } : null; })
    .filter(Boolean) as (LeaguePoolPlayer & { spot: string })[], [rosters, myRoster, poolBySlug]);
  const cap = team?.roster_cap ?? null;
  // FULL means "no ACTIVE seat for another player" (0199), not "the roster
  // total is reached": a signing always lands active, and a taxi or IR place
  // standing empty is not a bench spot. Falls back to the total for a league
  // the server hasn't told us the seat count for.
  const seats = team?.active_seats ?? null;
  const activeHeld = mine.filter((p) => p.spot === 'active').length;
  const full = seats != null ? activeHeld >= seats : (cap != null && mine.length >= cap);

  // ── THE ROSTER, LAID OUT LIKE A ROSTER (v0.285.0) ────────────────────────
  // Was one flat list of everybody with a spot tag; now it is the shape the
  // league actually plays — a row per STARTING SPOT, then the bench, then IR,
  // then the taxi squad. The app has read this way since v0.281.0; this is the
  // web catching up, off the same `assignSpots` maximum matching, so both
  // hosts answer "who is legal where" with one implementation.
  //
  // It is NOT a submitted lineup: drip sets one per WINDOW on the board and
  // classic sets one per week, so the header says what this is rather than
  // letting the layout imply it.
  const slotDefs = useMemo(
    () => leagueSlotDefs({ roster: gm?.roster ?? {}, slots: gm?.slots ?? null }),
    [gm]);
  const slotNames = useMemo(() => slotDisplayNames(slotDefs), [slotDefs]);
  const bySpot = useMemo(() => {
    const active = mine.filter((p) => p.spot === 'active');
    const seat = assignSpots(slotDefs, active.map((p) => ({ id: p.slug, pos: p.pos, team: p.team, exp: expMap[p.slug] ?? null })));
    const find = (id?: string | null) => (id ? active.find((p) => p.slug === id) ?? null : null);
    const started = new Set(seat.spots.map((r) => r.player?.id).filter(Boolean) as string[]);
    return {
      starters: seat.spots.map((r, i) => ({ label: slotNames[i] ?? r.def.slot, pos: r.def.pos, player: find(r.player?.id) })),
      bench: active.filter((p) => !started.has(p.slug)),
      ir: mine.filter((p) => p.spot === 'ir'),
      taxi: mine.filter((p) => p.spot === 'taxi'),
    };
  }, [mine, slotDefs, slotNames, expMap]);

  /** TAXI/IR designations (0164), driven by the PLACES rather than by a cycle
   *  button on every line. The server still enforces the caps and the IR
   *  injury gate and says why not. */
  const moveToSpot = (slug: string, spot: 'active' | 'taxi' | 'ir') => {
    setFillFor(null);
    run(() => setRosterSpot(leagueId, slug, spot));
  };

  /** WHICH POSITIONS THIS LEAGUE CAN ACTUALLY ROSTER (v0.302.0, founder: "no
   *  kickers if there is no kicker spot on the roster"). Null = no restriction
   *  (drip, or a classic league with no lineup spec). Same derivation the
   *  server's 0195 pos-cap default follows, so the wire never offers a player
   *  the signing would be refused. */
  const eligiblePos = useMemo(
    () => leagueEligiblePos({ roster: gm?.roster ?? null, slots: gm?.slots ?? null }),
    [gm]);
  /** The chips actually worth offering: the league's own positions, in the
   *  canonical order. A league that can't roster a kicker doesn't get a K chip
   *  that would only ever return nothing. */
  const posChips = useMemo(
    () => POS_FILTERS.filter((p) => p !== 'ALL' && (!eligiblePos || eligiblePos.has(p))),
    [eligiblePos]);
  const free = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = pool.filter((p) => !rostered.has(p.slug)
      // No selection = every position the LEAGUE can roster, not every
      // position there is. Picking chips narrows within that.
      && (posSel.size ? posSel.has(p.pos) : (!eligiblePos || eligiblePos.has(p.pos.toUpperCase())))
      && (nflTeam === 'ALL' || p.team.toUpperCase() === nflTeam)
      // Unknown tenure matches no band but ANY — the pool's no-guess rule,
      // the same one a 0172 rookies-only spot follows.
      && tenureMatches(tenure, expMap[p.slug] ?? null, p.pos)
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
    return sortPool(starApply(base, starMode, favs, (p) => p.slug), sortBy, own);
  }, [pool, rostered, q, posSel, eligiblePos, nflTeam, tenure, expMap, starMode, favs, sortBy, own]);
  /** The teams actually IN this pool, so the picker never offers an empty
   *  filter — a league whose pool is one conference should not list 32. */
  const poolTeams = useMemo(
    () => [...new Set(pool.map((p) => p.team.toUpperCase()).filter(Boolean))].sort(),
    [pool]);

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
    try {
      const r = await fn();
      if (!r.ok) setErr(friendlyError(r.error ?? 'That didn’t work.')); else notifyRosterChanged(leagueId);
      await refresh();
    }
    catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const doAdd = (p: LeaguePoolPlayer, dropSlug?: string) => {
    if (myRoster == null) return;
    setPendingAdd(null);
    const onWaivers = waivedFor(p) != null;
    // FAAB league: a claim carries a blind bid — ask for it first.
    if (onWaivers && team?.waiver_mode === 'faab') { setClaimFor({ p, drop: dropSlug }); setBidDraft(''); return; }
    return run(() => onWaivers
      ? submitWaiverClaim(leagueId, myRoster, p.slug, dropSlug)
      : addFreeAgent(leagueId, myRoster, p.slug, dropSlug));
  };
  const submitClaimBid = () => {
    if (myRoster == null || !claimFor) return;
    const bid = Math.max(0, parseInt(bidDraft || '0', 10) || 0);
    const { p, drop } = claimFor;
    setClaimFor(null); setBidDraft('');
    run(() => submitWaiverClaim(leagueId, myRoster, p.slug, drop, bid));
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
      {/* THE LEAGUE'S OWN NAME (0187, founder). The crest has been settable
          from this card for ages; the name had no setter anywhere, so a typo
          at creation was permanent for every member. Commissioner only — the
          RPC re-checks that, this just decides who is offered the pencil. */}
      {team.is_commish && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
          {leagueDraft === null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)' }}>LEAGUE ⚑</span>
              <button onClick={() => setLeagueDraft('')} className="mono" style={linkBtn}>✎ rename the league</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={leagueDraft} autoFocus maxLength={60} placeholder="league name"
                onChange={(e) => setLeagueDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && leagueDraft.trim().length >= 2) { run(() => setLeagueName(leagueId, leagueDraft)); setLeagueDraft(null); }
                  if (e.key === 'Escape') setLeagueDraft(null);
                }}
                style={{ ...input, padding: '7px 10px', fontSize: 13, flex: 1, minWidth: 160 }} />
              <button onClick={() => { if (leagueDraft.trim().length >= 2) run(() => setLeagueName(leagueId, leagueDraft)); setLeagueDraft(null); }}
                disabled={busy || leagueDraft.trim().length < 2} className="mono" style={{ ...btn, padding: '7px 12px', fontSize: 10 }}>SAVE</button>
              <button onClick={() => setLeagueDraft(null)} className="mono" style={linkBtn}>cancel</button>
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', flexBasis: '100%' }}>
                2–60 characters — everyone in the league sees it.
              </span>
            </div>
          )}
        </div>
      )}
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
      {/* NO NOTIFICATION SETTINGS HERE (v0.296.5, founder: "the notification
          settings can get removed because they are already in the league home
          tab"). 🔔 Alerts is a tile on the league menu on both hosts — the app
          has never carried a second copy on MY TEAM, and two editors for one
          set of per-device prefs is one too many. */}
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

      {/* NO NOTIFICATION SETTINGS HERE (v0.296.5, founder: "the notification
          settings can get removed because they are already in the league home
          tab"). 🔔 Alerts is a tile on the league menu on both hosts — the app
          has never carried a second copy on MY TEAM, and two editors for one
          set of per-device prefs is one too many. */}
      {identityCard}

      {/* over-limit lockout: no adds/claims/weekly lineups until legal */}
      {team.roster_issue && (
        <div style={{ ...card, marginBottom: 12, borderLeft: '3px solid var(--opp)' }}>
          <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--opp)' }}>⚠ Roster over its limits</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>
            {team.roster_issue}. Adds, waiver claims, and weekly lineups are locked until your roster is legal — drops (and trades that get you legal) always work.
          </div>
        </div>
      )}

      {/* ONE AREA AT A TIME. Identity and the over-limit warning stay above the
          tabs, exactly as on the app: who you are and what's broken outrank any
          tab you happen to be standing in. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {([
          ['roster', '🧢 ROSTER'],
          ['waivers', `✚ WAIVERS${pendingClaims.length ? ` (${pendingClaims.length})` : ''}`],
          ['trades', '⇄ TRADES'],
          ...(hasContracts ? [['contracts', '📜 CONTRACTS'] as const] : []),
          ...(keeperCount > 0 ? [['keepers', '★ KEEPERS'] as const] : []),
        ] as const).map(([id, label]) => (
          <Chip key={id} on={tab === id} onClick={() => setTab(id)}>{label}</Chip>
        ))}
      </div>

      {/* contracts — the front office on the team screen: lengths while the
          room is open, tags/extensions/RFA in the offseason, every team's
          payroll. Mirrors the app's MY TEAM tab. */}
      {tab === 'contracts' && (
        <CapSheet leagueId={leagueId} myRoster={myRoster} isCommish={!!team.is_commish} />
      )}

      {/* my roster */}
      {tab === 'roster' && (
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

        {/* STARTERS — one row per starting spot the league plays, filled by
            assignSpots. Labelled as the FIT, not the lineup. */}
        {mine.length > 0 && slotDefs.length > 0 && (<>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: 1, marginTop: 10 }}>
            STARTING SPOTS <span style={{ letterSpacing: 0 }}>— how your roster fits; set the lineup on the board</span>
          </div>
          {bySpot.starters.map((r, i) => (
            <RosterLine key={`spot-${i}`} badge={r.label} badgePos={r.pos[0]} p={r.player} busy={busy} />
          ))}
        </>)}

        {/* BENCH */}
        {bySpot.bench.length > 0 && (<>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: 1, marginTop: 14 }}>BENCH ({bySpot.bench.length})</div>
          {bySpot.bench.map((p) => <RosterLine key={p.slug} badge="BN" p={p} busy={busy} />)}
        </>)}

        {/* INJURED RESERVE — the empty places are drawn too, up to the
            league's limit: "you have two more" is what a manager wants here,
            and an absent row cannot say it. */}
        {(bySpot.ir.length > 0 || !!gm?.shape?.ir) && (<>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: 1, marginTop: 14 }}>
            INJURED RESERVE ({bySpot.ir.length}{gm?.shape?.ir ? `/${gm.shape.ir}` : ''})
          </div>
          {bySpot.ir.map((p) => (
            <RosterLine key={p.slug} badge="IR" tone="var(--warn)" p={p} busy={busy} onSlot={() => moveToSpot(p.slug, 'active')} />
          ))}
          {Array.from({ length: Math.max(0, (gm?.shape?.ir ?? 0) - bySpot.ir.length) }, (_, i) => (
            <RosterLine key={`ir-empty-${i}`} badge="IR" tone="var(--warn)" p={null} busy={busy}
              slotVerb="injured reserve" onSlot={() => setFillFor('ir')} />
          ))}
        </>)}

        {/* TAXI SQUAD */}
        {(bySpot.taxi.length > 0 || !!gm?.shape?.taxi) && (<>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: 1, marginTop: 14 }}>
            TAXI SQUAD ({bySpot.taxi.length}{gm?.shape?.taxi ? `/${gm.shape.taxi}` : ''})
          </div>
          {bySpot.taxi.map((p) => (
            <RosterLine key={p.slug} badge="TX" tone="var(--you)" p={p} busy={busy} onSlot={() => moveToSpot(p.slug, 'active')} />
          ))}
          {Array.from({ length: Math.max(0, (gm?.shape?.taxi ?? 0) - bySpot.taxi.length) }, (_, i) => (
            <RosterLine key={`tx-empty-${i}`} badge="TX" tone="var(--you)" p={null} busy={busy}
              slotVerb="taxi squad" onSlot={() => setFillFor('taxi')} />
          ))}
        </>)}

        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>
          Click a name to open his card — that's where you drop him. Dropped players sit on waivers for 24h (claims beat first-come). Roster changes apply from the next unlocked week — a week already underway keeps its lineup pool.
        </div>
      </div>

      )}

      {/* KEEPERS (0182) — its own tab now (founder), and only in a league that
          keeps anyone. It was a card under the roster, which is where you look
          for it in the two weeks a year it matters and where it is noise for
          the other fifty. */}
      {tab === 'keepers' && myRoster != null && <KeepersCard leagueId={leagueId} myRoster={myRoster} mine={mine} />}

      {tab === 'waivers' && (<>
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
              {team.waiver_mode === 'faab' && <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--you)' }}>${c.bid ?? 0}</span>}
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

      {/* the wire and the order, side by side on a desktop and stacked on a
          phone — both answer "who can I get, and when do I get to". */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 380px', minWidth: 300 }}>
      {/* free agents / waiver wire */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={hdr}>
          PLAYER POOL ({free.length} available)
          {team.waiver_mode === 'faab' && team.my_faab != null ? ` · 💰 FAAB $${team.my_faab}` : ''}
          {team.fa_open === false && team.fa_start_min != null ? ` · 🔒 FA opens ${fmtEtMin(team.fa_start_min)} ET` : ''}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players or teams…" style={{ ...input, marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <Chip on={posSel.size === 0} onClick={() => setPosSel(new Set())}>ALL</Chip>
          {posChips.map((p) => (
            <Chip key={p} on={posSel.has(p)}
              onClick={() => setPosSel((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n; })}>{posLabel(p)}</Chip>
          ))}
          <StarChips mode={starMode} setMode={setStarMode} />
        </div>
        {/* THE ORDER (v0.302.0). Rank is what the draft clock follows, so it
            stays the default; the other three answer questions rank can't. */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>SORT</span>
          {POOL_SORTS.map((o) => (
            <Chip key={o.id} on={sortBy === o.id} onClick={() => setSortBy(o.id)} title={o.hint}>{o.label}</Chip>
          ))}
        </div>
        {/* Tenure + NFL team (founder). Tenure is BANDS rather than a number
            box: nobody searches for "exactly 6 accrued seasons", they want
            rookies or veterans, and ROOKIES is the first band rather than a
            separate toggle so two controls can never disagree about who is
            one. The team list comes from the POOL, not a hardcoded 32. */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {TENURE_BANDS.map((b) => (
            <Chip key={b.id} on={tenure === b.id} onClick={() => setTenure(b.id)}>{b.short}</Chip>
          ))}
          <select value={nflTeam} onChange={(e) => setNflTeam(e.target.value)} className="mono"
            style={{ fontSize: 10, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 999, padding: '5px 8px' }}>
            <option value="ALL">ALL NFL TEAMS</option>
            {poolTeams.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
          </select>
          {(tenure !== 'any' || nflTeam !== 'ALL') && (
            <button onClick={() => { setTenure('any'); setNflTeam('ALL'); }} className="mono"
              style={{ ...linkBtn, fontSize: 9.5, color: 'var(--you)' }}>✕ CLEAR</button>
          )}
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {free.slice(0, 100).map((p) => {
            const left = waivedFor(p);
            return (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
                {/* The leading number is whatever the list is SORTED BY, so
                    the order is always legible: a list ordered by projection
                    that still printed ranks would look shuffled. */}
                <span className="mono" style={{ fontSize: 9, color: sortBy === 'rank' ? 'var(--faint)' : 'var(--you)', width: 38, textAlign: 'right' }}
                  title={POOL_SORTS.find((o) => o.id === sortBy)?.hint}>{poolSortValue(sortBy, p, own ?? undefined)}</span>
                <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />
                <PosPill pos={p.pos as Pos} />
                <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{starMark(favs, p.slug)}{p.full_name}</span>
                <FlagChip slug={p.slug} />
                {left != null && <span className="mono" style={{ fontSize: 8.5, color: 'var(--warn)' }} title="on waivers">⏳ {fmtLeft(left)}</span>}
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', width: 34 }}>{p.team}</span>
                {(() => {
                  // over-limit rosters are locked out; the FA window gates instant adds only
                  const blocked = !!team.roster_issue || (left == null && team.fa_open === false);
                  return (
                    <button onClick={() => addOrClaim(p)} disabled={busy || myRoster == null || blocked} className="mono"
                      title={team.roster_issue ? 'roster over its limits — drop players first'
                        : left == null && team.fa_open === false ? 'free agency is closed right now' : undefined}
                      style={{ ...btn, padding: '6px 10px', fontSize: 10, opacity: busy || myRoster == null || blocked ? 0.4 : 1 }}>
                      {left != null ? 'CLAIM' : 'ADD'}
                    </button>
                  );
                })()}
              </div>
            );
          })}
          {free.length > 100 && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', padding: '8px 0' }}>…{free.length - 100} more — narrow the search.</div>}
        </div>
      </div>

      </div>

      {/* waiver order */}
      <div style={{ flex: '1 1 260px', minWidth: 240 }}>
      <div style={card}>
        <div style={hdr}>WAIVER ORDER</div>
        {[...team.waiver_order].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map((w, i) => (
          <div key={w.roster_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', width: 16 }}>{i + 1}</span>
            <Avatar name={w.team ?? `Team ${w.roster_id}`} src={w.avatar} size={20} />
            <span style={{ fontSize: 12, color: w.roster_id === myRoster ? 'var(--you)' : 'var(--text)', fontWeight: w.roster_id === myRoster ? 700 : 400, flex: 1 }}>
              {w.team ?? `Team ${w.roster_id}`}
            </span>
            {team.waiver_mode === 'faab' && w.faab != null && (
              <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--dim)' }}>${w.faab}</span>
            )}
          </div>
        ))}
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          {team.waiver_mode === 'faab'
            ? 'FAAB: claims carry blind bids from your season budget — highest bid wins, the order above only breaks ties. Winners still rotate to the back.'
            : 'Winning a claim sends you to the back of the line.'}
          {team.waiver_clear_min != null && ` Waivers clear daily at ${fmtEtMin(team.waiver_clear_min)} ET (${team.waiver_hold_days ?? 1}-day hold).`}
        </div>
      </div>

      </div>
      </div>{/* /wire + order row */}
      </>)}

      {tab === 'trades' && (
        <TradeCenter leagueId={leagueId} myRoster={myRoster} teams={team.waiver_order}
          rosters={rosters} poolBySlug={poolBySlug} tradeReview={team.trade_review} onChanged={refresh} />
      )}

      {pickers}

      {/* FAAB claim → collect the blind bid */}
      {claimFor && (
        <div onClick={() => setClaimFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 360 }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Claim {claimFor.p.full_name}</div>
            {claimFor.drop && (
              <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 6 }}>dropping {poolBySlug.get(claimFor.drop)?.full_name ?? claimFor.drop}</div>
            )}
            <div className="mono" style={{ ...label, marginTop: 12 }}>BLIND BID — YOU HAVE ${team.my_faab ?? 0}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <input value={bidDraft} autoFocus inputMode="numeric" placeholder="$0"
                onChange={(e) => setBidDraft(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') submitClaimBid(); }}
                style={{ ...input, width: 110 }} />
              <button onClick={submitClaimBid} disabled={busy} className="mono" style={{ ...btn, flex: 1 }}>SUBMIT CLAIM</button>
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>
              Highest bid wins when waivers clear; only the winner pays. $0 is a legal bid.
            </div>
            <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={() => setClaimFor(null)} className="mono" style={linkBtn}>cancel</button></div>
          </div>
        </div>
      )}

      {/* roster full → choose a drop for the pending add */}
      {/* AN EMPTY TAXI / IR PLACE, ASKING WHO GOES IN IT (v0.285.0) — the
          picker offers the ACTIVE roster only. A player already on IR or the
          taxi squad isn't a candidate for the other: send him back to active
          first (click his badge), which keeps every move one legal step the
          server can answer for rather than a silent two-step. */}
      {fillFor && (
        <div onClick={() => setFillFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 400, maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {fillFor === 'ir' ? 'Move to injured reserve' : 'Move to the taxi squad'}
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>
              {fillFor === 'ir'
                ? `IR holds players designated ${(stashRules?.irTags ?? ['IR', 'O']).join('/')} by the injury report — your commissioner sets that list. Everyone else is greyed out below.`
                : stashRules?.taxiMaxExp != null
                  ? `The taxi squad holds prospects off your active roster — your commissioner limits it to ${stashRules.taxiMaxExp} year${stashRules.taxiMaxExp === 1 ? '' : 's'} of experience or fewer. He can’t be started while he’s on it.`
                  : 'The taxi squad holds prospects off your active roster. He can’t be started while he’s on it.'}
            </div>
            {mine.filter((p) => p.spot === 'active').length === 0 && (
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 10 }}>Nobody on your active roster to move.</div>
            )}
            {mine.filter((p) => p.spot === 'active').map((p) => {
              // Ineligible names stay VISIBLE and greyed rather than vanishing:
              // "why isn't he in the list" is a worse question than "why is he
              // greyed out", and the answer is printed right beside him.
              const why = stashBlock(p.slug, fillFor);
              return (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--bd)', marginTop: 6, opacity: why ? 0.45 : 1, flexWrap: 'wrap' }}>
                <PlayerImg playerId={p.slug} espnId={p.espn_id} team={p.team} pos={p.pos as Pos} size={24} />
                <PosPill pos={p.pos as Pos} />
                <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>
                {fillFor === 'ir' && injTags[p.slug] && (
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--warn)' }}>{injTags[p.slug]}</span>
                )}
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{p.team}</span>
                <button onClick={() => moveToSpot(p.slug, fillFor)} disabled={busy || !!why} title={why ?? ''} className="mono"
                  style={{ ...ghostBtn, padding: '5px 10px', fontSize: 9.5, color: why ? 'var(--faint)' : 'var(--you)', cursor: why ? 'not-allowed' : 'pointer' }}>{fillFor === 'ir' ? '→IR' : '→TX'}</button>
                {why && <span className="mono" style={{ flexBasis: '100%', fontSize: 9.5, color: 'var(--faint)', lineHeight: 1.4 }}>{why}</span>}
              </div>
              );
            })}
            <div style={{ textAlign: 'center', marginTop: 12 }}><button onClick={() => setFillFor(null)} className="mono" style={linkBtn}>cancel</button></div>
          </div>
        </div>
      )}

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

// ─────────────────────────────────────────────────────────────────────────────
// Trade center — propose, answer, and follow trades (0072). Executions apply
// instantly unless the league routes accepted trades through the commissioner.
// ─────────────────────────────────────────────────────────────────────────────
function TradeCenter({ leagueId, myRoster, teams, rosters, poolBySlug, tradeReview, onChanged }: {
  leagueId: string; myRoster: number | null;
  teams: { roster_id: number; team: string | null }[];
  rosters: { roster_id: number; slug: string }[];
  poolBySlug: Map<string, LeaguePoolPlayer>;
  tradeReview?: 'none' | 'commish';
  onChanged: () => void;
}) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [signals, setSignals] = useState<TradeSignalRow[]>([]);
  const [assets, setAssets] = useState<PickAssetRow[]>([]);          // tradeable picks: futures (0183) + startup slots (0190)
  const [pickTradingOn, setPickTradingOn] = useState(true);          // the commissioner's switch (0190)
  const [blockEdit, setBlockEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [partner, setPartner] = useState<number | null>(null);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [givePicks, setGivePicks] = useState<PickAssetRow[]>([]);
  const [getPicks, setGetPicks] = useState<PickAssetRow[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Contract leagues (0219): salary terms an offer can carry — retention per
  // traded slug, and cap dollars (+ = I send room, − = I ask for room).
  const [contracts, setContracts] = useState<LeagueContracts | null>(null);
  const [retain, setRetain] = useState<Record<string, number>>({});
  const [capDraft, setCapDraft] = useState('');
  const [capDir, setCapDir] = useState<1 | -1>(1);

  const load = () => Promise.all([
    leagueTrades(leagueId).then((t) => { if (Array.isArray(t)) setTrades(t); }),
    tradeSignals(leagueId).then((s) => { if (Array.isArray(s)) setSignals(s); }),
    leagueContracts(leagueId).then((c) => setContracts(c.contracts ? c : null)).catch(() => {}),
    pickAssets(leagueId).then((a) => {
      if (!a.ok) return;
      setPickTradingOn(a.pick_trading !== false);
      // FUTURE picks (dynasty holds a 3-year horizon, 0185) — and since 0190
      // THIS season's slots too. The draft in front of you used to be the one
      // draft whose picks you couldn't deal; now a startup slot is an asset
      // like any other, which is also what makes a MIXED offer work — the two
      // kinds are rows in one list and one trade carries both.
      setAssets(a.picks.filter((p) =>
        (a.future_season != null && p.season >= a.future_season) || p.kind === 'startup'));
    }),
  ]).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const teamName = (rid: number) => teams.find((t) => t.roster_id === rid)?.team ?? `Team ${rid}`;
  const pname = (s: string) => poolBySlug.get(s)?.full_name ?? s;
  const toggle = (list: string[], set: (v: string[]) => void, slug: string) =>
    set(list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);
  const samePick = (a: PickAssetRow, b: PickAssetRow) =>
    a.season === b.season && a.round === b.round && a.orig === b.orig;
  const togglePick = (list: PickAssetRow[], set: (v: PickAssetRow[]) => void, p: PickAssetRow) =>
    set(list.some((x) => samePick(x, p)) ? list.filter((x) => !samePick(x, p)) : [...list, p]);
  /** "2027 R1" — plus whose original slot it is when it was acquired. A startup
   *  slot says DRAFT rather than a season, because "2026 R1" beside "2027 R1"
   *  reads as two future picks when one is a slot in the draft running now. */
  const pickLabel = (p: { season: string; round: number; orig: number; kind?: string }, holder: number) =>
    `${p.kind === 'startup' ? 'DRAFT' : p.season} R${p.round}${p.orig !== holder ? ` (${teamName(p.orig)}’s slot)` : ''}`;
  const tradeLine = (t: TradeRow, side: 'give' | 'get') => {
    const slugs = (side === 'give' ? t.give : t.get).map(pname);
    const rid = side === 'give' ? t.from_roster : t.to_roster;
    const picks = ((side === 'give' ? t.give_picks : t.get_picks) ?? []).map((p) => `⛏ ${pickLabel(p, rid)}`);
    return [...slugs, ...picks].join(', ') || '—';
  };

  // Standing signals (0140): the shared block and the interest marks. All
  // league-visible; the server already filtered out anything stale.
  const blocks = signals.filter((s) => s.kind === 'block');
  const wants = signals.filter((s) => s.kind === 'want');
  const myBlocked = new Set(blocks.filter((s) => s.roster_id === myRoster).map((s) => s.slug));
  const myWants = new Set(wants.filter((s) => s.roster_id === myRoster).map((s) => s.slug));
  const wantCount = (slug: string) => wants.filter((w) => w.slug === slug).length;
  const interestInMine = wants.filter((w) => w.holder_roster === myRoster);
  const toggleSignal = (slug: string, kind: 'block' | 'want', on: boolean) => {
    if (myRoster != null) act(() => setTradeSignal(leagueId, myRoster, slug, kind, on));
  };
  // A signal's natural next step is an offer: open the propose modal already
  // pointed at the right team with the right player checked.
  const openPreset = (partnerRid: number, giveSlugs: string[], getSlugs: string[]) => {
    setPartner(partnerRid); setGive(giveSlugs); setGet(getSlugs);
    setGivePicks([]); setGetPicks([]); setErr(null); setOpen(true);
  };

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (!r.ok) setErr(friendlyError(r.error ?? 'That didn’t work.'));
      await load(); onChanged();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const capDollars = (parseInt(capDraft, 10) || 0) * capDir;
  const propose = async () => {
    if (busy || myRoster == null || partner == null
        || give.length + get.length + givePicks.length + getPicks.length + Math.abs(capDollars) === 0) return;
    setBusy(true); setErr(null);
    try {
      const retainTerms = [...give, ...get]
        .filter((s) => (retain[s] ?? 0) > 0)
        .map((s) => ({ slug: s, amount: retain[s] }));
      const r = await proposeTrade(leagueId, myRoster, partner, give, get, note.trim() || undefined,
        givePicks.map((p) => ({ season: p.season, round: p.round, orig: p.orig })),
        getPicks.map((p) => ({ season: p.season, round: p.round, orig: p.orig })),
        retainTerms, capDollars || undefined);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not propose the trade.')); return; }
      setOpen(false); setPartner(null); setGive([]); setGet([]); setGivePicks([]); setGetPicks([]); setNote('');
      setRetain({}); setCapDraft(''); setCapDir(1);
      await load();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const statusChip = (t: TradeRow) => {
    const [label, color] =
      t.status === 'pending' ? ['OFFERED', 'var(--warn)']
      : t.status === 'accepted' ? ['AWAITING COMMISH', 'var(--warn)']
      : t.status === 'executed' ? ['EXECUTED', 'var(--you)']
      : t.status === 'vetoed' ? ['VETOED', 'var(--opp)']
      : [t.status.toUpperCase(), 'var(--faint)'];
    return <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color, border: `1px solid ${color}`, borderRadius: 3, padding: '2px 5px', whiteSpace: 'nowrap' }}>{label}</span>;
  };
  const shown = trades.slice(0, 8);
  // A side's tradeable draft picks (0183), below its player list. Renders
  // nothing until the commissioner provisions rookie rounds.
  const pickAssetList = (rid: number | null, sel: PickAssetRow[], set: (v: PickAssetRow[]) => void) => {
    // Nothing at all when the commissioner has the switch off — better than
    // offering picks the server will refuse on submit.
    if (!pickTradingOn) return null;
    const owned = assets.filter((a) => a.owner === rid);
    if (owned.length === 0) return null;
    return (
      <div style={{ marginTop: 6, border: '1px solid var(--bd)', borderRadius: 6, padding: 6 }}>
        <div className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--faint)', fontWeight: 700, marginBottom: 3 }}>⛏ DRAFT PICKS</div>
        {owned.map((a) => {
          const on = sel.some((x) => samePick(x, a));
          return (
            <button key={`${a.season}:${a.round}:${a.orig}`} onClick={() => togglePick(sel, set, a)} className="mono"
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', background: on ? 'color-mix(in srgb, var(--you) 14%, transparent)' : 'none', border: 'none', borderRadius: 4, padding: '4px 5px', cursor: 'pointer' }}>
              <span style={{ fontSize: 11, color: on ? 'var(--you)' : 'var(--text)', fontWeight: on ? 700 : 400 }}>
                {on ? '☑' : '☐'} {pickLabel(a, a.owner)}
              </span>
            </button>
          );
        })}
      </div>
    );
  };
  // wantable: the partner's list — each row grows a 👀 mark-interest toggle, so
  // browsing a roster mid-propose doubles as scouting (close without sending
  // and the marks stand).
  const pickList = (rid: number | null, sel: string[], set: (v: string[]) => void, wantable = false) => (
    <div style={{ flex: '1 1 150px', minWidth: 140, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--bd)', borderRadius: 6, padding: 6 }}>
      {rosters.filter((r) => r.roster_id === rid).map((r) => {
        const p = poolBySlug.get(r.slug);
        const on = sel.includes(r.slug);
        return (
          <button key={r.slug} onClick={() => toggle(sel, set, r.slug)} className="mono"
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', background: on ? 'color-mix(in srgb, var(--you) 14%, transparent)' : 'none', border: 'none', borderRadius: 4, padding: '4px 5px', cursor: 'pointer' }}>
            <span style={{ fontSize: 11, color: on ? 'var(--you)' : 'var(--text)', fontWeight: on ? 700 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{on ? '☑' : '☐'} {p?.full_name ?? r.slug}</span>
            <span style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p?.pos}</span>
            {wantable && myRoster != null && (
              <span onClick={(e) => { e.stopPropagation(); toggleSignal(r.slug, 'want', !myWants.has(r.slug)); }}
                title={myWants.has(r.slug) ? 'remove your interest mark' : 'mark trade interest — the league sees it'}
                style={{ fontSize: 11, opacity: myWants.has(r.slug) ? 1 : 0.35 }}>👀</span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={hdr}>TRADES{tradeReview === 'commish' ? ' · commish reviews' : ''}</div>
        {myRoster != null && (
          <button onClick={() => { setOpen(true); setErr(null); }} className="mono" style={{ ...ghostBtn, padding: '6px 10px', fontSize: 9.5 }}>＋ PROPOSE</button>
        )}
      </div>
      {err && <div className="mono" style={{ ...errStyle, marginTop: 0, marginBottom: 8 }}>{err}</div>}
      {shown.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>No trades yet — send the first offer.</div>}
      {shown.map((t) => (
        <div key={t.id} style={{ padding: '7px 0', borderTop: '1px solid var(--bd)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 180, lineHeight: 1.5 }}>
              <b style={{ color: t.from_roster === myRoster ? 'var(--you)' : 'var(--text)' }}>{teamName(t.from_roster)}</b>
              {' '}sends {tradeLine(t, 'give')} ·{' '}
              <b style={{ color: t.to_roster === myRoster ? 'var(--you)' : 'var(--text)' }}>{teamName(t.to_roster)}</b>
              {' '}sends {tradeLine(t, 'get')}
            </span>
            {statusChip(t)}
          </div>
          {/* salary terms ride the row so the accepting side SEES the money */}
          {(t.retain ?? []).length > 0 && (
            <div className="mono" style={{ fontSize: 9, color: 'var(--warn)', marginTop: 3 }}>
              {(t.retain ?? []).map((r) => `💸 ${teamName(r.roster)} retains $${r.amount} on ${pname(r.slug)}`).join(' · ')}
            </div>
          )}
          {!!t.cap_dollars && (
            <div className="mono" style={{ fontSize: 9, color: 'var(--warn)', marginTop: 3 }}>
              💵 {teamName(t.cap_dollars > 0 ? t.from_roster : t.to_roster)} sends ${Math.abs(t.cap_dollars)} of cap room
            </div>
          )}
          {t.note && <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 3 }}>“{t.note}”</div>}
          {(t.status === 'pending' || t.status === 'accepted') && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {t.status === 'pending' && t.to_roster === myRoster && <>
                <button onClick={() => act(() => respondTrade(t.id, true))} disabled={busy} className="mono" style={{ ...btn, padding: '6px 12px', fontSize: 9.5 }}>✓ ACCEPT</button>
                <button onClick={() => act(() => respondTrade(t.id, false))} disabled={busy} className="mono" style={{ ...ghostBtn, padding: '6px 12px', fontSize: 9.5, color: 'var(--opp)' }}>✕ DECLINE</button>
              </>}
              {t.from_roster === myRoster && (
                <button onClick={() => act(() => cancelTrade(t.id))} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>withdraw</button>
              )}
            </div>
          )}
        </div>
      ))}

      {/* THE TRADE BLOCK — standing "I'd listen on this player" flags (0140).
          Every member sees the whole block; the 👀 count shows a shopped
          player's market before anyone commits to an offer. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
        <div style={{ ...hdr, marginBottom: 0 }}>🔁 TRADE BLOCK</div>
        {myRoster != null && (
          <button onClick={() => setBlockEdit((v) => !v)} className="mono" style={{ ...ghostBtn, padding: '5px 9px', fontSize: 9 }}>
            {blockEdit ? '✓ DONE' : '✎ SHOP MY PLAYERS'}
          </button>
        )}
      </div>
      {blockEdit && myRoster != null && (
        <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--bd)', borderRadius: 6, padding: 6, marginTop: 7 }}>
          {rosters.filter((r) => r.roster_id === myRoster).map((r) => {
            const p = poolBySlug.get(r.slug);
            const on = myBlocked.has(r.slug);
            return (
              <button key={r.slug} onClick={() => toggleSignal(r.slug, 'block', !on)} disabled={busy} className="mono"
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', background: on ? 'color-mix(in srgb, var(--warn) 14%, transparent)' : 'none', border: 'none', borderRadius: 4, padding: '4px 5px', cursor: 'pointer' }}>
                <span style={{ fontSize: 11, color: on ? 'var(--warn)' : 'var(--text)', fontWeight: on ? 700 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{on ? '🔁' : '☐'} {p?.full_name ?? r.slug}</span>
                <span style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p?.pos}{on ? ' · ON THE BLOCK' : ''}</span>
              </button>
            );
          })}
        </div>
      )}
      {blocks.length === 0 && !blockEdit && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
          Nobody is shopping anyone yet. Put a player on the block and the whole league sees it here.
        </div>
      )}
      {blocks.map((s) => {
        const p = poolBySlug.get(s.slug);
        const mineRow = s.roster_id === myRoster;
        const n = wantCount(s.slug);
        return (
          <div key={`blk-${s.roster_id}-${s.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)', marginTop: 5 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <b>{pname(s.slug)}</b>
              <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}> {p?.pos} · {mineRow ? 'your player' : teamName(s.roster_id)}</span>
            </span>
            {n > 0 && <span className="mono" title={`${n} team${n === 1 ? '' : 's'} interested`} style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--you)' }}>👀 {n}</span>}
            {mineRow
              ? <button onClick={() => toggleSignal(s.slug, 'block', false)} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>✕ off the block</button>
              : myRoster != null && <>
                  <button onClick={() => toggleSignal(s.slug, 'want', !myWants.has(s.slug))} disabled={busy}
                    title={myWants.has(s.slug) ? 'remove your interest mark' : 'mark trade interest — the league sees it'}
                    className="mono" style={{ ...linkBtn, color: myWants.has(s.slug) ? 'var(--you)' : 'var(--faint)' }}>
                    👀 {myWants.has(s.slug) ? 'interested ✓' : 'interested?'}
                  </button>
                  <button onClick={() => openPreset(s.roster_id, [], [s.slug])} className="mono" style={{ ...ghostBtn, padding: '5px 9px', fontSize: 9 }}>⇄ OFFER</button>
                </>}
          </div>
        );
      })}

      {/* INTEREST — who's eyeing whom. Your players with suitors float first;
          your own marks follow, each one tap from a real offer. */}
      {(interestInMine.length > 0 || myWants.size > 0) && (
        <>
          <div style={{ ...hdr, marginTop: 14, marginBottom: 0 }}>👀 TRADE INTEREST</div>
          {interestInMine.map((w) => (
            <div key={`in-${w.roster_id}-${w.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)', marginTop: 5 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 0 }}>
                <b style={{ color: 'var(--you)' }}>{teamName(w.roster_id)}</b> is interested in your <b>{pname(w.slug)}</b>
              </span>
              {myRoster != null && (
                <button onClick={() => openPreset(w.roster_id, [w.slug], [])} className="mono" style={{ ...ghostBtn, padding: '5px 9px', fontSize: 9 }}>⇄ TALK</button>
              )}
            </div>
          ))}
          {wants.filter((w) => w.roster_id === myRoster).map((w) => (
            <div key={`my-${w.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)', marginTop: 5 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 0 }}>
                You 👀 <b>{pname(w.slug)}</b>
                <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}> ({teamName(w.holder_roster)})</span>
              </span>
              <button onClick={() => toggleSignal(w.slug, 'want', false)} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>✕</button>
              <button onClick={() => openPreset(w.holder_roster, [], [w.slug])} className="mono" style={{ ...ghostBtn, padding: '5px 9px', fontSize: 9 }}>⇄ OFFER</button>
            </div>
          ))}
        </>
      )}

      {open && myRoster != null && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 460, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Propose a trade</div>
            <div className="mono" style={{ ...label, marginTop: 12 }}>TRADE WITH</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
              {teams.filter((t) => t.roster_id !== myRoster).map((t) => (
                <Chip key={t.roster_id} on={partner === t.roster_id} onClick={() => { setPartner(t.roster_id); setGet([]); }}>
                  {t.team ?? `Team ${t.roster_id}`}
                </Chip>
              ))}
            </div>
            {partner != null && (
              <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                  <div className="mono" style={{ ...label, marginBottom: 5 }}>YOU SEND</div>
                  {pickList(myRoster, give, setGive)}
                  {pickAssetList(myRoster, givePicks, setGivePicks)}
                </div>
                <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                  <div className="mono" style={{ ...label, marginBottom: 5 }}>YOU GET</div>
                  {pickList(partner, get, setGet, true)}
                  {pickAssetList(partner, getPicks, setGetPicks)}
                </div>
              </div>
            )}
            {/* ── SALARY TERMS (0219, contract leagues) ── */}
            {contracts?.rules?.retention && [...give, ...get].some((s) => (contracts.deals ?? []).some((d) => d.slug === s && d.salary > 1)) && (
              <div style={{ marginTop: 12, border: '1px solid var(--bd)', borderRadius: 6, padding: 8 }}>
                <div className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--faint)', fontWeight: 700 }}>💸 RETAINED SALARY — the sender keeps eating this much</div>
                {[...give, ...get].map((s) => {
                  const d = (contracts.deals ?? []).find((x) => x.slug === s);
                  if (!d || d.salary <= 1) return null;
                  const maxR = d.salary - 1 - (d.retained ?? 0);
                  if (maxR < 1) return null;
                  const cur = retain[s] ?? 0;
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text)' }}>
                        {pname(s)} <span style={{ color: 'var(--dim)', fontSize: 10 }}>${d.salary}·{d.years}yr</span>
                      </span>
                      <button onClick={() => setRetain((r) => ({ ...r, [s]: Math.max(0, cur - 1) }))} disabled={cur <= 0} className="mono" style={{ ...ghostBtn, padding: '2px 8px' }}>−</button>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, minWidth: 30, textAlign: 'center', color: cur > 0 ? 'var(--warn)' : 'var(--faint)' }}>${cur}</span>
                      <button onClick={() => setRetain((r) => ({ ...r, [s]: Math.min(maxR, cur + 1) }))} disabled={cur >= maxR} className="mono" style={{ ...ghostBtn, padding: '2px 8px' }}>＋</button>
                    </div>
                  );
                })}
              </div>
            )}
            {contracts?.rules?.cap_trading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--faint)', fontWeight: 700 }}>💵 CAP DOLLARS</span>
                <Chip on={capDir === 1} onClick={() => setCapDir(1)}>I SEND</Chip>
                <Chip on={capDir === -1} onClick={() => setCapDir(-1)}>I ASK</Chip>
                <input value={capDraft} maxLength={5} inputMode="numeric" placeholder="0"
                  onChange={(e) => setCapDraft(e.target.value.replace(/[^0-9]/g, ''))}
                  style={{ ...input, width: 64, marginTop: 0 }} />
              </div>
            )}
            <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)…" style={{ ...input, marginTop: 12 }} />
            {err && <div className="mono" style={errStyle}>{err}</div>}
            <button onClick={propose}
              disabled={busy || partner == null || give.length + get.length + givePicks.length + getPicks.length + Math.abs(capDollars) === 0}
              className="mono" style={{ ...btn, width: '100%', marginTop: 12, opacity: busy || partner == null || give.length + get.length + givePicks.length + getPicks.length + Math.abs(capDollars) === 0 ? 0.5 : 1 }}>
              ⇄ SEND THE OFFER{tradeReview === 'commish' ? ' (commish must approve)' : ''}
            </button>
            <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={() => setOpen(false)} className="mono" style={linkBtn}>cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── overnight pause (0153), web ─────────────────────────────────────────────
const fmtHourET = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;
};
const fmtNightWin = (n: { start_min: number; end_min: number }) => `${fmtHourET(n.start_min)}–${fmtHourET(n.end_min)} ET`;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function NightEditorWeb({ current, busy, onSet, onClear }: {
  current: { start_min: number; end_min: number } | null;
  busy: boolean;
  onSet: (startMin: number, endMin: number) => void;
  onClear: () => void;
}) {
  const [start, setStart] = useState(current ? Math.floor(current.start_min / 60) : 22);
  const [end, setEnd] = useState(current ? Math.floor(current.end_min / 60) : 9);
  const sel = (v: number, set: (n: number) => void) => (
    <select value={v} onChange={(e) => set(Number(e.target.value))} className="mono"
      style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 10.5, padding: '4px 6px' }}>
      {HOURS.map((h) => <option key={h} value={h}>{fmtHourET(h * 60)}</option>)}
    </select>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 7, padding: '8px 10px' }}>
      <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>🌙 OVERNIGHT PAUSE (ET)</span>
      <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>from</span>{sel(start, setStart)}
      <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>to</span>{sel(end, setEnd)}
      <button onClick={() => onSet(start * 60, end * 60)} disabled={busy || start === end} className="mono"
        style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', opacity: busy || start === end ? 0.5 : 1 }}>SET</button>
      {current && (
        <button onClick={onClear} disabled={busy} className="mono"
          style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--opp)', background: 'none', border: 'none', cursor: 'pointer' }}>✕ OFF</button>
      )}
      <span className="mono" style={{ width: '100%', fontSize: 8.5, color: 'var(--faint)', lineHeight: 1.5 }}>
        Clocks only burn awake time — no pick or bid deadline can expire inside the pause. Acting early stays allowed.
      </span>
    </div>
  );
}

// ── notification mutes in the options (0153 + 0194), web ────────────────────
// Prefs live server-side per registered device; this lists your devices and
// flips their mutes. Since v0.194.0 the browser itself can be one of those
// devices — the enable row below subscribes THIS browser via web push.
const NOTIF_KINDS: { key: string; label: string }[] = [
  { key: 'lineup', label: '⚠ lineup locks soon' },
  { key: 'chat', label: '💬 mentions & DMs' },
  { key: 'trades', label: '⇄ trade offers' },
  { key: 'waivers', label: '✚ waiver results' },
  { key: 'draft', label: '⛏ draft alerts' },
];

/** Push/alert preferences, per device (exported since v0.287.0 so the league
 *  hub's 🔔 Alerts tile can host the same card the team screen does — the app
 *  puts alerts on the league menu, and the web mirroring that layout should not
 *  fork a second copy of the editor). */
export function NotifPrefsCard({ bare }: { bare?: boolean } = {}) {
  const [tokens, setTokens] = useState<PushTokenRow[] | null>(null);
  const [web, setWeb] = useState<WebPushState>('unsupported');
  const reload = () => myPushTokens().then(setTokens).catch(() => setTokens([]));
  useEffect(() => {
    void reload();
    webPushState().then(setWeb).catch(() => {});
  }, []);
  const toggle = (tok: PushTokenRow, key: string) => {
    const next = { ...(tok.prefs ?? {}), [key]: tok.prefs?.[key] === false };
    setTokens((cur) => (cur ?? []).map((x) => (x.token === tok.token ? { ...x, prefs: next } : x)));
    void setPushPrefs(tok.token, next).catch(() => {});
  };
  const flipWeb = async () => {
    setWeb(await (web === 'subscribed' ? disableWebPush() : enableWebPush()));
    void reload();
  };
  return (
    // BARE inside a Sheet (v0.296.3) — a card in a card is two frames around
    // one picture, and the sheet's own title already says NOTIFICATIONS.
    <div style={bare ? {} : { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: '12px 14px' }}>
      {!bare && <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', marginBottom: 8 }}>🔔 NOTIFICATIONS</div>}
      {web !== 'unsupported' && (
        <div style={{ marginBottom: 8 }}>
          {web === 'denied' ? (
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5 }}>
              Notifications are blocked for this site in your browser settings — allow them there to get pushes here.
            </div>
          ) : (
            <button onClick={() => { void flipWeb(); }} className="mono"
              style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
                color: web === 'subscribed' ? 'var(--dim)' : 'var(--you)',
                background: web === 'subscribed' ? 'var(--bg)' : 'color-mix(in srgb, var(--you) 12%, transparent)',
                border: `1px solid ${web === 'subscribed' ? 'var(--bd)' : 'var(--you)'}` }}>
              {web === 'subscribed' ? '✓ THIS BROWSER GETS PUSHES — tap to turn off' : '🔔 ENABLE PUSHES ON THIS BROWSER'}
            </button>
          )}
        </div>
      )}
      {tokens === null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading…</div>}
      {tokens?.length === 0 && web !== 'off' && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', lineHeight: 1.5 }}>
          No device registered — sign in on the Drip Fantasy app{web === 'unsupported' ? '' : ' or enable this browser above'} and it shows up here.
        </div>
      )}
      {tokens?.map((tok) => (
        <div key={tok.token} style={{ marginBottom: 6 }}>
          {(tokens.length > 1) && (
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginBottom: 4 }}>{tok.platform === 'web' ? 'browser' : 'phone'} · seen {new Date(tok.last_seen_at).toLocaleDateString()}</div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {NOTIF_KINDS.map((k) => {
              const on = tok.prefs?.[k.key] !== false;
              return (
                <button key={k.key} onClick={() => toggle(tok, k.key)} className="mono"
                  style={{ fontSize: 9, fontWeight: 700, borderRadius: 999, padding: '4px 10px', cursor: 'pointer', color: on ? 'var(--you)' : 'var(--dim)', background: on ? 'color-mix(in srgb, var(--you) 12%, transparent)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}` }}>
                  {k.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
        Lit = on. Mutes apply per kind, per device — they follow your account, so flipping them here reaches your phone.
      </div>
    </div>
  );
}

// ── the commissioner's mid-draft controls (0191) ─────────────────────────────
/** Everything a commissioner needs once the room is RUNNING and something has
 *  gone wrong: assign a pick by hand, reseat a team, put a seat on autodraft,
 *  or throw the whole draft away and start over.
 *
 *  Pause/force/undo stay in the header row — they're the ones you reach for
 *  mid-sentence. These are the ones you reach for after the room has stopped to
 *  look at you, so they're a drawer rather than five more buttons in a row that
 *  already wraps.
 *
 *  MOVING A TEAM SLIDES, it doesn't swap: ↑ on the 4th seat makes it 3rd and
 *  pushes the old 3rd down to 4th, which is what "put him at the end" means and
 *  what a swap would get wrong for every seat in between. */
/** ONE MADE PICK, OPEN FOR EDITING (0194).
 *
 *  Two doors and they are deliberately different weights. REPLACE is the
 *  common one — the pick went to the wrong player and the seat should have
 *  somebody else — so it is a search over the available pool, one tap to
 *  commit, no confirm: it is undoable by doing it again. REMOVE takes a player
 *  off a roster and leaves a hole, so it asks first.
 *
 *  What it deliberately does NOT offer is moving a pick to another team. A
 *  pick belongs to the seat that made it; changing that is a trade, and trades
 *  have their own machinery with both managers' consent in it. */
function EditPickModal({ leagueId, pick, player, teamName, available, busy, onClose, onDone }: {
  leagueId: string; pick: DraftPickRow; player: LeaguePoolPlayer | null; teamName: string;
  available: LeaguePoolPlayer[]; busy: boolean;
  onClose: () => void;
  onDone: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [q, setQ] = useState('');
  const [armed, setArmed] = useState(false);
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return available
      .filter((p) => !needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [available, q]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 460, marginTop: 30 }}>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)' }}>
          PICK {pick.round}.{pick.overall} · {teamName}
        </div>
        <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginTop: 3 }}>
          {player?.full_name ?? pick.slug}
        </div>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 2 }}>
          {player ? `${posLabel(player.pos)} · ${player.team}` : 'not in the pool any more'}
        </div>

        {/* REMOVE — two clicks, because it leaves the seat a player short. */}
        <div style={{ marginTop: 12, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
          {!armed ? (
            <button onClick={() => setArmed(true)} disabled={busy} className="mono"
              style={{ ...ghostBtn, padding: '7px 10px', fontSize: 9.5, color: 'var(--opp)', borderColor: 'var(--opp)' }}>
              ✕ REMOVE THIS PICK
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', lineHeight: 1.5, flex: '1 1 200px' }}>
                The cell empties, {teamName} is one player short, and he goes back to the pool. The picks around it don't move.
              </span>
              <button onClick={() => onDone(() => commishEditPick(leagueId, pick.overall, null))} disabled={busy} className="mono"
                style={{ ...btn, padding: '7px 12px', fontSize: 9.5, background: 'var(--opp)' }}>REMOVE</button>
              <button onClick={() => setArmed(false)} className="mono" style={linkBtn}>cancel</button>
            </div>
          )}
        </div>

        {/* REPLACE — the common case, so it is the big half of the card. */}
        <div style={{ marginTop: 12, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
          <div style={{ ...hdr, marginBottom: 6 }}>REPLACE WITH</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search available players…"
            style={{ ...input, marginBottom: 8 }} />
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {hits.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Nobody matches — widen the search.</div>}
            {hits.map((p) => (
              <button key={p.slug} onClick={() => onDone(() => commishEditPick(leagueId, pick.overall, p.slug))} disabled={busy}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--bd)', padding: '7px 2px', cursor: 'pointer' }}>
                <PosPill pos={p.pos as Pos} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>
                <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{p.team} · #{p.rank}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={onClose} className="mono" style={linkBtn}>close</button></div>
      </div>
    </div>
  );
}

function CommishDraftControls({ leagueId, st, busy, teamName, autos, assign, onAssign, onRun }: {
  leagueId: string; st: DraftState; busy: boolean;
  teamName: (rid: number | null | undefined) => string | null;
  autos: Record<number, boolean>;
  assign: boolean; onAssign: (on: boolean) => void;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [confirm, setConfirm] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const order = st.order ?? [];
  const snake = st.mode !== 'auction';  // 'pick-based': linear shares every control but the fold
  const live = st.status === 'live';
  const canMove = snake && st.status !== 'complete' && order.length > 1;
  const armed = confirm.trim().toLowerCase() === 'reset';

  return (
    <div style={{ borderTop: '1px solid var(--bd)', marginTop: 10, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {snake && live && (
        <div>
          <div style={hdr}>ASSIGN A PLAYER</div>
          <Chip on={assign} onClick={() => onAssign(!assign)}>
            {assign ? '⚑ ASSIGNING — CLICK TO STOP' : '⚑ PICK FOR THE SEAT ON THE CLOCK'}
          </Chip>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.5, marginTop: 6 }}>
            Turns the PLAYERS list into the on-clock team's board — the next player you pick becomes their pick.
          </div>
        </div>
      )}

      {canMove && (
        <div>
          <div style={hdr}>DRAFT ORDER · AUTODRAFT</div>
          {order.map((rid, i) => (
            <div key={rid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: i === 0 ? 'none' : '1px solid var(--bd)' }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 20 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {teamName(rid) ?? `Team ${rid}`}
              </span>
              <Chip on={!!autos[rid]} onClick={() => onRun(() => setAutodraft(leagueId, rid, !autos[rid]))}>
                🤖 {autos[rid] ? 'AUTO' : 'OFF'}
              </Chip>
              <button onClick={() => onRun(() => commishMoveDraftSlot(leagueId, rid, i))} disabled={busy || i === 0}
                title="move up one spot" className="mono" style={{ ...linkBtn, padding: '0 3px', opacity: i === 0 ? 0.3 : 1 }}>↑</button>
              <button onClick={() => onRun(() => commishMoveDraftSlot(leagueId, rid, i + 2))} disabled={busy || i === order.length - 1}
                title="move down one spot" className="mono" style={{ ...linkBtn, padding: '0 3px', opacity: i === order.length - 1 ? 0.3 : 1 }}>↓</button>
            </div>
          ))}
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.5, marginTop: 6 }}>
            {live
              ? 'Picks already made keep their seats; everything from the clock forward follows the new order. Autodraft keeps picking even while the draft is paused.'
              : 'Autodraft keeps picking even while the draft is paused — a pause is time for people, not robots.'}
          </div>
        </div>
      )}

      {st.status !== 'pending' && (
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
          <div style={hdr}>START OVER</div>
          {!resetOpen ? (
            <button onClick={() => setResetOpen(true)} disabled={busy} className="mono"
              style={{ ...ghostBtn, padding: '7px 10px', fontSize: 9.5, color: 'var(--opp)', borderColor: 'var(--opp)' }}>🗑 TRASH THE DRAFT</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', lineHeight: 1.5 }}>
                Every pick in this room goes ({(st.picks ?? []).length} so far) and the draft goes back to pending.
                Keepers, traded picks and everyone's queue survive. Type RESET to confirm.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESET" className="mono"
                  style={{ flex: '1 1 140px', minWidth: 0, fontSize: 12, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--bg)', color: 'var(--text)' }} />
                <button onClick={() => { onRun(() => commishResetDraft(leagueId, confirm)); setConfirm(''); setResetOpen(false); }}
                  disabled={busy || !armed} className="mono"
                  style={{ ...btn, padding: '8px 12px', fontSize: 9.5, background: 'var(--opp)', opacity: busy || !armed ? 0.4 : 1 }}>START OVER</button>
                <button onClick={() => { setResetOpen(false); setConfirm(''); }} className="mono" style={linkBtn}>CANCEL</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
