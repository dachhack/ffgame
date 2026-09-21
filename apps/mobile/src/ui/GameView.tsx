// 🏟 THE GAME VIEW — one game, the way Sleeper shows it (v0.390.3).
//
// Founder, over Sleeper's game screen: "the sleeper field view is pretty
// good can we emulate this?" Top to bottom: the week's games as a strip
// (tap to switch), the scoreboard — nicknames, big scores, the quarter
// clock, the situation, the ball on the possession side, the club codes
// faded behind — the LAST PLAY line, the field with the ball carrier's
// headshot at the spot, the drive line, the reader, and two tabs: LIVE
// (the plays, newest first, with the people on each and their lines) and
// STATS (the box score). Every reading is core's (data/gameView,
// engine/gameNames, engine/boxScore); this is the shell.
//
// A BODY, not a sheet: the surfaces that open it are already sheets
// (stacked Modals are flaky on Android), so they swap this in.
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { gameFeedFor, weekBoxGames, latestPlay, type GamePlay } from '@drip/core/data/gameFeed';
import { qClock, situationLabel, driveSummary, playNames, ballCarrier, clockLabelFor, shortClockLabel, stoppageLabel, gameLog, eventLabel } from '@drip/core/data/gameView';
import { clubNick } from '@drip/core/data/spokenPlay';
import { gamePeople, resolveGamebookPerson, type GamePerson } from '@drip/core/engine/gameNames';
import { gameBoxScore, boxTabRows, type BoxRow } from '@drip/core/engine/boxScore';
import { teamLogo, headshot } from '@drip/core/data/media';
import { teamColor } from '@drip/core/data/teamColors';
import { kickoffLabel } from '@drip/core/data/nflSlate';
import { stripSlugTag } from '@drip/core/data/slugMeta';
import { useTheme, MONO, alpha, fs } from '../theme.native';
import { FieldView } from './FieldView';
import { ReaderBar } from './ReaderBar';
import { appVoice } from './voice';
import { openPlayerCard } from './PlayerCardSheet';

const fullName = (slug: string) => stripSlugTag(slug).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
const shortName = (full: string) => { const w = full.split(' '); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(' ')}` : full; };

export function GameViewBody({ week, initialKey, showStrip = true, onBack }: {
  week: number; initialKey?: string | null; showStrip?: boolean; onBack?: () => void;
}) {
  const t = useTheme();
  // A tick so the body re-reads the feed store the board/sheet keeps fresh.
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 3000); return () => clearInterval(id); }, []);
  const games = useMemo(() => weekBoxGames(week), [week, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selKey, setSelKey] = useState<string | null>(initialKey ?? null);
  useEffect(() => { if (initialKey) setSelKey(initialKey); }, [initialKey]);
  const game = games.find((g) => g.key === selKey) ?? games.find((g) => g.state === 'live') ?? games[0] ?? null;
  const feed = game ? gameFeedFor(week, game.home) : null;
  const plays: GamePlay[] = feed?.plays ?? [];
  const last = latestPlay(plays);
  const home = game?.home ?? '', away = game?.away ?? '';
  const over = game?.state === 'final';
  const live = game?.state === 'live';

  // People + lines, read fresh as the game grows.
  const people = useMemo(() => (game ? gamePeople(week, home, away) : []), [week, home, away, plays.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = useMemo(() => (game ? gameBoxScore(week, home, away, Number.MAX_SAFE_INTEGER) : { home: [], away: [] }), [week, home, away, plays.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowOf = useMemo(() => { const m = new Map<string, BoxRow>(); for (const r of [...box.home, ...box.away]) m.set(r.slug, r); return m; }, [box]);
  const personOf = (abbr: string): GamePerson | null => resolveGamebookPerson(people, abbr);
  const carrierOf = (p: GamePlay) => { const a = ballCarrier(p); const who = a ? personOf(a) : null; return who ? { slug: who.slug, name: shortName(who.full) } : null; };

  const [tab, setTab] = useState<'live' | 'stats'>('live');
  const [statTab, setStatTab] = useState<'off' | 'def'>('off');
  const drive = feed ? driveSummary(feed) : null;
  const sit = last ? situationLabel(last, home, away) : null;
  const ballTm = last ? (last.tm2 ?? last.tm) : null;
  const hc = teamColor(home), ac = teamColor(away);

  const teamCol = (abbr: string, score: number | null, right: boolean) => (
    <View style={{ flex: 1, alignItems: right ? 'flex-end' : 'flex-start' }}>
      <View style={{ flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
        {!!teamLogo(abbr) && <Image source={{ uri: teamLogo(abbr)! }} style={{ width: 22, height: 22 }} />}
        <Text style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: '800', color: t.text }}>{clubNick(abbr)}</Text>
      </View>
      <View style={{ flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <Text style={{ fontFamily: MONO, fontSize: 34, fontWeight: '800', color: t.text, lineHeight: 38 }}>{score == null ? '–' : score}</Text>
        {ballTm === abbr && !over && <Text style={{ fontSize: 12 }}>🏈</Text>}
      </View>
    </View>
  );

  // Sized by content and able to SHRINK, never `flex: 1` (v0.390.6): the
  // Overlay hosting this sizes itself to its children, so a flex:1 root had
  // no height to fill and the sheet opened as a header over nothing
  // (founder's screenshot). Same shape as every other sheet body.
  return (
    <View style={{ flexShrink: 1, minHeight: 0 }}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={8} style={{ alignSelf: 'flex-start', marginHorizontal: 12, marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.you }}>‹ ▦ ALL FIELDS</Text>
        </Pressable>
      )}
      {/* THE STRIP — every game this week; the selected one lit. */}
      {showStrip && games.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingTop: 10 }}>
          {games.map((g) => {
            const l = latestPlay(g.feed?.plays);
            const on = g.key === game?.key;
            return (
              <Pressable key={g.key} onPress={() => setSelKey(g.key)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999,
                  borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, backgroundColor: on ? alpha(t.you, 0.12) : t.surface }}>
                {!!teamLogo(g.away) && <Image source={{ uri: teamLogo(g.away)! }} style={{ width: 16, height: 16 }} />}
                <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '800', color: g.state === 'final' ? t.dim : t.text }}>{l ? l.as : ''}</Text>
                {g.state === 'live' && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.opp }} />}
                <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: g.state === 'live' ? t.opp : t.faint }}>
                  {g.state === 'final' ? 'FINAL' : g.state === 'live' ? shortClockLabel(g.feed, l) : g.kickoff ? kickoffLabel(g.kickoff) : 'SOON'}
                </Text>
                <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '800', color: g.state === 'final' ? t.dim : t.text }}>{l ? l.hs : ''}</Text>
                {!!teamLogo(g.home) && <Image source={{ uri: teamLogo(g.home)! }} style={{ width: 16, height: 16 }} />}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        {!game && <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.faint, textAlign: 'center', padding: 24 }}>No games on the feed yet.</Text>}
        {game && (
          <>
            {/* THE SCOREBOARD, with the club codes faded behind. */}
            <View style={{ marginHorizontal: 12, marginTop: 12, overflow: 'hidden', borderRadius: 10 }}>
              <Text pointerEvents="none" style={{ position: 'absolute', left: -8, top: -14, fontFamily: MONO, fontSize: 64, fontWeight: '900', color: alpha(ac?.c ?? t.dim, 0.14), letterSpacing: -2 }}>{away}</Text>
              <Text pointerEvents="none" style={{ position: 'absolute', right: -8, top: -14, fontFamily: MONO, fontSize: 64, fontWeight: '900', color: alpha(hc?.c ?? t.dim, 0.14), letterSpacing: -2 }}>{home}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10 }}>
                {teamCol(away, last ? last.as : null, false)}
                <View style={{ alignItems: 'center', minWidth: 96 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {live && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.opp }} />}
                    <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '800', color: t.text }}>
                      {/* HALFTIME / END OF Q1 / the live clock (v0.434.3), else the last play's clock as before. */}
                      {over ? 'FINAL' : clockLabelFor(feed, last, game.kickoff ? kickoffLabel(game.kickoff) : 'UPCOMING')}
                    </Text>
                  </View>
                  {!!sit && !over && <Text style={{ fontFamily: MONO, fontSize: fs(9), color: t.dim, marginTop: 2 }}>{sit}</Text>}
                </View>
                {teamCol(home, last ? last.hs : null, true)}
              </View>
            </View>

            {/* LAST PLAY */}
            {last && !over && (
              <View style={{ marginHorizontal: 12, marginTop: 6, borderLeftWidth: 2, borderLeftColor: t.opp, paddingLeft: 8 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 0.8, color: t.dim }}>
                  {live ? `● ${stoppageLabel(feed) ?? 'LIVE'} · ` : ''}LAST PLAY{sit ? ` · ${sit}` : ''}
                </Text>
                <Text style={{ fontSize: fs(12.5), color: t.text, lineHeight: fs(12.5) * 1.35, marginTop: 2 }}>{last.txt}</Text>
              </View>
            )}

            {/* THE FIELD, with the carrier at the spot */}
            <View style={{ marginHorizontal: 8 }}>
              <FieldView week={week} team={home} clock={Number.MAX_SAFE_INTEGER} carrierOf={carrierOf} />
            </View>
            {!!drive && !over && (
              <Text style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.dimstrong, textAlign: 'center', marginTop: 4 }}>{drive.text}</Text>
            )}

            {/* THE READER */}
            {feed && (
              <View style={{ marginHorizontal: 12, marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 10, backgroundColor: t.surface }}>
                <ReaderBar key={game.key} week={week} feed={feed} />
              </View>
            )}

            {/* TABS */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd, marginHorizontal: 12 }}>
              {(['live', 'stats'] as const).map((id) => (
                <Pressable key={id} onPress={() => setTab(id)} style={{ paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tab === id ? t.you : 'transparent' }}>
                  <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '800', letterSpacing: 1, color: tab === id ? t.you : t.dim }}>
                    {id === 'live' ? (live ? '● LIVE' : 'PLAYS') : 'STATS'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {tab === 'live' && (
              <View style={{ paddingHorizontal: 12 }}>
                {plays.length === 0 && <Text style={{ fontFamily: MONO, fontSize: fs(10.5), color: t.faint, textAlign: 'center', padding: 16 }}>— no plays yet —</Text>}
                {/* THE STOPPAGES ARE IN THE LOG (v0.434.3): a timeout, the
                    two-minute warning, the end of a quarter, halftime, the
                    final — each a divider at its clock between the plays. */}
                {[...gameLog(feed ?? { plays })].reverse().map((row, i) => {
                  if (row.kind === 'event') {
                    return (
                      <View key={`ev-${row.c}-${i}`} style={{ paddingVertical: 8, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: alpha(t.bd, 0.6) }}>
                        <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '800', letterSpacing: 1.2, color: t.dim }}>— {eventLabel(row.e)} · {qClock(row.c)} —</Text>
                        {!!row.e.txt && !/^(end (of )?(period|quarter|half|game)|two-minute warning)/i.test(row.e.txt) && (
                          <Text style={{ fontFamily: MONO, fontSize: fs(9), color: t.faint, marginTop: 2 }}>{row.e.txt}</Text>
                        )}
                      </View>
                    );
                  }
                  const p = row.p;
                  const names = playNames(p.txt).map((a) => personOf(a)).filter((x): x is GamePerson => !!x);
                  const s2 = situationLabel(p, home, away);
                  return (
                    <Pressable key={p.pid ?? `${p.c}-${i}`} onLongPress={() => { appVoice.stop(); appVoice.speak(p.txt, () => {}); }}
                      style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: alpha(t.bd, 0.6) }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                        {!!teamLogo(p.tm) && <Image source={{ uri: teamLogo(p.tm)! }} style={{ width: 22, height: 22, marginTop: 2 }} />}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                            <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.dim }}>{s2 ?? p.ty.toUpperCase()}</Text>
                            <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.dim }}>{qClock(p.c)}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                            <Text style={{ flex: 1, fontSize: fs(12.5), fontWeight: p.sc ? '800' : '600', color: p.sc ? t.warn : t.text, lineHeight: fs(12.5) * 1.35, marginTop: 2 }}>{p.txt}</Text>
                            <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '800', color: p.sc ? t.warn : t.dimstrong }}>{away} {p.as}–{p.hs} {home}</Text>
                          </View>
                          {names.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                              {names.map((who) => {
                                const row = rowOf.get(who.slug);
                                return (
                                  <Pressable key={who.slug} onPress={() => openPlayerCard({ slug: who.slug, name: fullName(who.slug), pos: row?.pos ?? '', team: row?.team ?? '', week })}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, overflow: 'hidden', backgroundColor: t.sh }}>
                                      {!!headshot(who.slug) && <Image source={{ uri: headshot(who.slug)! }} style={{ width: 20, height: 20 }} />}
                                    </View>
                                    <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.text }}>{shortName(who.full)}</Text>
                                    {!!row && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.pos?.[row.pos]?.fg ?? t.faint }}>{row.pos}</Text>}
                                    {!!row && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), color: t.dim }}>· {row.stat}</Text>}
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {tab === 'stats' && (
              <View style={{ paddingHorizontal: 12 }}>
                <View style={{ flexDirection: 'row', gap: 6, marginVertical: 10, padding: 3, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, backgroundColor: t.bg }}>
                  {(['off', 'def'] as const).map((id) => (
                    <Pressable key={id} onPress={() => setStatTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 4, backgroundColor: statTab === id ? t.bd : 'transparent' }}>
                      <Text style={{ fontFamily: MONO, fontSize: fs(10.5), fontWeight: '700', letterSpacing: 1, color: statTab === id ? t.text : t.dim }}>{id === 'off' ? 'OFFENSE' : 'DEFENSE'}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 14 }}>
                  {([[away, box.away], [home, box.home]] as const).map(([label, rows]) => (
                    <View key={label} style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '800', letterSpacing: 1, color: t.text, marginBottom: 5 }}>{label}</Text>
                      {boxTabRows(rows, statTab).length === 0 && <Text style={{ fontFamily: MONO, fontSize: fs(10), color: t.faint }}>— nothing yet —</Text>}
                      {boxTabRows(rows, statTab).map((r) => (
                        <View key={r.slug} style={{ paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: alpha(t.bd, 0.5) }}>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                            <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.pos?.[r.pos]?.fg ?? t.faint }}>{r.pos}</Text>
                            <Text numberOfLines={1} onPress={() => openPlayerCard({ slug: r.slug, name: fullName(r.slug), pos: r.pos, team: label, week })}
                              style={{ flex: 1, fontSize: fs(12.5), fontWeight: '600', color: t.text }}>{fullName(r.slug)}</Text>
                          </View>
                          <Text style={{ fontFamily: MONO, fontSize: fs(10), color: t.dimstrong }}>{r.stat}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
