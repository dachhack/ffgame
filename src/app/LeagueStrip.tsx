// THE LEAGUE STRIP (v0.288.0) — the web's copy of the app's top row.
//
// Founder: "Let's have the same top row as on the app. League, Match up, My
// team, chat chip."
//
// The app has drawn this since it had leagues: an open league puts its NAME on
// one row and the ROOM CHIPS on the row beneath, above whatever room you are
// looking at. The web navigated per-view with no persistent strip, so the hub
// carried its rooms as tiles instead — which is why MATCHUP and CHAT were tiles
// there and are not on the app.
//
// It sits inside LiveOnboard's shell, under the DRIP FANTASY header, so it is
// present on every league room the web has: the hub, the team desk, the draft
// room, results, and the commissioner's console.
//
// THE ONE ROOM WITHOUT IT is the matchup board. That is its own top-level route
// with its own full-bleed chrome (`#/matchup/:week`, rendered by App.tsx, not by
// LiveOnboard), and the ▦ MATCHUP chip is the way INTO it. Putting a name-plus-
// chips band above a live game board is a layout decision about the board, not
// about this strip, so it isn't made here.
//
// WHICH CHIPS EXIST is the app's rule set, not a second one:
//   🏠 LEAGUE   always — the hub is the league's front door
//   ▦ MATCHUP   only with a seat; no roster, no lineup to set
//   ⛏ DRAFT     native only, and only while there is a draft to run
//   ⇄ MY TEAM   native + a seat (rosters/waivers/trades all live in here)
//   💬          always, for every member of any league (0147) — the ICON alone,
//               bigger for it, which is what buys the row its width back
import { useEffect, useState } from 'react';
import { ChatPanel } from './chat';
import { chatUnread, leagueSignals, nativeTeamState } from '@drip/core/data/liveApi';

export type StripRoom = 'home' | 'matchup' | 'draft' | 'team';

export function LeagueStrip({ leagueId, name, rosterId, native, here, onGo }: {
  leagueId: string;
  name: string;
  /** null when this account has no seat: no lineup and no team desk. */
  rosterId: number | null;
  native: boolean;
  /** Which chip reads as current. null on rooms the strip doesn't name (the
   *  commissioner's console, the results table) — nothing is lit, and the strip
   *  is still the way out of them. */
  here: StripRoom | null;
  onGo: (room: StripRoom) => void;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState<{ n: number; mention: boolean }>({ n: 0, mention: false });
  // The ⛏ DRAFT chip leaves once the draft is done — the room stays reachable
  // from the hub's tile, which is the record after draft night (v0.269.0).
  // Defaults to SHOWN until the answer lands: a live draft with no way in is a
  // worse failure than a finished one briefly offering itself.
  const [draftDone, setDraftDone] = useState(false);
  useEffect(() => {
    let dead = false;
    // The dot means "something in chat wants you", which is unread messages OR a
    // poll you haven't voted in — the hub's chat tile carried both as badges and
    // an icon-only chip has room for one signal, so they merge into it.
    chatUnread(leagueId)
      .then((r) => { if (!dead && r.ok) setUnread((u) => ({ n: u.n + (r.league ?? 0) + (r.dm ?? 0), mention: u.mention || (r.mention ?? 0) > 0 })); })
      .catch(() => {});
    leagueSignals(leagueId)
      .then((r) => { if (!dead && r.ok && (r.polls_unvoted ?? 0) > 0) setUnread((u) => ({ ...u, n: u.n + (r.polls_unvoted ?? 0) })); })
      .catch(() => {});
    if (native) {
      nativeTeamState(leagueId)
        .then((t) => { if (!dead) setDraftDone(t?.draft_status === 'complete'); })
        .catch(() => {});
    }
    return () => { dead = true; };
  }, [leagueId, native]);

  const chips: { id: StripRoom | 'chat'; label: string; show: boolean }[] = [
    { id: 'home', label: '🏠 LEAGUE', show: true },
    { id: 'matchup', label: '▦ MATCHUP', show: rosterId != null },
    { id: 'draft', label: '⛏ DRAFT', show: native && !draftDone },
    { id: 'team', label: '⇄ MY TEAM', show: native && rosterId != null },
    { id: 'chat', label: '💬', show: true },
  ];

  return (
    <>
      {/* TWO ROWS, ALWAYS — the same fix the app took in v0.287.0. Sharing one
          row means the wrap lands wherever the league's name happens to end, so
          a long name strands one chip up top and a short one strands three. */}
      <div style={{ marginBottom: 12 }}>
        <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 7 }}>
          {chips.filter((c) => c.show).map((c) => {
            const isChat = c.id === 'chat';
            const on = isChat ? chatOpen : here === c.id;
            return (
              <button key={c.id}
                onClick={() => {
                  if (isChat) { setChatOpen(true); setUnread({ n: 0, mention: false }); return; }
                  onGo(c.id as StripRoom);
                }}
                aria-label={isChat ? (unread.n > 0 ? `Chat — ${unread.n} unread${unread.mention ? ', you were mentioned' : ''}` : 'Chat') : undefined}
                aria-current={on ? 'page' : undefined}
                className={isChat ? undefined : 'mono'}
                style={{
                  position: 'relative',
                  border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 6,
                  background: on ? 'color-mix(in srgb, var(--you) 12%, var(--surface))' : 'var(--surface)',
                  color: on ? 'var(--you)' : 'var(--dim)',
                  padding: isChat ? '3px 9px' : '6px 10px',
                  fontSize: isChat ? 15 : 9, fontWeight: 700, letterSpacing: isChat ? undefined : '0.06em',
                  lineHeight: isChat ? 1.25 : undefined, cursor: 'pointer',
                }}>
                {c.label}
                {/* ── ONE RED DOT (v0.327.0) ───────────────────────────────
                    Founder: "let's get a tiny red dot on the chat icon when
                    there are unread messages." The dot existed, and was
                    `var(--you)` — the accent teal — unless the unread happened
                    to mention you, which made "somebody wrote in the league"
                    the same colour as every lit chip and every live number on
                    the screen. A notification has to be the one thing on a page
                    that is that colour.
                    Consistent with v0.292.0's league card, where the founder
                    asked for the same thing in the same words: one red dot. */}
                {isChat && unread.n > 0 && (
                  <span aria-hidden
                    style={{ position: 'absolute', top: -3, right: -3, minWidth: 8, height: 8, borderRadius: 999, background: 'var(--opp)' }} />
                )}
              </button>
            );
          })}
        </div>
      </div>
      {chatOpen && <ChatPanel leagueId={leagueId} onClose={() => setChatOpen(false)} />}
    </>
  );
}
