// THE SAME WEEK, SCORED EVERY WAY WE OFFER (v0.358.0).
//
// Founder: "let's do the classic demo board" → "We want to show off all the
// scoring options and game formats/modes."
//
// The landing has always been the DRIP board — hidden metrics, power-ups, a
// nuke — which is one of two games we run and the wrong pitch for the recruit
// v0.357.3's `?game=classic` link brings here. This is the other game, and it
// costs no new data: `classicPoints` reads the same play cache the drip demo
// already loaded with `loadRealWeek(DEMO_WEEK)`, so the identical real week
// can be re-scored as classic at any reception value.
//
// WHY A SWITCHER RATHER THAN A SECOND BOARD. Everything the product sells here
// is a DIFFERENCE — PPR against standard, best ball against the lineup you
// actually set, golf against high-score-wins. A difference is shown by
// changing one thing and leaving the rest alone, on numbers the visitor has
// already read once. Two separate boards would describe the range; one board
// re-scored demonstrates it.
//
// THE LINEUPS ARE HONEST. The set lineup is filled by PROJECTION — what a
// manager would have fielded before kickoff, knowing what we knew then — and
// scored on what actually happened. Best ball then re-fills the same roster by
// ACTUAL points. The gap between those two totals is the real gap best ball
// pays you, on a real week, not a number we chose.
import { useMemo, useState } from 'react';
import { classicSlots, classicPoints, bestballFillBy, type ClassicPick, type ClassicSlotDef } from '@drip/core/engine/classic';
import { projectedPoints } from '@drip/core/engine/projScoring';
import { teamRoster, getTeam } from '@drip/core/data/league';
import { shortName } from '@drip/core/data/players';
import { PosPill } from '../app/ui';
import { openPlayerCard } from '../app/playerCard';

/** The three reception values the commissioner's presets offer. Named the way
 *  a manager says them, not as numbers. */
const PPR_STEPS: { v: number; label: string; note: string }[] = [
  { v: 0, label: 'Standard', note: 'a catch is worth nothing on its own' },
  { v: 0.5, label: 'Half-PPR', note: 'half a point per reception' },
  { v: 1, label: 'Full PPR', note: 'a full point per reception' },
];

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8,
};

export function ClassicDemo({ youId, oppId, week }: { youId: string; oppId: string; week: number }) {
  const [ppr, setPpr] = useState(1);
  const [bestBall, setBestBall] = useState(false);
  const [golf, setGolf] = useState(false);

  const slots = useMemo(() => classicSlots(), []);
  const slotNames = useMemo(() => slots.map((s) => s.slot), [slots]);

  /** One team's nine spots, filled the way this mode fills them and scored on
   *  what really happened. */
  const side = (teamId: string) => {
    const roster = teamRoster(teamId);
    const value = bestBall
      ? (p: { id: string; pos: string; team?: string | null }) => classicPoints(p as never, week, ppr)
      : (p: { id: string; pos: string; team?: string | null }, d: ClassicSlotDef) => projectedPoints(p, d.slot, d.pos);
    const picks: ClassicPick[] = bestballFillBy([], slotNames, roster, slots, value as never);
    const bySlot = new Map(picks.map((p) => [p.slot, p.player]));
    const rows = slots.map((d) => {
      const p = bySlot.get(d.slot) ?? null;
      return { def: d, player: p, pts: p ? classicPoints(p, week, ppr) : 0 };
    });
    return { rows, total: rows.reduce((n, r) => n + r.pts, 0) };
  };

  const you = useMemo(() => side(youId), [youId, ppr, bestBall, week]);   // eslint-disable-line react-hooks/exhaustive-deps
  const them = useMemo(() => side(oppId), [oppId, ppr, bestBall, week]);  // eslint-disable-line react-hooks/exhaustive-deps

  const youTeam = getTeam(youId);
  const oppTeam = getTeam(oppId);
  // GOLF READS THE SAME TOTALS THE OTHER WAY (0200) — it changes nothing about
  // what a touchdown is worth, only which end of the board you are aiming at.
  const youWin = golf ? you.total < them.total : you.total > them.total;
  const tied = Math.abs(you.total - them.total) < 0.005;

  const column = (label: string, s: ReturnType<typeof side>, mine: boolean) => (
    <div style={{ ...card, flex: '1 1 260px', minWidth: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
        padding: '9px 12px', borderBottom: '1px solid var(--bd)',
        background: mine ? 'color-mix(in srgb, var(--you) 8%, transparent)' : 'var(--bg)',
      }}>
        <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: mine ? 'var(--you)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span className="mono" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{s.total.toFixed(1)}</span>
      </div>
      {s.rows.map((r) => (
        <button key={r.def.slot}
          onClick={() => r.player && openPlayerCard({ slug: r.player.id, name: r.player.name, pos: r.player.pos, team: r.player.team ?? '', week })}
          disabled={!r.player}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            padding: '6px 12px', background: 'none', border: 'none',
            borderTop: '1px solid var(--bd)', font: 'inherit', color: 'inherit',
            cursor: r.player ? 'pointer' : 'default',
          }}>
          <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--faint)', width: 34, flexShrink: 0 }}>
            {r.def.type === 'DEF' ? 'D/ST' : r.def.slot}
          </span>
          {r.player ? <PosPill pos={r.player.pos} /> : <span style={{ width: 22 }} />}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.player ? shortName(r.player.name) : <span style={{ color: 'var(--faint)' }}>—</span>}
          </span>
          <span className="mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: r.pts > 0 ? 'var(--text)' : 'var(--faint)', flexShrink: 0 }}>
            {r.pts.toFixed(1)}
          </span>
        </button>
      ))}
    </div>
  );

  const toggle = (on: boolean, onClick: () => void, text: string, title: string) => (
    <button onClick={onClick} title={title} aria-pressed={on} className="mono"
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', padding: '5px 10px',
        borderRadius: 999, cursor: 'pointer',
        color: on ? 'var(--you)' : 'var(--dim)',
        background: on ? 'color-mix(in srgb, var(--you) 12%, transparent)' : 'var(--surface)',
        border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`,
      }}>{text}</button>
  );

  return (
    <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ textAlign: 'center' }}>
        <div className="grotesk" style={{ fontSize: 'clamp(19px, 5.5vw, 26px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
          One real week. <span style={{ color: 'var(--you)' }}>Scored every way we offer.</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 7, lineHeight: 1.45, maxWidth: '60ch', marginInline: 'auto' }}>
          Nine slots, standard scoring, every spot locking at its own kickoff — the classic game, on the
          same real 2025 plays. Change a rule and watch the same players score differently.
        </div>
      </div>

      {/* The controls ARE the pitch — each one is a setting a commissioner
          really has, and flipping it moves real numbers. */}
      <div style={{ ...card, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', width: 68 }}>RECEPTIONS</span>
          {PPR_STEPS.map((s) => toggle(ppr === s.v, () => setPpr(s.v), s.label, s.note))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', width: 68 }}>RULES</span>
          {toggle(bestBall, () => setBestBall((v) => !v), 'Best ball',
            'Your best nine are started for you after the fact — no lineup to set, no player left on the bench by mistake.')}
          {toggle(golf, () => setGolf((v) => !v), 'Golf',
            'Lowest weekly total wins. Nothing about scoring changes — only which end of the board you are aiming at.')}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {column(youTeam?.name ?? 'Your team', you, true)}
        {column(oppTeam?.name ?? 'Opponent', them, false)}
      </div>

      <div style={{ ...card, padding: '11px 13px' }}>
        <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: tied ? 'var(--dim)' : youWin ? 'var(--you)' : 'var(--opp)' }}>
          {tied ? 'Dead heat.' : youWin ? 'You win this week.' : 'You lose this week.'}
          {golf && !tied && <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — on golf rules, so the lower total takes it.</span>}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 5, lineHeight: 1.55 }}>
          {bestBall
            ? 'Best ball started your best nine after the fact. Turn it off to see the lineup you would actually have set before kickoff — the difference is what the rule is worth.'
            : 'This is the lineup you would have set before kickoff, from the projections, scored on what really happened. Turn on best ball to see what your roster could have banked.'}
        </div>
      </div>
    </div>
  );
}
