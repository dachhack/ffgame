// THE LEAGUE STRIP (v0.288.0) — and, on a phone, THE ROOM BAR (v0.356.8).
//
// Founder: "can we make the same UI changes to mobile web?" — the app moved
// its rooms to a LinkedIn-style bottom bar with the picked icon set
// (v0.356.0/.6), so on narrow screens this component now renders that bar:
// fixed to the bottom, icon over label, the active room on an accent pill,
// ducking out of the way as the page scrolls down and returning on any pull
// up. Wide screens keep the top chip row (de-emoji'd with the v0.356.7
// sweep), because a desktop has no thumb to reach for.
//
// It sits inside LiveOnboard's shell, so it is present on every league room
// the web has: the hub, the team desk, the draft room, results, and the
// commissioner's console. THE ONE ROOM WITHOUT IT is the matchup board —
// its own full-bleed route; the MATCHUP chip is the way in.
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

/** The founder's picked set (sheet C1 + C2's clipboard), same files the app
 *  bundles: bare stickers for light themes, halo-backed for dark so the VS
 *  mark's navy half doesn't sink into a dark rail. */
const railIcon = (name: string, light: boolean) =>
  `${import.meta.env.BASE_URL}icons/rail/${name}${light ? '' : '-halo'}.png`;

/** Is the current theme a light one? Read off the page's own ground token —
 *  no theme name plumbed in. Unparseable → dark (the halo set works on any
 *  ground; the bare set fails only on dark). */
function themeIsLight(): boolean {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const m = /^#([0-9a-f]{6})/i.exec(bg);
  if (!m) return false;
  const h = m[1];
  return (parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16)) / 3 > 140;
}

export function LeagueStrip({ leagueId, name, rosterId, native, here, onGo }: {
  leagueId: string;
  name: string;
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
  // The DRAFT room leaves once the draft is done — it stays reachable from
  // the hub's tile, which is the record after draft night (v0.269.0).
  const [draftDone, setDraftDone] = useState(false);
  const [light] = useState(themeIsLight);
  // The room bar ducks on scroll-down and returns on any pull up — the same
  // two-state hysteresis the app runs (v0.356.1): ~28px of accumulated
  // downward travel hides it, ~12px up shows it, the page top always shows
  // it, and a route jump (a big offset delta) is ignored.
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
    if (wide) return;
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = '78px';
    return () => { document.body.style.paddingBottom = prev; };
  }, [wide]);

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
      nativeTeamState(leagueId)
        .then((t) => { if (!dead) setDraftDone(t?.draft_status === 'complete'); })
        .catch(() => {});
    }
    return () => { dead = true; };
  }, [leagueId, native]);

  const rooms: { id: StripRoom | 'chat'; icon: string; label: string; show: boolean }[] = [
    { id: 'home', icon: 'league', label: 'LEAGUE', show: true },
    { id: 'matchup', icon: 'matchup', label: 'MATCHUP', show: rosterId != null },
    { id: 'draft', icon: 'draft', label: 'DRAFT', show: native && !draftDone },
    // native only on the web for now — the app's read-only external team
    // page (v0.356.5) has no web sibling yet.
    { id: 'team', icon: 'team', label: 'MY TEAM', show: native && rosterId != null },
    { id: 'chat', icon: 'chat', label: 'CHAT', show: true },
  ];
  const go = (id: StripRoom | 'chat') => {
    if (id === 'chat') { setChatOpen(true); setUnread({ n: 0, mention: false }); return; }
    onGo(id);
  };

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        {/* Wide screens keep the chip row under the name — words, no emoji. */}
        {wide && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 7 }}>
            {rooms.filter((c) => c.show).map((c) => {
              const on = c.id === 'chat' ? chatOpen : here === c.id;
              return (
                <button key={c.id} onClick={() => go(c.id)}
                  aria-current={on ? 'page' : undefined}
                  aria-label={c.id === 'chat' && unread.n > 0 ? `Chat — ${unread.n} unread${unread.mention ? ', you were mentioned' : ''}` : undefined}
                  className="mono"
                  style={{
                    position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
                    border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 6,
                    background: on ? 'color-mix(in srgb, var(--you) 12%, var(--surface))' : 'var(--surface)',
                    color: on ? 'var(--you)' : 'var(--dim)',
                    padding: '5px 10px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
                  }}>
                  <img src={railIcon(c.icon, light)} alt="" style={{ width: 15, height: 15 }} />
                  {c.label}
                  {c.id === 'chat' && unread.n > 0 && (
                    <span aria-hidden style={{ position: 'absolute', top: -3, right: -3, minWidth: 8, height: 8, borderRadius: 999, background: 'var(--opp)' }} />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* THE ROOM BAR — phones only. Fixed, icon over label, active on an
          accent pill; ducks with the scroll and returns on a pull up. */}
      {!wide && (
        <nav style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex',
          background: 'var(--surface)', borderTop: '1px solid var(--bd)',
          padding: '5px 2px max(8px, env(safe-area-inset-bottom))',
          transform: hidden ? 'translateY(110%)' : 'translateY(0)', transition: 'transform 190ms ease',
        }}>
          {rooms.filter((c) => c.show).map((c) => {
            const on = c.id === 'chat' ? chatOpen : here === c.id;
            return (
              <button key={c.id} onClick={() => go(c.id)}
                aria-current={on ? 'page' : undefined}
                style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', justifyContent: 'center' }}>
                <span style={{
                  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  borderRadius: 9, padding: '3px 12px',
                  background: on ? 'color-mix(in srgb, var(--you) 16%, transparent)' : 'transparent',
                }}>
                  <img src={railIcon(c.icon, light)} alt="" style={{ width: 22, height: 22, opacity: on ? 1 : 0.62 }} />
                  <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: on ? 'var(--you)' : 'var(--dim)' }}>{c.label}</span>
                  {c.id === 'chat' && unread.n > 0 && (
                    <span aria-hidden style={{ position: 'absolute', top: 0, right: 4, minWidth: 8, height: 8, borderRadius: 999, background: 'var(--opp)' }} />
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      )}
      {chatOpen && <ChatPanel leagueId={leagueId} onClose={() => setChatOpen(false)} />}
    </>
  );
}
