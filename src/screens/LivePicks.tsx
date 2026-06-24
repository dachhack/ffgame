import { useEffect, useMemo, useState } from 'react';
import { WINDOWS, METRICS } from '../data/metrics';
import { windowForTeam, hasSlate } from '../data/nflSlate';
import { slugMeta } from '../data/slugMeta';
import type { Pos, WindowId } from '../types';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, myMembership, setTeamController,
  myBuffs, armBuff, disarmBuff, LIVE_BUFFS,
  type LiveMatchup, type PoolPlayer, type PickRow, type Controller,
} from '../data/liveApi';
import { powerupById } from '../data/powerups';

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
  const [buffBusy, setBuffBusy] = useState<string | null>(null);
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
        const [pl, pk, bf] = await Promise.all([myPool(r.leagueId, m.week, r.rosterId), myPicks(m.id, userId), myBuffs(m.id)]);
        setPool(pl);
        const map: Record<string, { player_slug: string | null; metric_id: string | null }> = {};
        for (const p of pk) map[`${p.game_window}-${p.roster_slot}`] = { player_slug: p.player_slug, metric_id: p.metric_id };
        setPicks(map);
        setBuffs(new Set(bf ?? []));
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
    const rows: PickRow[] = SLOTS.map((s) => {
      const p = picks[s.key];
      return { game_window: s.win, roster_slot: s.slot, player_slug: p?.player_slug ?? null, metric_id: p?.metric_id ?? null };
    }).filter((r) => r.player_slug); // only filled slots
    try { await savePicks(matchup.id, userId, rows); setSaved(true); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not seal picks.'); }
    finally { setSaving(false); }
  };

  const toggleBuff = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    const armed = buffs.has(id);
    setBuffBusy(id); setErr(null);
    try {
      const r = armed ? await disarmBuff(matchup.id, id) : await armBuff(matchup.id, id);
      if (r.ok && r.buffs) setBuffs(new Set(r.buffs));
      else if (r.error) setErr(r.error);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update power-ups.'); }
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
            <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{buffs.size} armed · free</span>
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
            Arm before kickoff — each buffs your whole lineup all week. Locks at kickoff.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {LIVE_BUFFS.map((id) => {
              const pu = powerupById(id);
              const on = buffs.has(id);
              return (
                <button key={id} onClick={() => toggleBuff(id)} disabled={locked || !!buffBusy} title={pu?.blurb}
                  className="mono"
                  style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: on ? 'var(--on-accent)' : 'var(--text)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 14, padding: '6px 11px', cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.55 : buffBusy === id ? 0.6 : 1 }}>
                  {pu?.icon} {pu?.name ?? id}{on ? ' ✓' : ''}
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
            const metrics = pos ? (METRICS[pos] ?? []).filter((m) => !m.lock) : [];
            const options = eligibleFor(w.id, p.player_slug);
            return (
              <div key={s.key} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={p.player_slug ?? ''} disabled={locked} onChange={(e) => setSlot(s.key, { player_slug: e.target.value || null })} style={{ ...sel, flex: 1.3 }}>
                  <option value="">{options.length ? '— player —' : '— none this window —'}</option>
                  {options.map((pl) => <option key={pl.slug} value={pl.slug}>{pl.full} ({pl.pos}{teamBySlug[pl.slug] ? ` · ${teamBySlug[pl.slug]}` : ''})</option>)}
                </select>
                <select value={p.metric_id ?? ''} disabled={locked || !pos} onChange={(e) => setSlot(s.key, { metric_id: e.target.value || null })} style={{ ...sel, flex: 1 }}>
                  <option value="">— metric —</option>
                  {metrics.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.tag}</option>)}
                </select>
              </div>
            );
          })}
        </div>
        );
      })}

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
