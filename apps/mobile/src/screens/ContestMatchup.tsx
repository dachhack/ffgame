// THE MATCHUP, AS CARDS — native (v0.677.0), the web's twin
// (src/screens/ContestMatchup.tsx). Your squad face up down one column, the
// other squad's card backs down the other, each turning over as its player's
// game kicks off (contest_matchup, 0479, seals him until then). Mounted
// afresh on every visit, so the turns replay. The picker walks the week's
// other matchups; the week arrows live in the league frame.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { contestMatchup, contestState, contestArmPlay, contestDisarmPlay, podSalaries, weekGameLocks, weekSlateByTeam, friendlyError, type ContestMatchupState, type ContestState, type ContestPlayRow, type PodSalaryRow, type SlateSpot } from '@drip/core/data/liveApi';
import { contestSlotLabels, contestCard, contestTiebreak, contestScoreWord, contestRedeal, contestPlayById, contestPlaysFor, contestPlayCap, contestPlayTarget, contestSpotOpen, contestHandCard, type ContestPlayId } from '@drip/core/engine/contest';
import { GHOST_PLAYER } from '@drip/core/engine/sim';
import { GHOST_CARD } from '@drip/core/data/ghostCard';
import { ringScore } from '@drip/core/engine/bullseye';
import { leagueWeekProj } from '@drip/core/engine/contestBuilder';
import { classicSlotsFromSpec, type ClassicScoring } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { useTheme, MONO, fs, alpha } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Mono } from '../ui/prims';
import { InfoChip } from '../ui/InfoChip';
import { PowerupHand, HAND_TAB_H, type HandCard } from '../ui/PowerupHand';
import { CardBack, CardFace, EmptyCard, FeltTable, FlipCard, CARD_H } from '../ui/ContestCards';

type Row = { slot: string; slug: string | null; sealed: boolean };
function squadRows(entry: unknown, slots: { slot: string }[]): Row[] {
  const list = Array.isArray(entry) ? entry as { slot?: unknown; player_slug?: unknown; sealed?: unknown }[] : [];
  const by = new Map<string, Row>();
  for (const r of list) if (typeof r?.slot === 'string') by.set(r.slot, { slot: r.slot, slug: typeof r.player_slug === 'string' ? r.player_slug : null, sealed: r.sealed === true });
  return slots.map((d) => by.get(d.slot) ?? { slot: d.slot, slug: null, sealed: false });
}

/** THE TIE-BREAKER CHIP (v0.682.2): what the number on the card means. */
const TB_NOTE = 'This spot is your tie-breaker: its player aims at this number. If the matchup ties on rings, the squad whose tie-breaker lands closer to its own number wins.';

export function ContestMatchup({ leagueId, week, header }: { leagueId: string; week: number;
  /** Above the table, inside its scroll (v0.695.0: the league line and the week arrows — the table owns its scroll so the hand can pin over the room bar). */ header?: React.ReactNode }) {
  const t = useTheme();
  const [st, setSt] = useState<ContestMatchupState | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[]>([]);
  const read = useCallback(() => contestMatchup(leagueId, week, pick).then(setSt).catch(() => {}), [leagueId, week, pick]);
  useEffect(() => {
    void read();
    const id = setInterval(() => void read(), 60_000);
    return () => clearInterval(id);
  }, [read]);
  // THE HAND ON THE MATCHUP (v0.695.0, founder: "put the card hand and power up application on the matchup"):
  // my seat's hand, plays and cap ride contest_state; a play lands on a spot by a tap on its card here.
  // Only a spot whose player hasn't kicked off lights up ("Only Josh Allen and DJ Moore should be able to
  // be targeted by double or nothing"); the rest dim. The shop stays on MY TEAM. The web's twin.
  const [ps, setPs] = useState<ContestState | null>(null);
  const [plays, setPlays] = useState<ContestPlayRow[]>([]);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [arming, setArming] = useState<ContestPlayId | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const me = st?.ok ? st.me ?? null : null;
  useEffect(() => {
    if (me == null) { setPs(null); return; }
    let alive = true;
    contestState(leagueId, week, '2026', me).then((r) => { if (!alive) return; setPs(r); setPlays(r.plays ?? []); setInventory(r.inventory ?? {}); }).catch(() => {});
    weekGameLocks(week, '2026', 0).then((lk) => { if (alive) setLocks(lk); }).catch(() => {});
    return () => { alive = false; };
  }, [leagueId, week, me]);
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
  const locked = (slug: string | null) => { if (!slug) return false; const tm = locks.get(bySlug.get(slug)?.team ?? ''); return tm != null && tm <= now; };
  // the table owns its scroll (v0.695.0), so the hand can pin over the room bar
  const frame = (inner: React.ReactNode, pad = 90) => (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: pad }} keyboardShouldPersistTaps="handled">
        {header}
        {inner}
      </ScrollView>
    </View>
  );
  if (!st) return frame(<Card><Mono size={9} tone="faint">Loading…</Mono></Card>);
  if (!st.ok) return frame(<Card><Mono size={10} tone="warn">{st.error}</Mono></Card>);
  const m = st.matchup;
  const word = contestScoreWord(st.contest ?? 'high', st.variant);
  if (!m) return frame(<Card><Mono size={9} tone="faint">{`No matchup for week ${st.week ?? week} yet — squads are paired once the week's board is up.`}</Mono></Card>);
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
  // my table: the hand plays here; another matchup is only watched
  const myTable = L.mine && ps?.ok === true && ps.coin === true && m.status !== 'final';
  type PlayResult = { ok: boolean; error?: string; plays?: ContestPlayRow[]; wallet?: number | null; inventory?: Record<string, number> };
  const arm = async (id: ContestPlayId, slot?: string | null) => {
    if (!ps?.ok) return;
    setBusy(true);
    const r = await contestArmPlay(leagueId, week, id, slot ?? null, ps.roster_id).catch((e) => ({ ok: false, error: friendlyError(e) } as PlayResult));
    setBusy(false); setArming(null);
    if (!r.ok) { warn(); setNote(r.error ?? 'Couldn’t play it.'); return; }
    commit(); setPlays(r.plays ?? []); if (r.inventory) setInventory(r.inventory);
    const def = contestPlayById(id);
    setNote(`✓ ${def?.icon ?? ''} ${def?.name ?? id} on${slot ? ` ${def?.target === 'opp' ? 'their ' : ''}${labels[slot] ?? slot}` : ' your squad'}`);
    void read();
  };
  const disarm = async (x: ContestPlayRow) => {
    if (!ps?.ok) return;
    setBusy(true);
    const r = await contestDisarmPlay(leagueId, week, x.id, x.slot, ps.roster_id).catch((e) => ({ ok: false, error: friendlyError(e) } as PlayResult));
    setBusy(false);
    if (!r.ok) { warn(); setNote(r.error ?? 'Couldn’t take it back.'); return; }
    commit(); setPlays(r.plays ?? []); if (r.inventory) setInventory(r.inventory);
    setNote(`✓ ${contestPlayById(x.id)?.name ?? x.id} back in your hand${x.id === 'ghost' ? ' — fill the spot on MY TEAM' : ''}`);
    void read();
  };
  const cap = ps?.play_cap ?? contestPlayCap(st.format ?? 'h2h');
  const armingDef = arming ? contestPlayById(arming) : null;
  const hand: HandCard[] = myTable ? contestPlaysFor(st.format ?? 'h2h', st.contest ?? 'high').filter((d) => (inventory[d.id] ?? 0) > 0).map((d) => {
    const h = contestHandCard(d, { variant: st.variant, started: !!st.started, off: ps?.plays_off, plays, cap, busy });
    return { id: d.id, qty: inventory[d.id] ?? 0, action: h.action === 'arm' ? 'arm' : 'aim', usable: h.usable, note: h.note };
  }) : [];
  const scoreOf = (s: 'home' | 'away', slot: string) => m.state?.slots?.find((x) => x.side === s && x.slot === slot)?.score ?? null;
  // THE TIE-BREAKER SPOT (v0.681.0, founder: "the spot-specific tie breaker
  // target chip on the player spots in the matchup as well"): each squad's own
  // tie-breaker spot and target, dealt per seat; the number rides the card as a chip (v0.682.2).
  const tbs = {
    home: theCard ? contestTiebreak(leagueId, st.week ?? week, m.home, theCard, slots, contestRedeal(m.home_plays)) : null,
    away: theCard ? contestTiebreak(leagueId, st.week ?? week, m.away, theCard, slots, contestRedeal(m.away_plays)) : null,
  };
  // One card for a spot: yours sits face up; another squad's starts on its
  // back and turns as its player kicks off (he arrives unsealed, so it flips).
  const cardInner = (s: 'home' | 'away', r: Row, mine: boolean, i: number) => {
    const p = r.slug ? bySlug.get(r.slug) : null;
    // THE PLAYS (v0.687.0): mine on my spot, or the other side's aimed at it (Spy, Jinx) once they show; the phantom as a card
    const pl = (s === 'home' ? m.home_plays : m.away_plays)?.find((x) => x.slot === r.slot && contestPlayById(x.id)?.target !== 'opp')
      ?? (s === 'home' ? m.away_plays : m.home_plays)?.find((x) => x.slot === r.slot && contestPlayById(x.id)?.target === 'opp') ?? null;
    if (!r.slug && !r.sealed && pl?.id === 'ghost') {
      return <FlipCard key={`${s}-${r.slot}-ghost`} flipped idx={i} back={<CardBack seed={`${m.id}|${s}|${r.slot}`} />} face={<CardFace slug={GHOST_PLAYER.id} name={GHOST_CARD.name} pos="FLEX" team={null} mine={mine} badge="👻" />} />;
    }
    // THE PENALTY CHIP (v0.685.2): a spot that posted nothing wears the dart's penalty, red — an empty spot too (v0.695.0)
    const lvr = m.state?.slots?.find((x) => x.side === s && x.slot === r.slot);
    const pen = lvr?.aim?.penalty != null && Math.abs(lvr.score) < 1e-9 ? lvr.aim.penalty : null;
    if (!r.slug && !r.sealed) return <EmptyCard key={`${s}-${r.slot}`} label={labels[r.slot] ?? r.slot} chip={pen != null ? `−${pen}` : undefined} />;
    const tbc = tbs[s]?.slot === r.slot ? tbs[s] : null;
    const face = r.slug ? <CardFace slug={r.slug} name={p?.name ?? r.slug} pos={p?.pos ?? 'FLEX'} team={p?.team ?? null} mine={mine} locked={!mine && !!r.slug} chip={pen != null ? `−${pen}` : tbc ? String(tbc.target) : null} chipTone={pen != null ? 'warn' : 'gold'} onChip={() => Alert.alert(pen != null ? 'No-show' : 'Tie-breaker', pen != null ? `This spot posted nothing, and a zero scores nothing: it adds ${pen} to the squad's distance.` : TB_NOTE)} /> : <View />;
    return <FlipCard key={`${s}-${r.slot}`} flipped={mine || !!r.slug} idx={i} back={<CardBack seed={`${m.id}|${s}|${r.slot}`} />} face={face} />;
  };
  // While a play is aimed, only the spots it may land on now light up: mine for a spot play, theirs for Spy
  // and Jinx, each until that spot's player kicks off (contestSpotOpen, the twin of SQL _contest_play_window).
  const cardOf = (s: 'home' | 'away', r: Row, mine: boolean, i: number) => {
    const el = cardInner(s, r, mine, i);
    if (!myTable || !arming || !armingDef) return el;
    const aimed = armingDef.target === 'opp' ? !mine : mine;
    const open = aimed && contestSpotOpen(arming, { slug: r.slug, locked: locked(r.slug) }, !!st.started);
    return (
      <Pressable key={`aim-${s}-${r.slot}`} disabled={!open} onPress={() => { tap(); void arm(arming, r.slot); }}
        style={{ borderRadius: 13, borderWidth: 2, borderColor: open ? t.you : 'transparent', padding: 1, opacity: open ? 1 : 0.35 }}>
        {el}
      </Pressable>
    );
  };
  // THE NUMBERS (v0.678.0, founder: "the player score and projection to the
  // inside of the card columns in larger numbers"): the spot, the score once
  // his game is on, the projection under it; a Bullseye spot's target and how
  // far off. A sealed pick shows nothing — a projection would give him away.
  /** The play on a spot: mine on my spot, or the other side's aimed at it (Spy, Jinx) once it shows. */
  const playAt = (s: 'home' | 'away', r: Row): { pl: ContestPlayRow; theirs: boolean } | null => {
    const own = (s === 'home' ? m.home_plays : m.away_plays)?.find((x) => x.slot === r.slot && contestPlayById(x.id)?.target !== 'opp');
    if (own) return { pl: own, theirs: false };
    const aimed = (s === 'home' ? m.away_plays : m.home_plays)?.find((x) => x.slot === r.slot && contestPlayById(x.id)?.target === 'opp');
    return aimed ? { pl: aimed, theirs: true } : null;
  };
  const playText = (pl: ContestPlayRow, theirs: boolean, mine: boolean) => {
    const d = contestPlayById(pl.id);
    return `${theirs ? `${mine ? 'Their' : 'The other side’s'} ${d?.name ?? pl.id}, aimed at this spot.\n\n` : ''}${d?.blurb ?? ''}${pl.proj != null ? `\n\nHis number to beat: ${Number(pl.proj).toFixed(1)}.` : ''}${!theirs && mine ? '\n\nTake it back in PLAYS above until his kickoff.' : ''}`;
  };
  const numbersOf = (s: 'home' | 'away', r: Row, mine: boolean, edge: 'left' | 'right') => {
    const score = st.started ? scoreOf(s, r.slot) : null;   // an empty spot's zero row shows too (v0.695.0)
    const proj = r.slug ? projOf(r.slug) : null;
    const target = bull && !isTotal ? theCard?.targets[r.slot] ?? null : null;
    const color = mine ? t.you : t.opp;
    const align = edge === 'left' ? 'flex-start' : 'flex-end';
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: align, paddingLeft: edge === 'left' ? 8 : 4, paddingRight: edge === 'right' ? 8 : 4, minWidth: 0 }}>
        {/* THE PLAY CHIP (v0.696.6, founder: "On the matchup screen, let's do the same: just an active power ups chip"):
            beside the spot's label, no icon on the card; tap it for the play's details. */}
        <View style={{ flexDirection: edge === 'left' ? 'row' : 'row-reverse', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', letterSpacing: 0.8, color: alpha(t.text, 65) }}>{`${labels[r.slot] ?? r.slot}${target != null ? ` · 🎯 ${target}` : ''}`}</Text>
          {(() => { const a = playAt(s, r); return a ? <InfoChip label="POWER UP" title={contestPlayById(a.pl.id)?.name ?? a.pl.id}>{playText(a.pl, a.theirs, mine)}</InfoChip> : null; })()}
        </View>
        <Text style={{ fontFamily: MONO, fontSize: fs(26), fontWeight: '800', color: score != null ? color : alpha(t.text, 35) }}>{score != null ? score.toFixed(1) : r.sealed ? '◈' : '—'}</Text>
        <Text style={{ fontFamily: MONO, fontSize: fs(9.5), color: alpha(t.text, 65) }}>{`${proj != null && !r.sealed ? `proj ${proj.toFixed(1)}` : ''}${target != null && score != null ? ` · ${Math.abs(score - target).toFixed(1)} off` : ''}`}</Text>
      </View>
    );
  };
  const fmt = (n: number | null) => (n == null ? '—' : Number(n).toFixed(1));
  // THE SCOREBOARD (v0.680.1): a side's points so far and where they project
  // to land, and for Bullseye the ring — how far off the target — with the
  // projected ring beside it. A sealed pick leaves the projection blank: his
  // number would give him away. Mirrors the web (src/screens/ContestMatchup.tsx).
  // THE RING (v0.682.5, founder: "where does the 57.4 come from?"): the
  // server's ring is the score the week is won on — in a one-team-total
  // league max(0, radius × spots − distance), so 90 − 32.6 = 57.4 at radius
  // 10 over nine spots; per spot, the sum of each spot's ring. The scoreboard
  // had labelled it OFF and projected a distance. Now: RING, the distance
  // and target under it, a projected RING beside it, and a side with spots
  // still to play says so (each carries the zero penalty until he posts).
  const radius = st.radius ?? 10;
  const tally = (s: 'home' | 'away', S: typeof L) => {
    let pts = 0, proj = 0, ringProj = 0, known = true, toPlay = 0;
    for (const r of S.rows) {
      const score = st.started && r.slug ? scoreOf(s, r.slot) : null;
      if (score != null) pts += score;
      if (st.started && (r.sealed || (r.slug && score == null))) toPlay++;
      if (r.sealed) { known = false; continue; }
      const v = score ?? (r.slug ? projOf(r.slug) : null) ?? 0;
      proj += v;
      if (bull && !isTotal) { const tg = theCard?.targets[r.slot]; if (tg != null) ringProj += ringScore(v, tg, radius); }
    }
    const points = !bull ? S.score : st.started ? pts : null;
    const projected = known ? proj : null;
    // a one-team-total league's score IS the distance (v0.683.0): project that
    const ringProjected = !bull || !known ? null : isTotal ? (theCard ? Math.abs(proj - theCard.total) : null) : ringProj;
    return { points, projected, ring: bull ? S.score : null, ringProjected, toPlay };
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
            <Text numberOfLines={2} style={{ fontFamily: MONO, fontSize: fs(9), color: dim, textAlign: edge }}>{`${isTotal ? `OFF 🎯 ${theCard?.total ?? ''}` : 'RING · 🎯 per spot'}${x.ringProjected != null ? ` · proj ${x.ringProjected.toFixed(1)}${isTotal ? ' off' : ''}` : ''}${x.toPlay ? ` · ${x.toPlay} to play` : ''}`}</Text>
          </View>
        )}
      </View>
    );
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: hand.length ? HAND_TAB_H + 90 : 90 }} keyboardShouldPersistTaps="handled">
      {header}
      {(st.matchups?.length ?? 0) > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
          {(st.matchups ?? []).map((x) => (
            <Chip key={x.id} small on={x.id === m.id} label={`${x.home === x.away ? x.home_team : `${x.home_team} v ${x.away_team}`}${x.mine ? ' · YOU' : ''}`}
              onPress={() => { tap(); setPick(x.mine ? null : x.id); }} />
          ))}
        </ScrollView>
      )}
      {myTable && (
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint" weight="700" track={0.1}>PLAYS</Mono>
            <Mono size={8.5} tone="faint">{`${hand.reduce((a, c) => a + c.qty, 0)} in hand · ${plays.length} of ${cap} played`}</Mono>
            <InfoChip title="Plays">{'Your hand sits at the foot of the screen. Tap a card to play it: a squad play goes on at once; a spot play lights up the spots it can land on — tap one. Only a player who hasn’t kicked off can take a play; the rest dim. TAKE BACK puts a play back in your hand on the same clock. Buy more in the shop on MY TEAM.'}</InfoChip>
          </View>
          {armingDef && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mono size={8.5} tone="you" style={{ flex: 1 }}>{`${armingDef.blurb} Tap ${armingDef.target === 'opp' ? 'one of their lit spots' : 'a lit spot'}.`}</Mono>
              <Chip small dim label="CANCEL" onPress={() => { tap(); setArming(null); }} />
            </View>
          )}
          {note && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mono size={8.5} tone="dim" style={{ flex: 1 }}>{note}</Mono>
              <Chip small dim label="✕" onPress={() => { tap(); setNote(null); }} />
            </View>
          )}
          {plays.map((x) => (
            <View key={`${x.id}-${x.slot ?? ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mono size={9} tone="dim" style={{ flex: 1 }}>{`${contestPlayById(x.id)?.icon ?? ''} ${contestPlayById(x.id)?.name ?? x.id}${x.slot ? ` on ${contestPlayById(x.id)?.target === 'opp' ? 'their ' : ''}${labels[x.slot] ?? x.slot}` : ''}${x.proj != null ? ` · beats ${Number(x.proj).toFixed(1)}` : ''}`}</Mono>
              {(!st.started || !!x.slot) && <Chip small dim disabled={busy} label="TAKE BACK" onPress={() => { tap(); void disarm(x); }} />}
            </View>
          ))}
        </Card>
      )}
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
    </ScrollView>
    {/* THE HAND (v0.695.0): the plays in hand, fanned over the room bar; a squad play goes on at once, a spot play lights its spots */}
    {hand.length > 0 && (
      <PowerupHand lift={50} cards={hand} busyId={busy ? arming : null} defOf={(id) => contestPlayById(id)} armLabel="PLAY · TAKE BACK UNTIL KICKOFF"
        onArm={(id) => { const d = contestPlayById(id); if (!d) return; setNote(null); if (contestPlayTarget(d, st.variant) === 'squad') void arm(d.id); else setArming(d.id); }} />
    )}
    </View>
  );
}
