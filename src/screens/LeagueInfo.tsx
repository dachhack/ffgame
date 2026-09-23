// The league's reference panels, web (0186 / v0.274.0) — the twins of the
// app's ui/LeagueInfo.tsx: SCORING, ROSTER RULES and the REGISTER, read-only
// for every member. The commissioner edits the same facts in ⚑ Manage league;
// these exist so a manager can look up how the league scores, what it allows,
// and who moved whom, without being handed the editors.
import { useEffect, useState } from 'react';
import {
  leagueGameMode, rosterRules, leagueRegister, playerFlags, leagueScoringGet,
  leagueInvite, leagueListingState, postLeagueListing, closeLeagueListing, friendlyError,
  requestLeagueSync, leagueSyncState, type SyncState,
  apiKeys, apiKeyCreate, apiKeyRevoke, apiWriteLog, publicApiUrl, type ApiKeyRow, type ApiWriteLogRow,
  type GameModeInfo, type RegisterRow, type PlayerFlagRow, type FlagRulesRaw,
} from '@drip/core/data/liveApi';
import { inviteLink, inviteMessage, previewLink } from '@drip/core/data/invite';
import { waiverDaysOf, waiverScheduleLine, holdLine } from '@drip/core/data/waiverDays';
import { CopyId } from './CommishDesk';
import { parseScoring, scopedRuleLabel, scoringIsDefault, type LeagueScoring } from '@drip/core/engine/leagueScoring';
import { CLASSIC_SCORING_SECTIONS, normalizeClassicScoring, leagueSlotDefs, slotDisplayNames, leagueBestball, slotFilterLabel } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { shortName } from '@drip/core/data/players';
import { slugMeta, stripSlugTag } from '@drip/core/data/slugMeta';

const panel: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8,
  padding: '10px 14px 14px', marginTop: -4,
};
/** BARE drops the panel's own card (v0.296.3). These render inside a Sheet
 *  now, and a bordered box inside a bordered card is two frames around one
 *  picture — the app's sheets hold the content itself, not a card of it. */
const box = (bare?: boolean): React.CSSProperties => (bare ? {} : panel);
/** Minutes-since-midnight-ET → "3:30am". */
const fmtEt = (m: number): string => {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`;
};
const prettySlug = (slug: string): string => {
  if (slug.endsWith('-dst')) return `${slugMeta(slug).team} D/ST`;
  if (slug.endsWith('-k')) return `${slugMeta(slug).team} K`;
  return shortName(stripSlugTag(slug).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '));
};

/** A flag's rules (0144) in plain English — scoring first, then what he may
 *  not do. Empty when a flag is only a label. */
function flagRuleWords(r?: FlagRulesRaw | null): string[] {
  if (!r) return [];
  const out: string[] = [];
  if (r.bonus_mult != null && r.bonus_mult !== 1) out.push(`×${r.bonus_mult} points`);
  if (r.bonus_pts != null && r.bonus_pts !== 0) out.push(`${r.bonus_pts > 0 ? '+' : ''}${r.bonus_pts} pts a week`);
  if (r.no_start) out.push("can't be started");
  if (r.no_add) out.push("can't be added");
  if (r.no_trade) out.push("can't be traded");
  if (r.no_powerups) out.push('no power-ups on him');
  if (r.immune) out.push('immune to power-ups');
  return out;
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
      <span className="mono" style={{ flex: 1, fontSize: 10, color: 'var(--dim)' }}>{k}</span>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: accent ? 'var(--you)' : 'var(--text)', textAlign: 'right' }}>{v}</span>
    </div>
  );
}
const Head = ({ children }: { children: string }) => (
  <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', margin: '14px 0 4px' }}>{children}</div>
);
const Loading = () => <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', padding: '14px 0' }}>Loading…</div>;

export function ScoringPanel({ leagueId, bare }: { leagueId: string; bare?: boolean }) {
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  // The commissioner's per-player rules (0144) score too — a ×2 on a player is
  // as much "how this league scores" as the pass-TD value.
  const [flags, setFlags] = useState<PlayerFlagRow[]>([]);
  // The commissioner's LAYERING knobs and scoped bonuses (0143/0145) — the
  // drip engine's real scoring settings, until now readable only from the
  // commish kit.
  const [adj, setAdj] = useState<LeagueScoring | null>(null);
  useEffect(() => {
    leagueGameMode(leagueId).then(setGm).catch(() => setGm({ ok: false }));
    playerFlags(leagueId).then((f) => { if (Array.isArray(f)) setFlags(f); }).catch(() => {});
    leagueScoringGet(leagueId).then((r) => { if (r?.ok) setAdj(parseScoring(r)); }).catch(() => {});
  }, [leagueId]);
  if (!gm) return <div style={box(bare)}><Loading /></div>;
  if (!gm.ok) return <div style={box(bare)}><span className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>Couldn’t load the scoring.</span></div>;

  const classic = gm.mode === 'classic';
  // Through leagueCatalogOf (0209) — it owns which of the two `ppr` homes
  // wins, and an inline spread here is exactly how that decision drifts.
  const sc = normalizeClassicScoring(leagueCatalogOf(gm));
  return (
    <div style={box(bare)}>
      <Row k="GAME MODE" v={classic ? '🏈 NORMAL' : '◈ DRIP'} accent />
      {!classic ? (
        // Not a dead end: the layering knobs below ARE this league's scoring.
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.7, marginTop: 12 }}>
          ◈ DRIP leagues score through the drip engine — live windows, drips and nukes, and whatever power-ups
          get played. The engine's own numbers are fixed (the rulebook has them); what this league layers on
          top is below.
        </div>
      ) : (
        <>
          <Row k="PER CATCH (PPR)" v={sc.ppr === 1 ? '1 pt · full' : sc.ppr === 0.5 ? '½ pt · half' : `${sc.ppr}`} accent />
          {CLASSIC_SCORING_SECTIONS.map((s) => {
            // Only what actually scores — a league sets a dozen values and
            // leaves fifty at zero; printing all of them buries the dozen.
            const live = s.fields.filter((f) => Number(sc[f.key]) !== 0);
            if (!live.length) return null;
            return (
              <div key={s.section}>
                <Head>{s.section}</Head>
                {live.map((f) => (
                  <Row key={String(f.key)} k={f.label}
                    v={`${Number(sc[f.key]) > 0 ? '+' : ''}${Number(sc[f.key])}${f.perYard ? ' / yd' : ''}`} />
                ))}
              </div>
            );
          })}
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 12 }}>Anything not listed scores 0 in this league.</div>
        </>
      )}
      <Adjustments adj={adj} classic={classic} />
      <CommishRules flags={flags} />
    </div>
  );
}

/** The commissioner's LAYERING knobs (0143) and SCOPED BONUSES (0145).
 *
 *  The SCOPED rules apply in BOTH modes as of v0.277.0 — classicPoints reads
 *  the same scopedAdjustFor sim.ts does, so one rule means one thing wherever
 *  it is scored. The three league-wide KNOBS stay drip-only (they layer on the
 *  drip engine's growth curves, which classic has no equivalent of), and a
 *  classic league that has them set is told so rather than left to assume. */
function Adjustments({ adj, classic }: { adj: LeagueScoring | null; classic: boolean }) {
  if (!adj || scoringIsDefault(adj)) return null;
  const knobs = adj.tdBonus !== 0 || adj.ydMult !== 1 || adj.toPenalty !== 0;
  return (
    <div>
      {knobs && (<>
        <Head>LEAGUE ADJUSTMENTS</Head>
        {classic ? (
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', lineHeight: 1.6 }}>
            This league has drip-engine adjustments stored (touchdown, yardage, turnover). They do not
            apply in 🏈 NORMAL mode — the scoring above is the whole of it. The scoped bonuses below DO.
          </div>
        ) : (<>
          {adj.tdBonus !== 0 && <Row k="EVERY TOUCHDOWN" v={`${adj.tdBonus > 0 ? '+' : ''}${adj.tdBonus} pts`} accent />}
          {adj.ydMult !== 1 && <Row k="ALL YARDAGE SCORING" v={`×${adj.ydMult}`} accent />}
          {adj.toPenalty !== 0 && <Row k="TURNOVER COMMITTED" v={`−${adj.toPenalty} pts`} accent />}
        </>)}
      </>)}
      {adj.scoped.length > 0 && (
        <>
          <Head>SCOPED BONUSES</Head>
          {adj.scoped.map((r, i) => {
            // The editor's own label, split: WHO it catches on the left, what
            // it DOES on the right — a list of these is scanned by scope first.
            const [who, does] = scopedRuleLabel(r).split(': ');
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
                <span className="mono" style={{ flex: 1, fontSize: 10, color: 'var(--text)' }}>{who}</span>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--you)' }}>{does}</span>
              </div>
            );
          })}
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 6, lineHeight: 1.6 }}>
            A player matches a rule only when he fits EVERY part of its scope. Rules stack — multipliers
            multiply, point bonuses add. These pay in both game modes.
          </div>
        </>
      )}
    </div>
  );
}

/** ⚑ The commissioner's own rules. Rendered under BOTH modes — a drip league
 *  has no stat table but can absolutely have a ×2 on somebody. Silent when
 *  nothing is flagged. */
function CommishRules({ flags }: { flags: PlayerFlagRow[] }) {
  const live = flags.filter((f) => flagRuleWords(f.rules).length > 0);
  if (!live.length) return null;
  return (
    <div>
      <Head>⚑ COMMISSIONER RULES</Head>
      {live.map((f) => (
        <div key={f.slug} style={{ padding: '6px 0', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{prettySlug(f.slug)}</span>
            {!!f.label && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--you)' }}>{f.label.toUpperCase()}</span>}
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 2 }}>{flagRuleWords(f.rules).join(' · ')}</div>
        </div>
      ))}
      <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8 }}>
        Set by the commissioner. These apply on top of the scoring above.
      </div>
    </div>
  );
}

/** One starting spot. Two things a plain Row can't say: 🎯 that the spot fills
 *  ITSELF (best ball, 0159), and ⓘ that it only accepts certain players (a
 *  0172 filter). The terms are one click away rather than always on screen —
 *  most spots have none, and a wall of "SF/SEA · 0–2 YRS" on the ones that do
 *  would drown the lineup shape. */
function SlotRow({ name, pos, bb, filter }: { name: string; pos: string[]; bb: boolean; filter: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--bd)', padding: '5px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{name}</span>
        {bb && <span title="best ball — fills itself with your best eligible scorer" style={{ fontSize: 9.5, color: 'var(--you)' }}>🎯</span>}
        {!!filter && (
          <button onClick={() => setOpen((v) => !v)} title="this spot only takes certain players" className="mono"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 9.5, fontWeight: 700, color: 'var(--you)' }}>ⓘ</button>
        )}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text)' }}>
          {pos.map((p) => (p === 'DEF' ? 'D/ST' : p)).join(' / ')}
        </span>
      </div>
      {open && !!filter && <div className="mono" style={{ fontSize: 9.5, color: 'var(--you)', marginTop: 3 }}>only {filter}</div>}
    </div>
  );
}

/** ── REFRESH FROM SLEEPER (0204, founder: "Can we let users do a manual
 *  refresh?") ───────────────────────────────────────────────────────────────
 *
 *  The worker mirrors Sleeper every 6 hours and ONLY for leagues in its
 *  PILOT_LEAGUE_IDS allowlist — so for most Sleeper leagues this is not a
 *  convenience, it is the only way their rosters ever move.
 *
 *  It draws nothing on a native league: `league_sync_state` answers whether
 *  there is an upstream at all, in the call the control already makes, and a
 *  button that can only ever say "nothing to refresh" is worse than no button.
 *
 *  A COOLDOWN REFUSAL IS NOT AN ERROR. The RPC answers ok:true, queued:false
 *  with the seconds remaining, and this renders it as plain information —
 *  nothing went wrong, the league simply refreshed a moment ago. */
export function SleeperRefresh({ leagueId }: { leagueId: string }) {
  const [st, setSt] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => leagueSyncState(leagueId).then(setSt).catch(() => setSt({ ok: false }));
  useEffect(() => { void load(); }, [leagueId]);
  // While a request is in flight, follow it — the worker answers on its own
  // ~25s tick, so the button has to keep looking rather than assume.
  useEffect(() => {
    if (!st?.pending) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [st?.pending, leagueId]);

  if (!st?.ok || !st.sleeper) return null;
  const wait = st.retry_in ?? 0;

  const press = async () => {
    setBusy(true); setMsg(null);
    const r = await requestLeagueSync(leagueId);
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? 'could not queue'); return; }
    if (!r.queued) { setMsg(`just refreshed — try again in ${r.retry_in ?? 0}s`); await load(); return; }
    setMsg('queued — the worker picks this up within about half a minute');
    await load();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      <button
        className="mono"
        onClick={() => void press()}
        disabled={busy || st.pending || wait > 0}
        style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '4px 9px',
          borderRadius: 5, border: '1px solid var(--bd)', background: 'var(--bg)',
          color: st.pending ? 'var(--faint)' : 'var(--you)',
          cursor: busy || st.pending || wait > 0 ? 'default' : 'pointer',
          opacity: busy || st.pending || wait > 0 ? 0.55 : 1,
        }}>
        {st.pending ? '↻ REFRESHING…' : wait > 0 ? `↻ WAIT ${wait}s` : '↻ REFRESH FROM SLEEPER'}
      </button>
      <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>
        {msg ?? (st.last_at
          ? `last ${st.last_ok === false ? 'attempt failed' : 'refreshed'} ${new Date(st.last_at).toLocaleString()}`
          : 'rosters mirror from Sleeper every few hours')}
      </span>
    </div>
  );
}

export function RosterRulesPanel({ leagueId, bare }: { leagueId: string; bare?: boolean }) {
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  const [rr, setRr] = useState<Awaited<ReturnType<typeof rosterRules>> | null>(null);
  useEffect(() => {
    leagueGameMode(leagueId).then(setGm).catch(() => setGm({ ok: false }));
    rosterRules(leagueId).then(setRr).catch(() => setRr({ ok: false }));
  }, [leagueId]);
  if (!gm || !rr) return <div style={box(bare)}><Loading /></div>;

  const defs = leagueSlotDefs({ roster: gm.roster ?? {}, slots: gm.slots ?? null });
  const names = slotDisplayNames(defs);
  const bb = new Set(leagueBestball(gm));
  const caps = Object.entries(rr.pos_caps ?? {}).filter(([, v]) => v != null);
  const mode = rr.waiver_mode ?? 'rolling';
  return (
    <div style={box(bare)}>
      <SleeperRefresh leagueId={leagueId} />
      <Head>ROSTER</Head>
      <Row k="ROSTER SIZE" v={`${rr.rounds ?? gm.rounds ?? '—'} players`} accent />
      <Row k="STARTING SPOTS" v={`${defs.length}`} />
      {!!gm.shape?.bench && <Row k="BENCH" v={`${gm.shape.bench}`} />}
      {!!gm.shape?.taxi && (
        <Row k="TAXI" v={`${gm.shape.taxi}${rr.taxi_max_exp != null ? ` · ≤ ${rr.taxi_max_exp} yr${rr.taxi_max_exp === 1 ? '' : 's'}` : ''}${rr.taxi_lock === false ? ' · never locks' : rr.taxi_locked_now ? ' · LOCKED' : ' · locks at kickoff'}`} />
      )}
      {!!gm.shape?.ir && <Row k="IR" v={`${gm.shape.ir}`} />}

      <Head>STARTING LINEUP</Head>
      {defs.map((d, i) => (
        <SlotRow key={d.slot} name={names[i]} pos={d.pos} bb={bb.has(d.slot)} filter={slotFilterLabel(d.flt)} />
      ))}
      {(bb.size > 0 || defs.some((d) => d.flt)) && (
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
          {bb.size > 0 ? '🎯 fills itself with your best eligible scorer. ' : ''}
          {defs.some((d) => d.flt) ? 'ⓘ marks a spot that only takes certain players — click it.' : ''}
        </div>
      )}

      {caps.length > 0 && (<>
        <Head>POSITION LIMITS</Head>
        {caps.map(([p, v]) => <Row key={p} k={p === 'DEF' ? 'D/ST' : p} v={`max ${v}`} />)}
      </>)}

      <Head>WAIVERS</Head>
      <Row k="MODE" v={mode === 'faab' ? 'FAAB blind bids' : mode === 'standings' ? 'reverse standings' : 'rolling priority'} accent />
      {mode === 'faab' && <Row k="SEASON BUDGET" v={`${rr.faab_budget ?? 100}`} />}
      {/* v0.462.0: core's own sentence, not "N days". Hold days count RUNS
          (0338), so a rolling league's stored 3 is a flat 24h — this row said
          "3 days" and the league did something else, which is the mismatch
          0337 and 0338 exist to stop. The unset default is 1, as the database
          has always read it; this said 2. */}
      <Row k="HOLD AFTER A DROP" v={holdLine(rr.waiver_clear_min_effective ?? null, rr.waiver_hold_days ?? 1)} />
      {/* 0337: the week, as one sentence. The three day-pickers this replaces
          could describe the same league three ways; core's waiverScheduleLine
          is the single reading both hosts print. */}
      <Row k="THE WEEK" v={waiverScheduleLine(waiverDaysOf(rr.waiver_days), rr.waiver_clear_min_effective ?? null, rr.waiver_game_hold_dow ?? null)} />

      <Head>FREE AGENCY</Head>
      <Row k="WINDOW" v={rr.fa_start_min == null || rr.fa_end_min == null ? 'as the week above says' : `${fmtEt(rr.fa_start_min)} – ${fmtEt(rr.fa_end_min)} ET`} />

      <Head>TRADES</Head>
      {/* 0321: the floor's rules, as the rulebook page states every other
          setting — the review mode, and the vote's numbers where it is one. */}
      <Row k="REVIEW" v={rr.trade_review === 'commish' ? 'commissioner approves'
        : rr.trade_review === 'league' ? `the league votes — ${rr.trade_veto_votes ?? 2} veto${(rr.trade_veto_votes ?? 2) === 1 ? '' : 'es'} in ${rr.trade_review_hours ?? 24}h kill a trade`
        : 'process immediately'} />
      <Row k="AN OFFER STANDS" v={rr.trade_offer_days ? `${rr.trade_offer_days} day${rr.trade_offer_days === 1 ? '' : 's'}` : 'until it is answered'} />
      {rr.waiver_mode === 'faab' && <Row k="FAAB TRADING" v={rr.faab_trading === false ? 'off' : 'on'} />}

      {/* THIS LEAGUE (v0.462.0). The id lived in exactly one place — inside
          the public API URL on the commissioner's own panel, only while the
          league was published — and the league route carries no id, so there
          was nowhere a MEMBER could get it at all. It is what you point a
          spreadsheet, a Discord bot or a rankings site at, so it belongs on
          the page that states every other fact about the league. */}
      <Head>THIS LEAGUE</Head>
      <div style={{ padding: '6px 0' }}><CopyId leagueId={leagueId} /></div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', lineHeight: 1.5 }}>
        What the public read API is addressed by. It is not a secret and it is not a password — it identifies the
        league, it does not unlock it, and what the API serves is only ever what this page already shows.
      </div>
    </div>
  );
}

const KIND: Record<RegisterRow['kind'], { icon: string; verb: string }> = {
  add: { icon: '✚', verb: 'signed' },
  drop: { icon: '✕', verb: 'dropped' },
  waiver: { icon: '⚑', verb: 'claimed off waivers' },
  trade: { icon: '⇄', verb: 'traded for' },
  commish: { icon: '⚑', verb: 'was moved by the commissioner to' },
  // the event vocabulary (0221/0222): formats and the front office
  elimination: { icon: '🔪', verb: 'fell to the guillotine' },
  release: { icon: '🔪', verb: 'released' },
  steal: { icon: '🧛', verb: 'stole' },
  tag: { icon: '🏷', verb: 'franchise tagged' },
  extension: { icon: '⤴', verb: 'extended' },
  rfa: { icon: '🪧', verb: 'answered the RFA on' },
  retained: { icon: '💸', verb: 'retains salary on' },
  cap: { icon: '💵', verb: 'received cap room' },
  faab: { icon: '💵', verb: 'received FAAB' },   // 0321: dollars traded like a pick
};
const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function RegisterPanel({ leagueId, bare }: { leagueId: string; bare?: boolean }) {
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    leagueRegister(leagueId, 200)
      .then((r) => { if (r.ok && r.rows) setRows(r.rows); else setErr(true); })
      .catch(() => setErr(true));
  }, [leagueId]);
  if (err) return <div style={box(bare)}><span className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>Couldn’t load the register.</span></div>;
  if (!rows) return <div style={box(bare)}><Loading /></div>;
  if (!rows.length) {
    return (
      <div style={box(bare)}>
        <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.7 }}>
          Nothing yet. Every add, drop, waiver claim and trade lands here once the draft is done —
          draft night has its own record in the draft room.
        </div>
      </div>
    );
  }
  return (
    <div style={bare ? {} : { ...panel, maxHeight: 460, overflowY: 'auto' }}>
      {rows.map((r) => {
        const k = KIND[r.kind] ?? KIND.add;
        const team = r.team ?? `Roster ${r.roster_id}`;
        return (
          <div key={r.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--bd)' }}>
            <span style={{ width: 16, textAlign: 'center', fontSize: 12, color: r.kind === 'drop' ? 'var(--opp)' : 'var(--you)' }}>{k.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text)' }}>
                <b>{team}</b>{` ${k.verb} `}<b>{prettySlug(r.slug)}</b>
                {(r.kind === 'trade' || r.kind === 'steal' || r.kind === 'cap') && r.from_team ? <span style={{ color: 'var(--dim)' }}>{` from ${r.from_team}`}</span> : null}
                {r.note ? <span style={{ color: 'var(--dim)' }}>{` · ${r.note}`}</span> : null}
                {r.kind === 'waiver' && r.bid != null && r.bid > 0 ? <span style={{ color: 'var(--dim)' }}>{` for ${r.bid}`}</span> : null}
              </div>
              <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 1 }}>{when(r.at)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 📣 RECRUIT ──────────────────────────────────────────────────────────────
// The app's RecruitView (ui/LeagueInfo.tsx) in the web's idiom; the reasoning
// for the split permission lives there. In short: the LINK is any member's
// (`league_invite` has always been member-callable, and recruiting a friend was
// never meant to need the commissioner), the BOARD is the commissioner's
// (`post_league_listing` is commish-gated in SQL — it offers a seat to
// strangers, which is a decision about who the league is).
export function RecruitPanel({ leagueId, commish, bare }: { leagueId: string; commish: boolean; bare?: boolean }) {
  const [inv, setInv] = useState<{ code: string; name?: string | null; seats?: number | null; game?: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [listing, setListing] = useState<{ listed: boolean; blurb: string; seatsOpen: number } | null>(null);
  const [blurb, setBlurb] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    leagueInvite(leagueId)
      .then((r) => {
        if (dead) return;
        if (r.ok && r.invite_code) setInv({ code: r.invite_code, name: r.name, seats: r.seats_open, game: r.game_mode });
        else setErr(friendlyError(r.error ?? 'could not fetch the invite code'));
      })
      .catch((x) => { if (!dead) setErr(friendlyError(x)); });
    if (commish) {
      leagueListingState(leagueId)
        .then((r) => {
          if (dead || !r.ok) return;
          setListing({ listed: !!r.listed, blurb: r.blurb ?? '', seatsOpen: r.seats_open ?? 0 });
          setBlurb(r.blurb ?? '');
        })
        .catch(() => {});
    }
    return () => { dead = true; };
  }, [leagueId, commish]);

  const link = inv ? inviteLink(inv.code) : '';
  const message = inv ? inviteMessage({ league: inv.name, code: inv.code, seatsOpen: inv.seats, game: inv.game }) : '';
  // THE LOOK-FIRST LINK (v0.358.1, founder: "add the classic link to the
  // commish invite area. Classic league invites should get you there"). Only a
  // CLASSIC league has somewhere else to send a recruit: the bare site already
  // opens on drip, so a drip commissioner would be copying the same
  // destination twice.
  const classic = (inv?.game ?? '').toLowerCase() === 'classic';
  const look = previewLink('classic');
  const [lookCopied, setLookCopied] = useState(false);
  const copyLook = async () => {
    try { await navigator.clipboard.writeText(look); setLookCopied(true); setTimeout(() => setLookCopied(false), 1600); }
    catch { setErr('Couldn\u2019t reach the clipboard — select the link and copy it by hand.'); }
  };

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setErr('Couldn\u2019t reach the clipboard — select the link and copy it by hand.'); }
  };
  // The OS share sheet where the browser has one (every phone); desktop
  // browsers mostly don't, and there COPY is the whole job anyway.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const send = async () => {
    if (!message) return;
    try { await navigator.share({ text: message }); } catch { /* dismissed — not an error */ }
  };

  const runListing = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (!r.ok) { setErr(friendlyError(r.error ?? 'that didn\u2019t work')); return; }
      const st = await leagueListingState(leagueId).catch(() => null);
      if (st?.ok) { setListing({ listed: !!st.listed, blurb: st.blurb ?? '', seatsOpen: st.seats_open ?? 0 }); setBlurb(st.blurb ?? ''); }
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const btn: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', borderRadius: 6,
    padding: '10px 14px', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--bd)', color: 'var(--dim)',
  };
  return (
    <div style={box(bare)}>
      {err && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', lineHeight: 1.5, marginBottom: 8 }}>{err}</div>}

      <Head>SEND A LINK</Head>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 8 }}>
        Anyone in the league can invite. The link joins them straight into this league — no code to type, and it
        survives signing up on the way in.
      </div>
      {!inv && !err && <Loading />}
      {!!inv && (<>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 10px', wordBreak: 'break-all', lineHeight: 1.5 }}>{link}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={copy} className="mono" style={{ ...btn, borderColor: copied ? 'var(--you)' : 'var(--bd)', color: copied ? 'var(--you)' : 'var(--dim)' }}>
            {copied ? '\u2713 COPIED' : '\u29c9 COPY LINK'}
          </button>
          {canShare && <button onClick={send} className="mono" style={{ ...btn, borderColor: 'var(--you)', color: 'var(--you)' }}>⇪ SEND THE INVITE</button>}
        </div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 8 }}>
          Invite code {inv.code}{inv.seats ? ` \u00b7 ${inv.seats} seat${inv.seats === 1 ? '' : 's'} open` : ''}
        </div>

        {/* A recruit who wants to look before committing. The invite link above
            goes straight to sign-in, so it never shows them the game — this one
            lands on the CLASSIC board, which is the whole point for a league
            that doesn't play drip. */}
        {classic && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
            <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)' }}>
              NOT READY TO SIGN UP?
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5, margin: '5px 0 7px' }}>
              This one shows them the classic game first — nine slots, standard scoring, no sign-up. The invite link
              above skips the demo entirely.
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 10px', wordBreak: 'break-all', lineHeight: 1.5 }}>{look}</div>
            <button onClick={copyLook} className="mono" style={{ ...btn, marginTop: 8, borderColor: lookCopied ? 'var(--you)' : 'var(--bd)', color: lookCopied ? 'var(--you)' : 'var(--dim)' }}>
              {lookCopied ? '\u2713 COPIED' : '\u29c9 COPY THE LOOK-FIRST LINK'}
            </button>
          </div>
        )}
      </>)}

      {commish && (<>
        <Head>POST TO THE BOARD</Head>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 8 }}>
          Lists the league publicly so managers you don’t know can claim an open seat. Commissioner only — a link
          invites a friend, the board invites strangers.
        </div>
        {listing === null ? <Loading /> : (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: listing.listed ? 'var(--you)' : 'var(--faint)' }}>
              {listing.listed ? '\u25c9 LISTED' : '\u25cb NOT LISTED'}
            </span>
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>
              {listing.seatsOpen > 0 ? `${listing.seatsOpen} seat${listing.seatsOpen === 1 ? '' : 's'} open` : 'no open seats — nobody can claim one'}
            </span>
          </div>
          <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={3}
            placeholder="A line about your league — what makes it worth joining?"
            className="mono"
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--text)', fontSize: 10, padding: 10, lineHeight: 1.5 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={() => void runListing(() => postLeagueListing(leagueId, blurb.trim() || null))}
              className="mono" style={{ ...btn, borderColor: 'var(--you)', color: 'var(--you)', opacity: busy ? 0.5 : 1 }}>
              {listing.listed ? '\u2713 UPDATE LISTING' : '\u2191 POST TO BOARD'}
            </button>
            {listing.listed && (
              <button disabled={busy} onClick={() => void runListing(() => closeLeagueListing(leagueId))}
                className="mono" style={{ ...btn, color: 'var(--opp)', opacity: busy ? 0.5 : 1 }}>REMOVE</button>
            )}
          </div>
        </>)}
      </>)}
    </div>
  );
}

// ── 🔑 API KEYS (0352) ──────────────────────────────────────────────────────
// Where a manager mints the key an outside tool uses to run their team — a
// lineup optimiser, a waiver bot, a Discord command — once the commissioner
// has switched the write API on. The key appears ONCE: the server keeps only
// its hash, so there is nothing to show again and nothing a leak of the
// database could hand out. The commissioner sees every key in the league and
// can revoke any of them; everyone else sees their own.
const when2 = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
export function ApiKeysPanel({ leagueId, bare }: { leagueId: string; bare?: boolean }) {
  const [st, setSt] = useState<{ on: boolean; commish: boolean; keys: ApiKeyRow[] } | null>(null);
  const [log, setLog] = useState<ApiWriteLogRow[]>([]);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<'team' | 'league'>('team');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => Promise.all([
    apiKeys(leagueId).then((r) => {
      if (r.ok) setSt({ on: !!r.write_api, commish: !!r.is_commish, keys: r.keys ?? [] });
      else setMsg(r.error ?? 'could not load');
    }),
    apiWriteLog(leagueId, 20).then((r) => setLog(r.entries ?? [])),
  ]).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  const mint = async () => {
    if (busy) return;
    setBusy(true); setMsg(null); setFresh(null); setCopied(false);
    try {
      const r = await apiKeyCreate(leagueId, label.trim(), scope);
      if (r.ok && r.key) { setFresh(r.key); setLabel(''); } else setMsg(r.error ?? 'failed');
    } catch (e) { setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const revoke = async (k: ApiKeyRow) => {
    if (busy || !window.confirm(`Revoke ${k.label || k.prefix}? Anything using it stops working at once.`)) return;
    setBusy(true);
    try { const r = await apiKeyRevoke(k.id); if (!r.ok) setMsg(r.error ?? 'failed'); }
    catch (e) { setMsg(friendlyError(e)); }
    finally { setBusy(false); void load(); }
  };
  const copy = async () => {
    if (!fresh) return;
    try { await navigator.clipboard.writeText(fresh); setCopied(true); } catch { setMsg('select the key and copy it by hand'); }
  };
  const btn: React.CSSProperties = { background: 'var(--you)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
  const ghost: React.CSSProperties = { background: 'none', border: '1px solid var(--bd)', borderRadius: 6, padding: '5px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text)', cursor: 'pointer' };
  const small: React.CSSProperties = { fontSize: 10, color: 'var(--dim)', lineHeight: 1.6 };
  if (!st) return <div style={box(bare)}>{msg ? <span className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>{msg}</span> : <Loading />}</div>;
  const live = st.keys.filter((k) => !k.revoked_at);
  return (
    <div style={box(bare)}>
      {!st.on ? (
        <div className="mono" style={small}>
          The write API is off for this league. {st.commish
            ? 'Switch it on under ⚑ Manage league → 🏅 AWARDS & BADGES → WRITE API, and every manager can mint a key here.'
            : 'Only the commissioner can switch it on — ask them if you want to run your team from another tool.'}
          {live.length > 0 && ' Keys made before it was switched off start working again the moment it is switched back on.'}
        </div>
      ) : (
        <>
          <div className="mono" style={small}>
            A key lets another tool act as you in this league — set lineups, add and drop, claim, trade
            {st.commish ? ', and with LEAGUE scope run your commissioner tools' : ''}. It can do nothing you cannot.
            Send it as <code>Authorization: Bearer drip_sk_…</code> to:
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--you)', wordBreak: 'break-all', margin: '6px 0 10px' }}>{publicApiUrl(leagueId)}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="what is it for? (e.g. lineup bot)"
              style={{ flex: '1 1 180px', background: 'var(--card)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text)' }} />
            {st.commish && (
              <button onClick={() => setScope(scope === 'team' ? 'league' : 'team')} className="mono" style={ghost}
                title={scope === 'team' ? 'your own team only' : 'every team, and your commissioner tools'}>
                {scope === 'team' ? 'TEAM SCOPE' : 'LEAGUE SCOPE'}
              </button>
            )}
            <button onClick={() => void mint()} disabled={busy} className="mono" style={btn}>MAKE A KEY</button>
          </div>
          {fresh && (
            <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--you)', borderRadius: 6 }}>
              <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--warn)', marginBottom: 6 }}>
                COPY IT NOW — THIS IS THE ONLY TIME IT WILL BE SHOWN
              </div>
              <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--text)', userSelect: 'all' }}>{fresh}</div>
              <button onClick={() => void copy()} className="mono" style={{ ...ghost, marginTop: 8 }}>{copied ? '✓ COPIED' : '⧉ COPY'}</button>
            </div>
          )}
        </>
      )}
      {msg && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8 }}>{msg}</div>}
      {st.keys.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)' }}>
            {st.commish ? 'EVERY KEY IN THE LEAGUE' : 'YOUR KEYS'}
          </div>
          {st.keys.map((k) => (
            <div key={k.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--bd)', opacity: k.revoked_at ? 0.45 : 1, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text)' }}>
                  {k.label || 'unnamed key'}
                  {st.commish && !k.mine && k.owner ? <span style={{ color: 'var(--dim)' }}>{` · ${k.owner}`}</span> : null}
                </div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>
                  {k.prefix}… · {k.scope.toUpperCase()} · {k.revoked_at ? `revoked ${when2(k.revoked_at)}` : `last used ${when2(k.last_used_at)}`}
                </div>
              </div>
              {!k.revoked_at && <button onClick={() => void revoke(k)} disabled={busy} className="mono" style={{ ...ghost, color: 'var(--opp)' }}>REVOKE</button>}
            </div>
          ))}
        </div>
      )}
      {log.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)' }}>
            {st.commish ? 'RECENT WRITES, EVERY KEY' : 'RECENT WRITES, YOUR KEYS'}
          </div>
          {log.map((l) => (
            <div key={l.id} className="mono" style={{ fontSize: 9.5, padding: '4px 0', borderBottom: '1px solid var(--bd)', color: l.ok ? 'var(--text)' : 'var(--opp)' }}>
              {l.ok ? '✓' : '✕'} {l.action}{l.roster_id != null ? ` · roster ${l.roster_id}` : ''} · {l.label || l.prefix || 'key'} · {when2(l.at)}
              {!l.ok && l.error ? <span style={{ color: 'var(--dim)' }}>{` — ${l.error}`}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
