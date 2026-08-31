// 🔪 The chopping block, on the web (v0.383.1, founder: "let's get the
// chopping block on web versions as well") — the app GuillotineCard's twin
// (apps/mobile/src/ui/LeagueExtras), kept in step by hand: the survivors
// nearest the blade first, the frenzy, and the week-by-week record of the
// chopped. Renders nothing outside a guillotine league.
//
// The bye rules here are PINNED by scripts/check-bye.mjs alongside the app
// card's: a byed seat prints BYE (never a number), a live total prints
// provisional (~), and a byed seat is never the one under the blade.
import { useEffect, useState } from 'react';
import { guillotineTick, guillotineState, type GuillotineState } from '@drip/core/data/liveApi';

const hdr = (color: string): React.CSSProperties => ({ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color });

export function GuillotinePanel({ leagueId, myRoster, framed }: {
  leagueId: string; myRoster: number | null;
  /** Wraps itself in a card — for pages where the panel is not inside a Sheet
   *  (the results page). Bare in a Sheet, which is the card. */
  framed?: boolean;
}) {
  const [st, setSt] = useState<GuillotineState | null>(null);

  // Poll, don't just load (the app card's rule): the founder watches the blade
  // fall in a SIM, where a whole week finals in minutes — a mount-once card is
  // a lie within one. The tick is idempotent, so re-poking each pass is free.
  useEffect(() => {
    let on = true;
    const load = () =>
      guillotineTick(leagueId).catch(() => {})
        .then(() => guillotineState(leagueId)).then((s) => { if (on) setSt(s); })
        .catch(() => { if (on) setSt((p) => p ?? { guillotine: false }); });
    void load();
    const t = window.setInterval(() => void load(), 20_000);
    return () => { on = false; window.clearInterval(t); };
  }, [leagueId]);

  if (!st?.guillotine) return null;
  const alive = st.alive ?? [];
  const fallen = st.fallen ?? [];
  const frenzy = st.frenzy ?? [];
  const fmt1 = (n: number) => Math.round(n * 10) / 10;

  const body = (
    <div>
      <div className="mono" style={hdr('var(--warn)')}>🔪 THE CHOPPING BLOCK</div>
      <details style={{ marginTop: 5 }}>
        <summary className="mono" style={{ fontSize: 9, color: 'var(--faint)', cursor: 'pointer' }}>how the guillotine works</summary>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: 4 }}>
          {'Guillotine rules: each week, the lowest-scoring team still alive is ELIMINATED — its whole roster is released to waivers (the frenzy), where the big FAAB budget decides who lands the spoils.\n\nThere are no head-to-head stakes; the only standing that matters is staying off the floor. A tie at the bottom dies by the weaker season. The last team standing wins.\n\nWhile a week is in flight the block shows LIVE totals (~) — the order is who falls if it ended now. Eliminated teams keep their seat at the table — chat, the pots — but can never add a player again.'}
        </div>
      </details>
      {st.champion != null ? (
        <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--you)', marginTop: 8 }}>
          🏆 {alive[0]?.team ?? `Roster ${st.champion}`} — the last one standing
        </div>
      ) : (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 6 }}>
          {alive.length} left · week {st.week ?? '—'} · the lowest score falls
        </div>
      )}
      {/* the survivors, nearest the blade first — the list itself shrinks as
          the season chops, so the view always scales to who's left */}
      <div style={{ marginTop: 8 }}>
        {alive.map((a, i) => {
          // 0247: a byed seat has no score and cannot fall this week, so it is
          // never the one under the blade — however the list happens to sort.
          const doomed = st.champion == null && i === 0 && !a.bye;
          const mine = a.roster_id === myRoster;
          const liveNow = a.pts == null && a.live != null;
          return (
            <div key={a.roster_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
              <span style={{ fontSize: 12, width: 18, textAlign: 'center', flexShrink: 0 }}>{doomed ? '🔪' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: mine ? 'var(--you)' : doomed ? 'var(--opp)' : 'var(--text)', fontWeight: mine || doomed ? 700 : 400 }}>
                {a.team ?? `Roster ${a.roster_id}`}
              </span>
              <span className="mono" style={{ fontSize: 10, fontWeight: 700,
                color: doomed ? 'var(--opp)' : a.bye ? 'var(--faint)' : liveNow ? 'var(--dim)' : 'var(--text)' }}>
                {a.bye ? 'BYE'
                  : a.pts != null ? fmt1(a.pts)
                  : liveNow ? `~${fmt1(a.live!)}`
                  : '—'}
              </span>
            </div>
          );
        })}
      </div>
      {frenzy.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="mono" style={hdr('var(--warn)')}>💰 THE FRENZY — released to waivers</div>
          {frenzy.slice(0, 12).map((p) => (
            <div key={p.slug} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name} · {p.pos}</span>
              <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>#{p.rank}</span>
            </div>
          ))}
          {frenzy.length > 12 && <div className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>…and {frenzy.length - 12} more on the wire</div>}
        </div>
      )}
      {/* the chopped, week by week — the season's record of the blade */}
      {fallen.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="mono" style={hdr('var(--opp)')}>🪓 CHOPPED</div>
          {[...fallen].reverse().map((f) => (
            <div key={f.roster_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', borderTop: '1px solid var(--bd)' }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 38, flexShrink: 0 }}>WK {f.week}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: f.roster_id === myRoster ? 'var(--you)' : 'var(--text)' }}>
                {f.team ?? `Roster ${f.roster_id}`}
              </span>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{f.pts != null ? fmt1(f.pts) : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return framed
    ? <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>{body}</div>
    : body;
}
