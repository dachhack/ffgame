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
import type { WidgetSnapshot, FixPlayer } from '@drip/core/data/widgetFeed';
import { TRADE_IDEA_LABEL } from '@drip/core/data/tradeIdeas';
import { injuryTag } from '@drip/core/data/heroes';
import { loadToolLeagues, saveToolLeagues, toggleToolLeague, toolHas, forTool, toolLeaguesOffCount, toolsForLeague, TOOL_NAME, type ToolId, type ToolLeagueOff } from '@drip/core/data/toolLeagues';
import { lineupAlerts, lineupAlertCount, wireTargets, wireTargetCount, FIX_KIND_LABEL, tradeIdeaLeagues, tradeIdeaBadge, wireLensGroups, wireTargetTag, wireTargetBadge, WIRE_LENS_LABEL, loadTradeZone, tradeZoneCount, TRADE_ZONE_ORDER, TRADE_ZONE_TITLE, type TradeZoneItem } from '@drip/core/data/leagueTools';
import { Sheet, Crest } from '../app/ui';
import { crestFor } from '@drip/core/data/crest';
import { HeroesVillains } from './HeroesVillains';

type Tool = 'preview' | 'lineup' | 'wire' | 'trades' | 'options';
export interface ToolLeague { id: string; name: string; rosterId: number; native: boolean; contest: boolean; /** The league's avatar (v0.722.0). */ avatar?: string | null }

const chip = (on: boolean): React.CSSProperties => ({
  flex: 'none', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: 999, padding: '5px 10px',
  color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--surface)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`,
});
const mono = (size: number, color = 'var(--faint)'): React.CSSProperties => ({ fontSize: size, color, lineHeight: 1.5 });
const box: React.CSSProperties = { border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg)', overflow: 'hidden' };
const initials = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
/** A player's face (v0.722.0): his headshot in a ring, else his initials. */
function Face({ image, name, size = 30, tone }: { image?: string | null; name: string; size?: number; tone: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span style={{ flex: 'none', width: size, height: size, borderRadius: '50%', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${tone}`, background: `color-mix(in srgb, ${tone} 16%, transparent)` }}>
      {image && !broken
        ? <img src={image} alt="" width={size} height={size} onError={() => setBroken(true)} style={{ objectFit: 'cover', width: size, height: size }} />
        : <span className="mono" style={{ fontSize: size * 0.34, fontWeight: 700, color: tone }}>{initials(name)}</span>}
    </span>
  );
}

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
  const leagueOf = (id: string) => leagues.find((l) => l.id === id);
  // A lineup fix's player (v0.726.0): face, name, injury tag, projection.
  const fixPlayer = (p: FixPlayer, tone: string) => (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
      <Face image={p.image} name={p.name} size={24} tone={tone} />
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {p.name}{inj(p.injury)}{p.proj != null ? <span className="mono" style={{ ...mono(10), fontWeight: 400 }}>{` ${p.proj.toFixed(1)}`}</span> : null}
      </span>
    </span>
  );
  // INJURY STATUS on every player the tools name (v0.723.0).
  const inj = (tag: string | null | undefined) => (injuryTag(tag)
    ? <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: 'var(--warn)' }}>{` ${injuryTag(tag)}`}</span> : null);
  // Which league's waiver targets or trade ideas are open (v0.722.0).
  const [shown, setShown] = useState<string | null>(null);
  const leagueRow = (k: string, avatar: string | null | undefined, name: string, count: string) => (
    <button onClick={() => setShown((v) => (v === k ? null : k))} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: 10, width: 'calc(100% - 20px)' }}>
      <Crest crest={crestFor({ leagueAvatar: avatar, leagueName: name })} size={32} radius={6} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span className="mono" style={{ ...mono(11, 'var(--you)'), fontWeight: 700 }}>{count}</span>
      <span className="mono" style={mono(12, 'var(--dim)')}>{shown === k ? '▴' : '▾'}</span>
    </button>
  );

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

      {/* OPTIONS (v0.721.0): each league, then a box per tool it feeds. */}
      {open === 'options' && (
        <Sheet title="Tool options" subtitle="WHICH TOOLS EACH LEAGUE FEEDS" onClose={() => setOpen(null)} max={560}>
          <div style={{ display: 'grid', gap: 4 }}>
            {leagues.map((l) => (
              <div key={l.id} style={{ borderTop: '1px solid var(--bd)', padding: '8px 0 4px', display: 'grid', gap: 2 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                {toolsForLeague(l).map((tool) => (
                  <label key={tool} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', cursor: 'pointer', fontSize: 13.5, color: toolHas(off, tool, l.id) ? 'var(--text)' : 'var(--dim)' }}>
                    <input type="checkbox" checked={toolHas(off, tool, l.id)} onChange={() => flip(tool, l.id)} style={{ width: 18, height: 18, accentColor: 'var(--you)', margin: 0 }} />
                    {TOOL_NAME[tool]}
                  </label>
                ))}
              </div>
            ))}
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
                {/* v0.726.0: each fix as its players, faces and injury tags, under a plain label. */}
                {a.fixes.map((f, i) => (
                  <span key={i} style={{ display: 'grid', gap: 4, paddingTop: 6, borderTop: '1px solid var(--bd)' }}>
                    <span className="mono" style={{ ...mono(9.5, f.kind === 'injury' || f.kind === 'none' ? 'var(--warn)' : 'var(--faint)'), fontWeight: 700, letterSpacing: '0.12em' }}>{`${f.winLabel ? `${f.winLabel} · ` : ''}${FIX_KIND_LABEL[f.kind]}`}</span>
                    {f.out || f.in ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        {f.out && fixPlayer(f.out, 'var(--opp)')}
                        {f.out && f.in && <span className="mono" style={mono(12)}>→</span>}
                        {f.in && fixPlayer(f.in, 'var(--you)')}
                        {f.out && !f.in && <span className="mono" style={mono(10.5)}>nobody on the bench fits</span>}
                      </span>
                    ) : <span className="mono" style={mono(11.5, 'var(--dim)')}>{f.text}</span>}
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
            {/* BY LEAGUE (v0.722.0): avatar and count; click for the targets with faces. */}
            {wire.map((l) => {
              const k = `wire:${l.leagueId}:${l.rosterId}`;
              return (
                <div key={k} style={box}>
                  {leagueRow(k, leagueOf(l.leagueId)?.avatar, l.leagueName, `${l.targets.length} target${l.targets.length === 1 ? '' : 's'}`)}
                  {shown === k && (
                    <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
                      {wireLensGroups(l.targets).map((g) => (
                        <div key={g.lens ?? 'all'} style={{ display: 'grid', gap: 8 }}>
                          {g.lens && <div className="mono" style={{ ...mono(9.5, g.lens === 'now' ? 'var(--you)' : 'var(--faint)'), fontWeight: 700, letterSpacing: '0.14em' }}>{WIRE_LENS_LABEL[g.lens]}</div>}
                          {g.rows.map((w) => (
                            <button key={`${g.lens}:${w.add}`} onClick={() => go(l.leagueId, l.rosterId)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Face image={w.addImage} name={w.addName} tone="var(--you)" />
                              <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 1 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.addName} <span className="mono" style={mono(10)}>{`${w.pos}${w.team ? ` · ${w.team}` : ''}`}</span>{inj(w.addInjury)}</span>
                                <span className="mono" style={mono(10.5, 'var(--dim)')}>{wireTargetTag(w)}</span>
                                {w.dropName && (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                                    <span className="mono" style={mono(9.5)}>for</span>
                                    <Face image={w.dropImage} name={w.dropName} size={18} tone="var(--opp)" />
                                    <span className="mono" style={{ ...mono(10.5, 'var(--dim)'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.dropName}{inj(w.dropInjury)}</span>
                                  </span>
                                )}
                              </span>
                              {wireTargetBadge(w) && <span className="mono" style={{ ...mono(11, 'var(--you)'), fontWeight: 700 }}>{wireTargetBadge(w)}</span>}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
              <div className="mono" style={{ ...mono(9.5, 'var(--you)'), fontWeight: 700, letterSpacing: '0.14em' }}>SUGGESTED</div>
              {/* BY LEAGUE (v0.722.0): avatar and count; click for the trades with faces. */}
              {ideas.map((l) => {
                const k = `trade:${l.leagueId}:${l.rosterId}`;
                return (
                  <div key={k} style={box}>
                    {leagueRow(k, leagueOf(l.leagueId)?.avatar, l.leagueName, `${l.ideas.length} trade${l.ideas.length === 1 ? '' : 's'}`)}
                    {shown === k && (
                      <div style={{ display: 'grid', gap: 10, padding: '0 10px 10px' }}>
                        {l.ideas.map((x, i) => (
                          <button key={i} onClick={() => go(l.leagueId, l.rosterId)} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 6, borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.partnerName}</span>
                              <span className="mono" style={{ ...mono(9.5), fontWeight: 700, letterSpacing: '0.1em' }}>{TRADE_IDEA_LABEL[x.kind]}</span>
                            </span>
                            <span style={{ display: 'flex', gap: 10 }}>
                              {([['GIVE', x.give, 'var(--opp)'], ['GET', x.get, 'var(--you)']] as const).map(([lab, ps, tone]) => (
                                <span key={lab} style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
                                  <span className="mono" style={{ ...mono(9), fontWeight: 700, letterSpacing: '0.14em' }}>{lab}</span>
                                  {ps.map((p) => (
                                    <span key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                      <Face image={p.image} name={p.name} size={28} tone={tone} />
                                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name} <span className="mono" style={mono(9.5)}>{p.pos}</span>{inj(p.injury)}</span>
                                    </span>
                                  ))}
                                </span>
                              ))}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="mono" style={{ ...mono(10.5), flex: 1, minWidth: 0 }}>{x.why}</span>
                              <span className="mono" style={{ ...mono(10.5, 'var(--you)'), fontWeight: 700 }}>{tradeIdeaBadge(x)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>}
          </div>
        </Sheet>
      )}
    </>
  );
}
