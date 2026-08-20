// Unread-chat badges (0183) — the founder's "notification dot on the league
// and the chat chip". One hook polls chat_unread (the badge RPC — never marks
// read) on the badge cadence; two small renderers wear it:
//
//   • CardUnreadPill — the league list card's 💬 N pill (@ N when mentioned)
//   • ChatChipDot — the tab strip's corner dot on 💬 CHAT, hidden while the
//     chat tab is open (you're looking at it) and cleared by the next poll
//     after reading.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { chatUnread, leagueTrades, myMatchup, defaultOpenWeek, leagueSignals } from '@drip/core/data/liveApi';
import { lineupAlarmFor, alarmLabel, type LineupAlarm } from '@drip/core/data/lineupAlarm';
import { PRESEASON_BASE } from '@drip/core/data/nflSlate';
import { useTheme, alpha, MONO } from '../theme.native';

export function useChatUnread(leagueId: string | null): { n: number; mention: boolean } {
  const [u, setU] = useState<{ n: number; mention: boolean }>({ n: 0, mention: false });
  useEffect(() => {
    if (!leagueId) return;
    let dead = false;
    const poll = () => chatUnread(leagueId)
      .then((r) => { if (!dead && r.ok) setU({ n: (r.league ?? 0) + (r.dm ?? 0), mention: (r.mention ?? 0) > 0 }); })
      .catch(() => {});
    void poll();
    const id = setInterval(poll, 60_000);
    return () => { dead = true; clearInterval(id); };
  }, [leagueId]);
  return u;
}

export function CardUnreadPill({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const u = useChatUnread(leagueId);
  if (u.n === 0) return null;
  return (
    <View style={{ backgroundColor: u.mention ? t.warn : alpha(t.you, 14), borderWidth: StyleSheet.hairlineWidth, borderColor: u.mention ? t.warn : t.you, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: u.mention ? t.onAccent : t.you }}>
        💬 {u.mention ? '@ ' : ''}{u.n > 99 ? '99+' : u.n}
      </Text>
    </View>
  );
}

/** ONE RED DOT on the chat chip (v0.327.0). Founder: "let's get a tiny red dot
 *  on the chat icon when there are unread messages."
 *
 *  It was `t.you` — the accent — unless the unread happened to mention you,
 *  which made "somebody wrote in the league" the same colour as every lit chip
 *  and live number on the screen. A notification has to be the one thing that
 *  colour. Matches the web strip and v0.292.0's league card, where the founder
 *  asked for the same thing in the same words. */
export function ChatChipDot({ leagueId, active }: { leagueId: string; active: boolean }) {
  const t = useTheme();
  const u = useChatUnread(leagueId);
  if (active || u.n === 0) return null;
  return <View style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: t.opp }} />;
}


// ── league signals (0184): lineup alarms + trade offers on the league card ──

interface LeagueSignals {
  alarm: LineupAlarm | null; offers: number;
  polls: number; waivers: number;
  commish: { waiting: number; review: number } | null;
}

/** The card's non-chat signals, polled on a slower cadence (2 min): the
 *  soonest locks-soon-with-empty-slots window, and native-league trade
 *  offers sitting on YOUR answer. */
export function useLeagueSignals(e: {
  league_id: string; sleeper_roster_id: number; pick_user_id?: string | null;
  native: boolean; season?: string; preseason?: boolean; userId: string;
}): LeagueSignals {
  const [s, setS] = useState<LeagueSignals>({ alarm: null, offers: 0, polls: 0, waivers: 0, commish: null });
  useEffect(() => {
    let dead = false;
    const poll = async () => {
      let alarm: LineupAlarm | null = null;
      let offers = 0;
      let polls = 0; let waivers = 0;
      let commish: { waiting: number; review: number } | null = null;
      const sig = await leagueSignals(e.league_id).catch(() => null);
      if (sig?.ok) {
        polls = sig.polls_unvoted ?? 0;
        waivers = sig.waiver_results ?? 0;
        const c = sig.commish;
        if (c && (c.waiting > 0 || c.review > 0)) commish = c;
      }
      try {
        const week = await defaultOpenWeek(e.league_id, e.season ?? '2026', !!e.preseason)
          .catch(() => (e.preseason ? PRESEASON_BASE + 1 : 1));
        const m = await myMatchup(e.league_id, e.sleeper_roster_id, week).catch(() => null);
        if (m && m.status !== 'final') {
          alarm = await lineupAlarmFor(m.id, m.week, e.pick_user_id ?? e.userId).catch(() => null);
        }
      } catch { /* no alarm is a fine answer */ }
      if (e.native) {
        const ts = await leagueTrades(e.league_id, 30).catch(() => null);
        if (Array.isArray(ts)) offers = ts.filter((t) => t.status === 'pending' && t.to_roster === e.sleeper_roster_id).length;
      }
      if (!dead) setS({ alarm, offers, polls, waivers, commish });
    };
    void poll();
    const id = setInterval(poll, 120_000);
    return () => { dead = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.league_id, e.sleeper_roster_id]);
  return s;
}

/** The alarm + offers pills for a league card's badge row. */
export function CardSignalPills(props: Parameters<typeof useLeagueSignals>[0]) {
  const t = useTheme();
  const { alarm, offers, polls, waivers, commish } = useLeagueSignals(props);
  if (!alarm && offers === 0 && polls === 0 && waivers === 0 && !commish) return null;
  return (
    <>
      {alarm && (
        <View style={{ backgroundColor: t.opp, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.onAccent }}>⚠ {alarmLabel(alarm)}</Text>
        </View>
      )}
      {offers > 0 && (
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.warn }}>⇄ {offers} OFFER{offers === 1 ? '' : 'S'}</Text>
        </View>
      )}
      {polls > 0 && (
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.you }}>📊 {polls} POLL{polls === 1 ? '' : 'S'}</Text>
        </View>
      )}
      {waivers > 0 && (
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.you }}>✚ WAIVERS IN</Text>
        </View>
      )}
      {commish && (
        <View style={{ backgroundColor: alpha(t.warn, 14), borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.warn }}>⚑ {commish.waiting + commish.review} FOR YOU</Text>
        </View>
      )}
    </>
  );
}
