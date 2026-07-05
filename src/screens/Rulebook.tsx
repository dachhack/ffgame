import { METRICS, WINDOWS } from '../data/metrics';
import { POWERUPS } from '../data/powerups';
import { PuIcon, GameIcon, COIN_SILVER } from '../app/gameIcons';
import type { Pos } from '../types';

// In-app scoring rulebook. The metric catalog + power-up list are rendered straight
// from src/data/metrics.ts and src/data/powerups.ts, so they can never drift from
// the live engine — edit the data, the page updates. Prose mirrors docs/rulebook.md.

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 16, marginBottom: 14 };
const h2: React.CSSProperties = { fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' };
const kicker: React.CSSProperties = { fontFamily: 'monospace', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--you)' };
const p: React.CSSProperties = { fontSize: 13, lineHeight: 1.6, color: 'var(--dim)', margin: '8px 0 0' };
const tag: React.CSSProperties = { fontFamily: 'monospace', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' };

const POS_ORDER: { pos: Pos; label: string }[] = [
  { pos: 'QB', label: 'Quarterback' }, { pos: 'RB', label: 'Running Back' }, { pos: 'WR', label: 'Wide Receiver' },
  { pos: 'TE', label: 'Tight End' }, { pos: 'K', label: 'Kicker' }, { pos: 'DEF', label: 'Defense (DST)' }, { pos: 'DL', label: 'IDP (DL / LB / DB)' },
];

function MetricRow({ name, tagText, sc, ef }: { name: string; tagText: string; sc: string; ef: string }) {
  return (
    <div style={{ padding: '9px 0', borderTop: '1px solid var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{name}</span>
        <span style={tag}>{tagText}</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>{sc}</span>
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dim)', marginTop: 4 }}>{ef}</div>
    </div>
  );
}

export function Rulebook({ onClose }: { onClose: () => void }) {
  const pre = POWERUPS.filter((x) => x.timing === 'pre');
  const live = POWERUPS.filter((x) => x.timing === 'live');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--bg)', overflowY: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>◆ DRIP FANTASY — RULEBOOK</span>
        <button onClick={onClose} className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '6px 12px', cursor: 'pointer' }}>✕ close</button>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '18px 16px 60px' }}>
        <p style={{ ...p, marginTop: 0, color: 'var(--text)' }}>
          Head-to-head fantasy where <b>how</b> you score matters as much as <b>who</b> you start. Every slot is a hidden bet:
          a player <i>and</i> a secret <b>metric</b> that decides how their real NFL game becomes points — and how it attacks the
          slot across from it. Picks stay sealed until kickoff.
        </p>

        {/* 1. The week */}
        <div style={card}>
          <div style={kicker}>01 · THE WEEK</div>
          <div style={h2}>8 slots across 5 windows</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {WINDOWS.map((w) => (
              <span key={w.id} className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', border: '1px solid var(--bd)', borderRadius: 5, padding: '5px 9px' }}>
                <b style={{ color: 'var(--text)' }}>{w.label}</b> · {w.slots} slot{w.slots > 1 ? 's' : ''}
              </span>
            ))}
          </div>
          <p style={p}>Each slot = one player + one hidden metric (the player must be in a team playing that window). Your slots fight your
            opponent's <b>by window and slot position</b>. Your score is every slot's banked points — and most metrics also <i>attack</i> the
            slot they're matched against, so you can win by scoring big <b>or</b> by zeroing the player across from you.</p>
        </div>

        {/* 2. The drip system */}
        <div style={card}>
          <div style={kicker}>02 · THE DRIP SYSTEM</div>
          <div style={h2}>Rates that accrue over time</div>
          <p style={p}>Drip metrics (Rush Yards, Receiving Yards, and the Combo/Return unlocks) don't score yards directly. Each productive
            touch raises a <b>rate</b> (points per minute) that accrues <b>while your team has the ball</b>, on the real game clock.</p>
          <ul style={{ ...p, paddingLeft: 18 }}>
            <li><b>Rate</b> = yards × <b>0.01</b>/min for a WR or RB, <b>0.005</b>/min for a TE (half). It builds gradually, so yards early
              accrue over far more time than yards late.</li>
            <li><b>HOT</b> — 3 straight productive touches with no opponent score doubles your drip (×2). A stuffed run, short return, or
              incompletion cools you. (Combo/Return drips need 4.)</li>
            <li><b>A touchdown wipes the bank</b> — drips reward sustained production, not boom plays. The rate survives; the bank doesn't.</li>
          </ul>
          <p style={p}><b>WR vs TE:</b> a WR/RB drip is double-rate but <b>fragile</b> (opponent catches erase &amp; pause it). A TE drip is
            half-rate but <b>immune to WR/RB erases &amp; pauses</b> — though its hot streak can still be <i>cooled</i> by an opponent who
            banks points every play (a passing QB). That's the core counter.</p>
        </div>

        {/* 3. Metric catalog (auto from data) */}
        <div style={card}>
          <div style={kicker}>03 · METRIC CATALOG</div>
          <div style={h2}>Every hidden metric</div>
          {POS_ORDER.map(({ pos, label }) => (
            <div key={pos} style={{ marginTop: 14 }}>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text)' }}>{label}</div>
              {(METRICS[pos] ?? []).map((m) => <MetricRow key={m.id} name={m.name} tagText={m.tag} sc={m.sc} ef={m.ef} />)}
            </div>
          ))}
        </div>

        {/* 4. Counterplay */}
        <div style={card}>
          <div style={kicker}>04 · COUNTERPLAY</div>
          <div style={h2}>Rock · paper · scissors</div>
          <ul style={{ ...p, paddingLeft: 18 }}>
            <li><b>Drips</b> have the highest ceiling but are fragile — beaten by <b>erasers</b> (Receptions / Targets), <b>rate reset</b>,
              <b>nukes</b> (TDs), and by <b>per-play scorers</b> that deny the hot streak.</li>
            <li><b>Effect metrics</b> (erase / nuke / suppress / shutdown) score little, so they lose to <b>flat scorers</b> that pile up
              points and don't care about being erased.</li>
            <li><b>Flat scorers</b> are steady with no ceiling — they lose the points race to a drip that goes hot.</li>
          </ul>
          <p style={p}>Cross-window reach: <b>Field General</b> multiplies your whole window, <b>TE 8-PT NUKE</b> hits every drip in the window,
            <b>DEF Suppress</b> halves matching slots in any window, and <b>K Banker</b> boosts all your TDs.</p>
        </div>

        {/* 5. Power-ups (auto from data) */}
        <div style={card}>
          <div style={kicker}>05 · POWER-UPS</div>
          <div style={h2}>The drip-coin economy</div>
          <p style={p}>You earn <b>drip-coin</b> each week and spend it on consumables — bought into your inventory and spent when applied.
            Two kinds: <b>action</b> (a one-time tactical effect) and <b>metric</b> (unlocks an extra metric for the current week only).
            Timing gates when you can apply one:</p>
          {[{ k: 'pre', t: 'PRE-KICKOFF', sub: 'arm during setup; locks once a window starts', list: pre }, { k: 'live', t: 'IN-GAME', sub: 'fire anytime a window is live (not retroactive)', list: live }].map((grp) => (
            <div key={grp.k} style={{ marginTop: 14 }}>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text)' }}>{grp.t} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>· {grp.sub}</span></div>
              {grp.list.map((pu) => (
                <div key={pu.id} style={{ padding: '9px 0', borderTop: '1px solid var(--bd)', display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 24, flexShrink: 0 }}><PuIcon id={pu.id} emoji={pu.icon} size={34} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{pu.name}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--warn)' }}><GameIcon name={COIN_SILVER} emoji="◎" size="1.2em" /> {pu.price}</span>
                      <span style={tag}>{pu.kind === 'metric' ? 'METRIC' : 'ACTION'}</span>
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dim)', marginTop: 4 }}>{pu.blurb}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 6. Edge cases */}
        <div style={card}>
          <div style={kicker}>06 · EDGE CASES</div>
          <div style={h2}>The fine print</div>
          <ul style={{ ...p, paddingLeft: 18 }}>
            <li><b>Missed picks</b> — your league policy fills an empty slot with your best available lineup (default), an AI, or scores 0.</li>
            <li><b>Backups</b> — depth behind a beatable starter can sub in for full value if it outscores them; otherwise it scores 0 (all-or-nothing — no partial credit).</li>
            <li><b>Overtime / Garbage Time</b> — power-ups can keep drips ticking past regulation or double final-5-minute points.</li>
          </ul>
        </div>

        <p style={{ ...p, fontSize: 11, textAlign: 'center' }}>The live engine is the source of truth. If a number here ever disagrees with the game, the game wins.</p>
      </div>
    </div>
  );
}
