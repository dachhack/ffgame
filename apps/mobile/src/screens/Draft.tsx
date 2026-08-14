// The draft room — snake and auction — for native leagues.
//
// A straight port of the web DraftRoom (src/screens/NativeLeague.tsx): same
// draft_state poll, same skewed countdowns, same draft_tick self-driving rule.
// The room logic is deliberately identical because the server is the game —
// this screen only ever ASKS (make_draft_pick, nominate, place_bid) and shows
// what draft_state answered. What changed is the layout: the web runs board and
// panel side by side; a phone gets the board as a tab, columns-per-team in a
// horizontal scroll, because a 12-team grid does not fit 360dp any other way.
//
// Self-driving: any member's poll calls draft_tick when a clock is overdue or
// the acting seat is auto. That's what lets a phone-only league draft with no
// worker awake — the room advances as long as ANYONE has it open.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  draftState, draftTick, leaguePool, makeDraftPick, myDraftQueue, nativeTeamState, nominate, placeBid,
  setAutodraft, setDraftQueue, setLotProxy, startDraft, seedLeaguePool,
  commishPauseDraft, commishResumeDraft, commishForcePick, commishUndoPick,
  friendlyError, type DraftState, type LeaguePoolPlayer, type NativeTeamState, type PosCaps,
} from '@drip/core/data/liveApi';
import { buildDraftPool } from '@drip/core/data/nativeLeague';
import { ADP_2026 } from '@drip/core/data/adp2026';
import { PROJ_2026 } from '@drip/core/data/proj2026';
import { headshot } from '@drip/core/data/media';
import { myFavorites, loadTeamOverrides, playerFlags } from '@drip/core/data/liveApi';
import { setLeagueFlags } from '@drip/core/data/commish';
import { FlagChip } from '../ui/rosterGroup';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PosPill, PrimaryButton } from '../ui/prims';
import { starApply, STAR_GOLD, type StarMode } from '../ui/stars';

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
}

/** Small round headshot with a position-pill fallback — the row identity. */
function Face({ slug, pos, size = 26 }: { slug: string; pos: string; size?: number }) {
  const t = useTheme();
  const src = headshot(slug);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {src
        ? <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        : <Text style={{ fontFamily: MONO, fontSize: size * 0.32, fontWeight: '700', color: t.faint }}>{pos}</Text>}
    </View>
  );
}

type DraftTab = 'board' | 'players' | 'teams' | 'queue';

export function Draft({ leagueId, onBack }: { leagueId: string; onBack: () => void }) {
  const t = useTheme();
  const [st, setSt] = useState<DraftState | null>(null);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [tab, setTab] = useState<DraftTab>('players');
  const [teamView, setTeamView] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>('ALL');
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [starMode, setStarMode] = useState<StarMode>('off');
  const [, setFlagVer] = useState(0); // commish flags landed in the cache (0141)
  const [proxyDraft, setProxyDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0);
  const ticking = useRef(false);

  const refresh = async () => {
    try {
      const s = await draftState(leagueId);
      if (s.error) { setErr(friendlyError(s.error)); return; }
      skew.current = Date.parse(s.server_now) - Date.now();
      setSt(s); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => {
    void refresh();
    leaguePool(leagueId).then(setPool).catch(() => {});
    myFavorites().then(setFavs).catch(() => {});
    void loadTeamOverrides();
    playerFlags(leagueId).then((f) => { if (Array.isArray(f)) { setLeagueFlags(leagueId, f); setFlagVer((v) => v + 1); } }).catch(() => {});
    nativeTeamState(leagueId).then((tm) => {
      setTeam(tm);
      if (tm.my_roster_id != null) myDraftQueue(leagueId, tm.my_roster_id).then(setQueue).catch(() => {});
    }).catch(() => {});
    const poll = setInterval(refresh, 3000);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => { clearInterval(poll); clearInterval(clock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Advance the room when any clock is overdue or the acting seat is auto —
  // identical to the web (see the header comment).
  const allDeadlines = [
    ...(st?.deadline_at ? [Date.parse(st.deadline_at)] : []),
    ...(st?.lots ?? []).map((l) => Date.parse(l.deadline_at)),
  ];
  const deadlineMs = allDeadlines.length ? Math.min(...allDeadlines) : null;
  const overdueMs = deadlineMs != null ? (now + skew.current) - deadlineMs : null;
  useEffect(() => {
    if (st?.status !== 'live' || st.paused || ticking.current) return;
    if ((overdueMs != null && overdueMs > 1200) || st.on_clock_auto) {
      ticking.current = true;
      // A failing tick must be VISIBLE — swallowing it freezes the room at 0:00
      // with nothing to go on. The 3s poll clears the banner on recovery.
      draftTick(leagueId).then((r) => {
        if (r.error) setErr(friendlyError(r.error));
        if ((r.autopicks ?? 0) + (r.lots_awarded ?? 0) > 0) void refresh();
      }).catch(() => {})
        .finally(() => { ticking.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, st?.status, st?.on_clock, st?.lots?.length]);

  const byRoster = useMemo(() => {
    const m: Record<number, { team: string | null; avatar: string | null }> = {};
    for (const w of team?.waiver_order ?? []) m[w.roster_id] = { team: w.team, avatar: w.avatar ?? null };
    return m;
  }, [team]);
  const teamName = (rid: number | null | undefined) => (rid == null ? null : byRoster[rid]?.team ?? null);
  const poolBySlug = useMemo(() => new Map(pool.map((p) => [p.slug, p])), [pool]);
  const taken = useMemo(() => new Set((st?.picks ?? []).map((p) => p.slug)), [st?.picks]);
  const myRoster = team?.my_roster_id ?? null;
  const isCommish = !!team?.is_commish;
  const auction = st?.mode === 'auction';
  const myTurn = st?.status === 'live' && !st.paused && st.on_clock != null && st.on_clock === myRoster;
  const myBudget = auction ? st?.budgets?.find((b) => b.roster_id === myRoster) : null;

  // Position limits: grey out players my roster can't legally take (the server
  // enforces too — this just saves the round trip). Auction counts lots I hold.
  const myPosCount = useMemo(() => {
    const c: Record<string, number> = {};
    if (myRoster == null) return c;
    for (const pk of st?.picks ?? []) {
      if (pk.roster_id !== myRoster) continue;
      const p = poolBySlug.get(pk.slug)?.pos; if (p) c[p] = (c[p] ?? 0) + 1;
    }
    for (const l of st?.lots ?? []) {
      if (l.roster_id !== myRoster) continue;
      const p = poolBySlug.get(l.slug)?.pos; if (p) c[p] = (c[p] ?? 0) + 1;
    }
    return c;
  }, [st?.picks, st?.lots, myRoster, poolBySlug]);
  const atCap = (p: string) => {
    const cap = st?.pos_caps?.[p as keyof PosCaps];
    return cap != null && (myPosCount[p] ?? 0) >= cap;
  };

  const avail = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = pool.filter((p) => !taken.has(p.slug)
      && (pos === 'ALL' || p.pos === pos)
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
    return starApply(base, starMode, favs, (p) => p.slug);
  }, [pool, taken, q, pos, starMode, favs]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'That didn’t work.')); } else commit();
      await refresh();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const saveQueue = (next: string[]) => {
    setQueue(next);
    if (myRoster != null) setDraftQueue(leagueId, myRoster, next).catch(() => {});
  };
  const toggleQueue = (slug: string) => {
    tap();
    saveQueue(queue.includes(slug) ? queue.filter((s) => s !== slug) : [...queue, slug]);
  };
  const moveQueue = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= queue.length) return;
    const next = queue.slice(); [next[i], next[j]] = [next[j], next[i]];
    saveQueue(next);
  };

  const act = (slug: string) => {
    if (!myTurn) return;  // auction: on_clock is null while the room is at lot capacity
    void run(() => (auction ? nominate(leagueId, slug, 1) : makeDraftPick(leagueId, slug)));
  };

  if (!st) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {err ? <Mono size={10.5} tone="opp">{err}</Mono> : <ActivityIndicator color={t.you} />}
        <LinkButton label="← back" onPress={onBack} />
      </View>
    );
  }

  const teams = st.order?.length ?? 0;
  const round = teams ? Math.min(st.rounds, Math.floor((st.current_overall - 1) / teams) + 1) : 1;
  const nomMs = st.deadline_at ? Date.parse(st.deadline_at) : null;
  const nomSecsLeft = st.paused ? null : nomMs != null ? Math.max(0, Math.ceil((nomMs - (now + skew.current)) / 1000)) : null;
  const lotSecsLeft = (l: { deadline_at: string }) =>
    st.paused ? null : Math.max(0, Math.ceil((Date.parse(l.deadline_at) - (now + skew.current)) / 1000));
  const pickRowsFor = (rid: number) => (st.picks ?? []).filter((p) => p.roster_id === rid);

  const ghost = (label: string, onPress: () => void, tone?: string) => (
    <Pressable key={label} onPress={() => { tap(); onPress(); }} disabled={busy}
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, opacity: busy ? 0.5 : 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: tone ?? t.dim }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
      {/* header: mode + state chips */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Display size={17}>⛏ Draft room</Display>
        <Mono size={9} tone="faint" track={0.1}>{auction ? 'AUCTION' : 'SNAKE'}</Mono>
        {st.is_mock && <Mono size={9} tone="warn" track={0.1}>🤖 MOCK</Mono>}
        {st.paused && <Mono size={9} tone="warn" track={0.1}>⏸ PAUSED</Mono>}
        {st.night?.is_night && <Mono size={9} tone="warn" track={0.06}>🌙 quiet hours</Mono>}
        <View style={{ flex: 1 }} />
        <LinkButton label="← back" onPress={onBack} />
      </View>

      {!!err && <Notice tone="opp"><Mono size={10} tone="opp">{err}</Mono></Notice>}

      {st.status === 'pending' && (
        <Card>
          <Display size={15}>Waiting to start</Display>
          <Mono size={10} style={{ marginTop: 8, lineHeight: 16 }}>
            {auction
              ? `${st.rounds} roster spots · $${st.budget} budget per team · nomination rotates the draft order. Queue players now — empty seats auto-nominate.`
              : `${st.rounds} rounds · ${st.pick_seconds}s per pick · snake order (randomized at start). Queue players now — your queue drafts for you if the clock runs out.`}
          </Mono>
          {isCommish && (
            <View style={{ marginTop: 12, gap: 8 }}>
              <PrimaryButton label="▶ START THE DRAFT" disabled={busy} onPress={() => run(() => startDraft(leagueId))} />
              {pool.length === 0 && (
                <PrimaryButton label="↻ SEED PLAYER POOL (2026 ADP)" disabled={busy}
                  onPress={() => run(async () => {
                    const r = await seedLeaguePool(leagueId, await buildDraftPool());
                    setPool(await leaguePool(leagueId));
                    return r;
                  })} />
              )}
            </View>
          )}
        </Card>
      )}

      {st.status === 'live' && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: t.you }}>
          {/* auction lots — up to max_lots in parallel, each with its own bell */}
          {auction && (st.lots ?? []).map((lot, li) => {
            const lp = poolBySlug.get(lot.slug);
            const left = lotSecsLeft(lot);
            const iHold = lot.roster_id === myRoster;
            const canBidLot = myRoster != null && !iHold && (lot.my_max ?? 0) > lot.bid && !st.paused;
            const quick = canBidLot
              ? [lot.bid + 1, lot.bid + 5, lot.bid + 10].filter((a, i, arr) => a <= (lot.my_max ?? 0) && arr.indexOf(a) === i)
              : [];
            const pd = proxyDraft[lot.id] ?? '';
            return (
              <View key={lot.id} style={{ borderTopWidth: li ? StyleSheet.hairlineWidth : 0, borderTopColor: t.bd, paddingTop: li ? 10 : 0, marginTop: li ? 10 : 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Face slug={lot.slug} pos={lp?.pos ?? '?'} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: t.text }}>{lp?.full_name ?? lot.slug}</Text>
                    <Mono size={9.5} style={{ marginTop: 2 }}>
                      ${lot.bid} — {teamName(lot.roster_id) ?? `Team ${lot.roster_id}`}{iHold ? ' (you)' : ''}
                    </Mono>
                  </View>
                  {left != null && (
                    <Text style={{ fontFamily: MONO, fontSize: 22, fontWeight: '700', color: left <= 5 ? t.opp : t.you, fontVariant: ['tabular-nums'] }}>
                      {fmtCountdown(left)}
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {quick.map((a) => (
                    <Pressable key={a} disabled={busy}
                      onPress={() => { tap(); myRoster != null && void run(() => placeBid(leagueId, myRoster, a, lot.id)); }}
                      style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, opacity: busy ? 0.5 : 1 }}>
                      <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: t.onAccent }}>BID ${a}</Text>
                    </Pressable>
                  ))}
                  {iHold && <Mono size={9.5} tone="you">You're the high bidder.</Mono>}
                  {/* hidden max (proxy): answers rival bids second-price style
                      while you're away — nobody ever sees your ceiling */}
                  {myRoster != null && (lot.my_max ?? 0) > 0 && !iHold && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                      <Mono size={8.5} tone="faint" track={0.1}>🕶 MAX</Mono>
                      {lot.my_proxy != null ? (
                        <>
                          <Mono size={10} tone="you" weight="700">${lot.my_proxy}</Mono>
                          <LinkButton label="clear" tone="opp" onPress={() => run(() => setLotProxy(leagueId, myRoster, null, lot.id))} />
                        </>
                      ) : (
                        <>
                          <TextInput value={pd} keyboardType="number-pad" placeholder="$" placeholderTextColor={t.faint}
                            onChangeText={(v) => setProxyDraft({ ...proxyDraft, [lot.id]: v.replace(/\D/g, '') })}
                            style={{ width: 54, paddingHorizontal: 7, paddingVertical: 4, fontFamily: MONO, fontSize: 11, color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, backgroundColor: t.bg }} />
                          {ghost('SET', () => {
                            if (!pd) return;
                            void run(() => setLotProxy(leagueId, myRoster, parseInt(pd, 10), lot.id));
                            setProxyDraft({ ...proxyDraft, [lot.id]: '' });
                          }, t.you)}
                        </>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })}

          {/* nomination / pick banner */}
          {(!auction || st.on_clock != null) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: auction && (st.lots ?? []).length > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: t.bd, paddingTop: auction && (st.lots ?? []).length > 0 ? 10 : 0, marginTop: auction && (st.lots ?? []).length > 0 ? 10 : 0 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Mono size={9} tone="faint" track={0.12}>
                  {auction ? `NOMINATION ${st.current_overall + (st.lots ?? []).length}` : `ROUND ${round} / ${st.rounds} · PICK ${st.current_overall}`}
                </Mono>
                <Text numberOfLines={2} style={{ fontSize: 15.5, fontWeight: '700', color: myTurn ? t.you : t.text, marginTop: 3 }}>
                  {myTurn ? (auction ? 'YOUR NOMINATION — pick below' : 'YOUR PICK')
                    : `${auction ? 'Nominating' : 'On the clock'}: ${teamName(st.on_clock) ?? `Team ${st.on_clock} (auto)`}`}
                </Text>
              </View>
              {nomSecsLeft != null && (
                <Text style={{ fontFamily: MONO, fontSize: 26, fontWeight: '700', color: nomSecsLeft <= 10 ? t.opp : t.you, fontVariant: ['tabular-nums'] }}>
                  {fmtCountdown(nomSecsLeft)}
                </Text>
              )}
            </View>
          )}
          {auction && myBudget && (
            <Mono size={9} tone="faint" style={{ marginTop: 8 }}>
              my budget ${myBudget.budget}{myBudget.committed > 0 ? ` · committed $${myBudget.committed}` : ''} · max new bid ${myBudget.max_bid} · {(st.lots ?? []).length}/{st.max_lots} lots open
            </Mono>
          )}
          {isCommish && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10, marginTop: 10 }}>
              <Mono size={8.5} tone="faint" track={0.1}>⚑ COMMISH</Mono>
              {st.paused
                ? ghost('▶ RESUME', () => void run(() => commishResumeDraft(leagueId)))
                : ghost('⏸ PAUSE', () => void run(() => commishPauseDraft(leagueId)))}
              {!auction && ghost('⏭ FORCE PICK', () => void run(() => commishForcePick(leagueId)))}
              {!auction && ghost('↩ UNDO', () => void run(() => commishUndoPick(leagueId)), t.opp)}
            </View>
          )}
        </Card>
      )}

      {st.status === 'complete' && (
        <Card>
          <Display size={15} tone="you">Draft complete.</Display>
          <Mono size={10} style={{ marginTop: 8, lineHeight: 16 }}>
            Rosters are live and weekly lineup pools are built. Waivers and free agency are open — manage your team from the MY TEAM tab.
          </Mono>
          {isCommish && st.mode === 'snake' && (
            <View style={{ marginTop: 10 }}>
              {ghost('↩ UNDO LAST PICK (reopens the draft)', () => void run(() => commishUndoPick(leagueId)))}
            </View>
          )}
        </Card>
      )}

      {/* tabs */}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Chip label={`PLAYERS (${avail.length})`} on={tab === 'players'} onPress={() => { tap(); setTab('players'); }} />
        <Chip label="BOARD" on={tab === 'board'} onPress={() => { tap(); setTab('board'); }} />
        <Chip label="TEAMS" on={tab === 'teams'} onPress={() => { tap(); setTab('teams'); }} />
        <Chip label={`☆ QUEUE (${queue.length})`} on={tab === 'queue'} onPress={() => { tap(); setTab('queue'); }} />
      </View>

      {/* PLAYERS — available list with ADP + projections */}
      {tab === 'players' && (
        <Card>
          <TextInput value={q} onChangeText={setQ} placeholder="Search players or teams…" placeholderTextColor={t.faint}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg, marginBottom: 10 }} />
          {/* position filters double as my roster-fill meter: taken/limit */}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {POS_FILTERS.map((p) => {
              const fill = myRoster == null ? '' : p === 'ALL'
                ? ` ${Object.values(myPosCount).reduce((a, b) => a + b, 0)}/${st.rounds}`
                : ` ${myPosCount[p] ?? 0}/${st.pos_caps?.[p as keyof PosCaps] ?? '∞'}`;
              return <Chip key={p} label={`${p}${fill}`} on={pos === p} onPress={() => { tap(); setPos(p); }} />;
            })}
            <Chip label="★ FIRST" on={starMode === 'first'} onPress={() => { tap(); setStarMode(starMode === 'first' ? 'off' : 'first'); }} />
            <Chip label="★ ONLY" on={starMode === 'only'} onPress={() => { tap(); setStarMode(starMode === 'only' ? 'off' : 'only'); }} />
          </View>
          {avail.slice(0, 60).map((p) => {
            const adp = ADP_2026.get(p.slug); const proj = PROJ_2026.get(p.slug);
            const inQ = queue.includes(p.slug);
            const capped = atCap(p.pos);
            const can = myTurn && !busy && !capped;
            return (
              <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                <Pressable disabled={!can} onPress={() => { tap(); act(p.slug); }}
                  style={{ backgroundColor: can ? t.you : t.sh, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 7, width: 56, alignItems: 'center', opacity: can ? 1 : 0.45 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: can ? t.onAccent : t.faint }}>
                    {capped ? 'LIMIT' : auction ? 'NOM $1' : 'DRAFT'}
                  </Text>
                </Pressable>
                <Face slug={p.slug} pos={p.pos} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '700', color: t.text }}>
                    {favs.has(p.slug) && <Text style={{ color: STAR_GOLD }}>★ </Text>}{p.full_name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <PosPill pos={p.pos} size={8} />
                    <Mono size={8.5} tone="faint">{p.team} · #{p.rank}</Mono>
                    <FlagChip slug={p.slug} size={7.5} />
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', width: 52 }}>
                  <Mono size={9}>{adp != null ? `ADP ${adp.toFixed(0)}` : '—'}</Mono>
                  <Mono size={9} tone="faint">{proj != null ? `${proj.toFixed(1)}p` : ''}</Mono>
                </View>
                <Pressable hitSlop={8} onPress={() => toggleQueue(p.slug)}>
                  <Text style={{ fontSize: 15, color: inQ ? t.warn : t.faint }}>{inQ ? '★' : '☆'}</Text>
                </Pressable>
              </View>
            );
          })}
          {avail.length > 60 && <Mono size={9.5} tone="faint" style={{ paddingTop: 8 }}>…{avail.length - 60} more — narrow the search.</Mono>}
        </Card>
      )}

      {/* BOARD — one column per team, horizontal scroll (the only way a
          12-team grid fits a phone). Columns transpose the web's rows. */}
      {tab === 'board' && teams > 0 && (
        <Card style={{ padding: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {(st.order ?? []).map((rid) => (
                <View key={rid} style={{ width: 86, gap: 4 }}>
                  <View style={{ paddingVertical: 3, alignItems: 'center' }}>
                    <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: rid === myRoster ? t.you : t.dim }}>
                      {teamName(rid) ?? `Team ${rid}`}
                    </Text>
                    {auction && st.budgets && (
                      <Mono size={7.5} tone="faint">${st.budgets.find((b) => b.roster_id === rid)?.budget ?? ''}</Mono>
                    )}
                  </View>
                  {Array.from({ length: st.rounds }, (_, r) => {
                    const c = (st.order ?? []).indexOf(rid);
                    const cell = auction
                      ? pickRowsFor(rid)[r]
                      : (st.picks ?? []).find((pk) => pk.round === r + 1 && pk.roster_id === rid);
                    const onClock = !auction && st.status === 'live'
                      && st.current_overall === r * teams + (r % 2 === 0 ? c + 1 : teams - c);
                    const pl = cell ? poolBySlug.get(cell.slug) : null;
                    const pc = t.pos[(pl?.pos ?? 'WR') as keyof typeof t.pos] ?? { bg: t.sh, fg: t.dim, bd: t.bd };
                    const nm = (pl?.full_name ?? cell?.slug ?? '').split(' ');
                    const last = nm.length > 1 ? nm.slice(1).join(' ') : nm[0];
                    return (
                      <View key={r} style={{
                        height: 44, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3, overflow: 'hidden',
                        backgroundColor: cell ? pc.bg : t.bg,
                        borderWidth: onClock ? 1 : StyleSheet.hairlineWidth, borderColor: onClock ? t.you : t.bd,
                      }}>
                        {cell ? (
                          <>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ fontFamily: MONO, fontSize: 7, fontWeight: '700', color: pc.fg }}>{pl?.pos ?? ''}</Text>
                              <Text style={{ fontFamily: MONO, fontSize: 7, color: pc.fg, opacity: 0.8 }}>
                                {auction ? `$${cell.price ?? 1}` : `${cell.round}.${((cell.overall - 1) % teams) + 1}`}{cell.auto ? ' 🤖' : ''}
                              </Text>
                            </View>
                            <Text numberOfLines={1} style={{ fontSize: 9.5, fontWeight: '700', color: pc.fg, marginTop: 2 }}>{last}</Text>
                          </>
                        ) : (
                          <Text style={{ fontFamily: MONO, fontSize: 7.5, color: onClock ? t.you : t.faint, marginTop: 4 }}>
                            {onClock ? '⏱ clock' : auction ? '—' : `${r + 1}.${r % 2 === 0 ? c + 1 : teams - c}`}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      )}

      {/* TEAMS — every roster so far */}
      {tab === 'teams' && (
        <Card>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {(st.order ?? []).map((rid) => (
              <Chip key={rid} on={(teamView ?? myRoster) === rid} onPress={() => { tap(); setTeamView(rid); }}
                label={`${teamName(rid) ?? `Team ${rid}`}${auction && st.budgets ? ` $${st.budgets.find((b) => b.roster_id === rid)?.budget ?? ''}` : ''}`} />
            ))}
          </View>
          {(() => {
            const rid = teamView ?? myRoster ?? (st.order ?? [])[0];
            if (rid == null) return null;
            const rows = pickRowsFor(rid);
            return rows.length === 0
              ? <Mono size={10} tone="faint">No picks yet.</Mono>
              : rows.map((pk) => {
                const pl = poolBySlug.get(pk.slug);
                return (
                  <View key={pk.overall} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                    <Mono size={9} tone="faint" style={{ width: 30 }}>{auction ? `$${pk.price ?? 1}` : `R${pk.round}`}</Mono>
                    <Face slug={pk.slug} pos={pl?.pos ?? '?'} size={22} />
                    <PosPill pos={pl?.pos ?? '?'} size={8} />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: t.text }}>{pl?.full_name ?? pk.slug}</Text>
                    <Mono size={9} tone="faint">{pl?.team}{pk.auto ? ' 🤖' : ''}</Mono>
                  </View>
                );
              });
          })()}
        </Card>
      )}

      {/* QUEUE — my private wishlist + autodraft */}
      {tab === 'queue' && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Mono size={9} tone="faint" track={0.12}>MY QUEUE</Mono>
            {myRoster != null && (
              <Chip label={`🤖 AUTODRAFT ${st.my_autodraft ? 'ON' : 'OFF'}`} on={!!st.my_autodraft}
                onPress={() => { tap(); void run(() => setAutodraft(leagueId, myRoster, !st.my_autodraft)); }} />
            )}
          </View>
          {queue.length === 0 && (
            <Mono size={10} tone="faint" style={{ lineHeight: 16 }}>
              Empty — tap ☆ on any player. If your clock runs out (or autodraft is on), your queue picks for you, in order, before best-available.
            </Mono>
          )}
          {queue.map((slug, i) => {
            const p = poolBySlug.get(slug);
            const gone = taken.has(slug);
            return (
              <View key={slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, opacity: gone ? 0.45 : 1 }}>
                <Mono size={9} tone="faint" style={{ width: 16 }}>{i + 1}</Mono>
                {p && <Face slug={p.slug} pos={p.pos} size={22} />}
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: t.text, textDecorationLine: gone ? 'line-through' : 'none' }}>{p?.full_name ?? slug}</Text>
                {gone && <Mono size={8.5} tone="opp">TAKEN</Mono>}
                <Pressable hitSlop={6} onPress={() => moveQueue(i, -1)}><Text style={{ color: t.dim, fontSize: 14 }}>↑</Text></Pressable>
                <Pressable hitSlop={6} onPress={() => moveQueue(i, 1)}><Text style={{ color: t.dim, fontSize: 14 }}>↓</Text></Pressable>
                <Pressable hitSlop={6} onPress={() => toggleQueue(slug)}><Text style={{ color: t.opp, fontSize: 13 }}>✕</Text></Pressable>
              </View>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}
