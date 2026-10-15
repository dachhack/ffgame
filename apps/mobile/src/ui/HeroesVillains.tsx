// THE PREVIEW (v0.718.0; HEROES & VILLAINS since v0.632.0) — the league tools
// bar's rooting guide, opened in its sheet.
//
// Founder (v0.632.0): "It lists the key players for your matchups and how many
// matchups they are in for you. Heroes and players you should be rooting for
// and Villains players you are rooting against. It should also have
// suggestions for your quad box for game windows with multiple games and a
// list of key games for your matchups."
// Founder (v0.718.0): "Change Heroes and Villains to Preview. Let's get player
// images in heroes and villains. Let's get key games listed with just the
// number of players … you click to see the players with headshots. Let's
// squish the heroes/villains/key games/quad box on to one row so they don't
// wrap. We don't need the text line above. Quad box again don't list all the
// players, just the two most consequential on your team and on opposing team.
// Click to show all players."
//
// Folded from the glance snapshots the page already reads (core heroes.ts),
// so it costs no new read.
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WidgetSnapshot } from '@drip/core/data/widgetFeed';
import { heroesVillains, gameFaces, gameCounts, previewList, injuryTag, PREVIEW_INFO, type StakePlayer, type KeyGame } from '@drip/core/data/heroes';
import { useTheme, MONO, alpha } from '../theme.native';
import { tap } from './feedback';
import { Mono } from './prims';
import { InfoChip } from './InfoChip';

type Tab = 'heroes' | 'villains' | 'games' | 'quad';
const fmtKick = (ms: number | null) => (ms == null ? 'TBD'
  : new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(ms)).replace(' ', '').replace(/(AM|PM)/, (m) => m[0].toLowerCase()));
const num = (p: StakePlayer) => (p.status !== 'pre' && p.pts != null ? `${p.status === 'live' ? '● ' : ''}${p.pts.toFixed(1)}` : p.proj != null ? `P ${p.proj.toFixed(1)}` : '');
const initials = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

export function HeroesVillains({ snaps }: { snaps: WidgetSnapshot[] }) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('heroes');
  const [shown, setShown] = useState<string | null>(null);   // the game opened to its players
  const hv = useMemo(() => heroesVillains(snaps), [snaps]);
  // v0.723.0: everyone at 2x or more, topped up to five with the best 1x.
  const heroes = useMemo(() => previewList(hv.heroes), [hv]);
  const villains = useMemo(() => previewList(hv.villains), [hv]);
  if (hv.week == null || hv.leagues === 0 || (!hv.heroes.length && !hv.villains.length)) {
    return <Mono size={10} tone="faint">Nothing to preview yet — no lineups this week.</Mono>;
  }

  // INJURY STATUS (v0.723.0): the designation, in the warning colour.
  const inj = (tag: string | null | undefined) => (injuryTag(tag)
    ? <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '800', color: t.warn }}>{` ${injuryTag(tag)}`}</Text> : null);
  const face = (p: StakePlayer, side: 'hero' | 'villain', size = 30) => (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: alpha(side === 'hero' ? t.you : t.opp, 16), alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: side === 'hero' ? t.you : t.opp }}>
      {p.image
        ? <Image source={{ uri: p.image }} style={{ width: size, height: size }} resizeMode="cover" />
        : <Text style={{ fontFamily: MONO, fontSize: size * 0.34, fontWeight: '700', color: side === 'hero' ? t.you : t.opp }}>{initials(p.name)}</Text>}
    </View>
  );
  const player = (p: StakePlayer, side: 'hero' | 'villain', leagues = true) => {
    const other = side === 'hero' ? p.villainIn.length : p.heroIn.length;
    const inList = side === 'hero' ? p.heroIn : p.villainIn;
    return (
      <View key={`${side}:${p.slug}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
        {face(p, side)}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.text }}>{p.name} <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.faint }}>{[p.pos, p.team].filter(Boolean).join(' · ')}</Text>{inj(p.injury)}</Text>
          {leagues && (
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: t.faint }}>
              {inList.map((l) => (side === 'hero' ? l.leagueName : `${l.leagueName} (${l.opponent})`)).join(', ')}{other ? ` · also ${side === 'hero' ? 'a villain' : 'a hero'} in ${other}` : ''}
            </Text>
          )}
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: side === 'hero' ? t.you : t.opp }}>×{p.count}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', minWidth: 44, textAlign: 'right', color: p.status === 'live' ? t.text : p.status === 'final' ? t.you : t.dim }}>{num(p)}</Text>
      </View>
    );
  };
  // A game's head: the matchup, its clock, and what it touches.
  const head = (g: KeyGame, lead: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: t.faint, minWidth: 16 }}>{lead}</Text>
      <Text style={{ fontFamily: MONO, fontSize: 14, fontWeight: '700', color: t.text, flex: 1 }}>{g.away} @ {g.home}</Text>
      <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: g.status === 'live' ? t.opp : t.faint }}>{g.status === 'live' ? '● LIVE' : g.status === 'final' ? 'FINAL' : fmtKick(g.kickoff)}</Text>
    </View>
  );
  const all = (g: KeyGame) => (
    <View style={{ marginTop: 4 }}>
      {g.heroes.map((p) => player(p, 'hero', false))}
      {g.villains.map((p) => player(p, 'villain', false))}
    </View>
  );
  // KEY GAMES: the counts; tap for the players.
  const game = (g: KeyGame, i: number) => {
    const open = shown === g.key;
    return (
      <Pressable key={g.key} onPress={() => { tap(); setShown(open ? null : g.key); }} style={{ paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, gap: 3 }}>
        {head(g, String(i + 1))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 24 }}>
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', flex: 1 }}>
            {g.heroes.length ? <Text style={{ color: t.you }}>{`${g.heroes.length} yours`}</Text> : null}
            {g.heroes.length && g.villains.length ? <Text style={{ color: t.faint }}> · </Text> : null}
            {g.villains.length ? <Text style={{ color: t.opp }}>{`${g.villains.length} theirs`}</Text> : null}
            {!g.heroes.length && !g.villains.length ? <Text style={{ color: t.faint }}>{gameCounts(g)}</Text> : null}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.dim }}>{open ? '▴' : '▾'}</Text>
        </View>
        {open && all(g)}
      </Pressable>
    );
  };
  // QUAD BOX: the two who matter most a side, as faces; tap for everyone.
  const quadGame = (g: KeyGame, i: number) => {
    const open = shown === g.key;
    const f = gameFaces(g);
    const mini = (p: StakePlayer, side: 'hero' | 'villain') => (
      <View key={`${side}:${p.slug}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '48%' }}>
        {face(p, side, 22)}
        <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10.5, color: side === 'hero' ? t.you : t.opp, flexShrink: 1 }}>{`${p.name}${p.count > 1 ? ` ×${p.count}` : ''}`}{inj(p.injury)}</Text>
      </View>
    );
    return (
      <Pressable key={g.key} onPress={() => { tap(); setShown(open ? null : g.key); }} style={{ paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, gap: 4 }}>
        {head(g, String(i + 1))}
        {open ? all(g) : (f.mine.length || f.theirs.length) ? (
          <View style={{ marginLeft: 24, gap: 4 }}>
            {f.mine.length > 0 && <View style={{ flexDirection: 'row', gap: 8 }}>{f.mine.map((p) => mini(p, 'hero'))}</View>}
            {f.theirs.length > 0 && <View style={{ flexDirection: 'row', gap: 8 }}>{f.theirs.map((p) => mini(p, 'villain'))}</View>}
            {f.more > 0 && <Mono size={9} tone="faint">{`+${f.more} more ▾`}</Mono>}
          </View>
        ) : <Mono size={9.5} tone="faint" style={{ marginLeft: 24 }}>nobody of yours</Mono>}
      </Pressable>
    );
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'heroes', label: `HEROES ${heroes.length}` },
    { id: 'villains', label: `VILLAINS ${villains.length}` },
    { id: 'games', label: `KEY GAMES ${hv.games.length}` },
    { id: 'quad', label: 'QUAD BOX' },
  ];
  return (
    <View style={{ gap: 8 }}>
      {/* ONE ROW, NEVER WRAPPING: four equal segments and the ⓘ. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {tabs.map((x) => {
          const on = tab === x.id;
          return (
            <Pressable key={x.id} onPress={() => { tap(); setTab(x.id); setShown(null); }}
              style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? t.you : t.bd, backgroundColor: on ? alpha(t.you, 14) : 'transparent' }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.3, color: on ? t.you : t.dim }}>{x.label}</Text>
            </Pressable>
          );
        })}
        <InfoChip title="Preview">{PREVIEW_INFO}</InfoChip>
      </View>
      {tab === 'heroes' && <View>{heroes.map((p) => player(p, 'hero'))}</View>}
      {tab === 'villains' && (
        <View>
          {hv.villains.length === 0 && <Mono size={10} tone="faint">No villains revealed yet.</Mono>}
          {villains.map((p) => player(p, 'villain'))}
          {hv.sealed > 0 && <Mono size={9} tone="faint" style={{ marginTop: 6 }}>{`${hv.sealed} sealed`}</Mono>}
        </View>
      )}
      {tab === 'games' && <View>{hv.games.slice(0, 16).map(game)}</View>}
      {tab === 'quad' && (
        <View style={{ gap: 10 }}>
          {hv.quads.length === 0 && <Mono size={10} tone="faint">No window this week has more than one game.</Mono>}
          {hv.quads.map((q) => (
            <View key={q.win} style={{ gap: 2 }}>
              <Mono size={9.5} weight="700" tone="you" track={0.1}>{q.label.toUpperCase()}{q.others ? ` · +${q.others} more game${q.others === 1 ? '' : 's'}` : ''}</Mono>
              {q.games.map(quadGame)}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
