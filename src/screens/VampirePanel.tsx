// 🧛 The vampire, on the web (v0.383.0, founder: "can we get the vampire log
// on web too?") — the app VampireCard's twin (apps/mobile/src/ui/LeagueExtras),
// kept in step by hand: the coven summary, the steal window (take / give /
// SINK THE TEETH), the commissioner's ruling on pending steals, and the
// per-chair feeding log. Renders bare — the hub's tile and the matchup board's
// feeding bell both open it inside a Sheet, which is the card.
import { useEffect, useState } from 'react';
import {
  vampireState, vampireSteal, commishRuleSteal, leaguePool, nativeRosters, friendlyError,
  type VampireState, type VampireChair, type LeaguePoolPlayer,
} from '@drip/core/data/liveApi';

const RULES = `Vampire rules: vampire seats DON'T DRAFT — appointed before the draft, they sit it out and build their rosters from the leftover pool. When a vampire WINS its matchup, it steals one player from the beaten team's active roster, giving one of its own back.

One steal per win per vampire, and only while the win is fresh (the latest completed week). The league may LOCK THE WIRE so only vampires can make pickups, and the commissioner may require approval per steal.

Every bite prints in the league register.`;

const chip = (on: boolean, busy: boolean): React.CSSProperties => ({
  fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999,
  cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
  border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`,
  color: on ? 'var(--you)' : 'var(--dim)',
  background: on ? 'color-mix(in srgb, var(--you) 10%, var(--surface))' : 'var(--surface)',
});
const faintLabel: React.CSSProperties = { fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', margin: '10px 0 4px' };

export function VampirePanel({ leagueId, myRoster, commish }: { leagueId: string; myRoster: number | null; commish: boolean }) {
  const [st, setSt] = useState<VampireState | null>(null);
  const [names, setNames] = useState<Record<string, LeaguePoolPlayer>>({});
  const [rosters, setRosters] = useState<{ roster_id: number; slug: string }[]>([]);
  const [take, setTake] = useState<string | null>(null);
  const [give, setGive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => Promise.all([
    vampireState(leagueId).then(setSt),
    leaguePool(leagueId).then((ps) => setNames(Object.fromEntries(ps.map((p) => [p.slug, p])))).catch(() => {}),
    nativeRosters(leagueId).then((rs) => setRosters(rs.map((r) => ({ roster_id: r.roster_id, slug: r.slug })))).catch(() => {}),
  ]).catch(() => setSt({ vampire: false }));
  // The app card's cadence: a SIM finals weeks in minutes, and the log should
  // fill in while the founder watches.
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { if (done) setNote(done); setTake(null); setGive(null); await load(); }
      else setNote(friendlyError(r.error ?? 'that didn’t work'));
    } catch (x) { setNote(friendlyError(x)); }
    finally { setBusy(false); }
  };

  if (!st) return <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading the coven…</div>;
  if (!st.vampire) return <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Not a vampire league.</div>;
  const nameOf = (s: string) => names[s]?.full_name ?? s;
  // The coven (0268): one chair per vampire. A pre-0268 answer has no
  // `vampires` — synthesize the single chair from the legacy fields.
  const chairs: VampireChair[] = st.vampires ?? (st.seat != null
    ? [{ seat: st.seat, seat_team: st.seat_team ?? null, won: !!st.won, victim: st.victim ?? null, fed: !!st.fed, record: st.record, weeks: st.weeks }]
    : []);
  const myChair = chairs.find((c) => c.seat === myRoster) ?? null;
  const windowOpen = !!myChair?.won && !myChair.fed;
  const pending = (st.steals ?? []).filter((s) => s.status === 'pending');
  const teamOf = (c: VampireChair) => c.seat_team ?? `Seat ${c.seat}`;

  return (
    <div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5 }}>
        {chairs.length === 0 ? 'No vampire appointed yet — the commissioner picks the coven in ⚑ Manage league.'
          : `${chairs.length > 1 ? `${chairs.length} vampires feed on wins` : `${teamOf(chairs[0])} feeds on wins`}${st.wire_lock ? ' · 🔒 the wire is locked to the coven' : ''}${st.steal_review ? ' · steals need the commissioner’s approval' : ''}`}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary className="mono" style={{ fontSize: 9, color: 'var(--faint)', cursor: 'pointer' }}>how the vampire works</summary>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: 4 }}>{RULES}</div>
      </details>
      {!!note && (
        <div className="mono" style={{ fontSize: 10, color: note.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 8 }}>{note}</div>
      )}

      {/* the bite: MY chair won the latest completed week and hasn't fed */}
      {myChair && windowOpen && (
        <div style={{ marginTop: 12 }}>
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--you)' }}>
            🩸 Fresh blood — you beat seat {myChair.victim} in week {st.week}. Pick your steal:
          </div>
          <div className="mono" style={faintLabel}>TAKE FROM THE BEATEN TEAM</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {rosters.filter((r) => r.roster_id === myChair.victim).map((r) => (
              <button key={r.slug} className="mono" disabled={busy} style={chip(take === r.slug, busy)} onClick={() => setTake(r.slug)}>{nameOf(r.slug)}</button>
            ))}
          </div>
          <div className="mono" style={faintLabel}>GIVE BACK</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {rosters.filter((r) => r.roster_id === myChair.seat).map((r) => (
              <button key={r.slug} className="mono" disabled={busy} style={chip(give === r.slug, busy)} onClick={() => setGive(r.slug)}>{nameOf(r.slug)}</button>
            ))}
          </div>
          <button className="mono" disabled={busy || !take || !give}
            onClick={() => { if (take && give) void act(() => vampireSteal(leagueId, take, give, myChair.seat), st.steal_review ? '✓ declared — awaiting the ruling' : '✓ the steal is done'); }}
            style={{ marginTop: 12, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', padding: '8px 16px', borderRadius: 6,
              border: '1px solid var(--you)', color: 'var(--on-accent)', background: 'var(--you)',
              cursor: busy || !take || !give ? 'default' : 'pointer', opacity: busy || !take || !give ? 0.55 : 1 }}>
            {busy ? '…' : '🧛 SINK THE TEETH'}
          </button>
        </div>
      )}
      {myChair && !windowOpen && (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 8 }}>
          {myChair.fed ? 'This week’s win is already fed on.' : st.week == null ? 'No completed week yet.' : 'No fresh blood — win your matchup to steal.'}
        </div>
      )}

      {/* the commissioner's ruling (steal_review) */}
      {commish && pending.map((s) => (
        <div key={s.id} style={{ marginTop: 12, borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)' }}>⚑ PENDING STEAL — week {s.week}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 3, lineHeight: 1.5 }}>
            {s.vampire != null && chairs.length > 1 ? `${teamOf(chairs.find((c) => c.seat === s.vampire) ?? { seat: s.vampire } as VampireChair)} ` : ''}takes {nameOf(s.take)} from {s.victim_team ?? `seat ${s.victim}`}, gives back {nameOf(s.give)}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button className="mono" disabled={busy} style={chip(true, busy)} onClick={() => void act(() => commishRuleSteal(leagueId, s.id, true), '✓ approved')}>✓ APPROVE</button>
            <button className="mono" disabled={busy} style={chip(false, busy)} onClick={() => void act(() => commishRuleSteal(leagueId, s.id, false), '✓ vetoed')}>✕ VETO</button>
          </div>
        </div>
      ))}

      {/* 🩸 THE FEEDING LOG (per-chair since 0268): every finaled week from
          each vampire's chair — the win, the victim, the bite. */}
      {chairs.filter((c) => (c.weeks ?? []).length > 0).map((c) => (
        <div key={c.seat} style={{ marginTop: 16 }}>
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--warn)' }}>
            🩸 {chairs.length > 1 ? `${teamOf(c).toUpperCase()} · ` : 'THE FEEDING LOG · '}{c.record ? `${c.record.wins}–${c.record.losses}` : ''}
          </div>
          {(c.weeks ?? []).map((w) => {
            const mine = (st.steals ?? []).filter((x) => x.vampire == null || x.vampire === c.seat);
            const s = mine.find((x) => x.week === w.week && x.status !== 'vetoed');
            const vetoed = mine.find((x) => x.week === w.week && x.status === 'vetoed');
            return (
              <div key={w.week} style={{ padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 38, flexShrink: 0 }}>WK {w.week}</span>
                  <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: w.won ? 'var(--you)' : 'var(--opp)' }}>{w.won ? 'W' : 'L'}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {Math.round(w.for * 10) / 10}–{Math.round(w.against * 10) / 10} vs {w.opp_team ?? `Roster ${w.opp}`}
                  </span>
                </div>
                {s && (
                  <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 2, marginLeft: 46 }}>
                    🧛 took {nameOf(s.take)} · gave {nameOf(s.give)}{s.status === 'pending' ? ' (awaiting the ruling)' : ''}
                  </div>
                )}
                {!s && vetoed && (
                  <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2, marginLeft: 46 }}>
                    steal vetoed — {nameOf(vetoed.take)} stays put
                  </div>
                )}
                {/* the latest week's open window is the bite UI's story, not
                    the log's — "never fed" is only true once the win expired */}
                {!s && !vetoed && w.won && w.week !== st.week && (
                  <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2, marginLeft: 46 }}>won, never fed</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
