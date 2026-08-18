// The player card, native — the web modal's sibling (src/app/playerCard.tsx),
// same module-level bus: any surface calls openPlayerCard({...}) and the host
// (mounted once in App) presents the sheet. Content comes from what core
// already knows: baked bio (tenure/college/jersey/age), the LIVE injury
// detail, this week's statline when the board has plays loaded, the baked
// 2025 season line, and the ★ favorite (0139, account-scoped so a star set
// here is lit on the web).
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import type { Pos } from '@drip/core/types';
import { PLAYER_BIO, tenureLabel } from '@drip/core/data/playerBio';
import { injuryFor, injuryRowFor } from '@drip/core/data/injuries';
import { flagFor } from '@drip/core/data/commish';
import { displayTeam } from '@drip/core/data/playerTeam';
import { statsForName } from '@drip/core/data/players';
import { statlineAt, fmtStat } from '@drip/core/engine/sim';
import { headshot, teamLogo } from '@drip/core/data/media';
import { myFavorites, setFavorite, nativeRosters, matchupTeams, leagueRegister, leagueGameMode, playerSeasonPlays, type RegisterRow } from '@drip/core/data/liveApi';
import { buildGameLog, type GameLogWeek } from '@drip/core/data/gameLog';
import { nflGameForTeam, kickoffLabel } from '@drip/core/data/nflSlate';
import { PROJ_2026 } from '@drip/core/data/proj2026';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Ev, track } from '@drip/core/analytics';
import { Overlay } from './Overlay';
import { InjuryBadge } from './rosterGroup';

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
  return <PlayerCardSheet req={req} onClose={() => setReq(null)} />;
}

function PlayerCardSheet({ req, onClose }: { req: PlayerCardReq; onClose: () => void }) {
  const t = useTheme();
  const { slug, name, pos, team, week, userId, leagueId } = req;
  // SUMMARY | HISTORY. There is no GAME LOG or TEAM tab, deliberately: a
  // per-week NFL stat table and a depth chart are data this app does not hold
  // (the baked pbp is fetched a week at a time for the board, and nothing here
  // knows a team's depth order), and an empty tab is worse than no tab.
  const [tab, setTab] = useState<'summary' | 'log' | 'history'>('summary');
  // Who holds him in THIS league, and what the league has done with him.
  const [owner, setOwner] = useState<string | null | undefined>(undefined); // undefined = loading, null = free agent
  const [moves, setMoves] = useState<RegisterRow[] | null>(null);
  useEffect(() => {
    if (!leagueId) { setOwner(undefined); setMoves(null); return; }
    let dead = false;
    nativeRosters(leagueId)
      .then(async (rows) => {
        const mine = rows.find((r) => r.slug === slug);
        if (dead) return;
        if (!mine) { setOwner(null); return; }
        const teams = await matchupTeams(leagueId, [mine.roster_id]).catch(() => ({} as Record<number, { team_name: string }>));
        if (!dead) setOwner(teams[mine.roster_id]?.team_name ?? `Roster ${mine.roster_id}`);
      })
      .catch(() => { if (!dead) setOwner(undefined); });
    leagueRegister(leagueId, 200)
      .then((r) => { if (!dead && r.ok) setMoves((r.rows ?? []).filter((x) => x.slug === slug)); })
      .catch(() => {});
    return () => { dead = true; };
  }, [leagueId, slug]);
  // Prefer the live team layer (fresh bake + worker overrides, 0142) over
  // whatever the opening surface happened to know — see the web card.
  const showTeam = displayTeam(slug, team);
  const bio = PLAYER_BIO[slug];
  // THE GAME LOG (v0.284.0) — fetched ONLY when the tab is opened. It is the
  // one panel that costs a query per player, and most cards are opened to read
  // a name and close again.
  const [log, setLog] = useState<GameLogWeek[] | null>(null);
  const [logErr, setLogErr] = useState(false);
  useEffect(() => {
    if (tab !== 'log' || log !== null) return;
    let dead = false;
    (async () => {
      try {
        // The league's own scoring decides the points column; a drip league
        // has no classic table, so buildGameLog prints statlines alone.
        const gm = leagueId ? await leagueGameMode(leagueId).catch(() => null) : null;
        const scoring = gm?.ok && gm.mode === 'classic' ? { ...(gm.scoring ?? {}), ppr: gm.ppr ?? 1 } : null;
        const rows = await playerSeasonPlays(slug);
        if (dead) return;
        setLog(buildGameLog({ id: slug, name, pos, team: showTeam }, rows, scoring));
      } catch { if (!dead) setLogErr(true); }
    })();
    return () => { dead = true; };
  }, [tab, log, leagueId, slug, name, pos, showTeam]);

  const tenure = tenureLabel(slug);
  const inj = week != null ? injuryRowFor(week, slug) : null;
  const injTag = week != null ? injuryFor(week, slug) : null;
  const season = statsForName(name, pos as Pos);
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

  const photo = headshot(slug);
  const logo = teamLogo(showTeam);
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
              <Mono size={9.5} tone="dim">{showTeam || 'FA'}{bio?.num != null ? ` · #${bio.num}` : ''}</Mono>
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
            ['PROJ', PROJ_2026.get(slug) != null ? (PROJ_2026.get(slug) as number).toFixed(1) : '—'],
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
          {(([['summary', 'SUMMARY'], ['log', 'GAME LOG'],
              ...(leagueId ? [['history', `HISTORY${moves?.length ? ` (${moves.length})` : ''}`]] : [])] as const) as readonly (readonly [string, string])[]).map(([id, label]) => (
            <Pressable key={id} onPress={() => setTab(id as 'summary' | 'log' | 'history')}
              style={{ borderWidth: 1, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 6, borderColor: tab === id ? t.you : t.bd, backgroundColor: tab === id ? t.bg : 'transparent' }}>
              <Mono size={9} weight="700" tone={tab === id ? 'you' : 'dim'}>{label}</Mono>
            </Pressable>
          ))}
        </View>

        {tab === 'summary' && (
          <View style={{ gap: 7 }}>
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
          </View>
        )}

        {/* GAME LOG — every week he has plays for, scored under THIS league's
            rules. Drip leagues get the statline and no points column: drip
            scoring is per-window with power-ups on top, so a season column
            would be a number no matchup ever produced. */}
        {tab === 'log' && (
          <View>
            {logErr && <Mono size={10} tone="opp">Couldn't load his game log.</Mono>}
            {!logErr && log === null && <Mono size={10} tone="faint">Loading his season…</Mono>}
            {log?.length === 0 && (
              <Mono size={10} tone="faint" style={{ lineHeight: 15 }}>
                No plays recorded yet this season. Weeks appear here as the games are played.
              </Mono>
            )}
            {!!log?.length && (
              <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <Mono size={8} tone="faint" weight="700" style={{ width: 30 }}>WK</Mono>
                <Mono size={8} tone="faint" weight="700" style={{ width: 54 }}>OPP</Mono>
                <Mono size={8} tone="faint" weight="700" style={{ flex: 1 }}>STAT LINE</Mono>
                {log[0].points != null && <Mono size={8} tone="faint" weight="700" style={{ width: 42, textAlign: 'right' }}>FPTS</Mono>}
              </View>
            )}
            {log?.map((r) => (
              <View key={r.week} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <Mono size={9.5} weight="700" style={{ width: 30 }}>{r.week > 100 ? `P${r.week - 100}` : r.week}</Mono>
                <Mono size={9} tone="dim" style={{ width: 54 }}>{r.opponent ?? '—'}</Mono>
                <Text style={{ flex: 1, fontFamily: MONO, fontSize: 9.5, lineHeight: 13, color: r.blank ? t.faint : t.text }}>
                  {r.blank ? 'did not play' : r.line}
                </Text>
                {r.points != null && (
                  <Mono size={10} weight="700" tone={r.points > 0 ? 'you' : 'faint'} style={{ width: 42, textAlign: 'right' }}>
                    {r.points.toFixed(1)}
                  </Mono>
                )}
              </View>
            ))}
            {!!log?.length && log[0].points == null && (
              <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: 12 }}>
                ◈ DRIP leagues score per window, with power-ups on top — there is no one season number to print here.
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
