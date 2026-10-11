// CONTEST LEAGUES, native (v0.661.0 as Bullseye; v0.664.0 any contest) — the
// web twin's note (src/screens/BullseyeLeague.tsx) and docs/dfs-bullseye.md
// §9, §13. A contest league — HIGHEST SCORE, GOLF or BULLSEYE, head-to-head
// or leaderboard — opens into the rooms every league has, on the app's own
// room bar: MATCHUP (this week's squad and numbers), LEAGUE (who's in, the
// week, the season), MY TEAM (my weeks, my name), CHAT (league chat, as
// everywhere), and behind ⚙ SETTINGS the rules and leaving. Its commissioner
// gets the classic commissioner's console (CommishTools, trimmed) with the
// CONTEST card.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import {
  contestLeague, contestBoard, contestBoardFind, bullseyeMyWeeks, createContestLeague, joinContest, contestState,
  setTeamName, leaveLeague, postLeagueListing,
  isAdmin, myFeatures, bullseyeMaxSeats, contestLeagueLine, contestMoneyWord, recordWord, friendlyError,
  type BullseyeLeague, type BullseyeLeagueBoard, type BullseyeBoardRow, type BullseyeSeasonRow, type ContestMyWeek, type ContestInfo, type ContestKind, type ContestFormat, type DfsVariant, type BullseyeSpan,
} from '@drip/core/data/liveApi';
import { contestCard, contestTiebreak, CONTEST_WORD, CONTEST_FORMAT_WORD, CONTEST_EMOJI, CONTEST_BUDGET_DEFAULT, CONTEST_MIN_SPEND_DEFAULT, contestCredit } from '@drip/core/engine/contest';
import { SITE_ORIGIN } from '@drip/core/data/invite';
import { useTheme } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, Mono } from '../ui/prims';
import { Playoffs } from '../ui/LeagueExtras';
import { ContestSquad, contestSetupOf } from './ContestSquad';
import { ContestMatchup } from './ContestMatchup';
import { CONTEST_BUDGETS, CONTEST_MIN_SPENDS, moneyChip } from './ContestCommish';

export type BullseyeRoom = 'matchup' | 'league' | 'team' | 'settings' | 'commish';
type ContestLeague = BullseyeLeague & { kind?: string; bullseye?: ContestInfo };
const n0 = (n: number) => n.toLocaleString('en-US');
/** contest_board's default page; a board this long is one worth searching (0473). */
const BOARD_LIMIT = 100;
const CONTEST_BLURB: Record<ContestKind, string> = {
  high: 'Each week everyone builds a squad under the budget from the week’s salary board. Most points wins.',
  golf: 'Each week everyone builds a squad that spends at least the minimum. FEWEST points wins — but a scoreless spot banks a penalty, so no-shows are no bargain.',
  bullseye: 'Each week everyone builds a squad aimed at the week’s numbers. Closest wins.',
};

function Field(props: React.ComponentProps<typeof TextInput>) {
  const t = useTheme();
  return <TextInput placeholderTextColor={t.faint} {...props}
    style={[{ color: t.text, borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: t.bg }, props.style]} />;
}
const useCap = () => {
  const [cap, setCap] = useState(32);
  useEffect(() => {
    Promise.all([isAdmin().catch(() => false), myFeatures().catch(() => ({} as Record<string, boolean>))])
      .then(([a, f]) => setCap(bullseyeMaxSeats(!!a, f))).catch(() => {});
  }, []);
  return cap;
};

// ── start: make one, or join one ───────────────────────────────────────────
export function BullseyeStart({ onOpen, onBack }: { onOpen: (leagueId: string, name: string, rosterId: number) => void; onBack: () => void }) {
  const t = useTheme();
  const cap = useCap();
  const [name, setName] = useState('');
  const [contest, setContest] = useState<ContestKind>('high');
  const [format, setFormat] = useState<ContestFormat>('h2h');
  const [span, setSpan] = useState<BullseyeSpan>('season');
  const [variant, setVariant] = useState<DfsVariant>('slots');
  const [budget, setBudget] = useState(CONTEST_BUDGET_DEFAULT);
  const [minSpend, setMinSpend] = useState(0);
  // GOLF'S MONEY (v0.668.0): no cap, a minimum spend; the others cap and no floor.
  const pickContest = (c: ContestKind) => {
    setContest(c);
    if (c === 'golf') { setBudget(0); setMinSpend(CONTEST_MIN_SPEND_DEFAULT); } else { setBudget((b) => (b || CONTEST_BUDGET_DEFAULT)); setMinSpend(0); }
  };
  const [max, setMax] = useState('12');
  const [team, setTeam] = useState('');
  const [list, setList] = useState(true);
  const [blurb, setBlurb] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const top = format === 'h2h' ? 32 : cap;
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      let n = Math.max(2, Math.min(top, Number(max) || 0));
      if (format === 'h2h') n -= n % 2;
      const r = await createContestLeague({ name, contest, format, span, max: n, budget, minSpend, variant, teamName: team || null });
      if (!r.ok || !r.league_id) { warn(); setErr(r.error ?? 'Couldn’t make it.'); return; }
      if (list) await postLeagueListing(r.league_id, blurb.trim() || null, null).catch(() => {});
      commit(); onOpen(r.league_id, r.name ?? 'Contest', r.roster_id ?? 1);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const join = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await joinContest(code, team || null);
      if (!r.ok || !r.league_id) { warn(); setErr(r.error ?? 'Couldn’t join.'); return; }
      commit(); onOpen(r.league_id, r.league ?? 'Contest', r.roster_id ?? 0);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Chip label="← BACK" onPress={() => { tap(); onBack(); }} />
        <Mono size={11} tone="you" weight="700" track={0.1}>{`${CONTEST_EMOJI[contest]} WEEKLY SQUAD LEAGUE`}</Mono>
      </View>
      <Text style={{ fontSize: 13, color: t.dim, lineHeight: 19 }}>{`${CONTEST_BLURB[contest]} You run it: who’s in, the roster, the scoring, the budget, and whether it’s on the board.`}</Text>
      {contestCredit(contest) && <CreditChip contest={contest} />}
      <Card style={{ gap: 10 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>START ONE</Mono>
        <Field value={name} onChangeText={setName} maxLength={60} placeholder="League name" />
        <Mono size={9} tone="faint">WINS BY</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(['high', 'golf', 'bullseye'] as const).map((c) => (
            <Chip key={c} small label={`${CONTEST_EMOJI[c]} ${CONTEST_WORD[c]}`} on={contest === c} onPress={() => { tap(); pickContest(c); }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Mono size={9} tone="faint">PLAYS</Mono>
          <Chip small label="HEAD-TO-HEAD" on={format === 'h2h'} onPress={() => { tap(); setFormat('h2h'); setMax((m) => String(Math.min(32, Number(m) || 12))); }} />
          <Chip small label="LEADERBOARD" on={format === 'board'} onPress={() => { tap(); setFormat('board'); }} />
        </View>
        <Mono size={8.5} tone="faint">{format === 'h2h' ? 'Paired each week — wins and losses. Empty seats play as the CPU until someone takes them.' : 'Everyone ranked each week.'}</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Mono size={9} tone="faint">RUNS</Mono>
          <Chip small label="ALL SEASON" on={span === 'season'} onPress={() => { tap(); setSpan('season'); }} />
          <Chip small label="THIS WEEK ONLY" on={span === 'week'} onPress={() => { tap(); setSpan('week'); }} />
        </View>
        {contest === 'bullseye' && (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Mono size={9} tone="faint">CARD</Mono>
            <Chip small label="SLOT TARGETS" on={variant === 'slots'} onPress={() => { tap(); setVariant('slots'); }} />
            <Chip small label="ONE TEAM TOTAL" on={variant === 'total'} onPress={() => { tap(); setVariant('total'); }} />
          </View>
        )}
        <Mono size={9} tone="faint">BUDGET PER SQUAD</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {CONTEST_BUDGETS.map((v) => <Chip key={v} small label={moneyChip(v, 'NO CAP')} on={budget === v} onPress={() => { tap(); setBudget(v); }} />)}
        </View>
        {contest === 'golf' && (
          <>
            <Mono size={9} tone="faint">MIN SPEND</Mono>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {CONTEST_MIN_SPENDS.map((v) => <Chip key={v} small label={moneyChip(v, 'NONE')} on={minSpend === v} onPress={() => { tap(); setMinSpend(v); }} />)}
            </View>
            <Mono size={8.5} tone="faint">Golf’s real constraint: you must roster expensive players and bet on which stars have a quiet week.</Mono>
          </>
        )}
        <Mono size={8.5} tone="faint">The default nine spots (QB, 2 RB, 3 WR, TE, K, D/ST) — change the roster in COMMISH.</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Mono size={9} tone="faint">{format === 'h2h' ? 'TEAMS (even, 2–32)' : `UP TO (2–${n0(cap)})`}</Mono>
          <Field value={max} onChangeText={(v) => setMax(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 90 }} />
        </View>
        <Field value={team} onChangeText={setTeam} maxLength={30} placeholder="Your team name (optional)" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Switch value={list} onValueChange={setList} />
          <Mono size={9} tone="dim" style={{ flex: 1 }}>POST IT ON THE LEAGUE BOARD SO ANYONE CAN FIND IT</Mono>
        </View>
        {list && <Field value={blurb} onChangeText={setBlurb} maxLength={200} placeholder="Board blurb (optional)" />}
        <Chip on disabled={busy} label={busy ? 'MAKING IT…' : 'START THE LEAGUE →'} onPress={() => { tap(); void create(); }} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>HAVE A CODE?</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" placeholder="ABCD1234" style={{ flex: 1 }} />
          <Chip on disabled={busy || code.trim().length < 4} label="JOIN" onPress={() => { tap(); void join(); }} />
        </View>
        <Mono size={9} tone="faint">Or find one on the league board.</Mono>
      </Card>
      {err && <Mono size={10} tone="warn">{err}</Mono>}
    </ScrollView>
  );
}

// ── the league's rooms ─────────────────────────────────────────────────────
export function BullseyeLeagueRoom({ leagueId, room, onRoom, onBack, onGone }: {
  leagueId: string; room: BullseyeRoom; onRoom: (r: BullseyeRoom) => void; onBack: () => void;
  /** Left or deleted: back to the leagues list. */
  onGone: () => void;
}) {
  const t = useTheme();
  const [lg, setLg] = useState<ContestLeague | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const load = useCallback(() => contestLeague(leagueId).then((r) => { setLg(r); if (r.ok && r.week != null) setWeek((w) => w ?? r.week!); return r; }), [leagueId]);
  useEffect(() => { void load().catch(() => {}); }, [load]);
  // Each arrival at the matchup room is a new deal (the flips replay).
  const [visit, setVisit] = useState(0);
  useEffect(() => { if (room === 'matchup') setVisit((v) => v + 1); }, [room]);
  if (!lg) return <View style={{ flex: 1, backgroundColor: t.bg }}><Mono size={10} tone="faint" style={{ padding: 16 }}>Loading…</Mono></View>;
  if (!lg.ok || !lg.bullseye) return <View style={{ flex: 1, backgroundColor: t.bg }}><Mono size={10} tone="warn" style={{ padding: 16 }}>{lg.error ?? 'Couldn’t open the league.'}</Mono></View>;
  const weeks = [...new Set([...(lg.weeks ?? []), ...(lg.week != null ? [lg.week] : [])])].sort((x, y) => x - y);

  if (room === 'team' && lg.me) {
    // MY TEAM is where the weekly squad is built (v0.677.0, founder: "make
    // my team the place where you select your weekly team"); the name and
    // MY WEEKS ride under the builder.
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <WeekArrows weeks={weeks} week={week} current={lg.week ?? null} onWeek={setWeek} />
        {week != null && <ContestSquad key={week} leagueId={leagueId} week={week} onBack={() => onRoom('league')}
          after={<TeamRoom lg={lg} onOpenWeek={(w) => { setWeek(w); onRoom('matchup'); }} onRenamed={() => void load()} />} />}
      </View>
    );
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 90 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void load(); }} />}>
      <Mono size={9} tone="dim">{contestLeagueLine(lg.bullseye)}</Mono>
      {room === 'matchup' && lg.me && week != null ? (
        // THE CARD TABLE (v0.677.0): the week's matchup as two columns of
        // cards, remounted on every visit so the reveal flips play again.
        <>
          <WeekArrows weeks={weeks} week={week} current={lg.week ?? null} onWeek={setWeek} />
          <ContestMatchup key={`${week}-${visit}`} leagueId={leagueId} week={week} />
        </>
      ) : room === 'settings' ? <SettingsRoom lg={lg} onCommish={() => onRoom('commish')} onLeft={onGone} />
        : <LeagueRoom lg={lg} weeks={weeks} week={week} onWeek={setWeek} onCommish={() => onRoom('commish')} onBack={onBack} />}
    </ScrollView>
  );
}

// ── CREDIT WHERE IT'S DUE: the chip opens the line ─────────────────────────
// A TINY "i" (founder: "just a tiny i chip"): an 18pt ring that opens the line.
function CreditChip({ contest }: { contest: ContestKind }) {
  const t = useTheme();
  const credit = contestCredit(contest);
  if (!credit) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={credit.title} hitSlop={8} onPress={() => { tap(); Alert.alert(credit.title, credit.line); }}
      style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: t.bd, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      <Text style={{ fontSize: 10, fontWeight: '700', fontStyle: 'italic', color: t.faint, lineHeight: 12 }}>{credit.chip}</Text>
    </Pressable>
  );
}

function WeekArrows({ weeks, week, current, onWeek }: { weeks: number[]; week: number | null; current: number | null; onWeek: (w: number) => void }) {
  if (week == null || weeks.length < 2) return null;
  const i = weeks.indexOf(week);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 8 }}>
      <Chip small dim={i <= 0} disabled={i <= 0} label="◀" onPress={() => { tap(); onWeek(weeks[i - 1]); }} />
      <Mono size={11} weight="700" tone="text">{`WEEK ${week}${week === current ? ' · THIS WEEK' : ''}`}</Mono>
      <Chip small dim={i < 0 || i >= weeks.length - 1} disabled={i < 0 || i >= weeks.length - 1} label="▶" onPress={() => { tap(); onWeek(weeks[i + 1]); }} />
    </View>
  );
}

function LeagueRoom({ lg, weeks, week, onWeek, onCommish, onBack }: { lg: ContestLeague; weeks: number[]; week: number | null; onWeek: (w: number) => void; onCommish: () => void; onBack: () => void }) {
  const t = useTheme();
  const [bd, setBd] = useState<BullseyeLeagueBoard | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => contestBoard(lg.league_id!, week).then((r) => { if (alive) setBd(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [lg.league_id, week]);
  const b = lg.bullseye!;
  const bull = b.contest === 'bullseye';
  const h2h = b.format === 'h2h';
  // WHERE AM I (0473): a board bigger than the rows it shows gets a team
  // search, and my own stretch of the table when I'm off the top.
  const big = (bd?.rows?.length ?? 0) >= BOARD_LIMIT || (bd?.season?.rows.length ?? 0) >= BOARD_LIMIT;
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ q: string; found: BullseyeBoardRow[]; season: BullseyeSeasonRow[] } | null>(null);
  useEffect(() => {
    const want = q.trim();
    if (!want) { setHits(null); return; }
    let alive = true;
    const id = setTimeout(() => {
      contestBoardFind(lg.league_id!, week, want).then((r) => { if (alive && r.ok) setHits({ q: want, found: r.found, season: r.season }); }).catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(id); };
  }, [q, lg.league_id, week]);
  const weekRow = (r: BullseyeBoardRow) => (
    <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.bd }}>
      <Mono size={10} tone={r.me ? 'you' : 'dim'} style={{ width: 30 }}>{String(r.rank)}</Mono>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: r.me ? t.you : t.text, fontWeight: r.me ? '700' : '400' }}>{r.team_name ?? `Team ${r.roster_id}`}</Text>
      {bull && <Mono size={9} tone="faint">{`${Number(r.points).toFixed(1)} pts`}</Mono>}
      <Mono size={11} weight="700" tone={r.me ? 'you' : 'text'} style={{ width: 52, textAlign: 'right' }}>{Number(r.ring).toFixed(1)}</Mono>
    </View>
  );
  const seasonRow = (r: BullseyeSeasonRow) => (
    <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.bd }}>
      <Mono size={10} tone={r.me ? 'you' : 'dim'} style={{ width: 30 }}>{String(r.rank)}</Mono>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: r.me ? t.you : t.text, fontWeight: r.me ? '700' : '400' }}>{r.team_name ?? `Team ${r.roster_id}`}</Text>
      <Mono size={9} tone="faint">{h2h ? `${r.weeks} wk${r.weeks === 1 ? '' : 's'} · ${Number(r.total).toFixed(1)}` : `${r.weeks} wk${r.weeks === 1 ? '' : 's'}`}</Mono>
      <Mono size={11} weight="700" tone={r.me ? 'you' : 'text'} style={{ width: 60, textAlign: 'right' }}>{h2h ? recordWord(r) : Number(r.total).toFixed(1)}</Mono>
    </View>
  );
  const gap = (rank: number) => <Mono size={9} tone="faint" style={{ marginTop: 6 }}>{`⋯ you, at #${n0(rank)}`}</Mono>;
  const share = async () => {
    if (!lg.invite_code) return;
    try { await Share.share({ message: `Join my league "${lg.name}" on Drip Fantasy: ${SITE_ORIGIN}/?bullseye=${lg.invite_code}\nCode: ${lg.invite_code}` }); } catch { /* ignore */ }
  };
  return (
    <>
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Display size={22} tone="you">{n0(b.seats_taken)}</Display>
          <Mono size={9} tone="faint">{`of ${n0(b.max_seats)} in · ${b.span === 'week' ? `week ${b.week} only` : 'all season'}`}</Mono>
          {lg.listed && <Mono size={9} tone="you">ON THE BOARD</Mono>}
        </View>
        {lg.invite_code && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Mono size={9} tone="faint">CODE</Mono>
            <Mono size={13} weight="700" track={0.12} tone="text" style={{ flex: 1 }}>{lg.invite_code}</Mono>
            <Chip small label="INVITE" onPress={() => { tap(); void share(); }} />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {lg.commish && <Chip small label="⚑ COMMISSIONER" onPress={() => { tap(); onCommish(); }} />}
          <Chip small dim label="← MY LEAGUES" onPress={() => { tap(); onBack(); }} />
        </View>
        {bull && <CreditChip contest={b.contest} />}
      </Card>
      <WeekArrows weeks={weeks} week={week} current={lg.week ?? null} onWeek={onWeek} />
      <Card style={{ gap: 2 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>{`WEEK ${bd?.week ?? week ?? ''} · ${bd?.entries ?? 0} ${bd?.entries === 1 ? 'SQUAD' : 'SQUADS'}${b.format === 'h2h' ? ' · HEAD-TO-HEAD' : ''}${bd?.void ? ' · VOIDED' : ''}`}</Mono>
        {bd && !bd.started && <Mono size={9} tone="faint">Squads and scores show once the week’s first game locks.</Mono>}
        {bd?.void && <Mono size={9} tone="warn">The commissioner voided this week — it doesn’t count in the standings.</Mono>}
        {big && <Field value={q} onChangeText={setQ} maxLength={30} placeholder="Find a team…" autoCorrect={false} style={{ marginTop: 4, marginBottom: 4 }} />}
        {hits && (
          <>
            <Mono size={9} tone="faint" style={{ marginTop: 4 }}>{hits.found.length ? `FOUND “${hits.q}” · THIS WEEK` : `No squad named “${hits.q}” this week.`}</Mono>
            {hits.found.map(weekRow)}
          </>
        )}
        {(bd?.rows ?? []).map(weekRow)}
        {bd?.me && !(bd.rows ?? []).some((r) => r.me) && (
          (bd.near?.length ?? 0) > 0 ? <>{gap(bd.me.rank)}{bd.near!.map(weekRow)}</>
            : <Mono size={10} tone="you" weight="700" style={{ marginTop: 6 }}>{`You: #${n0(bd.me.rank)} · ${Number(bd.me.ring).toFixed(1)}`}</Mono>
        )}
      </Card>
      {h2h && b.span === 'season' && <Playoffs leagueId={lg.league_id!} />}
      {bd?.season && (
        <Card style={{ gap: 2 }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>SEASON STANDINGS</Mono>
          {hits && (
            <>
              <Mono size={9} tone="faint" style={{ marginTop: 4 }}>{hits.season.length ? `FOUND “${hits.q}” · SEASON` : `No team named “${hits.q}”.`}</Mono>
              {hits.season.map(seasonRow)}
            </>
          )}
          {bd.season.rows.map(seasonRow)}
          {bd.season.me && !bd.season.rows.some((r) => r.me) && (
            (bd.season.near?.length ?? 0) > 0 ? <>{gap(bd.season.me.rank)}{bd.season.near!.map(seasonRow)}</>
              : <Mono size={10} tone="you" weight="700" style={{ marginTop: 6 }}>{`You: #${n0(bd.season.me.rank)} · ${h2h ? `${recordWord(bd.season.me)} · ` : ''}${Number(bd.season.me.total).toFixed(1)}`}</Mono>
          )}
        </Card>
      )}
    </>
  );
}

function TeamRoom({ lg, onOpenWeek, onRenamed }: { lg: ContestLeague; onOpenWeek: (w: number) => void; onRenamed: () => void }) {
  const t = useTheme();
  const id = lg.league_id!;
  const [weeks, setWeeks] = useState<ContestMyWeek[] | null>(null);
  const [name, setName] = useState(lg.me?.team ?? '');
  const [note, setNote] = useState<string | null>(null);
  const [tbLine, setTbLine] = useState<string | null>(null);
  useEffect(() => { bullseyeMyWeeks(id).then((r) => setWeeks(r.ok ? (r.weeks ?? []) as ContestMyWeek[] : [])).catch(() => setWeeks([])); }, [id]);
  const rid = lg.me?.roster_id;
  const bull = lg.bullseye?.contest === 'bullseye';
  useEffect(() => {
    if (!bull || rid == null || lg.week == null) { setTbLine(null); return; }
    contestState(id, lg.week).then((s) => {
      if (!s.ok) return;
      const { slots, catalog, labels } = contestSetupOf(s);
      const tb = contestTiebreak(id, lg.week!, rid, contestCard(id, lg.week!, slots, catalog), slots);
      setTbLine(tb ? `⚖️ This week’s tie-breaker: your ${labels[tb.slot]} aims at ${tb.target}.` : null);
    }).catch(() => {});
  }, [bull, id, lg.week, rid]);
  const rename = async () => {
    if (rid == null) return;
    const r = await setTeamName(id, rid, name).catch((e) => ({ ok: false, error: friendlyError(e) }));
    setNote(r.ok ? '✓ renamed' : (r.error ?? 'Didn’t rename.'));
    if (r.ok) onRenamed();
  };
  const wl = useMemo(() => {
    const golf = lg.bullseye?.contest === 'golf';
    let w = 0, l = 0, tt = 0;
    for (const x of weeks ?? []) {
      if (x.status !== 'final' || x.void || x.opp == null || x.ring == null || x.opp_ring == null) continue;
      const a = Number(x.ring), bb = Number(x.opp_ring);
      if (a === bb) tt++; else if (golf ? a < bb : a > bb) w++; else l++;
    }
    return w + l + tt ? `${w}–${l}${tt ? `–${tt}` : ''}` : null;
  }, [weeks, lg.bullseye?.contest]);
  return (
    <>
      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>MY TEAM</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field value={name} onChangeText={setName} maxLength={30} style={{ flex: 1 }} />
          <Chip on disabled={!name.trim() || name.trim() === lg.me?.team} label="RENAME" onPress={() => { tap(); void rename(); }} />
        </View>
        {note && <Mono size={9} tone={note.startsWith('✓') ? 'you' : 'warn'}>{note}</Mono>}
        {tbLine && <Mono size={9} tone="dim">{tbLine}</Mono>}
      </Card>
      <Card style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>MY WEEKS</Mono>
          {wl && <Mono size={9} tone="faint">{`record ${wl}`}</Mono>}
        </View>
        {weeks && !weeks.length && <Mono size={9} tone="faint">No squads yet — build this week’s on MATCHUP.</Mono>}
        {(weeks ?? []).map((w) => (
          <Pressable key={w.week} onPress={() => { tap(); onOpenWeek(w.week); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.bd }}>
            <Mono size={11} tone="text" style={{ width: 64 }}>{`Week ${w.week}`}</Mono>
            <Mono size={9} tone="faint" style={{ flex: 1 }} numberOfLines={1}>{`${w.void ? 'voided' : w.status === 'final' ? 'final' : w.status === 'live' ? 'live' : 'squad set'}${w.playoff ? ` · ${w.label ?? 'playoffs'}` : ''}${w.opp != null ? ` · vs ${w.opp_team ?? `Team ${w.opp}`}${w.opp_ring != null ? ` ${Number(w.opp_ring).toFixed(1)}` : ''}` : w.rank != null ? ` · #${w.rank} of ${n0(w.entries)}` : ''}`}</Mono>
            <Mono size={11} weight="700" tone="text">{w.ring != null ? Number(w.ring).toFixed(1) : '—'}</Mono>
          </Pressable>
        ))}
      </Card>
    </>
  );
}

function SettingsRoom({ lg, onCommish, onLeft }: { lg: ContestLeague; onCommish: () => void; onLeft: () => void }) {
  const t = useTheme();
  const b = lg.bullseye!;
  const [err, setErr] = useState<string | null>(null);
  const [spotsLine, setSpotsLine] = useState<string | null>(null);
  useEffect(() => {
    contestState(lg.league_id!, lg.week).then((s) => {
      if (!s.ok) return;
      const { slots, labels } = contestSetupOf(s);
      setSpotsLine(slots.length ? `A squad of ${slots.length} — ${slots.map((d) => labels[d.slot]).join(', ')} — ${contestMoneyWord(b)}, from the week’s salary board.` : null);
    }).catch(() => {});
  }, [lg.league_id, lg.week, b.budget, b.min_spend]);
  const leave = () => Alert.alert(`Leave ${lg.name}?`, 'Your squads stay in the standings.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Leave', style: 'destructive', onPress: async () => {
      const r = await leaveLeague(lg.league_id!).catch((e) => ({ ok: false, error: friendlyError(e) }));
      if (!r.ok) setErr(r.error ?? 'Couldn’t leave.'); else onLeft();
    } },
  ]);
  const rule = b.contest === 'golf'
    ? 'Golf: the LOWEST score wins. A spot whose player posts nothing banks its penalty, so a no-show is no bargain.'
    : b.contest === 'high'
      ? 'The highest score wins.'
      : b.variant === 'total'
        ? `One number for the whole squad. Land your points close to it: dead-on doubles your score; any player who posts a zero costs ${b.radius}.`
        : `Every spot has its own number. Each player scores ${b.radius} for dead-on plus ${b.radius} more for a bullseye, less the farther off; a zero costs ${b.radius}.`;
  const rules = [
    `${CONTEST_EMOJI[b.contest]} ${CONTEST_WORD[b.contest]} · ${CONTEST_FORMAT_WORD[b.format]}${b.format === 'h2h' ? ' — paired against one opponent each week' : ' — everyone ranked each week'}.`,
    ...(spotsLine ? [spotsLine] : []),
    rule,
    `Each player locks at his own kickoff. Until then you can swap him — including one ruled out.${b.auto_sub ? ' If you don’t, a ruled-out player is swapped for you in the minutes before his game.' : ''}`,
    ...(b.format === 'h2h' ? ['Your opponent’s picks are sealed: each shows once his game locks.'] : []),
    ...(b.contest === 'bullseye' ? ['Ties are settled by your tie-breaker: one RB or WR spot with its own number, shown before you build. Closer wins.'] : []),
    b.span === 'week' ? `It plays week ${b.week} only.` : `It plays every week. Season standings add up every week’s ${b.contest === 'bullseye' ? 'ring total' : 'score'}; a week without a squad scores nothing.`,
    ...(contestCredit(b.contest) ? [`💡 ${contestCredit(b.contest)!.line}`] : []),
  ];
  // THE MONEY (0477): the dues setting and the prize list, when set.
  const money = [
    ...(b.dues_amount != null ? [`💵 Dues: $${n0(b.dues_amount)}${b.dues_note ? ` — ${b.dues_note}` : ''}. The platform prints it, never collects it.`] : []),
    ...(b.prizes ?? []).map((p) => `🏆 ${p.label}: ${p.prize}`),
  ];
  return (
    <Card style={{ gap: 8 }}>
      <Mono size={9} tone="faint" weight="700" track={0.1}>HOW THIS LEAGUE PLAYS</Mono>
      {rules.map((r, i) => <Text key={i} style={{ fontSize: 13, color: t.dim, lineHeight: 19 }}>{`• ${r}`}</Text>)}
      {money.length > 0 && <Mono size={9} tone="faint" weight="700" track={0.1} style={{ marginTop: 6 }}>THE MONEY</Mono>}
      {money.map((r, i) => <Text key={`m${i}`} style={{ fontSize: 13, color: t.dim, lineHeight: 19 }}>{`• ${r}`}</Text>)}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {lg.commish && <Chip label="⚑ COMMISSIONER" onPress={() => { tap(); onCommish(); }} />}
        {lg.me && !lg.commish && <Chip dim label="LEAVE THE LEAGUE" onPress={() => { tap(); leave(); }} />}
      </View>
      {err && <Mono size={10} tone="warn">{err}</Mono>}
    </Card>
  );
}
