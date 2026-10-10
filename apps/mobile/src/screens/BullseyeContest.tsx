// DFS BULLSEYE, native (v0.660.0) — the web twin's note
// (src/screens/BullseyeContest.tsx) and docs/dfs-bullseye.md. The phone had
// no salary-cap builder at all; this is one, built around the card: every
// slot shows its number, the pick sheet sorts by how close a projection
// lands to it, and once the week is on the same screen shows the live darts.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import {
  bullseyeContest, joinBullseyeContest, saveBullseyeEntry, dfsBullseyeState, bullseyeContestBoard, setBullseyeContest,
  podSalaries, weekGameLocks, isAdmin, friendlyError,
  type BullseyeContest, type DfsBullseyeState, type PodSalaryRow, type BullseyeBoardRow, type DfsVariant,
} from '@drip/core/data/liveApi';
import { DFS_SLOTS, DFS_CAP, DFS_MIN_SALARY, dfsCard, dfsSlotsOf, dfsSlotLabel, projectedRing, dfsBullseyeConfigOf, dfsTiebreak, tiebreakDistance, sealedSquadOf, type DfsSlot } from '@drip/core/engine/dfsBullseye';
import { ringLabel } from '@drip/core/engine/bullseye';
import { useTheme } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, Mono } from '../ui/prims';
import { Overlay } from '../ui/Overlay';

const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;
const VARIANT_WORD: Record<DfsVariant, string> = { slots: 'SLOT TARGETS', total: 'ONE TEAM TOTAL' };
const howTo = (v: DfsVariant, radius: number) => v === 'total'
  ? `Build a squad whose points land as close to the card's total as you can. Dead-on doubles your score; any player who posts a zero costs ${radius}.`
  : `Every slot has a number. Pick the player you think lands closest to it: ${radius} points for dead-on plus ${radius} more for a bullseye, less the farther off. A zero costs ${radius}.`;

/** Your leagues' door to this week's open contest. */
export function BullseyeContestBanner({ onOpen }: { onOpen: (leagueId: string, week: number) => void }) {
  const t = useTheme();
  const [c, setC] = useState<BullseyeContest | null>(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => bullseyeContest().then(setC).catch(() => {}), []);
  useEffect(() => { void load(); isAdmin().then((a) => setAdmin(!!a)).catch(() => {}); }, [load]);
  if (!c?.ok || !c.league_id || c.week == null) return null;
  const join = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await joinBullseyeContest();
      if (!r.ok || !r.league_id) { warn(); setErr(r.error ?? 'Couldn’t join.'); return; }
      commit(); onOpen(r.league_id, r.week ?? c.week!);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const switchVariant = async (v: DfsVariant) => {
    setBusy(true); setErr(null);
    const r = await setBullseyeContest(c.week!, v, c.radius ?? 10).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'Couldn’t change it.'); else await load();
    setBusy(false);
  };
  const entered = !!c.me?.entered;
  return (
    <View style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 10, padding: 12, backgroundColor: t.surface, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Mono size={10.5} tone="you" weight="700" track={0.1}>🎯 WEEKLY BULLSEYE</Mono>
        <Mono size={9} tone="faint">{`Week ${c.week} · ${VARIANT_WORD[c.variant ?? 'slots']} · ${c.entries ?? 0} ${c.entries === 1 ? 'entry' : 'entries'}`}</Mono>
      </View>
      <Text style={{ fontSize: 13, color: t.dim, lineHeight: 18 }}>A $50,000 squad aimed at this week’s numbers, against everyone. Closest wins.</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {c.me
          ? <Chip on={!entered} label={c.started ? (entered ? 'MY DARTS & STANDINGS' : 'STANDINGS') : entered ? 'EDIT MY SQUAD' : 'BUILD MY SQUAD'} onPress={() => { tap(); onOpen(c.league_id!, c.week!); }} />
          : <Chip on disabled={busy} label={c.started ? 'JOIN — LATE GAMES OPEN' : 'JOIN THIS WEEK'} onPress={() => { tap(); void join(); }} />}
        {admin && !c.started && (['slots', 'total'] as const).map((v) => (
          <Chip key={v} small dim={c.variant !== v} on={c.variant === v} disabled={busy} label={`ADMIN ${v.toUpperCase()}`} onPress={() => { tap(); void switchVariant(v); }} />
        ))}
      </View>
      {err && <Mono size={9} tone="warn">{err}</Mono>}
    </View>
  );
}

/** A salary-cap league opened from Your leagues: its Bullseye squad screen
 *  when it plays Bullseye, else whatever the app always showed. */
export function BullseyeGate({ leagueId, fallback, onBack }: { leagueId: string; fallback: ReactNode; onBack: () => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { dfsBullseyeState(leagueId).then((s) => setOn(!!(s.ok && s.on))).catch(() => setOn(false)); }, [leagueId]);
  // The usual screen while asking — every other league opens with no wait.
  return on ? <BullseyeSquad leagueId={leagueId} onBack={onBack} /> : <>{fallback}</>;
}

export function BullseyeSquad({ leagueId, week: weekProp, onBack }: { leagueId: string; week?: number; onBack: () => void }) {
  const t = useTheme();
  const [st, setSt] = useState<DfsBullseyeState | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[] | null>(null);
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [picks, setPicks] = useState<Record<DfsSlot, string | null>>(() => dfsSlotsOf(null));
  const [active, setActive] = useState<DfsSlot | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const load = useCallback(async () => {
    const s = await dfsBullseyeState(leagueId, weekProp);
    setSt(s);
    if (!s.ok || !s.on || s.week == null) return;
    setPicks(dfsSlotsOf(s.entry));
    const [rows, lk] = await Promise.all([podSalaries(s.week).catch(() => []), weekGameLocks(s.week).catch(() => new Map<string, number>())]);
    setBoard(rows); setLocks(lk);
  }, [leagueId, weekProp]);
  useEffect(() => { void load().catch((e) => setNote(friendlyError(e))); }, [load]);
  useEffect(() => {
    if (!st?.started || st.matchup?.status === 'final') return;
    const id = setInterval(() => { void dfsBullseyeState(leagueId, weekProp).then(setSt).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [st?.started, st?.matchup?.status, leagueId, weekProp]);

  const bySlug = useMemo(() => new Map((board ?? []).map((r) => [r.slug, r])), [board]);
  const theCard = useMemo(() => (st?.week != null ? dfsCard(leagueId, st.week) : null), [leagueId, st?.week]);
  const cfg = st?.on ? dfsBullseyeConfigOf({ dfs_bullseye: true, bullseye: st.variant, bullseye_radius: st.radius }) : null;
  const locked = (slug: string | null) => { if (!slug) return false; const at = locks.get(bySlug.get(slug)?.team ?? ''); return at != null && at <= now; };
  const spent = Object.values(picks).reduce((s, slug) => s + (slug ? bySlug.get(slug)?.salary ?? 0 : 0), 0);
  const filled = Object.values(picks).filter(Boolean).length;
  const projTotal = Object.values(picks).reduce((s, slug) => s + (slug ? bySlug.get(slug)?.proj ?? 0 : 0), 0);

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
      <Chip label="← BACK" onPress={() => { tap(); onBack(); }} />
      <Mono size={10.5} tone="you" weight="700" track={0.1} style={{ flex: 1 }} numberOfLines={1}>{`🎯 ${st?.name ?? 'BULLSEYE'}`}</Mono>
    </View>
  );
  if (!st) return <View style={{ flex: 1, backgroundColor: t.bg }}>{header}</View>;
  if (!st.ok || !st.on || !cfg || !theCard) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {header}
        <Mono size={10} tone={st.ok ? 'faint' : 'warn'} style={{ padding: 16 }}>{st.ok ? 'This league doesn’t play Bullseye.' : st.error ?? ''}</Mono>
      </View>
    );
  }
  const isTotal = cfg.variant === 'total';
  const mySide: 'home' | 'away' = st.matchup && st.matchup.home !== st.roster_id ? 'away' : 'home';
  const live = st.state?.slots?.filter((r) => r.side === mySide) ?? [];
  const liveOf = (slot: string) => live.find((r) => r.slot === slot);
  const myRing = st.matchup?.status === 'final' ? (mySide === 'home' ? st.matchup.home_final : st.matchup.away_final) : st.state ? (mySide === 'home' ? st.state.home : st.state.away) : null;
  const theirRing = st.opponent && st.state ? (mySide === 'home' ? st.state.away : st.state.home) : null;
  const myPoints = live.reduce((s, r) => s + (r.score || 0), 0);
  const editable = st.matchup?.status !== 'final';
  // THE TIE-BREAKER (v0.660.1): my own spot and number, known before I build.
  const myTb = st.roster_id != null && st.week != null ? dfsTiebreak(leagueId, st.week, st.roster_id, theCard) : null;
  const tbLive = myTb ? liveOf(myTb.slot) : undefined;
  const myTbDist = st.matchup?.status === 'final'
    ? (mySide === 'home' ? st.matchup.home_tb : st.matchup.away_tb) ?? null
    : tbLive ? tiebreakDistance(tbLive.score, myTb!.target, cfg.radius) : null;
  const tieBroken = st.matchup?.status === 'final' && st.opponent && myRing != null && theirRing != null && Math.abs(Number(myRing) - Number(theirRing)) < 0.0101 && Number(myRing) !== Number(theirRing);
  const theirSquad = st.opponent ? sealedSquadOf(st.opponent.entry) : [];

  const save = async () => {
    if (st.week == null) return;
    if (filled < 9) { setNote('Fill all nine slots first.'); return; }
    setBusy(true); setNote(null);
    try {
      const r = await saveBullseyeEntry(leagueId, st.week, picks as Record<string, string>);
      if (r.ok) { commit(); setNote('✓ squad saved'); await load(); } else { warn(); setNote(r.error ?? 'Didn’t save.'); }
    } catch (e) { warn(); setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const candidates = (slot: DfsSlot) => {
    const pos = DFS_SLOTS.find((d) => d.slot === slot)!.pos[0];
    const target = theCard.targets[slot];
    const taken = new Set(Object.entries(picks).filter(([s, v]) => s !== slot && v).map(([, v]) => v));
    const cur = picks[slot] ? bySlug.get(picks[slot]!)?.salary ?? 0 : 0;
    const room = DFS_CAP - spent + cur - (9 - filled - (picks[slot] ? 0 : 1)) * DFS_MIN_SALARY;
    const needle = search.trim().toLowerCase();
    return (board ?? [])
      .filter((r) => r.pos === pos && !taken.has(r.slug) && (!needle || r.name.toLowerCase().includes(needle) || r.team.toLowerCase().includes(needle)))
      .map((r) => ({ r, dist: Math.abs(r.proj - target), afford: r.salary <= room, lock: locked(r.slug) }))
      .sort((a, b) => (isTotal ? b.r.proj - a.r.proj : a.dist - b.dist) || a.r.salary - b.r.salary)
      .slice(0, 60);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load().catch(() => {}); setRefreshing(false); }} tintColor={t.you} />}>
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Mono size={9} tone="faint" weight="700" track={0.1}>{`WEEK ${st.week} · ${VARIANT_WORD[cfg.variant]}`}</Mono>
            {isTotal && <Display size={22}>{String(theCard.total)}</Display>}
          </View>
          {!isTotal && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
              {DFS_SLOTS.map((d) => (
                <View key={d.slot} style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: 'row', gap: 4 }}>
                  <Mono size={9.5} tone="dim">{dfsSlotLabel(d.slot)}</Mono>
                  <Mono size={9.5} tone="you" weight="700">{String(theCard.targets[d.slot])}</Mono>
                </View>
              ))}
            </View>
          )}
          <Text style={{ fontSize: 12, color: t.dim, lineHeight: 17 }}>{howTo(cfg.variant, cfg.radius)}</Text>
          {myTb && (
            <Mono size={9.5} tone="dim" style={{ borderTopWidth: 1, borderTopColor: t.bd, paddingTop: 6, lineHeight: 14 }}>
              {`⚖️ TIE-BREAKER: your ${dfsSlotLabel(myTb.slot)} aims at ${myTb.target} — it only counts if you tie, and closer wins.${myTbDist != null ? ` Now ${myTbDist.toFixed(1)} off.` : ''}`}
            </Mono>
          )}
        </Card>

        {st.started && (
          <Card style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint" weight="700">{st.matchup?.status === 'final' ? 'FINAL' : 'LIVE'}</Mono>
            <Display size={24}>{myRing != null ? Number(myRing).toFixed(1) : '—'}</Display>
            <Mono size={9} tone="faint">{`${myPoints.toFixed(1)} pts${isTotal ? ` · ${Math.abs(myPoints - theCard.total).toFixed(1)} off ${theCard.total}` : ''}`}</Mono>
            {st.opponent && <Mono size={9} tone="dim">{`vs ${st.opponent.team ?? 'opponent'} · ${theirRing != null ? Number(theirRing).toFixed(1) : '—'}`}</Mono>}
            {tieBroken && <Mono size={8.5} tone="faint" style={{ width: '100%' }}>{`Tied on rings — settled by the tie-breaker (${myTbDist?.toFixed(1) ?? '—'} off vs ${(mySide === 'home' ? st.matchup!.away_tb : st.matchup!.home_tb)?.toFixed(1) ?? '—'} off).`}</Mono>}
          </Card>
        )}

        <Card style={{ gap: 0 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Mono size={9} tone="faint" weight="700" track={0.1}>MY SQUAD</Mono>
            <Mono size={9} tone={spent > DFS_CAP ? 'warn' : 'dim'}>{`${fmt$(spent)} / ${fmt$(DFS_CAP)}${isTotal && !st.started ? ` · proj ${projTotal.toFixed(1)}` : ''}`}</Mono>
          </View>
          {DFS_SLOTS.map((d) => {
            const slug = picks[d.slot];
            const p = slug ? bySlug.get(slug) : null;
            const target = theCard.targets[d.slot];
            const lv = liveOf(d.slot);
            const isLocked = locked(slug);
            const canTap = editable && !isLocked;
            return (
              <Pressable key={d.slot} disabled={!canTap} onPress={() => { tap(); setActive(d.slot); setSearch(''); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: t.bd }}>
                <View style={{ width: 52, alignItems: 'center', borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingVertical: 4 }}>
                  <Mono size={10} weight="700">{dfsSlotLabel(d.slot)}</Mono>
                  {!isTotal && <Mono size={12} tone="you" weight="700">{String(target)}</Mono>}
                  {myTb?.slot === d.slot && <Mono size={8} tone="dim">{`⚖️ ${myTb.target}`}</Mono>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {p ? (
                    <>
                      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.text }}>{`${p.name}${isLocked ? ' 🔒' : ''}`}</Text>
                      <Mono size={8.5} tone="faint">{`${p.team} · ${fmt$(p.salary)} · proj ${p.proj.toFixed(1)}`}</Mono>
                    </>
                  ) : <Mono size={10} tone={editable ? 'you' : 'faint'}>{editable ? `+ PICK ${dfsSlotLabel(d.slot)}` : 'empty'}</Mono>}
                </View>
                <View style={{ width: 78, alignItems: 'flex-end' }}>
                  {lv ? (
                    <>
                      <Mono size={12} weight="700">{lv.score.toFixed(1)}</Mono>
                      {lv.aim && <Mono size={8.5} tone={lv.aim.ring > 0 ? 'you' : 'faint'}>{`${ringLabel(lv.aim.dist, cfg.radius)} +${lv.aim.ring}`}</Mono>}
                    </>
                  ) : p && !isTotal ? <Mono size={8.5} tone="faint">{`aims ${projectedRing(p.proj, target, cfg.radius).toFixed(1)}`}</Mono> : null}
                </View>
              </Pressable>
            );
          })}
          {editable && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <Chip on label="SAVE SQUAD" disabled={busy || filled < 9 || spent > DFS_CAP} onPress={() => { tap(); void save(); }} />
              <Mono size={9} tone="faint">{filled < 9 ? `${9 - filled} to fill · ${fmt$(DFS_CAP - spent)} left` : `${fmt$(DFS_CAP - spent)} left`}</Mono>
            </View>
          )}
          {note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'warn'} style={{ marginTop: 6 }}>{note}</Mono>}
        </Card>

        {/* THEIR SQUAD, SEALED (v0.660.1): each player shows once his game locks. */}
        {st.opponent && (
          <Card style={{ gap: 0 }}>
            <Mono size={9} tone="faint" weight="700" track={0.1} style={{ marginBottom: 6 }}>{`${(st.opponent.team ?? 'OPPONENT').toUpperCase()}’S SQUAD`}</Mono>
            {theirSquad.map((r) => {
              const lv = st.state?.slots?.find((x) => x.side !== mySide && x.slot === r.slot);
              const p = r.slug ? bySlug.get(r.slug) : null;
              return (
                <View key={r.slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.bd }}>
                  <Mono size={9.5} tone="faint" style={{ width: 40 }}>{dfsSlotLabel(r.slot)}</Mono>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: r.slug ? t.text : t.faint }}>{r.slug ? (p?.name ?? r.slug) : '🔒 sealed until his game locks'}</Text>
                  <Mono size={10}>{lv ? lv.score.toFixed(1) : ''}</Mono>
                </View>
              );
            })}
          </Card>
        )}

        {st.kind === 'bullseye' && <BullseyeLeaderboard leagueId={leagueId} />}
      </ScrollView>

      <Overlay visible={!!active} onClose={() => setActive(null)}
        title={active ? `${dfsSlotLabel(active)}${!isTotal ? ` · aim at ${theCard.targets[active]}` : ''}` : ''}
        subtitle={isTotal ? 'SORTED BY PROJECTION' : 'SORTED BY HOW CLOSE HE LANDS TO THE NUMBER'}>
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
                    <Mono size={8.5} tone="faint">{`${r.team}${lock ? ' · locked' : !afford ? ' · over budget' : ''}`}</Mono>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Mono size={10}>{`${fmt$(r.salary)} · ${r.proj.toFixed(1)}`}</Mono>
                    {!isTotal && <Mono size={8.5} tone={dist <= cfg.radius / 5 ? 'you' : 'faint'}>{`${dist.toFixed(1)} off`}</Mono>}
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

export function BullseyeLeaderboard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [b, setB] = useState<{ started?: boolean; entries?: number; rows?: BullseyeBoardRow[]; me?: BullseyeBoardRow | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => bullseyeContestBoard(leagueId).then((r) => { if (alive && r.ok) setB(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [leagueId]);
  if (!b) return null;
  return (
    <Card style={{ gap: 2 }}>
      <Mono size={9} tone="faint" weight="700" track={0.1}>{`STANDINGS · ${b.entries ?? 0} ${b.entries === 1 ? 'ENTRY' : 'ENTRIES'}`}</Mono>
      {!b.started && <Mono size={9} tone="faint">Squads and scores show once the week’s first game locks.</Mono>}
      {(b.rows ?? []).map((r) => (
        <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.bd }}>
          <Mono size={10} tone={r.me ? 'you' : 'dim'} style={{ width: 28 }}>{String(r.rank)}</Mono>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: r.me ? t.you : t.text, fontWeight: r.me ? '700' : '400' }}>{r.team_name ?? `Team ${r.roster_id}`}</Text>
          <Mono size={9} tone="faint">{`${Number(r.points).toFixed(1)} pts${r.tb != null && (b.rows ?? []).some((o) => o.roster_id !== r.roster_id && Number(o.ring) === Number(r.ring)) ? ` · ⚖️${Number(r.tb).toFixed(1)}` : ''}`}</Mono>
          <Mono size={11} weight="700" tone={r.me ? 'you' : 'text'} style={{ width: 52, textAlign: 'right' }}>{Number(r.ring).toFixed(1)}</Mono>
        </View>
      ))}
      {b.me && !(b.rows ?? []).some((r) => r.me) && (
        <Mono size={10} tone="you" weight="700" style={{ marginTop: 6 }}>{`You: #${b.me.rank} · ${Number(b.me.ring).toFixed(1)}`}</Mono>
      )}
    </Card>
  );
}
