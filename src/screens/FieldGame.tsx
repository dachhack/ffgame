// One NFL game's live field + full play log (v0.270.0; a CARD since v0.271.0
// — founder: "not a new tab on the web, just a card"). Self-contained: week +
// team locate the game feed, no league state involved, so the classic board
// can drop it into a modal card and it runs itself.
//
// Feed resolution mirrors the boards': the worker's live game_feed rows are
// installed as the week's EXCLUSIVE overlay (a live week must never fall
// through to baked 2025 drives — a plausible, wrong field); only when the
// server has no rows at all does the baked JSON load, which is what serves the
// 2025 demo weeks. Polls on a 45s cadence — this card's whole job is "what is
// happening in this game right now".
import { useEffect, useMemo, useState } from 'react';
import { FieldView } from '../app/FieldView';
import { gameFeedFor, loadGameFeedWeek, setLiveGameFeed, feedRowsToWeek, type GamePlay } from '@drip/core/data/gameFeed';
import { weekGameFeeds } from '@drip/core/data/liveApi';
import { isPreseasonWeek, preseasonWeekNum } from '@drip/core/data/nflSlate';
import { teamLogo } from '@drip/core/data/media';

const ORD = ['', '1st', '2nd', '3rd', '4th'];
/** "Q2 8:41" from game-elapsed seconds — FieldView's own clock arithmetic. */
const fmtQClock = (c: number): string => {
  if (c >= 3600) { const rem = 600 - ((c - 3600) % 600); return `OT ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`; }
  const q = Math.floor(c / 900) + 1; const rem = 900 - (c % 900);
  return `Q${q} ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
};

export function FieldGame({ week, team, onClose }: { week: number; team: string; onClose?: () => void }) {
  // Bumped whenever a load lands — the feed lives in a module cache React
  // cannot see, so this is what ties the page to fresh plays.
  const [feedsAt, setFeedsAt] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const rows = await weekGameFeeds(week).catch(() => []);
        if (stop) return;
        if (rows.length) setLiveGameFeed(week, feedRowsToWeek(rows));
        else await loadGameFeedWeek(week); // no live rows anywhere → the baked week, if it exists
      } catch { /* transient — next tick retries */ }
      if (!stop) { setFeedsAt(Date.now()); setReady(true); }
    };
    void load();
    const t = window.setInterval(() => { void load(); }, 45_000);
    return () => { stop = true; window.clearInterval(t); };
  }, [week]);

  const feed = useMemo(() => { void feedsAt; return gameFeedFor(week, team); }, [week, team, feedsAt]);
  // Newest first — the question this page answers is "what just happened".
  const plays = useMemo(() => (feed ? [...feed.plays].reverse() : []), [feed]);
  const wkLabel = isPreseasonWeek(week) ? `PRESEASON WK ${preseasonWeekNum(week)}` : `WEEK ${week}`;

  const logo = (abbr: string) => {
    const u = teamLogo(abbr);
    return u ? <img src={u} alt="" width={20} height={20} style={{ display: 'inline-block', verticalAlign: -4 }} /> : null;
  };

  return (
    // Hosted in a card (onClose set) the wrapper owns width and padding;
    // standalone it centers itself like a page.
    <div style={onClose ? undefined : { maxWidth: 640, margin: '0 auto', padding: '14px 12px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          {feed ? <>{logo(feed.away)} {feed.away} @ {feed.home} {logo(feed.home)}</> : `${team} · GAME FIELD`}
        </span>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.1em', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {wkLabel} · LIVE
          {onClose && (
            <button onClick={onClose} aria-label="close" className="mono"
              style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 14, cursor: 'pointer', lineHeight: 1, padding: 2 }}>✕</button>
          )}
        </span>
      </div>

      {!ready && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', padding: '30px 0', textAlign: 'center' }}>Loading the game feed…</div>}
      {ready && !feed && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.7, padding: '30px 0', textAlign: 'center' }}>
          No feed for this game yet — the field and play log appear once it kicks off.
          <br />This page refreshes itself; leave it open.
        </div>
      )}

      {/* clock = MAX: a live page always shows the latest play there is. */}
      {feed && <FieldView week={week} team={team} clock={Number.MAX_SAFE_INTEGER} />}

      {feed && (
        <div style={{ marginTop: 14, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' }}>
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', padding: '10px 14px 6px' }}>
            PLAY LOG · NEWEST FIRST
          </div>
          {plays.length === 0 && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', padding: '6px 14px 14px' }}>No plays yet — the log fills in live.</div>
          )}
          {plays.map((p: GamePlay, i: number) => (
            <div key={p.pid ?? `${p.c}-${i}`} style={{ display: 'flex', gap: 10, padding: '7px 14px', borderTop: '1px solid var(--bd)' }}>
              <div style={{ width: 64, flexShrink: 0 }}>
                <div className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--dim)' }}>{fmtQClock(p.c)}</div>
                <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 1 }}>
                  {p.dn > 0 ? `${ORD[p.dn]} & ${p.dist}` : p.tm}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, lineHeight: 1.4, color: p.sc ? 'var(--warn)' : p.to ? 'var(--opp, var(--warn))' : 'var(--text)', overflowWrap: 'anywhere' }}>
                  {p.txt}
                </div>
                {!!p.sc && (
                  <div className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--warn)', marginTop: 2 }}>
                    {feed.away} {p.as} — {p.hs} {feed.home}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
