// THE LEAGUE TOOLS BAR (v0.715.0). Founder: "Right now the league tools bar is
// just heroes and villains. I'd like it to be a scrollable bar of tools for
// players: all fields, heroes and villains, line up suggestions and alerts,
// waiver targets, trade zone, etc."
//
// One row of chips under "Your leagues", sideways-scrolling; each opens its
// tool in a sheet. The counts on a chip are what wants your attention.
// v0.718.0 (founder): no emojis on the bar, HEROES & VILLAINS is PREVIEW, and
// OPTIONS picks the leagues each tool reads (core toolLeagues, per device).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WidgetSnapshot, FixPlayer } from '@drip/core/data/widgetFeed';
import { TRADE_IDEA_LABEL } from '@drip/core/data/tradeIdeas';
import { injuryTag } from '@drip/core/data/heroes';
import { loadToolLeagues, saveToolLeagues, toggleToolLeague, toolHas, forTool, toolLeaguesOffCount, toolsForLeague, TOOL_NAME, type ToolId, type ToolLeagueOff } from '@drip/core/data/toolLeagues';
import { lineupAlerts, lineupAlertCount, wireTargets, wireTargetCount, FIX_KIND_LABEL, tradeIdeaLeagues, tradeIdeaBadge, wireLensGroups, wireTargetTag, wireTargetBadge, WIRE_LENS_LABEL, loadTradeZone, tradeZoneCount, TRADE_ZONE_ORDER, TRADE_ZONE_TITLE, type TradeZoneItem } from '@drip/core/data/leagueTools';
import { useTheme, MONO, alpha } from '../theme.native';
import { tap } from './feedback';
import { Chip, Mono } from './prims';
import { Overlay } from './Overlay';
import { AllFieldsSheet } from './AllFieldsSheet';
import { HeroesVillains } from './HeroesVillains';
import { Crest } from './LeagueCrest';
import { PlayerFace } from './PlayerFace';

type Tool = 'fields' | 'preview' | 'lineup' | 'wire' | 'trades' | 'options';
export interface ToolLeague { id: string; name: string; rosterId: number; native: boolean; contest: boolean; /** The league's avatar (v0.722.0). */ avatar?: string | null }

export function LeagueToolsBar({ snaps, leagues, onOpenLeague }: {
  snaps: WidgetSnapshot[];
  leagues: ToolLeague[];
  /** Open a league — on its lineup ('picks') or its home. */
  onOpenLeague: (leagueId: string, rosterId: number, landing: 'picks' | 'home') => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState<Tool | null>(null);
  const [off, setOff] = useState<ToolLeagueOff>(() => loadToolLeagues());
  const flip = (tool: ToolId, id: string) => { tap(); setOff((v) => { const n = toggleToolLeague(v, tool, id); saveToolLeagues(n); return n; }); };
  const snapsFor = (tool: ToolId) => forTool(off, tool, snaps);
  const previewSnaps = useMemo(() => snapsFor('preview'), [snaps, off]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineupSnaps = useMemo(() => snapsFor('lineup'), [snaps, off]); // eslint-disable-line react-hooks/exhaustive-deps
  const wireSnaps = useMemo(() => snapsFor('wire'), [snaps, off]); // eslint-disable-line react-hooks/exhaustive-deps
  const alerts = useMemo(() => lineupAlerts(lineupSnaps), [lineupSnaps]);
  const alertN = useMemo(() => lineupAlertCount(lineupSnaps), [lineupSnaps]);
  const wire = useMemo(() => wireTargets(wireSnaps), [wireSnaps]);
  const tradeSnaps = useMemo(() => snapsFor('trades'), [snaps, off]); // eslint-disable-line react-hooks/exhaustive-deps
  const ideas = useMemo(() => tradeIdeaLeagues(tradeSnaps), [tradeSnaps]);
  const wireN = useMemo(() => wireTargetCount(wireSnaps), [wireSnaps]);
  // Waiver targets and the trade zone are for native, non-contest leagues.
  const nativeLeagues = useMemo(() => leagues.filter((l) => l.native && !l.contest), [leagues]);
  // The trade zone reads once per visit (two small reads per native league).
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
  const pick = (x: Tool) => { tap(); setOpen(x); };
  const leagueOf = (id: string) => leagues.find((l) => l.id === id);
  // A lineup fix's player (v0.726.0): face, name, injury tag, projection.
  const fixPlayer = (p: FixPlayer, tone: string) => (
    <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <PlayerFace image={p.image} name={p.name} size={24} tone={tone} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: t.text }}>
        {p.name}{inj(p.injury)}{p.proj != null ? <Text style={{ fontFamily: MONO, fontSize: 10, color: t.faint, fontWeight: '400' }}>{` ${p.proj.toFixed(1)}`}</Text> : null}
      </Text>
    </View>
  );
  // INJURY STATUS on every player the tools name (v0.723.0).
  const inj = (tag: string | null | undefined) => (injuryTag(tag)
    ? <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '800', color: t.warn }}>{` ${injuryTag(tag)}`}</Text> : null);
  // Which league's waiver targets or trade ideas are open (v0.722.0).
  const [shown, setShown] = useState<string | null>(null);
  const leagueRow = (k: string, avatar: string | null | undefined, name: string, count: string) => (
    <Pressable onPress={() => { tap(); setShown((v) => (v === k ? null : k)); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 }}>
      <Crest url={avatar} name={name} size={32} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: t.text }}>{name}</Text>
      <Mono size={10} tone="you" weight="700">{count}</Mono>
      <Text style={{ fontFamily: MONO, fontSize: 12, color: t.dim }}>{shown === k ? '▴' : '▾'}</Text>
    </Pressable>
  );

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
        <Chip small label="ALL FIELDS" onPress={() => pick('fields')} />
        <Chip small label="PREVIEW" onPress={() => pick('preview')} />
        <Chip small label={`LINEUP${alertN ? ` · ${alertN}` : ''}`} on={alertN > 0} onPress={() => pick('lineup')} />
        {nativeLeagues.length > 0 && <Chip small label={`WAIVER TARGETS${wireN ? ` · ${wireN}` : ''}`} on={wireN > 0} onPress={() => pick('wire')} />}
        {nativeLeagues.length > 0 && <Chip small label={`TRADE ZONE${zoneN ? ` · ${zoneN}` : ''}`} on={zoneN > 0} onPress={() => pick('trades')} />}
        <Chip small label={`OPTIONS${offN ? ` · ${offN} off` : ''}`} onPress={() => pick('options')} />
      </ScrollView>

      <AllFieldsSheet visible={open === 'fields'} onClose={() => setOpen(null)} />

      <Overlay visible={open === 'preview'} title="Preview" subtitle="WHO TO ROOT FOR, ACROSS YOUR LEAGUES" onClose={() => setOpen(null)}>
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <HeroesVillains snaps={previewSnaps} />
        </ScrollView>
      </Overlay>

      {/* OPTIONS (v0.721.0, founder: "League then setting for each tool as a
          list with check boxes"): each league, then a box per tool it feeds. */}
      <Overlay visible={open === 'options'} title="Tool options" subtitle="WHICH TOOLS EACH LEAGUE FEEDS" onClose={() => setOpen(null)}>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
          {leagues.map((l) => (
            <View key={l.id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8, paddingBottom: 4, gap: 4 }}>
              <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: t.text }}>{l.name}</Text>
              {toolsForLeague(l).map((tool) => {
                const on = toolHas(off, tool, l.id);
                return (
                  <Pressable key={tool} onPress={() => flip(tool, l.id)} hitSlop={4} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: on ? t.you : t.dim, backgroundColor: on ? t.you : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <Text style={{ fontSize: 13, fontWeight: '800', color: t.bg, lineHeight: 15 }}>✓</Text>}
                    </View>
                    <Text style={{ fontSize: 13.5, color: on ? t.text : t.dim }}>{TOOL_NAME[tool]}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </Overlay>

      <Overlay visible={open === 'lineup'} title="Lineup alerts" subtitle="WHAT TO FIX, ACROSS YOUR LEAGUES" onClose={() => setOpen(null)}>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
          {alerts.length === 0 && <Mono size={10} tone="faint">Nothing to fix — every lineup is set.</Mono>}
          {alerts.map((a) => (
            <Pressable key={`${a.leagueId}:${a.rosterId}`} onPress={() => { tap(); setOpen(null); onOpenLeague(a.leagueId, a.rosterId, 'picks'); }}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 10, gap: 4, backgroundColor: t.bg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: t.text }}>{a.leagueName}</Text>
                <Mono size={9} tone="faint">{a.weekLabel}</Mono>
                <Mono size={10} tone="you" weight="700">→</Mono>
              </View>
              {/* v0.726.0: each fix as its players — the starter coming out and
                  the man to start instead, faces and injury tags — under a
                  plain label in place of the old emoji marks. */}
              {a.fixes.map((f, i) => (
                <View key={i} style={{ gap: 4, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                  <Mono size={8.5} weight="700" track={0.12} tone={f.kind === 'injury' || f.kind === 'none' ? 'warn' : 'faint'}>{`${f.winLabel ? `${f.winLabel} · ` : ''}${FIX_KIND_LABEL[f.kind]}`}</Mono>
                  {f.out || f.in ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {f.out && fixPlayer(f.out, t.opp)}
                      {f.out && f.in && <Mono size={11} tone="faint">→</Mono>}
                      {f.in && fixPlayer(f.in, t.you)}
                      {f.out && !f.in && <Mono size={9.5} tone="faint">nobody on the bench fits</Mono>}
                    </View>
                  ) : <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: 16, color: t.dim }}>{f.text}</Text>}
                </View>
              ))}
            </Pressable>
          ))}
        </ScrollView>
      </Overlay>

      <Overlay visible={open === 'wire'} title="Waiver targets" subtitle="WHO ON THE WIRE HELPS THIS WEEK" onClose={() => setOpen(null)}>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
          {wire.length === 0 && <Mono size={10} tone="faint">Nobody on the wire beats what you have.</Mono>}
          {/* BY LEAGUE (v0.722.0, founder): the league's avatar and how many,
              then tap for the targets with their faces. */}
          {wire.map((l) => {
            const k = `wire:${l.leagueId}:${l.rosterId}`;
            const lg = leagueOf(l.leagueId);
            return (
              <View key={k} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, backgroundColor: t.bg, overflow: 'hidden' }}>
                {leagueRow(k, lg?.avatar, l.leagueName, `${l.targets.length} target${l.targets.length === 1 ? '' : 's'}`)}
                {shown === k && (
                  <View style={{ paddingHorizontal: 10, paddingBottom: 10, gap: 8 }}>
                    {wireLensGroups(l.targets).map((g) => (
                      <View key={g.lens ?? 'all'} style={{ gap: 8 }}>
                        {g.lens && <Mono size={8.5} weight="700" track={0.14} tone={g.lens === 'now' ? 'you' : 'faint'}>{WIRE_LENS_LABEL[g.lens]}</Mono>}
                        {g.rows.map((w) => (
                          <Pressable key={`${g.lens}:${w.add}`} onPress={() => { tap(); setOpen(null); onOpenLeague(l.leagueId, l.rosterId, 'home'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <PlayerFace image={w.addImage} name={w.addName} tone={t.you} />
                            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>
                                {w.addName} <Text style={{ fontFamily: MONO, fontSize: 10, color: t.faint }}>{`${w.pos}${w.team ? ` · ${w.team}` : ''}`}</Text>{inj(w.addInjury)}
                              </Text>
                              <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: t.dim }}>{wireTargetTag(w)}</Text>
                              {w.dropName && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                                  <Mono size={9} tone="faint">for</Mono>
                                  <PlayerFace image={w.dropImage} name={w.dropName} size={18} tone={t.opp} />
                                  <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: MONO, fontSize: 10, color: t.dim }}>{w.dropName}{inj(w.dropInjury)}</Text>
                                </View>
                              )}
                            </View>
                            {wireTargetBadge(w) && <Mono size={10} tone="you" weight="700">{wireTargetBadge(w)}</Mono>}
                          </Pressable>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </Overlay>

      <Overlay visible={open === 'trades'} title="Trade zone" subtitle="OFFERS, WANTS, THE BLOCK AND IDEAS" onClose={() => setOpen(null)}>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
          {zone === null && <Mono size={10} tone="faint">Reading your leagues…</Mono>}
          {zone !== null && zone.length === 0 && !ideas.length && <Mono size={10} tone="faint">Quiet — no offers, wants or players on the block in your leagues.</Mono>}
          {zone !== null && TRADE_ZONE_ORDER.map((kind) => {
            const rows = zone.filter((z) => z.kind === kind);
            if (!rows.length) return null;
            return (
              <View key={kind} style={{ gap: 6 }}>
                <Mono size={8.5} weight="700" track={0.14} tone={kind === 'offer_in' || kind === 'want' ? 'you' : 'faint'}>{`${TRADE_ZONE_TITLE[kind]} · ${rows.length}`}</Mono>
                {rows.map((z, i) => (
                  <Pressable key={`${kind}-${i}`} onPress={() => { tap(); setOpen(null); const l = leagueOf(z.leagueId); onOpenLeague(z.leagueId, l?.rosterId ?? z.rosterId, 'home'); }}
                    style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: kind === 'offer_in' ? t.you : t.bd, borderRadius: 8, padding: 9, gap: 2, backgroundColor: kind === 'offer_in' ? alpha(t.you, 8) : t.bg }}>
                    <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{z.team} <Text style={{ fontFamily: MONO, fontSize: 10, color: t.faint }}>{z.leagueName}</Text></Text>
                    <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: 16, color: t.dim }}>
                      {kind === 'offer_in' ? `you get ${z.get.join(', ') || '—'} · you give ${z.give.join(', ') || '—'}`
                        : kind === 'offer_out' ? `you offered ${z.give.join(', ') || '—'} for ${z.get.join(', ') || '—'}`
                        : kind === 'want' ? `wants ${z.give.join(', ')}`
                        : `${z.get.join(', ')} is available`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            );
          })}
          {ideas.length > 0 && <View style={{ gap: 8 }}>
            <Mono size={8.5} weight="700" track={0.14} tone="you">SUGGESTED</Mono>
            {/* BY LEAGUE (v0.722.0): avatar and count; tap for the trades with faces. */}
            {ideas.map((l) => {
              const k = `trade:${l.leagueId}:${l.rosterId}`;
              const lg = leagueOf(l.leagueId);
              return (
                <View key={k} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, backgroundColor: t.bg, overflow: 'hidden' }}>
                  {leagueRow(k, lg?.avatar, l.leagueName, `${l.ideas.length} trade${l.ideas.length === 1 ? '' : 's'}`)}
                  {shown === k && (
                    <View style={{ paddingHorizontal: 10, paddingBottom: 10, gap: 10 }}>
                      {l.ideas.map((x, i) => (
                        <Pressable key={i} onPress={() => { tap(); setOpen(null); onOpenLeague(l.leagueId, l.rosterId, 'home'); }}
                          style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8, gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '700', color: t.text }}>{x.partnerName}</Text>
                            <Mono size={8.5} weight="700" track={0.1} tone="faint">{TRADE_IDEA_LABEL[x.kind]}</Mono>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 10 }}>
                            {([['GIVE', x.give, t.opp], ['GET', x.get, t.you]] as const).map(([lab, ps, tone]) => (
                              <View key={lab} style={{ flex: 1, minWidth: 0, gap: 4 }}>
                                <Mono size={8} weight="700" track={0.14} tone="faint">{lab}</Mono>
                                {ps.map((p) => (
                                  <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    <PlayerFace image={p.image} name={p.name} size={28} tone={tone} />
                                    <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: t.text }}>{p.name} <Text style={{ fontFamily: MONO, fontSize: 9.5, color: t.faint }}>{p.pos}</Text>{inj(p.injury)}</Text>
                                  </View>
                                ))}
                              </View>
                            ))}
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text numberOfLines={2} style={{ flex: 1, fontFamily: MONO, fontSize: 10, color: t.faint }}>{x.why}</Text>
                            <Mono size={9.5} tone="you" weight="700">{tradeIdeaBadge(x)}</Mono>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>}
        </ScrollView>
      </Overlay>
    </View>
  );
}
