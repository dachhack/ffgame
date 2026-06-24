import { useEffect, useState } from 'react';
import {
  adminOverview, adminMatchups, adminSetMatchup, adminSetCoin, adminOverrides, adminSetOverride, adminAudit,
  adminAdmins, adminSetAdmin, adminUsers, adminLeagueMembers, adminRegenCode, commishAudit,
  adminCodeRequests, adminSetCodeRequestHandled, adminMatchupBoard, adminResetMatchup,
  type AdminLeague, type AdminMatchup, type AdminOverride, type AdminAudit, type AdminAdmin, type AdminUser, type AdminMember, type CodeRequest, type MatchupBoard, type BoardPick,
} from '../data/liveApi';
import { importLeague, syncWeek } from '../data/sleeperAdmin';
import { forceResolve } from '../data/forceResolve';
import { WINDOWS } from '../data/metrics';

const winLabel = (id: string) => WINDOWS.find((w) => w.id === id)?.label ?? id.toUpperCase();

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

      <CodeRequests />
      <Overrides overrides={overrides} reload={load} />
      <Admins />
      <Users />

      <div style={card}>
        <div style={h}>RECENT AUDIT</div>
        {audit.length === 0 ? <Muted text="No activity." /> : audit.map((a, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 10.5, gap: 8 }}>
            <span className="mono" style={{ ...mono, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.op} <span style={{ color: 'var(--dim)' }}>{a.table}</span>{a.detail && <span style={{ color: 'var(--you)' }}> · {a.detail}</span>}{a.actor && <span style={{ color: 'var(--faint)' }}> · {a.actor}</span>}</span>
            <span className="mono" style={{ ...mono, color: 'var(--faint)', fontSize: 9.5, whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 6 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}

export function LeagueRow({ l, reload, admin = true }: { l: AdminLeague; reload: () => void; admin?: boolean }) {
  const [matchups, setMatchups] = useState<AdminMatchup[] | null>(null);
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [audit, setAudit] = useState<AdminAudit[] | null>(null);
  const [tab, setTab] = useState<'' | 'matchups' | 'members' | 'audit'>('');
  const [week, setWeek] = useState('1');
  const [srcWeek, setSrcWeek] = useState('1');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [coinEdit, setCoinEdit] = useState<string | null>(null);
  const [coinVals, setCoinVals] = useState<{ home: string; away: string }>({ home: '', away: '' });
  const [watch, setWatch] = useState<string | null>(null);
  const openCoin = (m: AdminMatchup) => { setCoinEdit(m.id); setCoinVals({ home: String(m.home_coin ?? ''), away: String(m.away_coin ?? '') }); };
  const saveCoin = async (id: string) => { await adminSetCoin(id, Number(coinVals.home || 0), Number(coinVals.away || 0)); setCoinEdit(null); await loadM(); };
  const resolve = async (id: string) => {
    setBusy('resolve');
    try { await forceResolve(id, Number(srcWeek)); setBusy('✓ resolved from 2025'); await loadM(); }
    catch (e) { setBusy(e instanceof Error ? e.message : 'resolve failed'); }
  };
  const resetOne = async (id: string) => {
    setBusy('reset');
    try { await adminResetMatchup(id); setBusy('✓ reset → scheduled'); await loadM(); }
    catch (e) { setBusy(e instanceof Error ? e.message : 'reset failed'); }
  };
  const resolveAll = async () => {
    if (!matchups?.length) return;
    setBusy('resolve all');
    try { for (const m of matchups) await forceResolve(m.id, Number(srcWeek)); setBusy(`✓ resolved ${matchups.length} matchups`); await loadM(); }
    catch (e) { setBusy(e instanceof Error ? e.message : 'resolve failed'); }
  };
  const resetAll = async () => {
    if (!matchups?.length) return;
    if (!confirm(`Reset all ${matchups.length} matchups → scheduled, scores + coin cleared?`)) return;
    setBusy('reset all');
    try { for (const m of matchups) await adminResetMatchup(m.id); setBusy(`✓ reset ${matchups.length} matchups`); await loadM(); }
    catch (e) { setBusy(e instanceof Error ? e.message : 'reset failed'); }
  };
  const finalizeAll = async () => {
    if (!matchups?.length) return;
    setBusy('finalize all');
    try { for (const m of matchups) await adminSetMatchup(m.id, 'final'); setBusy(`✓ finalized ${matchups.length} matchups`); await loadM(); }
    catch (e) { setBusy(e instanceof Error ? e.message : 'finalize failed'); }
  };
  const replay = async () => {
    if (!matchups?.length) return;
    if (!confirm(`Replay: reset all ${matchups.length} matchups then resolve from 2025 wk ${srcWeek}?`)) return;
    setBusy('resetting…');
    try {
      for (const m of matchups) await adminResetMatchup(m.id);
      setBusy('resolving…');
      for (const m of matchups) await forceResolve(m.id, Number(srcWeek));
      setBusy(`✓ replayed ${matchups.length} matchups`);
      await loadM();
    }
    catch (e) { setBusy(e instanceof Error ? e.message : 'replay failed'); }
  };

  const loadM = async () => setMatchups(await adminMatchups(l.league_id));
  const loadMembers = async () => setMembers(await adminLeagueMembers(l.league_id));
  const loadAudit = async () => setAudit(await commishAudit(l.league_id, 40));
  const showTab = (t: 'matchups' | 'members' | 'audit') => {
    setTab((cur) => (cur === t ? '' : t));
    if (t === 'matchups' && !matchups) loadM();
    if (t === 'members' && !members) loadMembers();
    if (t === 'audit') loadAudit();
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
      {watch && <AdminMatchupBoard matchupId={watch} onClose={() => setWatch(null)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{l.name} <span className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)' }}>· {l.season}</span></div>
          <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--dim)', marginTop: 3 }}>{l.enrolled}/{l.rosters} enrolled · commish {l.commissioner ? '✓' : '—'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => showTab('members')} className="mono" style={linkBtn}>{tab === 'members' ? 'hide' : 'members'}</button>
          <button onClick={() => showTab('matchups')} className="mono" style={linkBtn}>{tab === 'matchups' ? 'hide' : 'matchups'}</button>
          <button onClick={() => showTab('audit')} className="mono" style={linkBtn}>{tab === 'audit' ? 'hide' : 'audit'}</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...chip }}>commish&nbsp;{code(l.commish_code)}</span>
        {admin && <button onClick={() => regen('commish')} className="mono" style={{ ...linkBtn, fontSize: 9 }} title="regenerate">↻</button>}
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
          {admin && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>from 2025 wk</span>
              <input value={srcWeek} onChange={(e) => setSrcWeek(e.target.value.replace(/\D/g, ''))} style={{ ...inp, width: 32, padding: '4px 5px', textAlign: 'center' }} />
              <button style={btn(true)} onClick={resolveAll} disabled={!!busy} title="run the real engine on every matchup — lights up the whole board">{busy === 'resolve all' || busy === 'resolving…' ? 'resolving…' : '▶▶ resolve all'}</button>
              <button style={btn(false)} onClick={resetAll} disabled={!!busy} title="clear every matchup → scheduled, scores wiped">{busy === 'reset all' || busy === 'resetting…' ? 'resetting…' : '↺ reset all'}</button>
              <button style={btn(false)} onClick={finalizeAll} disabled={!!busy} title="mark every matchup final">{'✓✓ finalize all'}</button>
              <button style={{ ...btn(false), borderColor: 'var(--you)', color: 'var(--you)' }} onClick={replay} disabled={!!busy} title="reset all → resolve all in one click">{busy === 'resetting…' || busy === 'resolving…' ? busy : '↺▶ replay'}</button>
            </div>
          )}
          {matchups.length === 0 ? <Muted text="No matchups (run sync week)." /> : matchups.map((m) => (
            <div key={m.id} style={{ borderTop: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', flexWrap: 'wrap', gap: 6 }}>
                <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--text)' }}>W{m.week} · {m.home_roster_id}v{m.away_roster_id} · <span style={{ color: 'var(--you)' }}>{m.status}</span>{m.home_final != null && <span style={{ color: 'var(--faint)' }}> · {m.home_final}-{m.away_final}</span>}{(m.home_coin != null || m.away_coin != null) && <span style={{ color: 'var(--faint)' }}> · ◇ {m.home_coin ?? 0}/{m.away_coin ?? 0}</span>}</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button style={btn(m.status === 'scheduled')} onClick={() => set(m.id, 'scheduled')}>sched</button>
                  <button style={btn(m.status === 'live')} onClick={() => set(m.id, 'live', true)}>live+lock</button>
                  <button style={btn(m.status === 'final')} onClick={() => set(m.id, 'final')}>final</button>
                  <button style={btn(coinEdit === m.id)} onClick={() => (coinEdit === m.id ? setCoinEdit(null) : openCoin(m))} title="edit drip coin">◇</button>
                  <button style={btn(false)} onClick={() => setWatch(m.id)} title="watch the live board">▦</button>
                  {admin && <button style={btn(false)} onClick={() => resolve(m.id)} title="run real engine on baked 2025 data">▶</button>}
                  {admin && <button style={btn(false)} onClick={() => resetOne(m.id)} title="reset this matchup → scheduled, scores cleared">↺</button>}
                </div>
              </div>
              {coinEdit === m.id && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
                  <span className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>◇ home</span>
                  <input value={coinVals.home} onChange={(e) => setCoinVals((v) => ({ ...v, home: e.target.value.replace(/[^\d.-]/g, '') }))} style={{ ...inp, width: 56, padding: '4px 5px', textAlign: 'center' }} />
                  <span className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>away</span>
                  <input value={coinVals.away} onChange={(e) => setCoinVals((v) => ({ ...v, away: e.target.value.replace(/[^\d.-]/g, '') }))} style={{ ...inp, width: 56, padding: '4px 5px', textAlign: 'center' }} />
                  <button style={btn(true)} onClick={() => saveCoin(m.id)}>save</button>
                  <span className="mono" style={{ ...mono, fontSize: 8.5, color: 'var(--faint)' }}>(audited)</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'audit' && (
        <div style={{ marginTop: 10 }}>
          {audit === null ? <Muted text="Loading…" /> : audit.length === 0 ? <Muted text="No matchup activity yet." /> : audit.map((a, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid var(--bd)', gap: 8 }}>
              <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.op} <span style={{ color: 'var(--dim)' }}>{a.table}</span>{a.detail && <span style={{ color: 'var(--you)' }}> · {a.detail}</span>}{a.actor && <span style={{ color: 'var(--faint)' }}> · {a.actor}</span>}</span>
              <span className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)', whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString()}</span>
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

function CodeRequests() {
  const [rows, setRows] = useState<CodeRequest[] | null>(null);
  const load = async () => { try { setRows(await adminCodeRequests()); } catch { setRows([]); } };
  useEffect(() => { load(); }, []);
  const toggle = async (id: string, handled: boolean) => { await adminSetCodeRequestHandled(id, handled); load(); };
  const pending = rows?.filter((r) => !r.handled).length ?? 0;
  return (
    <div style={card}>
      <div style={h}>CODE REQUESTS{pending ? ` · ${pending} NEW` : ''}</div>
      {rows === null ? <Muted text="Loading…" /> : rows.length === 0 ? <Muted text="No requests yet." /> : rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid var(--bd)', gap: 8, opacity: r.handled ? 0.5 : 1 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text)' }}>
              {r.email ? <span className="mono" style={{ ...mono, cursor: 'pointer' }} onClick={() => copy(r.email!)} title="copy">{r.email}</span> : '—'}
              {r.sleeper_username && <span className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)' }}> · @{r.sleeper_username}</span>}
            </div>
            {r.league_name && <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--dim)', marginTop: 2 }}>{r.league_name}</div>}
            {r.note && <div style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 2, lineHeight: 1.4 }}>{r.note}</div>}
            <div className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)', marginTop: 2 }}>{new Date(r.created_at).toLocaleString()}</div>
          </div>
          <button onClick={() => toggle(r.id, !r.handled)} className="mono" style={btn(r.handled)}>{r.handled ? 'handled' : 'mark done'}</button>
        </div>
      ))}
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

// "patrick-mahomes-10" → "Patrick Mahomes"
const fmtSlug = (slug: string) =>
  slug.replace(/-\d+$/, '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function PickPills({ picks }: { picks: BoardPick[]; align?: 'left' | 'right' }) {
  if (!picks.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {picks.map((p, i) => (
        <span key={i} className="mono" style={{ ...mono, fontSize: 8, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 4px' }} title={p.metric ?? ''}>
          {p.slug ? fmtSlug(p.slug) : '—'}
        </span>
      ))}
    </div>
  );
}

// Watch ANY matchup's live board animate — polls admin_matchup_board every 2.5s.
// No enrollment, no Sleeper mapping; works for a real game or a feed sim.
function AdminMatchupBoard({ matchupId, onClose }: { matchupId: string; onClose: () => void }) {
  const [b, setB] = useState<MatchupBoard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const d = await adminMatchupBoard(matchupId); if (alive) { setB(d); setErr(null); } }
      catch (e) { if (alive) setErr(e instanceof Error ? e.message : 'load failed'); }
    };
    load();
    const t = setInterval(load, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [matchupId]);

  const m = b?.matchup;
  const homeTotal = (b?.states ?? []).reduce((t, s) => t + Number(s.home_score), 0);
  const awayTotal = (b?.states ?? []).reduce((t, s) => t + Number(s.away_score), 0);
  const rnd = (n: number) => Math.round(n * 10) / 10;
  const live = m?.status === 'live';
  const isFinal = m?.status === 'final';
  const homeScore = rnd(m?.home_final ?? homeTotal);
  const awayScore = rnd(m?.away_final ?? awayTotal);
  const homeLeads = homeScore > awayScore;
  const tied = homeScore === awayScore;
  const margin = rnd(Math.abs(homeScore - awayScore));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 10, padding: 18, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="mono" style={{ ...mono, fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)', fontWeight: 700 }}>
            LIVE BOARD{m ? ` · W${m.week}` : ''}
            {m && <span style={{ color: live ? 'var(--you)' : 'var(--faint)', marginLeft: 6 }}>{live ? '● LIVE' : m.status.toUpperCase()}</span>}
          </span>
          <button onClick={onClose} className="mono" style={linkBtn}>✕ close</button>
        </div>
        {err && <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--opp)', marginBottom: 8 }}>{err}</div>}
        {!b && !err ? <Muted text="Loading…" /> : m && (
          <>
            {/* Scoreboard header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'end', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                {isFinal && homeLeads && <div className="mono" style={{ ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', marginBottom: 3 }}>WINNER ▲</div>}
                <div style={{ fontSize: 12, fontWeight: 700, color: homeLeads ? 'var(--you)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.home_team ?? `roster ${m.home_roster_id}`}</div>
                <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, color: homeLeads ? 'var(--you)' : tied ? 'var(--text)' : 'var(--dim)', lineHeight: 1.1 }}>{homeScore}</div>
              </div>
              <div style={{ textAlign: 'center', paddingBottom: 6 }}>
                <span className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)' }}>vs</span>
                {!tied && (homeScore > 0 || awayScore > 0) && (
                  <div className="mono" style={{ ...mono, fontSize: 8.5, color: 'var(--dim)', marginTop: 2 }}>{homeLeads ? '←' : '→'} +{margin}</div>
                )}
              </div>
              <div style={{ minWidth: 0, textAlign: 'right' }}>
                {isFinal && !homeLeads && !tied && <div className="mono" style={{ ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', marginBottom: 3, textAlign: 'right' }}>▲ WINNER</div>}
                <div style={{ fontSize: 12, fontWeight: 700, color: !homeLeads && !tied ? 'var(--you)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{b.away_team ?? `roster ${m.away_roster_id}`}</div>
                <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, color: !homeLeads && !tied ? 'var(--you)' : tied ? 'var(--text)' : 'var(--dim)', lineHeight: 1.1, textAlign: 'right' }}>{awayScore}</div>
              </div>
            </div>
            {(m.home_coin != null || m.away_coin != null) && (
              <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)', textAlign: 'center', marginTop: 6 }}>◇ coin {rnd(m.home_coin ?? 0)} / {rnd(m.away_coin ?? 0)}</div>
            )}

            {/* Per-window scores + player names */}
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {b.states.length === 0 ? <Muted text="No window scores yet — start the sim or a resolve." /> : b.states.map((s) => {
                const hw = Number(s.home_score);
                const aw = Number(s.away_score);
                const winWin = hw > aw;
                const winTied = hw === aw;
                return (
                  <div key={s.game_window} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, padding: '5px 8px' }}>
                      <span className="mono" style={{ ...mono, fontSize: 13, fontWeight: 700, color: winWin ? 'var(--you)' : winTied ? 'var(--text)' : 'var(--dim)' }}>{rnd(hw)}</span>
                      <span className="mono" style={{ ...mono, fontSize: 8.5, letterSpacing: '0.08em', color: 'var(--faint)', textAlign: 'center' }}>{winLabel(s.game_window)}</span>
                      <span className="mono" style={{ ...mono, fontSize: 13, fontWeight: 700, color: !winWin && !winTied ? 'var(--you)' : winTied ? 'var(--text)' : 'var(--dim)', textAlign: 'right' }}>{rnd(aw)}</span>
                    </div>
                    {(s.home_picks.length > 0 || s.away_picks.length > 0) && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '0 8px 6px' }}>
                        <PickPills picks={s.home_picks} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end' }}>
                          {s.away_picks.map((p, i) => (
                            <span key={i} className="mono" style={{ ...mono, fontSize: 8, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 4px' }} title={p.metric ?? ''}>
                              {p.slug ? fmtSlug(p.slug) : '—'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mono" style={{ ...mono, fontSize: 8.5, color: 'var(--faint)', textAlign: 'center', marginTop: 10 }}>
              {live && <span style={{ color: 'var(--you)' }}>auto-refreshing every 2.5s · </span>}
              {b.updated_at ? `updated ${new Date(b.updated_at).toLocaleTimeString()}` : 'no updates yet'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>{text}</div>;
}
