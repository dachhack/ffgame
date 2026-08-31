// 🔪 The chopping block, on the web (v0.383.1, founder: "let's get the
// chopping block on web versions as well") — the app GuillotineCard's twin
// (apps/mobile/src/ui/LeagueExtras), kept in step by hand: the survivors
// nearest the blade first, the frenzy, and the week-by-week record of the
// chopped. Renders nothing outside a guillotine league.
//
// HISTORY (v0.384.0, founder: "so you can select each week and it's result").
// The week chips run NOW · WK n … WK 1. NOW is the cutline as it stands (live
// totals and all); a past week is that week's whole field as it stood then —
// including the seat the blade took, which is gone from every week after.
//
// The bye rules here are PINNED by scripts/check-bye.mjs alongside the app
// card's: a byed seat prints BYE (never a number), a live total prints
// provisional (~), and a byed seat is never the one under the blade.
import { useState } from 'react';
import { useEffect } from 'react';
import { guillotineTick, guillotineState, type GuillotineState } from '@drip/core/data/liveApi';

const hdr = (color: string): React.CSSProperties => ({ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color });
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' };
const nameCell = (color: string, bold: boolean): React.CSSProperties => ({
  flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  color, fontWeight: bold ? 700 : 400,
});

export function GuillotinePanel({ leagueId, myRoster, framed }: {
  leagueId: string; myRoster: number | null;
  /** Wraps itself in a card — for pages where the panel is not inside a Sheet
   *  (the results page). Bare in a Sheet, which is the card. */
  framed?: boolean;
}) {
  const [st, setSt] = useState<GuillotineState | null>(null);
  // null = NOW (the live cutline); a number = that finaled week's field.
  const [week, setWeek] = useState<number | null>(null);

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
  const history = st.history ?? [];
  const fmt1 = (n: number) => Math.round(n * 10) / 10;
  // A week that scrolled out of the answer (or a season that just crowned)
  // must never strand the view on an empty list.
  const past = week != null ? history.find((h) => h.week === week) ?? null : null;
  const showNow = week == null || !past;

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} onClick={onClick} className="mono"
      style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 999,
        cursor: 'pointer', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`,
        color: on ? 'var(--you)' : 'var(--faint)',
        background: on ? 'color-mix(in srgb, var(--you) 10%, var(--surface))' : 'var(--surface)' }}>
      {label}
    </button>
  );

  const body = (
    <div>
      <div className="mono" style={hdr('var(--warn)')}>🔪 THE CHOPPING BLOCK</div>
      <details style={{ marginTop: 5 }}>
        <summary className="mono" style={{ fontSize: 9, color: 'var(--faint)', cursor: 'pointer' }}>how the guillotine works</summary>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: 4 }}>
          {'Guillotine rules: each week, the lowest-scoring team still alive is ELIMINATED — its whole roster is released to waivers (the frenzy), where the big FAAB budget decides who lands the spoils.\n\nThere are no head-to-head stakes; the only standing that matters is staying off the floor. A tie at the bottom dies by the weaker season. The last team standing wins.\n\nWhile a week is in flight the block shows LIVE totals (~) — the order is who falls if it ended now. Eliminated teams keep their seat at the table — chat, the pots — but can never add a player again.'}
        </div>
      </details>

      {/* THE WEEKS (0271). Only drawn once there is a past to look at. */}
      {history.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          {chip(showNow, 'NOW', () => setWeek(null))}
          {history.map((h) => chip(!showNow && week === h.week, `WK ${h.week}`, () => setWeek(h.week)))}
        </div>
      )}

      {showNow ? (
        <>
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
                <div key={a.roster_id} style={row}>
                  <span style={{ fontSize: 12, width: 18, textAlign: 'center', flexShrink: 0 }}>{doomed ? '🔪' : ''}</span>
                  <span style={nameCell(mine ? 'var(--you)' : doomed ? 'var(--opp)' : 'var(--text)', mine || doomed)}>
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
        </>
      ) : (
        <>
          {/* ONE WEEK, AS IT STOOD (0271) — the field that played it, the
              blade's own row flagged, everything final. */}
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 6 }}>
            week {past!.week} · {past!.teams.length} in it · {past!.chopped != null
              ? <>🪓 <span style={{ color: 'var(--opp)', fontWeight: 700 }}>{past!.chopped_team ?? `Roster ${past!.chopped}`}</span> fell</>
              : 'nobody fell'}
          </div>
          <div style={{ marginTop: 8 }}>
            {past!.teams.map((p) => {
              const mine = p.roster_id === myRoster;
              return (
                <div key={p.roster_id} style={row}>
                  <span style={{ fontSize: 12, width: 18, textAlign: 'center', flexShrink: 0 }}>{p.chopped ? '🪓' : ''}</span>
                  <span style={nameCell(p.chopped ? 'var(--opp)' : mine ? 'var(--you)' : 'var(--text)', mine || p.chopped)}>
                    {p.team ?? `Roster ${p.roster_id}`}
                  </span>
                  <span className="mono" style={{ fontSize: 10, fontWeight: 700,
                    color: p.chopped ? 'var(--opp)' : p.bye ? 'var(--faint)' : 'var(--text)' }}>
                    {p.bye ? 'BYE' : p.pts != null ? fmt1(p.pts) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* The frenzy and the season's blade-record belong to NOW: a past week
          shows its own casualty in the line above it. */}
      {showNow && frenzy.length > 0 && (
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
      {/* the chopped, week by week — the season's record of the blade, and a
          way into each of those weeks */}
      {showNow && fallen.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="mono" style={hdr('var(--opp)')}>🪓 CHOPPED</div>
          {[...fallen].reverse().map((f) => (
            <button key={f.roster_id} onClick={() => setWeek(f.week)}
              style={{ ...row, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--bd)', cursor: 'pointer' }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 38, flexShrink: 0 }}>WK {f.week}</span>
              <span style={nameCell(f.roster_id === myRoster ? 'var(--you)' : 'var(--text)', false)}>
                {f.team ?? `Roster ${f.roster_id}`}
              </span>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{f.pts != null ? fmt1(f.pts) : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return framed
    ? <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>{body}</div>
    : body;
}
