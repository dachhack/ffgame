// Unread-chat badges (0183) — the founder's "notification dot on the league
// and the chat chip". One hook polls chat_unread (the badge RPC — never marks
// read) on the badge cadence; two small renderers wear it:
//
//   • ChatChipDot — the room bar's corner dot on CHAT, hidden while the chat
//     room is open (you're looking at it) and cleared by the next poll after
//     reading.
//
// THE LEAGUE CARD'S OWN PILLS LEFT IN v0.356.16 (founder: "Avatar, league
// name, built text of league type, drafting if drafting. That's all we need").
// CardUnreadPill and CardSignalPills — the alarm, offer, poll, waiver and
// commissioner-queue badges — went with them; the room bar carries chat's dot
// inside the league and the hub carries the rest, so nothing here was the only
// place a signal lived.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { chatUnread } from '@drip/core/data/liveApi';
import { useTheme } from '../theme.native';

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

