// The league's own reference sheets (0186 / v0.274.0, founder's league-menu
// list): SCORING, ROSTER RULES and the REGISTER. All three are read-only
// views for every member — the commissioner edits the same facts behind ⚑
// COMMISH, and these exist so a manager can look up "how does this league
// score a 40-yard TD" or "who dropped him" without being handed the editors.
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import {
  leagueGameMode, rosterRules, leagueRegister, playerFlags, leagueScoringGet,
  leagueInvite, leagueListingState, postLeagueListing, closeLeagueListing, friendlyError,
  requestLeagueSync, leagueSyncState, type SyncState,
  apiKeys, apiKeyCreate, apiKeyRevoke, apiWriteLog, publicApiUrl, type ApiKeyRow, type ApiWriteLogRow,
  commishUndoTxn,
  type GameModeInfo, type RegisterRow, type PlayerFlagRow, type FlagRulesRaw,
} from '@drip/core/data/liveApi';
import { inviteLink, inviteMessage, previewLink } from '@drip/core/data/invite';
import { waiverDaysOf, waiverScheduleLine, holdLine } from '@drip/core/data/waiverDays';
import { parseScoring, scopedRuleLabel, scoringIsDefault, type LeagueScoring } from '@drip/core/engine/leagueScoring';
import { CLASSIC_SCORING_SECTIONS, normalizeClassicScoring, byPosSummary, DELAYED_SCORING_KEYS, DELAYED_SCORING_NOTE, scoresDelayedStats as CLASSIC_SCORING_FIELDS_DELAYED, leagueSlotDefs, slotDisplayNames, leagueBestball, slotFilterLabel } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { slugMeta } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { copyText } from './copy';
import { Mono } from './prims';
import { CopyIdRow } from './CommishDesk';

/** Minutes-since-midnight-ET → "3:30am" (CommishSettings' own formatter — the
 *  member view has to read the same clock the commissioner set). */
const fmtEt = (m: number): string => {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`;
};
const prettySlug = (slug: string): string => {
  if (slug.endsWith('-dst')) return `${slugMeta(slug).team} D/ST`;
  if (slug.endsWith('-k')) return `${slugMeta(slug).team} K`;
  return shortName(slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '));
};

/** A flag's rules (0144) in plain English — what the commissioner actually
 *  did to this player, in the order it matters: scoring first, then what he
 *  may not do. Empty when a flag is only a label. */
export function flagRuleWords(r?: FlagRulesRaw | null): string[] {
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

/** One label → value line. The shared row of all three sheets. */
function Row({ k, v, tone }: { k: string; v: string; tone?: 'you' | 'dim' }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.bd }}>
      <Text style={{ flex: 1, fontFamily: MONO, fontSize: fs(9.5), color: t.dim }}>{k}</Text>
      <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: tone === 'you' ? t.you : t.text, textAlign: 'right', flexShrink: 1 }}>{v}</Text>
    </View>
  );
}
function Head({ children }: { children: string }) {
  return <Mono size={9} tone="faint" weight="700" track={0.12} style={{ marginTop: 14, marginBottom: 4 }}>{children}</Mono>;
}
const Loading = () => <Mono size={10} tone="faint" style={{ paddingVertical: 20, textAlign: 'center' }}>Loading…</Mono>;

// ── ⊞ SCORING ───────────────────────────────────────────────────────────────
export function ScoringView({ leagueId }: { leagueId: string }) {
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  // The commissioner's per-player rules (0144) score too — a ×2 on a player is
  // as much "how this league scores" as the pass-TD value, and it lived
  // nowhere a member could read it.
  const [flags, setFlags] = useState<PlayerFlagRow[]>([]);
  // The commissioner's LAYERING knobs and scoped bonuses (0143/0145) — the
  // drip engine's real scoring settings, and until now readable only from the
  // commish kit.
  const [adj, setAdj] = useState<LeagueScoring | null>(null);
  useEffect(() => {
    leagueGameMode(leagueId).then(setGm).catch(() => setGm({ ok: false }));
    playerFlags(leagueId).then((f) => { if (Array.isArray(f)) setFlags(f); }).catch(() => {});
    leagueScoringGet(leagueId).then((r) => { if (r?.ok) setAdj(parseScoring(r)); }).catch(() => {});
  }, [leagueId]);
  if (!gm) return <Loading />;
  if (!gm.ok) return <Mono size={10} tone="opp" style={{ padding: 14 }}>Couldn't load the scoring.</Mono>;

  const classic = gm.mode === 'classic';
  // Through leagueCatalogOf (0209) — see the web copy.
  const sc = normalizeClassicScoring(leagueCatalogOf(gm));
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
      <Row k="GAME MODE" v={classic ? '🏈 CLASSIC' : '◈ DRIP'} tone="you" />
      {!classic ? (
        // A drip league has no per-stat table — the engine owns those numbers.
        // What it DOES have is the commissioner's layering knobs, printed just
        // below, so this is the intro to them rather than a dead end.
        <Mono size={10} tone="dim" style={{ marginTop: 14, lineHeight: fs(17) }}>
          ◈ DRIP leagues score through the drip engine — live windows, drips and nukes, and whatever
          power-ups get played. The engine's own numbers are fixed (the rulebook in ⚙ settings has them);
          what this league layers on top is below.
        </Mono>
      ) : (
        <>
          <Row k="PER CATCH (PPR)" v={sc.ppr === 1 ? '1 pt · full' : sc.ppr === 0.5 ? '½ pt · half' : `${sc.ppr}`} tone="you" />
          {CLASSIC_SCORING_SECTIONS.map((s) => {
            // Only what actually scores. A league sets a dozen values and leaves
            // fifty at zero; printing all of them buries the dozen that matter.
            const live = s.fields.filter((f) => Number(sc[f.key]) !== 0);
            if (!live.length) return null;
            return (
              <View key={s.section}>
                <Head>{s.section}</Head>
                {live.map((f) => (
                  <Row key={String(f.key)} k={`${f.label}${DELAYED_SCORING_KEYS.has(f.key) ? ' ⏱' : ''}`}
                    v={`${Number(sc[f.key]) > 0 ? '+' : ''}${Number(sc[f.key])}${f.perYard ? ' / yd' : ''}`} />
                ))}
              </View>
            );
          })}
          {/* BY POSITION (v0.532.0): per-position overrides of the table above. */}
          {byPosSummary(sc.byPos).length > 0 && (
            <View>
              <Head>BY POSITION</Head>
              {byPosSummary(sc.byPos).map((r) => (
                <Row key={`${r.pos}-${String(r.key)}`} k={`${r.pos} · ${r.label}`} v={`${r.value > 0 ? '+' : ''}${r.value}`} />
              ))}
            </View>
          )}
          {/* ⏱ (v0.534.0): a scored stat that lands the day after the game. */}
          {CLASSIC_SCORING_FIELDS_DELAYED(sc) && (
            <Mono size={9} tone="warn" style={{ marginTop: 12, lineHeight: fs(14) }}>⏱ {DELAYED_SCORING_NOTE}</Mono>
          )}
          <Mono size={9} tone="faint" style={{ marginTop: 14, lineHeight: fs(14) }}>
            Anything not listed scores 0 in this league.
          </Mono>
        </>
      )}
      <Adjustments adj={adj} classic={classic} />
      <CommishRules flags={flags} />
    </ScrollView>
  );
}

/** The commissioner's LAYERING knobs (0143) and SCOPED BONUSES (0145).
 *
 *  The SCOPED rules apply in BOTH modes as of v0.277.0 — classicPoints reads
 *  the same scopedAdjustFor sim.ts does, so one rule means one thing wherever
 *  it is scored. The three league-wide KNOBS stay drip-only (they layer on the
 *  drip engine's own growth curves, which classic has no equivalent of), and a
 *  classic league that has them set is told so rather than left to assume. */
function Adjustments({ adj, classic }: { adj: LeagueScoring | null; classic: boolean }) {
  const t = useTheme();
  if (!adj || scoringIsDefault(adj)) return null;
  const knobs = adj.tdBonus !== 0 || adj.ydMult !== 1 || adj.toPenalty !== 0;
  return (
    <View>
      {knobs && (<>
        <Head>LEAGUE ADJUSTMENTS</Head>
        {classic ? (
          <Mono size={9.5} tone="faint" style={{ lineHeight: fs(15) }}>
            This league has drip-engine adjustments stored (touchdown, yardage, turnover). They do not
            apply in 🏈 CLASSIC mode — the scoring above is the whole of it. The scoped bonuses below DO.
          </Mono>
        ) : (<>
          {adj.tdBonus !== 0 && <Row k="EVERY TOUCHDOWN" v={`${adj.tdBonus > 0 ? '+' : ''}${adj.tdBonus} pts`} tone="you" />}
          {adj.ydMult !== 1 && <Row k="ALL YARDAGE SCORING" v={`×${adj.ydMult}`} tone="you" />}
          {adj.toPenalty !== 0 && <Row k="TURNOVER COMMITTED" v={`−${adj.toPenalty} pts`} tone="you" />}
        </>)}
      </>)}
      {adj.scoped.length > 0 && (
        <>
          <Head>SCOPED BONUSES</Head>
          {adj.scoped.map((r, i) => {
            // The editor's own label, split: WHO it catches on the left, what
            // it DOES on the right — the same two halves scopedRuleLabel joins
            // with a colon, read apart because a list of them is scanned by
            // scope first.
            const [who, does] = scopedRuleLabel(r).split(': ');
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <Text style={{ flex: 1, fontFamily: MONO, fontSize: fs(9.5), color: t.text }}>{who}</Text>
                <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: t.you }}>{does}</Text>
              </View>
            );
          })}
          <Mono size={9} tone="faint" style={{ marginTop: 6, lineHeight: fs(14) }}>
            A player matches a rule only when he fits EVERY part of its scope. Rules stack — multipliers
            multiply, point bonuses add. These pay in both game modes.
          </Mono>
        </>
      )}
    </View>
  );
}

/** ⚑ The commissioner's own rules — flagged players and what each flag does.
 *  Rendered under BOTH modes: a drip league has no stat table, but it can
 *  absolutely have a ×2 on somebody. Silent when nothing is flagged. */
function CommishRules({ flags }: { flags: PlayerFlagRow[] }) {
  const t = useTheme();
  const live = flags.filter((f) => flagRuleWords(f.rules).length > 0);
  if (!live.length) return null;
  return (
    <View>
      <Head>⚑ COMMISSIONER RULES</Head>
      {live.map((f) => (
        <View key={f.slug} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.bd }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: fs(11.5), fontWeight: '700', color: t.text }}>{prettySlug(f.slug)}</Text>
            {!!f.label && (
              <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.you }}>{f.label.toUpperCase()}</Text>
            )}
          </View>
          <Mono size={9.5} tone="dim" style={{ marginTop: 2, lineHeight: fs(14) }}>{flagRuleWords(f.rules).join(' · ')}</Mono>
        </View>
      ))}
      <Mono size={9} tone="faint" style={{ marginTop: 8, lineHeight: fs(14) }}>
        Set by the commissioner. These apply on top of the scoring above.
      </Mono>
    </View>
  );
}

/** One starting spot. Two things the plain Row can't say: 🎯 that the spot
 *  fills ITSELF (best ball, 0159), and ⓘ that it only accepts certain players
 *  (a 0172 filter — team list or tenure window). The filter's terms are a tap
 *  away rather than always on screen: most spots have none, and a wall of
 *  "SF/SEA · 0–2 YRS" on the ones that do would drown the lineup shape. */
function SlotRow({ name, pos, bb, filter }: { name: string; pos: string[]; bb: boolean; filter: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: t.bd, paddingVertical: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.dim }}>{name}</Text>
        {bb && <Text style={{ fontSize: fs(9), color: t.you }}>🎯</Text>}
        {!!filter && (
          <Pressable hitSlop={8} onPress={() => setOpen((v) => !v)}>
            <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.you }}>ⓘ</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: t.text, textAlign: 'right' }}>
          {pos.map((p) => (p === 'DEF' ? 'D/ST' : p)).join(' / ')}
        </Text>
      </View>
      {open && !!filter && (
        <Mono size={9} tone="you" style={{ marginTop: 3, lineHeight: fs(14) }}>{`only ${filter}`}</Mono>
      )}
    </View>
  );
}

// ── 🧢 ROSTER RULES ─────────────────────────────────────────────────────────
/** ── REFRESH FROM SLEEPER (0204, founder: "Can we let users do a manual
 *  refresh?") ───────────────────────────────────────────────────────────────
 *  The twin of the web control. The worker mirrors Sleeper every 6 hours and
 *  only for leagues in its PILOT_LEAGUE_IDS allowlist, so for most Sleeper
 *  leagues this is the ONLY way their rosters ever move.
 *
 *  Draws nothing on a native league — `league_sync_state` says whether there is
 *  an upstream, in the call this already makes. A cooldown refusal is rendered
 *  as information rather than an error, because nothing went wrong. */
function SleeperRefresh({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => leagueSyncState(leagueId).then(setSt).catch(() => setSt({ ok: false }));
  useEffect(() => { void load(); }, [leagueId]);
  useEffect(() => {
    if (!st?.pending) return;
    const iv = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(iv);
  }, [st?.pending, leagueId]);

  if (!st?.ok || !st.sleeper) return null;
  const wait = st.retry_in ?? 0;
  const off = busy || !!st.pending || wait > 0;

  const press = async () => {
    setBusy(true); setMsg(null); tap();
    const r = await requestLeagueSync(leagueId);
    setBusy(false);
    if (!r.ok) { warn(); setMsg(r.error ?? 'could not queue'); return; }
    if (!r.queued) { setMsg(`just refreshed — try again in ${r.retry_in ?? 0}s`); await load(); return; }
    commit();
    setMsg('queued — picked up within about half a minute');
    await load();
  };

  return (
    <View style={{ marginBottom: 10, gap: 4 }}>
      <Pressable
        onPress={() => { if (!off) void press(); }}
        style={{
          alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6,
          borderRadius: 6, borderWidth: 1, borderColor: t.bd, backgroundColor: t.bg,
          opacity: off ? 0.55 : 1,
        }}>
        <Mono size={9.5} weight="700" tone={st.pending ? 'faint' : 'you'}>
          {st.pending ? '↻ REFRESHING…' : wait > 0 ? `↻ WAIT ${wait}s` : '↻ REFRESH FROM SLEEPER'}
        </Mono>
      </Pressable>
      <Mono size={8.5} tone="faint">
        {msg ?? (st.last_at
          ? `last ${st.last_ok === false ? 'attempt failed' : 'refreshed'} ${new Date(st.last_at).toLocaleString()}`
          : 'rosters mirror from Sleeper every few hours')}
      </Mono>
    </View>
  );
}

export function RosterRulesView({ leagueId }: { leagueId: string }) {
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  const [rr, setRr] = useState<Awaited<ReturnType<typeof rosterRules>> | null>(null);
  useEffect(() => {
    leagueGameMode(leagueId).then(setGm).catch(() => setGm({ ok: false }));
    rosterRules(leagueId).then(setRr).catch(() => setRr({ ok: false }));
  }, [leagueId]);
  if (!gm || !rr) return <Loading />;

  const defs = leagueSlotDefs({ roster: gm.roster ?? {}, slots: gm.slots ?? null });
  const names = slotDisplayNames(defs);
  const bb = new Set(leagueBestball(gm));
  const caps = Object.entries(rr.pos_caps ?? {}).filter(([, v]) => v != null);
  const mode = rr.waiver_mode ?? 'rolling';
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
      <SleeperRefresh leagueId={leagueId} />
      <Head>ROSTER</Head>
      <Row k="ROSTER SIZE" v={`${rr.rounds ?? gm.rounds ?? '—'} players`} tone="you" />
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
        <Mono size={9} tone="faint" style={{ marginTop: 6, lineHeight: fs(14) }}>
          {bb.size > 0 ? '🎯 fills itself with your best eligible scorer. ' : ''}
          {defs.some((d) => d.flt) ? 'ⓘ marks a spot that only takes certain players — tap it.' : ''}
        </Mono>
      )}

      {caps.length > 0 && (<>
        <Head>POSITION LIMITS</Head>
        {caps.map(([p, v]) => <Row key={p} k={p === 'DEF' ? 'D/ST' : p} v={`max ${v}`} />)}
      </>)}

      <Head>WAIVERS</Head>
      <Row k="MODE" v={mode === 'faab' ? 'FAAB blind bids' : mode === 'standings' ? 'reverse standings' : 'rolling priority'} tone="you" />
      {mode === 'faab' && <Row k="SEASON BUDGET" v={`${rr.faab_budget ?? 100}`} />}
      {/* v0.462.0: core's own sentence, not "N days" — hold days count RUNS
          (0338), so a rolling league's stored 3 is a flat 24h and this row
          said "3 days". The unset default is 1, as the database reads it. */}
      <Row k="HOLD AFTER A DROP" v={holdLine(rr.waiver_clear_min_effective ?? null, rr.waiver_hold_days ?? 1)} />
      {/* 0337: the week, as one sentence — core's reading, so the two hosts
          and the console cannot describe the same league differently. */}
      <Row k="THE WEEK" v={waiverScheduleLine(waiverDaysOf(rr.waiver_days), rr.waiver_clear_min_effective ?? null, rr.waiver_game_hold_dow ?? null)} />

      <Head>FREE AGENCY</Head>
      <Row k="WINDOW" v={rr.fa_start_min == null || rr.fa_end_min == null ? 'as the week above says'
        : `${fmtEt(rr.fa_start_min)} – ${fmtEt(rr.fa_end_min)} ET`} />

      <Head>TRADES</Head>
      {/* 0321: the floor's rules, as the rulebook page states every other
          setting — the review mode, and the vote's numbers where it is one. */}
      <Row k="REVIEW" v={rr.trade_review === 'commish' ? 'commissioner approves'
        : rr.trade_review === 'league' ? `the league votes — ${rr.trade_veto_votes ?? 2} veto${(rr.trade_veto_votes ?? 2) === 1 ? '' : 'es'} in ${rr.trade_review_hours ?? 24}h kill a trade`
        : 'process immediately'} />
      <Row k="AN OFFER STANDS" v={rr.trade_offer_days ? `${rr.trade_offer_days} day${rr.trade_offer_days === 1 ? '' : 's'}` : 'until it is answered'} />

      {/* THIS LEAGUE (v0.462.0). The id had nowhere a member could reach it:
          it showed only inside the commissioner's public-API URL, published
          only. It is what you point a spreadsheet or a Discord bot at. */}
      <Head>THIS LEAGUE</Head>
      <CopyIdRow leagueId={leagueId} />
      <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(12) }}>
        What the public read API is addressed by. Not a secret and not a password — it identifies the league, it does
        not unlock it, and the API serves only what this page already shows.
      </Mono>
      {rr.waiver_mode === 'faab' && <Row k="FAAB TRADING" v={rr.faab_trading === false ? 'off' : 'on'} />}
    </ScrollView>
  );
}

// ── 📜 THE LEAGUE REGISTER ──────────────────────────────────────────────────
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

export function RegisterView({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => leagueRegister(leagueId, 200)
    .then((r) => { if (r.ok && r.rows) setRows(r.rows); else setErr(true); })
    .catch(() => setErr(true));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  /** ↩ UNDO (0354) — the web RegisterPanel's twin. `can_undo` is set only
   *  for the commissioner, and only where the server would accept it. */
  const undo = (r: RegisterRow) => {
    const who = r.team ?? `Roster ${r.roster_id}`;
    const what = r.kind === 'drop' ? `drop of ${prettySlug(r.slug)}` : `${r.kind === 'waiver' ? 'waiver claim for' : 'pickup of'} ${prettySlug(r.slug)}`;
    Alert.alert(`Undo ${who}'s ${what}?`,
      `A pickup goes back on waivers, a dropped player comes back to ${who}, and a FAAB bid is refunded. The league is told in chat.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Undo', style: 'destructive', onPress: () => {
        setBusy(r.id); setMsg(null);
        commishUndoTxn(r.id)
          .then((res) => { if (res.ok) { commit(); setMsg('✓ undone'); } else { warn(); setMsg(friendlyError(res.error ?? 'could not undo')); } })
          .catch((x) => { warn(); setMsg(friendlyError(x)); })
          .finally(() => { setBusy(null); void load(); });
      } }]);
  };
  if (err) return <Mono size={10} tone="opp" style={{ padding: 14 }}>Couldn't load the register.</Mono>;
  if (!rows) return <Loading />;
  if (!rows.length) {
    return (
      <Mono size={10} tone="faint" style={{ padding: 20, textAlign: 'center', lineHeight: fs(16) }}>
        Nothing yet. Every add, drop, waiver claim and trade lands here once the draft is done —
        draft night has its own record in the draft room.
      </Mono>
    );
  }
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
      {msg && <Mono size={10} tone={msg.startsWith('✓') ? 'you' : 'opp'} style={{ marginBottom: 6 }}>{msg}</Mono>}
      {rows.map((r) => {
        const k = KIND[r.kind] ?? KIND.add;
        const team = r.team ?? `Roster ${r.roster_id}`;
        return (
          <View key={r.id} style={{ flexDirection: 'row', gap: 9, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.bd, opacity: r.undone ? 0.5 : 1 }}>
            <Text style={{ fontSize: fs(12), width: 18, textAlign: 'center', color: r.kind === 'drop' ? t.opp : t.you }}>{k.icon}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: fs(11.5), lineHeight: fs(16), color: t.text }}>
                <Text style={{ fontWeight: '700' }}>{team}</Text>
                {` ${k.verb} `}
                <Text style={{ fontWeight: '700' }}>{prettySlug(r.slug)}</Text>
                {(r.kind === 'trade' || r.kind === 'steal' || r.kind === 'cap') && r.from_team ? <Text style={{ color: t.dim }}>{` from ${r.from_team}`}</Text> : null}
                {r.kind === 'waiver' && r.bid != null && r.bid > 0 ? <Text style={{ color: t.dim }}>{` for ${r.bid}`}</Text> : null}
                {r.note ? <Text style={{ color: t.dim }}>{` · ${r.note}`}</Text> : null}
              </Text>
              <Mono size={8.5} tone="faint" style={{ marginTop: 1 }}>{`${when(r.at)}${r.undone ? ' · ↩ undone by the commissioner' : ''}`}</Mono>
            </View>
            {r.can_undo && (
              <Pressable disabled={busy != null} onPress={() => { tap(); undo(r); }} hitSlop={6}
                style={{ alignSelf: 'center', borderWidth: 1, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4, opacity: busy != null ? 0.5 : 1 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.warn }}>{busy === r.id ? '…' : '↩ UNDO'}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ── 📣 RECRUIT ──────────────────────────────────────────────────────────────
// Two ways to fill a seat, and they are NOT the same permission (founder:
// "allow post to board for commish and portable/send-able link for commish and
// players"):
//
//   THE LINK is any member's. `league_invite` has always been callable by any
//   enrolled member — recruiting a friend was never meant to need the
//   commissioner — and the whole point of a league is that everyone in it knows
//   someone who would play. It is a URL now rather than four characters to
//   dictate: `?code=` is a complete join path already (see data/invite.ts).
//
//   THE BOARD is the commissioner's. It offers a seat to STRANGERS, which is a
//   decision about who the league is, not a favour to a friend — `post_league_listing`
//   is commish-gated in SQL (0123) and this only shows the half you may use.
export function RecruitView({ leagueId, commish }: { leagueId: string; commish: boolean }) {
  const t = useTheme();
  const [inv, setInv] = useState<{ code: string; name?: string | null; seats?: number | null; game?: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The listing (commissioner only). `listed` undefined = still asking.
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
  const [copied, setCopied] = useState(false);   // v0.462.0: the invite link's copy button
  const message = inv ? inviteMessage({ league: inv.name, code: inv.code, seatsOpen: inv.seats, game: inv.game }) : '';
  // The look-first link (v0.358.1) — classic leagues only; the bare site
  // already opens on drip, so a drip commissioner would be handing out the
  // same destination twice.
  const classic = (inv?.game ?? '').toLowerCase() === 'classic';
  const look = previewLink('classic');

  const send = async () => {
    if (!message) return;
    tap();
    try { await Share.share({ message }); } catch (x) { warn(); setErr(friendlyError(x)); }
  };

  const runListing = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'that didn\u2019t work')); return; }
      commit();
      const st = await leagueListingState(leagueId).catch(() => null);
      if (st?.ok) { setListing({ listed: !!st.listed, blurb: st.blurb ?? '', seatsOpen: st.seats_open ?? 0 }); setBlurb(st.blurb ?? ''); }
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 28 }}>
      {err && <Mono size={9.5} tone="opp" style={{ marginBottom: 8, lineHeight: 14 }}>{err}</Mono>}

      <Head>SEND A LINK</Head>
      <Mono size={9.5} tone="dim" style={{ lineHeight: 14, marginBottom: 8 }}>
        Anyone in the league can invite. The link joins them straight into this league — no code to type, and it
        survives signing up on the way in.
      </Mono>
      {!inv && !err && <Loading />}
      {!!inv && (<>
        {/* The link stays SELECTABLE — long-press still works, and ⇪ SEND
            opens the sheet — but it has a copy button now too. That note used
            to say a clipboard here "would mean pulling in a native module for
            a button the platform ships"; expo-clipboard came in for the league
            id (v0.462.0), so the argument against it is gone. */}
        <View style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, backgroundColor: t.sh, paddingHorizontal: 10, paddingVertical: 9 }}>
          <Text selectable numberOfLines={2} style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.text, lineHeight: 14 }}>{link}</Text>
        </View>
        <Pressable onPress={() => { tap(); void copyText(link).then((ok) => { setCopied(ok); if (ok) setTimeout(() => setCopied(false), 1600); }); }}
          style={{ alignSelf: 'flex-start', marginTop: 6 }}>
          <Mono size={9} tone={copied ? 'you' : 'dim'} weight="700">{copied ? '✓ COPIED' : '⧉ COPY LINK'}</Mono>
        </Pressable>
        <Pressable onPress={send} style={{ borderWidth: 1, borderColor: t.you, borderRadius: 6, paddingVertical: 11, alignItems: 'center', marginTop: 8 }}>
          <Mono size={10} weight="700" tone="you">⇪ SEND THE INVITE</Mono>
        </Pressable>
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: 12 }}>
          Invite code {inv.code}{inv.seats ? ` \u00b7 ${inv.seats} seat${inv.seats === 1 ? '' : 's'} open` : ''}
        </Mono>

        {/* A recruit who wants to look first. The invite link above goes
            straight to sign-in and never shows them the game — this one lands
            on the CLASSIC board, which is the point for a league that doesn't
            play drip. Selectable for the same reason the link above is. */}
        {classic && (
          <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.bd, gap: 6 }}>
            <Mono size={9} weight="700" track={0.12} tone="faint">NOT READY TO SIGN UP?</Mono>
            <Mono size={9.5} tone="dim" style={{ lineHeight: 14 }}>
              This one shows them the classic game first — nine slots, standard scoring, no sign-up.
            </Mono>
            <View style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, backgroundColor: t.sh, paddingHorizontal: 10, paddingVertical: 9 }}>
              <Text selectable numberOfLines={2} style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.text, lineHeight: 14 }}>{look}</Text>
            </View>
          </View>
        )}
      </>)}

      {commish && (<>
        <Head>POST TO THE BOARD</Head>
        <Mono size={9.5} tone="dim" style={{ lineHeight: 14, marginBottom: 8 }}>
          Lists the league publicly so managers you don’t know can claim an open seat. Commissioner only — a link
          invites a friend, the board invites strangers.
        </Mono>
        {listing === null ? <Loading /> : (<>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Mono size={9} weight="700" tone={listing.listed ? 'you' : 'faint'} track={0.1}>
              {listing.listed ? '\u25c9 LISTED' : '\u25cb NOT LISTED'}
            </Mono>
            <Mono size={8.5} tone="faint">
              {listing.seatsOpen > 0 ? `${listing.seatsOpen} seat${listing.seatsOpen === 1 ? '' : 's'} open` : 'no open seats \u2014 nobody can claim one'}
            </Mono>
          </View>
          <TextInput
            value={blurb} onChangeText={setBlurb} multiline
            placeholder="A line about your league — what makes it worth joining?"
            placeholderTextColor={t.faint}
            style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, backgroundColor: t.sh, color: t.text, fontFamily: MONO, fontSize: fs(10), padding: 10, minHeight: 66, textAlignVertical: 'top' }} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pressable disabled={busy} onPress={() => { tap(); void runListing(() => postLeagueListing(leagueId, blurb.trim() || null)); }}
              style={{ flex: 1, borderWidth: 1, borderColor: t.you, borderRadius: 6, paddingVertical: 10, alignItems: 'center', opacity: busy ? 0.5 : 1 }}>
              <Mono size={10} weight="700" tone="you">{listing.listed ? '\u2713 UPDATE LISTING' : '\u2191 POST TO BOARD'}</Mono>
            </Pressable>
            {listing.listed && (
              <Pressable disabled={busy} onPress={() => { tap(); void runListing(() => closeLeagueListing(leagueId)); }}
                style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', opacity: busy ? 0.5 : 1 }}>
                <Mono size={10} weight="700" tone="opp">REMOVE</Mono>
              </Pressable>
            )}
          </View>
        </>)}
      </>)}
    </ScrollView>
  );
}

// ── 🔑 API KEYS (0352) — the web's ApiKeysPanel, in the app's idiom ────────
// A manager mints the key an outside tool uses to run their team, once the
// commissioner has switched the write API on. The key is shown ONCE — the
// server keeps only its hash — so the sheet says so in capitals and offers
// the copy button right there. The commissioner sees and can revoke every key.
const whenShort = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
export function ApiKeysView({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<{ on: boolean; commish: boolean; keys: ApiKeyRow[] } | null>(null);
  const [log, setLog] = useState<ApiWriteLogRow[]>([]);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<'team' | 'league'>('team');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => Promise.all([
    apiKeys(leagueId).then((r) => {
      if (r.ok) setSt({ on: !!r.write_api, commish: !!r.is_commish, keys: r.keys ?? [] });
      else setErr(friendlyError(r.error ?? 'could not load'));
    }),
    apiWriteLog(leagueId, 20).then((r) => setLog(r.entries ?? [])),
  ]).catch((x) => setErr(friendlyError(x)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const mint = async () => {
    if (busy) return;
    tap(); setBusy(true); setErr(null); setFresh(null); setCopied(false);
    try {
      const r = await apiKeyCreate(leagueId, label.trim(), scope);
      if (r.ok && r.key) { commit(); setFresh(r.key); setLabel(''); } else { warn(); setErr(friendlyError(r.error ?? 'failed')); }
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); void load(); }
  };
  const revoke = (k: ApiKeyRow) => {
    Alert.alert(`Revoke ${k.label || k.prefix}?`, 'Anything using it stops working at once.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => {
        setBusy(true);
        apiKeyRevoke(k.id).then((r) => { if (!r.ok) setErr(friendlyError(r.error ?? 'failed')); else commit(); })
          .catch((x) => setErr(friendlyError(x)))
          .finally(() => { setBusy(false); void load(); });
      } },
    ]);
  };
  const chip = (label2: string, onPress: () => void, tone: string = t.text) => (
    <Pressable onPress={onPress} disabled={busy}
      style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: tone }}>{label2}</Text>
    </Pressable>
  );
  if (!st) return <Mono size={10} tone={err ? 'opp' : 'faint'}>{err ?? 'Loading…'}</Mono>;
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 24, gap: 10 }}>
      {!st.on ? (
        <Mono size={10} tone="dim" style={{ lineHeight: fs(16) }}>
          {`The write API is off for this league. ${st.commish
            ? 'Switch it on under Commissioner → AWARDS & BADGES → WRITE API, and every manager can make a key here.'
            : 'Only the commissioner can switch it on — ask them if you want to run your team from another tool.'}`}
        </Mono>
      ) : (
        <>
          <Mono size={10} tone="dim" style={{ lineHeight: fs(16) }}>
            {`A key lets another tool act as you in this league — set lineups, add and drop, claim, trade${st.commish ? ', and with LEAGUE scope run your commissioner tools' : ''}. It can do nothing you cannot. Send it as "Authorization: Bearer drip_sk_…" to:`}
          </Mono>
          <Mono size={9.5} tone="you">{publicApiUrl(leagueId)}</Mono>
          <TextInput value={label} onChangeText={setLabel} maxLength={60} placeholder="what is it for? (e.g. lineup bot)"
            placeholderTextColor={t.faint}
            style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(12.5), color: t.text, backgroundColor: t.bg }} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {st.commish && chip(scope === 'team' ? 'TEAM SCOPE' : 'LEAGUE SCOPE', () => { tap(); setScope(scope === 'team' ? 'league' : 'team'); })}
            {chip('MAKE A KEY', () => { void mint(); }, t.you)}
          </View>
          {st.commish && (
            <Mono size={8.5} tone="faint">{scope === 'team' ? 'TEAM: your own team only.' : 'LEAGUE: every team, plus your commissioner tools.'}</Mono>
          )}
          {fresh && (
            <View style={{ borderWidth: 1, borderColor: t.you, borderRadius: 7, padding: 10, gap: 6 }}>
              <Mono size={9} tone="warn">COPY IT NOW — THIS IS THE ONLY TIME IT WILL BE SHOWN</Mono>
              <Text selectable style={{ fontFamily: MONO, fontSize: fs(11), color: t.text }}>{fresh}</Text>
              {chip(copied ? '✓ COPIED' : '⧉ COPY', () => { void copyText(fresh).then((ok) => setCopied(ok)); })}
            </View>
          )}
        </>
      )}
      {err && <Mono size={10} tone="opp">{err}</Mono>}
      {st.keys.length > 0 && (
        <View style={{ gap: 2 }}>
          <Mono size={9} tone="dim" track={0.1}>{st.commish ? 'EVERY KEY IN THE LEAGUE' : 'YOUR KEYS'}</Mono>
          {st.keys.map((k) => (
            <View key={k.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: t.bd, opacity: k.revoked_at ? 0.45 : 1 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: fs(12.5), color: t.text }}>
                  {(k.label || 'unnamed key') + (st.commish && !k.mine && k.owner ? ` · ${k.owner}` : '')}
                </Text>
                <Mono size={8.5} tone="faint">{`${k.prefix}… · ${k.scope.toUpperCase()} · ${k.revoked_at ? `revoked ${whenShort(k.revoked_at)}` : `last used ${whenShort(k.last_used_at)}`}`}</Mono>
              </View>
              {!k.revoked_at && chip('REVOKE', () => { tap(); revoke(k); }, t.opp)}
            </View>
          ))}
        </View>
      )}
      {log.length > 0 && (
        <View style={{ gap: 2 }}>
          <Mono size={9} tone="dim" track={0.1}>{st.commish ? 'RECENT WRITES, EVERY KEY' : 'RECENT WRITES, YOUR KEYS'}</Mono>
          {log.map((l) => (
            <Mono key={l.id} size={9} tone={l.ok ? 'text' : 'opp'} style={{ paddingVertical: 3 }}>
              {`${l.ok ? '✓' : '✕'} ${l.action}${l.roster_id != null ? ` · roster ${l.roster_id}` : ''} · ${l.label || l.prefix || 'key'} · ${whenShort(l.at)}${!l.ok && l.error ? ` — ${l.error}` : ''}`}
            </Mono>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
