import { useEffect, useRef, useState } from 'react';
import {
  adminOverview, adminMatchups, adminSetMatchup, adminOverrides, adminSetOverride, adminAudit,
  adminAdmins, adminSetAdmin, adminUsers, adminLeagueMembers, adminRegenCode, redeemCommish, commishOverview, commishAudit,
  adminCodeRequests, adminSetCodeRequestHandled, adminSetCodeRequestEmail, adminMatchupBoard, adminResetMatchup, dispatchSim,
  adminMatchupPicks, adminPickReadiness, leagueFaabWallets, commishGrantFaab, type FaabWallets, adminHealth, adminMetriclessPicks, type MetriclessAudit, adminMarketReport, type MarketReport, adminSetPicks, adminClearPicks, sendMagicLink, sendInvite, adminAssignRoster, adminLeagueJoiners, setLeagueWaitlist, adminDeleteLeague, commishClaimRoster, commishSeedCoin, adminLeagueWallets, commishSetWeeklyBudget, commishGrantWeeklyBudget, adminSetTestLive, setPreseasonPractice, enablePreseasonPractice, seedPreseasonPool, preseasonWindow, friendlyError, lockHolds, adminSetWeekLock, type PreseasonWindow, type LeagueJoiner,
  setTeamController, setLineupPolicy, leagueCardTheme, adminSetCardTheme, demoCardTheme, adminSetDemoCardTheme,
  adminSetPot, adminClosePots,
  leagueKdst, setKdstMode, setTeamKdst, adminSetFeature, adminSoloPasses, adminSetSoloQuota, type SoloPassAdmin,
  rosterRules, setRosterRules, POS_CAP_KEYS, type PosCaps,
  setTransactionRules, commishMovePlayer, commishRemovePlayer, commishRuleTrade, setLeagueAvatar,
  setPickTrading,
  adminUserState, type ViewAsState,
  commishSetManager, teamManagers, type TeamManagerRow,
  leagueTrades, nativeTeamState, nativeRosters, leaguePool,
  playoffState, setPlayoffRules, generatePlayoffs, advancePlayoffs, autoGeneratePlayoffs,
  leagueGameMode, setLeagueClassicAccess, setLeaguePositionAccess,
  keeperState, rolloverLeague, type KeeperState,
  pickAssets, type PickAssetRow,
  setLeagueContinuity, type LeagueContinuity, isDynastyContinuity,
  leagueContracts, setContractRules, setSalaryRules, setRookieYears, type LeagueContracts,
  type WaiverMode, type TradeReview, type TradeRow, type LeaguePoolPlayer, type NativeRosterRow,
  type PlayoffState, type PlayoffMatchup,
  type AdminLeague, type AdminMatchup, type AdminOverride, type AdminAudit, type AdminAdmin, type AdminUser, type AdminMember, type CodeRequest, type MatchupBoard, type BoardPick, type BoardSlotScore,
  type PickReadiness, type PickSide, type AdminHealth, type Controller, type LineupPolicy, type LeagueKdst, type KdstMode,
} from '@drip/core/data/liveApi';
import { PRESEASON_BOARD_WEEKS } from '@drip/core/data/nflSlate';
import { importLeague, syncWeek, syncMembers } from '@drip/core/data/sleeperAdmin';
import { importEspnSeason, syncEspnSeason, stripProvider } from '@drip/core/data/providerAdmin';
import { forceResolve } from '@drip/core/data/forceResolve';
import { PuIcon, GameIcon, UI_ART } from '../app/gameIcons';
import { Avatar, Sheet } from '../app/ui';
import { onLeagueSettingsChanged } from '@drip/core/data/rosterBus';
import { useStore } from '../app/store';
import { AvatarPicker } from '../app/AvatarPicker';
import { CommishToolsPanel } from '../app/commishKit';
import { FeedSheet } from './FeedSheet';
import { WINDOWS, defaultMetric } from '@drip/core/data/metrics';
import { NFL_CODES } from '@drip/core/data/kdst';
import { slugMeta } from '@drip/core/data/slugMeta';
import { isMarkFree, setMarkFree } from '@drip/core/data/markFree';
import { getPremiumTier, adminSetPremiumTier, type PremiumTier } from '@drip/core/data/liveApi';
import { POWERUPS } from '@drip/core/data/powerups';
import { card, h, mono, chip, linkBtn, btn, inp, subhead, Muted, TabBar, SideNav, NavHub, useWide, errMsg, RADIUS, InfoChip, LabelInfo, type TabDef, type NavGroup } from './adminUi';
import { DraftRoom } from './NativeLeague';

const winLabel = (id: string) => WINDOWS.find((w) => w.id === id)?.label ?? id.toUpperCase();

const shareLink = (code: string) => `${window.location.origin}${window.location.pathname}?live=1&code=${code}`;
// Commissioner claim link — opens the "verify as commissioner" screen prefilled.
const commishLink = (code: string) => `${window.location.origin}${window.location.pathname}?live=1&commish=${code}`;
// Pull a platform league id out of whatever the requester pasted (raw id or a URL).
function extractLeagueId(raw: string, platform: string): string {
  const s = raw.trim();
  if (platform === 'espn') return (s.match(/leagueId=(\d+)/i) ?? s.match(/(\d{3,})/) ?? [])[1] ?? s;
  return (s.match(/leagues?\/(\d+)/i) ?? s.match(/(\d{5,})/) ?? [])[1] ?? s;
}
const copy = (v: string) => navigator.clipboard?.writeText(v);

// Same shape send-invite's EMAIL_RE checks, so the panel refuses what the mailer
// would refuse anyway — just without the round trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mistypes of the big consumer domains. A lead who fat-fingers their own address
// on the request form never hears from us and we never see a bounce, so triage is
// the only place the typo can still be caught.
const DOMAIN_TYPOS: Record<string, string> = {
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gamil.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'yahoo.co': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'homail.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com',
  'icloud.co': 'icloud.com', 'iclould.com': 'icloud.com', 'aol.co': 'aol.com',
};
/** A likelier spelling of an address whose domain is a known typo, else null. */
function emailTypoFix(v: string): string | null {
  const at = v.lastIndexOf('@');
  if (at < 1) return null;
  const fixed = DOMAIN_TYPOS[v.slice(at + 1).trim().toLowerCase()];
  return fixed ? `${v.slice(0, at)}@${fixed}` : null;
}


/** Friendly local time for a matchup's auto-lock (kickoff), e.g. "Sun 1:00 PM". */
function fmtLock(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

function CodeChip({ v }: { v: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="mono" style={{ ...mono, fontSize: 14, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', cursor: 'pointer' }}
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
        <span className="mono" style={{ fontSize: 13.5, color: 'var(--text)' }}>
          Mark-free mode · <b>{on ? 'ON' : 'OFF'}</b>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 3, maxWidth: 360 }}>
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
  useEffect(() => { getPremiumTier().then(setTier).catch((e) => setErr(errMsg(e, 'load failed'))); }, []);

  const save = async (next: PremiumTier) => {
    setTier(next); setBusy(true); setErr(null);
    try { const r = await adminSetPremiumTier(next.free_positions, next.free_powerups); if (!r.ok) setErr(r.error ?? 'save failed'); }
    catch (e) { setErr(errMsg(e, 'save failed')); }
    finally { setBusy(false); }
  };
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div style={card}>
      <div style={h}>PREMIUM TIER{busy ? ' · saving…' : ''}</div>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>Tap to toggle FREE ↔ premium. Highlighted = free (no payment); the rest need premium. Both sides of a premium matchup get the full set.</div>
      {!tier ? <div className="mono" style={{ fontSize: 13, color: 'var(--dim)' }}>loading…</div> : (
        <>
          <div style={{ fontSize: 11.5, letterSpacing: '0.1em', color: 'var(--dim)', marginBottom: 5 }}>POSITIONS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {ALL_POSITIONS.map((p) => { const free = tier.free_positions.includes(p); return (
              <button key={p} onClick={() => save({ ...tier, free_positions: flip(tier.free_positions, p) })} style={btn(free)}>{p === 'DEF' ? 'DST' : p}{free ? ' · free' : ' · 🔒'}</button>
            ); })}
          </div>
          <div style={{ fontSize: 11.5, letterSpacing: '0.1em', color: 'var(--dim)', marginBottom: 5 }}>POWER-UPS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {POWERUPS.map((pu) => { const free = tier.free_powerups.includes(pu.id); return (
              <button key={pu.id} onClick={() => save({ ...tier, free_powerups: flip(tier.free_powerups, pu.id) })} style={btn(free)} title={pu.name}><PuIcon id={pu.id} emoji={pu.icon} size="1.4em" /> {pu.name}{free ? ' · free' : ' · 🔒'}</button>
            ); })}
          </div>
        </>
      )}
      {err && <div className="mono" style={{ fontSize: 12.5, color: 'var(--opp)', marginTop: 8 }}>{err}</div>}
    </div>
  );
}

type AdminTab = 'leagues' | 'requests' | 'users' | 'system' | 'audit';

export function AdminPage({ onBack }: { onBack: () => void }) {
  const [leagues, setLeagues] = useState<AdminLeague[] | null>(null);
  const [overrides, setOverrides] = useState<AdminOverride[]>([]);
  const [audit, setAudit] = useState<AdminAudit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>('leagues');
  // League ids whose commissioner seat this account personally holds.
  const [mine, setMine] = useState<Set<string>>(new Set());
  // Open code-request count — badges the Requests tab so new ones aren't missed.
  const [pendingReqs, setPendingReqs] = useState(0);

  // Each section loads independently: one failing RPC must not blank the others
  // (leagues used to vanish when a later call threw), and failures surface with
  // their real message + which call produced it.
  const load = async () => {
    // commish_overview() filters on commissioner_id = auth.uid(), so it answers
    // the one question admin_overview can't: which of these seats are MINE.
    // (admin_overview's `commissioner` is `commissioner_id is not null` — the
    // seat is taken, by anyone.) Failure here is not an error worth showing:
    // the set just stays empty and the button offers to take the seat.
    const [ov, ors, au, ci] = await Promise.allSettled([adminOverview(), adminOverrides(), adminAudit(60), commishOverview()]);
    if (ov.status === 'fulfilled') setLeagues(ov.value); else setLeagues((cur) => cur ?? []);
    setMine(ci.status === 'fulfilled' ? new Set(ci.value.map((c) => c.league_id)) : new Set());
    if (ors.status === 'fulfilled') setOverrides(ors.value);
    if (au.status === 'fulfilled') setAudit(au.value);
    const parts = [['overview', ov], ['overrides', ors], ['audit', au]] as const;
    const errs = parts.filter(([, r]) => r.status === 'rejected')
      .map(([name, r]) => `${name}: ${errMsg((r as PromiseRejectedResult).reason, 'failed')}`);
    setErr(errs.length ? errs.join(' · ') : null);
    adminCodeRequests().then((rs) => setPendingReqs(rs.filter((r) => !r.handled).length)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const tabs: TabDef<AdminTab>[] = [
    { id: 'leagues', label: 'LEAGUES' },
    { id: 'requests', label: 'REQUESTS', badge: pendingReqs },
    { id: 'users', label: 'USERS' },
    { id: 'system', label: 'SYSTEM' },
    { id: 'audit', label: 'AUDIT' },
  ];

  return (
    <div className="mgmt">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="grotesk" style={{ fontSize: 19.5, fontWeight: 700, color: 'var(--text)' }}>⚙ Super admin</div>
          <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>
            {leagues === null ? '…' : `${leagues.length} league${leagues.length === 1 ? '' : 's'}`}{pendingReqs ? ` · ${pendingReqs} open request${pendingReqs === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <button onClick={load} className="mono" style={{ ...linkBtn, flexShrink: 0 }}>↻ refresh</button>
      </div>
      {err && <div className="mono" style={{ fontSize: 13, color: 'var(--opp)', marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-word' }}>⚠ {err}</div>}

      <TabBar tabs={tabs} active={tab} onSelect={setTab} style={{ marginBottom: 14 }} />

      {tab === 'leagues' && (
        <>
          <ImportLeague reload={load} />
          {leagues === null ? <div style={card}><Muted text="Loading…" /></div>
            : leagues.length === 0 ? <div style={card}><Muted text="No leagues imported yet — import one above." /></div>
            : leagues.map((l) => (
              <div key={l.league_id}>
                <LeagueRow l={l} reload={load} mine={mine.has(l.league_id)} />
                <ClassicAccessRow leagueId={l.league_id} />
                <PositionAccessRow leagueId={l.league_id} />
              </div>
            ))}
        </>
      )}

      {tab === 'requests' && <CodeRequests onPending={setPendingReqs} />}

      {tab === 'users' && (
        <>
          <FeatureFlags />
          <SoloPasses />
          <Users onLeaveAdmin={onBack} />
          <Admins />
          <Overrides overrides={overrides} reload={load} />
        </>
      )}

      {tab === 'system' && (
        <>
          <HealthPanel />
          <MarketPanel />
          {/* The audit sits under health because it answers the same kind of
              question — "is anything quietly wrong right now" — but on demand. */}
          <MetriclessPanel />
          <MarkFreeToggle />
          <DemoCardThemePanel />
          <PremiumTierPanel />
        </>
      )}

      {tab === 'audit' && (
        <div style={card}>
          <div style={h}>RECENT AUDIT</div>
          {audit.length === 0 ? <Muted text="No activity." /> : audit.map((a, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, gap: 8, borderTop: i ? '1px solid var(--bd)' : 'none' }}>
              <span className="mono" style={{ ...mono, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.op} <span style={{ color: 'var(--dim)' }}>{a.table}</span>{a.detail && <span style={{ color: 'var(--you)' }}> · {a.detail}</span>}{a.actor && <span style={{ color: 'var(--faint)' }}> · {a.actor}</span>}</span>
              <span className="mono" style={{ ...mono, color: 'var(--faint)', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 6 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}

// One league's management card — the whole commissioner/admin toolset for a
// league, organized under a tab strip (Setup / Members / Picks / Matchups /
// K-DST / Audit). Used by both the super-admin Leagues tab and CommishDash.
// The league management destinations (v0.212.0). Each id is ONE job — the old
// catch-all 'overview' has been split into invite / rules / season / admin, and
// the commissioner's settings panels (injected by CommishDash) are first-class
// destinations rather than cards stacked below the card.
export type LeagueTab =
  | 'overview' | 'waivers' | 'admin' | 'salary'
  | 'mode' | 'lineup' | 'scoring'
  | 'kit' | 'draft' | 'rosters' | 'playoffs' | 'dynasty' | 'matchups' | 'members' | 'coin' | 'audit' | 'ready' | 'kdst'
  | 'activity' | 'buffs' | 'delete';

// ── Roster rules editor (native leagues, 0071): per-position limits any time,
// roster size while the draft is still pending. ∞ = uncapped (stored null).
const CAP_UNLIMITED = 11;
const posShort = (p: string) => (p === 'DEF' ? 'D/ST' : p);
function RosterRulesEditor({ leagueId }: { leagueId: string }) {
  const [rounds, setRounds] = useState<number | null>(null);
  const [draftStatus, setDraftStatus] = useState('');
  const [caps, setCaps] = useState<Record<(typeof POS_CAP_KEYS)[number], number> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // v0.216.1: in a CLASSIC league the roster builder already derives roster
  // size (starters + bench + taxi + IR → draft rounds), so a second stepper
  // writing the same number is worse than redundant — the two can disagree.
  // It becomes a read-only readout there. A DRIP league has no builder, so
  // this stays its only way to set roster size.
  const [derived, setDerived] = useState(false);
  useEffect(() => {
    leagueGameMode(leagueId).then((r) => { if (r.ok) setDerived(r.mode === 'classic'); }).catch(() => {});
  }, [leagueId]);
  const loadRules = () => {
    rosterRules(leagueId).then((r) => {
      if (r.error || !r.ok) { setMsg(r.error ?? 'could not load roster rules'); return; }
      setRounds(r.rounds ?? 12);
      setDraftStatus(r.draft_status ?? '');
      setCaps(Object.fromEntries(POS_CAP_KEYS.map((k) =>
        [k, r.pos_caps?.[k] ?? CAP_UNLIMITED])) as Record<(typeof POS_CAP_KEYS)[number], number>);
    }).catch((e) => setMsg(errMsg(e, 'could not load roster rules')));
  };
  // ROSTER SIZE IS DERIVED, SO IT HAS TO FOLLOW (v0.297.1, founder: "roster
  // size doesn't adjust when I change the roster spots above"). The builder is
  // a SIBLING component with its own load, so it could change this number and
  // this panel would go on printing what it read on mount. It re-reads on the
  // builder's notice now.
  useEffect(() => {
    loadRules();
    return onLeagueSettingsChanged((id) => { if (id === leagueId) loadRules(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);
  if (!caps || rounds == null) return <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)' }}>{msg ?? 'loading rules…'}</div>;
  const pending = draftStatus === 'pending';
  const save = async () => {
    if (saving) return;
    setSaving(true); setMsg(null);
    try {
      const posCaps = Object.fromEntries(POS_CAP_KEYS.map((k) =>
        [k, caps[k] >= CAP_UNLIMITED ? null : caps[k]])) as PosCaps;
      const r = await setRosterRules(leagueId, pending && !derived ? rounds : null, posCaps);
      setMsg(r.ok ? '✓ saved — new limits apply immediately' : (r.error ?? 'save failed'));
    } catch (e) { setMsg(errMsg(e, 'save failed')); }
    finally { setSaving(false); }
  };
  const stepBtn: React.CSSProperties = { ...mono, fontSize: 13.5, fontWeight: 700, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' };
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {derived ? (
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>ROSTER SIZE</div>
            <div className="grotesk" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', marginTop: 4 }} title="starters + bench + taxi + IR — set on the ROSTER tab's builder">{rounds}</div>
            <div className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>from the builder</div>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>ROSTER SIZE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, opacity: pending ? 1 : 0.5 }}>
              <button onClick={() => pending && setRounds(Math.max(5, rounds - 1))} className="mono" style={stepBtn} disabled={!pending}>−</button>
              <span className="grotesk" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', minWidth: 22, textAlign: 'center' }}>{rounds}</span>
              {/* 5–99 since 0192 — the old 25 was a sanity bound on a table
                  that had quietly become the ceiling on how big a roster a
                  league may run. */}
              <button onClick={() => pending && setRounds(Math.min(99, rounds + 1))} className="mono" style={stepBtn} disabled={!pending}>＋</button>
            </div>
          </div>
        )}
        {POS_CAP_KEYS.map((k) => (
          <div key={k} style={{ textAlign: 'center' }}>
            <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>{posShort(k)} MAX</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <button onClick={() => setCaps({ ...caps, [k]: Math.max(0, caps[k] - 1) })} className="mono" style={stepBtn}>−</button>
              <span className="grotesk" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', minWidth: 22, textAlign: 'center' }}>{caps[k] >= CAP_UNLIMITED ? '∞' : caps[k]}</span>
              <button onClick={() => setCaps({ ...caps, [k]: Math.min(CAP_UNLIMITED, caps[k] + 1) })} className="mono" style={stepBtn}>＋</button>
            </div>
          </div>
        ))}
        <button onClick={save} disabled={saving} className="mono" style={btn(true)}>{saving ? 'saving…' : '✓ save rules'}</button>
      </div>
      <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
        Limits cap how many of a position a roster may hold (∞ = no limit, 0 bans it) — enforced at the draft, free agency, waivers, and auction bids; the AI drafts to them too. {derived ? 'Roster size comes from the builder (starters + bench + taxi + IR) on the ROSTER tab — the DRAFT is that minus the IR spots, which are stashed into rather than drafted.' : `Roster size ${pending ? 'can change until the draft starts' : 'is locked once the draft starts'}.`} Rosters already over a lowered limit keep their players — the limit blocks new adds.
      </div>
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

// ── FAAB wallets + grants (0173) ─────────────────────────────────────────────
// Every seat's remaining budget with a grant box each, plus one grant to the
// whole league. Balances are EFFECTIVE — a seat that has never bid reads the
// league default, not 0 — so "100" means the same thing on every row whether
// or not that team has spent yet.
function FaabWallets({ leagueId }: { leagueId: string }) {
  const [w, setW] = useState<FaabWallets | null>(null);
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueFaabWallets(leagueId).then(setW).catch((e) => setMsg(errMsg(e, 'load failed')));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const grant = async (rosterId: number | null, key: string) => {
    const n = Number(amt[key]);
    if (busy || !Number.isFinite(n) || n === 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishGrantFaab(leagueId, rosterId, Math.round(n));
      if (r.ok) { setAmt((a) => ({ ...a, [key]: '' })); setMsg(rosterId == null ? `✓ granted to all teams` : '✓ granted'); await load(); }
      else setMsg(r.error ?? 'failed');
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };
  const box: React.CSSProperties = { ...inp, fontSize: 12.5, padding: '4px 6px', width: 86 };
  const teams = w?.teams ?? [];
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
      <div style={subhead}>💰 FAAB WALLETS</div>
      {!w ? <Muted text="Loading…" /> : !w.ok ? <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--opp)' }}>{w.error}</div> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--dim)' }}>
              season budget ${w.budget} · {teams.length} teams · ${teams.reduce((s, t) => s + t.faab, 0).toLocaleString()} unspent
            </span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>grant every team</span>
            <input value={amt.all ?? ''} onChange={(e) => setAmt((a) => ({ ...a, all: e.target.value.replace(/[^\d-]/g, '') }))}
              onKeyDown={(e) => { if (e.key === 'Enter') void grant(null, 'all'); }}
              placeholder="+/− $" inputMode="numeric" style={box} />
            <button onClick={() => void grant(null, 'all')} disabled={busy || !amt.all} className="mono"
              style={{ ...btn(true), opacity: busy || !amt.all ? 0.5 : 1 }}>grant all</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {teams.map((t) => (
              <div key={t.roster_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 8px', background: 'var(--bg)', borderRadius: RADIUS }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: '1 1 150px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.team || `Roster ${t.roster_id}`}
                  {!t.touched && <span className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)', marginLeft: 6 }}>untouched</span>}
                </span>
                <span className="mono" style={{ ...mono, fontSize: 14, fontWeight: 700, color: t.faab > 0 ? 'var(--you)' : 'var(--faint)', minWidth: 64, textAlign: 'right' }}>
                  ${t.faab.toLocaleString()}
                </span>
                <input value={amt[t.roster_id] ?? ''} onChange={(e) => setAmt((a) => ({ ...a, [t.roster_id]: e.target.value.replace(/[^\d-]/g, '') }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void grant(t.roster_id, String(t.roster_id)); }}
                  placeholder="+/− $" inputMode="numeric" style={box} />
                <button onClick={() => void grant(t.roster_id, String(t.roster_id))} disabled={busy || !amt[t.roster_id]} className="mono"
                  style={{ ...btn(false), opacity: busy || !amt[t.roster_id] ? 0.5 : 1 }}>grant</button>
              </div>
            ))}
          </div>
          <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
            Grants are additive — a negative number claws back, and a balance never goes below $0. "Untouched" seats have never bid, so they still read the league default. Changing the waiver mode or season budget resets every balance to the default.
          </div>
        </>
      )}
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

// ── Waivers & trades rules (0072). Mode/budget saves only send CHANGED fields
// — the server resets every seat's FAAB balance when either changes. The
// schedule knobs send -1 to CLEAR (daily clear → rolling; window → always).
interface TxnRules {
  mode: WaiverMode; budget: number; review: TradeReview;
  clearMin: number | null; clearDow: number[] | null; faDow: number[] | null;
  holdDays: number; faStart: number | null; faEnd: number | null;
  agentWaivers: boolean;
}
function TransactionRulesEditor({ leagueId }: { leagueId: string }) {
  const [init, setInit] = useState<TxnRules | null>(null);
  const [mode, setMode] = useState<WaiverMode>('rolling');
  const [budget, setBudget] = useState(100);
  const [review, setReview] = useState<TradeReview>('none');
  // The pick-trading switch (0190) — saved on the click, not with SAVE.
  const [pickTrading, setPickTrading_] = useState(true);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const [clearMin, setClearMin] = useState<number | null>(null);   // null = rolling 24h
  const [clearDow, setClearDow] = useState<number[] | null>(null); // null = every day (0=Sun…6=Sat ET)
  const [faDow, setFaDow] = useState<number[] | null>(null);       // days FA waits for the waiver run
  const [holdDays, setHoldDays] = useState(1);
  const [agentWaivers, setAgentWaivers] = useState(true);
  const [faStart, setFaStart] = useState<number | null>(null);     // null = always open
  const [faEnd, setFaEnd] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    rosterRules(leagueId).then((r) => {
      if (r.error || !r.ok) { setMsg(r.error ?? 'could not load rules'); return; }
      const cur: TxnRules = {
        mode: r.waiver_mode ?? 'rolling', budget: r.faab_budget ?? 100, review: r.trade_review ?? 'none',
        clearMin: r.waiver_clear_min ?? null,
        clearDow: Array.isArray(r.waiver_clear_dow) && r.waiver_clear_dow.length ? [...r.waiver_clear_dow].sort() : null,
        faDow: Array.isArray(r.fa_after_waivers_dow) && r.fa_after_waivers_dow.length ? [...r.fa_after_waivers_dow].sort() : null,
        holdDays: r.waiver_hold_days ?? 1,
        faStart: r.fa_start_min ?? null, faEnd: r.fa_end_min ?? null,
        // Absent means ON (0213), the same default league_agent_waivers uses.
        agentWaivers: r.agent_waivers !== false,
      };
      setInit(cur); setMode(cur.mode); setBudget(cur.budget); setReview(cur.review);
      pickAssets(leagueId).then((a) => { if (a.ok) setPickTrading_(a.pick_trading !== false); }).catch(() => {});
      setClearMin(cur.clearMin); setClearDow(cur.clearDow); setFaDow(cur.faDow); setHoldDays(cur.holdDays); setFaStart(cur.faStart); setFaEnd(cur.faEnd);
      setAgentWaivers(cur.agentWaivers);
    }).catch((e) => setMsg(errMsg(e, 'could not load rules')));
  }, [leagueId]);
  if (!init) return <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)' }}>{msg ?? 'loading rules…'}</div>;
  const save = async () => {
    if (saving) return;
    setSaving(true); setMsg(null);
    try {
      const clearChanged = clearMin !== init.clearMin;
      const dowChanged = JSON.stringify(clearDow ?? []) !== JSON.stringify(init.clearDow ?? []);
      const faDowChanged = JSON.stringify(faDow ?? []) !== JSON.stringify(init.faDow ?? []);
      const faChanged = faStart !== init.faStart || faEnd !== init.faEnd;
      const r = await setTransactionRules(leagueId,
        mode !== init.mode ? mode : null,
        mode === 'faab' && budget !== init.budget ? budget : null,
        review !== init.review ? review : null,
        clearChanged ? (clearMin ?? -1) : null,
        holdDays !== init.holdDays ? holdDays : null,
        faChanged ? (faStart ?? -1) : null,
        faChanged ? (faEnd ?? -1) : null,
        dowChanged ? (clearDow ?? []) : null,
        faDowChanged ? (faDow ?? []) : null,
        agentWaivers !== init.agentWaivers ? agentWaivers : null);
      if (r.ok) { setInit({ mode, budget, review, clearMin, clearDow, faDow, holdDays, faStart, faEnd, agentWaivers }); setMsg('✓ saved'); }
      else setMsg(r.error ?? 'save failed');
    } catch (e) { setMsg(errMsg(e, 'save failed')); }
    finally { setSaving(false); }
  };
  const hour12 = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`; };
  // ANY time of day, not just the top of the hour (v0.216.1, founder's ask).
  // The 15-minute nudges keep the common cases one click away; the field
  // itself takes whatever a commissioner types.
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const hourStep = (v: number, set: (m: number) => void, keyLabel: string) => (
    <div>
      <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>{keyLabel} ({hour12(v)} ET)</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
        <button onClick={() => set((v + 1425) % 1440)} className="mono" style={stepBtnStyle} title="15 minutes earlier">−</button>
        <input type="time" value={hhmm(v)} step={300}
          onChange={(e) => {
            const [h, mi] = e.target.value.split(':').map(Number);
            if (Number.isFinite(h) && Number.isFinite(mi)) set(((h * 60 + mi) % 1440 + 1440) % 1440);
          }}
          className="mono" style={{ ...inp, fontSize: 13.5, padding: '4px 6px', colorScheme: 'dark' }} />
        <button onClick={() => set((v + 15) % 1440)} className="mono" style={stepBtnStyle} title="15 minutes later">＋</button>
      </div>
    </div>
  );
  const toggle = (on: boolean, label: string, onClick: () => void) => (
    <button onClick={onClick} className="mono" style={{ ...mono, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: RADIUS, padding: '4px 10px' }}>{label}</button>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>WAIVERS</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
            {toggle(mode === 'rolling', 'ROLLING', () => setMode('rolling'))}
            {toggle(mode === 'standings', 'REVERSE STANDINGS', () => setMode('standings'))}
            {toggle(mode === 'faab', '💰 FAAB', () => setMode('faab'))}
          </div>
        </div>
        {mode === 'faab' && (
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>SEASON BUDGET ($)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
              <button onClick={() => setBudget(Math.max(10, budget - 10))} className="mono" style={stepBtnStyle}>−</button>
              <span className="grotesk" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', minWidth: 34, textAlign: 'center' }}>{budget}</span>
              <button onClick={() => setBudget(Math.min(1000, budget + 10))} className="mono" style={stepBtnStyle}>＋</button>
            </div>
          </div>
        )}
        <div>
          <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>TRADE REVIEW</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
            {toggle(review === 'none', 'AUTO-ACCEPT', () => setReview('none'))}
            {toggle(review === 'commish', '⚑ COMMISH APPROVES', () => setReview('commish'))}
          </div>
        </div>
        {/* THE PICK SWITCH (0190). Saved on the CLICK rather than with the save
            button beside it: turning it on PROVISIONS this league's draft slots
            and turning it off deletes them — a write, not a draft of one — and
            it can be refused, because a slot somebody already traded for is
            their property and the server says so instead of deleting it. */}
        {/* EMPTY SEATS ON THE WIRE (0213). Unlike the pick switch below it this
            saves with the rules button — it writes a settings flag and nothing
            else, so there is nothing to provision and nothing to refuse. Kept
            separate from the auto-slot opt-out on purpose: filling a lineup
            from players a seat already owns is housekeeping, while adding and
            dropping changes the pool and spends FAAB. */}
        <div>
          <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>UNMANAGED SEATS</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
            {toggle(agentWaivers, agentWaivers ? '🤖 CLAIM' : '🤖 SIT', () => setAgentWaivers(!agentWaivers))}
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 5, lineHeight: 1.5, maxWidth: 320 }}>
            {agentWaivers
              ? 'Seats nobody manages fill holes and take clear upgrades from waivers and free agency — never dropping a player in their starting lineup.'
              : 'Seats nobody manages still set lineups, but never add or drop.'}
          </div>
        </div>

        <div>
          <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>DRAFT PICK TRADING</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
            {toggle(pickTrading, pickTrading ? 'ON' : 'OFF', () => void (async () => {
              const next = !pickTrading;
              const r = await setPickTrading(leagueId, next);
              if (r.ok) { setPickTrading_(next); setPickNote(null); } else setPickNote(friendlyError(r.error ?? 'that didn’t work'));
            })())}
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: pickNote ? 'var(--opp)' : 'var(--faint)', marginTop: 5, lineHeight: 1.5, maxWidth: 320 }}>
            {pickNote ?? (pickTrading
              ? 'Draft slots and rookie picks trade — before the draft and while it runs. The pick on the clock never does.'
              : 'Players trade as usual; offers naming a draft pick are refused.')}
          </div>
        </div>
      </div>
      {/* waiver clear schedule + free-agency window (daily, ET) */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <div>
          <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>WAIVERS CLEAR</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
            {toggle(clearMin == null, '24H AFTER DROP', () => setClearMin(null))}
            {toggle(clearMin != null, '🕒 DAILY AT A SET TIME', () => setClearMin(clearMin ?? 180))}
          </div>
        </div>
        {clearMin != null && hourStep(clearMin, setClearMin, 'CLEAR TIME')}
        {clearMin != null && (
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>HOLD (DAYS)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
              <button onClick={() => setHoldDays(Math.max(1, holdDays - 1))} className="mono" style={stepBtnStyle}>−</button>
              <span className="grotesk" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', minWidth: 22, textAlign: 'center' }}>{holdDays}</span>
              <button onClick={() => setHoldDays(Math.min(7, holdDays + 1))} className="mono" style={stepBtnStyle}>＋</button>
            </div>
          </div>
        )}
        {clearMin != null && (
          <div>
            <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>RUN DAYS (ET)</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
              {toggle(clearDow === null, 'ALL', () => setClearDow(null))}
              {(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const).map((d, i) => (
                <span key={d}>{toggle(!!clearDow?.includes(i), d, () => {
                  const cur = clearDow ?? [];
                  const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort();
                  setClearDow(next.length ? next : null);
                })}</span>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="mono" title="On checked days, instant adds stay closed until that day's waiver run has cleared." style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>FA WAITS FOR THE RUN ON</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
            {toggle(faDow === null, 'NEVER', () => setFaDow(null))}
            {(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const).map((d, i) => (
              <span key={`fa-${d}`}>{toggle(!!faDow?.includes(i), d, () => {
                const cur = faDow ?? [];
                const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort();
                setFaDow(next.length ? next : null);
              })}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>FREE AGENCY</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
            {toggle(faStart == null, 'ALWAYS OPEN', () => { setFaStart(null); setFaEnd(null); })}
            {toggle(faStart != null, '🕒 DAILY WINDOW', () => { setFaStart(faStart ?? 600); setFaEnd(faEnd ?? 1320); })}
          </div>
        </div>
        {faStart != null && hourStep(faStart, setFaStart, 'OPENS')}
        {faStart != null && hourStep(faEnd ?? 1320, (m) => setFaEnd(m), 'CLOSES')}
        <button onClick={save} disabled={saving} className="mono" style={btn(true)}>{saving ? 'saving…' : '✓ save'}</button>
      </div>
      {/* FAAB wallets (0173) — only meaningful in FAAB mode, and the grant RPC
          refuses outside it, so the whole block is gated on the SAVED mode
          rather than the unsaved toggle. */}
      {init?.mode === 'faab' && <FaabWallets leagueId={leagueId} />}
      <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
        FAAB: claims carry blind bids against a season budget — highest bid wins, winner pays, losers keep their money. Changing the mode or budget resets every team's balance. Trade review parks accepted trades until you approve or veto them. A daily clear time holds dropped players until that ET time (× hold days); the free-agency window gates instant pickups only — claims can be submitted around the clock.
      </div>
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
const stepBtnStyle: React.CSSProperties = { ...mono, fontSize: 13.5, fontWeight: 700, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' };

// ── ROSTERS tab (native leagues): move any player anywhere + rule on trades.
function NativeRosterTools({ leagueId }: { leagueId: string }) {
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [rosters, setRosters] = useState<NativeRosterRow[]>([]);
  const [teams, setTeams] = useState<{ roster_id: number; team: string | null }[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [q, setQ] = useState('');
  // 'all' = every rostered player · 'fa' = the waiver wire · else a roster id.
  const [view, setView] = useState<string>('all');
  const [dest, setDest] = useState<Record<string, string>>({});   // slug → target roster id
  /** The move/waive/cut awaiting a yes (v0.293.1). One at a time; null = none. */
  const [ask, setAsk] = useState<null | { slug: string; name: string; act: 'move' | 'waive' | 'cut'; toRoster?: number; toName?: string; from: string }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    const [t, r, p, tr] = await Promise.all([
      nativeTeamState(leagueId), nativeRosters(leagueId), leaguePool(leagueId), leagueTrades(leagueId),
    ]);
    setTeams(t.waiver_order ?? []); setRosters(r); setPool(p);
    setTrades(Array.isArray(tr) ? tr : []);
  };
  useEffect(() => { load().catch((e) => setMsg(errMsg(e, 'load failed'))); /* eslint-disable-next-line */ }, [leagueId]);
  const bySlugRoster = new Map(rosters.map((r) => [r.slug, r.roster_id]));
  const poolBySlug = new Map(pool.map((p) => [p.slug, p]));
  const teamName = (rid: number) => teams.find((t) => t.roster_id === rid)?.team ?? `Team ${rid}`;
  const playerName = (slug: string) => poolBySlug.get(slug)?.full_name ?? slug;
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg(r.ok ? '✓ done' : (r.error ?? 'that didn’t work')); await load(); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };
  const needle = q.trim().toLowerCase();
  // WHICH SET OF PLAYERS (v0.215.0, founder's ask): one team's roster, the
  // waiver wire (everyone unrostered — who's actually available to move), or
  // every rostered player as before. Picking a team answers "what does this
  // manager have" without reading a league-wide list and matching names.
  const spotOf = new Map(rosters.map((r) => [r.slug, r.spot ?? 'active']));
  const inView = view === 'all' ? pool.filter((p) => bySlugRoster.has(p.slug))
    : view === 'fa' ? pool.filter((p) => !bySlugRoster.has(p.slug))
    : pool.filter((p) => bySlugRoster.get(p.slug) === Number(view));
  // In the ALL view search still reaches the WHOLE pool — that was the only
  // way to find a free agent before this selector existed, and muscle memory
  // shouldn't break. Inside a team / the wire, search filters that set.
  const searched = needle
    ? (view === 'all' ? pool : inView).filter((p) => p.full_name.toLowerCase().includes(needle))
    : inView;
  const CAP = 60;
  const rows = searched.slice(0, CAP);
  const teamCounts = (rid: number) => {
    const mine = rosters.filter((r) => r.roster_id === rid);
    const taxi = mine.filter((r) => r.spot === 'taxi').length;
    const ir = mine.filter((r) => r.spot === 'ir').length;
    return `${mine.length} rostered${taxi ? ` · ${taxi} taxi` : ''}${ir ? ` · ${ir} IR` : ''}`;
  };
  const holdLeft = (until: string | null): string | null => {
    if (!until) return null;
    const ms = Date.parse(until) - Date.now();
    if (!(ms > 0)) return null;
    const h = Math.floor(ms / 3600_000);
    return h >= 1 ? `${h}h` : `${Math.max(1, Math.round(ms / 60_000))}m`;
  };
  const reviewQueue = trades.filter((t) => t.status === 'accepted' || t.status === 'pending');
  const statusColor: Record<string, string> = { executed: 'var(--you)', accepted: 'var(--warn)', pending: 'var(--dim)', vetoed: 'var(--opp)', rejected: 'var(--faint)', cancelled: 'var(--faint)' };
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{msg}</div>}

      {/* trade rulings */}
      <div>
        <div style={subhead}>TRADES</div>
        {reviewQueue.length === 0 && <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)' }}>Nothing waiting on you.</div>}
        {reviewQueue.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--bd)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: 'var(--text)', flex: 1, minWidth: 220, lineHeight: 1.5 }}>
              <b>{teamName(t.from_roster)}</b> sends {t.give.map(playerName).join(', ') || '—'} ·{' '}
              <b>{teamName(t.to_roster)}</b> sends {t.get.map(playerName).join(', ') || '—'}
              {t.note && <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}> “{t.note}”</span>}
            </span>
            <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: statusColor[t.status] ?? 'var(--dim)', border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 6px' }}>{t.status === 'accepted' ? 'AWAITING RULING' : 'OFFERED'}</span>
            {t.status === 'accepted' && (
              <button onClick={() => run(() => commishRuleTrade(t.id, true))} disabled={busy} className="mono" style={btn(true)}>✓ approve</button>
            )}
            <button onClick={() => run(() => commishRuleTrade(t.id, false))} disabled={busy} className="mono" style={{ ...btn(false), color: 'var(--opp)' }}>✕ veto</button>
          </div>
        ))}
      </div>

      {/* player mover */}
      <div>
        <div style={subhead}>ROSTERS &amp; WAIVER WIRE</div>
        {/* Pick a roster to see one manager's team, or the wire to see who's
            actually available. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <select value={view} onChange={(e) => { setView(e.target.value); setQ(''); }} className="mono"
            style={{ ...mono, fontSize: 13, fontWeight: 700, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '6px 8px', minWidth: 190 }}>
            <option value="all">ALL ROSTERED PLAYERS</option>
            <option value="fa">⏳ WAIVER WIRE — available</option>
            {teams.map((t) => (
              <option key={t.roster_id} value={String(t.roster_id)}>{t.team ?? `Team ${t.roster_id}`}</option>
            ))}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={view === 'all' ? 'Search the whole pool (free agents too)…' : view === 'fa' ? 'Search the wire…' : 'Search this roster…'}
            style={{ ...inp, flex: '1 1 200px', minWidth: 0 }} />
        </div>
        <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginBottom: 6 }}>
          {view === 'all' ? `${inView.length} rostered across ${teams.length} teams`
            : view === 'fa' ? `${inView.length} available — nobody's roster`
            : teamCounts(Number(view))}
          {searched.length > CAP && <span> · showing first {CAP} of {searched.length}</span>}
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {rows.map((p) => {
            const rid = bySlugRoster.get(p.slug);
            const to = dest[p.slug] ?? '';
            return (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, color: 'var(--text)', flex: 1, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.full_name} <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)' }}>{p.pos} · {p.team}</span>
                </span>
                {/* Stash spot (taxi/IR) and any live waiver hold — the two
                    facts that decide whether a move is even sensible. */}
                {rid != null && spotOf.get(p.slug) && spotOf.get(p.slug) !== 'active' && (
                  <span className="mono" style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: RADIUS, padding: '1px 4px' }}>
                    {String(spotOf.get(p.slug)).toUpperCase()}
                  </span>
                )}
                {rid == null && holdLeft(p.waived_until) && (
                  <span className="mono" style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: RADIUS, padding: '1px 4px' }}
                    title="on waivers — claims are open; a commissioner move clears the hold">
                    ⏳ {holdLeft(p.waived_until)}
                  </span>
                )}
                <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: rid != null ? 'var(--you)' : 'var(--faint)', minWidth: 76, textAlign: 'right' }}>
                  {rid != null ? teamName(rid) : 'FREE AGENT'}
                </span>
                <select value={to} onChange={(e) => setDest({ ...dest, [p.slug]: e.target.value })}
                  className="mono" style={{ ...mono, fontSize: 12, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 6px' }}>
                  <option value="">move to…</option>
                  {teams.filter((t) => t.roster_id !== rid).map((t) => (
                    <option key={t.roster_id} value={t.roster_id}>{t.team ?? `Team ${t.roster_id}`}</option>
                  ))}
                </select>
                {/* ASK FIRST (v0.293.1, founder: "we need a confirm popup when
                    commish moving/dropping players"). All three of these edit
                    SOMEBODY ELSE'S roster without their say — the one class of
                    action in the console where the person who feels it isn't the
                    person clicking — and they sat one stray click from a select
                    box you have to use to reach them. */}
                <button onClick={() => to && setAsk({ slug: p.slug, name: p.full_name, act: 'move', toRoster: parseInt(to, 10), toName: teamName(parseInt(to, 10)), from: rid != null ? teamName(rid) : 'free agency' })}
                  disabled={busy || !to} className="mono" style={{ ...btn(true), opacity: to ? 1 : 0.4 }}>→ move</button>
                {rid != null && <>
                  <button onClick={() => setAsk({ slug: p.slug, name: p.full_name, act: 'waive', from: teamName(rid) })} disabled={busy} className="mono" style={btn(false)} title="off the roster, 24h waiver hold">⏳ waive</button>
                  <button onClick={() => setAsk({ slug: p.slug, name: p.full_name, act: 'cut', from: teamName(rid) })} disabled={busy} className="mono" style={{ ...btn(false), color: 'var(--opp)' }} title="off the roster, instant free agent">✕ cut</button>
                </>}
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', padding: '6px 0' }}>
              {needle ? 'No matches.'
                : view === 'fa' ? 'Nobody on the wire — every pool player is rostered.'
                : view === 'all' ? 'Nobody rostered yet — run the draft first.'
                : 'This roster is empty.'}
            </div>
          )}
        </div>
        <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
          Moves clear waiver holds and bypass position limits (roster size still applies). WAIVE starts a 24h claim window; CUT frees the player immediately.
        </div>
      </div>

      {/* The confirm. It names the PLAYER, the team losing him and the team
          getting him, because "are you sure?" over a list of forty names is not
          a question anyone can answer. */}
      {ask && (
        <div onClick={() => setAsk(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 420 }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {ask.act === 'move' ? 'Move this player?' : ask.act === 'waive' ? 'Waive this player?' : 'Cut this player?'}
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, lineHeight: 1.6 }}>
              {ask.act === 'move' ? <>
                <b style={{ color: 'var(--text)' }}>{ask.name}</b> moves from <b style={{ color: 'var(--text)' }}>{ask.from}</b> to{' '}
                <b style={{ color: 'var(--you)' }}>{ask.toName}</b>. Waiver holds clear and position limits are bypassed.
              </> : ask.act === 'waive' ? <>
                <b style={{ color: 'var(--text)' }}>{ask.name}</b> comes off <b style={{ color: 'var(--text)' }}>{ask.from}</b> and sits on
                waivers for 24 hours — anyone in the league can claim him.
              </> : <>
                <b style={{ color: 'var(--text)' }}>{ask.name}</b> comes off <b style={{ color: 'var(--text)' }}>{ask.from}</b> and becomes a
                free agent <b style={{ color: 'var(--opp)' }}>immediately</b> — first come, first served.
              </>}
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
              This is another manager's roster. They are not asked.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setAsk(null)} className="mono" style={{ ...btn(false), flex: 1, padding: '9px 0' }}>cancel</button>
              <button disabled={busy} className="mono"
                style={{ ...btn(ask.act === 'move'), flex: 1, padding: '9px 0', ...(ask.act === 'cut' ? { color: 'var(--opp)' } : {}) }}
                onClick={() => {
                  const a = ask; setAsk(null);
                  if (a.act === 'move' && a.toRoster != null) run(() => commishMovePlayer(leagueId, a.slug, a.toRoster!));
                  else if (a.act !== 'move') run(() => commishRemovePlayer(leagueId, a.slug, a.act === 'waive'));
                }}>
                {ask.act === 'move' ? '→ move him' : ask.act === 'waive' ? '⏳ waive him' : '✕ cut him'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Per-league POSITION flags (0171): which extra position groups the admin has
// unlocked — HC / P / IDP / FB / RET. Commissioners see the builder chips and
// pool entries only where these are on. Rendered beside the classic unlock.
function PositionAccessRow({ leagueId }: { leagueId: string }) {
  const GROUPS = ['HC', 'P', 'IDP', 'FB', 'RET'] as const;
  const [on, setOn] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    leagueGameMode(leagueId).then((r) => { if (r.ok) setOn(r.positions ?? []); }).catch(() => {});
  }, [leagueId]);
  const flip = async (g: string) => {
    if (on === null || busy) return;
    setBusy(true);
    try {
      const next = on.includes(g) ? on.filter((x) => x !== g) : [...on, g];
      const r = await setLeaguePositionAccess(leagueId, next);
      if (r.ok) setOn(r.positions ?? next);
    } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 12px', flexWrap: 'wrap' }}>
      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--faint)' }}>🧩 EXTRA POSITIONS</span>
      {GROUPS.map((g) => {
        const lit = on?.includes(g) ?? false;
        return (
          <button key={g} onClick={() => void flip(g)} disabled={on === null || busy} className="mono"
            style={{ fontSize: 11.5, fontWeight: 700, borderRadius: RADIUS, padding: '3px 10px', cursor: 'pointer',
              color: lit ? 'var(--on-accent)' : 'var(--dim)', background: lit ? 'var(--you)' : 'var(--bg)',
              border: `1px solid ${lit ? 'var(--you)' : 'var(--bd)'}`, opacity: on === null || busy ? 0.5 : 1 }}>
            {g}
          </button>
        );
      })}
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>commish must ↻ refresh the pool after a flip</span>
    </div>
  );
}

// The founder's per-league feature flag on normie mode (0158): commissioners
// only see the CLASSIC choice where this is on. Rendered under each league in
// the admin list; current mode shown so a flip's effect is legible in place.
function ClassicAccessRow({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [mode, setMode] = useState<string>('drip');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    leagueGameMode(leagueId).then((r) => { if (r.ok) { setOn(r.classic_ok === true); setMode(r.mode ?? 'drip'); } }).catch(() => {});
  }, [leagueId]);
  const flip = async () => {
    if (on === null || busy) return;
    setBusy(true);
    try { const r = await setLeagueClassicAccess(leagueId, !on); if (r.ok) setOn(!on); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px 14px' }}>
      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--faint)' }}>
        🎮 CLASSIC (NORMIE) AVAILABILITY {mode === 'classic' ? '· league is CLASSIC now' : ''}
      </span>
      <button onClick={() => void flip()} disabled={on === null || busy} className="mono"
        style={{ fontSize: 12, fontWeight: 700, borderRadius: RADIUS, padding: '4px 12px', cursor: 'pointer',
          color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)',
          border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, opacity: on === null || busy ? 0.5 : 1 }}>
        {on === null ? '…' : on ? 'UNLOCKED' : 'LOCKED'}
      </button>
    </div>
  );
}

export function LeagueRow({ l, reload, admin = true, mine = false, defaultTab = '', openSection = false, collapsible = false, defaultOpen = true, panels }: {
  l: AdminLeague; reload: () => void; admin?: boolean; defaultTab?: '' | LeagueTab;
  /** Narrow screens land on the MAP unless the caller meant a destination —
   *  post-create goes straight to the draft room, and only then does the
   *  section open on arrival. `defaultTab` alone doesn't mean that: it also
   *  carries the desktop's landing tab, which a phone shows as the map. */
  openSection?: boolean;
  /** Extra destinations rendered by the CALLER (v0.212.0). CommishDash injects
   *  its settings/activity/power-up panels here; the admin console passes
   *  nothing and simply doesn't show those entries. Injection keeps the
   *  dependency pointing one way — CommishDash imports LeagueRow, never the
   *  reverse — so the nav can host panels this file knows nothing about. */
  panels?: Partial<Record<LeagueTab, React.ReactNode>>;
  /** Whether the signed-in user personally holds this league's commissioner
   *  seat. Deliberately NOT `l.commissioner`, which is
   *  `commissioner_id is not null` — "somebody runs this league", not "you do".
   *  CommishDash rows come from commish_overview(), which filters on
   *  auth.uid(), so there every row is `mine`. */
  mine?: boolean;
  /** Collapsible card: the header toggles the management panel (CommishDash uses
   *  this when you run several leagues). Non-collapsible cards are always open. */
  collapsible?: boolean; defaultOpen?: boolean;
}) {
  const [matchups, setMatchups] = useState<AdminMatchup[] | null>(null);
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [joiners, setJoiners] = useState<LeagueJoiner[]>([]);
  const [wallets, setWallets] = useState<Record<number, number>>({});
  const [audit, setAudit] = useState<AdminAudit[] | null>(null);
  const [tab, setTab] = useState<LeagueTab>(defaultTab || 'overview');
  // HUB-FIRST on phones (v0.259.0), and the hub NEVER LEAVES (v0.296.3): a
  // narrow screen shows the whole map of destinations and pops the one you
  // picked up over it, so the map is always one dismiss away. It used to be a
  // swap — map OR destination, with a "⊞ ALL SETTINGS" button to get back —
  // which is the one thing the app's commissioner map was written not to do.
  // An explicit defaultTab (post-create → the draft room) still lands direct,
  // with the section already open.
  const [sectionOpen, setSectionOpen] = useState<boolean>(() => openSection);
  // CLASSIC LEAGUES DON'T PLAY WITH COIN (v0.297.3, founder: "classic leagues
  // won't use power ups so they don't need that on the league menu. They don't
  // need drip coin either"). Drip coin exists to buy power-ups; a classic
  // league has neither, so both destinations leave its map rather than opening
  // onto controls for a currency nothing spends. Null until the read lands —
  // and the destinations show meanwhile, because a menu that pops items in
  // reads worse than one that briefly offers a room you don't need.
  const [classic, setClassic] = useState(false);
  useEffect(() => {
    if (l.provider !== 'native') return;
    leagueGameMode(l.league_id).then((r) => { if (r.ok) setClassic(r.mode === 'classic'); }).catch(() => {});
  }, [l.league_id, l.provider]);
  const [open, setOpen] = useState(collapsible ? defaultOpen : true);
  const wide = useWide();
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
  const [watch, setWatch] = useState<string | null>(null);
  // The replay target: the matchup AND its own week (v0.214.0) — the sheet
  // replays that week's real plays, not whatever the baked-source box says.
  const [sheet, setSheet] = useState<{ id: string; week: number } | null>(null);
  const [policy, setPolicy] = useState<LineupPolicy>(l.lineup_policy ?? 'best_lineup');
  const changePolicy = async (p: LineupPolicy) => { setPolicy(p); try { await setLineupPolicy(l.league_id, p); } catch { /* keep optimistic */ } };
  const toggleMemberAi = async (rosterId: number, cur: Controller | undefined) => {
    const next: Controller = cur === 'ai' ? 'human' : 'ai';
    try { await setTeamController(l.league_id, rosterId, next); await loadMembers(); } catch { /* noop */ }
  };
  const assign = async (rosterId: number, a: { email?: string; appUserId?: string }) => {
    const r = await adminAssignRoster(l.league_id, rosterId, a.email ?? '', a.appUserId);
    await loadMembers();
    return r;
  };
  // Commissioner/admin claims a roster for themselves (a team to play).
  const claimSelf = async (rosterId: number) => {
    const r = await commishClaimRoster(l.league_id, rosterId);
    await loadMembers();
    return r;
  };
  const [running, setRunning] = useState(false);
  // Wrap an async demo action: guard double-clicks, surface progress + result/error.
  const run = async (label: string, fn: () => Promise<string>) => {
    if (running) return;
    setRunning(true); setBusy(label);
    try { setBusy(await fn()); await loadM(); }
    catch (e) { setBusy(errMsg(e, `${label} failed`)); }
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
  // Returns the rows as well as storing them, so a caller (the member refresh)
  // can report on what came back without racing the state update.
  const loadMembers = async () => {
    const rows = await adminLeagueMembers(l.league_id);
    setMembers(rows);
    adminLeagueJoiners(l.league_id).then(setJoiners).catch(() => setJoiners([]));
    adminLeagueWallets(l.league_id).then((ws) => setWallets(Object.fromEntries((ws ?? []).map((w) => [w.roster_id, w.coins])))).catch(() => setWallets({}));
    return rows;
  };
  // Commissioner grants drip coin to a team; refresh balances after.
  const seedCoin = async (rosterId: number, amount: number) => {
    const r = await commishSeedCoin(l.league_id, rosterId, amount);
    if (r.ok) adminLeagueWallets(l.league_id).then((ws) => setWallets(Object.fromEntries((ws ?? []).map((w) => [w.roster_id, w.coins])))).catch(() => {});
    return r;
  };
  const loadAudit = async () => setAudit(await commishAudit(l.league_id, 40));
  const showTab = (t: LeagueTab) => {
    setTab(t);
    if (t === 'matchups') { if (!matchups) loadM().catch(() => {}); if (!members) loadMembers().catch(() => {}); }
    if ((t === 'members' || t === 'coin') && !members) loadMembers().catch(() => {});
    if (t === 'audit') loadAudit().catch(() => {});
    if ((t === 'kdst' || t === 'mode') && !kdst) loadKdst();
  };
  // Load the active tab's data once the card is (or becomes) open — collapsed
  // cards don't fetch anything until expanded. Guards prevent refetching.
  useEffect(() => {
    if (!open) return;
    if ((tab === 'members' || tab === 'coin') && !members) loadMembers().catch(() => {});
    else if (tab === 'matchups') { if (!matchups) loadM().catch(() => {}); if (!members) loadMembers().catch(() => {}); }
    else if ((tab === 'kdst' || tab === 'mode') && !kdst) loadKdst();
    else if (tab === 'audit' && !audit) loadAudit().catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);
  const set = async (id: string, status: string, lockNow = false) => { await adminSetMatchup(id, status, lockNow); await loadM(); };
  // Schedule the WHOLE regular season (all weeks) in one go — ESPN publishes the
  // full fantasy schedule up front, so there's no reason to sync week by week.
  // Scoring still comes from the ESPN play feed. Public ESPN needs no creds here.
  const sync = async () => {
    if (busy === 'sync') return;
    setBusy('sync');
    try {
      const r = l.provider === 'espn'
        ? await syncEspnSeason(l.league_id, stripProvider(l.sleeper_league_id), l.season)
        : await (async () => { let pairs = 0; for (let w = 1; w <= 14; w++) pairs += (await syncWeek(l.league_id, l.sleeper_league_id, w)).pairs; return { weeks: 14, pairs }; })();
      setBusy(`✓ ${r.weeks} weeks · ${r.pairs} matchups`); setTab('matchups'); await loadM();
    } catch (e) { setBusy(errMsg(e, 'sync failed')); }
  };
  // Re-pull the seats from Sleeper — for when a manager joins (or a team gets
  // renamed) after the import. Separate from `sync` above: syncWeek writes
  // matchups + pick pools and never touches league_membership, so the schedule
  // sync alone leaves a newly-joined manager invisible.
  const refreshMembers = async () => {
    if (busy === 'members') return;
    setBusy('members');
    try {
      const r = await syncMembers(l.league_id, l.sleeper_league_id);
      // Refresh never unseats anyone (0105's enrolled guard). Report the seats
      // that drifted out of sync instead, so the commissioner can decide —
      // ✕ unassign on the Members tab is the one-click fix.
      const drift = (await loadMembers()).filter((m) => m.drifted).length;
      setBusy(`✓ ${r.seats} seats refreshed${drift ? ` · ⚠ ${drift} no longer match Sleeper — see MEMBERS` : ''}`);
      reload();
    } catch (e) { setBusy(errMsg(e, 'member refresh failed')); }
  };
  const regen = async (which: 'invite' | 'commish') => {
    if (!confirm(`Regenerate the ${which} code? The old one stops working.`)) return;
    const r = await adminRegenCode(l.league_id, which);
    if (r.ok) reload();
  };

  /** Take the commissioner seat on a league you did not verify.
   *
   *  This does NOT need a new admin RPC, and deliberately doesn't get one. Since
   *  0039 the commish code IS the authorization — "whoever redeems it becomes
   *  the league's commissioner" — precisely so a league on a platform with no
   *  Sleeper-style ownership proof can still be handed to someone. An admin
   *  looking at this row already has the code on screen; the button just spends
   *  it, through the same redeem_commish every other commissioner goes through.
   *
   *  Adding an admin-only setter instead would create a second way to become
   *  commissioner, with its own rules to keep in step with the first. */
  const [takingCommish, setTakingCommish] = useState(false);
  const takeCommish = async () => {
    const warn = l.commissioner
      ? '\n\nThere is one commissioner seat per league, so this takes it from whoever holds it now.'
      : '';
    if (!confirm(`Make yourself commissioner of ${l.name}?${warn}`)) return;
    setTakingCommish(true);
    setBusy(null);
    try {
      const r = await redeemCommish(l.commish_code);
      if (r.ok) { setBusy('✓ you are the commissioner'); reload(); }
      else setBusy(r.error ?? 'could not take the commissioner seat');
    } catch (e) {
      setBusy(errMsg(e, 'could not take the commissioner seat'));
    } finally { setTakingCommish(false); }
  };

  // League crest. set_league_avatar (0066) allows admin OR the league's own
  // commissioner and doesn't care about provider, so imported Sleeper/ESPN
  // leagues get the same picker native ones have had. `crest` is an optimistic
  // overlay: undefined = "no local change, show the loaded value", so a reload
  // that returns the same URL doesn't flicker.
  const canCrest = admin || l.commissioner;
  const [crestOpen, setCrestOpen] = useState(false);
  const [crest, setCrest] = useState<string | null | undefined>(undefined);
  const crestUrl = crest !== undefined ? crest : l.avatar_url ?? null;
  const pickCrest = async (url: string | null) => {
    setCrestOpen(false);
    const prev = crestUrl;
    setCrest(url);
    const r = await setLeagueAvatar(l.league_id, url);
    if (!r.ok) { setCrest(prev); setBusy(r.error ?? 'crest update failed'); return; }
    reload();
  };

  const statusChip = (color: string): React.CSSProperties => ({ ...mono, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color, border: `1px solid ${color}`, borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap' });
  // ── The management map (v0.212.0) ────────────────────────────────────────
  // Grouped by WHEN a commissioner needs it, not by which subsystem owns it.
  // A flat strip of ~15 destinations told you nothing about sequence and
  // scrolled its tail out of view; these four groups answer "am I setting this
  // league up, running a week, keeping people engaged, or debugging?" —
  // rendered as a left rail on desktop and the same scrolling strip on mobile.
  const native = l.provider === 'native';
  const has = (id: LeagueTab) => panels?.[id] !== undefined;
  const navGroups: NavGroup<LeagueTab>[] = [
    {
      title: 'SET UP',
      items: [
        { id: 'overview', label: 'INVITE & ACCESS' },
        { id: 'mode', label: '🎮 MODE & SEASON' },
        // ROSTER = the lineup builder AND the roster rules that bound it
        // (v0.213.1, founder's call) — one page for "what shape is a team".
        // Shows for the admin console too, where only the rules half exists.
        ...(has('lineup') || native ? [{ id: 'lineup', label: '🧩 ROSTER' } as TabDef<LeagueTab>] : []),
        ...(has('scoring') ? [{ id: 'scoring', label: '⚖ SCORING' } as TabDef<LeagueTab>] : []),
        ...(native ? [{ id: 'waivers', label: 'WAIVERS & TRADES' } as TabDef<LeagueTab>] : []),
        // 📜 SALARY (0217–0220): the contract rulebook. Native only — and the
        // panel says how to make this a contract league when it isn't one yet.
        ...(native ? [{ id: 'salary', label: '📜 SALARY' } as TabDef<LeagueTab>] : []),
      ],
    },
    {
      title: 'RUN THE SEASON',
      items: [
        ...(native ? [{ id: 'draft', label: 'DRAFT' } as TabDef<LeagueTab>] : []),
        { id: 'members', label: '👥 SEATS' },   // the app has always called them SEATS; one name now
        ...(classic ? [] : [{ id: 'coin', label: '◈ DRIP COIN' } as TabDef<LeagueTab>]),
        { id: 'ready', label: 'PICKS' },
        { id: 'matchups', label: 'MATCHUPS' },
        ...(native ? [
          { id: 'rosters', label: 'ROSTERS' } as TabDef<LeagueTab>,
          { id: 'playoffs', label: '🏆 PLAYOFFS' } as TabDef<LeagueTab>,
          { id: 'dynasty', label: '🔁 NEXT SEASON' } as TabDef<LeagueTab>,
        ] : []),
      ],
    },
    {
      title: 'ENGAGE',
      items: [
        // The commissioner's kit (0141/0143/0144) — note, flags, scoring
        // adjustments. Any league kind; the same editors the ⚑ banner opens.
        { id: 'kit', label: '⚑ COMMISH KIT' },
        ...(has('activity') ? [{ id: 'activity', label: '👁 ACTIVITY' } as TabDef<LeagueTab>] : []),
        ...(has('buffs') && !classic ? [{ id: 'buffs', label: '◈ POWER-UPS' } as TabDef<LeagueTab>] : []),
      ],
    },
    {
      title: 'DIAGNOSE',
      items: [
        { id: 'audit', label: 'AUDIT' },
        ...(admin ? [{ id: 'admin', label: '⚙ ADMIN MODES' } as TabDef<LeagueTab>] : []),
      ],
    },
    // Its own group, last, with nothing else in it (0188) — and only where the
    // caller injected the panel, which is CommishDash. The admin console
    // injects nothing here on purpose: an admin already has
    // admin_delete_league (0044) on the leagues table, and a second door to
    // the same irreversible act on a screen full of other leagues' rows is
    // exactly where a misclick becomes somebody's season.
    ...(has('delete') ? [{
      title: 'DANGER',
      items: [{ id: 'delete', label: '✕ DELETE LEAGUE' } as TabDef<LeagueTab>],
    }] : []),
  ];

  return (
    <div style={card}>
      {watch && <AdminMatchupBoard matchupId={watch} onClose={() => setWatch(null)} />}
      {sheet && <FeedSheet matchupId={sheet.id} week={sheet.week} onClose={() => setSheet(null)} />}

      {crestOpen && <AvatarPicker title="Pick the league crest" onPick={pickCrest} onClose={() => setCrestOpen(false)} />}

      {/* League identity + the one always-on action: share the invite link.
          When collapsible (CommishDash with several leagues), the header row
          doubles as the expand/collapse toggle. */}
      <div onClick={collapsible ? () => setOpen((o) => !o) : undefined} role={collapsible ? 'button' : undefined} aria-expanded={collapsible ? open : undefined}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', cursor: collapsible ? 'pointer' : undefined }}>
        {/* The crest. Click-to-change for a commissioner (stopPropagation so it
            doesn't also collapse the card in the multi-league dash); for anyone
            else it stays a plain image, so the click still hits the toggle
            instead of dying on a disabled button. */}
        {canCrest ? (
          <button onClick={(e) => { e.stopPropagation(); setCrestOpen(true); }} title="change the league crest"
            style={{ background: 'none', border: 'none', padding: 0, lineHeight: 0, flexShrink: 0, cursor: 'pointer' }}>
            <Avatar name={l.name} accent="var(--warn)" src={crestUrl} size={34} />
          </button>
        ) : (
          <span style={{ lineHeight: 0, flexShrink: 0 }}><Avatar name={l.name} accent="var(--warn)" src={crestUrl} size={34} /></span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {collapsible && <span className="mono" style={{ ...mono, fontSize: 12.5, color: 'var(--dim)', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>}
            <span className="grotesk" style={{ fontSize: 16.5, fontWeight: 700, color: 'var(--text)' }}>{l.name}</span>
            <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)' }}>{l.season}</span>
            {l.provider && l.provider !== 'sleeper' && <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 4px', textTransform: 'uppercase' }}>{l.provider}</span>}
            {!!l.test_live_at && <span className="mono" style={statusChip('var(--warn)')}>🧪 LIVE TEST</span>}
            {!!l.preseason_at && <span className="mono" style={statusChip('var(--you)')}>🏈 PRESEASON</span>}
          </div>
          <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>{l.enrolled}/{l.rosters} enrolled · commish {l.commissioner ? '✓' : '—'}</div>
        </div>
        {/* Primary way to invite players — the join link (no code to type). The
            code chips live in the Setup tab as a fallback for manual entry. */}
        <button onClick={(e) => { e.stopPropagation(); copy(shareLink(l.invite_code)); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="mono" style={{ ...btn(true), flexShrink: 0 }}>{copied ? '✓ copied' : '⛓ invite link'}</button>
      </div>

      {open && <>

      {/* 'sync' / 'members' are in-progress sentinels shown on their own buttons. */}
      {busy && busy !== 'sync' && busy !== 'members' && <div className="mono" style={{ ...mono, fontSize: 12, color: busy.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 8 }}>{busy}</div>}

      {/* Desktop gets the grouped RAIL, narrow screens the grouped HUB — both
          driving the same `tab` state, so a destination behaves identically
          either way. (This said "narrow screens keep the scrolling strip" long
          after v0.259.0 replaced that strip with the hub below; the strip is
          what the app's own commissioner map was written NOT to copy, and it
          isn't here any more either.) */}
      {/* Narrow: the HUB is the nav (v0.259.0) and it STAYS (v0.296.3) — the
          map is the screen, a destination arrives over it. */}
      {!wide && <NavHub groups={navGroups} onSelect={(id) => { showTab(id); setSectionOpen(true); }} />}
      <PanelFrame
        wide={wide} open={sectionOpen} onClose={() => setSectionOpen(false)}
        title={navGroups.flatMap((g) => g.items).find((i) => i.id === tab)?.label ?? tab}
        subtitle={l.name}
        nav={wide ? <SideNav groups={navGroups} active={tab} onSelect={showTab} /> : null}
      >

      {/* Caller-injected panels (CommishDash's settings / activity / power-ups). */}
      {panels?.[tab] !== undefined && panels[tab]}

      {/* the commissioner's kit — note / player flags / scoring adjustments */}
      {tab === 'kit' && <CommishToolsPanel leagueId={l.league_id} />}

      {/* the in-app draft room, embedded (native leagues only) */}
      {tab === 'draft' && l.provider === 'native' && (
        <div style={{ marginTop: 12 }}>
          <DraftRoom leagueId={l.league_id} embedded onBack={() => {}} onTeam={() => {}} />
        </div>
      )}

      {/* commissioner roster tools + trade rulings (native leagues only) */}
      {tab === 'rosters' && l.provider === 'native' && <NativeRosterTools leagueId={l.league_id} />}

      {/* the endgame: standings, bracket, champion (native leagues only) */}
      {tab === 'playoffs' && l.provider === 'native' && <PlayoffPanel leagueId={l.league_id} />}

      {/* dynasty (0182): keepers + the rollover into next season */}
      {tab === 'dynasty' && l.provider === 'native' && <DynastyPanel leagueId={l.league_id} leagueName={l.name} />}

      {/* 📜 SALARY (0217–0220): cap, lengths, and the whole salary rulebook */}
      {tab === 'salary' && l.provider === 'native' && <SalaryPanel leagueId={l.league_id} />}

      {tab === 'overview' && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={subhead}>INVITE CODES</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <span style={chip}>commish&nbsp;<CodeChip v={l.commish_code} /></span>
                {admin && <button onClick={() => regen('commish')} className="mono" style={{ ...linkBtn, fontSize: 11.5 }} title="regenerate the commissioner code">↻ regen</button>}
                {admin && !mine && (
                  <button
                    onClick={takeCommish}
                    disabled={takingCommish}
                    className="mono"
                    style={{ ...linkBtn, fontSize: 11.5, color: 'var(--warn)' }}
                    title="Redeem this league's commissioner code as yourself — the same path every commissioner goes through"
                  >
                    {takingCommish ? '…' : l.commissioner ? '⚑ take commish seat' : '⚑ make me commish'}
                  </button>
                )}
                {/* Admin console only. In CommishDash every row is yours by
                    construction, so the chip would be on every card saying
                    nothing. */}
                {admin && mine && <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--you)' }}>⚑ you run this</span>}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <span style={chip}>invite&nbsp;<CodeChip v={l.invite_code} /></span>
                <button onClick={() => regen('invite')} className="mono" style={{ ...linkBtn, fontSize: 11.5 }} title="regenerate the invite code">↻ regen</button>
              </span>
            </div>
            <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>Players join with the invite link (button above) or by typing the invite code. The commish code claims league management.</div>
          </div>
        </div>
      )}

      {/* ROSTER RULES ride along under the lineup builder (v0.213.1) — the
          builder says what the starting spots are, these say how big the
          roster is and how it may change. Native leagues only; imported
          rosters are governed on their own platform. */}
      {tab === 'lineup' && l.provider === 'native' && (
        <div style={{ marginTop: 14, borderTop: panels?.lineup ? '1px solid var(--bd)' : 'none', paddingTop: panels?.lineup ? 14 : 0 }}>
          <div style={subhead}>ROSTER RULES</div>
          <RosterRulesEditor leagueId={l.league_id} />
        </div>
      )}

      {/* WAIVERS & TRADES — its own destination (v0.213.1). */}
      {tab === 'waivers' && l.provider === 'native' && (
        <div style={{ marginTop: 12 }}>
          <div style={subhead}>WAIVERS &amp; TRADES</div>
          <TransactionRulesEditor leagueId={l.league_id} />
        </div>
      )}

      {/* SEASON plumbing — schedule sync, member re-pull, preseason practice.
          Folded under MODE (v0.216.1): both answer "what is this league and
          how does its season run", and neither filled a page alone. */}
      {tab === 'mode' && (
        <div style={{ marginTop: 14, borderTop: panels?.mode ? '1px solid var(--bd)' : 'none', paddingTop: panels?.mode ? 14 : 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {l.provider !== 'native' && (
          <div>
            <div style={subhead}>SCHEDULE</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={sync} disabled={busy === 'sync'} className="mono" style={btn(true)} title="schedule every week's matchups">{busy === 'sync' ? 'scheduling…' : '⟳ sync season'}</button>
              <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>pulls the whole season's matchups + lineups from {l.provider === 'espn' ? 'ESPN' : 'Sleeper'}</span>
            </div>
          </div>
          )}
          {/* Seats are a separate pull from the schedule — someone who joins the
              Sleeper league after the import needs this, not "sync season". */}
          {(!l.provider || l.provider === 'sleeper') && (
          <div>
            <div style={subhead}>MEMBERS</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={refreshMembers} disabled={busy === 'members'} className="mono" style={btn(false)} title="re-pull each roster's owner + team name from Sleeper">{busy === 'members' ? 'refreshing…' : '⟳ refresh members'}</button>
              <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>re-pulls owners + team names from Sleeper; never un-enrolls anyone who already joined</span>
            </div>
          </div>
          )}
          {/* CONTINUITY (0185): redraft / keeper / dynasty — what carries into
              next season. Lives here per the founder ("put it in mode and
              season"); the 🔁 NEXT SEASON panel shows the consequences. */}
          {l.provider === 'native' && <ContinuityEditor leagueId={l.league_id} />}
          {/* Practice is a commissioner tool, not an admin errand — it's how a
              league's players get to rehearse the live loop before Week 1. */}
          <PreseasonPractice on={!!l.preseason_at} leagueId={l.league_id} season={l.season} admin={admin} reload={reload} />
        </div>
      )}

      {/* ADMIN MODES — super-admin only, and now behind its own destination so
          the destructive controls aren't one scroll below the invite codes. */}
      {tab === 'admin' && admin && (
        <div style={{ marginTop: 12 }}>
          <div style={subhead}>ADMIN MODES</div>
          <WeekLockControl leagueId={l.league_id} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <TestLiveToggle on={!!l.test_live_at} leagueId={l.league_id} reload={reload} />
            <CardThemeToggle leagueId={l.league_id} />
            <WindowPotToggle l={l} reload={reload} />
            <span style={{ flex: 1 }} />
            <DeleteLeague name={l.name} onDelete={async () => { const r = await adminDeleteLeague(l.league_id); if (r.ok) reload(); return r; }} />
          </div>
        </div>
      )}

      {tab === 'ready' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>week</span>
            <input value={week} onChange={(e) => setWeek(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={{ ...inp, width: 56, padding: '5px 6px', textAlign: 'center' }} />
            <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>on missed pick:</span>
            <select value={policy} onChange={(e) => changePolicy(e.target.value as LineupPolicy)} style={{ ...inp, padding: '4px 6px', fontSize: 13.5 }}>
              <option value="best_lineup">force best lineup (stay human)</option>
              <option value="ai">flip to AI 🤖</option>
              <option value="empty">leave empty</option>
            </select>
          </div>
          <PickReadinessTab leagueId={l.league_id} week={Number(week) || 1} admin={admin} />
        </div>
      )}
      {tab === 'members' && !members && <div style={{ marginTop: 12 }}><Muted text="Loading…" /></div>}
      {/* COIN (v0.213.1): the weekly allowance + one-off grants get their own
          destination. They rode on top of MEMBERS, which meant scrolling past
          an economy control every time you wanted to check who had joined. */}
      {tab === 'coin' && (
        <div style={{ marginTop: 12 }}>
          <WeeklyBudget l={l} onGranted={() => { loadMembers().catch(() => {}); }} />
          {/* Per-team balances + grants (v0.213.2). The commissioner's two coin
              questions are "who has what" and "give this team some" — both were
              only answerable by scrolling the MEMBERS list, one team at a time,
              with no way to compare. One table answers both. */}
          <div style={{ ...subhead, marginTop: 16 }}>DRIP COIN BY TEAM</div>
          {!members ? <Muted text="Loading…" /> : members.length === 0 ? <Muted text="No teams yet." /> : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--dim)' }}>
                  {members.length} teams · ◇ {Math.round(members.reduce((s, m) => s + (wallets[m.roster_id] ?? 0), 0)).toLocaleString()} in circulation
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...members]
                  // Richest first — the point of a table is comparison.
                  .sort((a, b) => (wallets[b.roster_id] ?? 0) - (wallets[a.roster_id] ?? 0))
                  .map((m) => (
                    <div key={m.roster_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 8px', background: 'var(--bg)', borderRadius: RADIUS }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: '1 1 150px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.team || `Roster ${m.roster_id}`}
                        {!m.enrolled && <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginLeft: 6 }}>not joined</span>}
                      </span>
                      <span className="mono" style={{ ...mono, fontSize: 14, fontWeight: 700, color: (wallets[m.roster_id] ?? 0) > 0 ? 'var(--you)' : 'var(--faint)', minWidth: 76, textAlign: 'right' }}>
                        ◇ {Math.round(wallets[m.roster_id] ?? 0).toLocaleString()}
                      </span>
                      <SeedCoin balance={wallets[m.roster_id] ?? 0} onSeed={(amt) => seedCoin(m.roster_id, amt)} hideBalance />
                    </div>
                  ))}
              </div>
              <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
                Grants are additive and immediate — a negative number claws coin back. The weekly allowance above pays every team automatically as each week's games arrive.
                <br />DRIP COIN is the in-game currency for power-ups and live buffs. It is NOT the FAAB waiver budget — that's a separate wallet under WAIVERS &amp; TRADES.
              </div>
            </>
          )}
        </div>
      )}
      {tab === 'members' && members && (
        <div style={{ marginTop: 12 }}>
          {(() => { const nj = members.filter((m) => !m.enrolled).length; const nd = members.filter((m) => m.drifted).length; return (<>
            <div className="mono" style={{ ...mono, fontSize: 12, color: nj ? 'var(--dim)' : 'var(--you)', marginBottom: 6 }}>
              {members.length - nj}/{members.length} joined{nj ? ` · ${nj} not yet` : ''}
            </div>
            {/* THE WAITING-ROOM DOOR (v0.326.0, founder: "can we have a commish
                option to close the waiting room. Just 'League Full'"). Lives on
                SEATS because that is where "is there room" is already being
                answered, and it only means anything once nj === 0. */}
            <WaitlistDoor l={l} seatsOpen={nj} joiners={joiners.length} />
            {/* Drift is advisory — refresh never unseats anyone, so say what to do. */}
            {!!nd && (
              <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--warn)', marginBottom: 6, lineHeight: 1.5 }}>
                ⚠ {nd} seat{nd > 1 ? 's' : ''} no longer match{nd > 1 ? '' : 'es'} Sleeper — the account holding {nd > 1 ? 'them isn’t' : 'it isn’t'} the roster’s owner there any more, so the real owner can’t claim it. ✕ unassign frees {nd > 1 ? 'them' : 'it'}.
              </div>
            )}
          </>); })()}
          {members.map((m) => (
            <div key={m.roster_id} style={{ padding: '6px 0', borderTop: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {m.avatar && <img src={m.avatar} alt="" width={24} height={24} style={{ borderRadius: 5, flexShrink: 0 }} />}
                  <div style={{ minWidth: 0 }}>
                    {/* team_name comes from the platform, so on a drifted row it
                        names the CURRENT Sleeper owner while the line below names
                        whoever still holds the Drip seat — two different people.
                        Say "seat held by" there so the row can't be misread as one
                        person who is somehow mismatched with themselves. */}
                    <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{m.team}</div>
                    <div className="mono" style={{ ...mono, fontSize: 11.5, color: m.drifted ? 'var(--warn)' : 'var(--faint)' }}>
                      {m.enrolled
                        ? m.drifted
                          ? `seat held by ${m.sleeper ? `@${m.sleeper}` : m.email ?? 'another account'}${m.sleeper && m.email ? ` · ${m.email}` : ''}`
                          : (m.email ?? m.sleeper ?? 'enrolled')
                        : m.claim_email ? `pending · ${m.claim_email}` : 'not assigned'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {m.email && <SendLink email={m.email} />}
                  <button onClick={() => toggleMemberAi(m.roster_id, m.controller)} className="mono" title={m.controller === 'ai' ? 'hand back to manager' : 'set team to AI auto-pilot'}
                    style={{ fontSize: 11, fontWeight: 700, color: m.controller === 'ai' ? 'var(--on-accent)' : 'var(--dim)', background: m.controller === 'ai' ? 'var(--you)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}>🤖 {m.controller === 'ai' ? 'AI' : 'off'}</button>
                  {m.drifted && <span className="mono" title="Not the Sleeper owner of this roster any more — they left the league, it changed hands, or they unlinked their account. ✕ unassign frees the seat." style={{ fontSize: 11, fontWeight: 700, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>⚠ MISMATCH</span>}
                  <span className="mono" style={{ fontSize: 11, color: m.enrolled ? 'var(--you)' : m.claim_email ? 'var(--dim)' : 'var(--faint)', border: `1px solid ${m.enrolled ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '2px 6px' }}>{m.enrolled ? 'JOINED' : m.claim_email ? 'PENDING' : '—'}</span>
                </div>
              </div>
              {/* Coin left this row in v0.214.0 — balances and grants live on
                  the ◈ COIN tab, where every team is comparable side by side.
                  MEMBERS is about seats: who holds one, who hasn't claimed. */}
              <AssignRoster initial={m.email ?? m.claim_email ?? ''} seated={m.enrolled || !!m.claim_email} stillOnPlatform={!!m.owner} joiners={joiners} onAssign={(a) => assign(m.roster_id, a)} onClaimSelf={() => claimSelf(m.roster_id)} />
            </div>
          ))}
          <CoManagerPanel leagueId={l.league_id} members={members} />
        </div>
      )}
      {/* K/DST fill (v0.216.2) — a setup decision about what the league
          rosters, so it lives with MODE & SEASON rather than under DIAGNOSE. */}
      {tab === 'mode' && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
          <div style={subhead}>K / D-ST FILL</div>
          {!kdst ? <Muted text="Loading…" /> : (
            <>
              <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 8 }}>
                {kdst.needs_k || kdst.needs_def
                  ? `This league doesn't roster ${[kdst.needs_k && 'kickers', kdst.needs_def && 'defenses'].filter(Boolean).join(' or ')} — fill them so the Banker / Suppress metrics are playable. Takes effect on the next sync.`
                  : 'This league rosters both K and DEF — no fill needed.'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>fill mode:</span>
                <select value={kdst.mode} onChange={(e) => changeKdstMode(e.target.value as KdstMode)} style={{ ...inp, padding: '4px 6px', fontSize: 13.5 }}>
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
                  <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginBottom: 4 }}>Assign each team a K / DEF (season-long; auto-substituted on its bye week). Blank = random not-on-bye. Teams already taken are marked “• taken”; a ⚠ flags a duplicate (allowed, but each NFL K/DEF is usually unique).</div>
                  {kdst.teams.map((t) => {
                    const dupK = !!t.k_slug && (kCount.get(t.k_slug) ?? 0) > 1;
                    const dupDst = !!t.dst_slug && (dstCount.get(t.dst_slug) ?? 0) > 1;
                    return (
                    <div key={t.roster_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                      <span style={{ fontSize: 13.5, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
      {tab === 'matchups' && !matchups && <div style={{ marginTop: 12 }}><Muted text="Loading…" /></div>}
      {tab === 'matchups' && matchups && (
        <div style={{ marginTop: 12 }}>
          <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.6, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '7px 9px', marginBottom: 8 }}>
            Each matchup auto-advances at the real kickoff, or set it manually:
            {' '}<b style={{ color: 'var(--dim)' }}>Open</b> (picks open, pre-kickoff) →
            {' '}<b style={{ color: 'var(--you)' }}>Lock</b> (kickoff — seals both lineups, scoring starts) →
            {' '}<b style={{ color: 'var(--dim)' }}>Final</b>.
            <br />▦ this matchup's live board · ≣ replay its play-by-play (once it kicks off){admin ? ' · ▶ resolve from baked data · ↺ reset' : ''}.
          </div>
          {admin && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>from 2025 wk</span>
              <input value={srcWeek} onChange={(e) => setSrcWeek(e.target.value.replace(/\D/g, ''))} style={{ ...inp, width: 40, padding: '4px 5px', textAlign: 'center' }} />
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
                <span className="mono" style={{ ...mono, fontSize: 13, color: 'var(--text)' }}>W{m.week} · {teamName(m.home_roster_id)} v {teamName(m.away_roster_id)} · <span style={{ color: 'var(--you)' }}>{m.status}</span>{m.home_final != null && <span style={{ color: 'var(--faint)' }}> · {m.home_final}-{m.away_final}</span>}{(m.home_coin != null || m.away_coin != null) && <span style={{ color: 'var(--faint)' }}> · ◇ {m.home_coin ?? 0}/{m.away_coin ?? 0}</span>}{m.status === 'scheduled' && (m.lock_at
                  ? <span style={{ color: 'var(--faint)' }} title="The worker seals lineups and starts scoring automatically at kickoff."> · 🔒 auto-locks {fmtLock(m.lock_at)}</span>
                  : <span style={{ color: 'var(--warn)' }} title="No kickoff time yet. The worker backfills it from the live NFL schedule once the week is current, and it auto-locks then. Until it appears you can set Lock manually."> · ⏳ kickoff pending — auto-locks once set</span>)}</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button style={btn(m.status === 'scheduled')} onClick={() => set(m.id, 'scheduled')} title="Picks open — pre-kickoff">Open</button>
                  <button style={btn(m.status === 'live')} onClick={() => set(m.id, 'live', true)} title="Lock & score — seals both lineups at kickoff, scoring starts">Lock</button>
                  <button style={btn(m.status === 'final')} onClick={() => set(m.id, 'final')} title="Final — week complete">Final</button>
                  <button style={btn(false)} onClick={() => setWatch(m.id)} title={`this matchup's live board — W${m.week} ${teamName(m.home_roster_id)} v ${teamName(m.away_roster_id)}`}><GameIcon name={UI_ART.liveboard} emoji="▦" size="1.4em" /></button>
                  <button style={{ ...btn(false), opacity: m.status === 'scheduled' ? 0.4 : 1, cursor: m.status === 'scheduled' ? 'not-allowed' : 'pointer' }}
                    onClick={() => setSheet({ id: m.id, week: m.week })} disabled={m.status === 'scheduled'}
                    title={m.status === 'scheduled' ? 'replay unlocks once this matchup kicks off' : `replay this matchup — week ${m.week} play-by-play`}
                    >≣</button>
                  {admin && <button style={btn(false)} onClick={() => resolve(m.id)} title="run real engine on baked 2025 data">▶</button>}
                  {admin && <button style={btn(false)} onClick={() => resetOne(m.id)} title="reset this matchup → scheduled, scores cleared">↺</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'audit' && (
        <div style={{ marginTop: 12 }}>
          {audit === null ? <Muted text="Loading…" /> : audit.length === 0 ? <Muted text="No matchup activity yet." /> : audit.map((a, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid var(--bd)', gap: 8 }}>
              <span className="mono" style={{ ...mono, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.op} <span style={{ color: 'var(--dim)' }}>{a.table}</span>{a.detail && <span style={{ color: 'var(--you)' }}> · {a.detail}</span>}{a.actor && <span style={{ color: 'var(--faint)' }}> · {a.actor}</span>}</span>
              <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      </PanelFrame>
      </>}
    </div>
  );
}

/** The destination's FRAME. Desktop keeps the rail beside a bordered panel;
 *  a phone gets the app's answer — the map stays put and the destination
 *  arrives as a popup over it (v0.296.3, founder: "stick with the pop up for
 *  all the items where we have that in the app").
 *
 *  Narrow and closed renders NOTHING, so a destination's loaders don't run
 *  until you actually open it. */
function PanelFrame({ wide, open, title, subtitle, onClose, nav, children }: {
  wide: boolean; open: boolean; title: string; subtitle?: string;
  onClose: () => void; nav: React.ReactNode; children: React.ReactNode;
}) {
  if (wide) {
    return (
      <div style={{ display: 'flex', gap: 18, marginTop: 12, alignItems: 'flex-start' }}>
        {nav}
        {/* OVERFLOW-SAFE (v0.259.0): these panels were designed at desktop
            width, and a wide grid pinched into a phone used to push the whole
            card off the screen edge. Wide content scrolls inside its own box;
            the page never scrolls sideways. The Sheet's body does the same job
            on the narrow path. */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--bd)', paddingLeft: 18 }}>{children}</div>
      </div>
    );
  }
  if (!open) return null;
  return <Sheet title={title} subtitle={subtitle} max={760} onClose={onClose}>{children}</Sheet>;
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
          <span className="mono" style={{ ...mono, fontSize: 13, color: 'var(--text)' }}>{o.sleeper_user_id} <span style={{ color: 'var(--faint)' }}>{o.note}</span></span>
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
  const [platform, setPlatform] = useState<'sleeper' | 'espn'>('sleeper');
  const [sid, setSid] = useState('');
  const [season, setSeason] = useState('2026');
  const [swid, setSwid] = useState('');
  const [s2, setS2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const espn = platform === 'espn';
  const go = async () => {
    if (!sid.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      if (espn) { const r = await importEspnSeason(sid.trim(), season.trim() || '2026', { swid: swid.trim() || undefined, s2: s2.trim() || undefined }); setMsg(`✓ imported · ${r.weeks} weeks scheduled`); }
      else { await importLeague(sid.trim(), season.trim() || '2026'); setMsg('✓ imported'); }
      setSid(''); reload();
    } catch (e) { setMsg(errMsg(e, 'import failed')); }
    finally { setBusy(false); }
  };
  const pill = (p: 'sleeper' | 'espn', label: string) => (
    <button onClick={() => { setPlatform(p); setMsg(null); }} className="mono" style={btn(platform === p)}>{label}</button>
  );
  return (
    <div style={card}>
      <div style={h}>IMPORT A LEAGUE</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>{pill('sleeper', 'Sleeper')}{pill('espn', 'ESPN')}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={sid} onChange={(e) => setSid(e.target.value)} placeholder={espn ? 'ESPN league id' : 'Sleeper league id'} style={{ ...inp, flex: 1, minWidth: 0 }} />
        <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="season" style={{ ...inp, width: 68 }} />
        <button onClick={go} disabled={busy} className="mono" style={btn(true)}>{busy ? '…' : 'import'}</button>
      </div>
      {espn && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={swid} onChange={(e) => setSwid(e.target.value)} placeholder="SWID (private only)" style={{ ...inp, flex: 1, minWidth: 0 }} />
          <input value={s2} onChange={(e) => setS2(e.target.value)} placeholder="espn_s2 (private only)" style={{ ...inp, flex: 1, minWidth: 0 }} />
        </div>
      )}
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 8 }}>{msg}</div>}
      <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 8 }}>
        {espn
          ? 'Pulls the ESPN league + rosters + schedule. Public leagues need no cookies; private ones take SWID + espn_s2. Enrollment is admin-mapped (ESPN has no public user id). Then “sync week” for matchups + pick pools. Live scoring runs off the ESPN play feed.'
          : 'Pulls league + rosters from Sleeper, generates the commish/invite codes, and enrolls any managers already signed in. Then “sync week” per league for matchups + lineups.'}
      </div>
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
          <span className="mono" style={{ ...mono, fontSize: 13.5, color: 'var(--text)' }}>{a.email}</span>
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

function CodeRequests({ onPending }: { onPending?: (n: number) => void }) {
  const [rows, setRows] = useState<CodeRequest[] | null>(null);
  const [leagues, setLeagues] = useState<AdminLeague[]>([]);
  const [showHandled, setShowHandled] = useState(false);
  const load = async () => { try { setRows(await adminCodeRequests()); } catch { setRows([]); } };
  useEffect(() => { load(); }, []);
  // Keep the parent's Requests-tab badge in sync as requests load / get handled.
  useEffect(() => { if (rows) onPending?.(rows.filter((r) => !r.handled).length); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rows]);
  // Existing leagues' invite codes feed the per-request "send code" picker.
  useEffect(() => { adminOverview().then(setLeagues).catch(() => setLeagues([])); }, []);
  const reloadLeagues = async () => { const l = await adminOverview().catch(() => [] as AdminLeague[]); setLeagues(l); return l; };
  const toggle = async (id: string, handled: boolean) => { await adminSetCodeRequestHandled(id, handled); load(); };
  const pending = rows?.filter((r) => !r.handled).length ?? 0;
  const hasHandled = rows?.some((r) => r.handled) ?? false;
  const visible = (rows ?? []).filter((r) => showHandled || !r.handled);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <div style={{ ...h, marginBottom: 0 }}>CODE REQUESTS{pending ? ` · ${pending} NEW` : ''}</div>
        {hasHandled && <button onClick={() => setShowHandled((s) => !s)} className="mono" style={linkBtn}>{showHandled ? 'hide handled' : 'show handled'}</button>}
      </div>
      {rows === null ? <Muted text="Loading…" />
        : visible.length === 0 ? <Muted text={pending === 0 && !rows.length ? 'No requests yet.' : 'All caught up.'} />
        : visible.map((r) => <CodeRequestRow key={r.id} r={r} leagues={leagues} onToggle={toggle} reloadLeagues={reloadLeagues} reload={load} />)}
    </div>
  );
}

function CodeRequestRow({ r, leagues, onToggle, reloadLeagues, reload }: { r: CodeRequest; leagues: AdminLeague[]; onToggle: (id: string, handled: boolean) => void; reloadLeagues: () => Promise<AdminLeague[]>; reload: () => Promise<void> }) {
  const [leagueId, setLeagueId] = useState(leagues[0]?.league_id ?? '');
  const [manual, setManual] = useState('');
  // Default to commissioner: requesters are usually league runners, who need the
  // commish code + claim flow, then invite their own league mates.
  const [kind, setKind] = useState<'commish' | 'player'>('commish');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Fixing the address a lead typed for themselves. The request form is anonymous
  // and unverified, so a typo (or a request that came in with only a platform
  // username) leaves the invite with nowhere to go — this is the one place it can
  // be corrected before "send invite" mails into the void.
  const [editEmail, setEditEmail] = useState(false);
  const [draft, setDraft] = useState(r.email ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  // The request's platform ('sleeper' | 'espn' | …) and whether we can import it here.
  const platform = (r.sleeper_username ?? '').toLowerCase();
  const refId = r.league_ref ? extractLeagueId(r.league_ref, platform) : '';
  // The already-imported league that matches this request's ref, if any.
  const ownLeague = r.league_ref ? leagues.find((l) => l.sleeper_league_id === refId || l.sleeper_league_id === `espn-${refId}`) : undefined;
  const importable = !!r.league_ref && (platform === 'sleeper' || platform === 'espn' || platform === '');
  // Prefer this request's own league in the picker once it's imported; else first.
  useEffect(() => { setLeagueId((id) => ownLeague?.league_id || id || leagues[0]?.league_id || ''); /* eslint-disable-next-line */ }, [leagues]);
  const doImport = async () => {
    if (!r.league_ref || importing) return;
    setImporting(true); setErr(null);
    try {
      const ref = extractLeagueId(r.league_ref, platform);
      const res = platform === 'espn' ? await importEspnSeason(ref, '2026') : await importLeague(ref, '2026');
      const newId = typeof res === 'string' ? res : res.leagueId;
      await reloadLeagues();
      setLeagueId(newId); setKind('commish'); setSent(false);
    } catch (e) { setErr(errMsg(e, 'import failed')); }
    finally { setImporting(false); }
  };

  const startEdit = () => { setDraft(r.email ?? ''); setEditEmail(true); setErr(null); };
  const suggestion = editEmail ? emailTypoFix(draft.trim()) : null;
  const saveEmail = async () => {
    const next = draft.trim();
    if (savingEmail) return;
    if (next === (r.email ?? '')) { setEditEmail(false); setErr(null); return; }
    if (!EMAIL_RE.test(next)) { setErr('That doesn’t look like an email address.'); return; }
    setSavingEmail(true); setErr(null);
    try {
      const res = await adminSetCodeRequestEmail(r.id, next);
      if (!res.ok) { setErr(res.error ?? 'Could not save that email.'); return; }
      setEditEmail(false);
      setSent(false); // a new address means the invite hasn't gone anywhere yet
      await reload();
    } catch (e) { setErr(errMsg(e, 'Could not save that email.')); }
    finally { setSavingEmail(false); }
  };

  const league = leagues.find((l) => l.league_id === leagueId);
  const code = league ? (kind === 'commish' ? league.commish_code : league.invite_code) : manual.trim();
  const link = code ? (kind === 'commish' ? commishLink(code) : shareLink(code)) : '';
  const canSend = !!code && !!r.email;
  const reset = () => { setSent(false); setErr(null); };

  const send = async () => {
    if (!canSend || sending) return;
    setSending(true); setErr(null);
    const res = await sendInvite({ to: r.email!, code, link, leagueName: r.league_name ?? undefined, kind });
    setSending(false);
    if (res.ok) { setSent(true); if (!r.handled) onToggle(r.id, true); }
    else setErr(res.error ?? 'Send failed.');
  };
  const kindBtn = (k: 'commish' | 'player', lbl: string) => (
    <button onClick={() => { setKind(k); reset(); }} className="mono" style={{ ...btn(kind === k), fontSize: 11.5 }}>{lbl}</button>
  );

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--bd)', opacity: r.handled ? 0.5 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          {editEmail ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <input value={draft} onChange={(e) => { setDraft(e.target.value); setErr(null); }} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void saveEmail(); if (e.key === 'Escape') { setEditEmail(false); setErr(null); } }}
                placeholder="email@example.com" className="mono" style={{ ...inp, fontSize: 13.5, padding: '5px 6px', width: 210, maxWidth: '100%' }} />
              <button onClick={() => void saveEmail()} disabled={savingEmail} className="mono" style={{ ...btn(true), opacity: savingEmail ? 0.6 : 1 }}>{savingEmail ? 'saving…' : 'save'}</button>
              <button onClick={() => { setEditEmail(false); setErr(null); }} className="mono" style={linkBtn}>cancel</button>
              {suggestion && (
                <button onClick={() => setDraft(suggestion)} className="mono" style={{ ...linkBtn, fontSize: 12, color: 'var(--you)' }} title="Use this instead">
                  did you mean {suggestion}?
                </button>
              )}
              {err && <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--opp, #e5484d)' }}>{err}</span>}
            </div>
          ) : (
            <div style={{ fontSize: 13.5, color: 'var(--text)' }}>
              {r.email
                ? <span className="mono" style={{ ...mono, cursor: 'pointer' }} onClick={() => copy(r.email!)} title="copy">{r.email}</span>
                : <span className="mono" style={{ ...mono, color: 'var(--faint)' }}>no email</span>}
              <button onClick={startEdit} className="mono" style={{ ...linkBtn, fontSize: 12, marginLeft: 6 }}
                title={r.email ? 'Fix a mistyped address — the invite goes wherever this says' : 'Add an address so the invite can be sent'}>
                {r.email ? '✎ fix' : '+ add email'}
              </button>
              {r.email && emailTypoFix(r.email) && (
                <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--warn)' }} title={`Looks like a typo for ${emailTypoFix(r.email)}`}> · likely typo</span>
              )}
              {r.sleeper_username && <span className="mono" style={{ ...mono, fontSize: 12.5, color: 'var(--faint)' }}> · {r.sleeper_username}</span>}
            </div>
          )}
          {r.league_name && <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>{r.league_name}</div>}
          {r.league_ref && <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--you)', marginTop: 2, cursor: 'pointer', wordBreak: 'break-all' }} onClick={() => copy(r.league_ref!)} title="copy — paste into Import">⛓ {r.league_ref}</div>}
          {r.note && <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 2, lineHeight: 1.4 }}>{r.note}</div>}
          <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{new Date(r.created_at).toLocaleString()}</div>
        </div>
        <button onClick={() => onToggle(r.id, !r.handled)} className="mono" style={btn(r.handled)}>{r.handled ? 'handled' : 'mark done'}</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {importable && !ownLeague && (
          <button onClick={doImport} disabled={importing} className="mono" style={{ ...btn(true), opacity: importing ? 0.6 : 1 }}
            title={`Import this ${platform || 'Sleeper'} league (${refId}) so you can send its commish code`}>
            {importing ? 'importing…' : '⤓ import this league'}
          </button>
        )}
        {ownLeague && <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--you)' }}>✓ imported</span>}
        <div style={{ display: 'flex', gap: 4 }} title="Commissioner invite (claims the league) or player join invite">
          {kindBtn('commish', 'Commish')}
          {kindBtn('player', 'Player')}
        </div>
        {leagues.length > 0 ? (
          <select value={leagueId} onChange={(e) => { setLeagueId(e.target.value); reset(); }} className="mono" style={{ ...inp, fontSize: 12.5, padding: '5px 6px', maxWidth: 220 }} title={`${kind === 'commish' ? 'Commissioner' : 'Invite'} code to send`}>
            {leagues.map((l) => <option key={l.league_id} value={l.league_id}>{l.name} · {kind === 'commish' ? l.commish_code : l.invite_code}</option>)}
          </select>
        ) : (
          <input value={manual} onChange={(e) => { setManual(e.target.value); reset(); }} placeholder={kind === 'commish' ? 'commish code' : 'invite code'} className="mono" style={{ ...inp, fontSize: 12.5, padding: '5px 6px', width: 130 }} />
        )}
        <button onClick={send} disabled={!canSend || sending} className="mono"
          style={{ ...btn(sent), opacity: canSend ? 1 : 0.4, cursor: canSend && !sending ? 'pointer' : 'default' }}
          title={!r.email ? 'No email on this request — add one with “+ add email” above' : !code ? 'Pick or enter a code first' : `Email the ${kind} invite to ${r.email}`}>
          {sending ? 'sending…' : sent ? '✓ sent' : `✉ send ${kind} invite`}
        </button>
        <button onClick={() => { if (link) { copy(link); setCopied(true); setTimeout(() => setCopied(false), 1200); } }} disabled={!code} className="mono" style={{ ...btn(false), opacity: code ? 1 : 0.4, cursor: code ? 'pointer' : 'default' }} title="Copy the invite link">{copied ? '✓ link copied' : '⛓ copy link'}</button>
        {err && !editEmail && <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--opp, #e5484d)' }}>{err}</span>}
      </div>
    </div>
  );
}

// Admin/commish-map a roster to a person by email. Enrolls now if they've signed
// in, otherwise records a pending claim that auto-links on their next sign-in.
/** "LEAGUE FULL" — the commissioner's door on the waiting room (v0.326.0).
 *
 *  Founder: "Can we have a commish option to close the waiting room. Just
 *  'League Full'."
 *
 *  The default (0125) is that a full native league WAITLISTS a joiner rather
 *  than turning them away, and the commissioner deals them in from this very
 *  screen. That is right for a league still filling up and wrong for one that
 *  is done: a queue nobody will ever work through is a room full of people who
 *  think they might still get in.
 *
 *  TWO THINGS THIS CONTROL HAS TO BE HONEST ABOUT, because both are easy to
 *  assume wrongly from the words "close the waiting room":
 *   • it does NOT close the league. With a seat free, an invite link still
 *     seats the next arrival immediately — which is why the copy below leads
 *     with the seat count rather than the switch.
 *   • it does NOT evict. Anyone already queued stays, and stays assignable;
 *     the RPC returns that count so this can say so instead of implying the
 *     list was cleared. */
function WaitlistDoor({ l, seatsOpen, joiners }: { l: AdminLeague; seatsOpen: number; joiners: number }) {
  // The flag is not on AdminLeague, so this owns its own state: unknown until
  // the first toggle, and rendered from the league row when it is present.
  const [open, setOpen] = useState<boolean | null>((l as { waitlist_open?: boolean }).waitlist_open ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (l.provider !== 'native') return null;   // only native leagues have a waiting room
  const shut = open === false;
  const flip = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueWaitlist(l.league_id, shut);
      if (!r.ok) { setNote(friendlyError(r.error ?? 'could not change that')); return; }
      setOpen(!!r.waitlist_open);
      setNote(r.waitlist_open
        ? 'Waiting room open — a full league queues new joiners for you.'
        : `Closed. New joiners see “League Full”.${r.waiting ? ` The ${r.waiting} already waiting are still here and still assignable.` : ''}`);
    } catch (e) { setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginBottom: 8, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>WAITING ROOM</span>
        <span className="mono" style={{ ...mono, fontSize: 11.5, fontWeight: 700, color: shut ? 'var(--warn)' : 'var(--you)' }}>
          {open === null ? '—' : shut ? 'CLOSED · “League Full”' : 'OPEN'}
        </span>
        <button onClick={flip} disabled={busy} className="mono" style={{ ...btn(false), opacity: busy ? 0.5 : 1 }}>
          {shut ? 'reopen' : 'close · say “League Full”'}
        </button>
        {joiners > 0 && <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--dim)' }}>{joiners} waiting</span>}
      </div>
      <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginTop: 5, lineHeight: 1.5 }}>
        {seatsOpen > 0
          ? `${seatsOpen} seat${seatsOpen > 1 ? 's' : ''} still open — an invite link seats the next arrival straight away, whatever this says.`
          : 'No seats left, so this is what a new joiner meets: a queue, or a closed door.'}
      </div>
      {note && <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

function AssignRoster({ initial, seated, stillOnPlatform, joiners = [], onAssign, onClaimSelf }: { initial: string; seated?: boolean; stillOnPlatform?: boolean; joiners?: LeagueJoiner[]; onAssign: (a: { email?: string; appUserId?: string }) => Promise<{ ok: boolean; error?: string; status?: string }>; onClaimSelf?: () => Promise<{ ok: boolean; error?: string; status?: string }> }) {
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const result = (r: { ok: boolean; error?: string; status?: string }) =>
    setMsg(!r.ok ? (r.error ?? 'failed') : r.status === 'pending' ? '✓ pending — links on sign-in' : r.status === 'cleared' ? '✓ cleared' : '✓ enrolled');
  const go = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    const r = await onAssign({ email: email.trim() });
    setBusy(false); result(r);
  };
  // Free the seat: an empty email is admin_assign_roster's clear branch (0042) —
  // app_user_id, enrolled and claim_email all drop, and the team is claimable
  // again. The extra warning matters: while this roster still has an owner on
  // the source platform, "refresh members" re-joins them by sleeper_user_id and
  // re-seats the person, because admin_upsert_memberships only moves `enrolled`
  // false→true. Removing them upstream is what makes the clear stick.
  const unassign = async () => {
    if (busy) return;
    if (!confirm(stillOnPlatform
      ? 'Unassign this team? It becomes claimable again — but this roster still has an owner on the source platform, so “refresh members” will re-seat them. Remove them there first to make it stick.'
      : 'Unassign this team? The manager loses their seat and it becomes claimable again.')) return;
    setBusy(true); setMsg(null);
    const r = await onAssign({ email: '' });
    setBusy(false); result(r);
    if (r.ok) setEmail('');
  };
  // Commissioner claims this team for themselves (to play, not just manage).
  const claim = async () => {
    if (busy || !onClaimSelf) return;
    setBusy(true); setMsg(null);
    const r = await onClaimSelf();
    setBusy(false); setMsg(!r.ok ? (r.error ?? 'failed') : '✓ claimed — this team is yours');
  };
  // Pick a player who already tapped the invite link (join pool) — no typing.
  const pick = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const appUserId = e.target.value;
    if (busy || !appUserId) return;
    const j = joiners.find((x) => x.app_user_id === appUserId);
    setBusy(true); setMsg(null);
    const r = await onAssign({ appUserId, email: j?.email ?? undefined });
    setBusy(false); result(r);
    if (r.ok && j?.email) setEmail(j.email);
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
      {joiners.length > 0 && (
        <select value="" onChange={pick} disabled={busy} className="mono"
          title="assign a player who joined the pool" style={{ ...inp, fontSize: 12.5, padding: '5px 7px', maxWidth: 160 }}>
          <option value="">joined players…</option>
          {joiners.map((j) => <option key={j.app_user_id} value={j.app_user_id}>{j.email ?? j.app_user_id.slice(0, 8)}</option>)}
        </select>
      )}
      <input value={email} onChange={(e) => { setEmail(e.target.value); setMsg(null); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="assign to email…" type="email" spellCheck={false} autoCapitalize="none" autoCorrect="off"
        style={{ ...inp, fontSize: 12.5, padding: '5px 7px', flex: 1, minWidth: 0 }} />
      <button onClick={go} disabled={busy} className="mono" style={{ ...btn(false), opacity: busy ? 0.6 : 1 }}>{busy ? '…' : 'assign'}</button>
      {onClaimSelf && <button onClick={claim} disabled={busy} className="mono" title="claim this team for yourself" style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}>＋ me</button>}
      {seated && <button onClick={unassign} disabled={busy} className="mono" title="free this seat — the manager loses the team and it becomes claimable again" style={{ ...btn(false), color: 'var(--opp)', opacity: busy ? 0.6 : 1 }}>✕ unassign</button>}
      {msg && <span className="mono" style={{ ...mono, fontSize: 11.5, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp, #e5484d)' }}>{msg}</span>}
    </div>
  );
}

// Commissioner grants drip coin to a team. Real leagues start at 0; this is how a
// commish stakes players (or claws back). Additive; the balance shows live.
function SeedCoin({ balance, onSeed, hideBalance = false }: {
  balance: number; onSeed: (amt: number) => Promise<{ ok: boolean; error?: string; balance?: number }>;
  /** The COIN table (v0.213.2) prints the balance in its own column, so the
   *  inline ◇ chip would say it twice. */
  hideBalance?: boolean;
}) {
  const [amt, setAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    const n = Number(amt);
    if (busy || !n) return;
    setBusy(true); setMsg(null);
    const r = await onSeed(n);
    setBusy(false);
    if (r.ok) { setAmt(''); setMsg(`✓ balance ${Math.round(r.balance ?? balance)}`); } else setMsg(r.error ?? 'failed');
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: hideBalance ? 0 : 6 }}>
      {!hideBalance && <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>◇ {Math.round(balance)}</span>}
      <input value={amt} onChange={(e) => { setAmt(e.target.value.replace(/[^\d-]/g, '')); setMsg(null); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="grant drip…" inputMode="numeric" style={{ ...inp, fontSize: 12.5, padding: '5px 7px', width: 104 }} />
      <button onClick={go} disabled={busy || !amt} className="mono" style={{ ...btn(false), opacity: busy || !amt ? 0.6 : 1 }}>{busy ? '…' : 'grant'}</button>
      {msg && <span className="mono" style={{ ...mono, fontSize: 11.5, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp, #e5484d)' }}>{msg}</span>}
    </div>
  );
}

// Co-managers (0125): several humans steering one seat. The grant lets them
// write the OWNER'S sealed picks (one team, one lineup, more thumbs) and opens
// every owns_roster-gated tool — rename, avatar, adds/drops. Power-up
// inventories stay personal.
function CoManagerPanel({ leagueId, members }: { leagueId: string; members: AdminMember[] }) {
  const [mgrs, setMgrs] = useState<TeamManagerRow[]>([]);
  const [seat, setSeat] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => teamManagers(leagueId).then(setMgrs).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leagueId]);
  const seated = members.filter((m) => m.enrolled);
  const teamOf = (rid: number) => members.find((m) => m.roster_id === rid)?.team ?? `Roster ${rid}`;
  const add = async () => {
    const rid = parseInt(seat, 10);
    if (busy || !rid || !email.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetManager(leagueId, rid, { email: email.trim() });
      if (r.ok) { setMsg('✓ co-manager added'); setEmail(''); } else setMsg(r.error ?? 'failed');
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  const remove = async (g: TeamManagerRow) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetManager(leagueId, g.roster_id, { appUserId: g.app_user_id, remove: true });
      setMsg(r.ok ? '✓ removed' : r.error ?? 'failed');
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); load(); }
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div style={subhead}>CO-MANAGERS — ONE TEAM, MORE THUMBS</div>
      {mgrs.length === 0 && <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)' }}>None yet. A co-manager sets the same lineup as the seat's owner — for shared teams, or extra joiners when the league is past its seats.</div>}
      {mgrs.map((g) => (
        <div key={`${g.roster_id}-${g.app_user_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
          <span className="mono" style={{ ...mono, fontSize: 12.5, color: 'var(--text)', flex: 1 }}>
            {teamOf(g.roster_id)} <span style={{ color: 'var(--faint)' }}>⇄</span> {g.email ?? g.app_user_id.slice(0, 8)}
          </span>
          <button onClick={() => remove(g)} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>✕ remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <select value={seat} onChange={(e) => setSeat(e.target.value)} style={{ ...inp, padding: '5px 7px', fontSize: 13 }}>
          <option value="">team…</option>
          {seated.map((m) => <option key={m.roster_id} value={m.roster_id}>{m.team ?? `Roster ${m.roster_id}`}</option>)}
        </select>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="comanager@email.com"
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }} style={{ ...inp, fontSize: 13, padding: '5px 7px', width: 190 }} />
        <button onClick={add} disabled={busy || !seat || !email.trim()} className="mono" style={{ ...btn(true), opacity: busy || !seat || !email.trim() ? 0.6 : 1 }}>＋ add</button>
        {msg && <span className="mono" style={{ ...mono, fontSize: 11.5, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{msg}</span>}
      </div>
    </div>
  );
}

// Commissioner: the league's flat weekly coin budget + a per-week grant. Setting
// the amount defines the budget; the worker then credits it automatically as
// each week's games arrive (0132). "grant" is the manual catch-up — auto and
// manual share one ledger receipt per (league, week, roster), so neither can
// double-pay after the other.
function WeeklyBudget({ l, onGranted }: { l: AdminLeague; onGranted: () => void }) {
  const [amt, setAmt] = useState(String(l.weekly_budget ?? 0));
  const [saved, setSaved] = useState<number>(l.weekly_budget ?? 0);
  const [week, setWeek] = useState('1');
  const [busy, setBusy] = useState<'' | 'save' | 'grant'>('');
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = Number(amt) !== saved;
  const save = async () => {
    const n = Number(amt);
    if (busy || Number.isNaN(n) || n < 0) return;
    setBusy('save'); setMsg(null);
    const r = await commishSetWeeklyBudget(l.league_id, n);
    setBusy('');
    if (r.ok) { setSaved(r.weekly_budget ?? n); setMsg(`✓ budget set to ${Math.round(r.weekly_budget ?? n)}`); } else setMsg(r.error ?? 'failed');
  };
  const grant = async () => {
    const w = Number(week);
    if (busy || !w || w < 1) return;
    setBusy('grant'); setMsg(null);
    const r = await commishGrantWeeklyBudget(l.league_id, w);
    setBusy('');
    if (!r.ok) { setMsg(r.error ?? 'failed'); return; }
    if ((r.weekly_budget ?? 0) <= 0) setMsg('set a budget above 0 first');
    else if ((r.credited ?? 0) === 0) setMsg(`week ${w} already granted`);
    else { setMsg(`✓ granted ${Math.round(r.weekly_budget ?? 0)} to ${r.credited} team${r.credited === 1 ? '' : 's'} · week ${w}`); onGranted(); }
  };
  return (
    <div style={{ marginBottom: 10, padding: '9px 10px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6 }}>
      <div className="mono" style={{ ...mono, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 7 }}>◈ WEEKLY DRIP COIN</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={amt} onChange={(e) => { setAmt(e.target.value.replace(/[^\d]/g, '')); setMsg(null); }} onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="coin / week" inputMode="numeric" style={{ ...inp, fontSize: 13.5, padding: '5px 7px', width: 90 }} />
        <button onClick={save} disabled={busy === 'save' || !dirty} className="mono" style={{ ...btn(false), opacity: busy === 'save' || !dirty ? 0.6 : 1 }}>{busy === 'save' ? '…' : 'set budget'}</button>
        <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>each team, per week — drops automatically as the week starts</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 7, flexWrap: 'wrap' }}>
        <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--dim)' }}>grant week</span>
        <input value={week} onChange={(e) => { setWeek(e.target.value.replace(/[^\d]/g, '')); setMsg(null); }} onKeyDown={(e) => { if (e.key === 'Enter') grant(); }}
          inputMode="numeric" style={{ ...inp, fontSize: 13.5, padding: '5px 7px', width: 48, textAlign: 'center' }} />
        <button onClick={grant} disabled={busy === 'grant' || saved <= 0} title={saved <= 0 ? 'set a budget above 0 first' : 'credit every team this week’s budget'} className="mono" style={{ ...btn(false), opacity: busy === 'grant' || saved <= 0 ? 0.6 : 1 }}>{busy === 'grant' ? '…' : 'grant to all teams'}</button>
      </div>
      {msg && <div className="mono" style={{ ...mono, fontSize: 11.5, marginTop: 6, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--dim)' }}>{msg}</div>}
    </div>
  );
}

// Super-admin only: flip a league's live board onto a compressed real-time test
// clock (Setup → Locked → Live → Final in minutes) so the flow can be exercised in
// preseason. Affects every member of the league. Toggling off restores the real
// slate. Re-toggling on re-anchors the schedule to "now".
// WEEK LOCK — the super-admin unlock/lock switch (0136), grown from the 0134
// live-fire emergency. UNLOCK reopens a week mid-slate: hold recorded, matchups
// back to 'scheduled' with far-future lock_at, picks unsealed — and every open
// board follows within ~30s because the live board polls lock_holds(). LOCK
// releases the hold and NULLs lock_at, which is deliberately NOT "lock now":
// the worker's backfill restores the week's NATURAL lock time, so relocking
// early doesn't jump the gun and relocking mid-slate seals on the next tick.
function WeekLockControl({ leagueId }: { leagueId: string }) {
  const [holds, setHolds] = useState<number[]>([]);
  const [week, setWeek] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () => {
    lockHolds().then((h) => setHolds(
      [...h].filter((k) => k.startsWith(`${leagueId}:`)).map((k) => Number(k.split(':')[1])).sort((a, b) => a - b),
    )).catch(() => {});
  };
  useEffect(load, [leagueId]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (wk: number, locked: boolean) => {
    if (busy || !Number.isFinite(wk)) return;
    setBusy(true); setNote(null);
    const r = await adminSetWeekLock(leagueId, wk, locked).catch((e: unknown) => ({ ok: false as const, error: friendlyError(e) }));
    setNote(r.ok
      ? locked
        ? `✓ week ${wk} relocked — the worker seals it at its natural time (next tick if that's already passed)`
        : `✓ week ${wk} unlocked — ${('matchups' in r ? r.matchups : 0) ?? 0} matchups reopened, ${('picks' in r ? r.picks : 0) ?? 0} picks unsealed; boards follow within ~30s`
      : (r.error ?? 'failed'));
    setBusy(false);
    load();
  };
  const btn: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', border: '1px solid var(--warn)', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', background: 'var(--bg)', color: 'var(--warn)' };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {holds.map((wk) => (
        <button key={wk} onClick={() => go(wk, true)} disabled={busy} title={`Week ${wk} is UNLOCKED by admin hold — picks are editable past kickoff. Click to relock (restores the natural lock).`}
          className="mono" style={{ ...btn, background: 'var(--warn)', color: 'var(--on-accent)' }}>
          {busy ? '…' : `🔓 WK ${wk} OPEN — relock`}
        </button>
      ))}
      <input value={week} onChange={(e) => setWeek(e.target.value.replace(/\D/g, ''))} placeholder="wk (102…)"
        className="mono" style={{ width: 64, fontSize: 12.5, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 4 }} />
      <button onClick={() => go(Number(week), false)} disabled={busy || !week} title="Emergency unlock: reopen this week's picks for THIS league and hold every lock off until relocked here."
        className="mono" style={{ ...btn, opacity: busy || !week ? 0.6 : 1 }}>{busy ? '…' : '🔓 unlock wk'}</button>
      <button onClick={() => go(Number(week), true)} disabled={busy || !week} title="Release the hold on this week and restore its natural lock time."
        className="mono" style={{ ...btn, opacity: busy || !week ? 0.6 : 1 }}>{busy ? '…' : '🔒 lock wk'}</button>
      {note && <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)' }}>{note}</span>}
    </div>
  );
}

function TestLiveToggle({ on, leagueId, reload }: { on: boolean; leagueId: string; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    await adminSetTestLive(leagueId, !on).catch(() => {});
    setBusy(false);
    reload();
  };
  return (
    <button onClick={go} disabled={busy} title={on ? 'Live-test mode is ON — the board runs a compressed Setup→Locked→Live→Final clock for everyone. Click to turn off.' : 'Turn on live-test mode: the board runs a compressed real-time clock so you can test the flow now.'}
      className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: on ? 'var(--on-accent)' : 'var(--warn)', background: on ? 'var(--warn)' : 'var(--bg)', border: '1px solid var(--warn)', borderRadius: 4, padding: '4px 8px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
      {busy ? '…' : on ? '🧪 LIVE TEST: ON' : '🧪 live test'}
    </button>
  );
}

// PRESEASON PRACTICE — the commissioner's one click (migration 0110). Turning it
// on clones the league's Week-1 pairings into the preseason board weeks (101-103)
// AND replaces every seat's pick pool at those weeks with the DEEP slate-team pool
// (every active skill player on that week's teams, depth-chart ordered, + team
// K/DST). Both halves matter and the order is fixed: preseason snaps go to the
// depth chart's back half, so without the deep pool seats field Week-1 starters
// who sit. These used to be two separate super-admin buttons you had to press in
// sequence — and re-press the second after every re-toggle, since turning
// preseason off wipes the lineups along with the clones.
//
// Practice games are throwaway by construction: no standings, no playoff seeding,
// no coin, no inventory (all enforced server-side in 0110). Off removes the weeks.
//
// GATED on the preseason window (see liveApi preseasonWindow): the worker picks
// what it polls from process-wide config, not per league, so outside that window
// turning practice on would hand the commissioner three weeks nothing will ever
// feed. Admins see the control regardless, so off-window testing still works.
function PreseasonPractice({ on, leagueId, season, admin, reload }: { on: boolean; leagueId: string; season: string; admin: boolean; reload: () => void }) {
  const [busy, setBusy] = useState<'on' | 'off' | 'pool' | 'rebuild' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [win, setWin] = useState<PreseasonWindow | null>(null);
  useEffect(() => { let ok = true; preseasonWindow(season).then((w) => { if (ok) setWin(w); }).catch(() => {}); return () => { ok = false; }; }, [season]);

  const turnOn = async () => {
    if (busy) return;
    setBusy('on'); setNote(null);
    const r = await enablePreseasonPractice(leagueId).catch((e: unknown) => ({ ok: false as const, error: friendlyError(e) }));
    const skipped = ('skipped' in r ? r.skipped ?? [] : []).map((w) => `PRE ${w - 100}`);
    setNote(r.ok
      ? `✓ ${r.matchups ?? 0} matchups per week · deep pool on ${('weeks' in r ? r.weeks ?? [] : []).map((w) => `PRE ${w - 100}`).join(', ')}`
        + (skipped.length ? ` · skipped ${skipped.join(', ')} (already played)` : '')
      : (r.error ?? 'failed'));
    setBusy(null);
    reload();
  };
  const turnOff = async () => {
    if (busy) return;
    setBusy('off'); setNote(null);
    const r = await setPreseasonPractice(leagueId, false).catch((e: unknown) => ({ ok: false as const, error: friendlyError(e) }));
    if (!r.ok) setNote(r.error ?? 'failed');
    setBusy(null);
    reload();
  };
  // Re-run the CLONE on a league that's already ON. Needed because the week set
  // is built once, when practice is opened: a league opened before 0112/0113
  // still has the old three Week-1 clones and will never grow week 104 or gain
  // distinct pairings, and pressing "open" isn't offered while it's already on.
  // Turning practice off and on again would work but is worse — OFF deletes every
  // practice week including already-played ones (it would take the Hall-of-Fame
  // matchup and its scores with it), whereas the clone skips a played week before
  // it wipes anything, so a rebuild leaves finished weeks untouched.
  //
  // DESTRUCTIVE for unplayed practice weeks: the clone wipes each week it rebuilds,
  // so sealed picks there go. Hence the confirm, and hence it stays separate from
  // the harmless roster re-seed below.
  const rebuild = async () => {
    if (busy) return;
    if (!window.confirm('Rebuild the practice weeks?\n\nAdds any preseason week that is missing (e.g. PRE 4) and re-draws each week\u2019s random pairings.\n\nAlready-played weeks are left alone, but any picks already sealed in an UPCOMING practice week will be cleared.')) return;
    setBusy('rebuild'); setNote(null);
    const r = await enablePreseasonPractice(leagueId).catch((e: unknown) => ({ ok: false as const, error: friendlyError(e) }));
    const skipped = ('skipped' in r ? r.skipped ?? [] : []).map((w) => `PRE ${w - 100}`);
    setNote(r.ok
      ? `✓ rebuilt ${('weeks' in r ? r.weeks ?? [] : []).map((w) => `PRE ${w - 100}`).join(', ')}`
        + (skipped.length ? ` · left ${skipped.join(', ')} alone (already played)` : '')
      : (r.error ?? 'failed'));
    setBusy(null);
    reload();
  };
  // Re-seed on demand: rosters move all preseason, and a week whose slate hadn't
  // loaded when practice opened gets its pool on the next press.
  const reseed = async () => {
    if (busy) return;
    setBusy('pool'); setNote(null);
    try {
      let seats = 0, pool = 0;
      for (const wk of PRESEASON_BOARD_WEEKS) {
        const r = await seedPreseasonPool(leagueId, wk);
        if (!r.ok) throw new Error(r.error || `week ${wk} failed`);
        seats = r.seats ?? seats; pool += r.pool ?? 0;
      }
      setNote(`✓ ${seats} seats · ${pool} pool entries across the preseason weeks`);
    } catch (e) { setNote(friendlyError(e)); }
    setBusy(null);
  };

  const bs = (fill: boolean): React.CSSProperties => ({
    fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: fill ? 'var(--on-accent)' : 'var(--you)',
    background: fill ? 'var(--you)' : 'var(--bg)', border: '1px solid var(--you)', borderRadius: 4,
    padding: '4px 8px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
  });
  // Closed = the preseason is over (or was never loaded) for this season, so no
  // worker tick will ever feed these weeks. A league already IN practice always
  // keeps its controls — closing the window must never strand someone with weeks
  // they can't turn off.
  const closed = win !== null && !win.open && !on && !admin;
  const closedWhy = win?.loaded
    ? `The ${season} preseason is over — its last game kicked off ${new Date(win.lastKickoff!).toLocaleDateString()}. Practice weeks opened now would never receive play-by-play.`
    : `No ${season} preseason slate is loaded, so there are no games to practise on.`;

  return (
    <div>
      <div style={subhead}>PRESEASON PRACTICE</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {closed ? (
          <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', lineHeight: 1.5 }}>{closedWhy}</span>
        ) : on ? (
          <>
            <span className="mono" style={bs(true)}>🏈 PRACTICE: ON</span>
            <button onClick={rebuild} disabled={!!busy} className="mono" style={bs(false)}
              title="Rebuild the practice weeks: adds any preseason week this league is missing and re-draws each week's random pairings. Already-played weeks are left untouched; picks sealed in an upcoming practice week are cleared.">
              {busy === 'rebuild' ? 'rebuilding…' : '⟳ rebuild weeks'}
            </button>
            <button onClick={reseed} disabled={!!busy} className="mono" style={bs(false)}
              title="Re-seed every seat's preseason pick pool from the current depth charts. Safe to re-press — this never touches matchups or picks.">
              {busy === 'pool' ? 'seeding…' : '🧬 re-seed rosters'}
            </button>
            <button onClick={turnOff} disabled={!!busy} className="mono" style={{ ...bs(false), color: 'var(--opp)', borderColor: 'var(--opp)' }}
              title="Turn practice off and delete the preseason weeks — picks, lineups and results all go with them.">
              {busy === 'off' ? '…' : '✕ turn off'}
            </button>
          </>
        ) : (
          <button onClick={turnOn} disabled={!!busy || win === null} className="mono" style={bs(false)}
            title={`Open preseason practice: real ${season} preseason matchups on real play-by-play, with throwaway deep rosters so backups who actually play are pickable.`}>
            {busy === 'on' ? 'opening…' : win === null ? 'checking…' : '🏈 open preseason practice'}
          </button>
        )}
        {/* An admin acting outside the window is doing it deliberately — say so
            rather than silently letting them create weeks nothing will feed. */}
        {admin && win && !win.open && !on && (
          <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--warn)' }}>⚠ outside the preseason window — nothing will feed these weeks</span>
        )}
      </div>
      {!closed && (
        <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
          Real {season} preseason games on live play-by-play, with throwaway deep rosters — every backup on the slate is pickable, since they take the snaps. Opponents are drawn at random each practice week, so this works before the draft finishes — no schedule needed. Nothing carries over: no standings, no seeding, no coin, no power-up inventory. Turning it off removes the practice weeks entirely.
        </div>
      )}
      {note && <div className="mono" style={{ ...mono, fontSize: 11.5, marginTop: 6, color: note.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{note}</div>}
    </div>
  );
}

// Per-league card-table theme (league_pref.card_theme, migration 0074): flips the
// live board between the classic list and the card-table presentation for every
// member of this league. Loads its own state; optimistic flip, reverts on error.
// Cards are the default board for every league now; this toggle is the per-league
// opt-out to the classic "simple view". ON = 🃏 cards (default), OFF = ▤ simple.
function CardThemeToggle({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { leagueCardTheme(leagueId).then((v) => setOn(!!v)).catch(() => setOn(true)); }, [leagueId]);
  const flip = async () => {
    if (on == null) return;
    const next = !on;
    setOn(next);
    try { const r = await adminSetCardTheme(leagueId, next); if (!r.ok) setOn(!next); } catch { setOn(!next); }
  };
  return (
    <button onClick={flip} disabled={on == null} title={on ? 'This league uses the card-table board (the default) — lineups as a heads-up card table. Click to switch this league to the classic simple view.' : 'This league is on the classic simple view. Click to restore the card-table board (the default).'}
      className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '4px 8px', cursor: on == null ? 'default' : 'pointer', opacity: on == null ? 0.6 : 1 }}>
      {on == null ? '…' : on ? '🃏 CARDS' : '▤ SIMPLE VIEW'}
    </button>
  );
}

// Window Pot (0117): the per-league feature flag. `pot_ante` doubles as the
// switch — 0 is off and the feature leaves no trace at all. Turning it off
// deliberately does NOT touch pots already under way: they close and settle
// themselves so no manager loses coin they committed in good faith, and the
// button reports how many are still in flight. `unwind` is the separate,
// explicit escape hatch that voids them all and refunds every chip.
function WindowPotToggle({ l, reload }: { l: AdminLeague; reload: () => void }) {
  const on = (l.pot_ante ?? 0) > 0;
  const openPots = l.pot_open ?? 0;
  const [busy, setBusy] = useState(false);
  const [tune, setTune] = useState(false);
  const [ante, setAnte] = useState(String(l.pot_ante || 10));
  const [cap, setCap] = useState(String(l.pot_cap || 120));
  const [msg, setMsg] = useState<string | null>(null);

  const apply = async (next: boolean, a?: number, c?: number) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await adminSetPot(l.league_id, next, a, c);
      if (!r.ok) setMsg(r.error ?? 'failed');
      else {
        setMsg(r.on
          ? `✓ on · ◎${r.pot_ante} ante, ◎${r.pot_cap} cap`
          : `✓ off${r.open_pots ? ` · ${r.open_pots} pot${r.open_pots === 1 ? '' : 's'} still in flight — they'll close themselves` : ''}`);
        reload();
      }
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };

  const unwind = async () => {
    if (busy) return;
    if (!confirm(`Void all ${openPots} open pot${openPots === 1 ? '' : 's'} in ${l.name}? Every chip goes back to whoever put it in — nobody wins, nobody loses.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await adminClosePots(l.league_id);
      setMsg(r.ok ? `✓ voided ${r.closed} pot${r.closed === 1 ? '' : 's'}, all coin refunded` : (r.error ?? 'failed'));
      if (r.ok) reload();
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button onClick={() => apply(!on)} disabled={busy}
        title={on
          ? `Window Pot is ON for this league — ◎${l.pot_ante} ante, ◎${l.pot_cap} cap. Managers can put coin on any window until its picks lock. Click to turn off (pots already running will still close themselves).`
          : 'Turn on the Window Pot: managers can put ◎10 on any window and wager against each other until that window\u2019s picks lock. Off by default; nothing appears in the app until this is on.'}
        className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--warn)' : 'var(--bg)', border: `1px solid ${on ? 'var(--warn)' : 'var(--bd)'}`, borderRadius: 4, padding: '4px 8px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? '…' : on ? `🪙 POT: ON ◎${l.pot_ante}` : '🪙 window pot'}
      </button>
      {on && (
        <button onClick={() => setTune((t) => !t)} className="mono" style={{ ...linkBtn, fontSize: 11.5 }}>
          {tune ? 'done' : 'tune'}
        </button>
      )}
      {openPots > 0 && (
        <button onClick={unwind} disabled={busy} title="Void every open pot in this league and refund every chip. Already-settled pots are untouched."
          className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--opp)', background: 'var(--bg)', border: '1px solid var(--opp)', borderRadius: 4, padding: '4px 8px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          ⟲ void {openPots} open
        </button>
      )}
      {tune && on && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>ante ◎</span>
          <input value={ante} onChange={(e) => setAnte(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={{ ...inp, width: 44, padding: '3px 5px', textAlign: 'center' }} />
          <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>cap ◎</span>
          <input value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={{ ...inp, width: 52, padding: '3px 5px', textAlign: 'center' }} />
          <button onClick={() => apply(true, Number(ante) || 10, Number(cap) || 120)} disabled={busy} className="mono" style={{ ...linkBtn, fontSize: 11.5 }}>save</button>
        </span>
      )}
      {msg && <span className="mono" style={{ ...mono, fontSize: 11.5, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{msg}</span>}
    </div>
  );
}

// Global super-admin lever for the generic front-door demo board (baked demo
// league). Cards default; flip to the simple view for everyone.
function DemoCardThemePanel() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { demoCardTheme().then((v) => setOn(!!v)).catch(() => setOn(true)); }, []);
  const flip = async () => {
    if (on == null || busy) return;
    const next = !on; setOn(next); setBusy(true);
    try { const r = await adminSetDemoCardTheme(next); if (!r.ok) setOn(!next); } catch { setOn(!next); } finally { setBusy(false); }
  };
  return (
    <div style={card}>
      <div style={h}>DEMO BOARD</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="mono" style={{ fontSize: 13.5, color: 'var(--text)' }}>
          Front-door demo · <b>{on == null ? '…' : on ? 'CARDS' : 'SIMPLE VIEW'}</b>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 3, maxWidth: 360 }}>
            The generic vs-AI demo everyone lands on. Cards is the default; switch to the classic simple view for all visitors.
          </span>
        </span>
        <button onClick={flip} disabled={on == null || busy} style={btn(!!on)}>{on == null ? '…' : on ? 'use simple' : 'use cards'}</button>
      </div>
    </div>
  );
}

// Super-admin only: permanently delete a league. Two-step, type-the-name guard so
// it can't be a stray click — the whole league + its matchups/picks/members go.
function DeleteLeague({ name, onDelete }: { name: string; onDelete: () => Promise<{ ok: boolean; error?: string }> }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const danger = 'var(--opp, #e5484d)';
  const go = async () => {
    if (busy || confirm.trim() !== name) return;
    setBusy(true); setErr(null);
    const r = await onDelete();
    if (!r.ok) { setErr(r.error ?? 'failed'); setBusy(false); }
    // on success the row unmounts (parent reloads) — no need to reset state
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} className="mono" style={{ ...linkBtn, fontSize: 11.5, color: danger }} title="permanently delete this league">🗑 delete league</button>
  );
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="mono" style={{ ...mono, fontSize: 11.5, color: danger }}>type “{name}” to confirm:</span>
      <input value={confirm} onChange={(e) => { setConfirm(e.target.value); setErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        autoFocus spellCheck={false} style={{ ...inp, fontSize: 12.5, padding: '4px 7px', minWidth: 140, borderColor: danger }} />
      <button onClick={go} disabled={busy || confirm.trim() !== name} className="mono"
        style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--on-accent, #fff)', background: danger, border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', opacity: busy || confirm.trim() !== name ? 0.5 : 1 }}>{busy ? 'deleting…' : 'delete forever'}</button>
      <button onClick={() => { setOpen(false); setConfirm(''); setErr(null); }} className="mono" style={{ ...linkBtn, fontSize: 11.5 }}>cancel</button>
      {err && <span className="mono" style={{ ...mono, fontSize: 11.5, color: danger }}>{err}</span>}
    </div>
  );
}

// Per-account feature gates (0094/0095): 'solo' = standalone pods/showdowns;
// 'dfs_commish' = may found DFS leagues; 'native' = may create in-app drafted
// leagues (incl. mock drafts). All founder-approval switches.
function FeatureFlags() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = async (feature: 'solo' | 'dfs_commish' | 'native', on: boolean) => {
    if (busy || !email.trim()) return;
    setBusy(true); setMsg(null);
    const r = await adminSetFeature(email, feature, on).catch((x) => ({ ok: false, error: String(x) }));
    setBusy(false);
    setMsg(r.ok ? `✓ ${feature} ${on ? 'ON' : 'OFF'} for ${email.trim()}` : `⚠ ${(r as { error?: string }).error ?? 'failed'}`);
  };
  const b: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '6px 9px', cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div style={card}>
      <div style={h}>FEATURE FLAGS</div>
      <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 8 }}>
        <b>solo</b> — standalone pods + weekly showdowns · <b>dfs_commish</b> — may create DFS leagues · <b>native</b> — may create drafted-on-site leagues (incl. mocks). Account must exist (signed in once).
      </div>
      <input value={email} onChange={(e) => { setEmail(e.target.value); setMsg(null); }} placeholder="player@email.com" type="email"
        style={{ fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="mono" style={{ ...b, color: 'var(--you)' }} disabled={busy} onClick={() => set('solo', true)}>+ solo</button>
        <button className="mono" style={b} disabled={busy} onClick={() => set('solo', false)}>− solo</button>
        <button className="mono" style={{ ...b, color: 'var(--warn)' }} disabled={busy} onClick={() => set('dfs_commish', true)}>+ dfs commish</button>
        <button className="mono" style={b} disabled={busy} onClick={() => set('dfs_commish', false)}>− dfs commish</button>
        <button className="mono" style={{ ...b, color: 'var(--text)' }} disabled={busy} onClick={() => set('native', true)}>+ native</button>
        <button className="mono" style={b} disabled={busy} onClick={() => set('native', false)}>− native</button>
      </div>
      {msg && <div className="mono" style={{ ...mono, fontSize: 12.5, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

// Auto-issued solo passes (0097): the weekly mint cap is the founder's supply
// lever — the demo funnel mints against it; over quota falls back to waitlist.
function SoloPasses() {
  const [data, setData] = useState<SoloPassAdmin | null>(null);
  const [quota, setQuota] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => adminSoloPasses().then((d) => { if (!('error' in d)) { setData(d); setQuota(String(d.weekly_quota)); } }).catch(() => {});
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saveQuota = async () => {
    const q = parseInt(quota, 10);
    if (busy || isNaN(q)) return;
    setBusy(true); setMsg(null);
    const r = await adminSetSoloQuota(q).catch((x) => ({ ok: false, error: String(x) }));
    setBusy(false);
    setMsg(r.ok ? `✓ quota set to ${q}/week` : `⚠ ${(r as { error?: string }).error ?? 'failed'}`);
    load();
  };
  return (
    <div style={card}>
      <div style={h}>SOLO PASSES</div>
      <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 8 }}>
        The demo funnel auto-mints a pass per solo request, capped per rolling 7 days; over the cap requesters land on the waitlist (their lead is still captured above). Redeeming a pass sets the account’s <b>solo</b> flag.
      </div>
      <div className="mono" style={{ ...mono, fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
        minted last 7d: <b>{data?.minted_7d ?? '…'}</b> / {data?.weekly_quota ?? '…'} · claimed: <b>{data?.claimed_7d ?? '…'}</b>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={quota} onChange={(e) => { setQuota(e.target.value.replace(/\D/g, '')); setMsg(null); }} inputMode="numeric" placeholder="25"
          style={{ fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 10px', outline: 'none', width: 90 }} />
        <button className="mono" disabled={busy || !quota.trim()} onClick={saveQuota}
          style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--you)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 11px', cursor: 'pointer', fontFamily: 'inherit', opacity: busy || !quota.trim() ? 0.6 : 1 }}>set weekly cap</button>
      </div>
      {msg && <div className="mono" style={{ ...mono, fontSize: 12.5, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 8 }}>{msg}</div>}
      {data && data.passes.length > 0 && (
        <div style={{ marginTop: 10, maxHeight: 180, overflow: 'auto' }}>
          {data.passes.map((p) => (
            <div key={p.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
              <span className="mono" style={{ ...mono, fontSize: 12.5, color: p.claimed ? 'var(--faint)' : 'var(--you)' }}>{p.code}</span>
              <span style={{ fontSize: 13, color: 'var(--dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
              <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>{p.claimed ? '✓ claimed' : 'unclaimed'} · {new Date(p.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Read-only "view as": everything a user sees, for support + QA. Explicitly NOT
// impersonation — no session is minted and nothing here writes, so an admin can
// diagnose "why can't I set my lineup" without gaining the ability to act as
// somebody. The banner says so, because a panel that mirrors a user's screen is
// easy to mistake for being logged in as them.
function ViewAs({ user, onClose, onLeaveAdmin }: { user: AdminUser; onClose: () => void; onLeaveAdmin?: () => void }) {
  const { setViewAs } = useStore();
  const [week, setWeek] = useState('1');
  const [state, setState] = useState<ViewAsState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async (w: number) => {
    setState(null); setErr(null);
    try {
      const s = await adminUserState(user.id, w);
      if (s.error) setErr(s.error); else setState(s);
    } catch (e) { setErr(errMsg(e, 'load failed')); }
  };
  useEffect(() => { load(Number(week) || 1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const label: React.CSSProperties = { ...mono, fontSize: 11.5, color: 'var(--faint)' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 75, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 560, marginTop: 24 }}>
        <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 5, padding: '7px 9px', lineHeight: 1.5 }}>
          👁 VIEWING AS {user.email ?? user.id.slice(0, 8)} — READ ONLY<br />
          <span style={{ fontWeight: 400, color: 'var(--dim)' }}>You are still signed in as yourself. Nothing here can change their data or act in their name.</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
          <span className="mono" style={label}>week</span>
          <input value={week} onChange={(e) => setWeek(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            onKeyDown={(e) => { if (e.key === 'Enter') load(Number(week) || 1); }}
            style={{ ...inp, width: 52, padding: '5px 6px', textAlign: 'center' }} />
          <button onClick={() => load(Number(week) || 1)} className="mono" style={btn(false)}>load</button>
          <span style={{ flex: 1 }} />
          {onLeaveAdmin && (
            <button onClick={() => { setViewAs({ userId: user.id, label: user.email ?? user.sleeper_username ?? user.id.slice(0, 8) }); onClose(); onLeaveAdmin(); }}
              className="mono" style={btn(true)} title="render the real site against this user's data, read-only">🌐 browse as them</button>
          )}
          <button onClick={onClose} className="mono" style={linkBtn}>close</button>
        </div>

        {err && <div className="mono" style={{ ...mono, fontSize: 12.5, color: 'var(--opp)' }}>⚠ {err}</div>}
        {!err && !state && <Muted text="Loading…" />}
        {state && (
          <>
            <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--dim)', marginBottom: 10 }}>
              {state.user.sleeper_username ? `@${state.user.sleeper_username}` : 'no Sleeper account linked'}
              {state.user.sleeper_user_id ? ` · ${state.user.sleeper_user_id}` : ''} · joined {new Date(state.user.created_at).toLocaleDateString()}
            </div>
            {state.leagues.length === 0 && <Muted text="Not enrolled in any league — this user would see an empty leagues page." />}
            {state.leagues.map((lg) => {
              const m = lg.matchup;
              // The two questions support actually gets asked: can they build a
              // lineup at all (pool), and did their picks land (count vs pool).
              const pool = lg.pool_size ?? 0;
              return (
                <div key={`${lg.league_id}-${lg.roster_id}`} style={{ borderTop: '1px solid var(--bd)', padding: '9px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={lg.name} accent="var(--warn)" src={lg.avatar_url} size={26} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{lg.team_name} <span className="mono" style={label}>· {lg.name} {lg.season}</span></div>
                      <div className="mono" style={label}>
                        roster {lg.roster_id} · {lg.provider}
                        {lg.is_commish ? ' · commissioner' : ''}
                        {lg.controller === 'ai' ? ' · 🤖 AI control' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="mono" style={{ ...mono, fontSize: 12, marginTop: 6, lineHeight: 1.6, color: 'var(--dim)' }}>
                    <div style={{ color: pool ? 'var(--dim)' : 'var(--warn)' }}>
                      pick pool: {pool ? `${pool} players` : '⚠ empty — nothing to build a lineup from this week'}
                    </div>
                    {!m && <div style={{ color: 'var(--warn)' }}>no matchup at week {state.week} — this user sees no board</div>}
                    {m && (
                      <>
                        <div>vs {m.opponent ?? '—'} · {m.status}{m.lock_at ? ` · locks ${new Date(m.lock_at).toLocaleString()}` : ''}</div>
                        <div style={{ color: m.picks.length ? 'var(--you)' : 'var(--warn)' }}>
                          {m.picks.length ? `${m.picks.length} picks sealed${m.picks.some((p) => p.locked) ? ' · locked' : ''}` : '⚠ no picks set'}
                        </div>
                        {!!m.picks.length && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                            {m.picks.map((p, i) => (
                              <span key={i} className="mono" title={`${p.game_window} ${p.roster_slot}${p.metric_id ? ` · ${p.metric_id}` : ''}`}
                                style={{ ...mono, fontSize: 10.5, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 4px' }}>
                                {p.player_slug ? fmtSlug(p.player_slug) : '—'}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function Users({ onLeaveAdmin }: { onLeaveAdmin?: () => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [viewing, setViewing] = useState<AdminUser | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { adminUsers().then(setUsers).catch(() => setUsers([])); }, []);
  const needle = q.trim().toLowerCase();
  const shown = (users ?? []).filter((u) => !needle
    || (u.email ?? '').toLowerCase().includes(needle)
    || (u.sleeper_username ?? '').toLowerCase().includes(needle));
  return (
    <div style={card}>
      {viewing && <ViewAs user={viewing} onClose={() => setViewing(null)} onLeaveAdmin={onLeaveAdmin} />}
      <div style={h}>USERS ({users?.length ?? '…'})</div>
      {!!users?.length && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter by email or Sleeper handle…"
          style={{ ...inp, width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '5px 7px', marginBottom: 6 }} />
      )}
      {users === null ? <Muted text="Loading…" /> : users.length === 0 ? <Muted text="No users yet." /> : shown.map((u) => (
        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{u.email ?? '—'}</div>
            <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>{u.sleeper_username ? `@${u.sleeper_username}` : 'no Sleeper link'} · {u.enrolled} enrolled</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setViewing(u)} className="mono" style={{ ...linkBtn, color: 'var(--you)' }} title="see what this user sees — read-only">👁 view as</button>
            <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>{new Date(u.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
      {users !== null && users.length > 0 && shown.length === 0 && <Muted text="No match." />}
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
        <span key={i} className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 4px' }} title={p.metric ?? ''}>
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
            <span className="mono" style={{ ...mono, fontSize: 11, color: homeLeads || winTied ? 'var(--text)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h ? fmtSlug(h.slug ?? '') : <span style={{ color: 'var(--faint)' }}>—</span>}
              {h && <span style={{ color: homeLeads ? 'var(--you)' : 'var(--faint)', marginLeft: 4 }}>{rnd(h.score)}</span>}
            </span>
            <span className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)', textAlign: 'center', alignSelf: 'center' }}>{h?.metric ?? a?.metric ?? ''}</span>
            <span className="mono" style={{ ...mono, fontSize: 11, color: !homeLeads || winTied ? 'var(--text)' : 'var(--dim)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
      catch (e) { if (alive) setErr(errMsg(e, 'load failed')); }
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
          <span className="mono" style={{ ...mono, fontSize: 11.5, letterSpacing: '0.12em', color: 'var(--faint)', fontWeight: 700 }}>
            LIVE BOARD{m ? ` · W${m.week}` : ''}
            {m && <span style={{ color: live ? 'var(--you)' : 'var(--faint)', marginLeft: 6 }}>{live ? '● LIVE' : m.status.toUpperCase()}</span>}
          </span>
          <button onClick={onClose} className="mono" style={linkBtn}>✕ close</button>
        </div>
        {err && <div className="mono" style={{ ...mono, fontSize: 13, color: 'var(--opp)', marginBottom: 8 }}>{err}</div>}
        {!b && !err ? <Muted text="Loading…" /> : m && (
          <>
            {/* Scoreboard header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'end', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                {isFinal && homeLeads && <div className="mono" style={{ ...mono, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', marginBottom: 3 }}>WINNER ▲</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                  {b.home_avatar && <img src={b.home_avatar} alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} />}
                  <span style={{ fontSize: 14, fontWeight: 700, color: homeLeads ? 'var(--you)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.home_team ?? `roster ${m.home_roster_id}`}</span>
                </div>
                <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, color: homeLeads ? 'var(--you)' : tied ? 'var(--text)' : 'var(--dim)', lineHeight: 1.1 }}>{homeScore}</div>
              </div>
              <div style={{ textAlign: 'center', paddingBottom: 6 }}>
                <span className="mono" style={{ ...mono, fontSize: 12.5, color: 'var(--faint)' }}>vs</span>
                {!tied && (homeScore > 0 || awayScore > 0) && (
                  <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>{homeLeads ? '←' : '→'} +{margin}</div>
                )}
              </div>
              <div style={{ minWidth: 0, textAlign: 'right' }}>
                {isFinal && !homeLeads && !tied && <div className="mono" style={{ ...mono, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', marginBottom: 3, textAlign: 'right' }}>▲ WINNER</div>}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, overflow: 'hidden' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: !homeLeads && !tied ? 'var(--you)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{b.away_team ?? `roster ${m.away_roster_id}`}</span>
                  {b.away_avatar && <img src={b.away_avatar} alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} />}
                </div>
                <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, color: !homeLeads && !tied ? 'var(--you)' : tied ? 'var(--text)' : 'var(--dim)', lineHeight: 1.1, textAlign: 'right' }}>{awayScore}</div>
              </div>
            </div>
            {(m.home_coin != null || m.away_coin != null) && (
              <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', textAlign: 'center', marginTop: 6 }}>◇ coin {rnd(m.home_coin ?? 0)} / {rnd(m.away_coin ?? 0)}</div>
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
                      <span className="mono" style={{ ...mono, fontSize: 15, fontWeight: 700, color: winWin ? 'var(--you)' : winTied ? 'var(--text)' : 'var(--dim)' }}>{rnd(hw)}</span>
                      <span className="mono" style={{ ...mono, fontSize: 11, letterSpacing: '0.08em', color: 'var(--faint)', textAlign: 'center' }}>{winLabel(s.game_window)}</span>
                      <span className="mono" style={{ ...mono, fontSize: 15, fontWeight: 700, color: !winWin && !winTied ? 'var(--you)' : winTied ? 'var(--text)' : 'var(--dim)', textAlign: 'right' }}>{rnd(aw)}</span>
                    </div>
                    {hasSlots
                      ? <SlotScoreRows slotScores={s.slot_scores} homeLeads={winWin} winTied={winTied} />
                      : (s.home_picks.length > 0 || s.away_picks.length > 0) && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '0 8px 6px' }}>
                            <PickPills picks={s.home_picks} />
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end' }}>
                              {s.away_picks.map((p, i) => (
                                <span key={i} className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 4px' }} title={p.metric ?? ''}>
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
            <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', textAlign: 'center', marginTop: 10 }}>
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

/** DEAD SEATS: picks with a player and no metric (v0.330.0).
 *
 *  Founder, on a live window: "how did Montgomery get no metric?" — then "can
 *  we run the sql by action?"
 *
 *  The .sql file that answered the first question needed a psql prompt and live
 *  credentials. This is the same query where the data already is, behind the
 *  same admin gate as SYSTEM HEALTH, so the answer is a tap from a phone.
 *
 *  WHY IT MATTERS: `scorePlay` is a chain of `if (metricId === '…')` ending in
 *  `return 0`. A null matches nothing and falls through — the pick scores
 *  exactly zero for the whole window whatever the player does, and nothing on
 *  the board says so.
 *
 *  ON DEMAND, NOT ON A POLL. Unlike SYSTEM HEALTH next to it, this is a
 *  full-table scan across every league; running it every 10 seconds to answer a
 *  question nobody asked is how a diagnostic becomes a load problem. */
/** 📈 MARKET — the weekly market-refresh history (0237, founder: "a report
 *  ... that details success of the run and significant changes"). Each row is
 *  one _market_refresh_apply run: when it landed, how many players the board
 *  carries, who entered, who fell off, and the 15-spot movers in the top 200.
 *  A missing Monday shows up as a stale top date. */
function MarketPanel() {
  const [r, setR] = useState<MarketReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<number | null>(null);
  useEffect(() => { adminMarketReport().then(setR).catch((e) => setErr(errMsg(e, 'report failed'))); }, []);
  const staleDays = r?.runs?.[0] ? Math.floor((Date.now() - Date.parse(r.runs[0].applied_at)) / 86_400_000) : null;
  return (
    <div style={card}>
      <div style={h}>📈 MARKET · refresh runs</div>
      <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 8 }}>
        The contract market (mkt · extension base) reads a board refreshed weekly from
        Stathead's dynasty values — 1QB and superflex ranks, picked per league. Each row
        is one refresh: its market date, and what changed.
      </div>
      {err && <Muted text={err} />}
      {r && !r.ok && <Muted text={r.error ?? 'forbidden'} />}
      {r?.ok && (
        <>
          <div className="mono" style={{ ...mono, fontSize: 13, fontWeight: 700, marginBottom: 8, color: staleDays != null && staleDays > 9 ? 'var(--warn)' : 'var(--you)' }}>
            {r.board_size} players on the board
            {staleDays != null && ` · last run ${staleDays === 0 ? 'today' : `${staleDays}d ago`}`}
            {staleDays != null && staleDays > 9 && ' — the weekly pull has missed'}
          </div>
          {(r.runs ?? []).length === 0 && <Muted text="No refresh runs logged yet." />}
          {(r.runs ?? []).map((run) => {
            const changes = run.entered.length + run.dropped.length + run.movers.length;
            const open = openRun === run.id;
            return (
              <div key={run.id} style={{ borderTop: '1px solid var(--bd)', padding: '5px 0' }}>
                <button onClick={() => setOpenRun(open ? null : run.id)} className="mono"
                  style={{ ...linkBtn, display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {open ? '▾' : '▸'} market {run.as_of} · {run.players} players
                    {changes > 0
                      ? <span style={{ color: 'var(--you)' }}> · {run.movers.length} moved · {run.entered.length} in · {run.dropped.length} out</span>
                      : <span style={{ color: 'var(--faint)' }}> · no significant changes</span>}
                    {run.note && <span style={{ color: 'var(--faint)' }}> · {run.note}</span>}
                  </span>
                  <span style={{ color: 'var(--faint)', whiteSpace: 'nowrap', fontSize: 11 }}>{new Date(run.applied_at).toLocaleDateString()}</span>
                </button>
                {open && (
                  <div style={{ padding: '4px 0 2px 14px' }}>
                    {run.movers.map((m) => (
                      <div key={m.slug} className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--dim)', padding: '2px 0' }}>
                        {m.slug} <b style={{ color: m.to < m.from ? 'var(--you)' : 'var(--opp)' }}>{m.from} → {m.to}</b>
                      </div>
                    ))}
                    {run.entered.length > 0 && (
                      <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--you)', padding: '2px 0' }}>
                        in: {run.entered.map((e) => `${e.slug} (#${e.rank})`).join(', ')}
                      </div>
                    )}
                    {run.dropped.length > 0 && (
                      <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--opp)', padding: '2px 0' }}>
                        out: {run.dropped.map((d) => `${d.slug} (was #${d.rank})`).join(', ')}
                      </div>
                    )}
                    {changes === 0 && <Muted text="Ranks held — nothing entered, dropped, or moved 15+ spots." />}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function MetriclessPanel() {
  const [a, setA] = useState<MetriclessAudit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { setA(await adminMetriclessPicks()); }
    catch (e) { setErr(errMsg(e, 'audit failed')); }
    finally { setBusy(false); }
  };
  const locked = (a?.picks ?? []).filter((p) => p.locked).length;
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <div style={h}>DEAD SEATS · picks with no metric</div>
        <button onClick={run} disabled={busy} className="mono" style={{ ...btn(false), opacity: busy ? 0.5 : 1 }}>
          {busy ? '…' : a ? '↻ re-run' : 'RUN AUDIT'}
        </button>
      </div>
      <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 8 }}>
        A pick with a player and no metric scores <b>exactly zero</b> — the seat is
        occupied and dead, and the board doesn’t say so. Classic windows are excluded:
        they have no metrics, so a null there is correct.
      </div>
      {err && <Muted text={err} />}
      {a && !a.ok && <Muted text={a.error ?? 'forbidden'} />}
      {a?.ok && (
        <>
          <div className="mono" style={{ ...mono, fontSize: 13, fontWeight: 700, marginBottom: 8, color: (a.total ?? 0) === 0 ? 'var(--you)' : 'var(--warn)' }}>
            {(a.total ?? 0) === 0
              ? '✓ none — every fielded pick has a metric'
              : `${a.total} dead seat${a.total === 1 ? '' : 's'}${locked ? ` · ${locked} already LOCKED` : ''}`}
            {a.truncated && <span style={{ color: 'var(--faint)', fontWeight: 400 }}> (showing the first {a.picks?.length})</span>}
          </div>
          {/* An agent row should be impossible — autoLineup always assigns a
              metric — so it is called out rather than buried in the list. */}
          {!!a.agent_rows && (
            <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--opp)', marginBottom: 8, lineHeight: 1.5 }}>
              ⚠ {a.agent_rows} of these sit on an AI seat, which autoLineup should make impossible —
              something nulled the metric AFTER the worker wrote it.
            </div>
          )}
          {(a.by_team ?? []).map((t) => (
            <div key={`${t.league}/${t.team}`} className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--dim)', padding: '3px 0', borderTop: '1px solid var(--bd)' }}>
              {t.league} · <b style={{ color: 'var(--text)' }}>{t.team}</b>
              {t.controller === 'ai' ? ' 🤖' : ''} — {t.n}{t.locked ? ` (${t.locked} locked)` : ''}
            </div>
          ))}
          {(a.picks ?? []).slice(0, 25).map((p) => (
            <div key={`${p.league}-${p.week}-${p.win}-${p.slot}-${p.player_slug}`} className="mono"
              style={{ ...mono, fontSize: 11, color: 'var(--faint)', padding: '2px 0' }}>
              wk{p.week} {p.win}/{p.slot} · {p.player_slug} · {p.team}
              {p.locked && <span style={{ color: 'var(--opp)' }}> LOCKED</span>}
              {p.sibling_slots_with_metric > 0 && <span> · set up properly, lost this one</span>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// System health: ingest + resolve freshness, status mix. Polls every 10s.
function HealthPanel() {
  const [hp, setHp] = useState<AdminHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { try { setHp(await adminHealth()); setErr(null); } catch (e) { setErr(errMsg(e, 'load failed')); } };
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  const liveOn = (hp?.live_matchups ?? 0) > 0;
  // While games are live, a >90s gap since the last play ingest is suspicious.
  const ingestStale = liveOn && hp?.last_play_ingest && (Date.now() - new Date(hp.last_play_ingest).getTime()) > 90_000;
  // A null reads as "never synced", which is equally worth flagging — the
  // column is only NULL on rows written before 0122, or on no rows at all.
  const syncStale = !!hp && (!hp.last_lineup_sync || Date.now() - new Date(hp.last_lineup_sync).getTime() > 86_400_000);
  const stat = (label: string, value: React.ReactNode, color = 'var(--text)') => (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 9px', minWidth: 0 }}>
      <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--faint)', fontWeight: 700 }}>{label}</div>
      <div className="mono" style={{ ...mono, fontSize: 14, fontWeight: 700, color, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={h}>SYSTEM HEALTH{liveOn && <span style={{ color: 'var(--you)', marginLeft: 6 }}>● {hp!.live_matchups} LIVE</span>}</div>
        <button onClick={load} className="mono" style={{ ...linkBtn, fontSize: 11.5 }}>↻</button>
      </div>
      {err ? <Muted text={err} /> : !hp ? <Muted text="Loading…" /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 6 }}>
          {stat('LEAGUES', hp.leagues)}
          {stat('ENROLLED', hp.enrolled)}
          {stat('MATCHUPS', Object.entries(hp.matchups_by_status).map(([s, n]) => `${n} ${s}`).join(' · ') || '—')}
          {stat('LIVE PLAYS', `${hp.live_play_count}${hp.sim_play_count ? ` (${hp.sim_play_count} sim)` : ''}`)}
          {stat('LAST INGEST', ago(hp.last_play_ingest), ingestStale ? 'var(--opp)' : liveOn ? 'var(--you)' : 'var(--text)')}
          {stat('LAST RESOLVE', ago(hp.last_state_update))}
          {/* The one that means something between slates. Ingest and resolve
              only move during games, so out of season hours they read stale on
              a perfectly healthy worker; the weekly sync runs on boot and every
              few hours regardless. Amber past a day — the sync's own refresh is
              6h, so a day of silence is the worker, not the schedule. */}
          {stat('LAST SYNC', ago(hp.last_lineup_sync), syncStale ? 'var(--warn)' : 'var(--text)')}
        </div>
      )}
      {ingestStale && <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--opp)', marginTop: 8 }}>⚠ games are live but no play ingested in over 90s — check the poller.</div>}
      {syncStale && <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--opp)', marginTop: 8 }}>⚠ no lineup sync in over a day — the worker may not be running (fly.io → drip-pilot-worker).</div>}
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
  const load = async () => { try { setRows(await adminPickReadiness(leagueId, week)); } catch (e) { setBusy(errMsg(e, 'load failed')); } };
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
    } catch (e) { setBusy(errMsg(e, 'autofill failed')); }
  };
  const clear = async (m: PickReadiness, side: 'home' | 'away') => {
    const s = side === 'home' ? m.home : m.away;
    if (!s.app_user_id) return;
    if (!confirm(`Clear ${s.team}'s picks for this matchup?`)) return;
    setBusy('clear…');
    try { await adminClearPicks(m.matchup_id, s.app_user_id); setBusy(`✓ cleared ${s.team}`); await load(); }
    catch (e) { setBusy(errMsg(e, 'clear failed')); }
  };
  const toggleAi = async (m: PickReadiness, side: 'home' | 'away') => {
    const s = side === 'home' ? m.home : m.away;
    const next: Controller = s.controller === 'ai' ? 'human' : 'ai';
    setBusy('ai…');
    try { const r = await setTeamController(leagueId, s.roster_id, next); setBusy(r.ok ? `✓ ${s.team} → ${next}` : (r.error ?? 'failed')); await load(); }
    catch (e) { setBusy(errMsg(e, 'ai toggle failed')); }
  };

  const sideRow = (m: PickReadiness, side: 'home' | 'away') => {
    const s = side === 'home' ? m.home : m.away;
    const st = SIDE_STATUS(s);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
        <span style={{ fontSize: 13.5, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.team ?? `roster ${s.roster_id}`}</span>
        <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: st.color, border: `1px solid ${st.color}`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{st.label}</span>
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
      <div className="mono" style={{ ...mono, fontSize: 12, color: empties ? 'var(--opp)' : 'var(--you)', marginBottom: 8 }}>
        week {week} · {empties ? `${empties} enrolled manager${empties > 1 ? 's' : ''} with NO lineup` : 'all enrolled managers have a lineup'}
      </div>
      {busy && <div className="mono" style={{ ...mono, fontSize: 12, color: busy.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginBottom: 6 }}>{busy}</div>}
      {rows.length === 0 ? <Muted text="No matchups this week (run sync week)." /> : rows.map((m) => (
        <div key={m.matchup_id} style={{ borderTop: '1px solid var(--bd)', padding: '6px 0' }}>
          <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginBottom: 2 }}>{m.home.team ?? `Roster ${m.home_roster_id}`} v {m.away.team ?? `Roster ${m.away_roster_id}`} · {m.status}</div>
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
      style={{ ...linkBtn, fontSize: 11.5, color: s === 'sent' ? 'var(--you)' : s === 'err' ? 'var(--opp)' : 'var(--dim)' }}
      title={`email a sign-in link to ${email}`}>
      {s === 'sent' ? '✓ link sent' : s === 'sending' ? '…' : s === 'err' ? 'failed' : '✉ send link'}
    </button>
  );
}

// A K or DST team picker — value is a '<team>-<suffix>' slug (or null = random).
// `taken` is the set of slugs already assigned to some team, so the picker can flag
// options that are already in use elsewhere (duplicates are allowed, not blocked).
function KdstSelect({ suffix, value, taken, onChange }: { suffix: 'k' | 'dst'; value: string | null; taken?: Set<string>; onChange: (v: string | null) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
      style={{ ...inp, padding: '3px 4px', fontSize: 12.5, width: 104 }} title={suffix === 'k' ? 'kicker team' : 'defense team'}>
      <option value="">{suffix === 'k' ? 'K · random' : 'DEF · random'}</option>
      {NFL_CODES.map((c) => {
        const slug = `${c}-${suffix}`;
        const isTaken = taken?.has(slug) && slug !== value;
        return <option key={c} value={slug}>{c.toUpperCase()} {suffix === 'k' ? 'K' : 'DEF'}{isTaken ? ' • taken' : ''}</option>;
      })}
    </select>
  );
}

// ── PLAYOFFS tab (native leagues, 0073): settings → standings/seeds →
// bracket → champion. advance_playoffs is idempotent, so every load calls it
// first — finished rounds roll forward without anyone pressing a button.
// ── Continuity (0185): REDRAFT / KEEPER / DYNASTY, in MODE & SEASON ──────────
// One selection; the number it needs appears beside it. Keeper takes a keeper
// count; dynasty takes rookie-draft rounds (keepers implied: everyone else)
// and deals every team's picks for the NEXT THREE SEASONS as tradeable assets.
// ── 📜 SALARY (0217–0220): the contract rulebook, web console ───────────────
// The same surface the app's MONEY → 📜 SALARY section drives: cap + max
// length (set_contract_rules), the seven-knob rulebook (set_salary_rules),
// and live payrolls against each team's own cap.
function SalaryPanel({ leagueId }: { leagueId: string }) {
  const [st, setSt] = useState<LeagueContracts | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cap, setCap] = useState('');
  const [years, setYears] = useState(4);
  const [dead, setDead] = useState('30');
  const [tagPct, setTagPct] = useState('20');
  const [extPct, setExtPct] = useState('85');
  const [retention, setRetention] = useState(true);
  const [capTrading, setCapTrading] = useState(false);
  const [irRelief, setIrRelief] = useState(false);
  const [rfa, setRfa] = useState(true);

  const load = async () => {
    const r = await leagueContracts(leagueId);
    setSt(r);
    if (r.contracts) {
      setCap(String(r.salary_cap ?? '')); setYears(r.years_max ?? 4);
      if (r.rules) {
        setDead(String(r.rules.dead_pct)); setTagPct(String(r.rules.tag_raise_pct)); setExtPct(String(r.rules.ext_discount_pct));
        setRetention(r.rules.retention); setCapTrading(r.rules.cap_trading);
        setIrRelief(r.rules.ir_relief); setRfa(r.rules.rfa);
      }
    }
  };
  useEffect(() => { load().catch((e) => setMsg(errMsg(e, 'load failed'))); /* eslint-disable-next-line */ }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setMsg(r.ok ? done : (r.error ?? 'that didn\u2019t work'));
      await load();
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };
  const saveCap = () => {
    const n = parseInt(cap, 10);
    if (!Number.isFinite(n) || n < 1) return;
    void act(() => setContractRules(leagueId, n, years), '\u2713 cap saved');
  };
  const saveRules = () => void act(() => setSalaryRules(leagueId, {
    deadPct: parseInt(dead, 10), tagRaisePct: parseInt(tagPct, 10), extDiscountPct: parseInt(extPct, 10),
    retention, capTrading, irRelief, rfa,
  }), '\u2713 salary rules saved');

  if (!st) return <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', marginTop: 12 }}>{msg ?? 'loading\u2026'}</div>;
  const on = !!st.contracts;
  const toggleBtn = (label: string, val: boolean, set: (v: boolean) => void) => (
    <button onClick={() => set(!val)} disabled={busy} className="mono"
      style={{ ...mono, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '5px 11px', borderRadius: RADIUS,
        color: val ? 'var(--on-accent)' : 'var(--dim)', background: val ? 'var(--you)' : 'var(--bg)',
        border: `1px solid ${val ? 'var(--you)' : 'var(--bd)'}` }}>{label}</button>
  );
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <LabelInfo label="SALARY CAP" style={{ marginBottom: 7 }}
          info={'With the cap on, every acquisition signs a contract: an auction win at its exact bid, a waiver win at its FAAB bid, a free-agent add at the $1 minimum, startup picks at the rookie scale ($12/$6/$3/$1 by round \u2014 rookie drafts deal scale contracts at the ROOKIE DEALS term below, default 4yr).\n\nManagers pick each deal\u2019s length while the draft room is open; after that only the commissioner can change one. A move that would land a team over its cap is refused whole.\n\nWhile an auction room is open the cap must cover the auction budget; once the draft completes it can be tightened. MAX LENGTH bounds every deal (default 4yr).'} />
        <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--dim)', marginBottom: 8 }}>
          {on ? `ON \u2014 $${st.salary_cap} cap \u00b7 deals up to ${st.years_max}yr \u00b7 ${(st.deals ?? []).length} signed`
              : 'OFF \u2014 this league plays without contracts. Set a cap to turn them on (or pick a \ud83d\udcdc CONTRACT league type in \ud83c\udfae MODE & SEASON, which presets everything).'}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>CAP $</span>
          <input value={cap} inputMode="numeric" onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))}
            style={{ ...inp, width: 76, textAlign: 'center' }} disabled={busy} />
          <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>MAX LENGTH</span>
          {[1, 2, 3, 4, 5, 6].map((y) => (
            <button key={y} onClick={() => setYears(y)} disabled={busy} className="mono"
              style={{ ...mono, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', padding: '4px 9px', borderRadius: RADIUS,
                color: years === y ? 'var(--on-accent)' : 'var(--dim)', background: years === y ? 'var(--you)' : 'var(--bg)',
                border: `1px solid ${years === y ? 'var(--you)' : 'var(--bd)'}` }}>{y}YR</button>
          ))}
          <button onClick={saveCap} disabled={busy || !parseInt(cap, 10)} className="mono" style={{ ...btn(true), fontSize: 11.5 }}>
            {on ? 'update' : 'turn contracts on'}
          </button>
          {on && <button onClick={() => void act(() => setContractRules(leagueId, null), '\u2713 contracts off')} disabled={busy}
            className="mono" style={{ ...linkBtn, fontSize: 11.5, color: 'var(--opp)' }}>turn off</button>}
        </div>
      </div>
      {on && (
        <div>
          <LabelInfo label="SALARY RULES" style={{ marginBottom: 7 }}
            info={'The optional mechanics, each behind its own switch. Every one of these prints in the league register when it happens.'} />
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            {([
              ['DEAD MONEY %', dead, setDead, 'Cut a player on a multi-year deal and this share of your part of his salary stays on your books for the deal\u2019s remaining life \u2014 the roster-paralysis risk that makes long deals a real bet. Expiring (1-year) deals cut free. 0 turns the penalty off.'],
              ['TAG RAISE %', tagPct, setTagPct, 'The franchise tag: one per team per offseason, re-signing an EXPIRING deal for one more year at whichever is higher \u2014 the league\u2019s top-5 positional salary average, or last salary plus this raise.'],
              ['EXT. DISCOUNT %', extPct, setExtPct, 'Offseason extensions re-sign an expiring deal for 1\u20133 years at this share of the league\u2019s own market value (the top-5 positional salary average). The loyalty discount \u2014 cheaper than fighting the market for him.'],
            ] as const).map(([lbl, v, set, info]) => (
              <span key={lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)' }}>{lbl}</span>
                <InfoChip title={lbl} info={info} />
                <input value={v} inputMode="numeric" maxLength={3} onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
                  style={{ ...inp, width: 52, textAlign: 'center' }} disabled={busy} />
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)' }}>ROOKIE DEALS</span>
            <InfoChip title="ROOKIE DEALS" info={'Every rookie-draft pick signs a scale contract ($12/$6/$3/$1 by round) for this many years \u2014 default 4, the NFL\u2019s own rookie term. Managers never set rookie lengths; the scale does. Clamped to the league\u2019s max contract length; applies to picks made after the change.'} />
            {Array.from({ length: st.years_max ?? 4 }, (_, i) => i + 1).map((y) => (
              <button key={y} disabled={busy} className="mono"
                onClick={() => void act(() => setRookieYears(leagueId, y), `\u2713 rookie deals sign for ${y}yr`)}
                style={{ ...btn((st.rules?.rookie_years ?? 4) === y), fontSize: 11 }}>{y}YR</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {toggleBtn('\u21c4 RETENTION', retention, setRetention)}
            <InfoChip title={'\u21c4 RETENTION'} info={'In a trade, the sender may keep eating part of a traded salary ($1 up to salary\u22121). The receiver pays the net; the retained \u201cghost\u201d stays on the sender\u2019s cap for the deal\u2019s life \u2014 and hardens into dead money if the deal is later cut. This is what makes salary dumps and contender discounts work.'} />
            {toggleBtn('\ud83d\udcb5 CAP TRADING', capTrading, setCapTrading)}
            <InfoChip title={'\ud83d\udcb5 CAP TRADING'} info={'Raw cap dollars move in trades like a draft pick \u2014 \u201cI\u2019ll take your bad contract for $15 of your cap.\u201d Plenty of leagues ban cash trading, so it defaults OFF.'} />
            {toggleBtn('\ud83c\udfe5 IR RELIEF', irRelief, setIrRelief)}
            <InfoChip title={'\ud83c\udfe5 IR RELIEF'} info={'A player parked on IR comes off his team\u2019s books until he\u2019s activated \u2014 temporary cap space to sign a replacement, the way the real league does it.'} />
            {toggleBtn('\ud83e\udea7 RFA', rfa, setRfa)}
            <InfoChip title={'\ud83e\udea7 RFA'} info={'Restricted free agency, in the offseason: an owner TENDERS an expiring player to the market, rivals bid salary and years (their cap is checked at bid time), and the owner MATCHES the best offer to keep him at that price \u2014 or lets him walk with the re-priced deal. Unresolved tenders lapse at rollover.'} />
            <button onClick={saveRules} disabled={busy} className="mono" style={{ ...btn(true), fontSize: 11.5 }}>save rules</button>
          </div>
        </div>
      )}
      {on && (st.payrolls ?? []).length > 0 && (
        <div>
          <LabelInfo label="PAYROLLS" style={{ marginBottom: 7 }}
            info={'Each team\u2019s committed salary against its own cap: deals held (minus salary retained by former teams, minus IR\u2019d salary when relief is on) + retained ghosts + dead money. \u201ccap +$N by trade\u201d marks room moved through cap trading. Over-cap teams show red \u2014 they can\u2019t add anyone until they\u2019re back under.'} />
          {(st.payrolls ?? []).map((p) => {
            const teamCap = p.cap ?? st.salary_cap ?? 0;
            const room = teamCap - p.payroll;
            return (
              <div key={p.roster_id} className="mono" style={{ ...mono, fontSize: 11.5, display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
                <span style={{ flex: 1, color: 'var(--text)' }}>{p.team ?? `Roster ${p.roster_id}`}{p.cap_adjust ? ` (cap ${p.cap_adjust > 0 ? '+' : ''}$${p.cap_adjust} by trade)` : ''}</span>
                <span style={{ fontWeight: 700, color: room < 0 ? 'var(--opp)' : 'var(--text)' }}>${p.payroll} / ${teamCap}</span>
                <span style={{ color: room < 0 ? 'var(--opp)' : 'var(--faint)', width: 84, textAlign: 'right' }}>{room < 0 ? `$${-room} OVER` : `$${room} room`}</span>
              </div>
            );
          })}
        </div>
      )}
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('\u2713') ? 'var(--you)' : 'var(--warn)' }}>{msg}</div>}
    </div>
  );
}

function ContinuityEditor({ leagueId }: { leagueId: string }) {
  const [st, setSt] = useState<KeeperState | null>(null);
  const [mode, setMode] = useState<LeagueContinuity>('redraft');
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    const s = await keeperState(leagueId);
    if (s.error || !s.ok) { setMsg(s.error ?? 'could not load'); return; }
    setSt(s);
    const m = s.continuity ?? 'redraft';
    setMode(m);
    setN(m === 'keeper' ? String(s.keeper_count) : isDynastyContinuity(m) ? String(s.rookie_rounds ?? 3) : '');
  };
  useEffect(() => { load().catch((e) => setMsg(errMsg(e, 'load failed'))); /* eslint-disable-next-line */ }, [leagueId]);
  if (!st) return null;

  const rolled = !!st.rolled_league_id;
  const pick = (m: LeagueContinuity) => {
    if (busy || rolled) return;
    setMode(m); setMsg(null);
    setN(m === 'keeper' ? String(st.keeper_count || Math.min(4, st.roster_size - 1))
       : isDynastyContinuity(m) ? String(st.rookie_rounds || 3) : '');
  };
  const save = async () => {
    if (busy || rolled) return;
    const num = parseInt(n, 10);
    const needsN = mode === 'keeper' || isDynastyContinuity(mode);
    if (needsN && Number.isNaN(num)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await setLeagueContinuity(leagueId, mode,
        mode === 'keeper' || isDynastyContinuity(mode) ? num : null);
      setMsg(r.ok ? '✓ saved' : (r.error ?? 'that didn’t work'));
      await load();
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };
  const chipBtn = (m: LeagueContinuity, lbl: string) => (
    <button onClick={() => pick(m)} disabled={busy || rolled} className="mono"
      style={{ ...mono, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', cursor: rolled ? 'default' : 'pointer',
        color: mode === m ? 'var(--on-accent)' : 'var(--dim)', background: mode === m ? 'var(--you)' : 'var(--bg)',
        border: `1px solid ${mode === m ? 'var(--you)' : 'var(--bd)'}`, borderRadius: RADIUS, padding: '5px 11px',
        opacity: rolled ? 0.6 : 1 }}>{lbl}</button>
  );

  return (
    <div>
      <div style={subhead}>NEXT SEASON · CONTINUITY</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {chipBtn('redraft', 'REDRAFT')}
        {chipBtn('keeper', '★ KEEPER')}
        {chipBtn('dynasty', '🏰 DYNASTY')}
        {chipBtn('contract', '📜 CONTRACT')}
        {chipBtn('contract_dynasty', '📜🏰 CONTRACT DYNASTY')}
        {mode === 'keeper' && <>
          <input value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            disabled={busy || rolled} style={{ ...inp, width: 48, textAlign: 'center' }} />
          <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>keepers of {st.roster_size}</span>
        </>}
        {isDynastyContinuity(mode) && <>
          <input value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            disabled={busy || rolled} style={{ ...inp, width: 48, textAlign: 'center' }} />
          <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>rookie rounds / season</span>
        </>}
        <button onClick={save} disabled={busy || rolled} className="mono" style={{ ...btn, fontSize: 11.5 }}>save</button>
      </div>
      <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
        {rolled
          ? 'This season already rolled over — continuity is set on the new league.'
          : mode === 'redraft'
            ? 'Every season starts fresh — a full draft, nothing carries over.'
            : mode === 'keeper'
              ? 'Each team carries that many players into next season and redrafts the rest. Managers declare keepers on their TEAM screen; undeclared seats keep their best-ranked.'
              : mode === 'contract'
                ? 'A salary-cap league: auction bids become salaries and the cap turns on at the auction budget (tune it in 📜 CONTRACTS & CAP). Switching to a plain type turns contracts off.'
                : mode === 'contract_dynasty'
                  ? 'Contracts AND dynasty: bids become salaries, the cap turns on, rookies sign scale deals (4yr default \u2014 a \ud83d\udcdc SALARY setting) — plus the rookie rounds and the three-season pick horizon below.'
                  : 'Teams keep everyone except the rookie-draft spots and draft rookies each year. Saving deals every team’s picks for the NEXT THREE SEASONS as tradeable assets — see them in 🔁 NEXT SEASON.'}
      </div>
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--warn)', marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

// ── Dynasty (0182): keepers + the rollover into next season ──────────────────
// The rollover names the game it carries (v0.251.0 rule) — the confirm and the
// success line both say DRIP or NORMAL out loud.
function DynastyPanel({ leagueId, leagueName }: { leagueId: string; leagueName: string | null }) {
  const [st, setSt] = useState<KeeperState | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [rookieOnly, setRookieOnly] = useState(false);
  const [picks, setPicks] = useState<PickAssetRow[]>([]);
  const [futureSeason, setFutureSeason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const seeded = useRef(false);
  const load = async () => {
    const s = await keeperState(leagueId);
    if (s.error || !s.ok) { setMsg(s.error ?? 'could not load'); return; }
    setSt(s);
    // a dynasty league's rollover IS the rookie draft — default the toggle on,
    // once, leaving the commissioner's own flips alone afterward
    if (!seeded.current) { seeded.current = true; setRookieOnly(isDynastyContinuity(s.continuity)); }
    const a = await pickAssets(leagueId).catch(() => null);
    if (a?.ok) { setPicks(a.picks); setFutureSeason(a.future_season); }
  };
  useEffect(() => { load().catch((e) => setMsg(errMsg(e, 'load failed'))); /* eslint-disable-next-line */ }, [leagueId]);
  useEffect(() => {
    leaguePool(leagueId)
      .then((ps) => setNames(Object.fromEntries(ps.map((p) => [p.slug, p.full_name]))))
      .catch(() => {});
  }, [leagueId]);
  if (!st) return <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', marginTop: 12 }}>{msg ?? 'loading…'}</div>;

  const modeName = st.game_mode === 'classic' ? '🏈 NORMAL' : '◈ DRIP';
  const rolled = !!st.rolled_league_id;
  const drafted = st.draft_status === 'complete';
  // the Super Bowl gate (0185): the rollover appears when the season is over
  const canRoll = !!st.season_over || !!st.admin;
  const playerName = (s: string) => names[s] ?? s;
  const teamNameOf = (rid: number) => st.teams.find((t) => t.roster_id === rid)?.team ?? `Team ${rid}`;
  const futurePicks = futureSeason == null ? [] : picks.filter((p) => p.season >= futureSeason);
  const contName = st.continuity === 'contract_dynasty' ? '📜🏰 CONTRACT DYNASTY'
    : st.continuity === 'contract' ? '📜 CONTRACT'
    : st.continuity === 'dynasty' ? '🏰 DYNASTY' : st.continuity === 'keeper' ? '★ KEEPER' : 'REDRAFT';
  const roll = async () => {
    if (busy || !st.next_season) return;
    const keeps = st.keeper_count > 0 ? `every team keeps its ${st.keeper_count} (declared first, best-ranked fill the rest), and the draft runs ${st.roster_size - st.keeper_count} rounds` : 'every roster redrafts in full';
    if (!window.confirm(`Roll “${leagueName ?? 'this league'}” into ${st.next_season} as a ${modeName} league?\n\nSame settings, scoring and seats; ${keeps}${rookieOnly ? '; the draft pool is pinned ROOKIES-ONLY (reseed the pool from the draft room before starting)' : ''}. Wallets start the new season fresh. This season's league stays as history.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await rolloverLeague(leagueId, 14, rookieOnly);
      setMsg(r.ok
        ? `✓ rolled into ${r.season} — a ${r.game_mode === 'classic' ? '🏈 NORMAL' : '◈ DRIP'} league, ${r.kept} keepers carried, ${r.draft_rounds}-round draft pending. Invite code ${r.invite_code}.`
        : (r.error ?? 'that didn’t work'));
      await load();
    } catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: st.continuity === 'redraft' ? 'var(--dim)' : 'var(--you)', border: `1px solid ${st.continuity === 'redraft' ? 'var(--bd)' : 'var(--you)'}`, borderRadius: 4, padding: '3px 8px' }}>{contName}{st.continuity !== 'redraft' ? ' LEAGUE' : ''}</span>
        <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginLeft: 8 }}>
          {st.continuity === 'redraft'
            ? 'nothing carries over — switch under 🎮 MODE & SEASON'
            : st.continuity === 'keeper'
              ? `each team keeps ${st.keeper_count} of ${st.roster_size} — change under 🎮 MODE & SEASON`
              : `${st.rookie_rounds ?? 0}-round rookie drafts · each team keeps ${st.keeper_count} of ${st.roster_size} — change under 🎮 MODE & SEASON`}
        </span>
      </div>
      {st.keeper_count > 0 && (
        <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5 }}>
          Managers declare their keepers on their TEAM screen once the season’s draft is done. A seat that declares nothing keeps its best-ranked players automatically.
        </div>
      )}

      {st.keeper_count > 0 && (
        <div>
          <div style={subhead}>WHO KEEPS WHOM {rolled ? '(as carried)' : '(as of now)'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {st.teams.map((t) => (
              <div key={t.roster_id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, minWidth: 110 }}>{t.team ?? `Team ${t.roster_id}`}</span>
                {t.keep.length === 0
                  ? <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)' }}>rosters arrive at the draft</span>
                  : t.keep.map((k) => (
                    <span key={k.slug} className="mono" style={{ ...chip, fontSize: 11 }} title={k.declared ? 'declared by the manager' : 'auto: best by rank'}>
                      {k.declared ? '★ ' : ''}{playerName(k.slug)}
                    </span>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {futurePicks.length > 0 && (
        <div>
          <div style={subhead}>ROOKIE DRAFT PICKS · WHO OWNS WHAT</div>
          <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 8 }}>
            Every team’s picks for the next three seasons, dealt as TRADEABLE assets — they move in ordinary trades, and the rollover carries ownership into each season’s rookie draft.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {st.teams.map((t) => {
              const owned = futurePicks.filter((p) => p.owner === t.roster_id);
              return (
                <div key={t.roster_id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, minWidth: 110 }}>{t.team ?? `Team ${t.roster_id}`}</span>
                  {owned.length === 0
                    ? <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--opp)' }}>traded every pick away</span>
                    : owned.map((p) => (
                      <span key={`${p.season}:${p.round}:${p.orig}`} className="mono" style={{ ...chip, fontSize: 11 }}
                        title={p.orig !== p.owner ? `acquired — originally ${teamNameOf(p.orig)}’s slot` : 'own pick'}>
                        ’{p.season.slice(2)} R{p.round}{p.orig !== p.owner ? ` ⇄ ${teamNameOf(p.orig)}` : ''}
                      </span>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div style={subhead}>ROLL INTO {st.next_season ?? 'NEXT SEASON'}</div>
        {rolled ? (
          <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--you)' }}>
            ✓ this season already rolled into {st.next_season}. Open the new league from LEAGUES to run its draft.
          </div>
        ) : !drafted ? (
          <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)' }}>
            The rollover opens once this season’s draft is complete.
          </div>
        ) : !canRoll ? (
          // the Super Bowl gate (0185): the option APPEARS when the season ends
          <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', lineHeight: 1.5 }}>
            🏈 The rollover opens after the Super Bowl{st.next_season ? ` (Feb 15, ${st.next_season})` : ''}. Keeper declarations and pick trades run all season — the roll into {st.next_season ?? 'next season'} appears here when the season is over.
          </div>
        ) : (
          <>
            <label className="mono" style={{ ...mono, fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={rookieOnly} onChange={(e) => setRookieOnly(e.target.checked)} disabled={busy} />
              rookie draft — next season’s pool is pinned to first-year players (reseed the pool from the draft room before starting it)
            </label>
            {st.admin && !st.season_over && (
              <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--warn)', marginBottom: 6 }}>
                ⚠ admin bypass — the season isn’t over yet; commissioners see this button after the Super Bowl
              </div>
            )}
            <button onClick={roll} disabled={busy} className="mono"
              style={{ ...btn, fontSize: 12, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--you)', borderColor: 'var(--you)' }}>
              {busy ? '…' : `🔁 ROLL INTO ${st.next_season ?? '—'} · ${modeName}`}
            </button>
            <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
              Creates the {st.next_season} league: same settings and seats, keepers on the rosters, a fresh {st.keeper_count > 0 ? `${st.roster_size - st.keeper_count}-round` : 'full'} draft waiting, schedule generated. Coin wallets start fresh — the weekly budget funds the new season.
            </div>
          </>
        )}
      </div>

      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--warn)' }}>{msg}</div>}
    </div>
  );
}

function PlayoffPanel({ leagueId }: { leagueId: string }) {
  const [st, setSt] = useState<PlayoffState | null>(null);
  const [teams, setTeams] = useState(4);
  const [startWeek, setStartWeek] = useState(15);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // The commish can reorder seeding before generating; defaults to standings.
  const [seedOrder, setSeedOrder] = useState<number[] | null>(null);
  const load = async () => {
    // The season closes itself (0162): the auto-generate poke rides next to
    // the advance poke — builds round 1 when the last reg-season game is final.
    await autoGeneratePlayoffs(leagueId).catch(() => {});
    await advancePlayoffs(leagueId).catch(() => {});
    const s = await playoffState(leagueId);
    if (s.error || !s.ok) { setMsg(s.error ?? 'could not load playoffs'); return; }
    setSt(s); setTeams(s.playoff_teams); setStartWeek(s.playoff_start_week);
    setSeedOrder((cur) => cur ?? s.standings.map((x) => x.roster_id));
  };
  useEffect(() => { load().catch((e) => setMsg(errMsg(e, 'load failed'))); /* eslint-disable-next-line */ }, [leagueId]);
  if (!st) return <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', marginTop: 12 }}>{msg ?? 'loading playoffs…'}</div>;

  const teamName = (rid: number) => st.standings.find((s) => s.roster_id === rid)?.team ?? `Team ${rid}`;
  const seedOf = (rid: number) => { const i = (st.seeds ?? []).indexOf(rid); return i >= 0 ? i + 1 : null; };
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg(r.ok ? '✓ done' : (r.error ?? 'that didn’t work')); await load(); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };
  const rounds: PlayoffMatchup[][] = [];
  const conRounds: PlayoffMatchup[][] = [];
  for (const m of st.matchups) { ((m.consolation ? conRounds : rounds)[m.round - 1] ??= []).push(m); }
  const standingsIds = st.standings.map((x) => x.roster_id);
  const order = seedOrder ?? standingsIds;
  const customOrder = order.join(',') !== standingsIds.join(',');
  const moveSeed = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = order.slice(); [next[i], next[j]] = [next[j], next[i]];
    setSeedOrder(next);
  };
  const toggle = (on: boolean, label: string, onClick: () => void, off = false) => (
    <button onClick={onClick} disabled={off} className="mono" style={{ ...mono, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', cursor: off ? 'default' : 'pointer', opacity: off ? 0.5 : 1, color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: RADIUS, padding: '4px 10px' }}>{label}</button>
  );
  const side = (m: PlayoffMatchup, rid: number, score: number | null) => {
    const won = m.winner === rid;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
        <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)', width: 14 }}>{seedOf(rid) ? `#${seedOf(rid)}` : ''}</span>
        <span style={{ fontSize: 13.5, fontWeight: won ? 700 : 400, color: won ? 'var(--you)' : 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamName(rid)}{won ? ' ✓' : ''}</span>
        <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: won ? 'var(--you)' : 'var(--dim)' }}>{score != null ? Number(score).toFixed(0) : '—'}</span>
      </div>
    );
  };
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {st.champion != null && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--you)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: '12px 14px' }}>
          <span className="grotesk" style={{ fontSize: 17.5, fontWeight: 700, color: 'var(--you)' }}>🏆 {st.champion_team ?? teamName(st.champion)} — league champion</span>
        </div>
      )}
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{msg}</div>}

      <div>
        <div style={subhead}>PLAYOFF SETTINGS</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>TEAMS</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
              {[2, 4, 6, 8].map((n) => toggle(teams === n, String(n), () => setTeams(n), st.underway))}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>START WEEK</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5, opacity: st.underway ? 0.5 : 1 }}>
              <button onClick={() => !st.underway && setStartWeek(Math.max(2, startWeek - 1))} className="mono" style={stepBtnStyle}>−</button>
              <span className="grotesk" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', minWidth: 24, textAlign: 'center' }}>{startWeek}</span>
              <button onClick={() => !st.underway && setStartWeek(Math.min(18, startWeek + 1))} className="mono" style={stepBtnStyle}>＋</button>
            </div>
          </div>
          {!st.underway && (
            <button onClick={() => run(() => setPlayoffRules(leagueId, teams, startWeek))} disabled={busy} className="mono" style={btn(true)}>✓ save</button>
          )}
          {!st.underway && (
            <button onClick={() => run(() => generatePlayoffs(leagueId, order.slice(0, teams)))} disabled={busy} className="mono" style={btn(true)}>
              {st.generated ? '↻ regenerate bracket' : '🏆 generate bracket'}
            </button>
          )}
          {st.underway && <span className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--warn)' }}>playoffs underway — settings locked</span>}
        </div>
        <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
          Seeding = regular-season standings (wins, then points-for). Higher seeds host; a 6-team bracket gives the top two seeds byes; ties advance the better seed. Rounds are one week apart from the start week; finished rounds roll forward automatically.
        </div>
      </div>

      {st.generated && rounds.length > 0 && (
        <div>
          <div style={subhead}>BRACKET</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {rounds.map((ms, ri) => (
              <div key={ri} style={{ flex: '1 1 180px', minWidth: 170, maxWidth: 260 }}>
                <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700, marginBottom: 6 }}>
                  {ms[0]?.label?.toUpperCase() ?? `ROUND ${ri + 1}`} · WK {ms[0]?.week}
                </div>
                {ms.map((m) => (
                  <div key={m.id} style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 9px', marginBottom: 8 }}>
                    {side(m, m.home, m.home_final)}
                    <div style={{ borderTop: '1px solid var(--bd)' }} />
                    {side(m, m.away, m.away_final)}
                    <div className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>{m.status.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {st.generated && ((st.consolation ?? []).length > 0 || conRounds.some((r) => r?.length)) && (
        <div>
          <div style={subhead}>CONSOLATION LADDER</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {conRounds.map((ms, ri) => ms?.length ? (
              <div key={ri} style={{ flex: '1 1 180px', minWidth: 170, maxWidth: 260 }}>
                <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700, marginBottom: 6 }}>WK {ms[0].week}</div>
                {ms.map((m) => (
                  <div key={m.id} style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 9px', marginBottom: 8 }}>
                    {m.label && m.label !== 'Consolation' && <div className="mono" style={{ ...mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', marginBottom: 2 }}>{m.label.toUpperCase()}</div>}
                    {side(m, m.home, m.home_final)}
                    <div style={{ borderTop: '1px solid var(--bd)' }} />
                    {side(m, m.away, m.away_final)}
                    <div className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>{m.status.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            ) : null)}
            <div style={{ flex: '1 1 150px', minWidth: 140 }}>
              <div className="mono" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700, marginBottom: 6 }}>LADDER{st.champion != null ? ' (FINAL)' : ''}</div>
              {(st.consolation ?? []).map((rid, i) => (
                <div key={rid} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
                  <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--dim)', width: 20 }}>{teams + i + 1}.</span>
                  <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{teamName(rid)}</span>
                </div>
              ))}
              <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>Winners climb a rung each week; playoff losers join at the top as they fall.</div>
            </div>
          </div>
        </div>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={subhead}>SEEDING{st.underway ? ' (LOCKED)' : ''}</div>
          {customOrder && !st.underway && <>
            <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--warn)' }}>CUSTOM ORDER</span>
            <button onClick={() => setSeedOrder(standingsIds)} className="mono" style={{ ...linkBtn, fontSize: 11.5 }}>↺ back to standings</button>
          </>}
        </div>
        {order.map((rid, i) => {
          const row = st.standings.find((x) => x.roster_id === rid);
          const seeded = i < teams;
          return (
            <div key={rid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
              <span className="mono" style={{ ...mono, fontSize: 11.5, fontWeight: 700, color: seeded ? 'var(--you)' : 'var(--faint)', width: 22 }}>{seeded ? `#${i + 1}` : '—'}</span>
              <span style={{ fontSize: 13.5, color: 'var(--text)', flex: 1, fontWeight: seeded ? 700 : 400 }}>{row?.team ?? `Team ${rid}`}</span>
              <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--dim)', width: 52, textAlign: 'right' }}>{row ? `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}` : ''}</span>
              <span className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', width: 64, textAlign: 'right' }}>{row ? `PF ${Number(row.pf).toFixed(0)}` : ''}</span>
              {!st.underway && <>
                <button onClick={() => moveSeed(i, -1)} className="mono" style={{ ...linkBtn, padding: '0 3px' }}>↑</button>
                <button onClick={() => moveSeed(i, 1)} className="mono" style={{ ...linkBtn, padding: '0 3px' }}>↓</button>
              </>}
            </div>
          );
        })}
        <div className="mono" style={{ ...mono, fontSize: 11.5, color: 'var(--faint)', marginTop: 6 }}>
          {st.underway ? 'Seeds locked into the bracket.'
            : `Top ${teams} make the playoffs — everyone else starts on the consolation ladder. Use ↑↓ to override the seeding before generating.`}
        </div>
      </div>
    </div>
  );
}
