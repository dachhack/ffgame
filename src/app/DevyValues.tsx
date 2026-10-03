// DEVY VALUES in the gear (v0.601.0, 0417) — the web twin of
// apps/mobile/src/ui/DevyValues.tsx. Any signed-in player, any league.
import { useEffect, useState, type CSSProperties } from 'react';
import { devyBaseValues } from '@drip/core/data/liveApi';
import { DEVY_VALUE_POSITIONS, devyValueSub, fmtValue, refreshedLabel, type DevyValueRow } from '@drip/core/data/devyValues';
import { Sheet } from './ui';

const PAGE = 100;

export function DevyValuesSheet({ onClose }: { onClose: () => void }) {
  const [sort, setSort] = useState<'sf' | '1qb'>('sf');
  const [pos, setPos] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<DevyValueRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const load = (offset: number) =>
    devyBaseValues({ sort, pos: pos === 'ALL' ? null : pos, q: q.trim().length >= 2 ? q : null, limit: PAGE, offset })
      .then((p) => {
        setErr(false); setAsOf(p?.as_of ?? null); setTotal(p?.total ?? 0);
        setRows((prev) => (offset ? [...(prev ?? []), ...(p?.rows ?? [])] : (p?.rows ?? [])));
      })
      .catch(() => { setErr(true); if (!offset) setRows([]); });
  useEffect(() => { setRows(null); const id = setTimeout(() => void load(0), q ? 300 : 0); return () => clearTimeout(id); }, [sort, pos, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (on: boolean): CSSProperties => ({
    padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
    border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, background: on ? 'var(--sh)' : 'var(--bg)', color: on ? 'var(--you)' : 'var(--dim)',
  });
  const num: CSSProperties = { width: 64, textAlign: 'right', flex: 'none' };
  return (
    <Sheet title="🎓 Devy values" subtitle={refreshedLabel(asOf).toUpperCase()} max={560} onClose={onClose}>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dim)' }}>
          What a devy share is worth, from StatHead's composite rankings. 1QB is the devy market's price; SF is the same scale on the superflex rank.
        </div>
        <div className="mono" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['sf', '1qb'] as const).map((s) => <button key={s} onClick={() => setSort(s)} style={chip(sort === s)}>SORT {s.toUpperCase()}</button>)}
          {DEVY_VALUE_POSITIONS.map((p) => <button key={p} onClick={() => setPos(p)} style={chip(pos === p)}>{p}</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search a player or school"
          style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
        <div className="mono" style={{ display: 'flex', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>
          <span style={{ flex: 1 }}>PLAYER</span>
          <span style={{ ...num, color: sort === '1qb' ? 'var(--you)' : undefined }}>1QB</span>
          <span style={{ ...num, color: sort === 'sf' ? 'var(--you)' : undefined }}>SF</span>
        </div>
        {rows == null ? <div style={{ color: 'var(--dim)', fontSize: 12.5 }}>Loading…</div>
          : err && !rows.length ? <div style={{ color: 'var(--dim)', fontSize: 12.5 }}>Couldn't load devy values. Try again in a moment.</div>
          : !rows.length ? <div style={{ color: 'var(--dim)', fontSize: 12.5 }}>No players match.</div>
          : rows.map((r) => (
            <div key={r.espn_id} style={{ display: 'flex', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid color-mix(in srgb, var(--bd) 60%, transparent)' }}>
              <span className="mono" style={{ width: 36, flex: 'none', fontSize: 11, fontWeight: 700, color: 'var(--dim)' }}>{sort === 'sf' ? (r.rank_sf ?? '—') : r.rank_1qb}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{devyValueSub(r)}</span>
              </span>
              <span className="mono" style={{ ...num, fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{fmtValue(r.value_1qb)}</span>
              <span className="mono" style={{ ...num, fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{fmtValue(r.value_sf)}</span>
            </div>
          ))}
        {!!rows && rows.length < total && (
          <button className="mono" onClick={() => void load(rows.length)} style={{ ...chip(false), alignSelf: 'center' }}>SHOW MORE · {rows.length} OF {total}</button>
        )}
      </div>
    </Sheet>
  );
}
