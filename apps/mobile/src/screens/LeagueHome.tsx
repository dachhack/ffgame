// League home (0182), native — the hub an open league lands on. The web
// LeagueHubPage's sibling: instead of dropping straight onto the matchup
// board, a league opens HERE, and the board / team desk / chat / shop /
// commissioner's tools are each one tile away. The tab strip stays — the hub
// is the 🏠 LEAGUE tab, and the strip is still the fast lane between rooms.
import { Ev, track } from '@drip/core/analytics';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { leagueNote, leagueSignals, nativeRosters, leaguePool, matchupTeams, playoffState, leagueGameMode, type TeamInfo } from '@drip/core/data/liveApi';
import { useTheme, alpha, MONO } from '../theme.native';
import { tap } from '../ui/feedback';
import { Mono } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { openPlayerCard } from '../ui/PlayerCardSheet';
import { PushPrefs } from '../ui/SettingsModal';
import { Standings, Playoffs } from '../ui/LeagueExtras';
import { ScoringView, RosterRulesView, RegisterView } from '../ui/LeagueInfo';

export type LeagueRoom = 'picks' | 'draft' | 'team' | 'chat' | 'commishtools';

export function LeagueHome({ leagueId, teamName, rosterId, native, commish, onGo, onShop, onBack }: {
  leagueId: string;
  teamName?: string | null;
  rosterId: number | null;
  native: boolean;
  commish: boolean;
  onGo: (room: LeagueRoom) => void;
  /** Opens the board with the power-up shop already up. */
  onShop: () => void;
  onBack: () => void;
}) {
  const t = useTheme();
  // The note lives HERE now (0182.1 — off the board, founder's call), so the
  // commissioner's empty-state prompt shows too, not just a standing note.
  const [note, setNote] = useState<{ text: string; canEdit: boolean } | null>(null);
  const [teamsOpen, setTeamsOpen] = useState(false);
  // 🔔 Alerts (v0.272.0 — off the MY TEAM tabs, founder's call): push prefs
  // in a sheet. Device-level settings, so any member gets the tile.
  const [alertsOpen, setAlertsOpen] = useState(false);
  // The league's own reference sheets (v0.274.0, founder's menu list). One
  // piece of state: only ever one sheet is up, and `null` is the menu itself.
  const [sheet, setSheet] = useState<null | 'standings' | 'scoring' | 'roster' | 'register'>(null);
  // Only the commissioner's queue is still read here — the chat dot rides on
  // the nav strip, and the waiver badge left with the MY TEAM tile.
  const [sig, setSig] = useState<{ commish: { waiting: number; review: number } | null }>({ commish: null });
  const [champion, setChampion] = useState<string | null>(null);
  // Classic leagues (0157) have no power-ups, so no shop tile (v0.273.0,
  // founder). Defaults false — the tile shows until the answer lands, since
  // drip is the common case and a popping-in tile would be worse.
  const [classic, setClassic] = useState(false);
  useEffect(() => {
    leagueGameMode(leagueId)
      .then((gm) => { if (gm.ok && gm.mode === 'classic') setClassic(true); })
      .catch(() => {});
    leagueNote(leagueId)
      .then((r) => { if (r.ok && (r.text || r.can_edit)) setNote({ text: r.text ?? '', canEdit: !!r.can_edit }); })
      .catch(() => {});
    leagueSignals(leagueId)
      .then((r) => { if (r.ok) setSig({ commish: r.commish ?? null }); })
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
      {/* NO SECOND TITLE (founder): the app header one row up became the
          league's name at header size in v0.279.3, and printing it again here
          just pushed the menu down. What is left is the line the header
          doesn't carry — which seat you are — and the way out. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {!!teamName && <Mono size={9.5} tone="faint">you are {teamName}{commish ? ' · ⚑ commissioner' : ''}</Mono>}
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

      {/* MATCHUP / MY TEAM / CHAT / FIELDS are NOT here (v0.275.0, founder):
          the first three are one tap away on the nav strip above this screen,
          and ▦ FIELDS is a chip on the matchup board itself. A menu that
          repeats the strip is a menu you have to read twice. The shop stays —
          it has no chip anywhere, and drip coin is yours, not the league's. */}
      {rosterId != null && !classic && tile('◈', 'Power-up shop', 'spend drip coin — opens on your board', () => { track(Ev.hubTileOpened, { tile: 'shop' }); onShop(); })}
      {/* ── THE LEAGUE ITSELF (v0.274.0, founder's list) ────────────────────
          Above this line is YOUR week — your board, your team, the chat. Below
          it is the league: who's in it, what it did, and the rules it runs on.
          The heading is what stops the menu reading as one undifferentiated
          pile of nine tiles. */}
      <Mono size={8.5} tone="faint" weight="700" track={0.14} style={{ marginTop: 8, marginBottom: 2 }}>THE LEAGUE</Mono>

      {native && tile('👥', 'Teams & rosters', "every team in the league and who they're holding", () => { track(Ev.hubTileOpened, { tile: 'teams' }); setTeamsOpen(true); })}
      {native && tile('⛏', 'Draft room', 'live on draft night, the record after', () => { track(Ev.hubTileOpened, { tile: 'draft' }); onGo('draft'); })}
      {native && tile('🏆', 'Standings', 'the table · playoff bracket', () => { track(Ev.hubTileOpened, { tile: 'standings' }); setSheet('standings'); })}
      {native && tile('📜', 'League register', 'every add, drop, claim and trade', () => { track(Ev.hubTileOpened, { tile: 'register' }); setSheet('register'); })}
      {tile('⊞', 'Scoring settings', 'how this league turns plays into points', () => { track(Ev.hubTileOpened, { tile: 'scoring' }); setSheet('scoring'); })}
      {native && tile('🧢', 'Roster settings', 'lineup spots · limits · waivers · trades', () => { track(Ev.hubTileOpened, { tile: 'roster_rules' }); setSheet('roster'); })}
      {tile('🔔', 'Alerts', 'push notifications — what pings your phone', () => { track(Ev.hubTileOpened, { tile: 'alerts' }); setAlertsOpen(true); })}
      {commish && tile('⚑', 'Commissioner', 'seats · rules · kit · scoring', () => { track(Ev.hubTileOpened, { tile: 'commish' }); onGo('commishtools'); },
        { accent: true, ...(sig.commish && sig.commish.waiting + sig.commish.review > 0 ? { badge: `${sig.commish.waiting + sig.commish.review} waiting` } : {}) })}

      {native && <TeamsSheet visible={teamsOpen} leagueId={leagueId} myRoster={rosterId} onClose={() => setTeamsOpen(false)} />}

      {/* 🔔 push prefs, in a sheet — lived on the MY TEAM tabs (v0.268.0),
          moved here because alerts are league-wide plumbing, not roster
          management. */}
      {/* Standings moved off MY TEAM's tabs (v0.274.0): the table is the
          league's, not the team's. Playoffs ride along — the bracket answers
          the same question one round later. */}
      <Overlay visible={sheet === 'standings'} title="🏆 Standings" subtitle="THE TABLE · PLAYOFF BRACKET" onClose={() => setSheet(null)}>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30, gap: 12 }}>
          <Standings leagueId={leagueId} myRoster={rosterId} />
          <Playoffs leagueId={leagueId} />
        </ScrollView>
      </Overlay>

      <Overlay visible={sheet === 'register'} title="📜 League register" subtitle="EVERY MOVE SINCE THE DRAFT · NEWEST FIRST" onClose={() => setSheet(null)}>
        <RegisterView leagueId={leagueId} />
      </Overlay>

      <Overlay visible={sheet === 'scoring'} title="⊞ Scoring settings" subtitle="HOW THIS LEAGUE TURNS PLAYS INTO POINTS" onClose={() => setSheet(null)}>
        <ScoringView leagueId={leagueId} />
      </Overlay>

      <Overlay visible={sheet === 'roster'} title="🧢 Roster settings" subtitle="LINEUP SPOTS · LIMITS · WAIVERS · TRADES" onClose={() => setSheet(null)}>
        <RosterRulesView leagueId={leagueId} />
      </Overlay>

      <Overlay visible={alertsOpen} title="🔔 Alerts" subtitle="WHAT PINGS YOUR PHONE" onClose={() => setAlertsOpen(false)}>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
          <PushPrefs />
        </ScrollView>
      </Overlay>
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
