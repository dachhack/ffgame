// THE CONTEST SQUAD, native (v0.664.0) — the web twin's note
// (src/screens/ContestSquad.tsx) and docs/dfs-bullseye.md §13. One screen for
// every contest league: the league's own spots (S1…Sn), its budget, the pick
// sheet sorted the way the contest scores (HIGH by projection, GOLF lowest
// real projection first, BULLSEYE closest to the number), and once the week
// is on the same screen shows the live numbers.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import {
  contestState, saveContestEntry, podSalaries, weekGameLocks, friendlyError,
  type ContestState, type PodSalaryRow,
} from '@drip/core/data/liveApi';
import {
  contestConfigOf, contestCard, contestSquadOf, contestTiebreak, contestSlotLabels, contestSlotAllows, CONTEST_MIN_SALARY, CONTEST_WORD,
  type ContestConfig,
} from '@drip/core/engine/contest';
import { classicSlotsFromSpec, type ClassicSlotDef, type ClassicScoring } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { projectedRing, tiebreakDistance } from '@drip/core/engine/dfsBullseye';
import { ringLabel } from '@drip/core/engine/bullseye';
import { useTheme } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, Mono } from '../ui/prims';
import { Overlay } from '../ui/Overlay';

const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;

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
  const cfg = contestConfigOf({ contest: st.contest, contest_format: st.format, budget: st.budget, roster_slots: st.slots, bullseye: st.variant, bullseye_radius: st.radius }, st.kind);
  const catalog = leagueCatalogOf({ scoring: (st.scoring_classic ?? null) as Partial<ClassicScoring> | null, ppr: st.ppr ?? null });
  return { slots, cfg, catalog, labels: contestSlotLabels(slots) };
}

function sealedRows(entry: unknown, slots: ClassicSlotDef[]): { slot: string; slug: string | null }[] {
  const rows = Array.isArray(entry) ? entry as { slot?: unknown; player_slug?: unknown; sealed?: unknown }[] : [];
  const bySlot = new Map<string, string | null>();
  for (const r of rows) if (typeof r?.slot === 'string') bySlot.set(r.slot, r.sealed ? null : (typeof r.player_slug === 'string' ? r.player_slug : null));
  return slots.map((d) => ({ slot: d.slot, slug: bySlot.get(d.slot) ?? null }));
}

export function ContestSquad({ leagueId, week: weekProp, onBack }: { leagueId: string; week?: number; onBack: () => void }) {
  const t = useTheme();
  const [st, setSt] = useState<ContestState | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[] | null>(null);
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const load = useCallback(async () => {
    const s = await contestState(leagueId, weekProp);
    setSt(s);
    if (!s.ok || s.week == null) return;
    setPicks(contestSquadOf(s.entry, classicSlotsFromSpec(s.slots ?? null) ?? []));
    const [rows, lk] = await Promise.all([podSalaries(s.week).catch(() => []), weekGameLocks(s.week).catch(() => new Map<string, number>())]);
    setBoard(rows); setLocks(lk);
  }, [leagueId, weekProp]);
  useEffect(() => { void load().catch((e) => setNote(friendlyError(e))); }, [load]);
  useEffect(() => {
    if (!st?.started || st.matchup?.status === 'final') return;
    const id = setInterval(() => { void contestState(leagueId, weekProp).then(setSt).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [st?.started, st?.matchup?.status, leagueId, weekProp]);

  const bySlug = useMemo(() => new Map((board ?? []).map((r) => [r.slug, r])), [board]);
  const setup = useMemo(() => (st?.ok ? contestSetupOf(st) : null), [st]);
  const theCard = useMemo(() => (setup?.cfg?.contest === 'bullseye' && st?.week != null ? contestCard(leagueId, st.week, setup.slots, setup.catalog) : null), [leagueId, st?.week, setup]);
  const locked = (slug: string | null) => { if (!slug) return false; const at = locks.get(bySlug.get(slug)?.team ?? ''); return at != null && at <= now; };
  const spent = Object.values(picks).reduce((s, slug) => s + (slug ? bySlug.get(slug)?.salary ?? 0 : 0), 0);
  const filled = Object.values(picks).filter(Boolean).length;
  const projTotal = Object.values(picks).reduce((s, slug) => s + (slug ? bySlug.get(slug)?.proj ?? 0 : 0), 0);

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
      <Chip label="← BACK" onPress={() => { tap(); onBack(); }} />
      <Mono size={10.5} tone="you" weight="700" track={0.1} style={{ flex: 1 }} numberOfLines={1}>{st?.name ?? 'CONTEST'}</Mono>
    </View>
  );
  if (!st) return <View style={{ flex: 1, backgroundColor: t.bg }}>{header}</View>;
  if (!st.ok || !setup?.cfg || !setup.slots.length) {
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

  const save = async () => {
    if (st.week == null) return;
    if (filled < n) { setNote(`Fill all ${n} spots first.`); return; }
    setBusy(true); setNote(null);
    try {
      const r = await saveContestEntry(leagueId, st.week, picks as Record<string, string>);
      if (r.ok) { commit(); setNote('✓ squad saved'); await load(); } else { warn(); setNote(r.error ?? 'Didn’t save.'); }
    } catch (e) { warn(); setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const candidates = (slot: string) => {
    const def = slots.find((d) => d.slot === slot)!;
    const target = theCard?.targets[slot] ?? 0;
    const taken = new Set(Object.entries(picks).filter(([s, v]) => s !== slot && v).map(([, v]) => v));
    const cur = picks[slot] ? bySlug.get(picks[slot]!)?.salary ?? 0 : 0;
    const room = budget - spent + cur - (n - filled - (picks[slot] ? 0 : 1)) * CONTEST_MIN_SALARY;
    const needle = search.trim().toLowerCase();
    return (board ?? [])
      .filter((r) => contestSlotAllows(def, r) && !taken.has(r.slug) && (!needle || r.name.toLowerCase().includes(needle) || r.team.toLowerCase().includes(needle)))
      .map((r) => ({ r, dist: Math.abs(r.proj - target), afford: r.salary <= room, lock: locked(r.slug) }))
      .sort((a, b) => (bull && !isTotal ? a.dist - b.dist : cfg.contest === 'golf' ? (a.r.proj > 0 ? a.r.proj : 999) - (b.r.proj > 0 ? b.r.proj : 999) : b.r.proj - a.r.proj) || a.r.salary - b.r.salary)
      .slice(0, 80);
  };
  const sortedNote = bull && !isTotal ? 'SORTED BY HOW CLOSE HE LANDS TO THE NUMBER' : cfg.contest === 'golf' ? 'SORTED BY PROJECTION · LOWEST FIRST' : 'SORTED BY PROJECTION';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load().catch(() => {}); setRefreshing(false); }} tintColor={t.you} />}>
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Mono size={9} tone="faint" weight="700" track={0.1}>{`WEEK ${st.week} · ${CONTEST_WORD[cfg.contest]}`}</Mono>
            {isTotal && theCard && <Display size={22}>{String(theCard.total)}</Display>}
          </View>
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

        <Card style={{ gap: 0 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Mono size={9} tone="faint" weight="700" track={0.1}>MY SQUAD</Mono>
            <Mono size={9} tone={spent > budget ? 'warn' : 'dim'}>{`${fmt$(spent)} / ${fmt$(budget)}${!st.started ? ` · proj ${projTotal.toFixed(1)}` : ''}`}</Mono>
          </View>
          {slots.map((d) => {
            const slug = picks[d.slot];
            const p = slug ? bySlug.get(slug) : null;
            const target = theCard?.targets[d.slot];
            const lv = liveOf(d.slot);
            const isLocked = locked(slug);
            const canTap = editable && !isLocked;
            return (
              <Pressable key={d.slot} disabled={!canTap} onPress={() => { tap(); setActive(d.slot); setSearch(''); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: t.bd }}>
                <View style={{ width: 56, alignItems: 'center', borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingVertical: 4 }}>
                  <Mono size={10} weight="700">{labels[d.slot]}</Mono>
                  {bull && !isTotal && target != null && <Mono size={12} tone="you" weight="700">{String(target)}</Mono>}
                  {!bull && d.zeroPts != null && <Mono size={8} tone="dim">{`0 → ${d.zeroPts}`}</Mono>}
                  {myTb?.slot === d.slot && <Mono size={8} tone="dim">{`⚖️ ${myTb.target}`}</Mono>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {p ? (
                    <>
                      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.text }}>{`${p.name}${isLocked ? ' 🔒' : ''}`}</Text>
                      <Mono size={8.5} tone="faint">{`${p.pos} · ${p.team} · ${fmt$(p.salary)} · proj ${p.proj.toFixed(1)}`}</Mono>
                    </>
                  ) : <Mono size={10} tone={editable ? 'you' : 'faint'}>{editable ? `+ PICK ${labels[d.slot]}` : 'empty'}</Mono>}
                </View>
                <View style={{ width: 78, alignItems: 'flex-end' }}>
                  {lv ? (
                    <>
                      <Mono size={12} weight="700">{lv.score.toFixed(1)}</Mono>
                      {lv.aim && <Mono size={8.5} tone={lv.aim.ring > 0 ? 'you' : 'faint'}>{`${ringLabel(lv.aim.dist, radius)} +${lv.aim.ring}`}</Mono>}
                    </>
                  ) : p && bull && !isTotal && target != null ? <Mono size={8.5} tone="faint">{`aims ${projectedRing(p.proj, target, radius).toFixed(1)}`}</Mono> : null}
                </View>
              </Pressable>
            );
          })}
          {editable && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <Chip on label="SAVE SQUAD" disabled={busy || filled < n || spent > budget} onPress={() => { tap(); void save(); }} />
              <Mono size={9} tone="faint">{filled < n ? `${n - filled} to fill · ${fmt$(budget - spent)} left` : `${fmt$(budget - spent)} left`}</Mono>
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

      <Overlay visible={!!active} onClose={() => setActive(null)}
        title={active ? `${labels[active]}${bull && !isTotal && theCard ? ` · aim at ${theCard.targets[active]}` : ''}` : ''}
        subtitle={sortedNote}>
        {active && (
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <TextInput value={search} onChangeText={setSearch} placeholder="Search players or teams…" placeholderTextColor={t.faint}
                style={{ flex: 1, color: t.text, borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14 }} />
              {picks[active] && <Chip small dim label="CLEAR" onPress={() => { tap(); setPicks({ ...picks, [active]: null }); setActive(null); }} />}
            </View>
            <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
              {candidates(active).map(({ r, dist, afford, lock }) => (
                <Pressable key={r.slug} disabled={!afford || lock} onPress={() => { tap(); setPicks({ ...picks, [active]: r.slug }); setActive(null); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.bd, opacity: afford && !lock ? 1 : 0.45 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: t.text }}>{r.name}</Text>
                    <Mono size={8.5} tone="faint">{`${r.pos} · ${r.team}${lock ? ' · locked' : !afford ? ' · over budget' : ''}`}</Mono>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Mono size={10}>{`${fmt$(r.salary)} · ${r.proj.toFixed(1)}`}</Mono>
                    {bull && !isTotal && <Mono size={8.5} tone={dist <= radius / 5 ? 'you' : 'faint'}>{`${dist.toFixed(1)} off`}</Mono>}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </Overlay>
    </View>
  );
}
