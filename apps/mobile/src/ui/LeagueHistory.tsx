// 🏛 THE LEAGUE'S HISTORY, for the thumb (0324) — the web panel's twin
// (src/screens/LeagueHistory.tsx), kept in step by hand.
//
// Three questions, in the order a league argues about them: who has won it,
// who has been the best at it, and what is the biggest thing anybody has ever
// done in it. Champions, the all-time table (champions first, because that is
// the argument), the record book, and last a season picker for the detail
// nobody needs until they do.
//
// The server decides what counts — regular-season finals for records, playoff
// weeks for single-week scores, preseason nowhere. This only draws it.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Text } from 'react-native';
import { leagueHistory, type LeagueHistory as History, type HistorySeason } from '@drip/core/data/liveApi';
import { useTheme, fs } from '../theme.native';
import { tap } from './feedback';
import { Chip, Mono } from './prims';

const pts = (n: number) => Math.round(n * 10) / 10;

export function LeagueHistoryView({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [h, setH] = useState<History | null>(null);
  const [season, setSeason] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    leagueHistory(leagueId).then((r) => { if (on) setH(r); }).catch(() => { if (on) setH({ error: 'could not load' }); });
    return () => { on = false; };
  }, [leagueId]);

  if (!h) return <Mono size={10} tone="faint" style={{ padding: 20, textAlign: 'center' }}>Loading…</Mono>;
  if (h.error || !h.ok) {
    return <Mono size={10} tone="opp" style={{ padding: 20, textAlign: 'center' }}>{h.error ?? 'No history yet.'}</Mono>;
  }

  const seasons = h.seasons ?? [];
  const champs = seasons.filter((s) => s.champion);
  const recs = h.records;
  const shown: HistorySeason | undefined = seasons.find((s) => s.season === season) ?? seasons[0];
  const anyGames = seasons.some((s) => (s.table ?? []).length > 0);

  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd };

  const Records = ({ title, rows }: { title: string; rows: { key: string; left: string; right: string; sub: string }[] }) => {
    if (rows.length === 0) return null;
    return (
      <View style={{ marginTop: 10 }}>
        <Mono size={7.5} tone="faint" track={0.1}>{title}</Mono>
        {rows.map((r) => (
          <View key={r.key} style={row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: fs(11.5), color: t.text }}>{r.left}</Text>
              <Mono size={8.5} tone="faint">{r.sub}</Mono>
            </View>
            <Mono size={11.5} tone="you" weight="700">{r.right}</Mono>
          </View>
        ))}
      </View>
    );
  };

  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30, gap: 14 }}>
      {/* ── THE CHAMPIONS ── */}
      <View>
        <Mono size={9} tone="faint" track={0.12}>🏆 CHAMPIONS</Mono>
        {champs.length === 0 && (
          <Mono size={10} tone="faint" style={{ marginTop: 6, lineHeight: fs(15) }}>
            No champion yet — the first one is written the week your playoffs end.
          </Mono>
        )}
        {champs.map((s) => (
          <View key={s.league_id} style={row}>
            <Mono size={10.5} tone="warn" weight="700" style={{ width: 44 }}>{s.season}</Mono>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12), fontWeight: '700', color: t.text }}>
              🏆 {s.champion?.team ?? `Team ${s.champion?.roster_id}`}
            </Text>
            {s.runner_up && <Mono size={8.5} tone="faint">beat {s.runner_up.team ?? `Team ${s.runner_up.roster_id}`}</Mono>}
          </View>
        ))}
      </View>

      {/* ── ALL-TIME ── */}
      {(h.managers ?? []).length > 0 && anyGames && (
        <View>
          <Mono size={9} tone="faint" track={0.12}>👑 ALL-TIME</Mono>
          <View style={{ flexDirection: 'row', gap: 8, paddingTop: 6, paddingBottom: 2 }}>
            <Mono size={7.5} tone="faint" track={0.1} style={{ flex: 1 }}>MANAGER</Mono>
            <Mono size={7.5} tone="faint" track={0.1} style={{ width: 52, textAlign: 'right' }}>RECORD</Mono>
            <Mono size={7.5} tone="faint" track={0.1} style={{ width: 52, textAlign: 'right' }}>POINTS</Mono>
            <Mono size={7.5} tone="faint" track={0.1} style={{ width: 40, textAlign: 'right' }}>TITLES</Mono>
          </View>
          {(h.managers ?? []).map((m) => (
            <View key={m.manager} style={row}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11.5), color: t.text }}>{m.team ?? m.manager}</Text>
              <Mono size={10.5} weight="700" style={{ width: 52, textAlign: 'right' }}>{m.w}-{m.l}{m.t ? `-${m.t}` : ''}</Mono>
              <Mono size={10} tone="dim" style={{ width: 52, textAlign: 'right' }}>{pts(m.pf)}</Mono>
              <Mono size={10.5} tone={m.titles > 0 ? 'warn' : 'faint'} weight="700" style={{ width: 40, textAlign: 'right' }}>
                {m.titles > 0 ? `🏆${m.titles > 1 ? `×${m.titles}` : ''}` : '—'}
              </Mono>
            </View>
          ))}
        </View>
      )}

      {/* ── THE RECORD BOOK ── */}
      {recs && anyGames && (
        <View>
          <Mono size={9} tone="faint" track={0.12}>📖 THE RECORD BOOK</Mono>
          <Records title="BIGGEST WEEKS" rows={(recs.top_weeks ?? []).slice(0, 5).map((r) => ({
            key: `${r.season}-${r.week}-${r.roster_id}`,
            left: r.team ?? `Team ${r.roster_id}`,
            right: `${pts(r.points)}`,
            sub: `${r.season} wk ${r.week}${r.playoff ? ' · playoff' : ''}${r.opp ? ` vs ${r.opp}` : ''}`,
          }))} />
          <Records title="BIGGEST BEATINGS" rows={(recs.blowouts ?? []).slice(0, 3).map((r, i) => ({
            key: `b${i}`, left: `${r.winner} over ${r.loser}`, right: `+${pts(r.margin)}`,
            sub: `${r.season} wk ${r.week} · ${r.score}`,
          }))} />
          <Records title="CLOSEST CALLS" rows={(recs.nailbiters ?? []).slice(0, 3).map((r, i) => ({
            key: `n${i}`, left: `${r.winner} over ${r.loser}`, right: `${pts(r.margin)}`,
            sub: `${r.season} wk ${r.week} · ${r.score}`,
          }))} />
          <Records title="BEST SEASONS (POINTS)" rows={(recs.top_seasons ?? []).slice(0, 3).map((r, i) => ({
            key: `s${i}`, left: r.team ?? `Team ${r.roster_id}`, right: `${pts(r.pf)}`,
            sub: `${r.season} · ${r.record}`,
          }))} />
          <Records title="BEST RECORDS" rows={(recs.best_records ?? []).slice(0, 3).map((r, i) => ({
            key: `r${i}`, left: r.team ?? `Team ${r.roster_id}`, right: r.record,
            sub: `${r.season} · ${pts(r.pf)} points`,
          }))} />
          <Records title="QUIETEST WEEKS" rows={(recs.low_weeks ?? []).slice(0, 3).map((r, i) => ({
            key: `l${i}`, left: r.team ?? `Team ${r.roster_id}`, right: `${pts(r.points)}`,
            sub: `${r.season} wk ${r.week}`,
          }))} />
        </View>
      )}

      {/* ── SEASON BY SEASON ── */}
      {anyGames && shown && (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint" track={0.12}>🗓 SEASON</Mono>
            <View style={{ flex: 1 }} />
            {seasons.map((s) => (
              <Chip key={s.league_id} label={s.season} on={shown.season === s.season}
                onPress={() => { tap(); setSeason(s.season); }} />
            ))}
          </View>
          {shown.champion && (
            <Mono size={9.5} tone="warn" style={{ marginTop: 6 }}>
              🏆 {shown.champion.team ?? `Team ${shown.champion.roster_id}`}
              {shown.runner_up ? ` · runner-up ${shown.runner_up.team ?? `Team ${shown.runner_up.roster_id}`}` : ''}
            </Mono>
          )}
          {shown.high_week && (
            <Mono size={8.5} tone="faint" style={{ marginTop: 2 }}>
              High week: {shown.high_week.team ?? `Team ${shown.high_week.roster_id}`} · {pts(shown.high_week.points)} in wk {shown.high_week.week}
            </Mono>
          )}
          {(shown.table ?? []).map((r, i) => (
            <View key={r.roster_id} style={row}>
              <Mono size={9.5} tone="faint" style={{ width: 16 }}>{i + 1}</Mono>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11.5), color: t.text }}>{r.team ?? `Team ${r.roster_id}`}</Text>
              <Mono size={10.5} weight="700" style={{ width: 52, textAlign: 'right' }}>{r.w}-{r.l}{r.t ? `-${r.t}` : ''}</Mono>
              <Mono size={9.5} tone="faint" style={{ width: 56, textAlign: 'right' }}>{pts(r.pf)} PF</Mono>
            </View>
          ))}
        </View>
      )}

      {!anyGames && (
        <Mono size={10} tone="faint" style={{ textAlign: 'center', lineHeight: fs(16) }}>
          The record book fills itself as weeks go final — come back after your first Sunday.
        </Mono>
      )}
    </ScrollView>
  );
}
