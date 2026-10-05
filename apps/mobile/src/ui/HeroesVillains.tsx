// HEROES & VILLAINS (v0.632.0) — the leagues page's rooting guide.
//
// Founder: "It lists the key players for your matchups and how many matchups
// they are in for you. Heroes and players you should be rooting for and
// Villains players you are rooting against. It should also have suggestions
// for your quad box for game windows with multiple games and a list of key
// games for your matchups."
//
// Folded from the glance snapshots the page already reads (core heroes.ts),
// so it costs no new read. Four tabs: HEROES, VILLAINS, KEY GAMES, QUAD BOX.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WidgetSnapshot } from '@drip/core/data/widgetFeed';
import { heroesVillains, type StakePlayer, type KeyGame } from '@drip/core/data/heroes';
import { weekTitle } from '@drip/core/data/nflSlate';
import { useTheme, MONO, alpha } from '../theme.native';
import { tap } from './feedback';
import { Card, Chip, Mono } from './prims';

type Tab = 'heroes' | 'villains' | 'games' | 'quad';
const fmtKick = (ms: number | null) => (ms == null ? 'TBD'
  : new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(ms)).replace(' ', '').replace(/(AM|PM)/, (m) => m[0].toLowerCase()));
const num = (p: StakePlayer) => (p.status !== 'pre' && p.pts != null ? `${p.status === 'live' ? '● ' : ''}${p.pts.toFixed(1)}` : p.proj != null ? `P ${p.proj.toFixed(1)}` : '');

export function HeroesVillains({ snaps }: { snaps: WidgetSnapshot[] }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('heroes');
  const hv = useMemo(() => heroesVillains(snaps), [snaps]);
  if (hv.week == null || hv.leagues === 0 || (!hv.heroes.length && !hv.villains.length)) return null;
  const summary = `${hv.heroes.length} hero${hv.heroes.length === 1 ? '' : 'es'} · ${hv.villains.length} villain${hv.villains.length === 1 ? '' : 's'} · ${hv.games.length} key game${hv.games.length === 1 ? '' : 's'}${hv.sealed ? ` · ${hv.sealed} sealed` : ''}`;

  const player = (p: StakePlayer, side: 'hero' | 'villain') => {
    const other = side === 'hero' ? p.villainIn.length : p.heroIn.length;
    const inList = side === 'hero' ? p.heroIn : p.villainIn;
    return (
      <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
        <View style={{ minWidth: 26, alignItems: 'center', backgroundColor: alpha(side === 'hero' ? t.you : t.opp, 16), borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: side === 'hero' ? t.you : t.opp }}>×{p.count}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.text }}>{p.name} <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.faint }}>{[p.pos, p.team].filter(Boolean).join(' · ')}</Text></Text>
          <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: t.faint }}>
            {inList.map((l) => (side === 'hero' ? l.leagueName : `${l.leagueName} (${l.opponent})`)).join(', ')}{other ? ` · also ${side === 'hero' ? 'a villain' : 'a hero'} in ${other}` : ''}
          </Text>
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: p.status === 'live' ? t.text : p.status === 'final' ? t.you : t.dim }}>{num(p)}</Text>
      </View>
    );
  };
  const game = (g: KeyGame, i: number) => (
    <View key={g.key} style={{ paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: t.faint, width: 16 }}>{i + 1}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 14, fontWeight: '700', color: t.text, flex: 1 }}>{g.away} @ {g.home}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: g.status === 'live' ? t.opp : t.faint }}>{g.status === 'live' ? '● LIVE' : g.status === 'final' ? 'FINAL' : fmtKick(g.kickoff)}</Text>
        <View style={{ backgroundColor: alpha(t.you, 14), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: t.you }}>{g.stake} at stake</Text>
        </View>
      </View>
      {(g.heroes.length > 0 || g.villains.length > 0) && (
        <Text numberOfLines={2} style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: 15, color: t.dim, marginLeft: 24 }}>
          {g.heroes.length ? <Text style={{ color: t.you }}>👍 {g.heroes.map((p) => `${p.name}${p.count > 1 ? ` ×${p.count}` : ''}`).join(', ')}</Text> : null}
          {g.heroes.length && g.villains.length ? '   ' : ''}
          {g.villains.length ? <Text style={{ color: t.opp }}>👎 {g.villains.map((p) => `${p.name}${p.count > 1 ? ` ×${p.count}` : ''}`).join(', ')}</Text> : null}
        </Text>
      )}
    </View>
  );

  return (
    <Card style={{ gap: 8 }}>
      <Pressable onPress={() => { tap(); setOpen((o) => !o); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: t.text }}>Heroes & villains <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.faint }}>{weekTitle(hv.week)}</Text></Text>
          <Mono size={9.5} tone="faint">{summary}</Mono>
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 14, color: t.dim }}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open && (
        <>
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
            <Chip label={`HEROES ${hv.heroes.length}`} on={tab === 'heroes'} onPress={() => setTab('heroes')} />
            <Chip label={`VILLAINS ${hv.villains.length}`} on={tab === 'villains'} onPress={() => setTab('villains')} />
            <Chip label={`KEY GAMES ${hv.games.length}`} on={tab === 'games'} onPress={() => setTab('games')} />
            <Chip label="QUAD BOX" on={tab === 'quad'} onPress={() => setTab('quad')} />
          </View>
          {tab === 'heroes' && (
            <View>
              <Mono size={8.5} tone="faint">Your starters across {hv.leagues} matchup{hv.leagues === 1 ? '' : 's'}. ×N is how many of your matchups he starts for you.</Mono>
              {hv.heroes.slice(0, 40).map((p) => player(p, 'hero'))}
            </View>
          )}
          {tab === 'villains' && (
            <View>
              <Mono size={8.5} tone="faint">Starting against you. ×N is how many of your opponents start him.{hv.sealed ? ` ${hv.sealed} drip slot${hv.sealed === 1 ? '' : 's'} still sealed until kickoff.` : ''}</Mono>
              {hv.villains.length === 0 && <Mono size={10} tone="faint" style={{ marginTop: 6 }}>No villains revealed yet.</Mono>}
              {hv.villains.slice(0, 40).map((p) => player(p, 'villain'))}
            </View>
          )}
          {tab === 'games' && (
            <View>
              <Mono size={8.5} tone="faint">Ranked by how many of your matchups each game touches.</Mono>
              {hv.games.slice(0, 16).map(game)}
            </View>
          )}
          {tab === 'quad' && (
            <View style={{ gap: 8 }}>
              <Mono size={8.5} tone="faint">For each window with several games: the four screens to put up.</Mono>
              {hv.quads.length === 0 && <Mono size={10} tone="faint">No window this week has more than one game.</Mono>}
              {hv.quads.map((q) => (
                <View key={q.win} style={{ gap: 2 }}>
                  <Mono size={9.5} weight="700" tone="you" track={0.1}>{q.label.toUpperCase()}{q.others ? ` · +${q.others} more game${q.others === 1 ? '' : 's'}` : ''}</Mono>
                  {q.games.map(game)}
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </Card>
  );
}
