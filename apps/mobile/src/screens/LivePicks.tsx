// LivePicks, native.
//
// Deliberately the FIRST screen ported: it's the smallest one that exercises
// the whole stack — Supabase reads/writes through core's liveApi, the slate and
// per-window lock logic, the metric catalogue, the premium gate and the coin
// wallet. If this renders and seals a lineup against the real backend, the
// architecture works; the rest is surface area.
//
// Every line of game logic below is imported, not reimplemented: the eligibility
// gating, lock rules, pick shape and power-up prices all come from @drip/core,
// exactly as they do on web. That is the whole point of the extraction — a rule
// change lands in one file and both apps get it.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LOCKED_METRIC_UNLOCK } from '@drip/core/data/metrics';
import { windowForTeam, hasSlate, setRuntimeSlate, weekLabel, windowsForWeek } from '@drip/core/data/nflSlate';
import { slugMeta } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { powerupById } from '@drip/core/data/powerups';
import { REG_SEASON_WEEKS } from '@drip/core/data/league';
import { ensurePremiumTier, isFreePowerup, isFreePosition, markGatedAttempt } from '@drip/core/data/premiumClient';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, myMembership, setTeamController,
  myBuffs, armBuff, disarmBuff, LIVE_BUFFS,
  myUnlocks, armUnlock, disarmUnlock, myComboQty,
  myWallet, ensureWallet,
  myExtra, buyExtraSlot, sellExtraSlot, liveSlate, matchupTeams, matchupPremium, startCheckout,
  type LiveMatchup, type PoolPlayer, type PickRow, type Controller, type TeamInfo,
} from '@drip/core/data/liveApi';
import type { GameWindow, Player, Pos, WindowId } from '@drip/core/types';
import { useTheme } from '../theme.native';
import { Card, Chip, Display, LinkButton, Mono, Notice, PrimaryButton } from '../ui/prims';
import { SetupRow } from '../ui/SetupRow';
import { PlayerPicker } from '../ui/PlayerPicker';

// Live pool entries are slug/full/pos; SetupRow wants a Player. Build a light
// one — the setup board only ever displays name/pos/team.
const ZERO_STATS = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
function poolToPlayer(p: PoolPlayer): Player {
  return { id: p.slug, name: shortName(p.full), full: p.full, pos: p.pos as Pos, team: slugMeta(p.slug).team, stats: { ...ZERO_STATS } };
}

const LIVE_UNLOCKS = ['unlock-combo-drip', 'unlock-return', 'unlock-pass-td10'] as const;

interface Slot { win: string; winLabel: string; slot: string; key: string }

/** A week's slots, from that week's OWN windows.
 *
 *  Not a module constant. `WINDOWS` in metrics.ts is the regular-season default
 *  — TNF / SUN 1PM x3 / SUN 4PM x2 / SNF / MNF — but a week's real windows are
 *  DERIVED from its actual kickoffs (nflSlate.deriveWeek), and preseason weeks
 *  cluster into a different shape entirely. Building slots from the static list
 *  showed the wrong windows AND hid saved picks, because a pick is keyed by
 *  `game_window` and the ids did not line up. Worse, sealing would have written
 *  rows under window ids the week does not have. */
const slotsFor = (wins: GameWindow[]): Slot[] =>
  wins.flatMap((w) =>
    Array.from({ length: w.slots }, (_, i) => ({ win: w.id, winLabel: w.label, slot: String(i), key: `${w.id}-${i}` })));

const fmtLock = (iso: string | null) => {
  if (!iso) return 'kickoff';
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};

export function LivePicks({ userId, leagueId, rosterId, onBack }: {
  userId: string; leagueId?: string; rosterId?: number; onBack: () => void;
}) {
  const t = useTheme();
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [myTeam, setMyTeam] = useState<TeamInfo | null>(null);
  const [roster, setRoster] = useState<{ leagueId: string; rosterId: number } | null>(null);
  const [controller, setController] = useState<Controller>('human');
  const [aiBusy, setAiBusy] = useState(false);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [picks, setPicks] = useState<Record<string, { player_slug: string | null; metric_id: string | null }>>({});
  const [buffs, setBuffs] = useState<Set<string>>(new Set());
  const [unlocks, setUnlocks] = useState<Set<string>>(new Set());
  const [comboQty, setComboQty] = useState(0);
  const [coins, setCoins] = useState(0);
  const [buffBusy, setBuffBusy] = useState<string | null>(null);
  const [extra, setExtra] = useState(0);
  const [extraBusy, setExtraBusy] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<{ key: string; win: WindowId } | null>(null);
  const [matchPremium, setMatchPremium] = useState(true); // default true = no false locks until we know
  const [weekSel, setWeekSel] = useState<number | null>(null);
  const [winKickIso, setWinKickIso] = useState<Record<string, string>>({});
  const [lockedWins, setLockedWins] = useState<Set<string>>(new Set());
  const [nowTs, setNowTs] = useState(() => Date.now());
  // Set only after the live slate is installed below — windowsForWeek() reads
  // that slate, so asking before it lands returns the generic default.
  const [wins, setWins] = useState<GameWindow[]>([]);

  useEffect(() => { ensurePremiumTier(); }, []);

  useEffect(() => {
    (async () => {
      try {
        setState('loading'); setErr(null);
        const r = leagueId && rosterId != null ? { leagueId, rosterId } : await myRoster(userId);
        if (!r) { setState('none'); return; }
        setRoster(r);
        myMembership(r.leagueId, r.rosterId).then((mm) => { if (mm?.controller) setController(mm.controller); }).catch(() => {});
        const m = await myMatchup(r.leagueId, r.rosterId, weekSel ?? undefined);
        if (!m) { setMatchup(null); setState('none'); return; }
        setMatchup(m);
        matchupPremium(m.id).then(setMatchPremium).catch(() => {});
        matchupTeams(r.leagueId, [r.rosterId]).then((tm) => setMyTeam(tm[r.rosterId] ?? null)).catch(() => {});
        const [pl, pk, bf, un, ex, slate, cq] = await Promise.all([
          myPool(r.leagueId, m.week, r.rosterId), myPicks(m.id, userId), myBuffs(m.id), myUnlocks(m.id),
          myExtra(m.id).catch(() => 0), liveSlate(m.week).catch(() => []), myComboQty(m.id, userId).catch(() => 0),
        ]);
        setRuntimeSlate(m.week, slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId })));
        // MUST follow setRuntimeSlate: this is what makes a preseason week show
        // its own windows instead of the regular-season five.
        setWins(windowsForWeek(m.week));
        const wkick: Record<string, string> = {};
        for (const g of slate) {
          if (!g.kickoff) continue;
          if (!wkick[g.win] || Date.parse(g.kickoff) < Date.parse(wkick[g.win])) wkick[g.win] = g.kickoff;
        }
        setWinKickIso(wkick);
        setPool(pl);
        const map: Record<string, { player_slug: string | null; metric_id: string | null }> = {};
        const lw = new Set<string>();
        for (const p of pk) {
          if (p.locked) lw.add(p.game_window);
          // Extra slots ('x0','x1'…) are not offered on mobile yet — see the
          // note on the Extra slots card below.
          if (!/^x\d+$/.test(p.roster_slot)) map[`${p.game_window}-${p.roster_slot}`] = { player_slug: p.player_slug, metric_id: p.metric_id };
        }
        setLockedWins(lw);
        setPicks(map);
        setExtra(Number(ex ?? 0));
        setBuffs(new Set(bf ?? []));
        setUnlocks(new Set(un ?? []));
        setComboQty(Number(cq ?? 0));
        ensureWallet(m.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {});
        setState('ready');
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load.'); setState('error');
      }
    })();
  }, [userId, leagueId, rosterId, weekSel, attempt]);

  const locked = !!matchup && (matchup.status !== 'scheduled' || (!!matchup.lock_at && new Date(matchup.lock_at) <= new Date()));

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /** A window's picks are final: the server sealed our rows, or its first
   *  kickoff passed. Once the week starts, a window with no known kickoff is
   *  treated as locked (fail safe). */
  const winLocked = (winId: string): boolean => {
    if (!locked) return false;
    if (lockedWins.has(winId)) return true;
    const iso = winKickIso[winId];
    return iso ? Date.parse(iso) <= nowTs : true;
  };
  const allLocked = !!matchup && locked && wins.every((w) => winLocked(w.id));
  const slots = useMemo(() => slotsFor(wins), [wins]);

  const week = matchup?.week ?? 0;
  const gateOn = hasSlate(week);
  const teamBySlug = useMemo(() => Object.fromEntries(pool.map((p) => [p.slug, slugMeta(p.slug).team])), [pool]);
  const winBySlug = useMemo<Record<string, WindowId | 'any' | null>>(() => {
    const m: Record<string, WindowId | 'any' | null> = {};
    for (const p of pool) { const tm = teamBySlug[p.slug]; m[p.slug] = tm ? windowForTeam(week, tm) : 'any'; }
    return m;
  }, [pool, teamBySlug, week]);

  const eligibleFor = (winId: string, picked: string | null): PoolPlayer[] => {
    let list = gateOn ? pool.filter((p) => winBySlug[p.slug] === 'any' || winBySlug[p.slug] === winId) : pool;
    if (picked && !list.some((p) => p.slug === picked)) {
      const s = pool.find((p) => p.slug === picked);
      if (s) list = [s, ...list];
    }
    return list;
  };

  const playersBySlug = useMemo(() => {
    const m: Record<string, Player> = {};
    for (const p of pool) m[p.slug] = poolToPlayer(p);
    return m;
  }, [pool]);

  const slottedInWin = (winId: string, exceptKey: string): Set<string> => {
    const s = new Set<string>();
    for (const sl of slots.filter((x) => x.win === winId)) {
      if (sl.key === exceptKey) continue;
      const slug = picks[sl.key]?.player_slug;
      if (slug) s.add(slug);
    }
    return s;
  };

  const setSlot = (key: string, patch: Partial<{ player_slug: string | null; metric_id: string | null }>) => {
    setSaved(false);
    setPicks((prev) => {
      const cur = prev[key] ?? { player_slug: null, metric_id: null };
      const next = { ...cur, ...patch };
      if (patch.player_slug !== undefined) next.metric_id = null; // reset metric when player changes
      return { ...prev, [key]: next };
    });
  };

  const seal = async () => {
    if (!matchup || saving) return;
    setSaving(true); setErr(null);
    const rows: PickRow[] = slots
      .map((s) => {
        const p = picks[s.key];
        return { game_window: s.win, roster_slot: s.slot, player_slug: p?.player_slug ?? null, metric_id: p?.metric_id ?? null };
      })
      // Only filled slots in still-open windows: a locked window's rows are
      // sealed server-side and would fail the whole upsert (RLS + 0058 trigger).
      .filter((r) => r.game_window && r.player_slug && !winLocked(r.game_window));
    if (!rows.length) { setSaved(true); setSaving(false); return; }
    try { await savePicks(matchup.id, userId, rows); setSaved(true); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not seal picks.'); }
    finally { setSaving(false); }
  };

  const refreshCoins = () => { if (matchup) myWallet(matchup.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {}); };
  const priceOf = (id: string) => powerupById(id)?.price ?? 0;
  const insufficientMsg = (id: string) => `Not enough drip coin — ${powerupById(id)?.name ?? id} costs ◆${priceOf(id)}, you have ◆${Math.round(coins)}.`;
  const puLocked = (id: string) => !matchPremium && !isFreePowerup(id);
  const upgradeMsg = 'Premium power-up — unlock premium ($5 you · $30 league) to arm it.';

  const checkout = (kind: 'personal' | 'league') => {
    if (!roster) return;
    markGatedAttempt('checkout:' + kind);
    startCheckout(kind, roster.leagueId).catch((e) => setErr(e instanceof Error ? e.message : 'Checkout failed.'));
  };

  const toggleBuff = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    const armed = buffs.has(id);
    if (!armed && puLocked(id)) { markGatedAttempt('powerup:' + id); setErr(upgradeMsg); return; }
    if (!armed && coins < priceOf(id)) { setErr(insufficientMsg(id)); return; }
    setBuffBusy(id); setErr(null);
    try {
      const r = armed ? await disarmBuff(matchup.id, id) : await armBuff(matchup.id, id);
      if (r.ok && r.buffs) { setBuffs(new Set(r.buffs)); refreshCoins(); }
      else setErr(r.error === 'insufficient' ? insufficientMsg(id) : (r.detail ?? r.error ?? 'Could not update power-ups.'));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update power-ups.'); }
    finally { setBuffBusy(null); }
  };

  const toggleUnlock = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    const combo = id === 'unlock-combo-drip';
    const armed = unlocks.has(id) && !combo; // combo: every tap buys another
    if (!armed && puLocked(id)) { markGatedAttempt('powerup:' + id); setErr(upgradeMsg); return; }
    if (!armed && coins < priceOf(id)) { setErr(insufficientMsg(id)); return; }
    setBuffBusy(id); setErr(null);
    try {
      const r = armed ? await disarmUnlock(matchup.id, id) : await armUnlock(matchup.id, id);
      if (r.ok && r.unlocks) {
        setUnlocks(new Set(r.unlocks));
        if (combo && typeof r.comboQty === 'number') setComboQty(r.comboQty);
        refreshCoins();
        // Disarming clears dependent picks server-side — mirror locally.
        if (armed) setPicks((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            const mid = next[k].metric_id;
            if (mid && LOCKED_METRIC_UNLOCK[mid] === id) next[k] = { ...next[k], metric_id: null };
          }
          return next;
        });
      } else setErr(r.error === 'insufficient' ? insufficientMsg(id) : (r.error ?? 'Could not update unlocks.'));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update unlocks.'); }
    finally { setBuffBusy(null); }
  };

  const disarmComboOne = async () => {
    if (!matchup || locked || buffBusy || comboQty <= 0) return;
    setBuffBusy('unlock-combo-drip'); setErr(null);
    try {
      const r = await disarmUnlock(matchup.id, 'unlock-combo-drip');
      if (r.ok) setAttempt((a) => a + 1); // full reload — picks may have been trimmed server-side
      else setErr(r.error ?? 'Could not remove the Combo Drip.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove the Combo Drip.'); }
    finally { setBuffBusy(null); }
  };

  const toggleAi = async () => {
    if (!roster || aiBusy) return;
    const next: Controller = controller === 'ai' ? 'human' : 'ai';
    setAiBusy(true);
    try { const r = await setTeamController(roster.leagueId, roster.rosterId, next); if (r.ok) setController(next); }
    catch { /* leave as-is */ }
    finally { setAiBusy(false); }
  };

  const curWeek = matchup?.week ?? weekSel ?? 1;
  const WeekNav = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <LinkButton label="‹" onPress={() => curWeek > 1 && setWeekSel(Math.max(1, curWeek - 1))} />
      <Mono size={10} weight="700" track={0.06}>{weekLabel(curWeek)}</Mono>
      <LinkButton label="›" onPress={() => curWeek < REG_SEASON_WEEKS && setWeekSel(Math.min(REG_SEASON_WEEKS, curWeek + 1))} />
    </View>
  );

  if (state === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={11}>Loading your matchup…</Mono>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, justifyContent: 'center' }}>
        <Card>
          <Display size={18}>Couldn’t load your matchup</Display>
          <Mono size={10.5} style={{ marginTop: 10 }}>Check your connection and try again.{err ? `\n— ${err}` : ''}</Mono>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 14 }}>
            <LinkButton label="↻ retry" tone="you" onPress={() => setAttempt((a) => a + 1)} />
            <LinkButton label="← back" onPress={onBack} />
          </View>
        </Card>
      </View>
    );
  }

  if (state === 'none') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, justifyContent: 'center' }}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Display size={17} style={{ flex: 1 }}>No week {curWeek} matchup yet</Display>
            <WeekNav />
          </View>
          <Mono size={10.5} style={{ marginTop: 10 }}>
            Your team is enrolled. Matchups appear here once your commissioner syncs the schedule — use ‹ › to page through the season.{err ? `\n— ${err}` : ''}
          </Mono>
          <View style={{ alignItems: 'center', marginTop: 14 }}><LinkButton label="← back" onPress={onBack} /></View>
        </Card>
      </View>
    );
  }

  const filled = slots.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      {/* Header */}
      <Card style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {!!myTeam?.team_name && <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '700', color: t.text }}>{myTeam.team_name}</Text>}
            <Display size={18}>{weekLabel(matchup!.week)} lineup</Display>
          </View>
          <WeekNav />
        </View>

        <View style={{ alignSelf: 'flex-start', marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: allLocked ? t.opp : t.you, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 }}>
          <Mono size={9} tone={allLocked ? 'opp' : 'you'}>{allLocked ? 'LOCKED' : locked ? 'LOCKS BY WINDOW' : `FIRST LOCK ${fmtLock(matchup!.lock_at)}`}</Mono>
        </View>

        <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>
          Pick a player + a hidden metric per slot. Each window locks at its own kickoff — later windows stay editable all weekend, and your opponent can’t see a pick until its window kicks off. {filled}/{slots.length} set.
          {gateOn ? '\nEach slot only takes players whose real NFL team plays in that window. Players on a bye can’t be slotted.' : ''}
        </Mono>

        {/* Season-long auto-pilot */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
          <View style={{ flex: 1 }}>
            <Mono size={10.5} weight="700" tone={controller === 'ai' ? 'you' : 'text'}>🤖 Auto-pilot {controller === 'ai' ? 'ON' : 'OFF'}</Mono>
            <Mono size={9} tone="faint">{controller === 'ai' ? 'AI sets your best lineup each week. Turn off to pick yourself.' : 'Let AI set your best lineup automatically every week.'}</Mono>
          </View>
          <Chip label={aiBusy ? '…' : controller === 'ai' ? 'turn off' : 'turn on'} on={controller === 'ai'} disabled={aiBusy} onPress={toggleAi} />
        </View>
        {controller === 'ai' && <Mono size={9} tone="faint" style={{ marginTop: 8 }}>Auto-pilot is on — your manual picks below are paused until you turn it off.</Mono>}
      </Card>

      {/* Power-ups */}
      {controller !== 'ai' && (
        <Card style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Display size={14}>Power-ups</Display>
            <Mono size={10} tone="you" weight="700">◆ {Math.round(coins)} coin</Mono>
          </View>
          <Mono size={9.5} tone="faint" style={{ marginTop: 6 }}>Arm before kickoff — each buffs your whole lineup all week, spent from your drip coin. Locks at kickoff.</Mono>

          {!matchPremium && (
            <View style={{ marginTop: 8 }}>
              <Notice>
                <Mono size={9.5} tone="you" weight="700">🔒 Premium unlocks K/DST/IDP + the full power-up set + special events. Both sides of a premium matchup get the full set — never pay-to-win.</Mono>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 7 }}>
                  <Chip label="Unlock $5 · you" on onPress={() => checkout('personal')} />
                  <Chip label="Unlock league · $30" onPress={() => checkout('league')} />
                </View>
              </Notice>
            </View>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {LIVE_BUFFS.map((id) => {
              const pu = powerupById(id);
              const on = buffs.has(id);
              const afford = on || coins >= priceOf(id);
              return (
                <Chip
                  key={id}
                  label={`${pu?.icon ?? ''} ${pu?.name ?? id} ${on ? '✓' : puLocked(id) ? '🔒' : `◆${priceOf(id)}`}`}
                  on={on}
                  disabled={locked || !!buffBusy || !afford}
                  dim={buffBusy === id}
                  onPress={() => toggleBuff(id)}
                />
              );
            })}
          </View>

          <Mono size={9.5} weight="700" track={0.06} style={{ marginTop: 14 }}>METRIC UNLOCKS</Mono>
          <Mono size={9} tone="faint">Arm one to make its locked metric pickable (🔓) in the slots below.</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {LIVE_UNLOCKS.map((id) => {
              const pu = powerupById(id);
              const combo = id === 'unlock-combo-drip';
              const on = combo ? comboQty > 0 : unlocks.has(id);
              // Combo Drip is one slot PER PURCHASE, so the chip always offers
              // to buy another — affordability matters even when armed.
              const afford = (on && !combo) || coins >= priceOf(id);
              return (
                <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Chip
                    label={`${pu?.icon ?? ''} ${pu?.name ?? id} ${on ? (combo ? `✓ ×${comboQty} ＋` : '✓') : puLocked(id) ? '🔒' : `◆${priceOf(id)}`}`}
                    on={on}
                    disabled={locked || !!buffBusy || !afford}
                    dim={buffBusy === id}
                    onPress={() => toggleUnlock(id)}
                  />
                  {combo && comboQty > 0 && !locked && (
                    <Chip label="➖" disabled={!!buffBusy} onPress={disarmComboOne} />
                  )}
                </View>
              );
            })}
          </View>
        </Card>
      )}

      {/* Windows */}
      {wins.map((w) => {
        const winSlots = slots.filter((s) => s.win === w.id);
        const elig = gateOn ? pool.filter((pl) => winBySlug[pl.slug] === 'any' || winBySlug[pl.slug] === w.id).length : pool.length;
        const setN = winSlots.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;
        const wLocked = winLocked(w.id);
        return (
          <Card key={w.id} style={{ marginBottom: 10, opacity: wLocked ? 0.75 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <Mono size={10} weight="700" track={0.12}>{w.label} · {w.sub}</Mono>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'baseline' }}>
                {gateOn && <Mono size={9} tone={elig ? 'faint' : 'opp'}>{elig} eligible</Mono>}
                <Mono size={9} weight="700" tone={setN === winSlots.length ? 'you' : 'faint'}>{setN}/{winSlots.length} SET</Mono>
                <Mono size={9} weight="700" tone={wLocked ? 'opp' : 'faint'}>
                  {wLocked ? '🔒 LOCKED' : winKickIso[w.id] ? `locks ${fmtLock(winKickIso[w.id])}` : 'locks at kickoff'}
                </Mono>
              </View>
            </View>

            <View style={{ gap: 8 }}>
              {winSlots.map((s) => {
                const p = picks[s.key];
                const pick = p?.player_slug ? { playerId: p.player_slug, metricId: p.metric_id ?? null } : undefined;
                return (
                  <SetupRow
                    key={s.key}
                    pick={pick}
                    resolve={(id) => playersBySlug[id]}
                    lockPlayer={wLocked}
                    // Locked metrics only become pickable once their unlock is
                    // armed — same rule as the web's metricsFor().
                    metricFilter={(m) => !m.lock || unlocks.has(m.lock)}
                    onOpenPicker={() => { if (!wLocked) setPickerSlot({ key: s.key, win: w.id as WindowId }); }}
                    onPickMetric={(mid) => { if (!wLocked) setSlot(s.key, { metric_id: mid }); }}
                    onClearSlot={() => { if (!wLocked) setSlot(s.key, { player_slug: null, metric_id: null }); }}
                  />
                );
              })}
            </View>
          </Card>
        );
      })}

      {/* Extra slots are BUYABLE here but not yet fillable: the web fills them
          with three stacked <select>s (window / player / metric), which has no
          native equivalent and wants a purpose-built sheet. Buying and selling
          work, and any extra-slot picks already made on the web are preserved —
          this screen simply doesn't write to them. */}
      {controller !== 'ai' && (
        <Card style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Display size={14}>Extra slots</Display>
            <Mono size={9.5} tone="faint">{extra}/2 owned · ◆ {Math.round(coins)}</Mono>
          </View>
          <Mono size={9.5} tone="faint" style={{ marginTop: 6 }}>
            Add up to 2 bonus lineup slots (◆{priceOf('extra-slot')} each). An extra slot is one-sided — it plays unopposed as a best-ball backup. Fill them on the web for now.
          </Mono>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
            <Chip
              label={`➕ extra slot ◆${priceOf('extra-slot')}`}
              disabled={locked || extraBusy || extra >= 2 || coins < priceOf('extra-slot')}
              onPress={async () => {
                if (!matchup) return;
                setExtraBusy(true); setErr(null);
                try {
                  const r = await buyExtraSlot(matchup.id);
                  if (r.ok && typeof r.extra === 'number') { setExtra(r.extra); refreshCoins(); }
                  else setErr(r.error === 'insufficient' ? insufficientMsg('extra-slot') : r.error === 'cap' ? 'Extra-slot cap reached (2 per team).' : (r.error ?? 'Could not buy an extra slot.'));
                } catch (e) { setErr(e instanceof Error ? e.message : 'Could not buy an extra slot.'); }
                finally { setExtraBusy(false); }
              }}
            />
            {extra > 0 && (
              <Chip
                label={`➖ sell ◆${priceOf('extra-slot')}`}
                disabled={locked || extraBusy}
                onPress={async () => {
                  if (!matchup) return;
                  setExtraBusy(true); setErr(null);
                  try {
                    const r = await sellExtraSlot(matchup.id);
                    if (r.ok && typeof r.extra === 'number') { setExtra(r.extra); refreshCoins(); }
                    else setErr(r.error ?? 'Could not sell the extra slot.');
                  } catch (e) { setErr(e instanceof Error ? e.message : 'Could not sell the extra slot.'); }
                  finally { setExtraBusy(false); }
                }}
              />
            )}
          </View>
        </Card>
      )}

      {!!err && <Mono size={10.5} tone="opp" style={{ marginVertical: 6 }}>{err}</Mono>}

      {!allLocked && <PrimaryButton label={saving ? 'SEALING…' : saved ? 'SEALED ✓ — UPDATE' : 'SEAL LINEUP'} disabled={saving} onPress={seal} />}
      {saved && !allLocked && <Mono size={9.5} tone="you" style={{ textAlign: 'center', marginTop: 8 }}>Saved. Each window stays editable until it kicks off.</Mono>}
      {allLocked && <Mono size={10.5} style={{ textAlign: 'center' }}>Every window has kicked off — picks are final.</Mono>}

      <View style={{ alignItems: 'center', marginTop: 14 }}><LinkButton label="← back" onPress={onBack} /></View>

      {pickerSlot && (() => {
        const cur = picks[pickerSlot.key]?.player_slug ?? undefined;
        const slotted = slottedInWin(pickerSlot.win, pickerSlot.key);
        const players = eligibleFor(pickerSlot.win, cur ?? null)
          .filter((p) => !slotted.has(p.slug) || p.slug === cur)
          .map(poolToPlayer);
        return (
          <PlayerPicker
            visible
            players={players}
            currentId={cur}
            subtitle="YOUR PLAYERS WHOSE GAME FALLS IN THIS WINDOW"
            gated={(p) => !matchPremium && !isFreePosition(p.pos)}
            onGated={(p) => {
              markGatedAttempt('position:' + p.pos);
              setErr(`Premium position (${p.pos}) — unlock premium ($5 you · $30 league) to field K/DST/IDP.`);
              setPickerSlot(null);
            }}
            onPick={(slug) => { setSlot(pickerSlot.key, { player_slug: slug }); setPickerSlot(null); }}
            onRemove={() => { setSlot(pickerSlot.key, { player_slug: null, metric_id: null }); setPickerSlot(null); }}
            onClose={() => setPickerSlot(null)}
          />
        );
      })()}
    </ScrollView>
  );
}
