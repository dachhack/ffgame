// THE SPORT WEEK, on the phone (0426) — the web SportWeekPanel's twin: the
// period, both seats' locked slot-days with each line's points (or the
// category grid, or the roto table), and today's slate. Scored through the
// same core functions the worker uses, so the number here is the number in
// matchup_state.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPORTS, eligibleFor, type Sport } from '@drip/core/sports/index';
import { linePoints, normalizeScoring, categoryTotals, compareCategories, categoryById } from '@drip/core/sports/score';
import { sportPeriod, sportNow, isSeasonFormat, isOneGame, effectiveSpotGame, SPORT_FORMAT_LABEL, type SportLeagueSettings, type SpotGameOption } from '@drip/core/sports/league';
import { sportMatchupLines, sportLeagueGames, sportRotoStandings, sportSpotGames, setSportGamePick, friendlyError, type SportMatchupLine, type SportGameRow, type SportRotoRow, type SportSpotGameRow } from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
import { Card, Mono, PosPill } from './prims';
import { Overlay } from './Overlay';
import { InfoChip } from './InfoChip';
import { tap, commit } from './feedback';

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const fmtTip = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' ', '').toLowerCase() : '';
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export function SportWeekPanel({ leagueId, matchupId, week, sport, settings, homeRosterId, awayRosterId, myRosterId, bestball }: {
  leagueId: string; matchupId: string; week: number; sport: Sport; settings: SportLeagueSettings;
  homeRosterId: number; awayRosterId: number; myRosterId: number | null;
  /** The league's best-ball slot names (0436): their slot-days are the fill's, marked 🎯. */
  bestball?: string[];
}) {
  const t = useTheme();
  const def = SPORTS[sport];
  const bb = useMemo(() => new Set(bestball ?? []), [bestball]);
  const period = useMemo(() => sportPeriod(week, settings.period_start), [week, settings.period_start]);
  const [rows, setRows] = useState<SportMatchupLine[]>([]);
  const [games, setGames] = useState<SportGameRow[]>([]);
  const [roto, setRoto] = useState<SportRotoRow[]>([]);
  const [tick, setTick] = useState(0);
  // ONE GAME (0527): my spots with every game each player has this period.
  const oneGame = isOneGame(settings.format);
  const [spotGames, setSpotGames] = useState<SportSpotGameRow[]>([]);
  const [openSpot, setOpenSpot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    sportMatchupLines(matchupId).then((r) => { if (alive) setRows(r ?? []); }).catch(() => {});
    if (oneGame && myRosterId != null) sportSpotGames(matchupId).then((r) => { if (alive) setSpotGames(r ?? []); }).catch(() => {});
    if (period) sportLeagueGames(leagueId, period.from, period.to).then((g) => { if (alive) setGames(g ?? []); }).catch(() => {});
    if (isSeasonFormat(settings.format)) sportRotoStandings(leagueId).then((r) => { if (alive) setRoto(r ?? []); }).catch(() => {});
    const id = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [matchupId, leagueId, period?.from, period?.to, settings.format, tick, oneGame, myRosterId]);

  const scoring = useMemo(() => normalizeScoring(def, settings.scoring), [def, settings.scoring]);
  const side = (rid: number) => {
    const mine = rows.filter((r) => r.roster_id === rid);
    const days = mine.map((r) => ({ ...r, pts: r.line ? linePoints(def, r.line, scoring) : 0 }))
      .sort((a, b) => a.game_date.localeCompare(b.game_date) || a.roster_slot.localeCompare(b.roster_slot, undefined, { numeric: true }));
    return { days, total: r1(days.reduce((s, d) => s + d.pts, 0)), totals: categoryTotals(def, mine.map((r) => r.line).filter((l): l is Record<string, number> => !!l)) };
  };
  const home = side(homeRosterId), away = side(awayRosterId);
  const cats = settings.format === 'cats' && settings.categories.length ? compareCategories(def, home.totals, away.totals, settings.categories) : null;
  // The league's clock (v0.626.0): a replay league's today is a past date.
  const today = sportNow(settings).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const slate = games.filter((g) => g.game_date === today);
  const order = myRosterId === awayRosterId ? [[away, awayRosterId], [home, homeRosterId]] as const : [[home, homeRosterId], [away, awayRosterId]] as const;
  // Each of my spots: its games, the pick, the lock, and the game the rule
  // counts right now (core effectiveSpotGame — what the worker locks by).
  const nowMs = sportNow(settings).getTime();
  type SpotGame = SpotGameOption & { date: string; home: boolean };
  const mySpots = useMemo(() => {
    const by = new Map<string, { slot: string; name: string; team: string; games: SpotGame[]; pick: string | null; locked: string | null }>();
    for (const r of spotGames) {
      if (!by.has(r.roster_slot)) by.set(r.roster_slot, { slot: r.roster_slot, name: r.full_name ?? r.player_slug, team: r.team ?? '', games: [], pick: null, locked: r.locked_game_id });
      const sp = by.get(r.roster_slot)!;
      if (r.game_id) {
        sp.games.push({ gameId: r.game_id, startMs: r.start_utc ? Date.parse(r.start_utc) : Number.POSITIVE_INFINITY, opp: r.opp ?? '', allowed: r.allowed == null ? null : Number(r.allowed), status: r.status ?? 'pre', date: r.game_date ?? '', home: r.home === r.team }); // team-code: same source — sport_game and league_pool both carry the sport feed's tricode (0424)
        if (r.picked) sp.pick = r.game_id;
      }
    }
    return [...by.values()].sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true })).map((sp) => ({ ...sp, eff: effectiveSpotGame(sp.games, sp.pick, sp.locked, nowMs) }));
  }, [spotGames, nowMs]);
  const gameLabel = (g: SpotGame) => `${fmtDay(g.date).split(' ')[0].toUpperCase()} ${g.home ? 'vs' : '@'} ${g.opp}`;
  const pickGame = async (slot: string, gameId: string | null) => {
    setBusy(true); setErr(null);
    try {
      const r = await setSportGamePick(matchupId, slot, gameId);
      if (!r?.ok) setErr(r?.error ?? 'Could not set that game.');
      else { commit(); setOpenSpot(null); setSpotGames(await sportSpotGames(matchupId).catch(() => spotGames)); }
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const openSp = mySpots.find((sp) => sp.slot === openSpot) ?? null;
  const choicesOf = (sp: { games: SpotGame[] }) => sp.games.filter((x) => x.status !== 'postponed' && x.status !== 'cancelled' && x.startMs > nowMs);

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
        <Mono size={8.5} tone="dim" track={0.1}>{def.league} · {period ? `${fmtDay(period.from)} – ${fmtDay(period.to)}` : `WEEK ${week}`} · {settings.format === 'cats' ? 'CATEGORIES' : SPORT_FORMAT_LABEL[settings.format]}{bb.size ? ` · ${bb.size} 🎯` : ''}</Mono>
        <Text style={{ fontFamily: MONO, fontSize: 15, fontWeight: '700', color: t.text }}>
          {cats ? `${cats.wins}-${cats.losses}-${cats.ties}` : `${home.total.toFixed(1)} – ${away.total.toFixed(1)}`}
        </Text>
      </View>

      {isSeasonFormat(settings.format) && (
        <View style={{ gap: 3 }}>
          <Mono size={8.5} tone="dim" track={0.1}>{settings.format === 'season' ? 'SEASON POINTS' : 'ROTO STANDINGS'} · SEASON TO DATE</Mono>
          {roto.length === 0
            ? <Mono size={9} tone="faint">No games counted yet — the table fills as lineups lock and play.</Mono>
            : roto.map((r) => (
              <View key={r.roster_id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: r.roster_id === myRosterId ? t.you : t.text }}>SEAT {r.roster_id}</Text>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.dim, flexShrink: 1 }} numberOfLines={1}>
                  {settings.format === 'roto' ? settings.categories.map((c) => `${categoryById(def, c)?.short ?? c} ${r.cats?.[c]?.points ?? 0}`).join(' · ') : 'season total'}
                </Text>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: t.text }}>{Number(r.points).toFixed(1)}</Text>
              </View>
            ))}
        </View>
      )}

      {cats && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {cats.cats.map((c) => {
            const cat = categoryById(def, c.id);
            const fmt = (v: number | null) => (v == null ? '—' : cat?.ratio ? v.toFixed(cat.ratio.decimals ?? 3) : String(v));
            return (
              <View key={c.id} style={{ borderWidth: 1, borderColor: c.result === 'a' ? t.you : c.result === 'b' ? t.opp : t.bd, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 }}>
                <Mono size={8} tone="faint" track={0.08}>{cat?.short ?? c.id}</Mono>
                <Text style={{ fontFamily: MONO, fontSize: 10, color: t.text }}>{fmt(c.a)} · {fmt(c.b)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {oneGame && myRosterId != null && mySpots.length > 0 && (
        <View style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Mono size={8.5} tone="dim" track={0.1}>YOUR GAMES THIS WEEK · ONE PER SPOT</Mono>
            <InfoChip title="One game a week">{'Each spot counts ONE game this week: the one you pick, or AUTO — the game against the opponent allowing the most points so far this season (with no record yet, the first game).\n\nChange it any time before that game tips off. Once it tips, that is the spot\'s game for the week, good or bad. A player can count one game a week, whichever spot he is in.' + (bb.size ? '\n\nA 🎯 best-ball spot counts its best single game of the week from your whole roster, settled as games land.' : '')}</InfoChip>
          </View>
          {mySpots.map((sp) => {
            const g = sp.eff ? sp.games.find((x) => x.gameId === sp.eff!.gameId) : null;
            const settled = sp.eff?.via === 'locked';
            const can = !settled && choicesOf(sp).length > 0;
            return (
              <View key={sp.slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, color: t.faint, width: 40 }}>{sp.slot}</Text>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text, flex: 1 }} numberOfLines={1}>{sp.name} <Text style={{ color: t.faint }}>{sp.team}</Text></Text>
                {g ? (
                  <Pressable disabled={!can || busy} hitSlop={6} onPress={() => { tap(); setOpenSpot(sp.slot); }}
                    style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: settled ? t.bd : t.you, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4, color: settled ? t.dim : t.you }}>
                      {gameLabel(g)}{sp.eff?.via === 'auto' ? ' · AUTO' : settled ? ' · LOCKED' : ''}{can ? ' ›' : ''}
                    </Text>
                  </Pressable>
                ) : <Mono size={9} tone="faint">{sp.games.length ? 'no game left' : 'no game this week'}</Mono>}
              </View>
            );
          })}
          {!!err && <Mono size={9} tone="opp">{err}</Mono>}
        </View>
      )}

      {order.map(([s, rid]) => (
        <View key={rid} style={{ gap: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, color: rid === myRosterId ? t.you : t.opp }}>SEAT {rid} · {s.total.toFixed(1)}</Text>
          {s.days.length === 0
            ? <Mono size={9} tone="faint">Nothing locked yet — a player locks into your lineup when his game tips off.</Mono>
            : s.days.map((d) => (
              <View key={`${d.game_date}-${d.roster_slot}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, color: t.faint, width: 56 }}>{fmtDay(d.game_date)}</Text>
                <PosPill pos={eligibleFor(sport, d.pos)[0] ?? d.roster_slot} />
                <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text, flex: 1 }} numberOfLines={1}>{bb.has(d.roster_slot) ? '🎯 ' : ''}{d.full_name ?? d.player_slug} <Text style={{ color: t.faint }}>{d.team}</Text>{d.status === 'live' ? ' ●' : ''}</Text>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: d.line ? t.text : t.faint }}>{d.line ? d.pts.toFixed(1) : 'DNP'}</Text>
              </View>
            ))}
        </View>
      ))}

      {slate.length > 0 && (
        <View style={{ gap: 3 }}>
          <Mono size={8.5} tone="dim" track={0.1}>TODAY'S {def.league} SLATE</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {slate.map((g) => (
              <View key={g.game_id} style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, color: g.status === 'live' ? t.you : t.dim }}>
                  {g.away} @ {g.home} · {g.status === 'pre' ? fmtTip(g.start_utc) : g.status === 'live' ? `${g.away_score ?? 0}-${g.home_score ?? 0} ${g.clock ?? ''}` : g.status === 'final' ? `F ${g.away_score ?? 0}-${g.home_score ?? 0}` : g.status.toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {/* The chooser (0527): AUTO, or one of the games still to tip. */}
      <Overlay visible={!!openSp} title={openSp ? `${openSp.slot} · ${openSp.name}` : ''} subtitle="WHICH GAME COUNTS THIS WEEK" onClose={() => setOpenSpot(null)}>
        <View style={{ padding: 12, gap: 8 }}>
          {openSp && [{ id: null as string | null, label: 'AUTO · the game picks', sub: (() => { const a = effectiveSpotGame(openSp.games, null, null, nowMs); const g = a ? openSp.games.find((x) => x.gameId === a.gameId) : null; return g ? gameLabel(g) : '—'; })() },
            ...choicesOf(openSp).map((x) => ({ id: x.gameId as string | null, label: gameLabel(x), sub: x.allowed != null ? `${x.opp} allows ${x.allowed.toFixed(1)} a game` : 'no record yet' }))].map((o) => {
            const sel = (openSp.pick ?? null) === o.id;
            return (
              <Pressable key={o.id ?? 'auto'} disabled={busy} onPress={() => { tap(); void pickGame(openSp.slot, o.id); }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.bg, opacity: pressed ? 0.8 : 1, borderWidth: StyleSheet.hairlineWidth, borderColor: sel ? t.you : t.bd, borderRadius: 8, padding: 12 })}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: t.text }}>{o.label}</Text>
                  <Mono size={9.5}>{o.sub}</Mono>
                </View>
                {sel && <Mono size={9} weight="700" tone="you">✓</Mono>}
              </Pressable>
            );
          })}
        </View>
      </Overlay>
      <Mono size={8.5} tone="faint" style={{ lineHeight: 13 }}>{oneGame ? (mySpots.some((sp) => sp.games.length > 0) ? 'Each spot counts one game this week — pick it above or let AUTO choose; it commits when that game tips off.' : 'Each spot counts one game this week — the game picker shows here once the week\'s games load. Pick nothing and AUTO chooses.') + (bb.size ? ' A 🎯 spot counts its best single game of the week.' : '') : 'Set the lineup below any time. A player locks in the slot he is in when his game starts and scores that day\'s line.'}{bb.size && !oneGame ? ' A 🎯 spot fills itself each night with your top eligible scorer, and moves as box scores land until the day is done.' : ''}{settings.format === 'season' ? ' No weekly winner here: the standings are the season total.' : ''}</Mono>
    </Card>
  );
}
