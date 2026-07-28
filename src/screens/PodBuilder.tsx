// DFS-STYLE TEAM BUILDER (0092) — pods + weekly showdowns build their squad
// under the $50k salary cap instead of receiving a random deal. Renders the
// week's frozen salary board (pod_salary), 9 slots (QB·2RB·3WR·TE·K·DST), a
// budget bar, and a per-slot pick sheet. Saving goes through save_pod_entry,
// which re-validates everything server-side (shape, cap, lock, membership).
import { useEffect, useMemo, useState } from 'react';
import {
  podSalaries, savePodEntry, myPool, defaultOpenWeek, friendlyError,
  POD_SALARY_CAP, type PodSalaryRow,
} from '../data/liveApi';
import { track, Ev } from '../app/analytics';

const SLOTS: { pos: string; label: string }[] = [
  { pos: 'QB', label: 'QB' },
  { pos: 'RB', label: 'RB1' }, { pos: 'RB', label: 'RB2' },
  { pos: 'WR', label: 'WR1' }, { pos: 'WR', label: 'WR2' }, { pos: 'WR', label: 'WR3' },
  { pos: 'TE', label: 'TE' }, { pos: 'K', label: 'K' }, { pos: 'DEF', label: 'D/ST' },
];
const MIN_SALARY = 3000; // matches the worker's board floor

const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

export function PodBuilder({ leagueId, rosterId, week: weekProp, leagueName, onBack }: {
  leagueId: string; rosterId: number; week?: number; leagueName?: string; onBack: () => void;
}) {
  const [week, setWeek] = useState<number | null>(weekProp ?? null);
  const [board, setBoard] = useState<PodSalaryRow[] | null>(null);
  const [picks, setPicks] = useState<(string | null)[]>(() => SLOTS.map(() => null));
  const [active, setActive] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Resolve the week (showdowns pass contest_week; pods may not know yet),
  // then load the board and any existing entry to edit.
  useEffect(() => {
    let ok = true;
    (async () => {
      const w = weekProp ?? await defaultOpenWeek(leagueId, '2026', false).catch(() => 1);
      if (!ok) return;
      setWeek(w);
      const rows = await podSalaries(w).catch(() => [] as PodSalaryRow[]);
      if (!ok) return;
      setBoard(rows);
      // starters_json rows are {slot, sleeper_id, player_slug, pos} — PoolPlayer's
      // declared shape predates that; read the raw field.
      const mine = (await myPool(leagueId, w, rosterId).catch(() => [])) as unknown as { player_slug?: string | null }[];
      if (!ok || !mine.length) return;
      // Re-seat the saved entry into slots by position, in order.
      const bySlug = new Map(rows.map((r) => [r.slug, r]));
      const remaining = mine.map((p) => p.player_slug).filter((s): s is string => !!s && bySlug.has(s));
      setPicks(SLOTS.map(({ pos }) => {
        const i = remaining.findIndex((s) => bySlug.get(s)!.pos === pos);
        return i >= 0 ? remaining.splice(i, 1)[0] : null;
      }));
    })();
    return () => { ok = false; };
  }, [leagueId, rosterId, weekProp]);

  const bySlug = useMemo(() => new Map((board ?? []).map((r) => [r.slug, r])), [board]);
  const spent = picks.reduce((t, s) => t + (s ? bySlug.get(s)?.salary ?? 0 : 0), 0);
  const remaining = POD_SALARY_CAP - spent;
  const emptyN = picks.filter((p) => !p).length;
  const complete = emptyN === 0 && spent <= POD_SALARY_CAP;

  const pickFor = (slot: number, slug: string) => {
    setPicks((p) => p.map((v, i) => (i === slot ? slug : v)));
    setActive(null); setSearch(''); setErr(null); setSaved(false);
  };
  const clearSlot = (slot: number) => {
    setPicks((p) => p.map((v, i) => (i === slot ? null : v)));
    setErr(null); setSaved(false);
  };

  const save = async () => {
    if (saving || !complete || week == null) return;
    setSaving(true); setErr(null);
    try {
      const r = await savePodEntry(leagueId, week, picks.filter((p): p is string => !!p));
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Couldn’t save — try again.')); return; }
      track(Ev.podEntrySaved, { week, spent: r.spent ?? spent });
      setSaved(true);
    } catch (x) { setErr(friendlyError(x)); }
    finally { setSaving(false); }
  };

  // Max a candidate for `active` may cost: the budget after freeing that slot's
  // current pick, minus the minimum spend the OTHER empty slots still need.
  const maxForActive = (slot: number) => {
    const current = picks[slot] ? bySlug.get(picks[slot]!)?.salary ?? 0 : 0;
    const othersEmpty = picks.filter((p, i) => !p && i !== slot).length;
    return remaining + current - othersEmpty * MIN_SALARY;
  };

  if (board === null || week == null) return <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)', padding: '32px 0' }}>Loading the board…</div>;
  if (!board.length) return (
    <div style={{ textAlign: 'center', padding: '32px 0' }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.6 }}>Week {week}’s player board isn’t posted yet — check back closer to game day.</div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginTop: 12 }}>← back</button>
    </div>
  );

  const sheet = active != null && (
    <div style={{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--bg) 72%, transparent)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 60 }} onClick={() => setActive(null)}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '78vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: '12px 12px 0 0', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text)' }}>PICK YOUR {SLOTS[active].label}</span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', flex: 1 }}>max {fmt$(Math.max(0, maxForActive(active)))}</span>
          <button onClick={() => setActive(null)} className="mono" style={linkBtn}>✕ close</button>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search players" autoFocus
          style={{ fontFamily: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '9px 11px', outline: 'none', marginBottom: 8 }} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {board
            .filter((r) => r.pos === SLOTS[active].pos && !picks.includes(r.slug))
            .filter((r) => !search.trim() || (r.name + ' ' + r.team).toLowerCase().includes(search.trim().toLowerCase()))
            .map((r) => {
              const afford = r.salary <= maxForActive(active);
              return (
                <button key={r.slug} onClick={() => afford && pickFor(active, r.slug)} disabled={!afford}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', fontFamily: 'inherit', background: 'none', border: 'none', borderBottom: '1px solid var(--bd)', padding: '9px 4px', cursor: afford ? 'pointer' : 'default', opacity: afford ? 1 : 0.35 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{r.team} · proj {r.proj.toFixed(1)}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: afford ? 'var(--you)' : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{fmt$(r.salary)}</span>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← back</button>
      <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Build your Week {week} squad</div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>{leagueName ? `${leagueName} · ` : ''}9 starters under the {fmt$(POD_SALARY_CAP)} cap. Star somewhere, save somewhere.</div>

      {/* budget bar */}
      <div style={{ margin: '14px 0 12px', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)' }}>SPENT</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: remaining < 0 ? 'var(--opp)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt$(spent)} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>/ {fmt$(POD_SALARY_CAP)}</span></span>
        </div>
        <div style={{ height: 6, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 999, marginTop: 7, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (spent / POD_SALARY_CAP) * 100)}%`, background: remaining < 0 ? 'var(--opp)' : 'var(--you)', transition: 'width 200ms' }} />
        </div>
        <div className="mono" style={{ fontSize: 9, color: remaining < 0 ? 'var(--opp)' : 'var(--faint)', marginTop: 5 }}>
          {remaining < 0 ? `${fmt$(-remaining)} over the cap` : `${fmt$(remaining)} left · ${emptyN} slot${emptyN === 1 ? '' : 's'} open`}
        </div>
      </div>

      {/* slots */}
      {SLOTS.map((s, i) => {
        const r = picks[i] ? bySlug.get(picks[i]!) : null;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: `3px solid ${r ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 7, padding: '10px 12px', marginBottom: 7 }}>
            <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--faint)', width: 34, flexShrink: 0 }}>{s.label}</span>
            {r ? (
              <>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{r.team} · proj {r.proj.toFixed(1)}</span>
                </span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--you)', fontVariantNumeric: 'tabular-nums' }}>{fmt$(r.salary)}</span>
                <button onClick={() => clearSlot(i)} className="mono" style={{ ...linkBtn, color: 'var(--opp)', padding: '2px 4px' }}>✕</button>
              </>
            ) : (
              <button onClick={() => { setActive(i); setSearch(''); }} className="mono"
                style={{ flex: 1, textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>＋ PICK A {s.pos === 'DEF' ? 'D/ST' : s.pos}</button>
            )}
          </div>
        );
      })}

      <button onClick={save} disabled={saving || !complete} className="mono"
        style={{ width: '100%', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: saved ? 'var(--dim)' : 'var(--you)', border: 'none', borderRadius: 6, padding: '13px 0', cursor: saving || !complete ? 'default' : 'pointer', marginTop: 10, opacity: saving || !complete ? 0.55 : 1 }}>
        {saving ? 'SAVING…' : saved ? '✓ ENTRY SAVED — EDIT ANY TIME BEFORE KICKOFF' : complete ? '💾 SAVE ENTRY' : `FILL ${emptyN} MORE SLOT${emptyN === 1 ? '' : 'S'}`}
      </button>
      {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 }}>{err}</div>}

      {sheet}
    </div>
  );
}
