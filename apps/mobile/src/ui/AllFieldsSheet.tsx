// ▦ ALL FIELDS, off any board (v0.390.0).
//
// Founder: "Let's put fields on the upper left at the top of the my leagues
// page in the app and on the web experiences." The All fields sheet lived on
// the board and borrowed the board's week, slate and feeds. This one stands
// alone: it asks the slate which week the fields should show (core
// fieldsWeekFrom — what's on now, or what just happened), installs that
// week's slate and game feeds itself, and lists every game in schedule
// order. Pull to refresh, and a 30s tick while open, keep the drives live.
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { liveSlate, slateWeeks, weekGameFeeds, type GameFeedRow } from '@drip/core/data/liveApi';
import { setRuntimeSlate, windowsForWeek, windowForTeam, weekLabel } from '@drip/core/data/nflSlate';
import type { WindowId } from '@drip/core/types';
import { setLiveGameFeed, feedRowsToWeek, groupFieldGames } from '@drip/core/data/gameFeed';
import { fieldsWeekFrom } from '@drip/core/data/fieldsWeek';
import { LIVE_SEASON } from '@drip/core/data/realPbp';
import { useTheme } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';
import { GameViewBody } from './GameView';

export function AllFieldsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const [week, setWeek] = useState<number | null>(null);
  const [feeds, setFeeds] = useState<GameFeedRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (wk?: number | null) => {
    let w = wk ?? week;
    if (w == null) {
      const rows = await slateWeeks(String(LIVE_SEASON)).catch(() => []);
      w = fieldsWeekFrom(rows, Date.now());
      if (w == null) { setFeeds([]); return; }
      const slate = await liveSlate(w, String(LIVE_SEASON)).catch(() => []);
      setRuntimeSlate(w, slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId, kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined })));
      setWeek(w);
    }
    const gf = await weekGameFeeds(w).catch(() => [] as GameFeedRow[]);
    setLiveGameFeed(w, feedRowsToWeek(gf));
    setFeeds(gf);
  }, [week]);

  useEffect(() => {
    if (!visible) return;
    void load();
    const id = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(id);
  }, [visible, load]);

  const onPull = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };
  const wins = week != null ? windowsForWeek(week) : [];
  const winLabelFor = (id: string) => wins.find((w) => String(w.id) === id)?.label ?? id.toUpperCase();
  const games = week != null && feeds ? groupFieldGames(week, []).map((g) => ({
    key: g.feed.key, away: g.feed.away, home: g.feed.home, team: g.feed.home, label: winLabelFor(String(windowForTeam(week, g.feed.home))),
  })) : [];

  return (
    <Overlay visible={visible} title="Fields"
      subtitle={week != null ? `${weekLabel(week).toUpperCase()} · TAP A GAME · LIVE DRIVES` : 'EVERY GAME THIS WEEK · LIVE DRIVES'}
      onClose={onClose}>
      {/* The Game view (v0.390.3): the week's games as a strip, one game
          below it — Sleeper's shape. Pull to refresh re-pulls the feeds. */}
      {feeds == null
        ? <ScrollView contentContainerStyle={{ padding: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={t.you} colors={[t.you]} />}>
            <Mono size={10.5} tone="dim" style={{ textAlign: 'center', paddingVertical: 16 }}>Loading the week…</Mono>
          </ScrollView>
        : week != null && (
          <View style={{ flex: 1 }}>
            {games.length === 0 && <Mono size={10.5} tone="dim" style={{ textAlign: 'center', paddingVertical: 16 }}>No games on the live feed yet.</Mono>}
            {games.length > 0 && <GameViewBody week={week} initialKey={games[0]?.key ?? null} />}
          </View>
        )}
    </Overlay>
  );
}
