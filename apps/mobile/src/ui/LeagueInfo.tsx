// The league's own reference sheets (0186 / v0.274.0, founder's league-menu
// list): SCORING, ROSTER RULES and the REGISTER. All three are read-only
// views for every member — the commissioner edits the same facts behind ⚑
// COMMISH, and these exist so a manager can look up "how does this league
// score a 40-yard TD" or "who dropped him" without being handed the editors.
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  leagueGameMode, rosterRules, leagueRegister,
  type GameModeInfo, type RegisterRow,
} from '@drip/core/data/liveApi';
import { CLASSIC_SCORING_SECTIONS, normalizeClassicScoring, leagueSlotDefs, slotDisplayNames } from '@drip/core/engine/classic';
import { slugMeta } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { useTheme, MONO, fs } from '../theme.native';
import { Mono } from './prims';

/** Minutes-since-midnight-ET → "3:30am" (CommishSettings' own formatter — the
 *  member view has to read the same clock the commissioner set). */
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
  useEffect(() => { leagueGameMode(leagueId).then(setGm).catch(() => setGm({ ok: false })); }, [leagueId]);
  if (!gm) return <Loading />;
  if (!gm.ok) return <Mono size={10} tone="opp" style={{ padding: 14 }}>Couldn't load the scoring.</Mono>;

  const classic = gm.mode === 'classic';
  const sc = normalizeClassicScoring({ ...(gm.scoring ?? {}), ...(gm.ppr != null ? { ppr: gm.ppr } : {}) });
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
      <Row k="GAME MODE" v={classic ? '🏈 NORMAL' : '◈ DRIP'} tone="you" />
      {!classic ? (
        // A drip league has no per-stat table to print: the engine scores it.
        // Saying so beats showing a classic sheet this league never uses.
        <Mono size={10} tone="dim" style={{ marginTop: 14, lineHeight: fs(17) }}>
          ◈ DRIP leagues score through the drip engine — live windows, drips and nukes, and whatever
          power-ups get played. There are no per-stat point values to set here; the rulebook in ⚙ settings
          has the full model.
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
                  <Row key={String(f.key)} k={f.label}
                    v={`${Number(sc[f.key]) > 0 ? '+' : ''}${Number(sc[f.key])}${f.perYard ? ' / yd' : ''}`} />
                ))}
              </View>
            );
          })}
          <Mono size={9} tone="faint" style={{ marginTop: 14, lineHeight: fs(14) }}>
            Anything not listed scores 0 in this league.
          </Mono>
        </>
      )}
    </ScrollView>
  );
}

// ── 🧢 ROSTER RULES ─────────────────────────────────────────────────────────
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
  const caps = Object.entries(rr.pos_caps ?? {}).filter(([, v]) => v != null);
  const mode = rr.waiver_mode ?? 'rolling';
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
      <Head>ROSTER</Head>
      <Row k="ROSTER SIZE" v={`${rr.rounds ?? gm.rounds ?? '—'} players`} tone="you" />
      <Row k="STARTING SPOTS" v={`${defs.length}`} />
      {!!gm.shape?.bench && <Row k="BENCH" v={`${gm.shape.bench}`} />}
      {!!gm.shape?.taxi && <Row k="TAXI" v={`${gm.shape.taxi}`} />}
      {!!gm.shape?.ir && <Row k="IR" v={`${gm.shape.ir}`} />}

      <Head>STARTING LINEUP</Head>
      {defs.map((d, i) => (
        <Row key={d.slot} k={names[i]} v={d.pos.map((p) => (p === 'DEF' ? 'D/ST' : p)).join(' / ')} />
      ))}

      {caps.length > 0 && (<>
        <Head>POSITION LIMITS</Head>
        {caps.map(([p, v]) => <Row key={p} k={p === 'DEF' ? 'D/ST' : p} v={`max ${v}`} />)}
      </>)}

      <Head>WAIVERS</Head>
      <Row k="MODE" v={mode === 'faab' ? 'FAAB blind bids' : mode === 'standings' ? 'reverse standings' : 'rolling priority'} tone="you" />
      {mode === 'faab' && <Row k="SEASON BUDGET" v={`${rr.faab_budget ?? 100}`} />}
      <Row k="HOLD AFTER A DROP" v={`${rr.waiver_hold_days ?? 2} day${(rr.waiver_hold_days ?? 2) === 1 ? '' : 's'}`} />
      <Row k="CLAIMS CLEAR" v={rr.waiver_clear_min == null ? 'rolling — 24h after the drop' : `${fmtEt(rr.waiver_clear_min)} ET`} />
      {!!rr.waiver_clear_dow?.length && <Row k="CLEAR DAYS" v={rr.waiver_clear_dow.map((d) => DOW[d]).join(' · ')} />}

      <Head>FREE AGENCY</Head>
      <Row k="WINDOW" v={rr.fa_start_min == null || rr.fa_end_min == null ? 'always open'
        : `${fmtEt(rr.fa_start_min)} – ${fmtEt(rr.fa_end_min)} ET`} />
      {!!rr.fa_after_waivers_dow?.length && (
        <Row k="ADDS WAIT FOR WAIVERS" v={rr.fa_after_waivers_dow.map((d) => DOW[d]).join(' · ')} />
      )}

      <Head>TRADES</Head>
      <Row k="REVIEW" v={rr.trade_review === 'commish' ? 'commissioner approves' : 'process immediately'} />
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
};
const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function RegisterView({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    leagueRegister(leagueId, 200)
      .then((r) => { if (r.ok && r.rows) setRows(r.rows); else setErr(true); })
      .catch(() => setErr(true));
  }, [leagueId]);
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
      {rows.map((r) => {
        const k = KIND[r.kind] ?? KIND.add;
        const team = r.team ?? `Roster ${r.roster_id}`;
        return (
          <View key={r.id} style={{ flexDirection: 'row', gap: 9, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.bd }}>
            <Text style={{ fontSize: fs(12), width: 18, textAlign: 'center', color: r.kind === 'drop' ? t.opp : t.you }}>{k.icon}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: fs(11.5), lineHeight: fs(16), color: t.text }}>
                <Text style={{ fontWeight: '700' }}>{team}</Text>
                {` ${k.verb} `}
                <Text style={{ fontWeight: '700' }}>{prettySlug(r.slug)}</Text>
                {r.kind === 'trade' && r.from_team ? <Text style={{ color: t.dim }}>{` from ${r.from_team}`}</Text> : null}
                {r.kind === 'waiver' && r.bid != null && r.bid > 0 ? <Text style={{ color: t.dim }}>{` for ${r.bid}`}</Text> : null}
              </Text>
              <Mono size={8.5} tone="faint" style={{ marginTop: 1 }}>{when(r.at)}</Mono>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
