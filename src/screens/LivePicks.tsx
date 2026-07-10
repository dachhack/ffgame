import { useEffect, useMemo, useState } from 'react';
import { WINDOWS, METRICS, LOCKED_METRIC_UNLOCK } from '../data/metrics';
import { windowForTeam, hasSlate, setRuntimeSlate } from '../data/nflSlate';
import { slugMeta } from '../data/slugMeta';
import type { Pos, WindowId } from '../types';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, myMembership, setTeamController,
  myBuffs, armBuff, disarmBuff, LIVE_BUFFS,
  myUnlocks, armUnlock, disarmUnlock, myComboQty,
  myWallet, ensureWallet,
  myExtra, buyExtraSlot, sellExtraSlot, liveSlate, matchupTeams, matchupPremium, startCheckout,
  type LiveMatchup, type PoolPlayer, type PickRow, type Controller, type TeamInfo,
} from '../data/liveApi';
import { powerupById } from '../data/powerups';
import { PuIcon, GameIcon, Emoji, COIN_GOLD } from '../app/gameIcons';
import { ensurePremiumTier, isFreePowerup, isFreePosition, markGatedAttempt } from '../data/premiumClient';
import { shortName } from '../data/players';
import type { Player } from '../types';
import { SetupRow, PlayerPicker } from './Matchup';
import { REG_SEASON_WEEKS } from '../data/league';

// Live pool entries are slug/full/pos; the reused setup card wants a Player. Build
// a light one (zero stats — the setup board only displays name/pos/team/headshot).
const ZERO_STATS = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
function poolToPlayer(p: PoolPlayer): Player {
  return { id: p.slug, name: shortName(p.full), full: p.full, pos: p.pos as Pos, team: slugMeta(p.slug).team, stats: { ...ZERO_STATS } };
}

// The metric unlocks a manager can arm, in display order (ids match powerups.ts).
const LIVE_UNLOCKS = ['unlock-combo-drip', 'unlock-return', 'unlock-pass-td10'] as const;

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 };
const sel: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' };
const btn: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '12px 0', cursor: 'pointer', width: '100%' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

interface Slot { win: string; winLabel: string; slot: string; key: string; }
const SLOTS: Slot[] = WINDOWS.flatMap((w) =>
  Array.from({ length: w.slots }, (_, i) => ({ win: w.id, winLabel: w.label, slot: String(i), key: `${w.id}-${i}` })));

const fmtLock = (iso: string | null) => {
  if (!iso) return 'kickoff';
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};

export function LivePicks({ userId, leagueId, rosterId, onBack }: { userId: string; leagueId?: string; rosterId?: number; onBack: () => void }) {
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [myTeam, setMyTeam] = useState<TeamInfo | null>(null);
  const [roster, setRoster] = useState<{ leagueId: string; rosterId: number } | null>(null);
  const [controller, setController] = useState<Controller>('human');
  const [aiBusy, setAiBusy] = useState(false);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [picks, setPicks] = useState<Record<string, { player_slug: string | null; metric_id: string | null }>>({});
  const [buffs, setBuffs] = useState<Set<string>>(new Set());
  const [unlocks, setUnlocks] = useState<Set<string>>(new Set());
  const [comboQty, setComboQty] = useState(0); // Combo-Drip unlocks purchased (one slot per purchase)
  const [coins, setCoins] = useState<number>(0);
  const [buffBusy, setBuffBusy] = useState<string | null>(null);
  const [extra, setExtra] = useState<number>(0);
  const [extraPicks, setExtraPicks] = useState<{ win: string | null; player_slug: string | null; metric_id: string | null }[]>([]);
  const [extraBusy, setExtraBusy] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<{ key: string; win: WindowId } | null>(null);
  const [matchPremium, setMatchPremium] = useState(true); // default true = no false locks until we know
  const [weekSel, setWeekSel] = useState<number | null>(null); // null = default (earliest) week
  // Per-window locking ("late swap"): each window's picks seal at that window's
  // OWN first kickoff, not the week's. Kickoffs come from the live slate; the
  // server-sealed flags on our own rows are the authoritative override.
  const [winKickIso, setWinKickIso] = useState<Record<string, string>>({});
  const [lockedWins, setLockedWins] = useState<Set<string>>(new Set());
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => { ensurePremiumTier(); }, []); // load the free/premium split for intent gating
  useEffect(() => {
    (async () => {
      try {
        // Open the specific league/roster the card asked for; fall back to the
        // user's default roster when none is given.
        setState('loading'); setErr(null);
        const r = leagueId && rosterId != null ? { leagueId, rosterId } : await myRoster(userId);
        if (!r) { setState('none'); return; }
        setRoster(r);
        myMembership(r.leagueId, r.rosterId).then((mm) => { if (mm?.controller) setController(mm.controller); }).catch(() => {});
        const m = await myMatchup(r.leagueId, r.rosterId, weekSel ?? undefined);
        if (!m) { setMatchup(null); setState('none'); return; }
        setMatchup(m);
        matchupPremium(m.id).then(setMatchPremium).catch(() => {}); // premium → no power-up locks (both sides get the full set)
        matchupTeams(r.leagueId, [r.rosterId]).then((t) => setMyTeam(t[r.rosterId] ?? null)).catch(() => {});
        const [pl, pk, bf, un, ex, slate, cq] = await Promise.all([myPool(r.leagueId, m.week, r.rosterId), myPicks(m.id, userId), myBuffs(m.id), myUnlocks(m.id), myExtra(m.id).catch(() => 0), liveSlate(m.week).catch(() => []), myComboQty(m.id, userId).catch(() => 0)]);
        // Apply the live ESPN slate (overrides baked 2025) before gating below.
        setRuntimeSlate(m.week, slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId })));
        // Each window's first kickoff — drives per-window lock gating below.
        const wkick: Record<string, string> = {};
        for (const g of slate) {
          if (!g.kickoff) continue;
          if (!wkick[g.win] || Date.parse(g.kickoff) < Date.parse(wkick[g.win])) wkick[g.win] = g.kickoff;
        }
        setWinKickIso(wkick);
        setPool(pl);
        const map: Record<string, { player_slug: string | null; metric_id: string | null }> = {};
        const xs: { win: string | null; player_slug: string | null; metric_id: string | null }[] = [];
        const lw = new Set<string>();
        for (const p of pk) {
          if (p.locked) lw.add(p.game_window); // the server already sealed this window
          const xm = /^x(\d+)$/.exec(p.roster_slot); // extra slots are 'x0','x1',…
          if (xm) xs[Number(xm[1])] = { win: p.game_window, player_slug: p.player_slug, metric_id: p.metric_id };
          else map[`${p.game_window}-${p.roster_slot}`] = { player_slug: p.player_slug, metric_id: p.metric_id };
        }
        setLockedWins(lw);
        setPicks(map);
        const n = Number(ex ?? 0);
        setExtra(n);
        setExtraPicks(Array.from({ length: n }, (_, i) => xs[i] ?? { win: null, player_slug: null, metric_id: null }));
        setBuffs(new Set(bf ?? []));
        setUnlocks(new Set(un ?? []));
        setComboQty(Number(cq ?? 0));
        ensureWallet(m.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {}); // seeds once + balance
        setState('ready');
      } catch (e) {
        // A real load failure is NOT "you're all set" — surface it distinctly with
        // a retry, rather than telling the user everything's fine (see 'error' below).
        setErr(e instanceof Error ? e.message : 'Failed to load.'); setState('error');
      }
    })();
  }, [userId, leagueId, rosterId, weekSel, attempt]);

  const posBySlug = useMemo(() => Object.fromEntries(pool.map((p) => [p.slug, p.pos])), [pool]);
  // The week has started (first kickoff passed) — gates power-ups/extra slots,
  // which arm pre-week. Picks lock PER WINDOW (winLocked below), not here.
  const locked = !!matchup && (matchup.status !== 'scheduled' || (!!matchup.lock_at && new Date(matchup.lock_at) <= new Date()));
  // Re-check the clock every 30s so windows flip to locked while the screen is open.
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  /** A window's picks are final: the server sealed our rows, or its first kickoff
   *  passed. Once the week starts, a window with no known kickoff is treated as
   *  locked (fail safe — never leave picks editable mid-slate on missing data). */
  const winLocked = (winId: string): boolean => {
    if (!locked) return false;
    if (lockedWins.has(winId)) return true;
    const iso = winKickIso[winId];
    return iso ? Date.parse(iso) <= nowTs : true;
  };
  const allLocked = !!matchup && locked && WINDOWS.every((w) => winLocked(w.id));

  // Slate-gating: a player can only fill a slot in the window their real NFL team
  // plays that week. Players on a bye are eligible nowhere; players whose team we
  // can't resolve (no slate / synthetic) stay eligible everywhere so picks aren't
  // stranded. Gating is off entirely for weeks we have no baked slate for.
  const week = matchup?.week ?? 0;
  const gateOn = hasSlate(week);
  const teamBySlug = useMemo(() => Object.fromEntries(pool.map((p) => [p.slug, slugMeta(p.slug).team])), [pool]);
  const winBySlug = useMemo<Record<string, WindowId | 'any' | null>>(() => {
    const m: Record<string, WindowId | 'any' | null> = {};
    for (const p of pool) { const t = teamBySlug[p.slug]; m[p.slug] = t ? windowForTeam(week, t) : 'any'; }
    return m;
  }, [pool, teamBySlug, week]);
  /** Pool eligible for a window's slots, keeping any already-picked player visible. */
  const eligibleFor = (winId: string, picked: string | null): PoolPlayer[] => {
    let list = gateOn ? pool.filter((p) => winBySlug[p.slug] === 'any' || winBySlug[p.slug] === winId) : pool;
    if (picked && !list.some((p) => p.slug === picked)) {
      const sel = pool.find((p) => p.slug === picked);
      if (sel) list = [sel, ...list];
    }
    return list;
  };
  /** Metric options for a slot's chosen player — locked metrics only once their unlock is armed. */
  const metricsFor = (slug: string | null) => {
    const pos = (slug ? posBySlug[slug] : null) as Pos | null;
    return pos ? (METRICS[pos] ?? []).filter((m) => !m.lock || unlocks.has(m.lock)) : [];
  };

  // Adapters so the reused demo setup card (SetupRow / PlayerPicker) renders live
  // data: a slug→Player registry, locked-metric gating from armed unlocks, and the
  // armed team buffs as spot chips.
  const playersBySlug = useMemo(() => { const m: Record<string, Player> = {}; for (const p of pool) m[p.slug] = poolToPlayer(p); return m; }, [pool]);
  const synthInv = useMemo(() => Object.fromEntries([...unlocks].map((id) => [id, 1])), [unlocks]);
  const armedMap = useMemo(() => Object.fromEntries([...buffs].map((id) => [id, true])), [buffs]);
  /** Slugs already slotted in a window (excluding one slot), to keep the picker dedup'd. */
  const slottedInWin = (winId: string, exceptKey: string): Set<string> => {
    const s = new Set<string>();
    for (const sl of SLOTS.filter((x) => x.win === winId)) {
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

  const setExtraSlot = (i: number, patch: Partial<{ win: string | null; player_slug: string | null; metric_id: string | null }>) => {
    setSaved(false);
    setExtraPicks((prev) => {
      const next = [...prev];
      const cur = next[i] ?? { win: null, player_slug: null, metric_id: null };
      next[i] = { ...cur, ...patch };
      if (patch.player_slug !== undefined) next[i].metric_id = null;       // reset metric when player changes
      if (patch.win !== undefined) { next[i].player_slug = null; next[i].metric_id = null; } // window change resets the slot
      return next;
    });
  };

  const seal = async () => {
    if (!matchup || saving) return;
    setSaving(true); setErr(null);
    const baseRows: PickRow[] = SLOTS.map((s) => {
      const p = picks[s.key];
      return { game_window: s.win, roster_slot: s.slot, player_slug: p?.player_slug ?? null, metric_id: p?.metric_id ?? null };
    });
    const extraRows: PickRow[] = extraPicks.map((ep, i) => ({ game_window: ep.win ?? '', roster_slot: `x${i}`, player_slug: ep.player_slug ?? null, metric_id: ep.metric_id ?? null }));
    // Only filled slots, and only windows still open — a locked window's rows are
    // sealed server-side and would fail the whole upsert (RLS + 0058 trigger).
    const rows = [...baseRows, ...extraRows].filter((r) => r.game_window && r.player_slug && !winLocked(r.game_window));
    if (!rows.length) { setSaved(true); setSaving(false); return; } // nothing editable to write
    try { await savePicks(matchup.id, userId, rows); setSaved(true); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not seal picks.'); }
    finally { setSaving(false); }
  };

  const buyExtra = async () => {
    if (!matchup || locked || extraBusy) return;
    if (extra >= 2) { setErr('Extra-slot cap reached (2 per team).'); return; }
    if (coins < priceOf('extra-slot')) { setErr(insufficientMsg('extra-slot')); return; }
    setExtraBusy(true); setErr(null);
    try {
      const r = await buyExtraSlot(matchup.id);
      if (r.ok && typeof r.extra === 'number') { setExtra(r.extra); setExtraPicks((prev) => [...prev, { win: null, player_slug: null, metric_id: null }]); refreshCoins(); }
      else setErr(r.error === 'insufficient' ? insufficientMsg('extra-slot') : r.error === 'cap' ? 'Extra-slot cap reached (2 per team).' : (r.error ?? 'Could not buy an extra slot.'));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not buy an extra slot.'); }
    finally { setExtraBusy(false); }
  };

  const sellExtra = async () => {
    if (!matchup || locked || extraBusy || extra <= 0) return;
    setExtraBusy(true); setErr(null);
    try {
      const r = await sellExtraSlot(matchup.id);
      if (r.ok && typeof r.extra === 'number') { setExtra(r.extra); setExtraPicks((prev) => prev.slice(0, r.extra)); refreshCoins(); }
      else setErr(r.error ?? 'Could not sell the extra slot.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not sell the extra slot.'); }
    finally { setExtraBusy(false); }
  };

  const refreshCoins = () => { if (matchup) myWallet(matchup.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {}); };
  const priceOf = (id: string) => powerupById(id)?.price ?? 0;
  const insufficientMsg = (id: string) => `Not enough drip coin — ${powerupById(id)?.name ?? id} costs ◆${priceOf(id)}, you have ◆${Math.round(coins)}.`;

  // A power-up is paywalled when this matchup isn't premium and it's not in the free tier.
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
    const armed = unlocks.has(id) && !combo; // combo: every tap BUYS ANOTHER (one slot per purchase); ➖ removes one
    if (!armed && puLocked(id)) { markGatedAttempt('powerup:' + id); setErr(upgradeMsg); return; }
    if (!armed && coins < priceOf(id)) { setErr(insufficientMsg(id)); return; }
    setBuffBusy(id); setErr(null);
    try {
      const r = armed ? await disarmUnlock(matchup.id, id) : await armUnlock(matchup.id, id);
      if (r.ok && r.unlocks) {
        setUnlocks(new Set(r.unlocks));
        if (combo && typeof r.comboQty === 'number') setComboQty(r.comboQty);
        refreshCoins();
        // Disarming an unlock clears dependent picks server-side — mirror locally.
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

  /** Remove ONE Combo-Drip purchase (refund). The server clears any now-excess
   *  combodrip picks (highest slots first) — reload to mirror it exactly. */
  const disarmComboOne = async () => {
    if (!matchup || locked || buffBusy || comboQty <= 0) return;
    setBuffBusy('unlock-combo-drip'); setErr(null);
    try {
      const r = await disarmUnlock(matchup.id, 'unlock-combo-drip');
      if (r.ok) { setAttempt((a) => a + 1); } // full reload — picks may have been trimmed server-side
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

  // Week stepper: page through the whole scheduled season (matchup?.week while
  // viewing a week, else the selected week; defaults to the earliest).
  const curWeek = matchup?.week ?? weekSel ?? 1;
  const weekNav = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <button onClick={() => setWeekSel(Math.max(1, curWeek - 1))} disabled={curWeek <= 1} className="mono" title="previous week" style={{ ...linkBtn, fontSize: 13, padding: '0 4px', opacity: curWeek <= 1 ? 0.35 : 1 }}>‹</button>
      <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)' }}>WK {curWeek}</span>
      <button onClick={() => setWeekSel(Math.min(REG_SEASON_WEEKS, curWeek + 1))} disabled={curWeek >= REG_SEASON_WEEKS} className="mono" title="next week" style={{ ...linkBtn, fontSize: 13, padding: '0 4px', opacity: curWeek >= REG_SEASON_WEEKS ? 0.35 : 1 }}>›</button>
    </div>
  );

  if (state === 'loading') return <Muted text="Loading your matchup…" />;
  if (state === 'error') return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Couldn’t load your matchup</div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
        Check your connection and try again. {err && <><br />— {err}</>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 14 }}>
        <button onClick={() => setAttempt((a) => a + 1)} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>↻ retry</button>
        <button onClick={onBack} className="mono" style={linkBtn}>← back</button>
      </div>
    </div>
  );
  if (state === 'none') return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>No week {curWeek} matchup yet</div>
        {weekNav}
      </div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
        Your team is enrolled. Matchups appear here once your commissioner syncs the schedule — use ‹ › to page through the season, or check back closer to kickoff. {err && <><br />— {err}</>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 14 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );

  const filled = SLOTS.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;

  return (
    <div>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {myTeam?.avatar && <img src={myTeam.avatar} alt="" width={32} height={32} style={{ borderRadius: 6, flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              {myTeam?.team_name && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{myTeam.team_name}</div>}
              <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Week {matchup!.week} lineup</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {weekNav}
            <span className="mono" style={{ fontSize: 9, color: allLocked ? 'var(--opp)' : 'var(--you)', border: `1px solid ${allLocked ? 'var(--opp)' : 'var(--you)'}`, borderRadius: 4, padding: '3px 7px' }}>{allLocked ? 'LOCKED' : locked ? 'LOCKS BY WINDOW' : `FIRST LOCK ${fmtLock(matchup!.lock_at)}`}</span>
          </div>
        </div>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          Pick a player + a hidden metric per slot. Each window locks at its own kickoff — later windows stay editable all weekend, and your opponent can’t see a pick until its window kicks off. {filled}/{SLOTS.length} set.
          {gateOn && <><br />Each slot only takes players whose real NFL team plays in that window. Players on a bye can’t be slotted.</>}
        </div>
        {/* Season-long auto-pilot: AI sets the team's best lineup each week. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: controller === 'ai' ? 'var(--you)' : 'var(--text)' }}><Emoji e="🤖" /> Auto-pilot {controller === 'ai' ? 'ON' : 'OFF'}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 2 }}>{controller === 'ai' ? 'AI sets your best lineup each week. Turn off to pick yourself.' : 'Let AI set your best lineup automatically every week.'}</div>
          </div>
          <button onClick={toggleAi} disabled={aiBusy} className="mono"
            style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: controller === 'ai' ? 'var(--on-accent)' : 'var(--you)', background: controller === 'ai' ? 'var(--you)' : 'var(--bg)', border: '1px solid var(--you)', borderRadius: 5, padding: '7px 11px', cursor: 'pointer' }}>
            {aiBusy ? '…' : controller === 'ai' ? 'turn off' : 'turn on'}
          </button>
        </div>
        {controller === 'ai' && <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8 }}>Auto-pilot is on — your manual picks below are paused until you turn it off.</div>}
      </div>

      {/* Power-ups: arm whole-lineup team buffs before kickoff. Free this season
          (no coin yet). AI teams arm their own, so hide the controls under auto-pilot. */}
      {controller !== 'ai' && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Power-ups</div>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--you)' }}><GameIcon name={COIN_GOLD} emoji="◆" size="1.3em" /> {Math.round(coins)} coin</span>
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
            Arm before kickoff — each buffs your whole lineup all week, spent from your drip coin. Locks at kickoff.
          </div>
          {!matchPremium && (
            <div style={{ background: 'color-mix(in srgb, var(--you) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--you) 35%, transparent)', borderRadius: 8, padding: '8px 9px', marginTop: 8 }}>
              <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--you)', lineHeight: 1.55 }}>
                <Emoji e="🔒" /> Premium unlocks K/DST/IDP + the full power-up set + special events. Both sides of a premium matchup get the full set — never pay-to-win.
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                <button onClick={() => checkout('personal')} className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>Unlock for $5 · all your leagues</button>
                <button onClick={() => checkout('league')} className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--you)', background: 'var(--bg)', border: '1px solid var(--you)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>Unlock league · $30</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {LIVE_BUFFS.map((id) => {
              const pu = powerupById(id);
              const on = buffs.has(id);
              const afford = on || coins >= priceOf(id);
              return (
                <button key={id} onClick={() => toggleBuff(id)} disabled={locked || !!buffBusy || !afford} title={pu?.blurb}
                  className="mono"
                  style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: on ? 'var(--on-accent)' : afford ? 'var(--text)' : 'var(--faint)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 14, padding: '6px 11px', cursor: locked || !afford ? 'default' : 'pointer', opacity: locked ? 0.55 : buffBusy === id ? 0.6 : afford ? 1 : 0.5 }}>
                  <PuIcon id={id} emoji={pu?.icon} size="1.4em" /> {pu?.name ?? id} {on ? '✓' : puLocked(id) ? <Emoji e="🔒" size="1.2em" /> : <><GameIcon name={COIN_GOLD} emoji="◆" size="1.2em" />{priceOf(id)}</>}
                </button>
              );
            })}
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 14, marginBottom: 2, fontWeight: 700, letterSpacing: '0.06em' }}>METRIC UNLOCKS</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.5 }}>
            Arm one to make its locked metric pickable (🔓) in the slots below.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {LIVE_UNLOCKS.map((id) => {
              const pu = powerupById(id);
              const combo = id === 'unlock-combo-drip';
              const on = combo ? comboQty > 0 : unlocks.has(id);
              // Combo Drip is one slot PER PURCHASE — the chip always offers to
              // buy another, so affordability matters even when armed.
              const afford = (on && !combo) || coins >= priceOf(id);
              return (
                <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <button onClick={() => toggleUnlock(id)} disabled={locked || !!buffBusy || !afford} title={combo ? `${pu?.blurb ?? ''} Tap to buy another (◆${priceOf(id)} each).` : pu?.blurb}
                  className="mono"
                  style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: on ? 'var(--on-accent)' : afford ? 'var(--text)' : 'var(--faint)', background: on ? 'var(--streak, var(--you))' : 'var(--bg)', border: `1px solid ${on ? 'var(--streak, var(--you))' : 'var(--bd)'}`, borderRadius: 14, padding: '6px 11px', cursor: locked || !afford ? 'default' : 'pointer', opacity: locked ? 0.55 : buffBusy === id ? 0.6 : afford ? 1 : 0.5 }}>
                  <PuIcon id={id} emoji={pu?.icon} size="1.4em" /> {pu?.name ?? id} {on ? (combo ? `✓ ×${comboQty} ＋` : '✓') : puLocked(id) ? <Emoji e="🔒" size="1.2em" /> : <><GameIcon name={COIN_GOLD} emoji="◆" size="1.2em" />{priceOf(id)}</>}
                </button>
                {combo && comboQty > 0 && !locked && (
                  <button onClick={disarmComboOne} disabled={!!buffBusy} title="Remove one Combo Drip (refund; may clear its pick)" className="mono"
                    style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 14, padding: '6px 8px', cursor: 'pointer' }}>➖</button>
                )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {WINDOWS.map((w) => {
        const winSlots = SLOTS.filter((s) => s.win === w.id);
        const elig = gateOn ? pool.filter((pl) => winBySlug[pl.slug] === 'any' || winBySlug[pl.slug] === w.id).length : pool.length;
        const setN = winSlots.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;
        const wLocked = winLocked(w.id);
        return (
        <div key={w.id} style={{ ...card, marginBottom: 10, opacity: wLocked ? 0.75 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 }}>{w.label} · {w.sub}</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              {gateOn && <span className="mono" style={{ fontSize: 9, color: elig ? 'var(--faint)' : 'var(--opp)' }}>{elig} eligible</span>}
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: setN === winSlots.length ? 'var(--you)' : 'var(--faint)' }}>{setN}/{winSlots.length} SET</span>
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: wLocked ? 'var(--opp)' : 'var(--faint)' }}>
                {wLocked ? <><Emoji e="🔒" size="1.2em" /> LOCKED</> : winKickIso[w.id] ? `locks ${fmtLock(winKickIso[w.id])}` : 'locks at kickoff'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {winSlots.map((s) => {
              const p = picks[s.key];
              const pick = p?.player_slug ? { playerId: p.player_slug, metricId: p.metric_id ?? null } : undefined;
              return (
                <SetupRow
                  key={s.key} slotKeyStr={s.key} winId={w.id as WindowId} week={week} pick={pick}
                  selected={false} inventory={synthInv} armed={armedMap} appliedPu={[]} applyMode={null}
                  onApplyToSpot={() => {}}
                  onOpenPicker={() => { if (!wLocked) setPickerSlot({ key: s.key, win: w.id as WindowId }); }}
                  onPickMetric={(m) => { if (!wLocked) setSlot(s.key, { metric_id: m }); }}
                  onClearSlot={() => { if (!wLocked) setSlot(s.key, { player_slug: null, metric_id: null }); }}
                  onDropPlayer={() => {}} onScout={() => {}}
                  lockPlayer={wLocked} resolve={(id) => playersBySlug[id]} hideScout
                />
              );
            })}
          </div>
        </div>
        );
      })}

      {/* Extra slots (cap 2): a buyable power-up that adds one-sided bonus slots.
          Each plays unopposed → a best-ball backup. AI teams buy their own. */}
      {controller !== 'ai' && (
        <div style={{ ...card, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Extra slots</div>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{extra}/2 owned · <GameIcon name={COIN_GOLD} emoji="◆" size="1.2em" /> {Math.round(coins)}</span>
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
            Add up to 2 bonus lineup slots (◆{priceOf('extra-slot')} each). An extra slot is one-sided — it plays unopposed as a best-ball backup. Choose its window, then a player + metric. Slate-gated like any pick.
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={buyExtra} disabled={locked || extraBusy || extra >= 2 || coins < priceOf('extra-slot')} className="mono"
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--you)', background: 'var(--bg)', border: '1px solid var(--you)', borderRadius: 14, padding: '6px 11px', cursor: locked || extra >= 2 || coins < priceOf('extra-slot') ? 'default' : 'pointer', opacity: locked || extra >= 2 || coins < priceOf('extra-slot') ? 0.5 : 1 }}>
              ➕ extra slot <GameIcon name={COIN_GOLD} emoji="◆" size="1.2em" />{priceOf('extra-slot')}
            </button>
            {extra > 0 && (
              <button onClick={sellExtra} disabled={locked || extraBusy} className="mono"
                style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 14, padding: '6px 11px', cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.5 : 1 }}>
                ➖ sell <GameIcon name={COIN_GOLD} emoji="◆" size="1.2em" />{priceOf('extra-slot')}
              </button>
            )}
          </div>
          {extraPicks.map((ep, i) => {
            const eligible = ep.win ? eligibleFor(ep.win, ep.player_slug) : [];
            const ms = metricsFor(ep.player_slug);
            // The slot's pick follows its chosen window's lock; an unassigned slot
            // stays editable while any window is still open.
            const epLocked = ep.win ? winLocked(ep.win) : allLocked;
            return (
              <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <select value={ep.win ?? ''} disabled={epLocked} onChange={(e) => setExtraSlot(i, { win: e.target.value || null })} style={{ ...sel, flex: 0.9 }}>
                  <option value="">— window —</option>
                  {WINDOWS.map((w) => <option key={w.id} value={w.id} disabled={winLocked(w.id)}>{w.label}{winLocked(w.id) ? ' 🔒' : ''}</option>)}
                </select>
                <select value={ep.player_slug ?? ''} disabled={epLocked || !ep.win} onChange={(e) => setExtraSlot(i, { player_slug: e.target.value || null })} style={{ ...sel, flex: 1.3 }}>
                  <option value="">{ep.win ? (eligible.length ? '— player —' : '— none this window —') : '— pick a window —'}</option>
                  {eligible.map((pl) => <option key={pl.slug} value={pl.slug}>{pl.full} ({pl.pos}{teamBySlug[pl.slug] ? ` · ${teamBySlug[pl.slug]}` : ''})</option>)}
                </select>
                <select value={ep.metric_id ?? ''} disabled={epLocked || !ep.player_slug} onChange={(e) => setExtraSlot(i, { metric_id: e.target.value || null })} style={{ ...sel, flex: 1 }}>
                  <option value="">— metric —</option>
                  {ms.map((m) => <option key={m.id} value={m.id}>{m.lock ? '🔓 ' : ''}{m.name} · {m.tag}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', margin: '4px 0 10px' }}>{err}</div>}
      {!allLocked && <button onClick={seal} disabled={saving} className="mono" style={{ ...btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'SEALING…' : saved ? 'SEALED ✓ — UPDATE' : 'SEAL LINEUP'}</button>}
      {saved && !allLocked && <div className="mono" style={{ fontSize: 9.5, color: 'var(--you)', textAlign: 'center', marginTop: 8 }}>Saved. Each window stays editable until it kicks off.</div>}
      {allLocked && <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', textAlign: 'center' }}>Every window has kicked off — picks are final.</div>}
      <div style={{ textAlign: 'center', marginTop: 14 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>

      {pickerSlot && (() => {
        const cur = picks[pickerSlot.key]?.player_slug ?? undefined;
        const slotted = slottedInWin(pickerSlot.win, pickerSlot.key);
        const players = eligibleFor(pickerSlot.win, cur ?? null)
          .filter((p) => !slotted.has(p.slug) || p.slug === cur)
          .map(poolToPlayer);
        return (
          <PlayerPicker
            win={pickerSlot.win} week={week} players={players} currentId={cur}
            gated={(p) => !matchPremium && !isFreePosition(p.pos)}
            onGated={(p) => { markGatedAttempt('position:' + p.pos); setErr(`Premium position (${p.pos}) — unlock premium ($5 you · $30 league) to field K/DST/IDP.`); setPickerSlot(null); }}
            onPick={(slug) => { setSlot(pickerSlot.key, { player_slug: slug }); setPickerSlot(null); }}
            onRemove={() => { setSlot(pickerSlot.key, { player_slug: null, metric_id: null }); setPickerSlot(null); }}
            onClose={() => setPickerSlot(null)}
          />
        );
      })()}
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)' }}>{text}</div>;
}
