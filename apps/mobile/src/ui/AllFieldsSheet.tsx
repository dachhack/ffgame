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
import { RefreshControl, ScrollView } from 'react-native';
import { liveSlate, slateWeeks, weekGameFeeds, weekLivePlays, type GameFeedRow } from '@drip/core/data/liveApi';
import { setRuntimeSlate, windowsForWeek, windowForTeam, weekLabel } from '@drip/core/data/nflSlate';
import type { WindowId } from '@drip/core/types';
import { setLiveGameFeed, feedRowsToWeek, groupFieldGames } from '@drip/core/data/gameFeed';
import { fieldsWeekFrom } from '@drip/core/data/fieldsWeek';
import { LIVE_SEASON, setLivePlays, liveRowsToPbp } from '@drip/core/data/realPbp';
import { useTheme } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';
import { FieldsList } from './FieldsList';

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
    // Feeds AND plays (v0.390.7): the Game view's box score, carrier
    // headshots and the people on each play read the week's plays, which
    // only a board used to install.
    const [gf, lp] = await Promise.all([weekGameFeeds(w).catch(() => [] as GameFeedRow[]), weekLivePlays(w).catch(() => [])]);
    setLiveGameFeed(w, feedRowsToWeek(gf));
    if (lp.length) setLivePlays(w, liveRowsToPbp(lp));
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
    <Overlay visible={visible} title="All fields"
      subtitle={week != null ? `${weekLabel(week).toUpperCase()} · TAP A GAME FOR ITS VIEW · LIVE DRIVES` : 'EVERY GAME THIS WEEK · LIVE DRIVES'}
      onClose={onClose}>
      {/* ALL FIELDS first (v0.390.8, founder): every game stacked, the reader
          on the 🔊 one; tap a game and FieldsList swaps in its Game view —
          strip, scoreboard, field, tabs — with ▦ ALL FIELDS to come back.
          Pull to refresh re-pulls the feeds. */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={t.you} colors={[t.you]} />}>
        {feeds == null && <Mono size={10.5} tone="dim" style={{ textAlign: 'center', paddingVertical: 16 }}>Loading the week…</Mono>}
        {week != null && feeds != null && <FieldsList week={week} games={games} empty="No games on the live feed yet." />}
      </ScrollView>
    </Overlay>
  );
}
