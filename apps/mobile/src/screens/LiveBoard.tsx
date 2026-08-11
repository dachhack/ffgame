// The live board: what you watch on Sunday.
//
// Ported from src/screens/LiveBoard.tsx, NOT from Matchup.tsx. Matchup is 3,308
// lines and resolves the game client-side; this reads what the worker already
// published (`matchup_state.slot_scores`), so the phone renders a score rather
// than recomputing one. Server-authoritative, ~10x smaller, and it cannot
// disagree with the web about who is winning.
//
// It also pushes: subscribeMatchup() opens a realtime channel and re-reads on
// any score or status change, so there is no polling loop here.
//
// NOT ported in this pass, deliberately:
//   · FieldView — the drive charts are SVG to their bones and want their own pass.
//   · The card-table presentation (league_pref.card_theme) — a skin, and it
//     depends on cardTable.tsx, 888 lines of DOM-specific card rendering.
// Both are presentation. The score, the windows and the lineups are here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { weekLabel, windowsForWeek } from '@drip/core/data/nflSlate';
import { metricById } from '@drip/core/data/metrics';
import { slugMeta } from '@drip/core/data/slugMeta';
import { REG_SEASON_WEEKS } from '@drip/core/data/league';
import {
  myRoster, myMatchup, getMatchup, getMatchupState, getRevealedPicks, subscribeMatchup,
  myPool, matchupWallets, matchupTeams,
  type LiveMatchup, type WindowScore, type RevealedPick, type PoolPlayer, type TeamInfo,
} from '@drip/core/data/liveApi';
import type { Pos } from '@drip/core/types';
import { useTheme } from '../theme.native';
import { Card, Display, LinkButton, Mono } from '../ui/prims';
import { CardFace, CardBack, FELT } from '../ui/cards';
import { LivePulse } from '../ui/animations';

const round1 = (n: number) => Math.round(Number(n) * 10) / 10;

export function LiveBoard({ userId, leagueId, rosterId, onBack }: {
  userId: string; leagueId?: string; rosterId?: number; onBack: () => void;
}) {
  const t = useTheme();
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [youAreHome, setYouAreHome] = useState(true);
  const [scores, setScores] = useState<WindowScore[]>([]);
  const [picks, setPicks] = useState<RevealedPick[]>([]);
  const [pool, setPool] = useState<Record<string, PoolPlayer>>({});
  const [wallets, setWallets] = useState<{ home: number | null; away: number | null } | null>(null);
  const [teams, setTeams] = useState<Record<number, TeamInfo>>({});
  const [state, setState] = useState<'loading' | 'none' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [weekSel, setWeekSel] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let unsub = () => {};
    let alive = true;
    (async () => {
      try {
        setState('loading');
        const r = leagueId && rosterId != null ? { leagueId, rosterId } : await myRoster(userId);
        if (!alive) return;
        if (!r) { setState('none'); return; }
        const m = await myMatchup(r.leagueId, r.rosterId, weekSel ?? undefined);
        if (!alive) return;
        if (!m) { setMatchup(null); setState('none'); return; }
        setMatchup(m);
        setYouAreHome(m.home_roster_id === r.rosterId);
        const pl = await myPool(r.leagueId, m.week, r.rosterId);
        if (!alive) return;
        setPool(Object.fromEntries(pl.map((p) => [p.slug, p])));
        matchupTeams(r.leagueId, [m.home_roster_id, m.away_roster_id])
          .then((tm) => { if (alive) setTeams(tm); }).catch(() => {});

        const refresh = async () => {
          const [mm, ss, pk, ww] = await Promise.all([
            getMatchup(m.id), getMatchupState(m.id), getRevealedPicks(m.id),
            matchupWallets(m.id).catch(() => null),
          ]);
          if (!alive) return;
          if (mm) setMatchup(mm);
          setScores(ss); setPicks(pk); setWallets(ww);
        };
        await refresh();
        if (!alive) return;
        setState('ready');
        // Realtime push on any score/status write — no polling interval.
        unsub = subscribeMatchup(m.id, refresh);
      } catch {
        // A network failure once left the web board stuck on "Loading…" forever.
        // Surface it with a retry instead.
        if (alive) setState('error');
      }
    })();
    return () => { alive = false; unsub(); };
  }, [userId, leagueId, rosterId, weekSel, attempt]);

  const totals = useMemo(() => {
    const home = scores.reduce((n, s) => n + Number(s.home_score), 0);
    const away = scores.reduce((n, s) => n + Number(s.away_score), 0);
    return { you: youAreHome ? home : away, them: youAreHome ? away : home };
  }, [scores, youAreHome]);

  const week = matchup?.week ?? weekSel ?? 1;

  // Window LABELS come from the week's own derived windows, not the
  // regular-season default — preseason clusters differently, and a static list
  // renders a preseason window as its raw id.
  const winLabel = useCallback((id: string) => {
    const w = windowsForWeek(week).find((x) => x.id === id);
    return w?.label ?? id.toUpperCase();
  }, [week]);

  const WeekNav = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <LinkButton label="‹" onPress={() => week > 1 && setWeekSel(Math.max(1, week - 1))} />
      <Mono size={10} weight="700" track={0.06}>{weekLabel(week)}</Mono>
      <LinkButton label="›" onPress={() => week < REG_SEASON_WEEKS && setWeekSel(Math.min(REG_SEASON_WEEKS, week + 1))} />
    </View>
  );

  if (state === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={11}>Loading the board…</Mono>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, justifyContent: 'center' }}>
        <Card>
          <Display size={18}>Couldn’t load the board</Display>
          <Mono size={10.5} style={{ marginTop: 10 }}>Check your connection and try again.</Mono>
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
            <Display size={17} style={{ flex: 1 }}>No week {week} matchup</Display>
            <WeekNav />
          </View>
          <Mono size={10.5} style={{ marginTop: 10 }}>Use ‹ › to page through the season, or check back once the schedule syncs.</Mono>
          <View style={{ alignItems: 'center', marginTop: 14 }}><LinkButton label="← back" onPress={onBack} /></View>
        </Card>
      </View>
    );
  }

  const status = matchup!.status;
  const mine = picks.filter((p) => p.app_user_id === userId);
  const theirs = picks.filter((p) => p.app_user_id !== userId);
  const myCoin = youAreHome ? matchup!.home_coin : matchup!.away_coin;
  const theirCoin = youAreHome ? matchup!.away_coin : matchup!.home_coin;
  const myBank = youAreHome ? wallets?.home : wallets?.away;
  const theirBank = youAreHome ? wallets?.away : wallets?.home;
  const myTeam = teams[youAreHome ? matchup!.home_roster_id : matchup!.away_roster_id];
  const oppTeam = teams[youAreHome ? matchup!.away_roster_id : matchup!.home_roster_id];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={t.you}
          onRefresh={() => { setRefreshing(true); setAttempt((a) => a + 1); setTimeout(() => setRefreshing(false), 600); }}
        />
      }
    >
      <Card style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Display size={15} style={{ flex: 1 }}>{weekLabel(matchup!.week)} · live board</Display>
          <WeekNav />
        </View>
        <View style={{ alignSelf: 'flex-start', marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 }}>
          <Mono size={9} tone={status === 'final' ? 'dim' : status === 'scheduled' ? 'faint' : 'you'}>{status.toUpperCase()}</Mono>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 18, marginTop: 16 }}>
          <Big label="YOU" value={round1(totals.you)} color={t.you} team={myTeam} />
          <Mono size={11} tone="faint" style={{ paddingTop: 16 }}>vs</Mono>
          <Big label="OPP" value={round1(totals.them)} color={t.opp} team={oppTeam} />
        </View>

        {status === 'scheduled' && (
          <Mono size={9.5} tone="faint" style={{ textAlign: 'center', marginTop: 8 }}>Scores start ticking after kickoff.</Mono>
        )}
        {(myCoin != null || theirCoin != null) && (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 8 }}>
            <Mono size={9.5} tone="you">◇ {round1(Number(myCoin ?? 0))} this week</Mono>
            <Mono size={9.5} tone="opp">◇ {round1(Number(theirCoin ?? 0))}</Mono>
          </View>
        )}
        {(myBank != null || theirBank != null) && (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 4 }}>
            <Mono size={9.5} tone="you">◆ {round1(Number(myBank ?? 0))} banked</Mono>
            <Mono size={9.5} tone="opp">◆ {round1(Number(theirBank ?? 0))}</Mono>
          </View>
        )}
      </Card>

      {scores.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <Mono size={10} weight="700" track={0.12} style={{ marginBottom: 8 }}>BY WINDOW</Mono>
          {[...scores].sort((a, b) => a.game_window.localeCompare(b.game_window)).map((s) => {
            const you = Number(youAreHome ? s.home_score : s.away_score);
            const them = Number(youAreHome ? s.away_score : s.home_score);
            return (
              <View key={s.game_window} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
                <Text style={{ width: 54, textAlign: 'right', fontSize: 14, fontWeight: '700', color: you >= them ? t.you : t.text }}>{round1(you)}</Text>
                <Mono size={10} style={{ flex: 1, textAlign: 'center' }}>{winLabel(s.game_window)}</Mono>
                <Text style={{ width: 54, fontSize: 14, fontWeight: '700', color: them > you ? t.opp : t.text }}>{round1(them)}</Text>
              </View>
            );
          })}
        </Card>
      )}

      <Duel
        mine={mine} theirs={theirs} pool={pool} scores={scores}
        youAreHome={youAreHome} status={status} week={week} winLabel={winLabel}
      />

      <View style={{ alignItems: 'center', marginTop: 14 }}><LinkButton label="← back" onPress={onBack} /></View>
    </ScrollView>
  );
}

function Big({ label, value, color, team }: { label: string; value: number; color: string; team?: TeamInfo }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', minWidth: 100 }}>
      <Mono size={9} tone="faint" track={0.12}>{label}</Mono>
      <Text style={{ fontSize: 38, fontWeight: '700', color, lineHeight: 44 }}>{value}</Text>
      {!!team?.team_name && (
        <Text numberOfLines={1} style={{ fontSize: 10, color: t.dim, maxWidth: 130, textAlign: 'center' }}>{team.team_name}</Text>
      )}
    </View>
  );
}

/** The card duel: one pod per game window, your cards paired against theirs.
 *
 *  The web lays this out as three columns (you | score | them). A phone is too
 *  narrow for that, so pairs stack vertically instead — the same pairing the
 *  setup board uses, which also keeps the two screens visually consistent.
 *
 *  The sealed-back count MIRRORS YOUR OWN card count, never the opponent's real
 *  one. Showing their true count before reveal would leak how many slots they
 *  filled in a window, which is information the game deliberately withholds. */
function Duel({ mine, theirs, pool, scores, youAreHome, status, week, winLabel }: {
  mine: RevealedPick[];
  theirs: RevealedPick[];
  pool: Record<string, PoolPlayer>;
  scores: WindowScore[];
  youAreHome: boolean;
  status: string;
  week: number;
  winLabel: (id: string) => string;
}) {
  const t = useTheme();
  const youSide = youAreHome ? 'home' : 'away';
  const oppSide = youAreHome ? 'away' : 'home';

  // Ordered by the week's OWN windows; anything unrecognised sorts to the end
  // rather than disappearing.
  const order = windowsForWeek(week).map((w) => String(w.id));
  const wins = [...new Set([...mine, ...theirs].map((p) => p.game_window).concat(scores.map((s) => s.game_window)))]
    .sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });

  // A reveal is a TRANSITION, not a state, and the board is the only thing that
  // can tell them apart. Every card here remounts constantly — a realtime tick,
  // a pull-to-refresh, switching tabs — so a card that animated on mount would
  // replay the reveal every time you glanced at the board, which is precisely
  // how a moment stops being one. These sets remember what was already on the
  // table; only a slot that was NOT there last pass gets to flip.
  //
  // Deliberately computed during render, not in an effect. The flip has to be
  // known at the card's first mount — an effect fires a frame late, by which
  // point the card has already dealt itself in and the flip becomes a second
  // entrance for the same event. Mutating a ref mid-render is the trade; under a
  // double-invoking StrictMode the second pass would see the key as already
  // seen, so the cost is a skipped animation, never wrong data on the board.
  const seenFaces = useRef<Set<string> | null>(null);
  const seenNukes = useRef<Set<string>>(new Set());
  const firstPaint = seenFaces.current === null;
  if (firstPaint) seenFaces.current = new Set();

  /** True the first time this slot appears face-up — but never on first paint,
   *  where every card is arriving at once and deals in instead. */
  const justRevealed = (key: string): boolean => {
    const seen = seenFaces.current!;
    if (seen.has(key)) return false;
    seen.add(key);
    return !firstPaint;
  };

  /** True the first time the worker reports this slot nuked. A nuke stays true
   *  on the row for the rest of the week, so without this the burst would fire
   *  again on every refresh. */
  const justNuked = (key: string, nuked: boolean): boolean => {
    if (!nuked) return false;
    if (seenNukes.current.has(key)) return false;
    seenNukes.current.add(key);
    return true;
  };

  const rowOf = (p: RevealedPick, side: 'home' | 'away') =>
    scores.find((x) => x.game_window === p.game_window)?.slot_scores
      ?.find((r) => r.side === side && (r.slot === p.roster_slot || (!!p.player_slug && r.slug === p.player_slug)));

  const faceFor = (p: RevealedPick, side: 'home' | 'away', accent: string, idx: number) => {
    const player = p.player_slug ? pool[p.player_slug] : null;
    const key = `${p.game_window}-${p.roster_slot}-${side}`;
    if (!player) return <CardBack key={key} idx={idx} />;
    const metric = metricById(player.pos as Pos, p.metric_id);
    const row = rowOf(p, side);
    return (
      <CardFace
        key={key} idx={idx}
        slug={player.slug} name={player.full} pos={player.pos} team={slugTeam(player)}
        metric={metric?.name ?? p.metric_id ?? null}
        bank={row ? round1(Number(row.score)) : null}
        accent={accent}
        flip={justRevealed(key)}
        hot={!!row?.hot}
        nuked={justNuked(key, !!row?.nuked)}
      />
    );
  };

  return (
    <>
      {wins.map((win) => {
        const my = mine.filter((p) => p.game_window === win);
        const th = theirs.filter((p) => p.game_window === win);
        const s = scores.find((x) => x.game_window === win);
        if (!my.length && !th.length && !s) return null;
        const you = s ? round1(Number(youAreHome ? s.home_score : s.away_score)) : null;
        const them = s ? round1(Number(youAreHome ? s.away_score : s.home_score)) : null;
        const sealedBacks = !th.length && status !== 'final' ? Math.max(my.length, 1) : 0;
        const hasRows = !!s?.slot_scores?.length;
        const st = status === 'final' ? 'FINAL' : sealedBacks > 0 && !hasRows ? 'SEALED' : status === 'live' ? '● LIVE' : 'SEALED';
        const pairs = Math.max(my.length, th.length, sealedBacks);

        return (
          <Card key={win} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Mono size={10} weight="700" track={0.12}>{winLabel(win)}</Mono>
              {/* The web pulses this chip with ct-livepulse. Only while the
                  window is actually live — a permanent pulse is just chrome. */}
              <View>
                {st === '● LIVE' && <LivePulse color={t.you} />}
                <Mono size={9} weight="700" tone={st === '● LIVE' ? 'you' : 'faint'}>{st}</Mono>
              </View>
            </View>

            {(you != null || them != null) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 10 }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: t.you }}>{you ?? '—'}</Text>
                <Mono size={9} tone="faint" track={0.12}>VS</Mono>
                <Text style={{ fontSize: 20, fontWeight: '700', color: t.opp }}>{them ?? '—'}</Text>
              </View>
            )}

            <View style={{ gap: 10, backgroundColor: FELT, borderRadius: 8, padding: 10 }}>
              {Array.from({ length: pairs }, (_, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  {my[i] ? faceFor(my[i], youSide, t.you, i) : <CardBack label="—" idx={i} />}
                  {th[i] ? faceFor(th[i], oppSide, t.opp, i) : <CardBack idx={i} />}
                </View>
              ))}
            </View>
          </Card>
        );
      })}
    </>
  );
}

/** Pool entries carry no team; resolve it the same way the setup board does. */
function slugTeam(p: PoolPlayer): string {
  return slugMeta(p.slug).team;
}
