// The league's reference panels, web (0186 / v0.274.0) — the twins of the
// app's ui/LeagueInfo.tsx: SCORING, ROSTER RULES and the REGISTER, read-only
// for every member. The commissioner edits the same facts in ⚑ Manage league;
// these exist so a manager can look up how the league scores, what it allows,
// and who moved whom, without being handed the editors.
import { useEffect, useState } from 'react';
import {
  leagueGameMode, rosterRules, leagueRegister, playerFlags, leagueScoringGet,
  type GameModeInfo, type RegisterRow, type PlayerFlagRow, type FlagRulesRaw,
} from '@drip/core/data/liveApi';
import { parseScoring, scopedRuleLabel, scoringIsDefault, type LeagueScoring } from '@drip/core/engine/leagueScoring';
import { CLASSIC_SCORING_SECTIONS, normalizeClassicScoring, leagueSlotDefs, slotDisplayNames, leagueBestball, slotFilterLabel } from '@drip/core/engine/classic';
import { shortName } from '@drip/core/data/players';
import { slugMeta } from '@drip/core/data/slugMeta';

const panel: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8,
  padding: '10px 14px 14px', marginTop: -4,
};
/** Minutes-since-midnight-ET → "3:30am". */
const fmtEt = (m: number): string => {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`;
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const prettySlug = (slug: string): string => {
  if (slug.endsWith('-dst')) return `${slugMeta(slug).team} D/ST`;
  if (slug.endsWith('-k')) return `${slugMeta(slug).team} K`;
  return shortName(slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '));
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

export function ScoringPanel({ leagueId }: { leagueId: string }) {
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
  if (!gm) return <div style={panel}><Loading /></div>;
  if (!gm.ok) return <div style={panel}><span className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>Couldn’t load the scoring.</span></div>;

  const classic = gm.mode === 'classic';
  const sc = normalizeClassicScoring({ ...(gm.scoring ?? {}), ...(gm.ppr != null ? { ppr: gm.ppr } : {}) });
  return (
    <div style={panel}>
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

export function RosterRulesPanel({ leagueId }: { leagueId: string }) {
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  const [rr, setRr] = useState<Awaited<ReturnType<typeof rosterRules>> | null>(null);
  useEffect(() => {
    leagueGameMode(leagueId).then(setGm).catch(() => setGm({ ok: false }));
    rosterRules(leagueId).then(setRr).catch(() => setRr({ ok: false }));
  }, [leagueId]);
  if (!gm || !rr) return <div style={panel}><Loading /></div>;

  const defs = leagueSlotDefs({ roster: gm.roster ?? {}, slots: gm.slots ?? null });
  const names = slotDisplayNames(defs);
  const bb = new Set(leagueBestball(gm));
  const caps = Object.entries(rr.pos_caps ?? {}).filter(([, v]) => v != null);
  const mode = rr.waiver_mode ?? 'rolling';
  return (
    <div style={panel}>
      <Head>ROSTER</Head>
      <Row k="ROSTER SIZE" v={`${rr.rounds ?? gm.rounds ?? '—'} players`} accent />
      <Row k="STARTING SPOTS" v={`${defs.length}`} />
      {!!gm.shape?.bench && <Row k="BENCH" v={`${gm.shape.bench}`} />}
      {!!gm.shape?.taxi && <Row k="TAXI" v={`${gm.shape.taxi}`} />}
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
      <Row k="HOLD AFTER A DROP" v={`${rr.waiver_hold_days ?? 2} day${(rr.waiver_hold_days ?? 2) === 1 ? '' : 's'}`} />
      <Row k="CLAIMS CLEAR" v={rr.waiver_clear_min == null ? 'rolling — 24h after the drop' : `${fmtEt(rr.waiver_clear_min)} ET`} />
      {!!rr.waiver_clear_dow?.length && <Row k="CLEAR DAYS" v={rr.waiver_clear_dow.map((d) => DOW[d]).join(' · ')} />}

      <Head>FREE AGENCY</Head>
      <Row k="WINDOW" v={rr.fa_start_min == null || rr.fa_end_min == null ? 'always open' : `${fmtEt(rr.fa_start_min)} – ${fmtEt(rr.fa_end_min)} ET`} />
      {!!rr.fa_after_waivers_dow?.length && <Row k="ADDS WAIT FOR WAIVERS" v={rr.fa_after_waivers_dow.map((d) => DOW[d]).join(' · ')} />}

      <Head>TRADES</Head>
      <Row k="REVIEW" v={rr.trade_review === 'commish' ? 'commissioner approves' : 'process immediately'} />
    </div>
  );
}

const KIND: Record<RegisterRow['kind'], { icon: string; verb: string }> = {
  add: { icon: '✚', verb: 'signed' },
  drop: { icon: '✕', verb: 'dropped' },
  waiver: { icon: '⚑', verb: 'claimed off waivers' },
  trade: { icon: '⇄', verb: 'traded for' },
  commish: { icon: '⚑', verb: 'was moved by the commissioner to' },
};
const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function RegisterPanel({ leagueId }: { leagueId: string }) {
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    leagueRegister(leagueId, 200)
      .then((r) => { if (r.ok && r.rows) setRows(r.rows); else setErr(true); })
      .catch(() => setErr(true));
  }, [leagueId]);
  if (err) return <div style={panel}><span className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>Couldn’t load the register.</span></div>;
  if (!rows) return <div style={panel}><Loading /></div>;
  if (!rows.length) {
    return (
      <div style={panel}>
        <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.7 }}>
          Nothing yet. Every add, drop, waiver claim and trade lands here once the draft is done —
          draft night has its own record in the draft room.
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...panel, maxHeight: 460, overflowY: 'auto' }}>
      {rows.map((r) => {
        const k = KIND[r.kind] ?? KIND.add;
        const team = r.team ?? `Roster ${r.roster_id}`;
        return (
          <div key={r.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--bd)' }}>
            <span style={{ width: 16, textAlign: 'center', fontSize: 12, color: r.kind === 'drop' ? 'var(--opp)' : 'var(--you)' }}>{k.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text)' }}>
                <b>{team}</b>{` ${k.verb} `}<b>{prettySlug(r.slug)}</b>
                {r.kind === 'trade' && r.from_team ? <span style={{ color: 'var(--dim)' }}>{` from ${r.from_team}`}</span> : null}
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
