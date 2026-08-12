// LivePicks, native.
//
// Deliberately the FIRST screen ported: it's the smallest one that exercises
// the whole stack — Supabase reads/writes through core's liveApi, the slate and
// per-window lock logic, the metric catalogue, the premium gate and the coin
// wallet. If this renders and seals a lineup against the real backend, the
// architecture works; the rest is surface area.
//
// Every line of game logic below is imported, not reimplemented: the eligibility
// gating, lock rules, pick shape and power-up prices all come from @drip/core,
// exactly as they do on web. That is the whole point of the extraction — a rule
// change lands in one file and both apps get it.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LOCKED_METRIC_UNLOCK } from '@drip/core/data/metrics';
import { windowForTeam, hasSlate, setRuntimeSlate, weekLabel, windowsForWeek, windowDateLabel, windowTimeLabel, gamesInWindow, isPreseasonWeek } from '@drip/core/data/nflSlate';
import { teamLogo } from '@drip/core/data/media';
import { slugMeta } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { powerupById, POWERUPS, isAmplifier, ampCapacity } from '@drip/core/data/powerups';
import { REG_SEASON_WEEKS } from '@drip/core/data/league';
import { ensurePremiumTier, isFreePowerup, isFreePosition, markGatedAttempt } from '@drip/core/data/premiumClient';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, myMembership, setTeamController,
  myBuffs, heroSetBuffs, myInventory, consumeInventory, refundInventory,
  myUnlocks, armUnlock, disarmUnlock, myComboQty,
  myWallet, ensureWallet,
  liveSlate, matchupTeams, matchupPremium, startCheckout, friendlyError,
  getMatchup, getMatchupState, getRevealedPicks, subscribeMatchup, matchupWallets, weekGameFeeds,
  type LiveMatchup, type PoolPlayer, type PickRow, type Controller, type TeamInfo,
  type WindowScore, type RevealedPick, type GameFeedRow,
} from '@drip/core/data/liveApi';
import { setLiveGameFeed, feedRowsToWeek, gameFeedFor } from '@drip/core/data/gameFeed';
import type { PoolGroup } from '@drip/core/data/poolEntry';
import type { GameWindow, Player, Pos, WindowId } from '@drip/core/types';
import { useTheme } from '../theme.native';
import { Card, Chip, Display, LinkButton, Mono, Notice } from '../ui/prims';
import { SetupRow } from '../ui/SetupRow';
import { FELT } from '../ui/cards';
import { PlayerPicker } from '../ui/PlayerPicker';
import { RosterPanel } from '../ui/RosterPanel';
import { ShopModal } from '../ui/ShopModal';
import { PowerupHand, type HandCard } from '../ui/PowerupHand';
import { Duel, Big, round1 } from '../ui/Duel';
import { FieldView } from '../ui/FieldView';
import { Overlay } from '../ui/Overlay';

// Live pool entries are slug/full/pos; SetupRow wants a Player. Build a light
// one — the setup board only ever displays name/pos/team.
const ZERO_STATS = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
function poolToPlayer(p: PoolPlayer): Player {
  return { id: p.slug, name: shortName(p.full), full: p.full, pos: p.pos as Pos, team: slugMeta(p.slug).team, stats: { ...ZERO_STATS } };
}

const LIVE_UNLOCKS = ['unlock-combo-drip', 'unlock-return', 'unlock-pass-td10'] as const;

interface Slot { win: string; winLabel: string; slot: string; key: string }

/** A week's slots, from that week's OWN windows.
 *
 *  Not a module constant. `WINDOWS` in metrics.ts is the regular-season default
 *  — TNF / SUN 1PM x3 / SUN 4PM x2 / SNF / MNF — but a week's real windows are
 *  DERIVED from its actual kickoffs (nflSlate.deriveWeek), and preseason weeks
 *  cluster into a different shape entirely. Building slots from the static list
 *  showed the wrong windows AND hid saved picks, because a pick is keyed by
 *  `game_window` and the ids did not line up. Worse, sealing would have written
 *  rows under window ids the week does not have. */
const slotsFor = (wins: GameWindow[]): Slot[] =>
  wins.flatMap((w) =>
    Array.from({ length: w.slots }, (_, i) => ({ win: w.id, winLabel: w.label, slot: String(i), key: `${w.id}-${i}` })));

/** The real NFL games a window covers. Thin wrapper so the render path reads
 *  cleanly; deriveWeek already memoises per week. */
const slateOf = (week: number, win: WindowId) => gamesInWindow(week, win);

const fmtLock = (iso: string | null) => {
  if (!iso) return 'kickoff';
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};

export function LivePicks({ userId, leagueId, rosterId, onBack }: {
  userId: string; leagueId?: string; rosterId?: number; onBack: () => void;
}) {
  const t = useTheme();
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [myTeam, setMyTeam] = useState<TeamInfo | null>(null);
  const [oppTeam, setOppTeam] = useState<TeamInfo | null>(null);
  const [roster, setRoster] = useState<{ leagueId: string; rosterId: number } | null>(null);
  const [controller, setController] = useState<Controller>('human');
  const [aiBusy, setAiBusy] = useState(false);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [picks, setPicks] = useState<Record<string, { player_slug: string | null; metric_id: string | null }>>({});
  const [buffs, setBuffs] = useState<Set<string>>(new Set());
  const [unlocks, setUnlocks] = useState<Set<string>>(new Set());
  const [comboQty, setComboQty] = useState(0);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [coins, setCoins] = useState(0);
  const [buffBusy, setBuffBusy] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /** True once the server's saved picks are in `picks`. Gates the autosave so
   *  the empty first render can never overwrite a real lineup. */
  const [hydrated, setHydrated] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<{ key: string; win: WindowId } | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [matchPremium, setMatchPremium] = useState(true); // default true = no false locks until we know
  const [weekSel, setWeekSel] = useState<number | null>(null);
  const [winKickIso, setWinKickIso] = useState<Record<string, string>>({});
  const [lockedWins, setLockedWins] = useState<Set<string>>(new Set());
  const [nowTs, setNowTs] = useState(() => Date.now());
  // Set only after the live slate is installed below — windowsForWeek() reads
  // that slate, so asking before it lands returns the generic default.
  const [wins, setWins] = useState<GameWindow[]>([]);
  // The opponent's ROSTER is public in this game — what stays hidden is which
  // player they put in which slot. So scouting fetches their pool the same way
  // it fetches yours, and shows only who COULD appear in a window.
  const [oppPool, setOppPool] = useState<PoolPlayer[]>([]);
  const [scoutWin, setScoutWin] = useState<GameWindow | null>(null);

  // ── Live state ──────────────────────────────────────────────────────────────
  // What the WORKER published, not anything resolved here. This screen used to
  // stop at lock — a locked window greyed its cards out and that was the end of
  // it — and the scores lived on a separate LIVE BOARD tab, so on Sunday you set
  // a lineup on one screen and watched it on another. Now a window is SETUP
  // before its kickoff and LIVE after, on this one board, the way the web's
  // Matchup phases.
  const [scores, setScores] = useState<WindowScore[]>([]);
  const [revealed, setRevealed] = useState<RevealedPick[]>([]);
  const [wallets, setWallets] = useState<{ home: number | null; away: number | null } | null>(null);
  const [youAreHome, setYouAreHome] = useState(true);
  /** Per-GAME play feeds the worker publishes — what the drive chart reads.
   *  Separate from live_play (the engine's per-player rows): a field needs the
   *  whole game's drives, not one player's touches. */
  const [gameFeeds, setGameFeeds] = useState<GameFeedRow[]>([]);

  useEffect(() => { ensurePremiumTier(); }, []);

  useEffect(() => {
    let alive = true;
    let unsub = () => {};
    (async () => {
      try {
        setState('loading'); setErr(null); setHydrated(false);
        const r = leagueId && rosterId != null ? { leagueId, rosterId } : await myRoster(userId);
        if (!r) { setState('none'); return; }
        setRoster(r);
        myMembership(r.leagueId, r.rosterId).then((mm) => { if (mm?.controller) setController(mm.controller); }).catch(() => {});
        const m = await myMatchup(r.leagueId, r.rosterId, weekSel ?? undefined);
        if (!m) { setMatchup(null); setState('none'); return; }
        setMatchup(m);
        matchupPremium(m.id).then(setMatchPremium).catch(() => {});
        matchupTeams(r.leagueId, [m.home_roster_id, m.away_roster_id]).then((tm) => {
          setMyTeam(tm[r.rosterId] ?? null);
          const oppId = m.home_roster_id === r.rosterId ? m.away_roster_id : m.home_roster_id;
          setOppTeam(tm[oppId] ?? null);
        }).catch(() => {});
        const [pl, pk, bf, un, slate, cq] = await Promise.all([
          myPool(r.leagueId, m.week, r.rosterId), myPicks(m.id, userId), myBuffs(m.id), myUnlocks(m.id),
          liveSlate(m.week).catch(() => []), myComboQty(m.id, userId).catch(() => 0),
        ]);
        myInventory(m.id).then((inv) => setInventory(inv ?? {})).catch(() => {});
        {
          const oppRoster = m.home_roster_id === r.rosterId ? m.away_roster_id : m.home_roster_id;
          myPool(r.leagueId, m.week, oppRoster).then(setOppPool).catch(() => setOppPool([]));
        }
        // `kickoff` is NOT optional here, whatever the type says. deriveWeek()
        // clusters a week into its real windows from kickoff times, and it
        // demands a kickoff on EVERY game — one missing and it abandons the
        // whole derivation for the fixed regular-season five (tnf / early /
        // late / snf / mnf). Omitting it therefore fails silently and
        // plausibly: the board renders five sensible-looking windows, and a
        // preseason week that really has (say) seven Thursday-through-Saturday
        // clusters loses the ones with no fallback equivalent.
        //
        // That is not just a cosmetic mismatch. Picks are stored against the
        // DERIVED window id, and repeated buckets get a numeric suffix
        // (tnf, tnf2, tnf3…). Under the fallback the app renders `tnf` and
        // never `tnf2`, so a pick saved on the web is present, correct and
        // invisible — which read as "my picks are gone" when only the one pick
        // that landed in the first cluster survived.
        setRuntimeSlate(m.week, slate.map((g) => ({
          away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId,
          kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined,
        })));
        // MUST follow setRuntimeSlate: this is what makes a preseason week show
        // its own windows instead of the regular-season five.
        setWins(windowsForWeek(m.week));
        const wkick: Record<string, string> = {};
        for (const g of slate) {
          if (!g.kickoff) continue;
          if (!wkick[g.win] || Date.parse(g.kickoff) < Date.parse(wkick[g.win])) wkick[g.win] = g.kickoff;
        }
        setWinKickIso(wkick);
        setPool(pl);
        const map: Record<string, { player_slug: string | null; metric_id: string | null }> = {};
        const lw = new Set<string>();
        for (const p of pk) {
          if (p.locked) lw.add(p.game_window);
          // Extra slots ('x0','x1'…) are not offered on mobile yet — see the
          // note on the Extra slots card below.
          if (!/^x\d+$/.test(p.roster_slot)) map[`${p.game_window}-${p.roster_slot}`] = { player_slug: p.player_slug, metric_id: p.metric_id };
        }
        setLockedWins(lw);
        setPicks(map);
        setHydrated(true);
        setBuffs(new Set(bf ?? []));
        setUnlocks(new Set(un ?? []));
        setComboQty(Number(cq ?? 0));
        ensureWallet(m.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {});
        setYouAreHome(m.home_roster_id === r.rosterId);

        // Live reads, then a realtime channel. No polling loop: the worker
        // writes matchup_state and Supabase pushes, which is also why the score
        // on the phone cannot drift from the score on the web.
        const refreshLive = async () => {
          const [mm, ss, pk2, ww, gf] = await Promise.all([
            getMatchup(m.id), getMatchupState(m.id), getRevealedPicks(m.id),
            matchupWallets(m.id).catch(() => null),
            weekGameFeeds(m.week).catch(() => [] as GameFeedRow[]),
          ]);
          if (!alive) return;
          if (mm) setMatchup(mm);
          setScores(ss); setRevealed(pk2); setWallets(ww);
          // Install the week's feeds so gameFeedFor() resolves them. The live
          // overlay is exclusive per week — a live board must never fall through
          // to baked 2025 drives, which would draw a plausible, wrong field.
          setLiveGameFeed(m.week, feedRowsToWeek(gf));
          setGameFeeds(gf);
        };
        await refreshLive().catch(() => {});
        if (!alive) return;
        unsub = subscribeMatchup(m.id, () => { refreshLive().catch(() => {}); });

        setState('ready');
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : 'Failed to load.'); setState('error');
      }
    })();
    return () => { alive = false; unsub(); };
  }, [userId, leagueId, rosterId, weekSel, attempt]);

  const locked = !!matchup && (matchup.status !== 'scheduled' || (!!matchup.lock_at && new Date(matchup.lock_at) <= new Date()));

  /** Slug → player for the DUEL, covering both sides. The old live board passed
   *  only your own pool, so an opponent's revealed card fell back to a face-down
   *  back whenever their player wasn't also on your roster — which is almost
   *  always. Scouting already loads their pool; merging it here is what makes
   *  the reveal actually show you what you were beaten by. */
  const duelPool = useMemo(
    () => Object.fromEntries([...oppPool, ...pool].map((p) => [p.slug, p])) as Record<string, PoolPlayer>,
    [pool, oppPool]);

  /** Window labels from the week's OWN windows — a preseason cluster has no
   *  entry in the regular-season list and would render as its raw id. */
  const winLabelFor = (id: string) => wins.find((w) => String(w.id) === id)?.label ?? id.toUpperCase();

  /** The field(s) under one duel: the real NFL games the two players are in.
   *
   *  Deduped by team, because the pair is very often IN the same game — a QB
   *  against the opposing RB — and two identical drive charts stacked under one
   *  pair reads as a rendering bug.
   *
   *  clock is MAX_SAFE_INTEGER: a live board always shows the latest play there
   *  is. The demo passes a real clock because it is scrubbing through a finished
   *  week; here "now" is simply the end of the feed.
   *
   *  Returns null when neither team has a published feed, which is also the
   *  honest answer before kickoff — FieldView itself renders nothing without one,
   *  but returning null keeps Duel from laying out an empty container. */
  const slotDetail = (win: string, slot: string) => {
    // Guard on the STATE, not just gameFeedFor: setLiveGameFeed writes a module
    // map, which React cannot see. Reading the row count here is what ties the
    // fields to a re-render when the feeds land.
    if (!gameFeeds.length) return null;
    const mySlug = revealed.find((p) => p.app_user_id === userId && p.game_window === win && p.roster_slot === slot)?.player_slug;
    const theirSlug = revealed.find((p) => p.app_user_id !== userId && p.game_window === win && p.roster_slot === slot)?.player_slug;
    const teams = [...new Set([mySlug, theirSlug]
      .map((sl) => (sl ? duelPool[sl]?.team || slugMeta(sl).team : ''))
      .filter(Boolean))];
    const withFeed = teams.filter((tm) => !!gameFeedFor(week, tm));
    if (!withFeed.length) return null;
    return (
      <View style={{ gap: 6 }}>
        {withFeed.map((tm) => <FieldView key={tm} week={week} team={tm} clock={Number.MAX_SAFE_INTEGER} />)}
      </View>
    );
  };

  const totals = useMemo(() => {
    const home = scores.reduce((n, s) => n + Number(s.home_score), 0);
    const away = scores.reduce((n, s) => n + Number(s.away_score), 0);
    return { you: youAreHome ? home : away, them: youAreHome ? away : home };
  }, [scores, youAreHome]);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /** A window's picks are final: the server sealed our rows, or its first
   *  kickoff passed. Once the week starts, a window with no known kickoff is
   *  treated as locked (fail safe). */
  const winLocked = (winId: string): boolean => {
    if (!locked) return false;
    if (lockedWins.has(winId)) return true;
    const iso = winKickIso[winId];
    return iso ? Date.parse(iso) <= nowTs : true;
  };
  const allLocked = !!matchup && locked && wins.every((w) => winLocked(w.id));
  const slots = useMemo(() => slotsFor(wins), [wins]);

  const week = matchup?.week ?? 0;
  const gateOn = hasSlate(week);
  // readPool resolves the team (the synced row's own first, then the baked 2025
  // table) — this used to consult slugMeta alone, which knows only players who
  // existed in 2025 and returned '' for everyone else, sending them to the
  // 'any' branch below instead of their real window.
  const teamBySlug = useMemo(() => Object.fromEntries(pool.map((p) => [p.slug, p.team || slugMeta(p.slug).team])), [pool]);
  // Slug → roster group. The pool is the manager's WHOLE roster now (starters,
  // bench, IR, taxi), and the group is the only thing distinguishing a fielded
  // RB1 from a taxi rookie in a list that otherwise shows them identically.
  const grpBySlug = useMemo<Record<string, PoolGroup>>(
    () => Object.fromEntries(pool.map((p) => [p.slug, p.grp])), [pool]);
  const winBySlug = useMemo<Record<string, WindowId | 'any' | null>>(() => {
    const m: Record<string, WindowId | 'any' | null> = {};
    for (const p of pool) { const tm = teamBySlug[p.slug]; m[p.slug] = tm ? windowForTeam(week, tm) : 'any'; }
    return m;
  }, [pool, teamBySlug, week]);

  const eligibleFor = (winId: string, picked: string | null): PoolPlayer[] => {
    let list = gateOn ? pool.filter((p) => winBySlug[p.slug] === 'any' || winBySlug[p.slug] === winId) : pool;
    if (picked && !list.some((p) => p.slug === picked)) {
      const s = pool.find((p) => p.slug === picked);
      if (s) list = [s, ...list];
    }
    return list;
  };

  const playersBySlug = useMemo(() => {
    const m: Record<string, Player> = {};
    for (const p of pool) m[p.slug] = poolToPlayer(p);
    return m;
  }, [pool]);

  const slottedInWin = (winId: string, exceptKey: string): Set<string> => {
    const s = new Set<string>();
    for (const sl of slots.filter((x) => x.win === winId)) {
      if (sl.key === exceptKey) continue;
      const slug = picks[sl.key]?.player_slug;
      if (slug) s.add(slug);
    }
    return s;
  };

  const setSlot = (key: string, patch: Partial<{ player_slug: string | null; metric_id: string | null }>) => {
    setSaved(false);
    setPicks((prev) => {
      const cur = prev[key] ?? { player_slug: null, metric_id: null };
      const next = { ...cur, ...patch };
      if (patch.player_slug !== undefined) next.metric_id = null; // reset metric when player changes
      return { ...prev, [key]: next };
    });
  };

  // AUTOSAVE, debounced — there is no manual seal, because sealing is not a
  // player action. A window's picks lock on the real clock, one hour before its
  // first kickoff (server: config.lockLeadMs, written to matchup.lock_at by the
  // sync and enforced by the 0058 trigger). The web board has worked this way
  // all along — "the live board has no LOCK IN button" — and the app shipped a
  // SEAL LINEUP button instead, which was wrong twice over: it named the player
  // as the one who seals, and it meant a lineup you built but didn't press the
  // button on was never saved at all.
  //
  // Only AFTER the saved lineup has hydrated. Autosaving from the first render
  // would write the empty initial `picks` over a returning manager's real
  // lineup, which is a far worse bug than the one being fixed.
  useEffect(() => {
    if (!matchup || !hydrated) return;
    const id = setTimeout(() => {
      const rows: PickRow[] = slots
        .map((sl) => {
          const p = picks[sl.key];
          return { game_window: sl.win, roster_slot: sl.slot, player_slug: p?.player_slug ?? null, metric_id: p?.metric_id ?? null };
        })
        // Only filled slots in still-open windows: a locked window's rows are
        // sealed server-side and would fail the whole upsert (RLS + 0058
        // trigger), and one rejected row discards the entire batch.
        .filter((r) => r.game_window && r.player_slug && !winLocked(r.game_window));
      if (!rows.length) return;
      setSaving(true);
      savePicks(matchup.id, userId, rows)
        .then(() => { setSaved(true); setErr(null); })
        // A swallowed failure is the worst outcome here: the board keeps showing
        // the lineup you built while the server holds an older one, and you find
        // out on reload. Say so on the board.
        .catch((e: unknown) => setErr(friendlyError(e)))
        .finally(() => setSaving(false));
    }, 1500);
    return () => clearTimeout(id);
  }, [picks, matchup, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshCoins = () => { if (matchup) myWallet(matchup.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {}); };
  const priceOf = (id: string) => powerupById(id)?.price ?? 0;
  const insufficientMsg = (id: string) => `Not enough drip coin — ${powerupById(id)?.name ?? id} costs ◆${priceOf(id)}, you have ◆${Math.round(coins)}.`;
  const puLocked = (id: string) => !matchPremium && !isFreePowerup(id);
  const upgradeMsg = 'Premium power-up — unlock premium ($5 you · $30 league) to arm it.';

  const checkout = (kind: 'personal' | 'league') => {
    if (!roster) return;
    markGatedAttempt('checkout:' + kind);
    startCheckout(kind, roster.leagueId).catch((e) => setErr(e instanceof Error ? e.message : 'Checkout failed.'));
  };

  /** Arm a card from the hand.
   *
   *  This CONSUMES AN OWNED CARD, it does not charge coin — coin was charged
   *  once, in the shop. The screen previously called `arm_buff`, which charges
   *  at arm time; with a shop in front of it that billed the same power-up
   *  twice. This mirrors the web's live board (store.armBuff →
   *  consumeAndApply + heroSetBuffs).
   *
   *  Amplifier capacity is enforced here as well as server-side, so an
   *  impossible arm is refused before it spends a card. */
  const armFromHand = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    if (buffs.has(id)) return;
    const armed = new Set(buffs);
    if (id === 'amp-3' && !armed.has('amp-2')) { setErr('Third Amp needs Second Amp armed first.'); return; }
    if (isAmplifier(id) && [...armed].filter(isAmplifier).length >= ampCapacity(armed)) {
      setErr('Amplifier capacity reached — arm Second/Third Amp to raise it.'); return;
    }
    if ((inventory[id] ?? 0) <= 0) { setErr('You don’t own that card — buy it in the shop.'); return; }

    setBuffBusy(id); setErr(null);
    try {
      const c = await consumeInventory(matchup.id, id);
      if (!c?.ok) { setErr('Could not play that card.'); return; }
      const next = [...armed, id];
      const r = await heroSetBuffs(matchup.id, next);
      if (r?.ok) {
        setBuffs(new Set(next));
        setInventory((inv) => ({ ...inv, [id]: Math.max(0, (inv[id] ?? 1) - 1) }));
      } else {
        // Persisting failed — hand the card back rather than silently eating it.
        await refundInventory(matchup.id, id).catch(() => {});
        setErr(r?.error ?? 'Could not arm that power-up.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not arm that power-up.');
    } finally { setBuffBusy(null); }
  };

  const disarmFromHand = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    if (!buffs.has(id)) return;
    setBuffBusy(id); setErr(null);
    try {
      const next = [...buffs].filter((b) => b !== id);
      const r = await heroSetBuffs(matchup.id, next);
      if (r?.ok) {
        await refundInventory(matchup.id, id).catch(() => {});
        setBuffs(new Set(next));
        setInventory((inv) => ({ ...inv, [id]: (inv[id] ?? 0) + 1 }));
      } else setErr(r?.error ?? 'Could not disarm that power-up.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not disarm that power-up.');
    } finally { setBuffBusy(null); }
  };

  /** The hand: everything owned, plus anything currently armed (an armed card
   *  has left the inventory, so it would otherwise vanish from view). */
  const hand: HandCard[] = POWERUPS
    .filter((p) => (inventory[p.id] ?? 0) > 0 || buffs.has(p.id))
    .map((p) => {
      const armed = buffs.has(p.id);
      const pre = p.timing === 'pre';
      return {
        id: p.id,
        qty: inventory[p.id] ?? 0,
        armed,
        usable: !locked && pre,
        note: locked ? 'The week has started — arms are closed.'
          : pre ? undefined
          : 'Real-time card — playable once this window kicks off.',
      };
    });

  const toggleUnlock = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    const combo = id === 'unlock-combo-drip';
    const armed = unlocks.has(id) && !combo; // combo: every tap buys another
    if (!armed && puLocked(id)) { markGatedAttempt('powerup:' + id); setErr(upgradeMsg); return; }
    if (!armed && coins < priceOf(id)) { setErr(insufficientMsg(id)); return; }
    setBuffBusy(id); setErr(null);
    try {
      const r = armed ? await disarmUnlock(matchup.id, id) : await armUnlock(matchup.id, id);
      if (r.ok && r.unlocks) {
        setUnlocks(new Set(r.unlocks));
        if (combo && typeof r.comboQty === 'number') setComboQty(r.comboQty);
        refreshCoins();
        // Disarming clears dependent picks server-side — mirror locally.
        if (armed) setPicks((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            const mid = next[k].metric_id;
            if (mid && LOCKED_METRIC_UNLOCK[mid] === id) next[k] = { ...next[k], metric_id: null };
          }
          return next;
        });
      } else setErr(r.error === 'insufficient' ? insufficientMsg(id) : (r.error ?? 'Could not update unlocks.'));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update unlocks.'); }
    finally { setBuffBusy(null); }
  };

  const disarmComboOne = async () => {
    if (!matchup || locked || buffBusy || comboQty <= 0) return;
    setBuffBusy('unlock-combo-drip'); setErr(null);
    try {
      const r = await disarmUnlock(matchup.id, 'unlock-combo-drip');
      if (r.ok) setAttempt((a) => a + 1); // full reload — picks may have been trimmed server-side
      else setErr(r.error ?? 'Could not remove the Combo Drip.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove the Combo Drip.'); }
    finally { setBuffBusy(null); }
  };

  const toggleAi = async () => {
    if (!roster || aiBusy) return;
    const next: Controller = controller === 'ai' ? 'human' : 'ai';
    setAiBusy(true);
    try { const r = await setTeamController(roster.leagueId, roster.rosterId, next); if (r.ok) setController(next); }
    catch { /* leave as-is */ }
    finally { setAiBusy(false); }
  };

  const curWeek = matchup?.week ?? weekSel ?? 1;
  const WeekNav = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <LinkButton label="‹" onPress={() => curWeek > 1 && setWeekSel(Math.max(1, curWeek - 1))} />
      <Mono size={10} weight="700" track={0.06}>{weekLabel(curWeek)}</Mono>
      <LinkButton label="›" onPress={() => curWeek < REG_SEASON_WEEKS && setWeekSel(Math.min(REG_SEASON_WEEKS, curWeek + 1))} />
    </View>
  );

  if (state === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={11}>Loading your matchup…</Mono>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, justifyContent: 'center' }}>
        <Card>
          <Display size={18}>Couldn’t load your matchup</Display>
          <Mono size={10.5} style={{ marginTop: 10 }}>Check your connection and try again.{err ? `\n— ${err}` : ''}</Mono>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 14 }}>
            <LinkButton label="↻ retry" tone="you" onPress={() => setAttempt((a) => a + 1)} />
            <LinkButton label="← back" onPress={onBack} />
          </View>
        </Card>
      </View>
    );
  }

  if (state === 'none') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, justifyContent: 'center' }}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Display size={17} style={{ flex: 1 }}>No week {curWeek} matchup yet</Display>
            <WeekNav />
          </View>
          <Mono size={10.5} style={{ marginTop: 10 }}>
            Your team is enrolled. Matchups appear here once your commissioner syncs the schedule — use ‹ › to page through the season.{err ? `\n— ${err}` : ''}
          </Mono>
          <View style={{ alignItems: 'center', marginTop: 14 }}><LinkButton label="← back" onPress={onBack} /></View>
        </Card>
      </View>
    );
  }

  const filled = slots.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      // Bottom padding clears the hand, which is pinned over this list rather
      // than scrolling with it — otherwise the save status sits under the cards.
      contentContainerStyle={{ padding: 12, paddingBottom: hand.length ? 170 : 40 }}
    >
      <RosterPanel
        title="Your roster"
        players={pool.map(poolToPlayer)}
        wins={wins}
        // Same resolver the slate gating uses, so the grouping here and the
        // eligibility counts on each window can never disagree.
        windowOf={(id) => winBySlug[id] ?? null}
        groupOf={(id) => grpBySlug[id] ?? 'start'}
        accent={t.you}
      />

      {/* An empty pool is not a bug and not the user's fault, but "0 eligible"
          on every window looks exactly like both. The lineup is keyed by
          (league, WEEK, roster) — a league that hasn't synced starters for the
          week you're looking at simply has no pool yet, which is the normal
          state for a regular-season week in August. Say so, and say which week,
          because paging to a week that IS synced is the actual fix. */}
      {!pool.length && (
        <Card style={{ marginBottom: 12, borderColor: t.warn }}>
          <Mono size={10} weight="700" tone="warn" track={0.1}>NO ROSTER FOR {weekLabel(matchup!.week).toUpperCase()}</Mono>
          <Text style={{ fontSize: 12.5, color: t.text, lineHeight: 18, marginTop: 6 }}>
            No starters came back for this week, so there’s nobody to field and
            every window reads 0 eligible. Use ‹ › above to check another week.
          </Text>
          {/* The exact tuple the read asked for. "No roster" has two very
              different causes — nothing matched, or something matched and was
              discarded — and they look identical from the outside. Printing the
              query makes it checkable against the table instead of guessable:
              if these ids are right and the row exists, the read is the
              problem, not the data. */}
          <Mono size={9} tone="faint" style={{ marginTop: 8 }}>
            asked: league {roster?.leagueId?.slice(0, 8) ?? '?'}… · week {matchup!.week} · roster {roster?.rosterId ?? '?'}
          </Mono>
        </Card>
      )}

      {/* Header — mirrors the web's title block: who is playing, how much of
          the lineup is set, and the week you are looking at. */}
      <Card style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            {isPreseasonWeek(matchup!.week) && (
              <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Mono size={9} tone="you" weight="700" track={0.08}>🏈 PRESEASON</Mono>
              </View>
            )}
          </View>
          <WeekNav />
        </View>

        {/* Who, how far along, and the two controls — nothing else. The rules
            used to be spelled out here in two paragraphs, which is a fine thing
            to read once and a permanent tax on every visit after that; the board
            below already says LOCKED / SETUP, N eligible and N/M SET on each
            window, which is the same information where it applies. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '700', color: t.text }}>
            {myTeam?.team_name ?? 'You'} vs {oppTeam?.team_name ?? 'Opponent'}
          </Text>
          <Mono size={9.5} weight="700" tone={filled === slots.length ? 'you' : 'faint'} track={0.08}>{filled}/{slots.length} SET</Mono>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Chip
            label={aiBusy ? '…' : `🤖 auto-pilot ${controller === 'ai' ? 'on' : 'off'}`}
            on={controller === 'ai'}
            disabled={aiBusy}
            onPress={toggleAi}
          />
          {controller !== 'ai' && (
            <>
              <View style={{ flex: 1 }} />
              <Mono size={10} tone="you" weight="700">◆ {Math.round(coins)}</Mono>
              <Pressable
                onPress={() => setShopOpen(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, backgroundColor: t.bg, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 12 }}>🛒</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: t.text }}>SHOP</Text>
              </Pressable>
            </>
          )}
        </View>
        {controller === 'ai' && <Mono size={9} tone="faint" style={{ marginTop: 8 }}>Auto-pilot is on — your manual picks below are paused until you turn it off.</Mono>}
      </Card>

      {/* Power-ups */}
      {controller !== 'ai' && (
        <Card style={{ marginBottom: 12 }}>
          {!matchPremium && (
            <View style={{ marginBottom: 10 }}>
              <Notice>
                <Mono size={9.5} tone="you" weight="700">🔒 Premium unlocks K/DST/IDP + the full power-up set + special events. Both sides of a premium matchup get the full set — never pay-to-win.</Mono>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 7 }}>
                  <Chip label="Unlock $5 · you" on onPress={() => checkout('personal')} />
                  <Chip label="Unlock league · $30" onPress={() => checkout('league')} />
                </View>
              </Notice>
            </View>
          )}

          {/* METRIC UNLOCKS is a control, so it stays — but the paragraph
              explaining what a power-up is does not. The shop says that, on the
              card you're about to buy, at the moment you care. */}
          <Mono size={9.5} weight="700" track={0.06}>METRIC UNLOCKS</Mono>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }} style={{ marginTop: 8 }}>
            {LIVE_UNLOCKS.map((id) => {
              const pu = powerupById(id);
              const combo = id === 'unlock-combo-drip';
              const on = combo ? comboQty > 0 : unlocks.has(id);
              // Combo Drip is one slot PER PURCHASE, so the chip always offers
              // to buy another — affordability matters even when armed.
              const afford = (on && !combo) || coins >= priceOf(id);
              return (
                <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Chip
                    label={`${pu?.icon ?? ''} ${pu?.name ?? id} ${on ? (combo ? `✓ ×${comboQty} ＋` : '✓') : puLocked(id) ? '🔒' : `◆${priceOf(id)}`}`}
                    on={on}
                    disabled={locked || !!buffBusy || !afford}
                    dim={buffBusy === id}
                    onPress={() => toggleUnlock(id)}
                  />
                  {combo && comboQty > 0 && !locked && (
                    <Chip label="➖" disabled={!!buffBusy} onPress={disarmComboOne} />
                  )}
                </View>
              );
            })}
          </ScrollView>
        </Card>
      )}

      {/* The score, once there IS one. Hidden before kickoff rather than shown
          as 0–0: a scoreboard reading nil-nil on Wednesday looks like a result,
          and this board's job before kickoff is the lineup. */}
      {(scores.length > 0 || matchup!.status !== 'scheduled') && (
        <Card style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Mono size={10} weight="700" track={0.12}>THIS WEEK</Mono>
            <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Mono size={9} tone={matchup!.status === 'final' ? 'dim' : 'you'}>{matchup!.status.toUpperCase()}</Mono>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 18, marginTop: 12 }}>
            <Big label="YOU" value={round1(totals.you)} color={t.you} team={myTeam ?? undefined} />
            <Mono size={11} tone="faint" style={{ paddingTop: 16 }}>vs</Mono>
            <Big label="OPP" value={round1(totals.them)} color={t.opp} team={oppTeam ?? undefined} />
          </View>
          {(() => {
            const myBank = youAreHome ? wallets?.home : wallets?.away;
            const theirBank = youAreHome ? wallets?.away : wallets?.home;
            if (myBank == null && theirBank == null) return null;
            return (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 8 }}>
                <Mono size={9.5} tone="you">◆ {round1(Number(myBank ?? 0))} banked</Mono>
                <Mono size={9.5} tone="opp">◆ {round1(Number(theirBank ?? 0))}</Mono>
              </View>
            );
          })()}
        </Card>
      )}

      {/* Windows. Each one phases on its OWN kickoff, which is the whole reason
          this can be one screen: at any moment on a Sunday some windows are
          still yours to set and others are already scoring, and a board split
          by tab could only ever show you one of those at a time. */}
      {wins.map((w) => {
        const winSlots = slots.filter((s) => s.win === w.id);
        const elig = gateOn ? pool.filter((pl) => winBySlug[pl.slug] === 'any' || winBySlug[pl.slug] === w.id).length : pool.length;
        const setN = winSlots.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;
        const wLocked = winLocked(w.id);

        // Sealed and scoring → the duel, with its own window header. Duel
        // renders nothing at all for a window with no picks and no score, so
        // that case deliberately falls through to the setup card below: a
        // window you left empty still has to appear, reading LOCKED, rather
        // than vanishing off the board.
        const myLive = revealed.filter((p) => p.app_user_id === userId && p.game_window === w.id);
        const theirLive = revealed.filter((p) => p.app_user_id !== userId && p.game_window === w.id);
        const winScores = scores.filter((s) => s.game_window === w.id);
        if (wLocked && (myLive.length || theirLive.length || winScores.length)) {
          return (
            <Duel
              key={w.id}
              mine={myLive} theirs={theirLive} pool={duelPool} scores={winScores}
              youAreHome={youAreHome} status={matchup!.status} week={week} winLabel={winLabelFor}
              slotDetail={slotDetail}
            />
          );
        }

        return (
          <Card key={w.id} style={{ marginBottom: 10, opacity: wLocked ? 0.75 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>{w.label}</Text>
              <Mono size={10} tone="dim" track={0.1}>{w.sub.toUpperCase()}</Mono>
              <Mono size={10} tone="mid">{windowDateLabel(week, w.id)}</Mono>
              <Mono size={10} tone="faint">{windowTimeLabel(week, w.id)}</Mono>
            </View>

            {/* Slate strip — which real games this window covers. The crests make
                a window scannable at a glance the way a list of abbreviations
                does not. */}
            {slateOf(week, w.id).length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                {slateOf(week, w.id).slice(0, 10).flatMap((g) => [g.away, g.home]).map((abbr, i) => {
                  const uri = teamLogo(abbr);
                  return uri
                    ? <Image key={`${abbr}-${i}`} source={{ uri }} style={{ width: 16, height: 16 }} resizeMode="contain" />
                    : <Mono key={`${abbr}-${i}`} size={8} tone="faint">{abbr}</Mono>;
                })}
                <Mono size={9} tone="faint" track={0.08} style={{ marginLeft: 4 }}>
                  SLATE · {slateOf(week, w.id).length} GAME{slateOf(week, w.id).length === 1 ? '' : 'S'}
                </Mono>
              </View>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: wLocked ? t.opp : t.you, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Mono size={9} weight="700" tone={wLocked ? 'opp' : 'you'} track={0.08}>{wLocked ? 'LOCKED' : 'SETUP'}</Mono>
              </View>
              <Mono size={9.5} tone={wLocked ? 'opp' : 'warn'} weight="700">
                {wLocked ? '🔒 locked' : winKickIso[w.id] ? `🔒 locks ${fmtLock(winKickIso[w.id])}` : '🔒 locks at kickoff'}
              </Mono>
              <Mono size={9.5} weight="700" tone={setN === winSlots.length ? 'you' : 'faint'}>{setN}/{winSlots.length} SET</Mono>
              {gateOn && <Mono size={9} tone={elig ? 'faint' : 'opp'}>{elig} eligible</Mono>}
            </View>

            {/* Felt under the pair, so the cards read as dealt onto a table
                rather than floating on the app background. */}
            <View style={{ gap: 10, backgroundColor: FELT, borderRadius: 8, padding: 10 }}>
              {winSlots.map((s, si) => {
                const p = picks[s.key];
                const pick = p?.player_slug ? { playerId: p.player_slug, metricId: p.metric_id ?? null } : undefined;
                return (
                  <SetupRow
                    key={s.key}
                    idx={si}
                    pick={pick}
                    resolve={(id) => playersBySlug[id]}
                    lockPlayer={wLocked}
                    // Locked metrics only become pickable once their unlock is
                    // armed — same rule as the web's metricsFor().
                    metricFilter={(m) => !m.lock || unlocks.has(m.lock)}
                    onOpenPicker={() => { if (!wLocked) setPickerSlot({ key: s.key, win: w.id as WindowId }); }}
                    onPickMetric={(mid) => { if (!wLocked) setSlot(s.key, { metric_id: mid }); }}
                    onClearSlot={() => { if (!wLocked) setSlot(s.key, { player_slug: null, metric_id: null }); }}
                    onScout={oppPool.length ? () => setScoutWin(w) : undefined}
                  />
                );
              })}
            </View>
          </Card>
        );
      })}

      {!!err && <Mono size={10.5} tone="opp" style={{ marginVertical: 6 }}>{err}</Mono>}

      {/* Status, not a control. Nothing here to press: changes save themselves
          and each window seals an hour before its own kickoff. */}
      {!allLocked && (
        <Mono size={9.5} tone={saving ? 'faint' : saved ? 'you' : 'faint'} style={{ textAlign: 'center', marginTop: 4 }}>
          {saving ? 'Saving…' : saved ? 'Saved ✓ — each window locks 1h before its kickoff' : 'Changes save automatically — each window locks 1h before its kickoff'}
        </Mono>
      )}
      {allLocked && <Mono size={10.5} style={{ textAlign: 'center' }}>Every window has kicked off — picks are final.</Mono>}

      <View style={{ alignItems: 'center', marginTop: 14 }}><LinkButton label="← back" onPress={onBack} /></View>

      {/* Scout: who the opponent COULD field in this window. Never who they
          actually slotted — that stays sealed until the window kicks off. */}
      <Overlay
        visible={!!scoutWin}
        title={`Scout · ${scoutWin?.label ?? ''}`}
        subtitle={`${(oppTeam?.team_name ?? 'OPPONENT').toUpperCase()} · WHO THEY COULD FIELD — NOT WHO THEY PLAYED`}
        onClose={() => setScoutWin(null)}
      >
        <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
          {(() => {
            const win = scoutWin?.id;
            const list = !win ? [] : oppPool
              .filter((op) => {
                if (!gateOn) return true;
                const tm = slugMeta(op.slug).team;
                const w = tm ? windowForTeam(week, tm) : 'any';
                return w === 'any' || w === win;
              })
              .sort((a, b) => a.pos.localeCompare(b.pos) || a.full.localeCompare(b.full));
            if (!list.length) return <Mono size={10.5} tone="dim">Nobody on their roster plays in this window.</Mono>;
            return list.map((op) => (
              <View key={op.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
                <View style={{ backgroundColor: (t.pos[op.pos as keyof typeof t.pos] ?? { bg: t.sh }).bg, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}>
                  <Text style={{ fontFamily: 'System', fontSize: 9, fontWeight: '700', color: (t.pos[op.pos as keyof typeof t.pos] ?? { fg: t.dim }).fg }}>{op.pos}</Text>
                </View>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.text }}>{op.full}</Text>
                <Mono size={9} tone="faint">{slugMeta(op.slug).team}</Mono>
              </View>
            ));
          })()}
        </ScrollView>
      </Overlay>

      {!!matchup && (
        <ShopModal
          visible={shopOpen}
          matchupId={matchup.id}
          balance={coins}
          // Preseason weeks are practice: the server charges nothing, so the
          // shop must not imply the season wallet moves.
          practice={isPreseasonWeek(matchup.week)}
          onClose={() => setShopOpen(false)}
          // Trust the server's balance rather than deducting locally — on a
          // practice week nothing is actually charged.
          // Both, or the hand goes stale: a bought card only reaches the hand
          // through `inventory`, which is otherwise read once on mount.
          onChanged={(bal, inv) => { setCoins(bal); setInventory(inv); }}
        />
      )}

      {pickerSlot && (() => {
        const cur = picks[pickerSlot.key]?.player_slug ?? undefined;
        const slotted = slottedInWin(pickerSlot.win, pickerSlot.key);
        const players = eligibleFor(pickerSlot.win, cur ?? null)
          .filter((p) => !slotted.has(p.slug) || p.slug === cur)
          .map(poolToPlayer);
        return (
          <PlayerPicker
            visible
            players={players}
            currentId={cur}
            windowLabel={wins.find((w) => w.id === pickerSlot.win)?.label}
            groupOf={(id) => grpBySlug[id] ?? 'start'}
            gated={(p) => !matchPremium && !isFreePosition(p.pos)}
            onGated={(p) => {
              markGatedAttempt('position:' + p.pos);
              setErr(`Premium position (${p.pos}) — unlock premium ($5 you · $30 league) to field K/DST/IDP.`);
              setPickerSlot(null);
            }}
            onPick={(slug) => { setSlot(pickerSlot.key, { player_slug: slug }); setPickerSlot(null); }}
            onRemove={() => { setSlot(pickerSlot.key, { player_slug: null, metric_id: null }); setPickerSlot(null); }}
            onClose={() => setPickerSlot(null)}
          />
        );
      })()}
    </ScrollView>

    <PowerupHand
      cards={hand}
      busyId={buffBusy}
      onArm={armFromHand}
      onDisarm={disarmFromHand}
    />
    </View>
  );
}
