// THE MATCHUP, AS CARDS — native (v0.677.0), the web's twin
// (src/screens/ContestMatchup.tsx). Your squad face up down one column, the
// other squad's card backs down the other, each turning over as its player's
// game kicks off (contest_matchup, 0479, seals him until then). Mounted
// afresh on every visit, so the turns replay. The picker walks the week's
// other matchups; the week arrows live in the league frame.
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { contestMatchup, podSalaries, weekSlateByTeam, type ContestMatchupState, type PodSalaryRow, type SlateSpot } from '@drip/core/data/liveApi';
import { contestSlotLabels, contestCard, contestTiebreak, CONTEST_SCORE_WORD } from '@drip/core/engine/contest';
import { leagueWeekProj } from '@drip/core/engine/contestBuilder';
import { classicSlotsFromSpec, type ClassicScoring } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { useTheme, MONO, fs, alpha } from '../theme.native';
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
  const [slate, setSlate] = useState<Map<string, SlateSpot>>(new Map());
  useEffect(() => { podSalaries(week).then(setBoard).catch(() => setBoard([])); weekSlateByTeam(week).then(setSlate).catch(() => {}); }, [week]);
  const bySlug = useMemo(() => new Map(board.map((r) => [r.slug, r])), [board]);
  const slots = useMemo(() => classicSlotsFromSpec(st?.slots ?? null) ?? [], [st?.slots]);
  const labels = useMemo(() => contestSlotLabels(slots), [slots]);
  // PROJECTIONS (v0.678.0): priced by the league's own scoring, as the builder prices them.
  const catalog = useMemo(() => leagueCatalogOf({ scoring: (st?.scoring_classic ?? null) as Partial<ClassicScoring> | null, ppr: st?.ppr ?? null }), [st?.scoring_classic, st?.ppr]);
  const projOf = (slug: string): number | null => { const r = bySlug.get(slug); return r ? leagueWeekProj(r, catalog, r.pos === 'HC' ? (slate.size ? slate.get(r.team) ?? null : undefined) : undefined) : null; };
  const bull = st?.contest === 'bullseye';
  const theCard = useMemo(() => (st?.contest === 'bullseye' && st.week != null && slots.length ? contestCard(leagueId, st.week, slots, catalog) : null), [leagueId, st?.contest, st?.week, slots, catalog]);
  const isTotal = bull && st?.variant === 'total';
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
  // THE TIE-BREAKER SPOT (v0.681.0, founder: "the spot-specific tie breaker
  // target chip on the player spots in the matchup as well"): each squad's own
  // ⚖️ spot and target, dealt per seat as the builder shows it.
  const tbs = {
    home: theCard ? contestTiebreak(leagueId, st.week ?? week, m.home, theCard, slots) : null,
    away: theCard ? contestTiebreak(leagueId, st.week ?? week, m.away, theCard, slots) : null,
  };
  // One card for a spot: yours sits face up; another squad's starts on its
  // back and turns as its player kicks off (he arrives unsealed, so it flips).
  const cardOf = (s: 'home' | 'away', r: Row, mine: boolean, i: number) => {
    const p = r.slug ? bySlug.get(r.slug) : null;
    if (!r.slug && !r.sealed) return <EmptyCard key={`${s}-${r.slot}`} label={labels[r.slot] ?? r.slot} />;
    const face = r.slug ? <CardFace slug={r.slug} name={p?.name ?? r.slug} pos={p?.pos ?? 'FLEX'} team={p?.team ?? null} slot={labels[r.slot] ?? r.slot} mine={mine} locked={!mine && !!r.slug} /> : <View />;
    return <FlipCard key={`${s}-${r.slot}`} flipped={mine || !!r.slug} idx={i} back={<CardBack seed={`${m.id}|${s}|${r.slot}`} />} face={face} />;
  };
  // THE NUMBERS (v0.678.0, founder: "the player score and projection to the
  // inside of the card columns in larger numbers"): the spot, the score once
  // his game is on, the projection under it; a Bullseye spot's target and how
  // far off. A sealed pick shows nothing — a projection would give him away.
  const numbersOf = (s: 'home' | 'away', r: Row, mine: boolean, edge: 'left' | 'right') => {
    const score = st.started && r.slug ? scoreOf(s, r.slot) : null;
    const proj = r.slug ? projOf(r.slug) : null;
    const target = bull && !isTotal ? theCard?.targets[r.slot] ?? null : null;
    const tb = tbs[s]?.slot === r.slot ? tbs[s] : null;
    const color = mine ? t.you : t.opp;
    const align = edge === 'left' ? 'flex-start' : 'flex-end';
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: align, paddingLeft: edge === 'left' ? 8 : 4, paddingRight: edge === 'right' ? 8 : 4, minWidth: 0 }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', letterSpacing: 0.8, color: alpha(t.text, 65) }}>{`${labels[r.slot] ?? r.slot}${target != null ? ` · 🎯 ${target}` : ''}${tb ? ` · ⚖️ ${tb.target}` : ''}`}</Text>
        <Text style={{ fontFamily: MONO, fontSize: fs(26), fontWeight: '800', color: score != null ? color : alpha(t.text, 35) }}>{score != null ? score.toFixed(1) : r.sealed ? '◈' : '—'}</Text>
        <Text style={{ fontFamily: MONO, fontSize: fs(9.5), color: alpha(t.text, 65) }}>{`${proj != null && !r.sealed ? `proj ${proj.toFixed(1)}` : ''}${target != null && score != null ? ` · ${Math.abs(score - target).toFixed(1)} off` : ''}${tb && score != null ? ` · ⚖️ ${Math.abs(score - tb.target).toFixed(1)} off` : ''}`}</Text>
      </View>
    );
  };
  const fmt = (n: number | null) => (n == null ? '—' : Number(n).toFixed(1));
  // THE SCOREBOARD (v0.680.1): a side's points so far and where they project
  // to land, and for Bullseye the ring — how far off the target — with the
  // projected ring beside it. A sealed pick leaves the projection blank: his
  // number would give him away. Mirrors the web (src/screens/ContestMatchup.tsx).
  const tally = (s: 'home' | 'away', S: typeof L) => {
    let pts = 0, proj = 0, ringProj = 0, known = true;
    for (const r of S.rows) {
      const score = st.started && r.slug ? scoreOf(s, r.slot) : null;
      if (score != null) pts += score;
      if (r.sealed) { known = false; continue; }
      const v = score ?? (r.slug ? projOf(r.slug) : null) ?? 0;
      proj += v;
      if (bull && !isTotal) { const tg = theCard?.targets[r.slot]; if (tg != null) ringProj += Math.abs(v - tg); }
    }
    const points = !bull ? S.score : st.started ? pts : null;
    const projected = known ? proj : null;
    const ringProjected = !bull || !known ? null : isTotal ? (theCard ? Math.abs(proj - theCard.total) : null) : ringProj;
    return { points, projected, ring: bull ? S.score : null, ringProjected };
  };
  const scoreboard = (s: 'home' | 'away', S: typeof L, edge: 'left' | 'right') => {
    const x = tally(s, S);
    const color = S.mine ? t.you : t.opp;
    const dim = alpha(t.text, 65);
    return (
      <View style={{ flex: 1, minWidth: 0, gap: 2, alignItems: edge === 'left' ? 'flex-start' : 'flex-end' }}>
        <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 1, color: S.mine ? t.you : alpha(t.text, 80) }}>{`${S.team.toUpperCase()}${S.mine ? ' · YOU' : ''}`}</Text>
        {/* the cells stack (v0.680.2): side by side, two sides' labels met in the middle of a phone */}
        <View style={{ alignItems: edge === 'left' ? 'flex-start' : 'flex-end', maxWidth: '100%' }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(26), fontWeight: '800', lineHeight: fs(28), color: x.points != null ? color : alpha(t.text, 35) }}>{fmt(x.points)}</Text>
          <Text numberOfLines={2} style={{ fontFamily: MONO, fontSize: fs(9), color: dim, textAlign: edge }}>{`${bull ? 'PTS' : word.toUpperCase()}${x.projected != null ? ` · proj ${x.projected.toFixed(1)}` : ''}`}</Text>
        </View>
        {bull && (
          <View style={{ alignItems: edge === 'left' ? 'flex-start' : 'flex-end', maxWidth: '100%', marginTop: 4 }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(26), fontWeight: '800', lineHeight: fs(28), color: x.ring != null ? t.text : alpha(t.text, 35) }}>{fmt(x.ring)}</Text>
            <Text numberOfLines={2} style={{ fontFamily: MONO, fontSize: fs(9), color: dim, textAlign: edge }}>{`OFF 🎯 ${isTotal && theCard ? theCard.total : 'PER SPOT'}${x.ringProjected != null ? ` · proj ${x.ringProjected.toFixed(1)} off` : ''}`}</Text>
          </View>
        )}
      </View>
    );
  };
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
        {!solo && <Mono size={9} tone="faint">{`${L.team} v ${R.team}`}</Mono>}
        {!solo && !st.started && <Mono size={8.5} tone="faint" style={{ width: '100%' }}>{`${R.mine ? 'Your' : 'Their'} cards turn face up as each player's game kicks off.`}</Mono>}
      </Card>
      <FeltTable>
        {/* the scoreboard: each side's points and projection, and for Bullseye how far off the target (v0.680.1) */}
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 4, paddingBottom: 10, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: alpha(t.text, 12) }}>
          {scoreboard(left, L, 'left')}
          {!solo && scoreboard(right, R, 'right')}
        </View>
        {/* a row per spot: your card at the outer edge, the numbers inside, theirs, their card at the far edge */}
        <View style={{ gap: 8 }}>
          {slots.map((d, i) => {
            const lr = L.rows[i], rr = R.rows[i];
            return (
              <View key={d.slot} style={{ flexDirection: 'row', alignItems: 'center', minHeight: CARD_H }}>
                {cardOf(left, lr, L.mine, i)}
                {numbersOf(left, lr, L.mine, 'left')}
                {!solo && numbersOf(right, rr, R.mine, 'right')}
                {!solo && cardOf(right, rr, R.mine, i)}
              </View>
            );
          })}
        </View>
      </FeltTable>
      <Mono size={8.5} tone="faint" style={{ color: t.faint }}>{st.format === 'board' ? 'Every squad on the board, one at a time — pick one above.' : 'Pick another matchup above to watch it.'}</Mono>
    </View>
  );
}
