// Shared board pieces used by BOTH the logged-out demo landing (DemoBoard) and
// the full game board (Matchup) / live pre-lock picks (LivePicks). They live in
// their own module so the landing page never statically imports Matchup.tsx —
// keeping the whole game screen out of the eager landing chunk (App.tsx lazy-
// loads Matchup; that split only works if nothing eager imports it).
import { useEffect, useState } from 'react';
import { useStore, PHOTO_SKINS } from '../app/store';
import type { Phase } from '../app/store';
import { PlayerImg, InjuryBadge, useIsMobile, ModalBackdrop } from '../app/ui';
import { windowsForWeek } from '../data/nflSlate';
import { METRICS, metricById } from '../data/metrics';
import { powerupById } from '../data/powerups';
import { getPlayer } from '../data/league';
import { PlayerCard } from '../app/cardTable';
import { PuIcon, GameIcon, UI_ART } from '../app/gameIcons';
import { FX_COLOR } from '../data/demoNarration';
import type { Pick, Player, Pos, WindowId, Metric } from '../types';

export function RosterAside({ side, pools, picks, onPlayer, phase, sealed, collapsed, onToggle, bye = [], week, fluid }: {
  side: 'you' | 'their';
  pools: Record<WindowId, Player[]>;
  picks: Record<string, Pick>;
  onPlayer?: (id: string) => void;
  phase: Phase;
  sealed?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  bye?: Player[];
  week: number;
  fluid?: boolean; // mobile: full-width block instead of a fixed side rail
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const assignedIds = new Set(Object.values(picks).map((p) => p.playerId));
  const total = (Object.values(pools) as Player[][]).reduce((n, a) => n + a.length, 0);

  if (collapsed && !fluid) {
    return (
      <aside style={{ width: 26, flex: 'none', position: 'sticky', top: 68, alignSelf: 'flex-start' }} className="hide-narrow">
        <button onClick={onToggle} title={`Show ${side === 'you' ? 'your' : 'the opponent'} roster`} className="mono" style={{ width: 26, minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '8px 0', background: 'var(--surface)', border: '1px solid var(--bd)', [side === 'you' ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, color: accent, cursor: 'pointer' } as React.CSSProperties}>
          <span style={{ fontSize: 11 }}>{side === 'you' ? '▸' : '◂'}</span>
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.18em', writingMode: 'vertical-rl', textOrientation: 'mixed' }}>{side === 'you' ? 'YOUR' : 'OPPONENT'} ROSTER · {total}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside style={fluid
      ? { width: '100%', flex: 'none', overflow: 'auto', maxHeight: '44vh', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: 10 }
      // Desktop: pin the rail below the sticky header so you can grab a player from
      // anywhere on the board without scrolling back up; the rail scrolls on its own
      // when the roster is long.
      : { width: 188, flex: 'none', position: 'sticky', top: 68, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 80px)', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }} className={fluid ? undefined : 'hide-narrow'}>
      <button onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: accent, fontWeight: 700 }}>{side === 'you' ? '◂' : '▸'} {side === 'you' ? 'YOUR' : 'OPPONENT'} ROSTER</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{total}</span>
      </button>
      {windowsForWeek(week).map((w) => (
        <div key={w.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>{w.label}</span>
            <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{w.time}</span>
          </div>
          {(pools[w.id] ?? []).length === 0 && <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', padding: '0 4px' }}>— none playing —</span>}
          {(pools[w.id] ?? []).map((p) => {
            // Never reveal which players the opponent has selected during setup.
            const assigned = assignedIds.has(p.id) && (side === 'you' || phase !== 'setup');
            const interactive = side === 'you' && phase === 'setup';
            return (
              <button
                key={p.id}
                onClick={interactive ? () => onPlayer?.(p.id) : undefined}
                draggable={interactive}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)',
                  border: `1px solid ${assigned ? accent : 'var(--bd)'}`, borderRadius: 3, padding: '7px 9px',
                  cursor: interactive ? 'pointer' : 'default', textAlign: 'left', opacity: sealed && side === 'their' ? 0.92 : 1,
                }}
              >
                <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={18} />
                <span className="grotesk" style={{ fontSize: 11.5, fontWeight: 700, color: side === 'you' ? 'var(--text)' : 'var(--dimstrong)', flex: 1, textDecoration: assigned ? 'line-through' : 'none', opacity: assigned ? 0.55 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <InjuryBadge week={week} slug={p.id} />
                <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p.team}</span>
              </button>
            );
          })}
        </div>
      ))}
      {bye.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.5 }}>
          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--faint)', fontWeight: 700, padding: '0 4px' }}>ON BYE · {bye.length}</span>
          {bye.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 3, padding: '6px 9px' }}>
              <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={16} />
              <span className="grotesk" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>BYE</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

// Which armed team buffs are relevant to a given spot — drives the on-spot
// highlight so you can see what a powerup applies to in your lineup.
export function buffAppliesToSpot(id: string, pos: Pos, metricId: string | null): boolean {
  const drip = metricId === 'combodrip' || metricId === 'recyd' || (pos === 'RB' && metricId === 'rush');
  switch (id) {
    case 'unlock-carries-wipe': return pos === 'WR' || pos === 'TE';
    case 'hail-mary': return pos === 'QB';
    case 'pick-six': return pos === 'DEF';
    case 'trick-play': return pos !== 'QB';
    case 'momentum': case 'floodgates': case 'overtime': return drip;
    case 'garbage-time': case 'counter-nuke': case 'insurance': case 'turnover-boost': return true;
    default: return false;
  }
}

// ── Setup row ──
// Marks the two Field General QBs that are paired under the Twin Generals power-up
// (their multipliers stack — the top two multiply together).
export function TwinChip() {
  return (
    <span className="mono" title="Twin Generals: this Field General is paired with your other Field General QB in this window — the top two multipliers stack (multiply)" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--fx-mult)', border: '1px solid color-mix(in srgb, var(--fx-mult) 55%, transparent)', background: 'color-mix(in srgb, var(--fx-mult) 14%, transparent)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>🎖️ TWIN ×2</span>
  );
}

export function SetupRow(props: {
  slotKeyStr: string; winId: WindowId; week: number; pick?: Pick; selected: boolean; inventory: Record<string, number>; armed: Record<string, boolean>; twinLink?: boolean;
  appliedPu: string[];
  applyMode: string | null; onApplyToSpot: () => void;
  onOpenPicker: () => void; onPickMetric: (m: string) => void; onClearSlot: () => void; onDropPlayer: (id: string) => void; onScout: () => void;
  lockPlayer?: boolean;
  // Player lookup — defaults to the baked demo registry; the live pilot injects
  // its own (so the same card renders against live roster data). `hideScout`
  // drops the SCOUT affordance where there's no opponent pool to scout (live pre-lock).
  resolve?: (id: string) => Player | undefined;
  hideScout?: boolean;
  /** Lock period (post-lock, pre-kick): player fixed, but the metric picker
   *  stays open RESTRICTED to the Underdog comeback flip (unlock-underdog). */
  preKick?: boolean;
}) {
  const { winId, week, pick, selected, inventory, armed, twinLink, appliedPu, applyMode, onApplyToSpot, onOpenPicker, onPickMetric, onClearSlot, onDropPlayer, onScout, lockPlayer, resolve, hideScout, preKick } = props;
  // Pre-kick, the metric door stays open ONLY for the Underdog flip — and only
  // when the unlock is actually owned (or the slot already flipped).
  const underdogDoor = !!preKick && ((inventory['unlock-underdog'] ?? 0) > 0 || pick?.metricId === 'underdog');
  const metricLocked = !!lockPlayer && !underdogDoor;
  const isMobile = useIsMobile();
  const { bigText, cardSkin } = useStore();
  const photoSkin = PHOTO_SKINS.includes(cardSkin); // a full-image card back → SEALED/SCOUT go in a bottom ribbon
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the card's fine print
  const gridCols = '1fr 1fr'; // no center gutter — your spot vs the sealed opponent
  const rowGap = isMobile ? 5 : 8;
  const player = pick ? ((resolve ?? getPlayer)(pick.playerId) ?? null) : null;
  const metric = player && pick?.metricId ? metricById(player.pos, pick.metricId) : null;
  // Jinx targets the OPPONENT's sealed card in this slot — the chip lands on it.
  const jinxMode = applyMode === 'jinx';
  const jinxed = appliedPu.includes('jinx');
  // Power-ups acting on THIS spot: armed team buffs that apply here, plus any
  // spot-specific applied powerup (Double or Nothing / Bye Steal).
  const spotBuffs = [
    ...(player ? Object.keys(armed).filter((id) => armed[id] && buffAppliesToSpot(id, player.pos, pick?.metricId ?? null)) : []),
    ...appliedPu,
  ];
  const buffChips = spotBuffs.map((id) => { const pu = powerupById(id); return (
    <span key={id} title={pu?.blurb} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: fs(8), fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--you) 40%, transparent)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>{pu?.icon} {pu?.name}</span>
  ); });
  // Apply mode: a targeted powerup is awaiting a spot. Double or Nothing / Lead
  // Change / Grudge / Red Herring stake one of YOUR filled spots; Jinx points at
  // the opponent in that window/slot (tap your spot at that index, blind); Bye
  // Steal fills an empty spot.
  // Jinx points at the OPPONENT's slot (a face-down target rendered by the caller),
  // not one of your own cards — so it's not a your-spot power-up here.
  const yourSpotPu = applyMode === 'double-or-nothing' || applyMode === 'lead-change' || applyMode === 'grudge' || applyMode === 'red-herring';
  const fillEligible = yourSpotPu && !!player;
  const emptyEligible = (applyMode === 'bye-steal' || applyMode === 'ghost') && !player;
  const applyHi = fillEligible;
  const applyDim = !!applyMode && !fillEligible && !emptyEligible;
  const cardTap = lockPlayer ? () => {} : applyMode ? (fillEligible ? onApplyToSpot : () => {}) : onOpenPicker;
  const applyPu = applyMode ? powerupById(applyMode) : null;
  // Metric selection lives in its own overlay modal (not inline in the card, which
  // would balloon its height and drag the sealed card with it). A freshly-placed
  // player with no metric auto-opens it; ↻ METRIC re-opens it to change.
  const [metricOpen, setMetricOpen] = useState(false);
  const [infoMetric, setInfoMetric] = useState<Metric | null>(null);
  useEffect(() => { if (pick?.playerId && !pick?.metricId && !lockPlayer && !applyMode) setMetricOpen(true); }, [pick?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const link: React.CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: fs(8.5), fontWeight: 700, letterSpacing: '0.1em' };

  return (
    <>
    <div className="mx-setpair" style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'stretch', gap: rowGap }}>
      {player ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          className={`mx-spot${applyHi || applyDim ? ' mx-state' : ''}${selected ? ' mx-sel' : ''}`}
          style={{ position: 'relative', minWidth: 0, background: applyHi ? 'color-mix(in srgb, var(--warn) 12%, var(--surface))' : selected ? 'var(--sh)' : 'var(--surface)', border: `1px ${applyHi ? 'dashed var(--warn)' : `solid ${selected ? 'var(--you)' : 'var(--bd)'}`}`, borderLeft: applyHi ? '3px dashed var(--warn)' : '3px solid var(--you)', borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7, opacity: applyDim ? 0.45 : 1 }}
        >
          {applyHi && (
            <div onClick={onApplyToSpot} style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--warn) 14%, transparent)', borderRadius: 4, cursor: 'pointer' }}>
              <span className="mono" style={{ fontSize: fs(9.5), fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 4, padding: '5px 9px' }}>{applyPu?.icon} TAP TO APPLY</span>
            </div>
          )}
          {/* Remove the player from this spot — compact red ✕ pinned top-right,
              clear of the metric list below. */}
          {!applyMode && !lockPlayer && (
            <button
              onClick={(e) => { e.stopPropagation(); onClearSlot(); }}
              title="Remove player from this spot"
              className="mono"
              style={{ position: 'absolute', top: 6, right: 6, zIndex: 3, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, lineHeight: 1, color: 'var(--opp)', background: 'var(--surface)', border: '1px solid var(--opp)', borderRadius: 4, cursor: 'pointer' }}
            >✕</button>
          )}
          {/* identity row — tap to swap the player; on desktop the spot's
              power-ups sit to the right of the headshot (below it on mobile). */}
          <div className="mx-id" style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, paddingRight: 22 }}>
            <div className="mx-idbtn" onClick={cardTap} style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flex: 1 }}>
              <PlayerImg playerId={player.id} team={player.team} pos={player.pos} size={isMobile ? 40 : 48} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
                  <InjuryBadge week={week} slug={player.id} />
                </div>
                <span className="mono" style={{ fontSize: fs(8.5), color: 'var(--faint)' }}>{player.pos} · {player.team}</span>
              </div>
            </div>
            {!isMobile && spotBuffs.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap', flex: 'none', maxWidth: '48%' }}>
                {buffChips}
              </div>
            )}
          </div>

          {/* mobile: armed power-ups acting on this spot, below the headshot */}
          {isMobile && spotBuffs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {buffChips}
            </div>
          )}

          {/* metric: the chosen metric (hidden from the opponent), or a prompt to
              pick one — either taps open the picker MODAL, keeping the card compact. */}
          <div className="mx-met" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, cursor: metricLocked ? undefined : 'pointer' }}
            onClick={metricLocked ? undefined : () => setMetricOpen(true)}>
            {pick?.metricId ? (
              <>
                <span className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--you)' }}>{metric?.name}</span>
                <span className="mono mx-hidden" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: fs(7), letterSpacing: '0.12em', color: 'var(--faint)' }}>
                  <span style={{ width: 5, height: 5, background: 'var(--you)', borderRadius: '50%', display: 'inline-block', animation: 'bpulse 2s ease infinite' }} /> HIDDEN
                </span>
                {twinLink && <TwinChip />}
              </>
            ) : (
              <span className="mono mx-editmet" style={{ fontSize: fs(9), fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', border: '1px dashed var(--warn)', borderRadius: 4, padding: '4px 9px' }}>＋ PICK A METRIC</span>
            )}
          </div>

          {/* change controls — pinned to the bottom of the spot */}
          <div style={{ display: 'flex', gap: 14, marginTop: 'auto', paddingTop: 4 }}>
            {pick?.metricId && !metricLocked && <button onClick={() => setMetricOpen(true)} className="mono mx-editmet" style={{ ...link, color: 'var(--warn)' }}>{preKick ? '🐕 UNDERDOG?' : '↻ METRIC'}</button>}
            {!lockPlayer && <button onClick={onOpenPicker} className="mono mx-editplr" style={{ ...link, color: 'var(--opp)' }}>⇄ PLAYER</button>}
          </div>
        </div>
      ) : (
        <div
          onClick={applyMode ? (emptyEligible ? onApplyToSpot : undefined) : lockPlayer ? undefined : onOpenPicker}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          className={`mx-empty${emptyEligible || applyDim ? ' mx-state' : ''}${selected ? ' mx-sel' : ''}`}
          style={{ minWidth: 0, minHeight: 78, background: emptyEligible ? 'color-mix(in srgb, var(--warn) 12%, transparent)' : selected ? 'var(--surface)' : 'transparent', border: `1px dashed ${emptyEligible ? 'var(--warn)' : selected ? 'var(--you)' : 'var(--bdh)'}`, borderLeft: `3px dashed ${emptyEligible ? 'var(--warn)' : selected ? 'var(--you)' : 'var(--bdh)'}`, borderRadius: 4, padding: '16px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', opacity: applyDim ? 0.4 : 1 }}
        >
          <span className="grotesk" style={{ fontSize: 20, color: emptyEligible ? 'var(--warn)' : 'var(--faint)' }}>{emptyEligible ? <PuIcon id={applyPu?.id} emoji={applyPu?.icon} size={22} /> : '+'}</span>
          <span className="mono" style={{ fontSize: bigText ? 10.5 : 10, color: emptyEligible ? 'var(--warn)' : 'var(--faint)', letterSpacing: '0.08em', fontWeight: emptyEligible ? 700 : 400, whiteSpace: 'nowrap' }}>{emptyEligible ? (applyMode === 'ghost' ? 'TAP TO FIELD GHOST' : 'TAP TO FIELD BYE') : 'TAP TO PICK PLAYER'}</span>
        </div>
      )}
      <div
        className="mx-sealed"
        onClick={jinxMode ? (jinxed ? undefined : onApplyToSpot) : (hideScout ? undefined : onScout)}
        title={jinxMode ? (jinxed ? 'Jinx armed on this opponent slot' : 'Point the Jinx at this opponent slot — the first TD their player scores here is negated') : hideScout ? 'Your opponent’s lineup is sealed until kickoff' : "Scout the opponent's possible players for this window"}
        style={{ position: 'relative', minWidth: 0, minHeight: 78, background: jinxMode ? 'color-mix(in srgb, var(--warn) 12%, var(--surface))' : 'color-mix(in srgb, var(--text) 3%, var(--surface))', border: `1px dashed ${jinxMode ? 'var(--warn)' : 'var(--bdh)'}`, borderRight: `3px dashed ${jinxMode ? 'var(--warn)' : 'var(--bdh)'}`, borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: jinxMode ? (jinxed ? 'default' : 'pointer') : hideScout ? 'default' : 'pointer' }}
      >
        {/* Jinx selector: a targeted opponent-slot bet lands its chip directly on
            the sealed card — tap it to point the hex at that slot (or shows JINXED
            once armed). */}
        {jinxMode && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--warn) 14%, transparent)', borderRadius: 4, cursor: jinxed ? 'default' : 'pointer' }}>
            <span className="mono" style={{ fontSize: fs(9.5), fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 4, padding: '5px 9px', ...(jinxed ? {} : { animation: 'bpulse 1.6s ease infinite' }) }}>🧿 {jinxed ? 'JINXED' : 'TAP TO JINX'}</span>
          </div>
        )}
        {photoSkin ? (
          // Photo-backed decks: the image IS the card and a face-down back already
          // reads as "sealed", so we drop the SEALED label entirely and leave just
          // a small SCOUT chip pinned to the bottom — minimal cover over the art.
          !hideScout && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 7, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <span className="mono" style={{ fontSize: fs(7.5), letterSpacing: '0.12em', color: '#F1E9D6', fontWeight: 700, background: 'rgba(6,8,12,0.78)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 999, padding: '3px 11px', textShadow: '0 1px 2px #000' }}><GameIcon name={UI_ART.scout} emoji="🔍" size="1.4em" /> SCOUT</span>
            </div>
          )
        ) : (
          <>
            <span className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--dim)' }}>◆</span>
            <span className="mono" style={{ fontSize: fs(9), letterSpacing: '0.16em', color: 'var(--faint)', fontWeight: 700 }}>SEALED · {winId.toUpperCase()}</span>
            {!hideScout && <span className="mono" style={{ fontSize: fs(7.5), letterSpacing: '0.12em', color: 'var(--opp)', fontWeight: 700 }}><GameIcon name={UI_ART.scout} emoji="🔍" size="1.6em" /> SCOUT</span>}
          </>
        )}
      </div>
    </div>
    {metricOpen && player && (
      <ModalBackdrop onClick={() => setMetricOpen(false)} zIndex={72} padTop={50}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 360, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '13px 15px', borderBottom: '1px solid var(--bd)' }}>
            <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              <PlayerImg playerId={player.id} team={player.team} pos={player.pos} size={34} />
              <div style={{ minWidth: 0 }}>
                <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Pick how he scores</div>
                <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 2, letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name.toUpperCase()} · {player.pos} · SEALED FROM YOUR OPPONENT UNTIL KICKOFF</div>
              </div>
            </div>
            <button onClick={() => setMetricOpen(false)} className="mono" style={{ flex: 'none', background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18, cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '60vh', overflow: 'auto' }}>
            {METRICS[player.pos].filter((m) => !m.lock || (inventory[m.lock] ?? 0) > 0 || m.id === pick?.metricId)
              .filter((m) => !preKick || m.id === pick?.metricId || m.id === 'underdog') // lock period: only the comeback flip
              .map((m) => {
              const cur = m.id === pick?.metricId;
              return (
                <button key={m.id} onClick={() => { onPickMetric(m.id); setMetricOpen(false); }} style={{ width: '100%', textAlign: 'left', background: cur ? 'color-mix(in srgb, var(--you) 14%, var(--bg))' : m.lock ? 'color-mix(in srgb, var(--warn) 12%, var(--bg))' : 'var(--bg)', border: `1px solid ${cur ? 'var(--you)' : m.lock ? 'var(--warn)' : 'var(--bd)'}`, borderRadius: 5, padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', cursor: 'pointer' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span className="grotesk" style={{ fontSize: 13, fontWeight: 700 }}>{m.lock ? '◈ ' : ''}{m.name}{cur ? ' ✓' : ''}</span>
                      <span className="mono" style={{ flex: 'none', fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: FX_COLOR[m.fx] ?? 'var(--dim)', border: `1px solid color-mix(in srgb, ${FX_COLOR[m.fx] ?? 'var(--dim)'} 45%, transparent)`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>{m.tag}</span>
                    </div>
                    {/* lead with what it DOES in plain English — the scoring math lives behind ⓘ */}
                    <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 3, lineHeight: 1.4 }}>{m.hook}</div>
                  </div>
                  <span role="button" title="Scoring math & full mechanics" onClick={(e) => { e.stopPropagation(); setInfoMetric(m); }} className="mono" style={{ flex: 'none', fontSize: 12, fontWeight: 700, color: 'var(--faint)', padding: '3px 7px', border: '1px solid var(--bd)', borderRadius: 4, cursor: 'help' }}>ⓘ</span>
                </button>
              );
            })}
          </div>
        </div>
      </ModalBackdrop>
    )}
    {infoMetric && <MetricInfo metric={infoMetric} onClose={() => setInfoMetric(null)} />}
    </>
  );
}

// Definition + mechanics card for a metric (the "?" on each pick).
function MetricInfo({ metric, onClose }: { metric: Metric; onClose: () => void }) {
  const c = FX_COLOR[metric.fx] ?? 'var(--you)';
  return (
    <ModalBackdrop onClick={onClose} zIndex={75} padTop={50}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{metric.lock ? '◈ ' : ''}{metric.name}</div>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: c, marginTop: 4 }}>{metric.tag}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 4 }}>SCORING</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{metric.sc}</div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 4 }}>MECHANICS</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--dim)' }}>{metric.ef}</div>
          </div>
          {metric.lock && <div className="mono" style={{ fontSize: 9.5, color: 'var(--warn)', fontWeight: 700 }}>◈ Unlock metric — requires the matching power-up.</div>}
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ── Player picker (tap a spot in setup) — choose from this window's roster ──
export function PlayerPicker({ win, week, players, currentId, title = 'Pick a player', subtitle = 'YOUR PLAYERS WHOSE GAME FALLS IN THIS WINDOW', onPick, onRemove, onClose, gated, onGated, cards = false }: {
  win: WindowId; week: number; players: Player[]; currentId?: string; title?: string; subtitle?: string;
  onPick: (id: string) => void; onRemove: () => void; onClose: () => void;
  gated?: (p: Player) => boolean; onGated?: (p: Player) => void; // opt-in premium lock (default: none)
  cards?: boolean; // card-table leagues: deal the candidates as player cards on a mini felt
}) {
  const label = windowsForWeek(week).find((w) => w.id === win)?.label ?? win.toUpperCase();
  const { bigText } = useStore();
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the list's fine print
  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{label} · {title}</div>
            <div className="mono" style={{ fontSize: fs(9), color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>{subtitle}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        {cards ? (
          // The felt spread: candidates dealt as tappable player cards.
          <div className="ctable" style={{ maxHeight: 440, overflowY: 'auto', overflowX: 'hidden', borderRadius: 0 }}>
            {players.length === 0 && <div className="mono" style={{ fontSize: fs(10), color: '#93A594', textAlign: 'center', padding: '16px 0' }}>— no eligible players in this window —</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 12, justifyContent: 'center', justifyItems: 'center', padding: '8px 4px' }}>
              {players.map((p, i) => {
                const sel = p.id === currentId;
                const isGated = !sel && !!gated?.(p);
                return (
                  <PlayerCard key={p.id} slug={p.id} name={p.name} pos={p.pos} team={p.team} slot={p.team ?? undefined} idx={i}
                    selected={sel} locked={isGated}
                    badge={<InjuryBadge week={week} slug={p.id} />}
                    onClick={() => (isGated ? onGated?.(p) : onPick(p.id))} />
                );
              })}
            </div>
          </div>
        ) : (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 440, overflow: 'auto' }}>
          {players.length === 0 && <div className="mono" style={{ fontSize: fs(10), color: 'var(--faint)', textAlign: 'center', padding: '16px 0' }}>— no eligible players in this window —</div>}
          {players.map((p) => {
            const sel = p.id === currentId;
            const isGated = !sel && !!gated?.(p); // premium position → locked
            return (
              <button key={p.id} onClick={() => (isGated ? onGated?.(p) : onPick(p.id))} style={{ display: 'flex', alignItems: 'center', gap: 10, background: sel ? 'var(--sh)' : 'var(--bg)', border: `1px solid ${sel ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '8px 10px', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', opacity: isGated ? 0.6 : 1 }}>
                <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <InjuryBadge week={week} slug={p.id} />
                  </div>
                  <span className="mono" style={{ fontSize: fs(8.5), color: 'var(--faint)' }}>{p.pos} · {p.team}</span>
                </div>
                {sel ? <span className="mono" style={{ fontSize: fs(8), color: 'var(--you)', flex: 'none' }}>CURRENT ✓</span>
                  : isGated ? <span title="Premium position — unlock premium" style={{ fontSize: 14, flex: 'none' }}>🔒</span> : null}
              </button>
            );
          })}
        </div>
        )}
        {currentId && (
          <div style={{ padding: '0 12px 12px' }}>
            <button onClick={onRemove} className="mono" style={{ width: '100%', background: 'var(--bg)', border: '1px dashed var(--opp)', borderRadius: 4, padding: '8px', color: 'var(--opp)', fontSize: fs(9), fontWeight: 700, letterSpacing: '0.08em' }}>✕ REMOVE FROM SPOT</button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

// ── Scout (tap a sealed opponent spot) — the candidate pool only ──
// Lists every opponent player whose game falls in this window: who they COULD
// field here. The actual pick stays sealed — the full pool is shown (no
// removal of slotted players), so nothing leaks by commission or omission.
export function ScoutModal({ win, week, pool, oppName, onClose }: {
  win: WindowId; week: number; pool: Player[]; oppName: string; onClose: () => void;
}) {
  const label = windowsForWeek(week).find((w) => w.id === win)?.label ?? win.toUpperCase();
  const posOrder: Pos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const sorted = [...pool].sort((a, b) => (posOrder.indexOf(a.pos) - posOrder.indexOf(b.pos)) || a.name.localeCompare(b.name));
  const { bigText } = useStore();
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the list's fine print
  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, borderTop: '3px solid var(--opp)', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}><GameIcon name={UI_ART.scout} emoji="🔍" size="1.2em" /> Scout · {label}</div>
            <div className="mono" style={{ fontSize: fs(9), color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>WHO {oppName.toUpperCase()} COULD FIELD HERE — PICK STAYS SEALED</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 440, overflow: 'auto' }}>
          {sorted.length === 0 && <div className="mono" style={{ fontSize: fs(10), color: 'var(--faint)', textAlign: 'center', padding: '16px 0' }}>— no opponent players in this window —</div>}
          {sorted.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px' }}>
              <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{p.name}</span>
                  <InjuryBadge week={week} slug={p.id} />
                </div>
                <span className="mono" style={{ fontSize: fs(8.5), color: 'var(--faint)' }}>{p.pos} · {p.team}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <div className="mono" style={{ fontSize: fs(8.5), color: 'var(--faint)', textAlign: 'center', lineHeight: 1.5 }}>
            ◆ {sorted.length} candidate{sorted.length === 1 ? '' : 's'} · any could be in any of {oppName}'s {label} spots
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}
