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
import type { WidgetSnapshot } from '@drip/core/data/widgetFeed';
import { loadToolLeagues, saveToolLeagues, toggleToolLeague, toolHas, forTool, toolLeaguesOffCount, TOOL_IDS, TOOL_LABEL, type ToolId, type ToolLeagueOff } from '@drip/core/data/toolLeagues';
import { lineupAlerts, lineupAlertCount, wireTargets, wireTargetCount, wireLensGroups, wireTargetLine, wireTargetBadge, WIRE_LENS_LABEL, loadTradeZone, tradeZoneCount, TRADE_ZONE_ORDER, TRADE_ZONE_TITLE, type TradeZoneItem } from '@drip/core/data/leagueTools';
import { useTheme, MONO, alpha } from '../theme.native';
import { tap } from './feedback';
import { Chip, Mono } from './prims';
import { Overlay } from './Overlay';
import { AllFieldsSheet } from './AllFieldsSheet';
import { HeroesVillains } from './HeroesVillains';

type Tool = 'fields' | 'preview' | 'lineup' | 'wire' | 'trades' | 'options';
export interface ToolLeague { id: string; name: string; rosterId: number; native: boolean; contest: boolean }

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

      <Overlay visible={open === 'options'} title="Tool options" subtitle="THE LEAGUES EACH TOOL READS" onClose={() => setOpen(null)}>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 14 }}>
          {TOOL_IDS.map((tool) => {
            const pool = tool === 'wire' || tool === 'trades' ? nativeLeagues : leagues;
            if (!pool.length) return null;
            return (
              <View key={tool} style={{ gap: 6 }}>
                <Mono size={8.5} weight="700" track={0.14} tone="faint">{TOOL_LABEL[tool]}</Mono>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {pool.map((l) => <Chip key={l.id} small label={l.name} on={toolHas(off, tool, l.id)} onPress={() => flip(tool, l.id)} />)}
                </View>
              </View>
            );
          })}
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
              {a.fixes.map((f, i) => (
                <Text key={i} style={{ fontFamily: MONO, fontSize: 11, lineHeight: 16, color: f.kind === 'injury' || f.kind === 'none' ? t.warn : t.dim }}>
                  {`${f.kind === 'swap' ? '⇄' : f.kind === 'injury' ? '🩹' : f.kind === 'bye' ? '💤' : '•'} ${f.winLabel ? `${f.winLabel}: ` : ''}${f.text}`}
                </Text>
              ))}
            </Pressable>
          ))}
        </ScrollView>
      </Overlay>

      <Overlay visible={open === 'wire'} title="Waiver targets" subtitle="WHO ON THE WIRE HELPS THIS WEEK" onClose={() => setOpen(null)}>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
          {wire.length === 0 && <Mono size={10} tone="faint">Nobody on the wire beats what you have.</Mono>}
          {wire.map((l) => (
            <Pressable key={`${l.leagueId}:${l.rosterId}`} onPress={() => { tap(); setOpen(null); onOpenLeague(l.leagueId, l.rosterId, 'home'); }}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 10, gap: 6, backgroundColor: t.bg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: t.text }}>{l.leagueName}</Text>
                <Mono size={9} tone="faint">{l.weekLabel}</Mono>
                <Mono size={10} tone="you" weight="700">→</Mono>
              </View>
              {wireLensGroups(l.targets).map((g) => (
                <View key={g.lens ?? 'all'} style={{ gap: 6 }}>
                  {g.lens && <Mono size={8.5} weight="700" track={0.14} tone={g.lens === 'now' ? 'you' : 'faint'}>{WIRE_LENS_LABEL[g.lens]}</Mono>}
                  {g.rows.map((w) => (
                    <View key={`${g.lens}:${w.add}`} style={{ gap: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '700', color: t.text }}>
                          {`+ ${w.addName}`} <Text style={{ fontFamily: MONO, fontSize: 10, color: t.faint }}>{`${w.pos}${w.team ? ` · ${w.team}` : ''}`}</Text>
                        </Text>
                        {wireTargetBadge(w) && <Mono size={10} tone="you" weight="700">{wireTargetBadge(w)}</Mono>}
                      </View>
                      <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: 15, color: t.dim }}>{wireTargetLine(w)}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </Pressable>
          ))}
        </ScrollView>
      </Overlay>

      <Overlay visible={open === 'trades'} title="Trade zone" subtitle="OFFERS, WANTS AND THE BLOCK, ACROSS YOUR LEAGUES" onClose={() => setOpen(null)}>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
          {zone === null && <Mono size={10} tone="faint">Reading your leagues…</Mono>}
          {zone !== null && zone.length === 0 && <Mono size={10} tone="faint">Quiet — no offers, wants or players on the block in your leagues.</Mono>}
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
        </ScrollView>
      </Overlay>
    </View>
  );
}
