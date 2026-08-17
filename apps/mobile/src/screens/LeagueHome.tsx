// League home (0182), native — the hub an open league lands on. The web
// LeagueHubPage's sibling: instead of dropping straight onto the matchup
// board, a league opens HERE, and the board / team desk / chat / shop /
// commissioner's tools are each one tile away. The tab strip stays — the hub
// is the 🏠 LEAGUE tab, and the strip is still the fast lane between rooms.
import { Ev, track } from '@drip/core/analytics';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { leagueNote, chatUnread, leagueSignals, nativeRosters, leaguePool, matchupTeams, playoffState, type TeamInfo } from '@drip/core/data/liveApi';
import { useTheme, alpha, MONO } from '../theme.native';
import { tap } from '../ui/feedback';
import { Mono } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { openPlayerCard } from '../ui/PlayerCardSheet';

export type LeagueRoom = 'picks' | 'draft' | 'team' | 'chat' | 'commishtools';

export function LeagueHome({ leagueId, name, teamName, rosterId, native, commish, onGo, onShop, onFields, onBack }: {
  leagueId: string;
  name: string;
  teamName?: string | null;
  rosterId: number | null;
  native: boolean;
  commish: boolean;
  onGo: (room: LeagueRoom) => void;
  /** Opens the board with the power-up shop already up. */
  onShop: () => void;
  /** Opens the board with the all-fields sheet already up — the ▦ FIELDS chip's
   *  old job, moved off the tab strip and onto the menu (founder's call). */
  onFields: () => void;
  onBack: () => void;
}) {
  const t = useTheme();
  // The note lives HERE now (0182.1 — off the board, founder's call), so the
  // commissioner's empty-state prompt shows too, not just a standing note.
  const [note, setNote] = useState<{ text: string; canEdit: boolean } | null>(null);
  const [unread, setUnread] = useState<{ n: number; mention: boolean }>({ n: 0, mention: false });
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [sig, setSig] = useState<{ polls: number; waivers: number; commish: { waiting: number; review: number } | null }>({ polls: 0, waivers: 0, commish: null });
  const [champion, setChampion] = useState<string | null>(null);
  useEffect(() => {
    leagueNote(leagueId)
      .then((r) => { if (r.ok && (r.text || r.can_edit)) setNote({ text: r.text ?? '', canEdit: !!r.can_edit }); })
      .catch(() => {});
    chatUnread(leagueId)
      .then((r) => { if (r.ok) setUnread({ n: (r.league ?? 0) + (r.dm ?? 0), mention: (r.mention ?? 0) > 0 }); })
      .catch(() => {});
    leagueSignals(leagueId)
      .then((r) => { if (r.ok) setSig({ polls: r.polls_unvoted ?? 0, waivers: r.waiver_results ?? 0, commish: r.commish ?? null }); })
      .catch(() => {});
    // Season's end (0162): once a champion is crowned, the hub says so.
    playoffState(leagueId)
      .then((st) => { if (st.champion_team) setChampion(st.champion_team); })
      .catch(() => {});
  }, [leagueId]);

  const tile = (icon: string, title: string, sub: string, onPress: () => void, opts?: { accent?: boolean; badge?: string }) => (
    <Pressable key={title} onPress={() => { tap(); onPress(); }} android_ripple={{ color: alpha(t.you, 16) }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
        ...(opts?.accent ? { borderLeftWidth: 3, borderLeftColor: t.you } : {}),
        borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, opacity: pressed ? 0.85 : 1,
      })}>
      <Text style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{icon}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: t.text }}>{title}</Text>
          {!!opts?.badge && (
            <View style={{ backgroundColor: t.you, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.onAccent }}>{opts.badge}</Text>
            </View>
          )}
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 9, color: t.dim, marginTop: 2, lineHeight: 12 }}>{sub}</Text>
      </View>
      <Text style={{ fontFamily: MONO, fontSize: 12, color: t.faint }}>→</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
      {!!champion && (
        <View style={{ backgroundColor: alpha(t.you, 14), borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '800', color: t.text }}>🏆 {champion}</Text>
          <Mono size={9} tone="faint" style={{ marginTop: 2 }}>LEAGUE CHAMPIONS — the season is in the books</Mono>
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 19, fontWeight: '700', color: t.text }}>{name}</Text>
          {!!teamName && <Mono size={9.5} tone="faint" style={{ marginTop: 2 }}>you are {teamName}{commish ? ' · ⚑ commissioner' : ''}</Mono>}
        </View>
        <Pressable hitSlop={8} onPress={() => { tap(); onBack(); }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.dim }}>← leagues</Text>
        </Pressable>
      </View>

      {!!note && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: alpha('#A87BD8', 10), borderWidth: StyleSheet.hairlineWidth, borderColor: '#A87BD8', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: '#A87BD8', paddingTop: 1 }}>⚑ LEAGUE NOTE</Text>
          {note.text
            ? <Text style={{ flex: 1, fontSize: 11.5, lineHeight: 16, color: t.text }}>{note.text}</Text>
            : <Text style={{ flex: 1, fontFamily: MONO, fontSize: 9.5, lineHeight: 13, color: t.faint }}>nothing posted — say something to the league</Text>}
          {note.canEdit && (
            <Pressable hitSlop={6} onPress={() => { tap(); onGo('commishtools'); }}>
              <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>✎ {note.text ? 'edit' : 'write'}</Text>
            </Pressable>
          )}
        </View>
      )}

      {rosterId != null && tile('▦', 'My matchup', 'your board — set the lineup, watch it live', () => { track(Ev.hubTileOpened, { tile: 'matchup' }); onGo('picks'); }, { accent: true })}
      {tile('💬', 'Chat', 'league channel · direct messages', () => { track(Ev.hubTileOpened, { tile: 'chat' }); onGo('chat'); },
        unread.n > 0 || sig.polls > 0
          ? { badge: [unread.n > 0 ? `${unread.mention ? '@ ' : ''}${unread.n > 99 ? '99+' : unread.n}` : '', sig.polls > 0 ? `📊 ${sig.polls}` : ''].filter(Boolean).join(' · ') }
          : undefined)}
      {rosterId != null && tile('◈', 'Power-up shop', 'spend drip coin — opens on your board', () => { track(Ev.hubTileOpened, { tile: 'shop' }); onShop(); })}
      {rosterId != null && tile('▦', 'Fields', 'every game with a slotted player, live — opens on your board', () => { track(Ev.hubTileOpened, { tile: 'fields' }); onFields(); })}
      {native && rosterId != null && tile('⇄', 'My team', 'waivers · trades · standings · team options', () => { track(Ev.hubTileOpened, { tile: 'team' }); onGo('team'); },
        sig.waivers > 0 ? { badge: `✚ ${sig.waivers}` } : undefined)}
      {native && tile('👥', 'Teams & rosters', "every team in the league and who they're holding", () => { track(Ev.hubTileOpened, { tile: 'teams' }); setTeamsOpen(true); })}
      {native && tile('⛏', 'Draft room', 'live on draft night, the record after', () => { track(Ev.hubTileOpened, { tile: 'draft' }); onGo('draft'); })}
      {commish && tile('⚑', 'Commissioner', 'seats · rules · kit · scoring', () => { track(Ev.hubTileOpened, { tile: 'commish' }); onGo('commishtools'); },
        { accent: true, ...(sig.commish && sig.commish.waiting + sig.commish.review > 0 ? { badge: `${sig.commish.waiting + sig.commish.review} waiting` } : {}) })}

      {native && <TeamsSheet visible={teamsOpen} leagueId={leagueId} myRoster={rosterId} onClose={() => setTeamsOpen(false)} />}
    </ScrollView>
  );
}


// ── every team's roster, in a sheet (the web hub's TeamsRosters, native) ─────
// One group per seat, my team accented, players ordered by position then name.
// Each row opens the player card — the app has the sheet, so a roster listing
// that DIDN'T tap through would feel broken.
interface TeamGroup { rid: number; name: string; mine: boolean; players: { slug: string; name: string; pos: string; team: string }[]; }
const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
const prettify = (slug: string) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

function TeamsSheet({ visible, leagueId, myRoster, onClose }: {
  visible: boolean; leagueId: string; myRoster: number | null; onClose: () => void;
}) {
  const t = useTheme();
  const [groups, setGroups] = useState<TeamGroup[] | null>(null);
  const [err, setErr] = useState(false);
  const [openRid, setOpenRid] = useState<number | null>(null);
  useEffect(() => {
    if (!visible || groups !== null) return;
    let dead = false;
    (async () => {
      try {
        const [rows, pool] = await Promise.all([nativeRosters(leagueId), leaguePool(leagueId)]);
        const ids = [...new Set(rows.map((r) => r.roster_id))].sort((a, b) => a - b);
        const teams = await matchupTeams(leagueId, ids).catch(() => ({} as Record<number, TeamInfo>));
        const bySlug = new Map(pool.map((p) => [p.slug, p]));
        const g = ids.map((rid) => ({
          rid,
          name: teams[rid]?.team_name ?? `Roster ${rid}`,
          mine: rid === myRoster,
          players: rows.filter((r) => r.roster_id === rid).map((r) => {
            const p = bySlug.get(r.slug);
            return { slug: r.slug, name: p?.full_name ?? prettify(r.slug), pos: p?.pos ?? '', team: p?.team ?? '' };
          }).sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || a.name.localeCompare(b.name)),
        }));
        if (!dead) setGroups(g);
      } catch { if (!dead) setErr(true); }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leagueId]);
  return (
    <Overlay visible={visible} title="👥 Teams & rosters" subtitle="tap a player for his card" onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
        {err && <Mono size={10} tone="opp">Couldn't load the rosters.</Mono>}
        {!err && groups === null && <Mono size={10} tone="faint">Loading rosters…</Mono>}
        {groups?.length === 0 && <Mono size={10} tone="faint">No rosters yet — they arrive with the draft.</Mono>}
        {groups?.map((g) => (
          <View key={g.rid} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
            <Pressable onPress={() => { tap(); setOpenRid(openRid === g.rid ? null : g.rid); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 }}>
              <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '700', color: g.mine ? t.you : t.text }}>
                {g.name}{g.mine ? ' (you)' : ''}
              </Text>
              <Mono size={9} tone="faint">{g.players.length} players {openRid === g.rid ? '▾' : '▸'}</Mono>
            </Pressable>
            {openRid === g.rid && (
              <View style={{ paddingBottom: 10, gap: 2 }}>
                {g.players.map((p) => (
                  <Pressable key={p.slug} onPress={() => { tap(); openPlayerCard({ slug: p.slug, name: p.name, pos: p.pos, team: p.team }); }}
                    style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.dim, width: 30 }}>{p.pos === 'DEF' ? 'DST' : p.pos}</Text>
                    <Text style={{ flex: 1, fontSize: 12.5, color: t.text }}>{p.name}</Text>
                    <Text style={{ fontFamily: MONO, fontSize: 9, color: t.faint }}>{p.team}</Text>
                  </Pressable>
                ))}
                {g.players.length === 0 && <Mono size={10} tone="faint">Empty roster.</Mono>}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </Overlay>
  );
}
