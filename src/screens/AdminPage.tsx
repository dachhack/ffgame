import { useEffect, useState } from 'react';
import {
  adminOverview, adminMatchups, adminSetMatchup, adminSetCoin, adminOverrides, adminSetOverride, adminAudit,
  adminAdmins, adminSetAdmin, adminUsers, adminLeagueMembers, adminRegenCode, commishAudit,
  adminCodeRequests, adminSetCodeRequestHandled, adminMatchupBoard, adminResetMatchup, dispatchSim,
  adminMatchupPicks, adminPickReadiness, adminHealth, adminSetPicks, adminClearPicks, sendMagicLink,
  setTeamController, setLineupPolicy,
  leagueKdst, setKdstMode, setTeamKdst,
  type AdminLeague, type AdminMatchup, type AdminOverride, type AdminAudit, type AdminAdmin, type AdminUser, type AdminMember, type CodeRequest, type MatchupBoard, type BoardPick, type BoardSlotScore,
  type PickReadiness, type PickSide, type AdminHealth, type Controller, type LineupPolicy, type LeagueKdst, type KdstMode,
} from '../data/liveApi';
import { importLeague, syncWeek } from '../data/sleeperAdmin';
import { forceResolve } from '../data/forceResolve';
import { FeedSheet } from './FeedSheet';
import { WINDOWS, defaultMetric } from '../data/metrics';
import { NFL_CODES } from '../data/kdst';
import { slugMeta } from '../data/slugMeta';
import { isMarkFree, setMarkFree } from '../data/markFree';
import { getPremiumTier, adminSetPremiumTier, type PremiumTier } from '../data/liveApi';
import { POWERUPS } from '../data/powerups';

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

/** Friendly local time for a matchup's auto-lock (kickoff), e.g. "Sun 1:00 PM". */
function fmtLock(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

function CodeChip({ v }: { v: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="mono" style={{ ...mono, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', cursor: 'pointer' }}
      onClick={() => { navigator.clipboard?.writeText(v); setDone(true); setTimeout(() => setDone(false), 1200); }}
      title="click to copy">{done ? 'copied ✓' : v}</span>
  );
}

// Branding switch: flip mark-free mode (hide NFL logos + player headshots → generic
// pills/initials) for a licensing-free / commercial build. Reloads so all imagery across
// the app re-resolves consistently. Persists via localStorage (src/data/markFree.ts).
function MarkFreeToggle() {
  const [on, setOn] = useState(isMarkFree());
  const flip = () => { const next = !on; setOn(next); setMarkFree(next); try { window.location.reload(); } catch { /* ignore */ } };
  return (
    <div style={card}>
      <div style={h}>BRANDING</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text)' }}>
          Mark-free mode · <b>{on ? 'ON' : 'OFF'}</b>
          <span style={{ display: 'block', fontSize: 9.5, color: 'var(--dim)', marginTop: 3, maxWidth: 360 }}>
            Hides NFL team logos + player headshots (shows generic position pills / abbreviations / initials). For licensing-free commercial builds. Reloads to apply everywhere.
          </span>
        </span>
        <button onClick={flip} style={btn(on)}>{on ? 'turn off' : 'turn on'}</button>
      </div>
    </div>
  );
}

// Super-admin control of the FREE vs PREMIUM split (positions + power-ups). Edits the
// global premium_tier config (migration 0037) the worker enforces and the client paywall
// reads. Highlighted = free; the rest need premium. Saves on each toggle.
const ALL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

function PremiumTierPanel() {
  const [tier, setTier] = useState<PremiumTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getPremiumTier().then(setTier).catch((e) => setErr(e instanceof Error ? e.message : 'load failed')); }, []);

  const save = async (next: PremiumTier) => {
    setTier(next); setBusy(true); setErr(null);
    try { const r = await adminSetPremiumTier(next.free_positions, next.free_powerups); if (!r.ok) setErr(r.error ?? 'save failed'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'save failed'); }
    finally { setBusy(false); }
  };
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div style={card}>
      <div style={h}>PREMIUM TIER{busy ? ' · saving…' : ''}</div>
      <div style={{ fontSize: 9.5, color: 'var(--dim)', marginBottom: 8 }}>Tap to toggle FREE ↔ premium. Highlighted = free (no payment); the rest need premium. Both sides of a premium matchup get the full set.</div>
      {!tier ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>loading…</div> : (
        <>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--dim)', marginBottom: 5 }}>POSITIONS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {ALL_POSITIONS.map((p) => { const free = tier.free_positions.includes(p); return (
              <button key={p} onClick={() => save({ ...tier, free_positions: flip(tier.free_positions, p) })} style={btn(free)}>{p === 'DEF' ? 'DST' : p}{free ? ' · free' : ' · 🔒'}</button>
            ); })}
          </div>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--dim)', marginBottom: 5 }}>POWER-UPS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {POWERUPS.map((pu) => { const free = tier.free_powerups.includes(pu.id); return (
              <button key={pu.id} onClick={() => save({ ...tier, free_powerups: flip(tier.free_powerups, pu.id) })} style={btn(free)} title={pu.name}>{pu.icon} {pu.name}{free ? ' · free' : ' · 🔒'}</button>
            ); })}
          </div>
        </>
      )}
      {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8 }}>{err}</div>}
    </div>
  );
}

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

      <HealthPanel />
      <MarkFreeToggle />
      <PremiumTierPanel />
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

export function LeagueRow({ l, reload, admin = true, defaultTab = '' }: { l: AdminLeague; reload: () => void; admin?: boolean; defaultTab?: '' | 'matchups' | 'members' | 'audit' | 'ready' | 'kdst' }) {
  const [matchups, setMatchups] = useState<AdminMatchup[] | null>(null);
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [audit, setAudit] = useState<AdminAudit[] | null>(null);
  const [tab, setTab] = useState<'' | 'matchups' | 'members' | 'audit' | 'ready' | 'kdst'>(defaultTab);
  // roster_id → team name, from members (drives readable matchup labels).
  const teamName = (rid: number) => members?.find((m) => m.roster_id === rid)?.team ?? `Roster ${rid}`;
  const [kdst, setKdst] = useState<LeagueKdst | null>(null);
  const loadKdst = async () => { try { setKdst(await leagueKdst(l.league_id)); } catch { setKdst(null); } };
  const changeKdstMode = async (mode: KdstMode) => { setKdst((k) => (k ? { ...k, mode } : k)); try { await setKdstMode(l.league_id, mode); } catch { /* keep optimistic */ } };
  const saveTeamKdst = async (rosterId: number, kSlug: string | null, dstSlug: string | null) => {
    setKdst((k) => (k ? { ...k, teams: k.teams.map((t) => (t.roster_id === rosterId ? { ...t, k_slug: kSlug, dst_slug: dstSlug } : t)) } : k));
    try { await setTeamKdst(l.league_id, rosterId, kSlug, dstSlug); } catch { /* keep optimistic */ }
  };
  const [week, setWeek] = useState('1');
  const [srcWeek, setSrcWeek] = useState('1');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [coinEdit, setCoinEdit] = useState<string | null>(null);
  const [coinVals, setCoinVals] = useState<{ home: string; away: string }>({ home: '', away: '' });
  const [watch, setWatch] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [policy, setPolicy] = useState<LineupPolicy>(l.lineup_policy ?? 'best_lineup');
  const changePolicy = async (p: LineupPolicy) => { setPolicy(p); try { await setLineupPolicy(l.league_id, p); } catch { /* keep optimistic */ } };
  const toggleMemberAi = async (rosterId: number, cur: Controller | undefined) => {
    const next: Controller = cur === 'ai' ? 'human' : 'ai';
    try { await setTeamController(l.league_id, rosterId, next); await loadMembers(); } catch { /* noop */ }
  };
  const [running, setRunning] = useState(false);
  const openCoin = (m: AdminMatchup) => { setCoinEdit(m.id); setCoinVals({ home: String(m.home_coin ?? ''), away: String(m.away_coin ?? '') }); };
  const saveCoin = async (id: string) => { await adminSetCoin(id, Number(coinVals.home || 0), Number(coinVals.away || 0)); setCoinEdit(null); await loadM(); };
  // Wrap an async demo action: guard double-clicks, surface progress + result/error.
  const run = async (label: string, fn: () => Promise<string>) => {
    if (running) return;
    setRunning(true); setBusy(label);
    try { setBusy(await fn()); await loadM(); }
    catch (e) { setBusy(e instanceof Error ? e.message : `${label} failed`); }
    finally { setRunning(false); }
  };
  const resolve = (id: string) => run('resolve', async () => { await forceResolve(id, Number(srcWeek)); return '✓ resolved from 2025'; });
  const resetOne = (id: string) => run('reset', async () => { await adminResetMatchup(id); return '✓ reset → scheduled'; });
  const resolveAll = () => { if (!matchups?.length) return; run('resolve all', async () => { for (const m of matchups) await forceResolve(m.id, Number(srcWeek)); return `✓ resolved ${matchups.length} matchups`; }); };
  const resetAll = () => {
    if (!matchups?.length) return;
    if (!confirm(`Reset all ${matchups.length} matchups → scheduled, scores + coin cleared?`)) return;
    run('reset all', async () => { for (const m of matchups) await adminResetMatchup(m.id); return `✓ reset ${matchups.length} matchups`; });
  };
  const finalizeAll = () => { if (!matchups?.length) return; run('finalize all', async () => { for (const m of matchups) await adminSetMatchup(m.id, 'final'); return `✓ finalized ${matchups.length} matchups`; }); };
  const replay = () => {
    if (!matchups?.length) return;
    if (!confirm(`Replay: reset all ${matchups.length} matchups then resolve from 2025 wk ${srcWeek}?`)) return;
    run('replaying…', async () => {
      for (const m of matchups) await adminResetMatchup(m.id);
      for (const m of matchups) await forceResolve(m.id, Number(srcWeek));
      return `✓ replayed ${matchups.length} matchups`;
    });
  };
  // Real server-driven feed: drip plays in tick by tick so the board ANIMATES
  // (vs ▶ resolve which writes every window at once). Fires the simulate workflow
  // via the dispatch-sim edge function; takes ~30s to spin up, then ~20–30s to play.
  const playLive = () => {
    const week = matchups?.[0]?.week ?? 1;
    if (!confirm(`Play LIVE: drive the real feed for week ${week} (plays from 2025 wk ${srcWeek}) — locks picks, animates the board, ends FINAL. Open ▦ to watch.`)) return;
    run('starting live feed…', async () => {
      const r = await dispatchSim({ mode: 'live', league: l.league_id, week, src: srcWeek, speed: 300 });
      if (!r.ok) throw new Error(r.error ?? 'dispatch failed');
      return '✓ live feed launching — open ▦ in ~30s to watch it animate';
    });
  };

  const loadM = async () => setMatchups(await adminMatchups(l.league_id));
  const loadMembers = async () => setMembers(await adminLeagueMembers(l.league_id));
  const loadAudit = async () => setAudit(await commishAudit(l.league_id, 40));
  const showTab = (t: 'matchups' | 'members' | 'audit' | 'ready' | 'kdst') => {
    setTab((cur) => (cur === t ? '' : t));
    if (t === 'matchups') { if (!matchups) loadM(); if (!members) loadMembers(); }
    if (t === 'members' && !members) loadMembers();
    if (t === 'audit') loadAudit();
    if (t === 'kdst' && !kdst) loadKdst();
  };
  // Auto-load the initially-open tab (CommishDash opens straight on "members").
  useEffect(() => {
    if (defaultTab === 'members') loadMembers();
    else if (defaultTab === 'matchups') { loadM(); loadMembers(); }
    else if (defaultTab === 'kdst') loadKdst();
    else if (defaultTab === 'audit') loadAudit();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
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
      {sheet && <FeedSheet matchupId={sheet} week={Number(srcWeek) || 1} onClose={() => setSheet(null)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{l.name} <span className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)' }}>· {l.season}</span></div>
          <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--dim)', marginTop: 3 }}>{l.enrolled}/{l.rosters} enrolled · commish {l.commissioner ? '✓' : '—'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Tabs highlight the active one in place (and toggle it closed on a second
              click) rather than relabeling to "hide", which read as the tab vanishing. */}
          <button onClick={() => showTab('ready')} className="mono" style={btn(tab === 'ready')} aria-pressed={tab === 'ready'}>picks</button>
          <button onClick={() => showTab('members')} className="mono" style={btn(tab === 'members')} aria-pressed={tab === 'members'}>members</button>
          <button onClick={() => showTab('kdst')} className="mono" style={btn(tab === 'kdst')} aria-pressed={tab === 'kdst'}>K/DST</button>
          <button onClick={() => showTab('matchups')} className="mono" style={btn(tab === 'matchups')} aria-pressed={tab === 'matchups'}>matchups</button>
          <button onClick={() => showTab('audit')} className="mono" style={btn(tab === 'audit')} aria-pressed={tab === 'audit'}>audit</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...chip }}>commish&nbsp;<CodeChip v={l.commish_code} /></span>
        {admin && <button onClick={() => regen('commish')} className="mono" style={{ ...linkBtn, fontSize: 9 }} title="regenerate">↻</button>}
        <span style={{ ...chip }}>invite&nbsp;<CodeChip v={l.invite_code} /></span>
        <button onClick={() => regen('invite')} className="mono" style={{ ...linkBtn, fontSize: 9 }} title="regenerate">↻</button>
        {/* Primary way to invite players — the join link (no code to type). The
            invite code chip above remains as a fallback for manual entry. */}
        <button onClick={() => { copy(shareLink(l.invite_code)); setCopied(true); }} className="mono" style={btn(true)}>{copied ? '✓ invite link copied' : '⛓ share invite link'}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <span style={{ flex: 1 }} />
        <input value={week} onChange={(e) => setWeek(e.target.value.replace(/\D/g, ''))} style={{ ...inp, width: 38, padding: '5px 6px', textAlign: 'center' }} />
        <button onClick={sync} disabled={busy === 'sync'} className="mono" style={btn(true)}>{busy === 'sync' ? 'syncing…' : 'sync week'}</button>
      </div>
      {busy && busy !== 'sync' && <div className="mono" style={{ ...mono, fontSize: 9.5, color: busy.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 6 }}>{busy}</div>}
      {tab === 'ready' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>on missed pick:</span>
            <select value={policy} onChange={(e) => changePolicy(e.target.value as LineupPolicy)} style={{ ...inp, padding: '4px 6px', fontSize: 11 }}>
              <option value="best_lineup">force best lineup (stay human)</option>
              <option value="ai">flip to AI 🤖</option>
              <option value="empty">leave empty</option>
            </select>
          </div>
          <PickReadinessTab leagueId={l.league_id} week={Number(week) || 1} admin={admin} />
        </div>
      )}
      {tab === 'members' && members && (
        <div style={{ marginTop: 10 }}>
          {(() => { const nj = members.filter((m) => !m.enrolled).length; return (
            <div className="mono" style={{ ...mono, fontSize: 9.5, color: nj ? 'var(--dim)' : 'var(--you)', marginBottom: 6 }}>
              {members.length - nj}/{members.length} joined{nj ? ` · ${nj} not yet` : ''}
            </div>
          ); })()}
          {members.map((m) => (
            <div key={m.roster_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {m.avatar && <img src={m.avatar} alt="" width={24} height={24} style={{ borderRadius: 5, flexShrink: 0 }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text)' }}>{m.team}</div>
                  <div className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>{m.enrolled ? (m.email ?? m.sleeper ?? 'enrolled') : 'not joined'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {m.email && <SendLink email={m.email} />}
                <button onClick={() => toggleMemberAi(m.roster_id, m.controller)} className="mono" title={m.controller === 'ai' ? 'hand back to manager' : 'set team to AI auto-pilot'}
                  style={{ fontSize: 8.5, fontWeight: 700, color: m.controller === 'ai' ? 'var(--on-accent)' : 'var(--dim)', background: m.controller === 'ai' ? 'var(--you)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}>🤖 {m.controller === 'ai' ? 'AI' : 'off'}</button>
                <span className="mono" style={{ fontSize: 8.5, color: m.enrolled ? 'var(--you)' : 'var(--faint)', border: `1px solid ${m.enrolled ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '2px 6px' }}>{m.enrolled ? 'JOINED' : '—'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'kdst' && (
        <div style={{ marginTop: 10 }}>
          {!kdst ? <Muted text="Loading…" /> : (
            <>
              <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 8 }}>
                {kdst.needs_k || kdst.needs_def
                  ? `This league doesn't roster ${[kdst.needs_k && 'kickers', kdst.needs_def && 'defenses'].filter(Boolean).join(' or ')} — fill them so the Banker / Suppress metrics are playable. Takes effect on the next sync.`
                  : 'This league rosters both K and DEF — no fill needed.'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>fill mode:</span>
                <select value={kdst.mode} onChange={(e) => changeKdstMode(e.target.value as KdstMode)} style={{ ...inp, padding: '4px 6px', fontSize: 11 }}>
                  <option value="off">off (do nothing)</option>
                  <option value="random">random weekly (not on bye)</option>
                  <option value="manual">manual per team</option>
                </select>
              </div>
              {kdst.mode === 'manual' && (() => {
                // Slugs already assigned to ANY team — used to flag (but not block) duplicates.
                const kCount = new Map<string, number>();
                const dstCount = new Map<string, number>();
                for (const t of kdst.teams) {
                  if (t.k_slug) kCount.set(t.k_slug, (kCount.get(t.k_slug) ?? 0) + 1);
                  if (t.dst_slug) dstCount.set(t.dst_slug, (dstCount.get(t.dst_slug) ?? 0) + 1);
                }
                const takenK = new Set(kCount.keys());
                const takenDst = new Set(dstCount.keys());
                return (
                <div style={{ marginTop: 8 }}>
                  <div className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)', marginBottom: 4 }}>Assign each team a K / DEF (season-long; auto-substituted on its bye week). Blank = random not-on-bye. Teams already taken are marked “• taken”; a ⚠ flags a duplicate (allowed, but each NFL K/DEF is usually unique).</div>
                  {kdst.teams.map((t) => {
                    const dupK = !!t.k_slug && (kCount.get(t.k_slug) ?? 0) > 1;
                    const dupDst = !!t.dst_slug && (dstCount.get(t.dst_slug) ?? 0) > 1;
                    return (
                    <div key={t.roster_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                      <span style={{ fontSize: 11, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(dupK || dupDst) && <span title="duplicate K/DEF" style={{ color: 'var(--warn)' }}>⚠ </span>}{t.team}
                      </span>
                      {kdst.needs_k && (
                        <KdstSelect suffix="k" value={t.k_slug} taken={takenK} onChange={(v) => saveTeamKdst(t.roster_id, v, t.dst_slug)} />
                      )}
                      {kdst.needs_def && (
                        <KdstSelect suffix="dst" value={t.dst_slug} taken={takenDst} onChange={(v) => saveTeamKdst(t.roster_id, t.k_slug, v)} />
                      )}
                    </div>
                    );
                  })}
                </div>
                );
              })()}
            </>
          )}
        </div>
      )}
      {tab === 'matchups' && matchups && (
        <div style={{ marginTop: 10 }}>
          <div className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)', lineHeight: 1.6, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '7px 9px', marginBottom: 8 }}>
            Each matchup auto-advances at the real kickoff, or set it manually:
            {' '}<b style={{ color: 'var(--dim)' }}>Open</b> (picks open, pre-kickoff) →
            {' '}<b style={{ color: 'var(--you)' }}>Lock</b> (kickoff — seals both lineups, scoring starts) →
            {' '}<b style={{ color: 'var(--dim)' }}>Final</b>.
            <br />◇ edit drip coin · ▦ watch the live board · ≣ play-by-play feed{admin ? ' · ▶ resolve from baked data · ↺ reset' : ''}.
          </div>
          {admin && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span className="mono" style={{ ...mono, fontSize: 9, color: 'var(--faint)' }}>from 2025 wk</span>
              <input value={srcWeek} onChange={(e) => setSrcWeek(e.target.value.replace(/\D/g, ''))} style={{ ...inp, width: 32, padding: '4px 5px', textAlign: 'center' }} />
              {admin && <button style={{ ...btn(true), background: 'var(--opp)', borderColor: 'var(--opp)' }} onClick={playLive} disabled={running} title="drive the REAL server feed — plays drip in and the board animates live (then ends final)">{busy === 'starting live feed…' ? 'starting…' : '▶ play LIVE'}</button>}
              <button style={btn(true)} onClick={resolveAll} disabled={running} title="instant: run the real engine on every matchup — fills the whole board at once">{busy === 'resolve all' ? 'resolving…' : '▶▶ resolve all'}</button>
              <button style={btn(false)} onClick={resetAll} disabled={running} title="clear every matchup → scheduled, scores wiped">{busy === 'reset all' ? 'resetting…' : '↺ reset all'}</button>
              <button style={btn(false)} onClick={finalizeAll} disabled={running} title="mark every matchup final">{busy === 'finalize all' ? 'finalizing…' : '✓✓ finalize all'}</button>
              <button style={{ ...btn(false), borderColor: 'var(--you)', color: 'var(--you)' }} onClick={replay} disabled={running} title="instant: reset all → resolve all in one click">{busy === 'replaying…' ? 'replaying…' : '↺▶ replay'}</button>
            </div>
          )}
          {matchups.length === 0 ? <Muted text="No matchups (run sync week)." /> : matchups.map((m) => (
            <div key={m.id} style={{ borderTop: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', flexWrap: 'wrap', gap: 6 }}>
                <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--text)' }}>W{m.week} · {teamName(m.home_roster_id)} v {teamName(m.away_roster_id)} · <span style={{ color: 'var(--you)' }}>{m.status}</span>{m.home_final != null && <span style={{ color: 'var(--faint)' }}> · {m.home_final}-{m.away_final}</span>}{(m.home_coin != null || m.away_coin != null) && <span style={{ color: 'var(--faint)' }}> · ◇ {m.home_coin ?? 0}/{m.away_coin ?? 0}</span>}{m.status === 'scheduled' && (m.lock_at
                  ? <span style={{ color: 'var(--faint)' }} title="The worker seals lineups and starts scoring automatically at kickoff."> · 🔒 auto-locks {fmtLock(m.lock_at)}</span>
                  : <span style={{ color: 'var(--warn)' }} title="No kickoff time on this matchup, so it will NOT auto-lock — set Lock manually at kickoff."> · ⚠ won’t auto-lock — set Lock manually</span>)}</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button style={btn(m.status === 'scheduled')} onClick={() => set(m.id, 'scheduled')} title="Picks open — pre-kickoff">Open</button>
                  <button style={btn(m.status === 'live')} onClick={() => set(m.id, 'live', true)} title="Lock & score — seals both lineups at kickoff, scoring starts">Lock</button>
                  <button style={btn(m.status === 'final')} onClick={() => set(m.id, 'final')} title="Final — week complete">Final</button>
                  <button style={btn(coinEdit === m.id)} onClick={() => (coinEdit === m.id ? setCoinEdit(null) : openCoin(m))} title="edit drip coin">◇</button>
                  <button style={btn(false)} onClick={() => setWatch(m.id)} title="watch the live board">▦</button>
                  <button style={btn(false)} onClick={() => setSheet(m.id)} title={`feed sheet — per-player play log (2025 wk ${srcWeek})`}>≣</button>
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

function PickPills({ picks }: { picks: BoardPick[] }) {
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

function SlotScoreRows({ slotScores, homeLeads, winTied }: { slotScores: BoardSlotScore[]; homeLeads: boolean; winTied: boolean }) {
  if (!slotScores.length) return null;
  const homeSlots = slotScores.filter((x) => x.side === 'home');
  const awaySlots = slotScores.filter((x) => x.side === 'away');
  const allSlots = [...new Set([...homeSlots.map((x) => x.slot), ...awaySlots.map((x) => x.slot)])].sort();
  const rnd = (n: number) => Math.round(n * 10) / 10;
  return (
    <div style={{ borderTop: '1px solid var(--bd)', padding: '4px 8px 6px' }}>
      {allSlots.map((slot) => {
        const h = homeSlots.find((x) => x.slot === slot);
        const a = awaySlots.find((x) => x.slot === slot);
        return (
          <div key={slot} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, padding: '2px 0' }}>
            <span className="mono" style={{ ...mono, fontSize: 8.5, color: homeLeads || winTied ? 'var(--text)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h ? fmtSlug(h.slug ?? '') : <span style={{ color: 'var(--faint)' }}>—</span>}
              {h && <span style={{ color: homeLeads ? 'var(--you)' : 'var(--faint)', marginLeft: 4 }}>{rnd(h.score)}</span>}
            </span>
            <span className="mono" style={{ ...mono, fontSize: 7.5, color: 'var(--faint)', textAlign: 'center', alignSelf: 'center' }}>{h?.metric ?? a?.metric ?? ''}</span>
            <span className="mono" style={{ ...mono, fontSize: 8.5, color: !homeLeads || winTied ? 'var(--text)' : 'var(--dim)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a && <span style={{ color: !homeLeads ? 'var(--you)' : 'var(--faint)', marginRight: 4 }}>{rnd(a.score)}</span>}
              {a ? fmtSlug(a.slug ?? '') : <span style={{ color: 'var(--faint)' }}>—</span>}
            </span>
          </div>
        );
      })}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                  {b.home_avatar && <img src={b.home_avatar} alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} />}
                  <span style={{ fontSize: 12, fontWeight: 700, color: homeLeads ? 'var(--you)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.home_team ?? `roster ${m.home_roster_id}`}</span>
                </div>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, overflow: 'hidden' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: !homeLeads && !tied ? 'var(--you)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{b.away_team ?? `roster ${m.away_roster_id}`}</span>
                  {b.away_avatar && <img src={b.away_avatar} alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} />}
                </div>
                <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, color: !homeLeads && !tied ? 'var(--you)' : tied ? 'var(--text)' : 'var(--dim)', lineHeight: 1.1, textAlign: 'right' }}>{awayScore}</div>
              </div>
            </div>
            {(m.home_coin != null || m.away_coin != null) && (
              <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)', textAlign: 'center', marginTop: 6 }}>◇ coin {rnd(m.home_coin ?? 0)} / {rnd(m.away_coin ?? 0)}</div>
            )}

            {/* Per-window scores + player detail */}
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {b.states.length === 0 ? <Muted text="No window scores yet — start the sim or a resolve." /> : b.states.map((s) => {
                const hw = Number(s.home_score);
                const aw = Number(s.away_score);
                const winWin = hw > aw;
                const winTied = hw === aw;
                const hasSlots = s.slot_scores?.length > 0;
                return (
                  <div key={s.game_window} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, padding: '5px 8px' }}>
                      <span className="mono" style={{ ...mono, fontSize: 13, fontWeight: 700, color: winWin ? 'var(--you)' : winTied ? 'var(--text)' : 'var(--dim)' }}>{rnd(hw)}</span>
                      <span className="mono" style={{ ...mono, fontSize: 8.5, letterSpacing: '0.08em', color: 'var(--faint)', textAlign: 'center' }}>{winLabel(s.game_window)}</span>
                      <span className="mono" style={{ ...mono, fontSize: 13, fontWeight: 700, color: !winWin && !winTied ? 'var(--you)' : winTied ? 'var(--text)' : 'var(--dim)', textAlign: 'right' }}>{rnd(aw)}</span>
                    </div>
                    {hasSlots
                      ? <SlotScoreRows slotScores={s.slot_scores} homeLeads={winWin} winTied={winTied} />
                      : (s.home_picks.length > 0 || s.away_picks.length > 0) && (
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
                        )
                    }
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

// Relative "Xs/Xm/Xh ago" for freshness readouts.
const ago = (iso: string | null): string => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// System health: ingest + resolve freshness, status mix. Polls every 10s.
function HealthPanel() {
  const [hp, setHp] = useState<AdminHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { try { setHp(await adminHealth()); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); } };
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  const liveOn = (hp?.live_matchups ?? 0) > 0;
  // While games are live, a >90s gap since the last play ingest is suspicious.
  const ingestStale = liveOn && hp?.last_play_ingest && (Date.now() - new Date(hp.last_play_ingest).getTime()) > 90_000;
  const stat = (label: string, value: React.ReactNode, color = 'var(--text)') => (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 9px', minWidth: 0 }}>
      <div className="mono" style={{ ...mono, fontSize: 8, letterSpacing: '0.08em', color: 'var(--faint)', fontWeight: 700 }}>{label}</div>
      <div className="mono" style={{ ...mono, fontSize: 12, fontWeight: 700, color, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={h}>SYSTEM HEALTH{liveOn && <span style={{ color: 'var(--you)', marginLeft: 6 }}>● {hp!.live_matchups} LIVE</span>}</div>
        <button onClick={load} className="mono" style={{ ...linkBtn, fontSize: 9 }}>↻</button>
      </div>
      {err ? <Muted text={err} /> : !hp ? <Muted text="Loading…" /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 6 }}>
          {stat('LEAGUES', hp.leagues)}
          {stat('ENROLLED', hp.enrolled)}
          {stat('MATCHUPS', Object.entries(hp.matchups_by_status).map(([s, n]) => `${n} ${s}`).join(' · ') || '—')}
          {stat('LIVE PLAYS', `${hp.live_play_count}${hp.sim_play_count ? ` (${hp.sim_play_count} sim)` : ''}`)}
          {stat('LAST INGEST', ago(hp.last_play_ingest), ingestStale ? 'var(--opp)' : liveOn ? 'var(--you)' : 'var(--text)')}
          {stat('LAST RESOLVE', ago(hp.last_state_update))}
        </div>
      )}
      {ingestStale && <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--opp)', marginTop: 8 }}>⚠ games are live but no play ingested in over 90s — check the poller.</div>}
    </div>
  );
}

const SIDE_STATUS = (s: PickSide): { label: string; color: string } => {
  if (s.controller === 'ai') return { label: '🤖 AI', color: 'var(--you)' };
  if (!s.enrolled) return { label: 'not joined', color: 'var(--faint)' };
  if (s.picks_set === 0) return { label: 'EMPTY', color: 'var(--opp)' };
  if (s.lineup_size && s.picks_set < s.lineup_size) return { label: `PARTIAL ${s.picks_set}/${s.lineup_size}`, color: '#d9a23a' };
  return { label: `SET ${s.picks_set}`, color: 'var(--you)' };
};

// Pick-readiness board: who's set a lineup for a week, with autofill/clear rescue.
function PickReadinessTab({ leagueId, week, admin }: { leagueId: string; week: number; admin: boolean }) {
  const [rows, setRows] = useState<PickReadiness[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => { try { setRows(await adminPickReadiness(leagueId, week)); } catch (e) { setBusy(e instanceof Error ? e.message : 'load failed'); } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId, week]);

  const autofill = async (m: PickReadiness, side: 'home' | 'away') => {
    const s = side === 'home' ? m.home : m.away;
    if (!s.app_user_id) { setBusy('manager not joined — no account to attach picks to (resolver falls back to their Sleeper lineup)'); return; }
    setBusy('autofill…');
    try {
      const data = await adminMatchupPicks(m.matchup_id);
      const lineup = (side === 'home' ? data.home_lineup : data.away_lineup) ?? [];
      const out: { game_window: string; roster_slot: string; player_slug: string; metric_id: string }[] = [];
      let i = 0;
      for (const w of WINDOWS) for (let sl = 0; sl < w.slots; sl++) {
        const e = lineup[i++];
        if (e?.player_slug) out.push({ game_window: w.id, roster_slot: String(sl), player_slug: e.player_slug, metric_id: defaultMetric(slugMeta(e.player_slug).pos).id });
      }
      if (!out.length) { setBusy('no synced lineup to autofill (run sync week)'); return; }
      const r = await adminSetPicks(m.matchup_id, s.app_user_id, out);
      setBusy(r.ok ? `✓ filled ${r.count} picks for ${s.team}` : (r.error ?? 'failed')); await load();
    } catch (e) { setBusy(e instanceof Error ? e.message : 'autofill failed'); }
  };
  const clear = async (m: PickReadiness, side: 'home' | 'away') => {
    const s = side === 'home' ? m.home : m.away;
    if (!s.app_user_id) return;
    if (!confirm(`Clear ${s.team}'s picks for this matchup?`)) return;
    setBusy('clear…');
    try { await adminClearPicks(m.matchup_id, s.app_user_id); setBusy(`✓ cleared ${s.team}`); await load(); }
    catch (e) { setBusy(e instanceof Error ? e.message : 'clear failed'); }
  };
  const toggleAi = async (m: PickReadiness, side: 'home' | 'away') => {
    const s = side === 'home' ? m.home : m.away;
    const next: Controller = s.controller === 'ai' ? 'human' : 'ai';
    setBusy('ai…');
    try { const r = await setTeamController(leagueId, s.roster_id, next); setBusy(r.ok ? `✓ ${s.team} → ${next}` : (r.error ?? 'failed')); await load(); }
    catch (e) { setBusy(e instanceof Error ? e.message : 'ai toggle failed'); }
  };

  const sideRow = (m: PickReadiness, side: 'home' | 'away') => {
    const s = side === 'home' ? m.home : m.away;
    const st = SIDE_STATUS(s);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
        <span style={{ fontSize: 11, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.team ?? `roster ${s.roster_id}`}</span>
        <span className="mono" style={{ ...mono, fontSize: 8.5, fontWeight: 700, color: st.color, border: `1px solid ${st.color}`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{st.label}</span>
        <button style={{ ...btn(s.controller === 'ai'), padding: '3px 6px' }} onClick={() => toggleAi(m, side)} title={s.controller === 'ai' ? 'hand back to the manager' : 'set this team to AI auto-pilot'}>🤖</button>
        {admin && s.enrolled && s.controller !== 'ai' && (
          <>
            <button style={{ ...btn(false), padding: '3px 6px' }} onClick={() => autofill(m, side)} title="fill picks from their synced Sleeper lineup">autofill</button>
            {s.picks_set > 0 && <button style={{ ...btn(false), padding: '3px 6px' }} onClick={() => clear(m, side)} title="clear their picks">✕</button>}
          </>
        )}
      </div>
    );
  };

  if (rows === null) return <div style={{ marginTop: 10 }}><Muted text="Loading…" /></div>;
  const empties = rows.reduce((n, m) => n + (m.home.enrolled && m.home.picks_set === 0 ? 1 : 0) + (m.away.enrolled && m.away.picks_set === 0 ? 1 : 0), 0);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="mono" style={{ ...mono, fontSize: 9.5, color: empties ? 'var(--opp)' : 'var(--you)', marginBottom: 8 }}>
        week {week} · {empties ? `${empties} enrolled manager${empties > 1 ? 's' : ''} with NO lineup` : 'all enrolled managers have a lineup'}
      </div>
      {busy && <div className="mono" style={{ ...mono, fontSize: 9.5, color: busy.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginBottom: 6 }}>{busy}</div>}
      {rows.length === 0 ? <Muted text="No matchups this week (run sync week)." /> : rows.map((m) => (
        <div key={m.matchup_id} style={{ borderTop: '1px solid var(--bd)', padding: '6px 0' }}>
          <div className="mono" style={{ ...mono, fontSize: 8.5, color: 'var(--faint)', marginBottom: 2 }}>{m.home.team ?? `Roster ${m.home_roster_id}`} v {m.away.team ?? `Roster ${m.away_roster_id}`} · {m.status}</div>
          {sideRow(m, 'home')}
          {sideRow(m, 'away')}
        </div>
      ))}
    </div>
  );
}

// One-click "resend sign-in link" — fires a fresh magic link to the member's email.
function SendLink({ email }: { email: string }) {
  const [s, setS] = useState<'' | 'sending' | 'sent' | 'err'>('');
  const send = async () => {
    setS('sending');
    try { await sendMagicLink(email); setS('sent'); }
    catch { setS('err'); }
  };
  return (
    <button onClick={send} disabled={s === 'sending' || s === 'sent'} className="mono"
      style={{ ...linkBtn, fontSize: 9, color: s === 'sent' ? 'var(--you)' : s === 'err' ? 'var(--opp)' : 'var(--dim)' }}
      title={`email a sign-in link to ${email}`}>
      {s === 'sent' ? '✓ link sent' : s === 'sending' ? '…' : s === 'err' ? 'failed' : '✉ send link'}
    </button>
  );
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>{text}</div>;
}

// A K or DST team picker — value is a '<team>-<suffix>' slug (or null = random).
// `taken` is the set of slugs already assigned to some team, so the picker can flag
// options that are already in use elsewhere (duplicates are allowed, not blocked).
function KdstSelect({ suffix, value, taken, onChange }: { suffix: 'k' | 'dst'; value: string | null; taken?: Set<string>; onChange: (v: string | null) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
      style={{ ...inp, padding: '3px 4px', fontSize: 10, width: 104 }} title={suffix === 'k' ? 'kicker team' : 'defense team'}>
      <option value="">{suffix === 'k' ? 'K · random' : 'DEF · random'}</option>
      {NFL_CODES.map((c) => {
        const slug = `${c}-${suffix}`;
        const isTaken = taken?.has(slug) && slug !== value;
        return <option key={c} value={slug}>{c.toUpperCase()} {suffix === 'k' ? 'K' : 'DEF'}{isTaken ? ' • taken' : ''}</option>;
      })}
    </select>
  );
}
