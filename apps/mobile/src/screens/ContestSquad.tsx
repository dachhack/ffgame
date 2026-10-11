// THE CONTEST SQUAD, native (v0.664.0; the builder v0.665.0) — the web
// twin's note (src/screens/ContestSquad.tsx) and docs/dfs-bullseye.md §13–14.
// One screen for every contest league: the league's own spots (S1…Sn), its
// budget, and once the week is on the live numbers.
//
// THE BUILDER: a budget bar that fills as you pick, spot cards with the
// player's face, game and value, a full-height pick sheet with position tabs
// from the league's own spots, a team strip, search, sort by projection /
// value / salary, every player's eligibility said in words (the spot's
// filter, the pool filter, your seat's rule), FILL FOR ME for the open spots,
// and the week's injuries. The engine is engine/contestBuilder.ts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import {
  contestState, saveContestEntry, podSalaries, weekGameLocks, weekSlateByTeam, seatPlayerRules, leagueGameMode, loadLiveInjuries, friendlyError,
  type ContestState, type PodSalaryRow, type SlateSpot,
} from '@drip/core/data/liveApi';
import { injuryFor } from '@drip/core/data/injuries';
import { headshot, teamLogo } from '@drip/core/data/media';
import { type SeatRule, seatRuleText } from '@drip/core/data/seatRules';
import {
  contestConfigOf, contestCard, contestSquadOf, contestTiebreak, contestSlotLabels, CONTEST_WORD,
  type ContestConfig,
} from '@drip/core/engine/contest';
import {
  builderTabs, rankCandidates, fillOpenSpots, budgetLine, roomFor, posLabel, valueOf, leagueWeekProj, pricedDelta, BUILDER_SORTS,
  type BuilderCtx, type BuilderPlayer, type BuilderSort, type PoolFilter,
} from '@drip/core/engine/contestBuilder';
import { classicSlotsFromSpec, type ClassicSlotDef, type ClassicScoring } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { projectedRing, tiebreakDistance } from '@drip/core/engine/dfsBullseye';
import { ringLabel } from '@drip/core/engine/bullseye';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, ChipStrip, Display, Mono, PosPill } from '../ui/prims';
import { Overlay } from '../ui/Overlay';

const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;
/** "18.1 ↑2.7" when the feed has moved since the price was set. */
const projWord = (p: BuilderPlayer): string => { const d = pricedDelta(p); return `${p.proj.toFixed(1)}${d ? ` ${d.dir}${d.by.toFixed(1)}` : ''}`; };
const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : fmt$(n));
const INJ_WORD: Record<string, string> = { O: 'OUT', D: 'DOUBTFUL', Q: 'QUESTIONABLE', IR: 'IR' };

export function contestHowTo(cfg: ContestConfig): string {
  if (cfg.contest === 'golf') return 'Lowest score wins. Build the squad you think scores the FEWEST points — but a player who posts a zero banks the spot’s penalty, so a no-show is no bargain.';
  if (cfg.contest === 'high') return 'Highest score wins. Build the squad you think scores the most points under the budget.';
  const radius = cfg.bullseye?.radius ?? 10;
  return cfg.bullseye?.variant === 'total'
    ? `Build a squad whose points land as close to the card's total as you can. Dead-on doubles your score; any player who posts a zero costs ${radius}.`
    : `Every spot has a number. Pick the player you think lands closest to it: ${radius} points for dead-on plus ${radius} more for a bullseye, less the farther off. A zero costs ${radius}.`;
}

/** The league's spots and config from a contest_state read. */
export function contestSetupOf(st: ContestState) {
  const slots = classicSlotsFromSpec(st.slots ?? null) ?? [];
  const cfg = contestConfigOf({ contest: st.contest, contest_format: st.format, budget: st.budget, min_spend: st.min_spend ?? 0, roster_slots: st.slots, bullseye: st.variant, bullseye_radius: st.radius }, st.kind);
  const catalog = leagueCatalogOf({ scoring: (st.scoring_classic ?? null) as Partial<ClassicScoring> | null, ppr: st.ppr ?? null });
  return { slots, cfg, catalog, labels: contestSlotLabels(slots) };
}

function sealedRows(entry: unknown, slots: ClassicSlotDef[]): { slot: string; slug: string | null }[] {
  const rows = Array.isArray(entry) ? entry as { slot?: unknown; player_slug?: unknown; sealed?: unknown }[] : [];
  const bySlot = new Map<string, string | null>();
  for (const r of rows) if (typeof r?.slot === 'string') bySlot.set(r.slot, r.sealed ? null : (typeof r.player_slug === 'string' ? r.player_slug : null));
  return slots.map((d) => ({ slot: d.slot, slug: bySlot.get(d.slot) ?? null }));
}

/** "vs KC · Sun 1:00p" / "@ KC · Mon 8:15p" / "BYE". */
export function gameLine(team: string, slate: Map<string, SlateSpot>): string {
  const g = slate.get(team);
  if (!g) return slate.size ? 'BYE' : '';
  const when = g.kickoff ? new Date(g.kickoff).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(', ', ' ').replace(' AM', 'a').replace(' PM', 'p') : '';
  return `${g.home ? 'vs' : '@'} ${g.opp}${when ? ` · ${when}` : ''}`;
}

/** Headshot → team crest → position pill. */
function Face({ slug, team, pos, size = 34 }: { slug: string; team: string; pos: string; size?: number }) {
  const t = useTheme();
  const uri = headshot(slug) ?? teamLogo(team, { slug });
  return uri
    ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: t.bg }} resizeMode={headshot(slug) ? 'cover' : 'contain'} />
    : <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}><PosPill pos={pos} /></View>;
}

function InjuryTag({ week, slug }: { week: number; slug: string }) {
  const t = useTheme();
  const s = injuryFor(week, slug);
  if (!s) return null;
  const bad = s === 'O' || s === 'IR';
  const c = bad ? t.warn : '#D9A441';
  return <View accessibilityLabel={INJ_WORD[s]} style={{ borderWidth: 1, borderColor: c, borderRadius: 3, paddingHorizontal: 3, marginLeft: 5 }}><Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '800', color: c }}>{s}</Text></View>;
}

export function ContestSquad({ leagueId, week: weekProp, onBack }: { leagueId: string; week?: number; onBack: () => void }) {
  const t = useTheme();
  const [st, setSt] = useState<ContestState | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[] | null>(null);
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [slate, setSlate] = useState<Map<string, SlateSpot>>(new Map());
  const [seatRule, setSeatRule] = useState<SeatRule | null>(null);
  const [poolFilter, setPoolFilter] = useState<PoolFilter | null>(null);
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [saved, setSaved] = useState<Record<string, string | null>>({});
  const [active, setActive] = useState<string | null | 'any'>(null);
  const [tab, setTab] = useState('ALL');
  const [team, setTeam] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<BuilderSort | null>(null);
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [injTick, setInjTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const load = useCallback(async () => {
    const s = await contestState(leagueId, weekProp);
    setSt(s);
    if (!s.ok || s.week == null) return;
    const mine = contestSquadOf(s.entry, classicSlotsFromSpec(s.slots ?? null) ?? []);
    setPicks(mine); setSaved(mine);
    const [rows, lk, sl] = await Promise.all([podSalaries(s.week).catch(() => []), weekGameLocks(s.week).catch(() => new Map<string, number>()), weekSlateByTeam(s.week).catch(() => new Map<string, SlateSpot>())]);
    setBoard(rows); setLocks(lk); setSlate(sl);
    void loadLiveInjuries(s.week).then(() => setInjTick((n) => n + 1));
  }, [leagueId, weekProp]);
  useEffect(() => { void load().catch((e) => setNote(friendlyError(e))); }, [load]);
  useEffect(() => {
    leagueGameMode(leagueId).then((g) => { if (g.ok) setPoolFilter(g.pool_filter ?? null); }).catch(() => {});
    seatPlayerRules(leagueId).then((r) => { if (r.ok) setSeatRule((r.rules ?? []).find((x) => x.roster_id === r.mine) ?? null); }).catch(() => {});
  }, [leagueId]);
  useEffect(() => {
    if (!st?.started || st.matchup?.status === 'final') return;
    const id = setInterval(() => { void contestState(leagueId, weekProp).then(setSt).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [st?.started, st?.matchup?.status, leagueId, weekProp]);

  const bySlug = useMemo(() => new Map((board ?? []).map((r) => [r.slug, r])), [board]);
  const salaryOf = useCallback((slug: string) => bySlug.get(slug)?.salary ?? 0, [bySlug]);
  const setup = useMemo(() => (st?.ok ? contestSetupOf(st) : null), [st]);
  const theCard = useMemo(() => (setup?.cfg?.contest === 'bullseye' && st?.week != null ? contestCard(leagueId, st.week, setup.slots, setup.catalog) : null), [leagueId, st?.week, setup]);
  const ctx = useMemo<BuilderCtx | null>(() => (setup?.cfg ? { slots: setup.slots, cfg: setup.cfg, picks, seatRule, poolFilter, card: theCard } : null), [setup, picks, seatRule, poolFilter, theCard]);
  const locked = useCallback((slug: string | null) => { if (!slug) return false; const at = locks.get(bySlug.get(slug)?.team ?? ''); return at != null && at <= now; }, [locks, bySlug, now]);
  // THE LEAGUE'S OWN PROJECTION (v0.666.0): the board's PPR number scaled to
  // this league's catalog (leagueWeekProj) — the price is the shared sheet,
  // the projection is yours. `feedProj` keeps the feed's number for the
  // "↑ since priced" readout.
  const players = useMemo<BuilderPlayer[]>(() => (board ?? []).map((r) => ({ slug: r.slug, name: r.name, pos: r.pos, team: r.team, salary: r.salary, proj: leagueWeekProj(r, setup?.catalog, r.pos === 'HC' ? (slate.size ? slate.get(r.team) ?? null : undefined) : undefined), feedProj: r.proj, priced: r.priced_proj ?? null, exp: r.exp ?? null })), [board, setup?.catalog, slate]);
  // RULED OUT (v0.666.0): O or IR on the report — not a new pick; one already
  // saved stays, swappable until his game locks (the server's rule too).
  const byPlayer = useMemo(() => new Map(players.map((p) => [p.slug, p])), [players]);
  const ruledOut = useCallback((slug: string) => { const s = injuryFor(st?.week ?? 0, slug); return s === 'O' || s === 'IR'; }, [st?.week, injTick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const teams = useMemo(() => [...new Set(players.map((p) => p.team))].sort(), [players]);
  const tabs = useMemo(() => (setup ? builderTabs(setup.slots) : ['ALL']), [setup]);
  const dirty = useMemo(() => JSON.stringify(picks) !== JSON.stringify(saved), [picks, saved]);

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
      <Chip label="← BACK" onPress={() => { tap(); onBack(); }} />
      <Mono size={10.5} tone="you" weight="700" track={0.1} style={{ flex: 1 }} numberOfLines={1}>{st?.name ?? 'CONTEST'}</Mono>
    </View>
  );
  if (!st) return <View style={{ flex: 1, backgroundColor: t.bg }}>{header}</View>;
  if (!st.ok || !setup?.cfg || !setup.slots.length || !ctx) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {header}
        <Mono size={10} tone={st.ok ? 'faint' : 'warn'} style={{ padding: 16 }}>{st.ok ? 'This league has no spots to fill yet — its commissioner sets the roster.' : st.error ?? ''}</Mono>
      </View>
    );
  }
  const { slots, cfg, labels } = setup;
  const n = slots.length;
  const budget = cfg.budget;
  // NO CAP / THE FLOOR (v0.668.0): the bar fills against the cap, else the minimum spend.
  const barBase = cfg.capped ? budget : cfg.minSpend > 0 ? cfg.minSpend : Math.max(1, cfg.slots.length * 3000);
  const bull = cfg.contest === 'bullseye';
  const isTotal = bull && cfg.bullseye?.variant === 'total';
  const radius = cfg.bullseye?.radius ?? 10;
  const mySide: 'home' | 'away' = st.matchup && st.matchup.home !== st.roster_id ? 'away' : 'home';
  const live = st.state?.slots?.filter((r) => r.side === mySide) ?? [];
  const liveOf = (slot: string) => live.find((r) => r.slot === slot);
  const myScore = st.matchup?.status === 'final' ? (mySide === 'home' ? st.matchup.home_final : st.matchup.away_final) : st.state ? (mySide === 'home' ? st.state.home : st.state.away) : null;
  const theirScore = st.opponent && st.state ? (mySide === 'home' ? st.state.away : st.state.home) : null;
  const myPoints = live.reduce((s, r) => s + (r.score || 0), 0);
  const editable = st.matchup?.status !== 'final';
  const myTb = theCard && st.roster_id != null && st.week != null ? contestTiebreak(leagueId, st.week, st.roster_id, theCard, slots) : null;
  const tbLive = myTb ? liveOf(myTb.slot) : undefined;
  const myTbDist = st.matchup?.status === 'final'
    ? (mySide === 'home' ? st.matchup.home_tb : st.matchup.away_tb) ?? null
    : tbLive && myTb ? tiebreakDistance(tbLive.score, myTb.target, radius) : null;
  const tieBroken = bull && st.matchup?.status === 'final' && st.opponent && myScore != null && theirScore != null && Math.abs(Number(myScore) - Number(theirScore)) < 0.0101 && Number(myScore) !== Number(theirScore);
  const theirSquad = st.opponent ? sealedRows(st.opponent.entry, slots) : [];
  const bl = budgetLine(ctx, salaryOf);
  const filled = n - bl.open;
  const projTotal = Object.values(picks).reduce((s, slug) => s + (slug ? byPlayer.get(slug)?.proj ?? 0 : 0), 0);
  const week = st.week!;

  const save = async () => {
    if (filled < n) { setNote(`Fill all ${n} spots first.`); return; }
    setBusy(true); setNote(null);
    try {
      const r = await saveContestEntry(leagueId, week, picks as Record<string, string>);
      if (r.ok) { commit(); setNote('✓ squad saved'); await load(); } else { warn(); setNote(r.error ?? 'Didn’t save.'); }
    } catch (e) { warn(); setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const fill = () => {
    const built = fillOpenSpots(players.filter((p) => !locked(p.slug)), ctx, `${leagueId}|w${week}|${st.roster_id}|${Date.now()}`, ruledOut);
    const open = slots.filter((d) => !picks[d.slot]).length;
    const got = slots.filter((d) => !picks[d.slot] && built[d.slot]).length;
    setPicks(built);
    if (got) commit(); else warn();
    setNote(got === open ? `✓ filled ${got} spot${got === 1 ? '' : 's'} — swap any you like, then save` : got ? `filled ${got} of ${open} — the rest don’t fit the budget` : 'nothing fits the budget — clear a pricey pick first');
  };
  const clearAll = () => {
    const keep: Record<string, string | null> = {};
    for (const d of slots) keep[d.slot] = locked(picks[d.slot]) ? picks[d.slot] : null;
    setPicks(keep);
  };
  const openSheet = (slot: string | 'any') => {
    setActive(slot); setSearch(''); setTeam('');
    const d = slot === 'any' ? null : slots.find((x) => x.slot === slot);
    setTab(d && d.pos.length === 1 ? d.pos[0] : 'ALL');
  };
  const put = (slug: string, slot: string | null) => {
    if (!slot) return;
    const next = { ...picks };
    for (const [s, v] of Object.entries(next)) if (v === slug) next[s] = null;
    next[slot] = slug;
    setPicks(next);
    setActive(null);
  };
  const rows = active ? rankCandidates(players, ctx, { slot: active === 'any' ? null : active, tab, team: team || null, needle: search, sort: sort ?? undefined, locked, hideIneligible: eligibleOnly, ruledOut, saved }, salaryOf) : [];
  const sortNow: BuilderSort = sort ?? (bull && !isTotal ? 'aim' : 'proj');
  const activeDef = active && active !== 'any' ? slots.find((d) => d.slot === active) ?? null : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load().catch(() => {}); setRefreshing(false); }} tintColor={t.you} />}>
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Mono size={9} tone="faint" weight="700" track={0.1}>{`WEEK ${week} · ${CONTEST_WORD[cfg.contest]}`}</Mono>
            {isTotal && theCard && <Display size={22}>{String(theCard.total)}</Display>}
          </View>
          {/* THE SQUAD'S TOTAL (v0.667.2): what the picks add up to, against the card's sum. */}
          {!st.started && filled > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <Mono size={9} tone="faint">PROJECTS</Mono>
              <Mono size={13} tone="text" weight="700">{projTotal.toFixed(1)}</Mono>
              {bull && theCard && <Mono size={9} tone="faint">{`· card ${theCard.total} (${projTotal - theCard.total >= 0 ? '+' : ''}${(projTotal - theCard.total).toFixed(1)})`}</Mono>}
            </View>
          )}
          {bull && !isTotal && theCard && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
              {slots.map((d) => (
                <View key={d.slot} style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: 'row', gap: 4 }}>
                  <Mono size={9.5} tone="dim">{labels[d.slot]}</Mono>
                  <Mono size={9.5} tone="you" weight="700">{String(theCard.targets[d.slot])}</Mono>
                </View>
              ))}
            </View>
          )}
          <Text style={{ fontSize: 12, color: t.dim, lineHeight: 17 }}>{contestHowTo(cfg)}</Text>
          {seatRule && <Mono size={9} tone="dim">{`⚑ Your seat takes ${seatRuleText(seatRule) || 'some players'} only.`}</Mono>}
          {myTb && (
            <Mono size={9.5} tone="dim" style={{ borderTopWidth: 1, borderTopColor: t.bd, paddingTop: 6, lineHeight: 14 }}>
              {`⚖️ TIE-BREAKER: your ${labels[myTb.slot]} aims at ${myTb.target} — it only counts if you tie, and closer wins.${myTbDist != null ? ` Now ${myTbDist.toFixed(1)} off.` : ''}`}
            </Mono>
          )}
        </Card>

        {st.started && (
          <Card style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint" weight="700">{st.matchup?.status === 'final' ? 'FINAL' : 'LIVE'}</Mono>
            <Display size={24}>{myScore != null ? Number(myScore).toFixed(1) : '—'}</Display>
            {bull && <Mono size={9} tone="faint">{`${myPoints.toFixed(1)} pts${isTotal && theCard ? ` · ${Math.abs(myPoints - theCard.total).toFixed(1)} off ${theCard.total}` : ''}`}</Mono>}
            {st.opponent && <Mono size={9} tone="dim">{`vs ${st.opponent.team ?? 'opponent'} · ${theirScore != null ? Number(theirScore).toFixed(1) : '—'}`}</Mono>}
            {tieBroken && <Mono size={8.5} tone="faint" style={{ width: '100%' }}>{`Tied on rings — settled by the tie-breaker (${myTbDist?.toFixed(1) ?? '—'} off vs ${(mySide === 'home' ? st.matchup!.away_tb : st.matchup!.home_tb)?.toFixed(1) ?? '—'} off).`}</Mono>}
          </Card>
        )}

        {/* THE BUDGET BAR */}
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint" weight="700" track={0.1}>{bl.capped ? 'BUDGET' : 'SPEND'}</Mono>
            <Display size={18} tone={bl.over || (bl.short > 0 && filled >= n) ? 'warn' : 'you'}>{bl.capped ? fmt$(bl.left) : fmt$(bl.spent)}</Display>
            <Mono size={9} tone="faint">{bl.capped ? (bl.over ? `over by ${fmt$(-bl.left)}` : `left of ${fmt$(budget)}`) : bl.floor > 0 ? (bl.short > 0 ? `${fmt$(bl.short)} short of the ${fmt$(bl.floor)} minimum` : `✓ past the ${fmt$(bl.floor)} minimum`) : 'no cap'}</Mono>
            {bl.capped && bl.floor > 0 && <Mono size={9} tone="faint">{bl.short > 0 ? `· min ${fmt$(bl.floor)} (${fmt$(bl.short)} to go)` : `· ✓ min ${fmt$(bl.floor)}`}</Mono>}
            <Mono size={9} tone="faint" style={{ marginLeft: 'auto' }}>{bl.open ? (bl.capped ? `${bl.open} open · ${fmtK(bl.perSpot)} each` : `${bl.open} open`) : 'all filled'}</Mono>
          </View>
          <View style={{ height: 10, borderRadius: 999, backgroundColor: t.bg, borderWidth: 1, borderColor: t.bd, overflow: 'hidden', flexDirection: 'row' }}>
            {slots.map((d, i) => {
              const slug = picks[d.slot];
              if (!slug) return null;
              return <View key={d.slot} style={{ width: `${Math.max(0.5, (salaryOf(slug) / barBase) * 100)}%`, backgroundColor: bl.over ? t.warn : t.you, opacity: 0.6 + (i % 3) * 0.15, borderRightWidth: 1, borderRightColor: t.surface }} />;
            })}
          </View>
          <Mono size={8.5} tone="faint">{`${fmt$(bl.spent)} spent${!st.started ? ` · projects ${projTotal.toFixed(1)}${isTotal && theCard ? ` vs ${theCard.total}` : ''}` : ''}${filled ? ` · ${valueOf({ salary: bl.spent, proj: projTotal }).toFixed(2)}/$1k` : ''}`}</Mono>
        </Card>

        {/* MY SQUAD */}
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Mono size={9} tone="faint" weight="700" track={0.1}>{`MY SQUAD · ${filled} OF ${n}`}</Mono>
            {editable && (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Chip small label="＋ PLAYERS" onPress={() => openSheet('any')} />
                {bl.open > 0 && <Chip small label="✨ FILL FOR ME" onPress={fill} />}
                {filled > 0 && <Chip small dim label="CLEAR" onPress={clearAll} />}
              </View>
            )}
          </View>
          {slots.map((d) => {
            const slug = picks[d.slot];
            const p = slug ? byPlayer.get(slug) : null;
            const target = theCard?.targets[d.slot];
            const lv = liveOf(d.slot);
            const isLocked = locked(slug);
            const canTap = editable && !isLocked;
            const changed = slug !== saved[d.slot];
            return (
              <Pressable key={d.slot} disabled={!canTap} onPress={() => { tap(); openSheet(d.slot); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 9, borderRadius: 8, backgroundColor: t.bg, borderWidth: 1, borderColor: changed ? t.you : t.bd, opacity: isLocked && !lv ? 0.75 : 1 }}>
                <View style={{ width: 54, alignItems: 'center', gap: 2 }}>
                  <View style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}><Mono size={9.5} weight="700" tone="text">{labels[d.slot]}</Mono></View>
                  {bull && !isTotal && target != null && <Mono size={12} tone="you" weight="700">{String(target)}</Mono>}
                  {!bull && d.zeroPts != null && <Mono size={8} tone="dim">{`0 → ${d.zeroPts}`}</Mono>}
                  {myTb?.slot === d.slot && <Mono size={8} tone="dim">{`⚖️ ${myTb.target}`}</Mono>}
                </View>
                {p ? (
                  <>
                    <Face slug={p.slug} team={p.team} pos={p.pos} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.text, flexShrink: 1 }}>{`${p.name}${isLocked ? ' 🔒' : ''}`}</Text>
                        <InjuryTag key={injTick} week={week} slug={p.slug} />
                      </View>
                      <Mono size={8.5} tone="faint" numberOfLines={1}>{`${p.pos} · ${p.team} ${gameLine(p.team, slate)}`}</Mono>
                      <Mono size={9} tone="dim">{`${fmt$(p.salary)} · proj ${projWord(p)} · ${valueOf(p).toFixed(2)}/$1k`}</Mono>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={{ width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed', borderColor: t.bd, alignItems: 'center', justifyContent: 'center' }}><Mono size={16} tone="faint">+</Mono></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Mono size={10.5} weight="700" tone={editable ? 'you' : 'faint'}>{editable ? `PICK ${labels[d.slot]}` : 'empty'}</Mono>
                      <Mono size={8.5} tone="faint">{d.flt?.teams?.length ? `${d.flt.teams.join('/')} only` : d.flt?.min_exp != null || d.flt?.max_exp != null ? `${d.flt.min_exp === 0 && d.flt.max_exp === 0 ? 'rookies' : `${d.flt.min_exp ?? 0}–${d.flt.max_exp ?? '∞'} yrs`} only` : d.pos.length > 1 ? d.pos.map(posLabel).join('/') : bl.capped ? `up to ${fmtK(Math.max(0, bl.left - (bl.open - 1) * 3000))}` : 'any price'}</Mono>
                    </View>
                  </>
                )}
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {lv ? (
                    <>
                      <Mono size={13} weight="700" tone="text">{lv.score.toFixed(1)}</Mono>
                      {lv.aim && <Mono size={8.5} tone={lv.aim.ring > 0 ? 'you' : 'faint'}>{`${ringLabel(lv.aim.dist, radius)} +${lv.aim.ring}`}</Mono>}
                    </>
                  ) : p && bull && !isTotal && target != null ? <Mono size={8.5} tone="faint">{`aims ${projectedRing(p.proj, target, radius).toFixed(1)}`}</Mono> : null}
                  {p && canTap && (
                    <Pressable hitSlop={8} onPress={() => { tap(); setPicks({ ...picks, [d.slot]: null }); }} style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Mono size={9} tone="faint">✕</Mono>
                    </Pressable>
                  )}
                </View>
              </Pressable>
            );
          })}
          {editable && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              <Chip on label={dirty ? 'SAVE SQUAD' : 'SAVED'} disabled={busy || filled < n || bl.over || bl.short > 0 || !dirty} onPress={() => { tap(); void save(); }} />
              <Mono size={9} tone="faint">{filled < n ? `${n - filled} to fill` : bl.over ? 'over the budget' : bl.short > 0 ? `${fmt$(bl.short)} under the minimum spend` : dirty ? 'unsaved changes' : 'your squad is in'}</Mono>
            </View>
          )}
          {note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'warn'} style={{ marginTop: 6 }}>{note}</Mono>}
        </Card>

        {st.opponent && (
          <Card style={{ gap: 0 }}>
            <Mono size={9} tone="faint" weight="700" track={0.1} style={{ marginBottom: 6 }}>{`${(st.opponent.team ?? 'OPPONENT').toUpperCase()}’S SQUAD`}</Mono>
            {theirSquad.map((r) => {
              const lv = st.state?.slots?.find((x) => x.side !== mySide && x.slot === r.slot);
              const p = r.slug ? bySlug.get(r.slug) : null;
              return (
                <View key={r.slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.bd }}>
                  <Mono size={9.5} tone="faint" style={{ width: 44 }}>{labels[r.slot]}</Mono>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: r.slug ? t.text : t.faint }}>{r.slug ? (p?.name ?? r.slug) : '🔒 sealed until his game locks'}</Text>
                  <Mono size={10}>{lv ? lv.score.toFixed(1) : ''}</Mono>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>

      {/* THE PICK SHEET */}
      <Overlay visible={!!active} onClose={() => setActive(null)}
        title={activeDef ? `${labels[activeDef.slot]}${bull && !isTotal && theCard ? ` · aim at ${theCard.targets[activeDef.slot]}` : ''}` : 'ANY SPOT'}
        subtitle={activeDef ? `ROOM ${fmt$(Math.max(0, roomFor(ctx, activeDef.slot, salaryOf)))} · ${fmt$(bl.left)} LEFT` : `${fmt$(bl.left)} LEFT · LANDS IN THE TIGHTEST OPEN SPOT`}>
        {active && (
          <View style={{ flexShrink: 1, gap: 6 }}>
            <ChipStrip>
              <Chip small label="ANY" on={active === 'any'} onPress={() => openSheet('any')} />
              {slots.map((d) => <Chip key={d.slot} small on={active === d.slot} dim={!!picks[d.slot]} disabled={locked(picks[d.slot])} label={`${labels[d.slot]}${picks[d.slot] ? ' ·' : ''}`} onPress={() => openSheet(d.slot)} />)}
            </ChipStrip>
            <ChipStrip>
              {tabs.map((tb) => <Chip key={tb} small on={tab === tb} label={posLabel(tb)} onPress={() => setTab(tb)} />)}
            </ChipStrip>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <TextInput value={search} onChangeText={setSearch} placeholder="Search players…" placeholderTextColor={t.faint}
                style={{ flex: 1, color: t.text, borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14 }} />
              <Chip small on={!eligibleOnly} label={eligibleOnly ? 'ELIGIBLE' : 'EVERYONE'} onPress={() => setEligibleOnly((v) => !v)} />
            </View>
            <ChipStrip>
              {(bull && !isTotal ? [{ id: 'aim' as BuilderSort, label: 'CLOSEST' }, ...BUILDER_SORTS] : BUILDER_SORTS).map((s) => (
                <Chip key={s.id} small on={sortNow === s.id} label={s.label} onPress={() => setSort(s.id)} />
              ))}
              <Chip small on={!team} label="ALL TEAMS" onPress={() => setTeam('')} />
              {teams.map((tm) => <Chip key={tm} small on={team === tm} label={tm} onPress={() => setTeam(tm)} />)}
            </ChipStrip>
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {rows.slice(0, 150).map(({ p, slot, fits, why, afford, over, lock, taken, dist, value }) => {
                const ok = fits && afford && !lock && !taken;
                return (
                  <Pressable key={p.slug} disabled={!ok} onPress={() => { tap(); put(p.slug, slot); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.bd, opacity: ok ? 1 : 0.5 }}>
                    <Face slug={p.slug} team={p.team} pos={p.pos} size={32} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: t.text, flexShrink: 1 }}>{p.name}</Text>
                        <InjuryTag key={injTick} week={week} slug={p.slug} />
                      </View>
                      <Mono size={8.5} tone="faint" numberOfLines={1}>{`${p.pos} · ${p.team} ${gameLine(p.team, slate)}${active === 'any' && slot && ok ? ` · → ${labels[slot]}` : ''}`}</Mono>
                      {(why || taken || lock || (fits && !afford)) && (
                        <Mono size={8.5} tone={lock || taken ? 'faint' : 'warn'}>{lock ? '🔒 his game has locked' : taken ? `already in ${labels[taken]}` : why ?? `over budget by ${fmt$(over)}`}</Mono>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Mono size={12} weight="700" tone="text">{fmt$(p.salary)}</Mono>
                      <Mono size={8.5} tone="dim">{`proj ${projWord(p)} · ${value.toFixed(2)}/$1k`}</Mono>
                      {bull && !isTotal && dist != null && <Mono size={8.5} tone={dist <= radius / 5 ? 'you' : 'faint'}>{`${dist.toFixed(1)} off`}</Mono>}
                    </View>
                  </Pressable>
                );
              })}
              {!rows.length && <Mono size={9} tone="faint" style={{ padding: 16, textAlign: 'center' }}>Nobody matches — widen the search or show everyone.</Mono>}
            </ScrollView>
          </View>
        )}
      </Overlay>
    </View>
  );
}
