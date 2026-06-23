import { useEffect, useMemo, useState } from 'react';
import { WINDOWS, METRICS } from '../data/metrics';
import type { Pos } from '../types';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks,
  type LiveMatchup, type PoolPlayer, type PickRow,
} from '../data/liveApi';

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
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [picks, setPicks] = useState<Record<string, { player_slug: string | null; metric_id: string | null }>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await myRoster(userId);
        if (!r) { setState('none'); return; }
        const m = await myMatchup(r.leagueId, r.rosterId);
        if (!m) { setState('none'); return; }
        setMatchup(m);
        const [pl, pk] = await Promise.all([myPool(r.leagueId, m.week, r.rosterId), myPicks(m.id, userId)]);
        setPool(pl);
        const map: Record<string, { player_slug: string | null; metric_id: string | null }> = {};
        for (const p of pk) map[`${p.game_window}-${p.roster_slot}`] = { player_slug: p.player_slug, metric_id: p.metric_id };
        setPicks(map);
        setState('ready');
      } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load.'); setState('none'); }
    })();
  }, [userId]);

  const posBySlug = useMemo(() => Object.fromEntries(pool.map((p) => [p.slug, p.pos])), [pool]);
  const locked = !!matchup && (matchup.status !== 'scheduled' || (!!matchup.lock_at && new Date(matchup.lock_at) <= new Date()));

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

  if (state === 'loading') return <Muted text="Loading your matchup…" />;
  if (state === 'none') return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>No matchup yet</div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
        Your weekly schedule hasn’t synced yet (the commissioner / worker imports it). {err && <><br />— {err}</>}
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
        </div>
      </div>

      {WINDOWS.map((w) => (
        <div key={w.id} style={{ ...card, marginBottom: 10 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 8 }}>{w.label} · {w.sub}</div>
          {SLOTS.filter((s) => s.win === w.id).map((s) => {
            const p = picks[s.key] ?? { player_slug: null, metric_id: null };
            const pos = (p.player_slug ? posBySlug[p.player_slug] : null) as Pos | null;
            const metrics = pos ? (METRICS[pos] ?? []).filter((m) => !m.lock) : [];
            return (
              <div key={s.key} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={p.player_slug ?? ''} disabled={locked} onChange={(e) => setSlot(s.key, { player_slug: e.target.value || null })} style={{ ...sel, flex: 1.3 }}>
                  <option value="">— player —</option>
                  {pool.map((pl) => <option key={pl.slug} value={pl.slug}>{pl.full} ({pl.pos})</option>)}
                </select>
                <select value={p.metric_id ?? ''} disabled={locked || !pos} onChange={(e) => setSlot(s.key, { metric_id: e.target.value || null })} style={{ ...sel, flex: 1 }}>
                  <option value="">— metric —</option>
                  {metrics.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.tag}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      ))}

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
