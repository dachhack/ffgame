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
import { chatUnread } from '@drip/core/data/liveApi';
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

export function ChatChipDot({ leagueId, active }: { leagueId: string; active: boolean }) {
  const t = useTheme();
  const u = useChatUnread(leagueId);
  if (active || u.n === 0) return null;
  return <View style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: u.mention ? t.warn : t.you }} />;
}
