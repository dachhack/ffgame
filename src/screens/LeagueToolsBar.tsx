// THE LEAGUE TOOLS BAR (v0.715.0) — the web's twin of the phone's
// (apps/mobile/src/ui/LeagueToolsBar.tsx). Founder: "Right now the league
// tools bar is just heroes and villains. I'd like it to be a scrollable bar of
// tools for players: all fields, heroes and villains, line up suggestions and
// alerts, waiver targets, trade zone, etc."
//
// One row of chips under "Your leagues" that scrolls sideways rather than
// wrapping; each opens its tool in a sheet. Counts are what wants an answer.
// v0.718.0 (founder): no emojis on the bar, HEROES & VILLAINS is PREVIEW, and
// OPTIONS picks the leagues each tool reads (core toolLeagues, per device).
import { useEffect, useMemo, useState } from 'react';
import type { WidgetSnapshot } from '@drip/core/data/widgetFeed';
import { TRADE_IDEA_LABEL } from '@drip/core/data/tradeIdeas';
import { loadToolLeagues, saveToolLeagues, toggleToolLeague, toolHas, forTool, toolLeaguesOffCount, TOOL_IDS, TOOL_LABEL, type ToolId, type ToolLeagueOff } from '@drip/core/data/toolLeagues';
import { lineupAlerts, lineupAlertCount, wireTargets, wireTargetCount, tradeIdeaLeagues, tradeIdeaBadge, wireLensGroups, wireTargetLine, wireTargetBadge, WIRE_LENS_LABEL, loadTradeZone, tradeZoneCount, TRADE_ZONE_ORDER, TRADE_ZONE_TITLE, type TradeZoneItem } from '@drip/core/data/leagueTools';
import { Sheet } from '../app/ui';
import { HeroesVillains } from './HeroesVillains';

type Tool = 'preview' | 'lineup' | 'wire' | 'trades' | 'options';
export interface ToolLeague { id: string; name: string; rosterId: number; native: boolean; contest: boolean }

const chip = (on: boolean): React.CSSProperties => ({
  flex: 'none', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: 999, padding: '5px 10px',
  color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--surface)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`,
});
const mono = (size: number, color = 'var(--faint)'): React.CSSProperties => ({ fontSize: size, color, lineHeight: 1.5 });

export function LeagueToolsBar({ snaps, leagues, onFields, onOpenLeague }: {
  snaps: WidgetSnapshot[]; leagues: ToolLeague[];
  /** ALL FIELDS — the leagues page's own fields board. */
  onFields: () => void;
  onOpenLeague: (leagueId: string, rosterId: number) => void;
}) {
  const [open, setOpen] = useState<Tool | null>(null);
  const [off, setOff] = useState<ToolLeagueOff>(() => loadToolLeagues());
  const flip = (tool: ToolId, id: string) => setOff((v) => { const n = toggleToolLeague(v, tool, id); saveToolLeagues(n); return n; });
  const previewSnaps = useMemo(() => forTool(off, 'preview', snaps), [snaps, off]);
  const lineupSnaps = useMemo(() => forTool(off, 'lineup', snaps), [snaps, off]);
  const wireSnaps = useMemo(() => forTool(off, 'wire', snaps), [snaps, off]);
  const alerts = useMemo(() => lineupAlerts(lineupSnaps), [lineupSnaps]);
  const alertN = useMemo(() => lineupAlertCount(lineupSnaps), [lineupSnaps]);
  const wire = useMemo(() => wireTargets(wireSnaps), [wireSnaps]);
  const ideas = useMemo(() => tradeIdeaLeagues(forTool(off, 'trades', snaps)), [snaps, off]);
  const wireN = useMemo(() => wireTargetCount(wireSnaps), [wireSnaps]);
  // Waiver targets and the trade zone are for native, non-contest leagues.
  const nativeLeagues = useMemo(() => leagues.filter((l) => l.native && !l.contest), [leagues]);
  const tradeLeagues = useMemo(() => nativeLeagues.filter((l) => toolHas(off, 'trades', l.id)), [nativeLeagues, off]);
  const tradeKey = tradeLeagues.map((l) => `${l.id}:${l.rosterId}`).join('|');
  const [zone, setZone] = useState<TradeZoneItem[] | null>(null);
  useEffect(() => {
    if (!tradeLeagues.length) { setZone([]); return; }
    setZone(null);
    let dead = false;
    loadTradeZone(tradeLeagues).then((z) => { if (!dead) setZone(z); }).catch(() => { if (!dead) setZone([]); });
    return () => { dead = true; };
  }, [tradeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneN = zone ? tradeZoneCount(zone) : 0;
  const offN = toolLeaguesOffCount(off, leagues.map((l) => l.id));
  const go = (leagueId: string, rosterId: number) => { setOpen(null); onOpenLeague(leagueId, rosterId); };

  return (
    <>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 12 }}>
        <button className="mono" style={chip(false)} onClick={onFields}>ALL FIELDS</button>
        <button className="mono" style={chip(false)} onClick={() => setOpen('preview')}>PREVIEW</button>
        <button className="mono" style={chip(alertN > 0)} onClick={() => setOpen('lineup')}>{`LINEUP${alertN ? ` · ${alertN}` : ''}`}</button>
        {nativeLeagues.length > 0 && <button className="mono" style={chip(wireN > 0)} onClick={() => setOpen('wire')}>{`WAIVER TARGETS${wireN ? ` · ${wireN}` : ''}`}</button>}
        {nativeLeagues.length > 0 && <button className="mono" style={chip(zoneN > 0)} onClick={() => setOpen('trades')}>{`TRADE ZONE${zoneN ? ` · ${zoneN}` : ''}`}</button>}
        <button className="mono" style={chip(false)} onClick={() => setOpen('options')}>{`OPTIONS${offN ? ` · ${offN} off` : ''}`}</button>
      </div>

      {open === 'preview' && (
        <Sheet title="Preview" subtitle="WHO TO ROOT FOR, ACROSS YOUR LEAGUES" onClose={() => setOpen(null)} max={620}>
          <HeroesVillains snaps={previewSnaps} />
        </Sheet>
      )}

      {open === 'options' && (
        <Sheet title="Tool options" subtitle="THE LEAGUES EACH TOOL READS" onClose={() => setOpen(null)} max={560}>
          <div style={{ display: 'grid', gap: 14 }}>
            {TOOL_IDS.map((tool) => {
              const pool = tool === 'wire' || tool === 'trades' ? nativeLeagues : leagues;
              if (!pool.length) return null;
              return (
                <div key={tool} style={{ display: 'grid', gap: 6 }}>
                  <div className="mono" style={{ ...mono(9.5), fontWeight: 700, letterSpacing: '0.14em' }}>{TOOL_LABEL[tool]}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {pool.map((l) => <button key={l.id} className="mono" style={chip(toolHas(off, tool, l.id))} onClick={() => flip(tool, l.id)}>{l.name}</button>)}
                  </div>
                </div>
              );
            })}
          </div>
        </Sheet>
      )}

      {open === 'lineup' && (
        <Sheet title="Lineup alerts" subtitle="WHAT TO FIX, ACROSS YOUR LEAGUES" onClose={() => setOpen(null)} max={560}>
          <div style={{ display: 'grid', gap: 10 }}>
            {alerts.length === 0 && <div className="mono" style={mono(11)}>Nothing to fix — every lineup is set.</div>}
            {alerts.map((a) => (
              <button key={`${a.leagueId}:${a.rosterId}`} onClick={() => go(a.leagueId, a.rosterId)}
                style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 4, border: '1px solid var(--bd)', borderRadius: 8, padding: 10, background: 'var(--bg)' }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.leagueName}</span>
                  <span className="mono" style={mono(10)}>{a.weekLabel}</span>
                  <span className="mono" style={{ ...mono(11, 'var(--you)'), fontWeight: 700 }}>→</span>
                </span>
                {a.fixes.map((f, i) => (
                  <span key={i} className="mono" style={mono(11.5, f.kind === 'injury' || f.kind === 'none' ? 'var(--warn)' : 'var(--dim)')}>
                    {`${f.kind === 'swap' ? '⇄' : f.kind === 'injury' ? '🩹' : f.kind === 'bye' ? '💤' : '•'} ${f.winLabel ? `${f.winLabel}: ` : ''}${f.text}`}
                  </span>
                ))}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {open === 'wire' && (
        <Sheet title="Waiver targets" subtitle="WHO ON THE WIRE HELPS THIS WEEK" onClose={() => setOpen(null)} max={560}>
          <div style={{ display: 'grid', gap: 10 }}>
            {wire.length === 0 && <div className="mono" style={mono(11)}>Nobody on the wire beats what you have.</div>}
            {wire.map((l) => (
              <button key={`${l.leagueId}:${l.rosterId}`} onClick={() => go(l.leagueId, l.rosterId)}
                style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 6, border: '1px solid var(--bd)', borderRadius: 8, padding: 10, background: 'var(--bg)' }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.leagueName}</span>
                  <span className="mono" style={mono(10)}>{l.weekLabel}</span>
                  <span className="mono" style={{ ...mono(11, 'var(--you)'), fontWeight: 700 }}>→</span>
                </span>
                {wireLensGroups(l.targets).map((g) => (
                  <span key={g.lens ?? 'all'} style={{ display: 'grid', gap: 6 }}>
                    {g.lens && <span className="mono" style={{ ...mono(9.5, g.lens === 'now' ? 'var(--you)' : 'var(--faint)'), fontWeight: 700, letterSpacing: '0.14em' }}>{WIRE_LENS_LABEL[g.lens]}</span>}
                    {g.rows.map((w) => (
                      <span key={`${g.lens}:${w.add}`} style={{ display: 'grid', gap: 1 }}>
                        <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {`+ ${w.addName}`} <span className="mono" style={mono(10)}>{`${w.pos}${w.team ? ` · ${w.team}` : ''}`}</span>
                          </span>
                          {wireTargetBadge(w) && <span className="mono" style={{ ...mono(11, 'var(--you)'), fontWeight: 700 }}>{wireTargetBadge(w)}</span>}
                        </span>
                        <span className="mono" style={mono(11, 'var(--dim)')}>{wireTargetLine(w)}</span>
                      </span>
                    ))}
                  </span>
                ))}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {open === 'trades' && (
        <Sheet title="Trade zone" subtitle="OFFERS, WANTS, THE BLOCK AND IDEAS" onClose={() => setOpen(null)} max={560}>
          <div style={{ display: 'grid', gap: 12 }}>
            {zone === null && <div className="mono" style={mono(11)}>Reading your leagues…</div>}
            {zone !== null && zone.length === 0 && !ideas.length && <div className="mono" style={mono(11)}>Quiet — no offers, wants or players on the block in your leagues.</div>}
            {zone !== null && TRADE_ZONE_ORDER.map((kind) => {
              const rows = zone.filter((z) => z.kind === kind);
              if (!rows.length) return null;
              const hot = kind === 'offer_in' || kind === 'want';
              return (
                <div key={kind} style={{ display: 'grid', gap: 6 }}>
                  <div className="mono" style={{ ...mono(9.5, hot ? 'var(--you)' : 'var(--faint)'), fontWeight: 700, letterSpacing: '0.14em' }}>{`${TRADE_ZONE_TITLE[kind]} · ${rows.length}`}</div>
                  {rows.map((z, i) => (
                    <button key={`${kind}-${i}`} onClick={() => go(z.leagueId, z.rosterId)}
                      style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 2, border: `1px solid ${kind === 'offer_in' ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 8, padding: 9, background: kind === 'offer_in' ? 'color-mix(in srgb, var(--you) 8%, var(--bg))' : 'var(--bg)' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{z.team} <span className="mono" style={mono(10)}>{z.leagueName}</span></span>
                      <span className="mono" style={mono(11.5, 'var(--dim)')}>
                        {kind === 'offer_in' ? `you get ${z.get.join(', ') || '—'} · you give ${z.give.join(', ') || '—'}`
                          : kind === 'offer_out' ? `you offered ${z.give.join(', ') || '—'} for ${z.get.join(', ') || '—'}`
                          : kind === 'want' ? `wants ${z.give.join(', ')}`
                          : `${z.get.join(', ')} is available`}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
            {ideas.length > 0 && <div style={{ display: 'grid', gap: 8 }}>
              <div className="mono" style={{ ...mono(9.5, 'var(--you)'), fontWeight: 700, letterSpacing: '0.14em' }}>{`SUGGESTED · ${ideas.reduce((n, l) => n + l.ideas.length, 0)}`}</div>
              {ideas.map((l) => l.ideas.map((x, i) => (
                <button key={`${l.leagueId}-${i}`} onClick={() => go(l.leagueId, l.rosterId)}
                  style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 3, border: '1px solid var(--bd)', borderRadius: 8, padding: 9, background: 'var(--bg)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.partnerName} <span className="mono" style={mono(10)}>{l.leagueName}</span></span>
                    <span className="mono" style={{ ...mono(9.5), fontWeight: 700, letterSpacing: '0.1em' }}>{TRADE_IDEA_LABEL[x.kind]}</span>
                  </span>
                  <span className="mono" style={mono(11.5, 'var(--text)')}>{`give ${x.give.map((p) => `${p.name} ${p.pos}`).join(', ')} · get ${x.get.map((p) => `${p.name} ${p.pos}`).join(', ')}`}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mono" style={{ ...mono(10.5), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.why}</span>
                    <span className="mono" style={{ ...mono(10.5, 'var(--you)'), fontWeight: 700 }}>{tradeIdeaBadge(x)}</span>
                  </span>
                </button>
              )))}
            </div>}
          </div>
        </Sheet>
      )}
    </>
  );
}
