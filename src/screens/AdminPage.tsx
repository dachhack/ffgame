import { useEffect, useState } from 'react';
import {
  adminOverview, adminMatchups, adminSetMatchup, adminOverrides, adminSetOverride, adminAudit,
  adminAdmins, adminSetAdmin, adminUsers, adminLeagueMembers, adminRegenCode,
  type AdminLeague, type AdminMatchup, type AdminOverride, type AdminAudit, type AdminAdmin, type AdminUser, type AdminMember,
} from '../data/liveApi';
import { importLeague, syncWeek } from '../data/sleeperAdmin';

const shareLink = (code: string) => `${window.location.origin}${window.location.pathname}?live=1&code=${code}`;
const copy = (v: string) => navigator.clipboard?.writeText(v);

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14, marginBottom: 12 };
const h: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 10 };
const mono: React.CSSProperties = { fontFamily: 'var(--mono, monospace)' };
const chip: React.CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 6px', color: 'var(--text)', background: 'var(--bg)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const btn = (active = false): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: active ? 'var(--on-accent)' : 'var(--text)', background: active ? 'var(--you)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' });
const inp: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 10px' };

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

      <ImportLeague reload={load} />

      <div style={card}>
        <div style={h}>LEAGUES</div>
        {leagues === null ? <Muted text="Loading…" /> : leagues.length === 0 ? <Muted text="No leagues imported yet." /> :
          leagues.map((l) => <LeagueRow key={l.league_id} l={l} reload={load} />)}
      </div>

      <Overrides overrides={overrides} reload={load} />
      <Admins />
      <Users />

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

function LeagueRow({ l, reload }: { l: AdminLeague; reload: () => void }) {
  const [matchups, setMatchups] = useState<AdminMatchup[] | null>(null);
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [tab, setTab] = useState<'' | 'matchups' | 'members'>('');
  const [week, setWeek] = useState('1');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadM = async () => setMatchups(await adminMatchups(l.league_id));
  const loadMembers = async () => setMembers(await adminLeagueMembers(l.league_id));
  const showTab = (t: 'matchups' | 'members') => {
    setTab((cur) => (cur === t ? '' : t));
    if (t === 'matchups' && !matchups) loadM();
    if (t === 'members' && !members) loadMembers();
  };
  const set = async (id: string, status: string, lockNow = false) => { await adminSetMatchup(id, status, lockNow); await loadM(); };
  const sync = async () => {
    setBusy('sync');
    try { const r = await syncWeek(l.league_id, l.sleeper_league_id, Number(week)); setBusy(`✓ ${r.pairs} matchups`); setTab('matchups'); await loadM(); }
    catch (e) { setBusy(e instanceof Error ? e.message : 'sync failed'); }
  };
  const regen = async (which: 'invite' | 'commish') => {
    if (!confirm(`Regenerate the ${which} code? The old one stops working.`)) return;
    const r = await adminRegenCode(l.league_id, which);
    if (r.ok) reload();
  };

  return (
    <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{l.name} <span className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)' }}>· {l.season}</span></div>
          <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--dim)', marginTop: 3 }}>{l.enrolled}/{l.rosters} enrolled · commish {l.commissioner ? '✓' : '—'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => showTab('members')} className="mono" style={linkBtn}>{tab === 'members' ? 'hide' : 'members'}</button>
          <button onClick={() => showTab('matchups')} className="mono" style={linkBtn}>{tab === 'matchups' ? 'hide' : 'matchups'}</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...chip }}>commish&nbsp;{code(l.commish_code)}</span>
        <button onClick={() => regen('commish')} className="mono" style={{ ...linkBtn, fontSize: 9 }} title="regenerate">↻</button>
        <span style={{ ...chip }}>invite&nbsp;{code(l.invite_code)}</span>
        <button onClick={() => regen('invite')} className="mono" style={{ ...linkBtn, fontSize: 9 }} title="regenerate">↻</button>
        <button onClick={() => { copy(shareLink(l.invite_code)); setCopied(true); }} className="mono" style={btn(false)}>{copied ? 'link copied' : 'copy invite link'}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <span style={{ flex: 1 }} />
        <input value={week} onChange={(e) => setWeek(e.target.value.replace(/\D/g, ''))} style={{ ...inp, width: 38, padding: '5px 6px', textAlign: 'center' }} />
        <button onClick={sync} disabled={busy === 'sync'} className="mono" style={btn(true)}>{busy === 'sync' ? 'syncing…' : 'sync week'}</button>
      </div>
      {busy && busy !== 'sync' && <div className="mono" style={{ ...mono, fontSize: 9.5, color: busy.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 6 }}>{busy}</div>}
      {tab === 'members' && members && (
        <div style={{ marginTop: 10 }}>
          {members.map((m) => (
            <div key={m.roster_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--text)' }}>{m.team}</div>
                <div className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>{m.enrolled ? (m.email ?? m.sleeper ?? 'enrolled') : 'not joined'}</div>
              </div>
              <span className="mono" style={{ fontSize: 8.5, color: m.enrolled ? 'var(--you)' : 'var(--faint)', border: `1px solid ${m.enrolled ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '2px 6px' }}>{m.enrolled ? 'JOINED' : '—'}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'matchups' && matchups && (
        <div style={{ marginTop: 10 }}>
          {matchups.length === 0 ? <Muted text="No matchups (run sync week)." /> : matchups.map((m) => (
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

function ImportLeague({ reload }: { reload: () => void }) {
  const [sid, setSid] = useState('');
  const [season, setSeason] = useState('2026');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    if (!sid.trim() || busy) return;
    setBusy(true); setMsg(null);
    try { await importLeague(sid.trim(), season.trim() || '2026'); setMsg('✓ imported'); setSid(''); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'import failed'); }
    finally { setBusy(false); }
  };
  return (
    <div style={card}>
      <div style={h}>IMPORT A SLEEPER LEAGUE</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="Sleeper league id" style={{ ...inp, flex: 1, minWidth: 0 }} />
        <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="season" style={{ ...inp, width: 56 }} />
        <button onClick={go} disabled={busy} className="mono" style={btn(true)}>{busy ? '…' : 'import'}</button>
      </div>
      {msg && <div className="mono" style={{ ...mono, fontSize: 9.5, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 8 }}>{msg}</div>}
      <div className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)', marginTop: 8 }}>Pulls league + rosters from Sleeper, generates the commish/invite codes, and enrolls any managers already signed in. Then “sync week” per league for matchups + lineups.</div>
    </div>
  );
}

function Admins() {
  const [admins, setAdmins] = useState<AdminAdmin[]>([]);
  const [email, setEmail] = useState('');
  const load = async () => { try { setAdmins(await adminAdmins()); } catch { /* not admin */ } };
  useEffect(() => { load(); }, []);
  const add = async () => { if (!email.trim()) return; await adminSetAdmin(email.trim(), 'added in-app'); setEmail(''); load(); };
  const rm = async (e: string) => { const r = await adminSetAdmin(e, '', true); if (!r.ok) alert(r.error); load(); };
  return (
    <div style={card}>
      <div style={h}>ADMINS</div>
      {admins.map((a) => (
        <div key={a.email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
          <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--text)' }}>{a.email}</span>
          <button onClick={() => rm(a.email)} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" style={{ ...inp, flex: 1, minWidth: 0 }} />
        <button onClick={add} className="mono" style={btn(true)}>add</button>
      </div>
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  useEffect(() => { adminUsers().then(setUsers).catch(() => setUsers([])); }, []);
  return (
    <div style={card}>
      <div style={h}>USERS ({users?.length ?? '…'})</div>
      {users === null ? <Muted text="Loading…" /> : users.length === 0 ? <Muted text="No users yet." /> : users.map((u) => (
        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text)' }}>{u.email ?? '—'}</div>
            <div className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>{u.sleeper_username ? `@${u.sleeper_username}` : 'no Sleeper link'} · {u.enrolled} enrolled</div>
          </div>
          <span className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>{new Date(u.created_at).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>{text}</div>;
}
