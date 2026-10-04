// THE LEAGUE STRIP (v0.288.0) — THE ROOM BAR (v0.356.8), at every width
// since v0.608.0.
//
// Founder: "can we make the same UI changes to mobile web?" — the app moved
// its rooms to a LinkedIn-style bottom bar (v0.356.0/.6), so on narrow
// screens this component rendered that bar: fixed to the bottom, the active
// room on an accent pill, ducking out of the way as the page scrolls down and
// returning on any pull up. Wide screens kept a top chip row, with icons,
// because a desktop has no thumb to reach for.
//
// ONE BAR, EVERY WIDTH (v0.608.0). Founder: "No icons on desktop web nav..
// keep the nav bar up like on app and mobile web." The chip row is gone: the
// desktop gets the same words-only bar the app and the phone web have, fixed
// to the foot of the page. It stays put on a wide screen (no thumb to make
// room for) and still ducks with the scroll on a phone.
//
// It sits inside LiveOnboard's shell, so it is present on every league room
// the web has: the hub, the team desk, the draft room, results, and the
// commissioner's console — and the matchup board carries it too (its own
// full-bleed route, which draws BoardRoomBar at every width since v0.608.0).
//
// WHICH ROOMS EXIST is the app's rule set, not a second one:
//   LEAGUE    always — the hub is the league's front door
//   MATCHUP   only with a seat; no roster, no lineup to set
//   DRAFT     native only, and only while there is a draft to run
//   MY TEAM   any seat (native: the full desk; external: the read-only page)
//   CHAT      always, for every member of any league (0147)
import { useEffect, useState } from 'react';
import { ChatPanel } from './chat';
import { chatUnread, leagueSignals, nativeTeamState } from '@drip/core/data/liveApi';
import { useWide } from '../screens/adminUi';

export type StripRoom = 'home' | 'matchup' | 'draft' | 'team';

/** Has this league drafted? Remembered per league for the page's lifetime,
 *  because the strip is remounted on every room change and each mount would
 *  otherwise start from nothing and reshuffle the bar under the thumb. Written
 *  only from a real answer, so a miss means "not asked yet", never "no". */
const DRAFT_DONE = new Map<string, boolean>();

export function LeagueStrip({ leagueId, name, rosterId, native, here, onGo, hideName }: {
  leagueId: string;
  name: string;
  /** The hub prints its own identity block (v0.356.9) — the strip stays for
   *  the chips/bar but keeps quiet about the name there. */
  hideName?: boolean;
  /** null when this account has no seat: no lineup and no team desk. */
  rosterId: number | null;
  native: boolean;
  /** Which room reads as current. null on rooms the strip doesn't name (the
   *  commissioner's console, the results table) — nothing is lit, and the
   *  strip is still the way out of them. */
  here: StripRoom | null;
  onGo: (room: StripRoom) => void;
}) {
  const wide = useWide(720);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState<{ n: number; mention: boolean }>({ n: 0, mention: false });
  // THE DRAFT ROOM leaves once the draft is done — it stays reachable from the
  // hub's tile, which is the record after draft night (v0.269.0).
  //
  // null = WE DO NOT KNOW YET, and an unknown room is not drawn (v0.356.14,
  // founder: "the draft icon shows briefly then disappears"). This used to
  // start `false` — show it, then take it away when native_team_state answered
  // — which on a phone meant the bar visibly reshuffled on arrival in every
  // room, because THIS COMPONENT REMOUNTS ON EVERY ROOM CHANGE (LiveOnboard
  // renders it inside each view's own return) and so re-guessed every time.
  // Nothing is lost by waiting: the hub's tile is the other way into the room.
  const [draftDone, setDraftDone] = useState<boolean | null>(() => DRAFT_DONE.get(leagueId) ?? null);
  // The room bar ducks on scroll-down and returns on any pull up — the same
  // two-state hysteresis the app runs (v0.356.1): ~28px of accumulated
  // downward travel hides it, ~12px up shows it, the page top always shows
  // it, and a route jump (a big offset delta) is ignored. Phones only: on a
  // wide screen the bar stays up (v0.608.0, founder: "keep the nav bar up").
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (wide) return;
    let last = window.scrollY, acc = 0, hid = false;
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      const dy = y - last;
      last = y;
      if (Math.abs(dy) > 240) { acc = 0; return; }
      if (y < 40) { acc = 0; if (hid) { hid = false; setHidden(false); } return; }
      if ((dy > 0) !== (acc > 0)) acc = 0;
      acc += dy;
      if (acc > 28 && !hid) { hid = true; setHidden(true); }
      else if (acc < -12 && hid) { hid = false; setHidden(false); }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [wide]);
  // The bar overlays the page bottom — the page reserves the space so no
  // content ends its life underneath it.
  useEffect(() => {
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = '78px';
    return () => { document.body.style.paddingBottom = prev; };
  }, []);

  useEffect(() => {
    let dead = false;
    // The dot means "something in chat wants you": unread messages OR a poll
    // you haven't voted in — one icon, one signal.
    chatUnread(leagueId)
      .then((r) => { if (!dead && r.ok) setUnread((u) => ({ n: u.n + (r.league ?? 0) + (r.dm ?? 0), mention: u.mention || (r.mention ?? 0) > 0 })); })
      .catch(() => {});
    leagueSignals(leagueId)
      .then((r) => { if (!dead && r.ok && (r.polls_unvoted ?? 0) > 0) setUnread((u) => ({ ...u, n: u.n + (r.polls_unvoted ?? 0) })); })
      .catch(() => {});
    if (native) {
      // Seed from what the last mount learned so the answer is already in hand
      // on arrival, then refresh — a draft that completes mid-session still
      // takes the room away without a reload.
      setDraftDone(DRAFT_DONE.get(leagueId) ?? null);
      nativeTeamState(leagueId)
        .then((t) => {
          const done = t?.draft_status === 'complete';
          DRAFT_DONE.set(leagueId, done);
          if (!dead) setDraftDone(done);
        })
        .catch(() => {});
    }
    return () => { dead = true; };
  }, [leagueId, native]);

  const rooms: { id: StripRoom | 'chat'; label: string; show: boolean }[] = [
    { id: 'home', label: 'LEAGUE', show: true },
    { id: 'matchup', label: 'MATCHUP', show: rosterId != null },
    { id: 'draft', label: 'DRAFT', show: native && draftDone === false },
    // ANY SEAT (v0.356.17): native gets the full desk, an imported league the
    // read-only page the web finally has. The `native &&` here was the gate —
    // it is off, and the room is the app's rule again.
    { id: 'team', label: 'MY TEAM', show: rosterId != null },
    { id: 'chat', label: 'CHAT', show: true },
  ];
  const go = (id: StripRoom | 'chat') => {
    if (id === 'chat') { setChatOpen(true); setUnread({ n: 0, mention: false }); return; }
    onGo(id);
  };

  return (
    <>
      {!hideName && (
        <div className="grotesk" style={{ marginBottom: 12, fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
      )}
      {/* THE ROOM BAR — every width since v0.608.0. Fixed, active on an
          accent pill; ducks with the scroll on a phone and returns on a pull
          up; stays put on a wide screen.

          WORDS, NOT PICTURES (v0.468.0). The app's rail dropped its icons in
          v0.465.0 — founder: "ditch the navigation icons at the bottom in
          favor of just large text" — and this one, which is a different
          component in a different codebase, kept them: "Still have the icons
          in the rail on web."

          The argument is the same one and it is worth repeating here rather
          than pointing at the app: a 22px glyph over an 8.5px caption is an
          icon EXPLAINED BY a label, two marks saying one thing, and the label
          is the one being read. So the glyph goes and the label takes the
          whole rail at 13.5px — the size it could never be as a footnote to a
          picture. The rail's own height is unchanged.

          The unread dot stays. It is the one mark here that says something no
          word on the rail does, and it rides the label now. */}
      <nav style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex', justifyContent: 'center',
          background: 'var(--surface)', borderTop: '1px solid var(--bd)',
          padding: '5px 2px max(8px, env(safe-area-inset-bottom))',
          transform: hidden && !wide ? 'translateY(110%)' : 'translateY(0)', transition: 'transform 190ms ease',
        }}>
        {/* On a wide screen the rooms sit in a centred band rather than
            spreading five words across a whole monitor. */}
        <div style={{ display: 'flex', width: '100%', maxWidth: 720 }}>
          {rooms.filter((c) => c.show).map((c) => {
            const on = c.id === 'chat' ? chatOpen : here === c.id;
            return (
              <button key={c.id} onClick={() => go(c.id)}
                aria-current={on ? 'page' : undefined}
                style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <span style={{
                  position: 'relative', display: 'flex', alignItems: 'center',
                  borderRadius: 9, padding: '7px 10px',
                  background: on ? 'color-mix(in srgb, var(--you) 16%, transparent)' : 'transparent',
                }}>
                  <span className="mono" style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '0.02em', whiteSpace: 'nowrap', color: on ? 'var(--you)' : 'var(--dim)' }}>{c.label}</span>
                  {c.id === 'chat' && unread.n > 0 && (
                    <span aria-hidden style={{ position: 'absolute', top: 2, right: -1, minWidth: 8, height: 8, borderRadius: 999, background: 'var(--opp)' }} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      {chatOpen && <ChatPanel leagueId={leagueId} onClose={() => setChatOpen(false)} />}
    </>
  );
}
