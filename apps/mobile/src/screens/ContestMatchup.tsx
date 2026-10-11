// THE MATCHUP, AS CARDS — native (v0.677.0), the web's twin
// (src/screens/ContestMatchup.tsx). Your squad face up down one column, the
// other squad's card backs down the other, each turning over as its player's
// game kicks off (contest_matchup, 0479, seals him until then). Mounted
// afresh on every visit, so the turns replay. The picker walks the week's
// other matchups; the week arrows live in the league frame.
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { contestMatchup, podSalaries, type ContestMatchupState, type PodSalaryRow } from '@drip/core/data/liveApi';
import { contestSlotLabels, CONTEST_SCORE_WORD } from '@drip/core/engine/contest';
import { classicSlotsFromSpec } from '@drip/core/engine/classic';
import { useTheme } from '../theme.native';
import { tap } from '../ui/feedback';
import { Card, Chip, Mono } from '../ui/prims';
import { CardBack, CardFace, EmptyCard, FeltTable, FlipCard, CARD_H } from '../ui/ContestCards';

type Row = { slot: string; slug: string | null; sealed: boolean };
function squadRows(entry: unknown, slots: { slot: string }[]): Row[] {
  const list = Array.isArray(entry) ? entry as { slot?: unknown; player_slug?: unknown; sealed?: unknown }[] : [];
  const by = new Map<string, Row>();
  for (const r of list) if (typeof r?.slot === 'string') by.set(r.slot, { slot: r.slot, slug: typeof r.player_slug === 'string' ? r.player_slug : null, sealed: r.sealed === true });
  return slots.map((d) => by.get(d.slot) ?? { slot: d.slot, slug: null, sealed: false });
}

export function ContestMatchup({ leagueId, week }: { leagueId: string; week: number }) {
  const t = useTheme();
  const [st, setSt] = useState<ContestMatchupState | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[]>([]);
  useEffect(() => {
    let alive = true;
    const read = () => contestMatchup(leagueId, week, pick).then((r) => { if (alive) setSt(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [leagueId, week, pick]);
  useEffect(() => { podSalaries(week).then(setBoard).catch(() => setBoard([])); }, [week]);
  const bySlug = useMemo(() => new Map(board.map((r) => [r.slug, r])), [board]);
  const slots = useMemo(() => classicSlotsFromSpec(st?.slots ?? null) ?? [], [st?.slots]);
  const labels = useMemo(() => contestSlotLabels(slots), [slots]);
  if (!st) return <Card><Mono size={9} tone="faint">Loading…</Mono></Card>;
  if (!st.ok) return <Card><Mono size={10} tone="warn">{st.error}</Mono></Card>;
  const m = st.matchup;
  const word = CONTEST_SCORE_WORD[st.contest ?? 'high'];
  if (!m) return <Card><Mono size={9} tone="faint">{`No matchup for week ${st.week ?? week} yet — squads are paired once the week's board is up.`}</Mono></Card>;
  const mineHome = st.me != null && m.home === st.me;
  const mineAway = st.me != null && m.away === st.me && m.away !== m.home;
  const left = mineAway ? 'away' : 'home';
  const right = left === 'home' ? 'away' : 'home';
  const solo = m.away === m.home;
  const side = (s: 'home' | 'away') => ({
    team: s === 'home' ? m.home_team : m.away_team,
    rows: squadRows(s === 'home' ? m.home_entry : m.away_entry, slots),
    score: m.status === 'final' ? (s === 'home' ? m.home_final : m.away_final) : st.started && m.state ? (s === 'home' ? m.state.home : m.state.away) : null,
    mine: (s === 'home' && mineHome) || (s === 'away' && mineAway),
  });
  const L = side(left), R = side(right);
  const scoreOf = (s: 'home' | 'away', slot: string) => m.state?.slots?.find((x) => x.side === s && x.slot === slot)?.score ?? null;
  const column = (s: 'home' | 'away', rows: Row[], mine: boolean) => (
    <View style={{ gap: 8, alignItems: 'center' }}>
      {rows.map((r, i) => {
        const p = r.slug ? bySlug.get(r.slug) : null;
        const pts = st.started ? scoreOf(s, r.slot) : null;
        if (!r.slug && !r.sealed) return <EmptyCard key={`${s}-${r.slot}`} label={labels[r.slot] ?? r.slot} />;
        const face = r.slug ? <CardFace slug={r.slug} name={p?.name ?? r.slug} pos={p?.pos ?? 'FLEX'} team={p?.team ?? null} slot={labels[r.slot] ?? r.slot} points={pts} mine={mine} locked={!mine && !!r.slug} /> : <View />;
        // Your own cards sit face up; another squad's start on their backs and
        // turn as each player kicks off (he arrives unsealed, so the card flips).
        return <FlipCard key={`${s}-${r.slot}`} flipped={mine || !!r.slug} idx={i} back={<CardBack seed={`${m.id}|${s}|${r.slot}`} />} face={face} />;
      })}
    </View>
  );
  const fmt = (n: number | null) => (n == null ? '—' : Number(n).toFixed(1));
  const status = m.status === 'final' ? 'FINAL' : st.started ? 'LIVE' : 'LOCKS AT EACH KICKOFF';
  return (
    <View style={{ gap: 10 }}>
      {(st.matchups?.length ?? 0) > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
          {(st.matchups ?? []).map((x) => (
            <Chip key={x.id} small on={x.id === m.id} label={`${x.home === x.away ? x.home_team : `${x.home_team} v ${x.away_team}`}${x.mine ? ' · YOU' : ''}`}
              onPress={() => { tap(); setPick(x.mine ? null : x.id); }} />
          ))}
        </ScrollView>
      )}
      <Card style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Mono size={9} tone="you" weight="700" track={0.1}>{m.label ? `${m.label.toUpperCase()} · ${status}` : status}</Mono>
        <Mono size={11} tone={L.mine ? 'you' : 'text'} weight="700">{`${L.team} ${fmt(L.score)}`}</Mono>
        {!solo && <Mono size={11} tone={R.mine ? 'you' : 'text'} weight="700">{`${R.team} ${fmt(R.score)} ${word}`}</Mono>}
        {!solo && !st.started && <Mono size={8.5} tone="faint" style={{ width: '100%' }}>{`${R.mine ? 'Your' : 'Their'} cards turn face up as each player's game kicks off.`}</Mono>}
      </Card>
      <FeltTable>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 10 }}>
          {column(left, L.rows, L.mine)}
          {!solo && (
            <View style={{ width: 44, alignItems: 'center', gap: 8 }}>
              {slots.map((d) => <View key={d.slot} style={{ height: CARD_H, justifyContent: 'center' }}><Mono size={8} weight="700" track={0.08} style={{ color: 'rgba(255,255,255,0.7)' }}>{labels[d.slot] ?? d.slot}</Mono></View>)}
            </View>
          )}
          {!solo && column(right, R.rows, R.mine)}
        </View>
      </FeltTable>
      <Mono size={8.5} tone="faint" style={{ color: t.faint }}>{st.format === 'board' ? 'Every squad on the board, one at a time — pick one above.' : 'Pick another matchup above to watch it.'}</Mono>
    </View>
  );
}
