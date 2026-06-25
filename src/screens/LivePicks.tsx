import { useEffect, useMemo, useState } from 'react';
import { WINDOWS, METRICS, LOCKED_METRIC_UNLOCK } from '../data/metrics';
import { windowForTeam, hasSlate } from '../data/nflSlate';
import { slugMeta } from '../data/slugMeta';
import type { Pos, WindowId } from '../types';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, myMembership, setTeamController,
  myBuffs, armBuff, disarmBuff, LIVE_BUFFS,
  myUnlocks, armUnlock, disarmUnlock,
  myWallet, ensureWallet,
  myExtra, buyExtraSlot, sellExtraSlot,
  type LiveMatchup, type PoolPlayer, type PickRow, type Controller,
} from '../data/liveApi';
import { powerupById } from '../data/powerups';

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

export function LivePicks({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [roster, setRoster] = useState<{ leagueId: string; rosterId: number } | null>(null);
  const [controller, setController] = useState<Controller>('human');
  const [aiBusy, setAiBusy] = useState(false);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [picks, setPicks] = useState<Record<string, { player_slug: string | null; metric_id: string | null }>>({});
  const [buffs, setBuffs] = useState<Set<string>>(new Set());
  const [unlocks, setUnlocks] = useState<Set<string>>(new Set());
  const [coins, setCoins] = useState<number>(0);
  const [buffBusy, setBuffBusy] = useState<string | null>(null);
  const [extra, setExtra] = useState<number>(0);
  const [extraPicks, setExtraPicks] = useState<{ win: string | null; player_slug: string | null; metric_id: string | null }[]>([]);
  const [extraBusy, setExtraBusy] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await myRoster(userId);
        if (!r) { setState('none'); return; }
        setRoster(r);
        myMembership(r.leagueId, r.rosterId).then((mm) => { if (mm?.controller) setController(mm.controller); }).catch(() => {});
        const m = await myMatchup(r.leagueId, r.rosterId);
        if (!m) { setState('none'); return; }
        setMatchup(m);
        const [pl, pk, bf, un, ex] = await Promise.all([myPool(r.leagueId, m.week, r.rosterId), myPicks(m.id, userId), myBuffs(m.id), myUnlocks(m.id), myExtra(m.id).catch(() => 0)]);
        setPool(pl);
        const map: Record<string, { player_slug: string | null; metric_id: string | null }> = {};
        const xs: { win: string | null; player_slug: string | null; metric_id: string | null }[] = [];
        for (const p of pk) {
          const xm = /^x(\d+)$/.exec(p.roster_slot); // extra slots are 'x0','x1',…
          if (xm) xs[Number(xm[1])] = { win: p.game_window, player_slug: p.player_slug, metric_id: p.metric_id };
          else map[`${p.game_window}-${p.roster_slot}`] = { player_slug: p.player_slug, metric_id: p.metric_id };
        }
        setPicks(map);
        const n = Number(ex ?? 0);
        setExtra(n);
        setExtraPicks(Array.from({ length: n }, (_, i) => xs[i] ?? { win: null, player_slug: null, metric_id: null }));
        setBuffs(new Set(bf ?? []));
        setUnlocks(new Set(un ?? []));
        ensureWallet(m.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {}); // seeds once + balance
        setState('ready');
      } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load.'); setState('none'); }
    })();
  }, [userId]);

  const posBySlug = useMemo(() => Object.fromEntries(pool.map((p) => [p.slug, p.pos])), [pool]);
  const locked = !!matchup && (matchup.status !== 'scheduled' || (!!matchup.lock_at && new Date(matchup.lock_at) <= new Date()));

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
    const rows = [...baseRows, ...extraRows].filter((r) => r.game_window && r.player_slug); // only filled slots
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

  const toggleBuff = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    const armed = buffs.has(id);
    if (!armed && coins < priceOf(id)) { setErr(insufficientMsg(id)); return; }
    setBuffBusy(id); setErr(null);
    try {
      const r = armed ? await disarmBuff(matchup.id, id) : await armBuff(matchup.id, id);
      if (r.ok && r.buffs) { setBuffs(new Set(r.buffs)); refreshCoins(); }
      else setErr(r.error === 'insufficient' ? insufficientMsg(id) : (r.error ?? 'Could not update power-ups.'));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update power-ups.'); }
    finally { setBuffBusy(null); }
  };

  const toggleUnlock = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    const armed = unlocks.has(id);
    if (!armed && coins < priceOf(id)) { setErr(insufficientMsg(id)); return; }
    setBuffBusy(id); setErr(null);
    try {
      const r = armed ? await disarmUnlock(matchup.id, id) : await armUnlock(matchup.id, id);
      if (r.ok && r.unlocks) {
        setUnlocks(new Set(r.unlocks));
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

  const toggleAi = async () => {
    if (!roster || aiBusy) return;
    const next: Controller = controller === 'ai' ? 'human' : 'ai';
    setAiBusy(true);
    try { const r = await setTeamController(roster.leagueId, roster.rosterId, next); if (r.ok) setController(next); }
    catch { /* leave as-is */ }
    finally { setAiBusy(false); }
  };

  if (state === 'loading') return <Muted text="Loading your matchup…" />;
  if (state === 'none') return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>You’re all set — no matchup yet</div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
        Your team is enrolled. Your week-1 matchup appears here once your commissioner syncs the schedule — check back closer to kickoff. {err && <><br />— {err}</>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 14 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );

  const filled = SLOTS.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;

  return (
    <div>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Week {matchup!.week} lineup</div>
          <span className="mono" style={{ fontSize: 9, color: locked ? 'var(--opp)' : 'var(--you)', border: `1px solid ${locked ? 'var(--opp)' : 'var(--you)'}`, borderRadius: 4, padding: '3px 7px' }}>{locked ? 'LOCKED' : `LOCKS ${fmtLock(matchup!.lock_at)}`}</span>
        </div>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          Pick a player + a hidden metric per slot. Sealed picks stay hidden from your opponent until kickoff. {filled}/{SLOTS.length} set.
          {gateOn && <><br />Each slot only takes players whose real NFL team plays in that window. Players on a bye can’t be slotted.</>}
        </div>
        {/* Season-long auto-pilot: AI sets the team's best lineup each week. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: controller === 'ai' ? 'var(--you)' : 'var(--text)' }}>🤖 Auto-pilot {controller === 'ai' ? 'ON' : 'OFF'}</div>
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
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--you)' }}>◆ {Math.round(coins)} coin</span>
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
            Arm before kickoff — each buffs your whole lineup all week, spent from your drip coin. Locks at kickoff.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {LIVE_BUFFS.map((id) => {
              const pu = powerupById(id);
              const on = buffs.has(id);
              const afford = on || coins >= priceOf(id);
              return (
                <button key={id} onClick={() => toggleBuff(id)} disabled={locked || !!buffBusy || !afford} title={pu?.blurb}
                  className="mono"
                  style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: on ? 'var(--on-accent)' : afford ? 'var(--text)' : 'var(--faint)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 14, padding: '6px 11px', cursor: locked || !afford ? 'default' : 'pointer', opacity: locked ? 0.55 : buffBusy === id ? 0.6 : afford ? 1 : 0.5 }}>
                  {pu?.icon} {pu?.name ?? id} {on ? '✓' : `◆${priceOf(id)}`}
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
              const on = unlocks.has(id);
              const afford = on || coins >= priceOf(id);
              return (
                <button key={id} onClick={() => toggleUnlock(id)} disabled={locked || !!buffBusy || !afford} title={pu?.blurb}
                  className="mono"
                  style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: on ? 'var(--on-accent)' : afford ? 'var(--text)' : 'var(--faint)', background: on ? 'var(--streak, var(--you))' : 'var(--bg)', border: `1px solid ${on ? 'var(--streak, var(--you))' : 'var(--bd)'}`, borderRadius: 14, padding: '6px 11px', cursor: locked || !afford ? 'default' : 'pointer', opacity: locked ? 0.55 : buffBusy === id ? 0.6 : afford ? 1 : 0.5 }}>
                  {pu?.icon} {pu?.name ?? id} {on ? '✓' : `◆${priceOf(id)}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {WINDOWS.map((w) => {
        const elig = gateOn ? pool.filter((pl) => winBySlug[pl.slug] === 'any' || winBySlug[pl.slug] === w.id).length : pool.length;
        return (
        <div key={w.id} style={{ ...card, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 }}>{w.label} · {w.sub}</div>
            {gateOn && <div className="mono" style={{ fontSize: 9, color: elig ? 'var(--faint)' : 'var(--opp)' }}>{elig} eligible</div>}
          </div>
          {SLOTS.filter((s) => s.win === w.id).map((s) => {
            const p = picks[s.key] ?? { player_slug: null, metric_id: null };
            const pos = (p.player_slug ? posBySlug[p.player_slug] : null) as Pos | null;
            // Locked metrics appear only once their unlock power-up is armed.
            const metrics = pos ? (METRICS[pos] ?? []).filter((m) => !m.lock || unlocks.has(m.lock)) : [];
            const options = eligibleFor(w.id, p.player_slug);
            return (
              <div key={s.key} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={p.player_slug ?? ''} disabled={locked} onChange={(e) => setSlot(s.key, { player_slug: e.target.value || null })} style={{ ...sel, flex: 1.3 }}>
                  <option value="">{options.length ? '— player —' : '— none this window —'}</option>
                  {options.map((pl) => <option key={pl.slug} value={pl.slug}>{pl.full} ({pl.pos}{teamBySlug[pl.slug] ? ` · ${teamBySlug[pl.slug]}` : ''})</option>)}
                </select>
                <select value={p.metric_id ?? ''} disabled={locked || !pos} onChange={(e) => setSlot(s.key, { metric_id: e.target.value || null })} style={{ ...sel, flex: 1 }}>
                  <option value="">— metric —</option>
                  {metrics.map((m) => <option key={m.id} value={m.id}>{m.lock ? '🔓 ' : ''}{m.name} · {m.tag}</option>)}
                </select>
              </div>
            );
          })}
        </div>
        );
      })}

      {/* Extra slots (cap 2): a buyable power-up that adds one-sided bonus slots.
          Each plays unopposed → a best-ball backup. AI teams buy their own. */}
      {controller !== 'ai' && (
        <div style={{ ...card, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Extra slots</div>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{extra}/2 owned · ◆ {Math.round(coins)}</span>
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
            Add up to 2 bonus lineup slots (◆{priceOf('extra-slot')} each). An extra slot is one-sided — it plays unopposed as a best-ball backup. Choose its window, then a player + metric. Slate-gated like any pick.
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={buyExtra} disabled={locked || extraBusy || extra >= 2 || coins < priceOf('extra-slot')} className="mono"
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--you)', background: 'var(--bg)', border: '1px solid var(--you)', borderRadius: 14, padding: '6px 11px', cursor: locked || extra >= 2 || coins < priceOf('extra-slot') ? 'default' : 'pointer', opacity: locked || extra >= 2 || coins < priceOf('extra-slot') ? 0.5 : 1 }}>
              ➕ extra slot ◆{priceOf('extra-slot')}
            </button>
            {extra > 0 && (
              <button onClick={sellExtra} disabled={locked || extraBusy} className="mono"
                style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 14, padding: '6px 11px', cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.5 : 1 }}>
                ➖ sell ◆{priceOf('extra-slot')}
              </button>
            )}
          </div>
          {extraPicks.map((ep, i) => {
            const eligible = ep.win ? eligibleFor(ep.win, ep.player_slug) : [];
            const ms = metricsFor(ep.player_slug);
            return (
              <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <select value={ep.win ?? ''} disabled={locked} onChange={(e) => setExtraSlot(i, { win: e.target.value || null })} style={{ ...sel, flex: 0.9 }}>
                  <option value="">— window —</option>
                  {WINDOWS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
                <select value={ep.player_slug ?? ''} disabled={locked || !ep.win} onChange={(e) => setExtraSlot(i, { player_slug: e.target.value || null })} style={{ ...sel, flex: 1.3 }}>
                  <option value="">{ep.win ? (eligible.length ? '— player —' : '— none this window —') : '— pick a window —'}</option>
                  {eligible.map((pl) => <option key={pl.slug} value={pl.slug}>{pl.full} ({pl.pos}{teamBySlug[pl.slug] ? ` · ${teamBySlug[pl.slug]}` : ''})</option>)}
                </select>
                <select value={ep.metric_id ?? ''} disabled={locked || !ep.player_slug} onChange={(e) => setExtraSlot(i, { metric_id: e.target.value || null })} style={{ ...sel, flex: 1 }}>
                  <option value="">— metric —</option>
                  {ms.map((m) => <option key={m.id} value={m.id}>{m.lock ? '🔓 ' : ''}{m.name} · {m.tag}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', margin: '4px 0 10px' }}>{err}</div>}
      {!locked && <button onClick={seal} disabled={saving} className="mono" style={{ ...btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'SEALING…' : saved ? 'SEALED ✓ — UPDATE' : 'SEAL LINEUP'}</button>}
      {saved && !locked && <div className="mono" style={{ fontSize: 9.5, color: 'var(--you)', textAlign: 'center', marginTop: 8 }}>Saved. Editable until kickoff.</div>}
      {locked && <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', textAlign: 'center' }}>This week is locked — picks are final.</div>}
      <div style={{ textAlign: 'center', marginTop: 14 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)' }}>{text}</div>;
}
