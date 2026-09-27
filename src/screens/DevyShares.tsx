// DEVY SHARES (0387) — the web twin of apps/mobile/src/ui/DevyShares.tsx.
// Every team has 100 shares to put on college players, at most 20 on one.
// The first team to 20 holds his right; failing that, the only team in does,
// with 5 or more. A right reserves him in the rookie draft, at any of the
// holder's picks, once he turns pro.
import { useEffect, useMemo, useState } from 'react';
import { allotDevyShares, collegeDirectory, devySharesState, friendlyError, setLeagueDevyMode, type CollegeDirectoryRow, type DevySharePlayer, type DevySharesState } from '@drip/core/data/liveApi';
import { collegeSlug, collegeClassLabel } from '@drip/core/data/college';
import { sharesUsed, myStake, rightLine, lockLine } from '@drip/core/data/devyShares';

const chip = (on: boolean): React.CSSProperties => ({
  fontFamily: 'var(--mono, monospace)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', padding: '4px 9px',
  borderRadius: 999, border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, background: on ? 'var(--you)' : 'transparent',
  color: on ? 'var(--on-accent)' : 'var(--dim)', cursor: 'pointer',
});
const small: React.CSSProperties = { fontSize: 11.5, color: 'var(--dim)' };

export function DevySharesPanel({ leagueId, myRoster }: { leagueId: string; myRoster: number | null }) {
  const [st, setSt] = useState<DevySharesState | null>(null);
  const [view, setView] = useState<'mine' | 'league' | 'add'>('mine');
  const [dir, setDir] = useState<CollegeDirectoryRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => devySharesState(leagueId).then(setSt).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  useEffect(() => {
    if (view === 'add' && !dir) collegeDirectory(['QB', 'RB', 'WR', 'TE'], 800).then((r) => setDir(Array.isArray(r) ? r : [])).catch(() => setDir([]));
  }, [view, dir]);
  const bySlug = useMemo(() => new Map((st?.players ?? []).map((p) => [p.slug, p])), [st]);
  const addList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (dir ?? []).filter((r) => !needle || r.full.toLowerCase().includes(needle) || (r.school_abbr ?? '').toLowerCase().includes(needle)).slice(0, 60);
  }, [dir, q]);
  if (!st?.ok || !st.on) return null;
  const rules = st.rules ?? { budget: 100, max: 20, floor: 5 };
  const budget = sharesUsed(st, myRoster);
  const mine = (st.players ?? []).filter((p) => myStake(p, myRoster) > 0);
  const locked = !!st.locked;

  const set = async (slug: string, n: number) => {
    if (myRoster == null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await allotDevyShares(leagueId, myRoster, slug, Math.max(0, Math.min(rules.max, n)));
      if (!r.ok) setMsg(`✗ ${friendlyError(r.error ?? 'failed')}`); else await load();
    } catch (e) { setMsg(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  const controls = (slug: string, cur: number) => (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
      {cur > 0 && <button style={chip(false)} disabled={busy || locked} onClick={() => void set(slug, cur - 5)}>−5</button>}
      {cur > 0 && <button style={chip(false)} disabled={busy || locked} onClick={() => void set(slug, cur - 1)}>−1</button>}
      <button style={chip(false)} disabled={busy || locked || cur >= rules.max} onClick={() => void set(slug, cur + 1)}>+1</button>
      <button style={chip(false)} disabled={busy || locked || cur >= rules.max} onClick={() => void set(slug, cur + 5)}>+5</button>
      <button style={chip(true)} disabled={busy || locked || cur >= rules.max} onClick={() => void set(slug, rules.max)}>MAX {rules.max}</button>
      {cur > 0 && <button style={chip(false)} disabled={busy || locked} onClick={() => void set(slug, 0)}>remove</button>}
    </div>
  );
  const row = (p: DevySharePlayer, edit: boolean) => {
    const cur = myStake(p, myRoster);
    const yours = myRoster != null && p.right?.roster_id === myRoster;
    return (
      <div key={p.slug} style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 700, color: 'var(--text)', flex: 1 }}>{p.name ?? p.slug} <span style={small}>{[p.pos, p.school, p.class_year ? collegeClassLabel(p.class_year) : null, p.graduated_to ? 'TURNED PRO' : null].filter(Boolean).join(' · ')}</span></span>
          {cur > 0 && <span className="mono" style={{ fontWeight: 700, color: yours ? 'var(--you)' : 'var(--text)' }}>{cur}</span>}
        </div>
        <div className="mono" style={{ fontSize: 11, color: yours ? 'var(--you)' : 'var(--dim)', marginTop: 2 }}>{rightLine(p, myRoster, rules.floor, rules.max)}</div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{p.holders.map((h) => `${h.team} ${h.shares}`).join(' · ')}</div>
        {edit && myRoster != null && !p.graduated_to && controls(p.slug, cur)}
      </div>
    );
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)' }}>
        DEVY SHARES{myRoster != null ? ` · ${budget.used}/${budget.budget} PLACED · ${budget.free} FREE` : ''}
      </div>
      <div style={{ ...small, margin: '4px 0 8px' }}>
        Put up to {rules.max} shares on a college player. First team to {rules.max} holds his right; if you're the only team in, {rules.floor}+ holds it.
        His right reserves him for you in the rookie draft, at any of your picks. Shares come back once he's drafted into the NFL and the rookie draft is done. {lockLine(st)}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button style={chip(view === 'mine')} onClick={() => setView('mine')}>MINE ({mine.length})</button>
        <button style={chip(view === 'league')} onClick={() => setView('league')}>LEAGUE ({st.players?.length ?? 0})</button>
        <button style={chip(view === 'add')} onClick={() => setView('add')}>+ ADD</button>
      </div>
      {msg && <div className="mono" style={{ fontSize: 11, color: 'var(--opp)' }}>{msg}</div>}
      {view === 'mine' && (mine.length ? mine.map((p) => row(p, true)) : <div style={small}>No shares placed yet. Use + ADD to put some on a college player.</div>)}
      {view === 'league' && ((st.players ?? []).length ? (st.players ?? []).map((p) => row(p, false)) : <div style={small}>Nobody in the league has placed shares yet.</div>)}
      {view === 'add' && (<>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search college players or schools…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} />
        {!dir && <div style={small}>Loading college players…</div>}
        {addList.map((r) => {
          const slug = collegeSlug(r.espn_id);
          const held = bySlug.get(slug);
          if (held) return row(held, true);
          return (
            <div key={slug} style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>{r.full}</span>{' '}
              <span style={small}>{[r.pos, r.school_abbr, r.class_year ? collegeClassLabel(r.class_year) : null, r.ppg != null ? `${Number(r.ppg).toFixed(1)} PPG` : null].filter(Boolean).join(' · ')} · nobody in yet</span>
              {myRoster != null && controls(slug, 0)}
            </div>
          );
        })}
      </>)}
    </div>
  );
}

/** The commissioner's switch: devy SPOTS (a roster shelf) or SHARES. */
export function DevyModeRow({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { devySharesState(leagueId).then((r) => setOn(!!r.on)).catch(() => setOn(null)); }, [leagueId]);
  if (on == null) return null;
  const pick = async (mode: 'spots' | 'shares') => {
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueDevyMode(leagueId, mode);
      if (r.ok) { setOn(mode === 'shares'); setNote(mode === 'shares' ? '✓ devy shares on — the league chat says so' : '✓ back to devy spots'); }
      else setNote(`✗ ${friendlyError(r.error ?? 'failed')}`);
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--dim)' }}
        title="SPOTS: college players sit in devy roster spots. SHARES: every team puts 100 shares on college players; first to 20 (or the only team in, with 5+) holds his rookie-draft right. Shares need the DEVY spots at 0 and no college players on rosters.">DEVY</span>
      <button style={chip(!on)} disabled={busy || !on} onClick={() => void pick('spots')}>SPOTS</button>
      <button style={chip(on)} disabled={busy || on} onClick={() => void pick('shares')}>SHARES</button>
      {note && <span className="mono" style={{ fontSize: 11, color: note.startsWith('✗') ? 'var(--opp)' : 'var(--you)' }}>{note}</span>}
    </div>
  );
}
