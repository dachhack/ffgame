import { useEffect, useState } from 'react';
import {
  adminOverview, adminMatchups, adminSetMatchup, adminOverrides, adminSetOverride, adminAudit,
  type AdminLeague, type AdminMatchup, type AdminOverride, type AdminAudit,
} from '../data/liveApi';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14, marginBottom: 12 };
const h: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 10 };
const mono: React.CSSProperties = { fontFamily: 'var(--mono, monospace)' };
const chip: React.CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 6px', color: 'var(--text)', background: 'var(--bg)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const btn = (active = false): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: active ? 'var(--on-accent)' : 'var(--text)', background: active ? 'var(--you)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' });

const code = (v: string) => (
  <span className="mono" style={{ ...mono, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', cursor: 'pointer' }}
    onClick={() => navigator.clipboard?.writeText(v)} title="copy">{v}</span>
);

export function AdminPage({ onBack }: { onBack: () => void }) {
  const [leagues, setLeagues] = useState<AdminLeague[] | null>(null);
  const [overrides, setOverrides] = useState<AdminOverride[]>([]);
  const [audit, setAudit] = useState<AdminAudit[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try { setLeagues(await adminOverview()); setOverrides(await adminOverrides()); setAudit(await adminAudit(40)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Load failed.'); setLeagues([]); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>⚙ Super admin</span>
        <button onClick={load} className="mono" style={linkBtn}>↻ refresh</button>
      </div>
      {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginBottom: 10 }}>{err}</div>}

      <div style={card}>
        <div style={h}>LEAGUES</div>
        {leagues === null ? <Muted text="Loading…" /> : leagues.length === 0 ? <Muted text="No leagues imported yet." /> :
          leagues.map((l) => <LeagueRow key={l.league_id} l={l} />)}
      </div>

      <Overrides overrides={overrides} reload={load} />

      <div style={card}>
        <div style={h}>RECENT AUDIT</div>
        {audit.length === 0 ? <Muted text="No activity." /> : audit.map((a, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 10.5 }}>
            <span className="mono" style={{ ...mono, color: 'var(--text)' }}>{a.op} <span style={{ color: 'var(--dim)' }}>{a.table}</span></span>
            <span className="mono" style={{ ...mono, color: 'var(--faint)', fontSize: 9.5 }}>{new Date(a.at).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 6 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}

function LeagueRow({ l }: { l: AdminLeague }) {
  const [matchups, setMatchups] = useState<AdminMatchup[] | null>(null);
  const [open, setOpen] = useState(false);

  const loadM = async () => setMatchups(await adminMatchups(l.league_id));
  const toggle = () => { setOpen((o) => !o); if (!matchups) loadM(); };
  const set = async (id: string, status: string, lockNow = false) => { await adminSetMatchup(id, status, lockNow); await loadM(); };

  return (
    <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{l.name} <span className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)' }}>· {l.season}</span></div>
          <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--dim)', marginTop: 3 }}>{l.enrolled}/{l.rosters} enrolled · commish {l.commissioner ? '✓' : '—'}</div>
        </div>
        <button onClick={toggle} className="mono" style={linkBtn}>{open ? 'hide' : 'matchups'}</button>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ ...chip }}>commish&nbsp;{code(l.commish_code)}</span>
        <span style={{ ...chip }}>invite&nbsp;{code(l.invite_code)}</span>
      </div>
      {open && matchups && (
        <div style={{ marginTop: 10 }}>
          {matchups.length === 0 ? <Muted text="No matchups (run sync-week)." /> : matchups.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--bd)', flexWrap: 'wrap', gap: 6 }}>
              <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--text)' }}>W{m.week} · {m.home_roster_id}v{m.away_roster_id} · <span style={{ color: 'var(--you)' }}>{m.status}</span></span>
              <div style={{ display: 'flex', gap: 5 }}>
                <button style={btn(m.status === 'scheduled')} onClick={() => set(m.id, 'scheduled')}>sched</button>
                <button style={btn(m.status === 'live')} onClick={() => set(m.id, 'live', true)}>live+lock</button>
                <button style={btn(m.status === 'final')} onClick={() => set(m.id, 'final')}>final</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Overrides({ overrides, reload }: { overrides: AdminOverride[]; reload: () => void }) {
  const [sid, setSid] = useState('');
  const [note, setNote] = useState('');
  const add = async () => { if (!sid.trim()) return; await adminSetOverride(sid.trim(), note.trim()); setSid(''); setNote(''); reload(); };
  const rm = async (s: string) => { await adminSetOverride(s, '', true); reload(); };
  const inp: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 10px' };
  return (
    <div style={card}>
      <div style={h}>COMMISSIONER OVERRIDES</div>
      {overrides.map((o) => (
        <div key={o.sleeper_user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
          <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--text)' }}>{o.sleeper_user_id} <span style={{ color: 'var(--faint)' }}>{o.note}</span></span>
          <button onClick={() => rm(o.sleeper_user_id)} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="sleeper_user_id" style={{ ...inp, flex: 1.2, minWidth: 0 }} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" style={{ ...inp, flex: 1, minWidth: 0 }} />
        <button onClick={add} className="mono" style={btn(true)}>add</button>
      </div>
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>{text}</div>;
}
