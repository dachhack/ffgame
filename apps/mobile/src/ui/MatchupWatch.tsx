// WATCHING A MATCHUP YOU ARE NOT IN (v0.739.0). Founder, on the Drip board:
// "I think we need a way for players to browse to other matchups happening in
// the league this week." And how much a league-mate sees: "Full board after
// kickoff."
//
// Read only by construction: this screen has no picker, no hand and no shop —
// it reads the worker's published window rows (matchup_state, open to the
// league since 0532) and draws them with the board's own Duel. A window that
// has not kicked off has published nothing, so it is listed as sealed; no
// pick and no power-up is read at all.
//
// The week's slate, plays and game feeds are module state the board installed
// for this same week before it could open this sheet, so the fields and the
// stat lines resolve without a second fetch.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import {
  getMatchup, getMatchupState, matchupTeams, myPool, subscribeMatchup,
  type LiveMatchup, type PoolPlayer, type TeamInfo, type WindowScore,
} from '@drip/core/data/liveApi';
import { windowsForWeek, windowDateLabel, windowTimeLabel, windowPhase } from '@drip/core/data/nflSlate';
import { watchBoard, watchSealedWindows } from '@drip/core/data/matchupWatch';
import { liveTeamFor } from '@drip/core/data/slugMeta';
import { gameFeedFor } from '@drip/core/data/gameFeed';
import { LIVE_SEASON } from '@drip/core/data/realPbp';
import { statlineAt, metricDriver } from '@drip/core/engine/sim';
import type { Player, Pos } from '@drip/core/types';
import { useTheme } from '../theme.native';
import { Card, Mono } from './prims';
import { Duel } from './Duel';
import { FieldView } from './FieldView';

const ZERO_STATS = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const asPlayer = (p: PoolPlayer): Player => ({ id: p.slug, name: p.full, full: p.full, pos: p.pos as Pos, team: liveTeamFor(p.slug, p.team, LIVE_SEASON), stats: { ...ZERO_STATS } });

export function MatchupWatch({ leagueId, matchupId, userId, onOpenSlate }: {
  leagueId: string; matchupId: string;
  /** The signed-in account — lights the ★ on a player card opened from here. */
  userId: string;
  onOpenSlate?: (win: string) => void;
}) {
  const t = useTheme();
  const [m, setM] = useState<LiveMatchup | null>(null);
  const [scores, setScores] = useState<WindowScore[]>([]);
  const [teams, setTeams] = useState<Record<number, TeamInfo>>({});
  const [pool, setPool] = useState<Record<string, PoolPlayer>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowTs(Date.now()), 30_000); return () => clearInterval(id); }, []);

  useEffect(() => {
    let alive = true;
    let unsub = () => {};
    setState('loading'); setM(null); setScores([]); setPool({});
    (async () => {
      try {
        const mm = await getMatchup(matchupId);
        if (!alive) return;
        if (!mm) { setState('error'); return; }
        setM(mm);
        matchupTeams(leagueId, [mm.home_roster_id, mm.away_roster_id]).then((tm) => { if (alive) setTeams(tm); }).catch(() => {});
        // Both rosters, for the names on the cards. A league that seals its
        // rosters answers nothing here and the card falls back to the slug.
        Promise.all([myPool(leagueId, mm.week, mm.home_roster_id).catch(() => []), myPool(leagueId, mm.week, mm.away_roster_id).catch(() => [])])
          .then(([h, a]) => { if (alive) setPool(Object.fromEntries([...a, ...h].map((p) => [p.slug, p]))); }).catch(() => {});
        const refresh = async () => {
          const [m2, ss] = await Promise.all([getMatchup(matchupId), getMatchupState(matchupId)]);
          if (!alive) return;
          if (m2) setM(m2);
          setScores(ss);
        };
        await refresh();
        if (!alive) return;
        unsub = subscribeMatchup(matchupId, () => { refresh().catch(() => {}); });
        setState('ready');
      } catch { if (alive) setState('error'); }
    })();
    return () => { alive = false; unsub(); };
  }, [leagueId, matchupId]);

  const week = m?.week ?? 0;
  const order = useMemo(() => (week ? windowsForWeek(week).map((w) => String(w.id)) : []), [week]);
  const board = useMemo(() => watchBoard(scores, order), [scores, order]);
  const sealed = useMemo(() => watchSealedWindows(scores, order), [scores, order]);

  if (state === 'loading') return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={t.you} /></View>;
  if (state === 'error' || !m) return <Mono size={10.5} style={{ padding: 20 }}>This matchup could not be read. Pull down the sheet and try again.</Mono>;

  const homeName = teams[m.home_roster_id]?.team_name || `Seat ${m.home_roster_id}`;
  const awayName = teams[m.away_roster_id]?.team_name || `Seat ${m.away_roster_id}`;
  const final = m.status === 'final';
  const winLabel = (id: string) => windowsForWeek(week).find((w) => String(w.id) === id)?.label ?? id.toUpperCase();
  const cellOf = (win: string, slot: string, side: 'home' | 'away') => board.windows.find((w) => w.win === win)?.spots.find((s) => s.slot === slot)?.[side] ?? null;

  /** The real NFL game(s) under one pair — the board's own rule: one field per
   *  game, so two players in the same game do not stack it twice. */
  const slotDetail = (win: string, slot: string) => {
    const seen = new Set<string>();
    const fields = (['home', 'away'] as const)
      .map((sd) => { const sl = cellOf(win, slot, sd)?.slug; return sl ? liveTeamFor(sl, pool[sl]?.team, LIVE_SEASON) : ''; })
      .filter((tm) => {
        if (!tm) return false;
        const f = gameFeedFor(week, tm);
        if (!f || seen.has(f.key)) return false;
        seen.add(f.key);
        return true;
      });
    if (!fields.length) return null;
    return <View style={{ gap: 6 }}>{fields.map((tm) => <FieldView key={tm} week={week} team={tm} clock={Number.MAX_SAFE_INTEGER} />)}</View>;
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      <Card style={{ marginBottom: 10, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Mono size={8.5} tone="faint" track={0.1}>WATCHING · READ ONLY</Mono>
          <Mono size={9} weight="700" tone={m.status === 'live' ? 'you' : 'faint'} track={0.08}>{final ? 'FINAL' : m.status === 'live' ? '● LIVE' : 'NOT STARTED'}</Mono>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{homeName}</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: t.you }}>{board.home.toFixed(1)}</Text>
          </View>
          <Mono size={9} tone="faint">vs</Mono>
          <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{awayName}</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: t.opp }}>{board.away.toFixed(1)}</Text>
          </View>
        </View>
      </Card>

      {/* The published windows, on the board's own duel cards. Both sides come
          out of the worker's rows (Duel's srvSidePicks), so `mine` and `theirs`
          are empty on purpose: this viewer holds no pick of either side. */}
      <Duel
        mine={[]} theirs={[]} pool={pool} scores={scores}
        youAreHome status={m.status} week={week} winLabel={winLabel} userId={userId}
        sides={{ you: homeName, them: awayName }}
        winStatus={(id) => windowPhase(week, id as never, nowTs, { matchupFinal: final }) === 'final' ? 'FINAL' : null}
        onOpenSlate={onOpenSlate}
        slotDetail={slotDetail}
        liveExtras={(win, slot, who) => {
          const c = cellOf(win, slot, who === 'you' ? 'home' : 'away');
          const pl = c?.slug ? pool[c.slug] : null;
          if (!c || !pl) return null;
          const player = asPlayer(pl);
          const d = metricDriver(player.pos, c.metric, statlineAt(player, week, Number.MAX_SAFE_INTEGER, c.metric ?? undefined));
          return d ? { stat: d } : null;
        }}
      />

      {/* What has not kicked off: named, so the board is not mysteriously short. */}
      {sealed.map((id) => {
        const ph = windowPhase(week, id as never, nowTs, { matchupFinal: final });
        const waiting = ph === 'setup' || ph === 'locked';
        return (
          <Card key={id} style={{ marginBottom: 10, opacity: 0.75 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <Mono size={13} weight="700" track={0.06}>{winLabel(id)}</Mono>
              <Mono size={9} tone="mid">{windowDateLabel(week, id as never)}</Mono>
              <Mono size={9} tone="faint">{windowTimeLabel(week, id as never)}</Mono>
              <View style={{ flex: 1 }} />
              <Mono size={9} weight="700" tone={waiting ? 'warn' : 'faint'}>{waiting ? '🔒 SEALED · shows at kickoff' : 'NOTHING PLAYED'}</Mono>
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}
