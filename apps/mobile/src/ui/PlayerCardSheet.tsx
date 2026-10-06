// The player card, native — the web modal's sibling (src/app/playerCard.tsx),
// same module-level bus: any surface calls openPlayerCard({...}) and the host
// (mounted once in App) presents the sheet. Content comes from what core
// already knows: baked bio (tenure/college/jersey/age), the LIVE injury
// detail, this week's statline when the board has plays loaded, the baked
// 2025 season line, and the ★ favorite (0139, account-scoped so a star set
// here is lit on the web).
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { tap } from './feedback';
import { openLink } from './openLink';
import type { Pos } from '@drip/core/types';
import { PLAYER_BIO, tenureLabel } from '@drip/core/data/playerBio';
import { injuryFor, injuryRowFor } from '@drip/core/data/injuries';
import { flagFor } from '@drip/core/data/commish';
import { displayTeam } from '@drip/core/data/playerTeam';
import { statsForName, NO_SEASON, nameFromSlug } from '@drip/core/data/players';
import { depthChartFor } from '@drip/core/data/playerDepth';
import { normTeam } from '@drip/core/data/slugMeta';
import { statlineAt, fmtStat } from '@drip/core/engine/sim';
import { headshot, teamLogo } from '@drip/core/data/media';
import { myFavorites, setFavorite, nativeRosters, matchupTeams, leagueRegister, nativeTeamState, dropPlayer, friendlyError, type RegisterRow , leagueWeekProjections, leagueNews, ensureDepthChart, leagueGameMode, type NewsItem } from '@drip/core/data/liveApi';
import { weekPointsFor, type WeekPoints } from '@drip/core/data/weekProj';
import { notifyRosterChanged } from '@drip/core/data/rosterBus';
import { nflGameForTeam, kickoffLabel, weekLabel, weekTick } from '@drip/core/data/nflSlate';
import { liveSeasonLog } from '@drip/core/data/playerLog';
import { buildGameLog, type GameLogWeek } from '@drip/core/data/gameLog';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { projFor } from '@drip/core/data/poolSort';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Ev, track } from '@drip/core/analytics';
import { Overlay } from './Overlay';
import { InjuryBadge } from './rosterGroup';
import { CollegeCardSheet } from './CollegeCardSheet';
import { isCollegeSlug } from '@drip/core/data/college';

export interface PlayerCardReq {
  slug: string; name: string; pos: string; team: string;
  week?: number; userId?: string;
  /** The league this card was opened FROM, when there is one. It buys the two
   *  panels a bare NFL card can't have: who owns him here, and what this
   *  league has done with him (0186's register). Optional — the demo board and
   *  the free-agent picker open cards with no league behind them. */
  leagueId?: string;
}

let listener: ((p: PlayerCardReq) => void) | null = null;

/** WHICH LEAGUE IS ON SCREEN (v0.282.0), installed once by App rather than
 *  threaded through every surface that can open a card.
 *
 *  The card is already a module-level bus — any screen calls openPlayerCard and
 *  a host mounted once presents it — so a `leagueId` prop would have had to
 *  cross Duel, RosterPanel and PlayerPicker to reach it, none of which have any
 *  other use for one. This is the same shape as the engine's other installed
 *  context (setLeagueFlags, setLeagueScoring): the host owns it, and it is
 *  cleared the moment the league closes so a card opened from the leagues list
 *  can never claim the last league's owner. */
let cardLeague: string | null = null;
export const setCardLeague = (id: string | null): void => { cardLeague = id; };

export const openPlayerCard = (p: PlayerCardReq): void => {
  track(Ev.playerCardOpened, { pos: p.pos });
  listener?.({ ...p, leagueId: p.leagueId ?? cardLeague ?? undefined });
};

const INJURY_LABEL: Record<string, string> = { O: 'Out', IR: 'Injured Reserve', D: 'Doubtful', Q: 'Questionable' };

export function PlayerCardHost() {
  const [req, setReq] = useState<PlayerCardReq | null>(null);
  useEffect(() => { listener = setReq; return () => { listener = null; }; }, []);
  if (!req) return null;
  // 0406: a college player gets the devy card — its own component, so moving
  // between an NFL card and a college one never shares a hook's state.
  if (isCollegeSlug(req.slug)) return <CollegeCardSheet req={req} onClose={() => setReq(null)} />;
  return <PlayerCardSheet req={req} onClose={() => setReq(null)} />;
}

function PlayerCardSheet({ req, onClose }: { req: PlayerCardReq; onClose: () => void }) {
  const t = useTheme();
  const { slug, name, pos, team, week, userId, leagueId } = req;
  // 0329: THIS WEEK'S number and the headlines — the web card's twin. Both
  // absent for a player the crosswalk cannot place, and the season projection
  // beside them still answers.
  const [wkProj, setWkProj] = useState<WeekPoints | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  // SUMMARY | GAME LOG | TEAM | HISTORY. The TEAM tab (v0.640.0, founder:
  // "add team depth charts to player cards, and allow clicking on players in
  // the depth charts to bring up that player's card") is the 0293 chart the
  // projected box already reads. The GAME LOG tab (v0.284.0) read the baked
  // 2025 season that shipped inside the app and went with that bake in
  // v0.502.0; it is BACK as the live season (v0.641.0, founder: "Game logs
  // on the player cards?") — read from live_play on open, nothing shipped.
  const [tab, setTab] = useState<'summary' | 'log' | 'team' | 'history'>('summary');
  // The log, built only when its tab opens; reset when the sheet moves to
  // another man (the host reuses one, v0.456.0).
  const [log, setLog] = useState<GameLogWeek[] | null>(null);
  const [logErr, setLogErr] = useState(false);
  useEffect(() => { setLog(null); setLogErr(false); }, [slug]);
  useEffect(() => {
    if (tab !== 'log' || log !== null) return;
    let dead = false;
    (async () => {
      try {
        // The league's own scoring decides the points column; a drip league
        // has no classic table, so buildGameLog prints statlines alone.
        const gm = leagueId ? await leagueGameMode(leagueId).catch(() => null) : null;
        const scoring = gm?.ok && gm.mode === 'classic' ? leagueCatalogOf(gm) : null;
        const season = await liveSeasonLog(slug);
        if (!dead) setLog(buildGameLog({ id: slug, name, pos, team: displayTeam(slug, team) }, season.weeks, scoring, season.games));
      } catch { if (!dead) setLogErr(true); }
    })();
    return () => { dead = true; };
  }, [tab, log, leagueId, slug, name, pos, team]);
  // A teammate tapped on the chart opens HIS card on this same sheet (the
  // host reuses one, v0.456.0) — and lands on his summary, as a card opened
  // from anywhere does.
  useEffect(() => { setTab('summary'); }, [slug]);
  // The chart is a module cache; this redraws once it is in.
  const [depthVer, setDepthVer] = useState(0);
  useEffect(() => { let alive = true; ensureDepthChart().then(() => { if (alive) setDepthVer((v) => v + 1); }).catch(() => {}); return () => { alive = false; }; }, []);
  // Who holds him in THIS league, and what the league has done with him.
  const [owner, setOwner] = useState<string | null | undefined>(undefined); // undefined = loading, null = free agent
  const [moves, setMoves] = useState<RegisterRow[] | null>(null);
  // THE DROP (v0.285.0) lives here now, off the roster list. `myRoster` is set
  // only when HE is on MY roster in THIS league — the one case where dropping
  // him is a thing this account may do.
  const [myRoster, setMyRoster] = useState<number | null>(null);
  useEffect(() => {
    if (!leagueId) { setOwner(undefined); setMoves(null); setMyRoster(null); return; }
    let dead = false;
    setWkProj(null); setNews(null); // the host reuses one sheet (v0.456.0)
    Promise.all([nativeRosters(leagueId), nativeTeamState(leagueId).catch(() => null)])
      .then(async ([rows, team]) => {
        const held = rows.find((r) => r.slug === slug);
        if (dead) return;
        setMyRoster(held && team?.my_roster_id === held.roster_id ? held.roster_id : null);
        if (!held) { setOwner(null); return; }
        const teams = await matchupTeams(leagueId, [held.roster_id]).catch(() => ({} as Record<number, { team_name: string }>));
        if (!dead) setOwner(teams[held.roster_id]?.team_name ?? `Roster ${held.roster_id}`);
      })
      .catch(() => { if (!dead) setOwner(undefined); });
    leagueRegister(leagueId, 200)
      .then((r) => { if (!dead && r.ok) setMoves((r.rows ?? []).filter((x) => x.slug === slug)); })
      .catch(() => {});
    if (week != null) {
      // 0330: the row, not the scalar — with a multiplier in hand the sheet
      // shows the week in THIS league's scoring rather than the source's PPR.
      leagueWeekProjections(leagueId, week)
        .then((r) => { if (!dead) setWkProj(weekPointsFor({ slug, pos, team }, r.rows?.[slug] ?? null)); })
        .catch(() => { if (!dead) setWkProj(null); });
    }
    // Asked through the league rather than by ESPN id: the league's pool is
    // where the crosswalk lives, and a card only ever knows a slug.
    leagueNews(leagueId, 60)
      .then((r) => { if (!dead) setNews((r.news ?? []).filter((n) => (n.players ?? []).some((x) => x.slug === slug)).slice(0, 3)); })
      .catch(() => {});
    return () => { dead = true; };
  }, [leagueId, slug, week]);
  // Prefer the live team layer (fresh bake + worker overrides, 0142) over
  // whatever the opening surface happened to know — see the web card.
  const showTeam = displayTeam(slug, team);
  // The team's chart, grouped by position (QB · RB · WR · TE), the way the
  // projected box reads it: by the normalised code, then the raw one.
  const chart = (() => {
    void depthVer;
    const byNorm = depthChartFor(normTeam(showTeam));
    return byNorm.length ? byNorm : depthChartFor(showTeam);
  })();
  const bio = PLAYER_BIO[slug];
  // A ROOKIE HAS NO LAST SEASON (v0.299.1, founder: "why does a rookie have a
  // 2025 stat line?"). `statsForName` matches the 2025 bake BY NAME, so a 2026
  // rookie who shares a name with last year's player inherits his season — the
  // founder's C. Allen, a KC rookie out of Cincinnati, wearing somebody else's
  // 14 games. Experience is the check that settles it: a player in his first
  // NFL season cannot have played in the one before, so whatever is keyed to
  // his name is not his. Position already disambiguates the other famous
  // collision (Josh Allen QB vs Josh Allen LB); this is the one it can't.
  const rookie = bio?.exp === 0;

  const tenure = tenureLabel(slug);
  const inj = week != null ? injuryRowFor(week, slug) : null;
  const injTag = week != null ? injuryFor(week, slug) : null;
  const season = rookie ? NO_SEASON : statsForName(name, pos as Pos);
  const weekLine = (() => {
    if (week == null) return null;
    try {
      const p = { id: slug, name, full: name, pos: pos as Pos, team, stats: season };
      const s = statlineAt(p, week, Number.MAX_SAFE_INTEGER);
      const any = s.passYds || s.rushYds || s.recYds || s.carries || s.rec || s.targets || s.fg || s.xp || s.sacks || s.tackles;
      return any ? fmtStat(pos as Pos, s, true) : null;
    } catch { return null; }
  })();
  const seasonLine = season.games > 0
    ? `${season.games} G · ${Math.round(season.ppr)} PPR` + (
      pos === 'QB' ? ` · ${season.passYds} pass yd · ${season.passTds} TD`
      : pos === 'RB' ? ` · ${season.rushYds} ru yd · ${season.rushTds + season.recTds} TD`
      : pos === 'WR' || pos === 'TE' ? ` · ${season.receptions}/${season.targets}-${season.recYds} rec · ${season.recTds} TD`
      : '')
    : null;

  const [starred, setStarred] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    if (!userId) { setStarred(null); return; }
    myFavorites().then((f) => { if (alive) setStarred(f.has(slug)); });
    return () => { alive = false; };
  }, [slug, userId]);
  const toggleStar = () => {
    if (!userId || starred == null) return;
    const next = !starred;
    setStarred(next);
    setFavorite(userId, slug, next).catch(() => setStarred(!next));
  };

  // ── DROPPING HIM (v0.285.0) ──────────────────────────────────────────────
  // Two taps, always: a drop is the one thing on this card that cannot be
  // undone by tapping it again, and the card is opened from board rows and
  // roster lines where a thumb lands by accident.
  const [dropArmed, setDropArmed] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dropErr, setDropErr] = useState<string | null>(null);
  const doDrop = async () => {
    if (!leagueId || myRoster == null || dropping) return;
    if (!dropArmed) { setDropArmed(true); return; }
    setDropping(true); setDropErr(null);
    try {
      const r = await dropPlayer(leagueId, myRoster, slug);
      if (!r.ok) { setDropErr(friendlyError(r.error ?? 'That didn’t work.')); setDropArmed(false); return; }
      notifyRosterChanged(leagueId);
      onClose();
    } catch (x) { setDropErr(friendlyError(x)); setDropArmed(false); }
    finally { setDropping(false); }
  };

  const photo = headshot(slug);
  const logo = teamLogo(showTeam, { slug });
  const row = (label: string, value: string) => (
    <View key={label} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Text style={{ fontFamily: MONO, width: 58, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: t.faint, paddingTop: 1 }}>{label}</Text>
      <Text style={{ fontFamily: MONO, flex: 1, fontSize: 11, lineHeight: 15, color: t.text }}>{value}</Text>
    </View>
  );

  return (
    <Overlay visible title="Player card" subtitle={`${name.toUpperCase()} · ${pos} · ${team}`} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center' }}>
            {photo ? <Image source={{ uri: photo }} style={{ width: 54, height: 54 }} resizeMode="cover" />
              : logo ? <Image source={{ uri: logo }} style={{ width: 34, height: 34 }} resizeMode="contain" />
              : <Text style={{ fontFamily: MONO, fontSize: 12, color: t.faint }}>{pos}</Text>}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800', color: t.text, flexShrink: 1 }}>{name}</Text>
              {week != null && <InjuryBadge status={injuryFor(week, slug)} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <Mono size={9.5} weight="700">{pos}</Mono>
              {!!logo && <Image source={{ uri: logo }} style={{ width: 13, height: 13 }} resizeMode="contain" />}
              <Mono size={9.5} tone="dim">{showTeam || '—'}{bio?.num != null ? ` · #${bio.num}` : ''}</Mono>
            </View>
          </View>
          {userId && starred != null && (
            <Pressable onPress={toggleStar} hitSlop={10}>
              <Text style={{ fontSize: 24, color: starred ? '#E8B23A' : t.faint }}>{starred ? '★' : '☆'}</Text>
            </Pressable>
          )}
        </View>

        {/* THE FACT STRIP (v0.282.0) — the four numbers a card is opened for,
            read at a glance instead of in a sentence. Height and weight are
            NOT here: the bake has age, tenure, college and jersey, and
            inventing the other two would be worse than three columns. */}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.bd, paddingVertical: 9 }}>
          {([
            ['AGE', bio?.age != null ? String(bio.age) : '—'],
            ['EXP', bio?.exp != null ? (bio.exp === 0 ? 'ROOK' : `${bio.exp} yr`) : '—'],
            ['NO.', bio?.num != null ? `#${bio.num}` : '—'],
            ['PROJ', projFor(slug, pos) != null ? (projFor(slug, pos) as number).toFixed(1) : '—'],
            // 0329: the WEEK's number, refreshed hourly — it knows about the
            // injury, the bye and the depth chart; the August bake cannot.
            // 0330 puts the OPPONENT in the label beside it.
            [week != null ? `${weekLabel(week)}${wkProj?.matchup ? ` ${wkProj.matchup}` : ''}` : 'WK',
              wkProj != null ? wkProj.pts.toFixed(1) : '—'],
          ] as const).map(([k, v]) => (
            <View key={k} style={{ flex: 1, alignItems: 'center' }}>
              <Mono size={8} tone="faint" weight="700" track={0.12}>{k}</Mono>
              <Text style={{ fontSize: 15, fontWeight: '800', color: t.text, marginTop: 2 }}>{v}</Text>
            </View>
          ))}
        </View>

        {/* Only ONE tab exists without a league behind the card, so the strip
            appears only when the second has something to show. */}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(([['summary', 'SUMMARY'],
              ['log', 'GAME LOG'],
              ['team', `${showTeam || 'TEAM'} DEPTH`],
              ...(leagueId ? [['history', `HISTORY${moves?.length ? ` (${moves.length})` : ''}`]] : [])] as const) as readonly (readonly [string, string])[]).map(([id, label]) => (
            <Pressable key={id} onPress={() => setTab(id as 'summary' | 'log' | 'team' | 'history')}
              style={{ borderWidth: 1, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 6, borderColor: tab === id ? t.you : t.bd, backgroundColor: tab === id ? t.bg : 'transparent' }}>
              <Mono size={9} weight="700" tone={tab === id ? 'you' : 'dim'}>{label}</Mono>
            </Pressable>
          ))}
        </View>

        {tab === 'summary' && (
          <View style={{ gap: 7 }}>
            {/* 0329: what has been said about him lately. Absent rather than
                empty when the feed has nothing. */}
            {(news ?? []).length > 0 && (
              <View style={{ borderBottomWidth: 1, borderBottomColor: t.bd, paddingBottom: 6, marginBottom: 2 }}>
                <Mono size={8} tone="faint" weight="700" track={0.12}>📰 LATELY</Mono>
                {(news ?? []).map((n) => (
                  <Pressable key={n.id} disabled={!n.url} onPress={() => { if (n.url) { tap(); void openLink(n.url); } }}
                    style={({ pressed }) => ({ marginTop: 4, opacity: pressed ? 0.6 : 1 })}>
                    <Text numberOfLines={2} style={{ fontSize: 11, color: t.text, lineHeight: 15 }}>{n.headline}</Text>
                    <Mono size={8} tone="faint">
                      {new Date(n.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{n.url ? ' · espn.com ↗' : ''}
                    </Mono>
                  </Pressable>
                ))}
              </View>
            )}
            {/* UPCOMING GAME — the top panel of Sleeper's summary, from the
                slate this app already carries. Silent out of season, when the
                bye is on, or before the slate for that week is loaded. */}
            {(() => {
              if (week == null || !showTeam) return null;
              const g = nflGameForTeam(week, showTeam);
              if (!g) return row('NEXT UP', 'bye — no game this week');
              const home = g.home === showTeam;
              const opp = home ? g.away : g.home;
              const when = g.kickoff ? kickoffLabel(g.kickoff) : '';
              return row('NEXT UP', `${home ? 'vs' : '@'} ${opp}${when ? ` · ${when}` : ''}`);
            })()}
            {owner !== undefined ? row('ROSTERED', owner ? `⇄ ${owner}` : 'free agent — nobody holds him') : null}
            {(tenure || bio?.college) ? row('CAREER', [tenure, bio?.college].filter(Boolean).join(' · ')) : null}
            {inj ? row('INJURY', `${INJURY_LABEL[inj.status] ?? inj.status}${inj.comment ? ` — ${inj.comment}` : ''}${inj.returnDate ? ` · est. return ${inj.returnDate}` : ''}`)
              : injTag ? row('INJURY', INJURY_LABEL[injTag] ?? injTag) : null}
            {flagFor(slug) ? row('COMMISH', `\u2691 ${flagFor(slug)}`) : null}
            {weekLine ? row('THIS WK', weekLine) : null}
            {seasonLine ? row('2025', seasonLine) : null}

            {/* THE DROP — here rather than on the roster line, so it is one
                deliberate trip into a player rather than a red button sitting
                next to every name you might have meant to tap. Only ever
                offered for a player on YOUR roster in THIS league. */}
            {myRoster != null && (
              <View style={{ borderTopWidth: 1, borderTopColor: t.bd, marginTop: 6, paddingTop: 10, gap: 6 }}>
                {dropErr && <Mono size={9.5} tone="opp" style={{ lineHeight: 14 }}>{dropErr}</Mono>}
                <Pressable disabled={dropping} onPress={doDrop}
                  style={{ borderWidth: 1, borderRadius: 6, paddingVertical: 9, alignItems: 'center',
                    borderColor: dropArmed ? t.opp : t.bd, backgroundColor: dropArmed ? t.sh : 'transparent', opacity: dropping ? 0.5 : 1 }}>
                  <Mono size={10} weight="700" tone="opp">
                    {dropping ? 'DROPPING…' : dropArmed ? '✕ TAP AGAIN TO CONFIRM' : `✕ DROP ${name.toUpperCase()}`}
                  </Mono>
                </Pressable>
                <Mono size={8.5} tone="faint" style={{ lineHeight: 12 }}>
                  He sits on waivers for 24h — anyone in the league can claim him, and claims beat first-come.
                </Mono>
              </View>
            )}
          </View>
        )}

        {/* GAME LOG (v0.641.0) — every week he has plays for this season,
            scored under THIS league's rules; a drip league gets the statline
            and no points column (see core/data/gameLog). */}
        {tab === 'log' && (
          <View style={{ gap: 0 }}>
            {logErr && <Mono size={10} tone="opp">Couldn’t load his game log.</Mono>}
            {!logErr && log === null && <Mono size={10} tone="faint">Loading his season…</Mono>}
            {log?.length === 0 && (
              <Mono size={10} tone="faint" style={{ lineHeight: 15 }}>
                No plays recorded yet this season. Weeks appear here as the games are played.
              </Mono>
            )}
            {!!log?.length && (
              <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <Mono size={8} tone="faint" weight="700" style={{ width: 30 }}>WK</Mono>
                <Mono size={8} tone="faint" weight="700" style={{ width: 56 }}>OPP</Mono>
                <Mono size={8} tone="faint" weight="700" style={{ flex: 1 }}>STAT LINE</Mono>
                {log[0].points != null && <Mono size={8} tone="faint" weight="700" style={{ width: 44, textAlign: 'right' }}>FPTS</Mono>}
              </View>
            )}
            {log?.map((r) => (
              <View key={r.week} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <Mono size={10} weight="700" style={{ width: 30 }}>{weekTick(r.week)}</Mono>
                <Mono size={9.5} tone="dim" style={{ width: 56 }}>{r.opponent ?? '—'}</Mono>
                <Mono size={9.5} tone={r.blank ? 'faint' : 'text'} style={{ flex: 1, lineHeight: 13 }}>{r.blank ? '—' : r.line}</Mono>
                {r.points != null && (
                  <Mono size={10.5} weight="700" tone={!r.blank && r.points > 0 ? 'you' : 'faint'} style={{ width: 44, textAlign: 'right' }}>
                    {r.blank ? '—' : r.points.toFixed(1)}
                  </Mono>
                )}
              </View>
            ))}
            {!!log?.length && log[0].points == null && (
              <Mono size={9} tone="faint" style={{ marginTop: 8, lineHeight: 13 }}>
                ◈ DRIP leagues score per window, with power-ups on top — there is no one season number to print here.
              </Mono>
            )}
          </View>
        )}

        {/* TEAM DEPTH (v0.640.0) — his team's chart, the starter at the top
            of each position, him marked. Every other name is a tap into that
            player's card. Sleeper's order, re-ranked for availability each
            week, published daily by the worker (0293). */}
        {tab === 'team' && (
          <View style={{ gap: 8 }}>
            {chart.length === 0 && (
              <Mono size={10} tone="faint" style={{ lineHeight: 15 }}>
                {showTeam ? `No depth chart for ${showTeam} yet — the worker publishes one daily.` : 'No team on file for him, so no depth chart.'}
              </Mono>
            )}
            {chart.map((g) => (
              <View key={g.pos} style={{ gap: 0 }}>
                <Mono size={8} tone="faint" weight="700" track={0.12} style={{ marginBottom: 2 }}>{g.pos}</Mono>
                {g.rows.map((r) => {
                  const me = r.slug === slug;
                  const rn = nameFromSlug(r.slug);
                  const tag = week != null ? injuryFor(week, r.slug) : null;
                  return (
                    <Pressable key={r.slug} disabled={me} hitSlop={4}
                      onPress={() => { tap(); openPlayerCard({ slug: r.slug, name: rn, pos: r.pos, team: showTeam, week, userId, leagueId }); }}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.bd, opacity: pressed ? 0.6 : 1 })}>
                      <Mono size={9} tone={me ? 'you' : 'faint'} weight="700" style={{ width: 14, textAlign: 'right' }}>{String(r.depth)}</Mono>
                      <View style={{ width: 22, height: 22, borderRadius: 11, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center' }}>
                        {headshot(r.slug) ? <Image source={{ uri: headshot(r.slug)! }} style={{ width: 22, height: 22 }} resizeMode="cover" />
                          : <Text style={{ fontFamily: MONO, fontSize: 7, color: t.faint }}>{r.pos}</Text>}
                      </View>
                      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: me ? '800' : '600', color: me ? t.you : t.text }}>{rn}</Text>
                      {!!tag && <InjuryBadge status={tag} />}
                      {me ? <Mono size={8} tone="you">THIS CARD</Mono> : <Mono size={9} tone="faint">›</Mono>}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {chart.length > 0 && (
              <Mono size={8.5} tone="faint" style={{ lineHeight: 12 }}>
                Sleeper's depth chart, re-ranked for who's available this week; refreshed daily. Tap a name for his card.
              </Mono>
            )}
          </View>
        )}

        {/* HISTORY — this league's own transaction record for him (0186).
            Sleeper's is the whole platform's; ours is the league's, which is
            the half a manager argues about. */}
        {!!leagueId && tab === 'history' && (
          <View style={{ gap: 2 }}>
            {moves === null && <Mono size={10} tone="faint">Loading…</Mono>}
            {moves?.length === 0 && (
              <Mono size={10} tone="faint" style={{ lineHeight: 15 }}>
                No moves yet. Adds, drops, claims and trades appear here from the moment the draft ends —
                draft night itself is in the draft room.
              </Mono>
            )}
            {moves?.map((m) => (
              <View key={m.id} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <Text style={{ fontSize: 12, width: 16, textAlign: 'center', color: m.kind === 'drop' ? t.opp : t.you }}>
                  {m.kind === 'drop' ? '✕' : m.kind === 'trade' ? '⇄' : m.kind === 'waiver' ? '⚑' : '✚'}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 11.5, lineHeight: 16, color: t.text }}>
                    <Text style={{ fontWeight: '700' }}>{m.team ?? `Roster ${m.roster_id}`}</Text>
                    {m.kind === 'drop' ? ' dropped him'
                      : m.kind === 'trade' ? ` traded for him${m.from_team ? ` from ${m.from_team}` : ''}`
                      : m.kind === 'waiver' ? ` claimed him off waivers${m.bid ? ` for ${m.bid}` : ''}`
                      : m.kind === 'commish' ? ' — moved by the commissioner'
                      : ' signed him'}
                  </Text>
                  <Mono size={8.5} tone="faint" style={{ marginTop: 1 }}>
                    {(() => { const d = new Date(m.at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); })()}
                  </Mono>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Overlay>
  );
}
