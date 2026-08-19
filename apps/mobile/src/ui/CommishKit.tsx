// The commissioner kit's board-side surface, native (0141) — the web
// commishKit.tsx sibling: the league-note banner plus the two editors
// behind it, edited ON THE BOARD because that is where a commissioner is
// mid-slate. Members see the banner only while a note stands; the
// commissioner always sees the slim affordance.
//
// Self-contained on purpose: given a leagueId it loads the note and the
// player flags itself (flags land in the core module cache behind flagFor),
// and calls onChanged after every load/edit so the host board re-renders
// its flag chips — the injuryVer contract, one prop instead of threading.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  leagueNote, setLeagueNote, playerFlags, setPlayerFlag, setPlayerFlagsBulk, leagueScoringGet, leagueScoringSet,
  friendlyError, leagueGameMode, type PlayerFlagRow, type FlagRulesRaw,
} from '@drip/core/data/liveApi';
import { leagueSlotDefs, slotDisplayNames, slotBadgeLabel } from '@drip/core/engine/classic';
import {
  SCORING_BOUNDS, DEFAULT_SCORING, setLeagueScoring, parseScoring, scoringIsDefault, scoringLabel, scopedRuleLabel,
  type LeagueScoring, type ScopedBonus,
} from '@drip/core/engine/leagueScoring';
import { setLeagueFlags } from '@drip/core/data/commish';
import { PLAYER_BIO } from '@drip/core/data/playerBio';
import { headshot } from '@drip/core/data/media';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Mono, PrimaryButton } from './prims';
import { Overlay } from './Overlay';

export const FLAG_PURPLE = '#A87BD8';

const RULE_DEFS: { key: keyof FlagRulesRaw; label: string }[] = [
  { key: 'no_trade', label: '🚫⇄' }, { key: 'no_add', label: '🚫＋' }, { key: 'no_start', label: '🚫▶' },
  { key: 'no_powerups', label: '🚫◈' }, { key: 'immune', label: '🛡' },
];
const ruleGlyphs = (r?: FlagRulesRaw | null): string => {
  if (!r) return '';
  const g: string[] = [];
  if (r.no_trade) g.push('🚫⇄'); if (r.no_add) g.push('🚫＋'); if (r.no_start) g.push('🚫▶');
  if (r.no_powerups) g.push('🚫◈'); if (r.immune) g.push('🛡');
  if (r.bonus_mult != null && r.bonus_mult !== 1) g.push(`×${r.bonus_mult}`);
  if (r.bonus_pts != null && r.bonus_pts !== 0) g.push(`${r.bonus_pts > 0 ? '+' : ''}${r.bonus_pts}`);
  return g.join(' ');
};

/** A flag's label, derived from its rules — so "pick rules, hit FLAG" works
 *  without inventing a name (the second playtest stall on the label field).
 *  Null when there are no rules to name it by: a flag must say or do
 *  SOMETHING, since a label-less save is the delete gesture server-side. */
const autoLabel = (r?: FlagRulesRaw | null): string | null => {
  if (!r) return null;
  const parts: string[] = [];
  if (r.no_trade) parts.push('no trades'); if (r.no_add) parts.push('no adds'); if (r.no_start) parts.push('no starts');
  if (r.no_powerups) parts.push('no powerups'); if (r.immune) parts.push('immune');
  if (r.bonus_mult != null && r.bonus_mult !== 1) parts.push(`×${r.bonus_mult} pts`);
  if (r.bonus_pts != null && r.bonus_pts !== 0) parts.push(`${r.bonus_pts > 0 ? '+' : ''}${r.bonus_pts} pts`);
  return parts.length ? parts.join(' · ').slice(0, 40) : null;
};

const prettify = (slug: string) =>
  slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

// Directory-filter axes for bulk flagging + scoped bonuses (0145) — the web
// commishKit constants; the team pick is a horizontal chip strip here since
// RN has no <select>.
const FILTER_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const TENURES = [
  { id: 'rookie', label: 'ROOKIES' },
  { id: 'y2_3', label: '2ND–3RD YR' },
  { id: 'vet4', label: 'VETS 4+' },
] as const;
const ALL_TEAMS: string[] = [...new Set(Object.values(PLAYER_BIO).map((b) => b.team).filter((t): t is string => !!t))].sort();
const tenureMatch = (exp: number | undefined, ten: string): boolean => {
  if (exp == null) return false;
  if (ten === 'rookie') return exp === 0;
  if (ten === 'y2_3') return exp >= 1 && exp <= 2;
  return exp >= 3;
};

function FilterChip({ label, on, tone, onPress }: { label: string; on: boolean; tone: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tap(); onPress(); }}
      style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: on ? tone : t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? tone : t.bd }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: on ? t.onAccent : t.dim }}>{label}</Text>
    </Pressable>
  );
}

/** All 32 team codes as a one-line horizontal strip — 'ALL' means no filter. */
function TeamStrip({ value, set }: { value: string; set: (v: string) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 6 }} nestedScrollEnabled>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        <FilterChip label="ANY TEAM" on={value === 'ALL'} tone={t.you} onPress={() => set('ALL')} />
        {ALL_TEAMS.map((tm) => <FilterChip key={tm} label={tm} on={value === tm} tone={t.you} onPress={() => set(tm)} />)}
      </View>
    </ScrollView>
  );
}

export function CommishKit({ leagueId, onChanged }: {
  leagueId: string;
  /** Called whenever flags land in the module cache — bump a version counter
   *  so the board's flag chips re-render. */
  onChanged: () => void;
}) {
  const t = useTheme();
  const [scoring, setScoring] = useState<LeagueScoring | null>(null);

  const load = async () => {
    const [f, sc] = await Promise.all([
      playerFlags(leagueId).catch(() => null),
      leagueScoringGet(leagueId).catch(() => null),
    ]);
    if (Array.isArray(f)) { setLeagueFlags(leagueId, f); onChanged(); }
    if (sc && sc.ok) {
      const knobs = parseScoring(sc);
      setLeagueScoring(knobs);   // any local resolve/display uses the league's knobs
      setScoring(knobs);
      onChanged();
    }
  };
  useEffect(() => {
    void load();
    const id = setInterval(load, 300_000); // notes and flags move slowly
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // The note moved to the LEAGUE HOME (0182.1 — founder's call: one place,
  // not two) and the editors live on the COMMISH screen's kit card. This
  // component stays mounted on the board for its SIDE EFFECTS — it is what
  // loads the flag + scoring caches the board renders from — plus the one
  // thing that must never leave the board: the non-default-scoring chip.
  const scoringOn = scoring != null && !scoringIsDefault(scoring);
  if (!scoringOn) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
      <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.warn }}>⚖ {scoringLabel(scoring)}</Text>
      </View>
    </View>
  );
}

function ScoringEditor({ visible, leagueId, initial, onDone, onClose }: {
  visible: boolean; leagueId: string; initial: LeagueScoring; onDone: () => void; onClose: () => void;
}) {
  const t = useTheme();
  const [td, setTd] = useState(initial.tdBonus);
  const [yd, setYd] = useState(initial.ydMult);
  const [to, setTo] = useState(initial.toPenalty);
  const [scoped, setScoped] = useState<ScopedBonus[]>(initial.scoped ?? []);
  // draft rule being built in the ADD row
  const [dPos, setDPos] = useState<Set<string>>(new Set());
  const [dTeam, setDTeam] = useState('ALL');
  const [dTen, setDTen] = useState('ALL');
  const [dMult, setDMult] = useState(1);
  const [dPts, setDPts] = useState(0);
  const [dTd, setDTd] = useState(0);
  const [dSlot, setDSlot] = useState<Set<string>>(new Set());
  const [dFlag, setDFlag] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The league's lineup + flag vocabulary (v0.300.0) — a scoped rule may name a
  // SPOT or a FLAG, and neither is guessable from the player alone.
  const [mode, setMode] = useState<'drip' | 'classic' | null>(null);
  const [spots, setSpots] = useState<{ id: string; name: string }[]>([]);
  const [flagLabels, setFlagLabels] = useState<string[]>([]);
  useEffect(() => {
    if (visible) {
      setTd(initial.tdBonus); setYd(initial.ydMult); setTo(initial.toPenalty);
      setScoped(initial.scoped ?? []);
      setDPos(new Set()); setDTeam('ALL'); setDTen('ALL'); setDMult(1); setDPts(0); setDTd(0);
      setDSlot(new Set()); setDFlag(new Set());
      setErr(null);
    }
  }, [visible, initial]);
  useEffect(() => {
    if (!visible) return;
    let dead = false;
    void (async () => {
      try {
        const gm = await leagueGameMode(leagueId);
        if (dead || !gm?.ok) return;
        setMode(gm.mode === 'classic' ? 'classic' : 'drip');
        const defs = leagueSlotDefs(gm);
        const names = slotDisplayNames(defs);
        setSpots(defs.map((d, i) => ({ id: d.slot, name: slotBadgeLabel(names[i] ?? d.slot) })));
      } catch { /* pickers stay empty */ }
    })();
    void (async () => {
      try {
        const rows = await playerFlags(leagueId);
        if (dead || !Array.isArray(rows)) return;
        setFlagLabels([...new Set(rows.map((r) => (r.label ?? '').trim()).filter(Boolean))].sort());
      } catch { /* ditto */ }
    })();
    return () => { dead = true; };
  }, [visible, leagueId]);
  const spotNames = useMemo(() => Object.fromEntries(spots.map((sp) => [sp.id, sp.name])), [spots]);
  const toWire = (r: ScopedBonus) => ({
    ...(r.pos?.length ? { pos: r.pos } : {}),
    ...(r.team?.length ? { team: r.team } : {}),
    ...(r.tenure ? { tenure: r.tenure } : {}),
    ...(r.slot?.length ? { slot: r.slot } : {}),
    ...(r.flag?.length ? { flag: r.flag } : {}),
    ...(r.bonusMult != null ? { bonus_mult: r.bonusMult } : {}),
    ...(r.bonusPts != null ? { bonus_pts: r.bonusPts } : {}),
    ...(r.tdBonus != null ? { td_bonus: r.tdBonus } : {}),
  });
  const addRule = () => {
    if (dMult === 1 && dPts === 0 && dTd === 0) { warn(); setErr('Give the rule a value — a multiplier, flat points, or a TD bonus.'); return; }
    if (scoped.length >= 12) { warn(); setErr('At most 12 scoped rules.'); return; }
    tap(); setErr(null);
    setScoped([...scoped, {
      ...(dPos.size ? { pos: [...dPos] } : {}),
      ...(dTeam !== 'ALL' ? { team: [dTeam] } : {}),
      ...(dTen !== 'ALL' ? { tenure: dTen as ScopedBonus['tenure'] } : {}),
      ...(dSlot.size ? { slot: [...dSlot] } : {}),
      ...(dFlag.size ? { flag: [...dFlag] } : {}),
      ...(dMult !== 1 ? { bonusMult: dMult } : {}),
      ...(dPts !== 0 ? { bonusPts: dPts } : {}),
      ...(dTd !== 0 ? { tdBonus: dTd } : {}),
    }]);
    setDPos(new Set()); setDTeam('ALL'); setDTen('ALL'); setDMult(1); setDPts(0); setDTd(0);
    setDSlot(new Set()); setDFlag(new Set());
  };
  const save = async (tdV: number, ydV: number, toV: number, scopedV: ScopedBonus[] = scoped) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await leagueScoringSet(leagueId, tdV, Math.round(ydV * 10) / 10, toV, scopedV.map(toWire));
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not save.')); return; }
      commit(); onDone();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const mini = (tag: string, v: number, set: (n: number) => void, min: number, max: number, step: number, dflt: number, fmt: (n: number) => string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Mono size={8} tone="faint">{tag}</Mono>
      <Pressable hitSlop={4} onPress={() => { tap(); set(Math.round(Math.max(min, v - step) * 10) / 10); }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(12), color: t.dim, paddingHorizontal: 4 }}>−</Text>
      </Pressable>
      <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', minWidth: 28, textAlign: 'center', color: v !== dflt ? t.warn : t.dim }}>{fmt(v)}</Text>
      <Pressable hitSlop={4} onPress={() => { tap(); set(Math.round(Math.min(max, v + step) * 10) / 10); }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(12), color: t.dim, paddingHorizontal: 4 }}>＋</Text>
      </Pressable>
    </View>
  );
  const stepper = (label: string, hint: string, v: number, set: (n: number) => void,
    b: { min: number; max: number; step: number }, fmt: (n: number) => string) => (
    <View style={{ marginTop: 12 }}>
      <Mono size={9} tone="faint" track={0.12}>{label}</Mono>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <Pressable onPress={() => { tap(); set(Math.round(Math.max(b.min, v - b.step) * 10) / 10); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 13, paddingVertical: 6 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: '700', color: t.text }}>−</Text>
        </Pressable>
        <Text style={{ fontFamily: MONO, fontSize: fs(16), fontWeight: '700', color: t.text, minWidth: 48, textAlign: 'center' }}>{fmt(v)}</Text>
        <Pressable onPress={() => { tap(); set(Math.round(Math.min(b.max, v + b.step) * 10) / 10); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 13, paddingVertical: 6 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: '700', color: t.text }}>＋</Text>
        </Pressable>
        <Mono size={8.5} tone="faint" style={{ flex: 1, lineHeight: fs(12) }}>{hint}</Mono>
      </View>
    </View>
  );
  return (
    <Overlay visible={visible} title="⚖ League scoring"
      subtitle="Adjustments layer on the base game and apply to every matchup. Every member sees them." onClose={onClose}
      footer={
        // Pinned below the scroll — SAVE must never be the thing the sheet
        // clips (first thing the founder's phone did with the scoped section).
        <>
          {!!err && <Mono size={9.5} tone="opp" style={{ marginBottom: 8 }}>{err}</Mono>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton label={busy ? '…' : 'SAVE'} disabled={busy} onPress={() => void save(td, yd, to)} />
            </View>
            <Pressable disabled={busy} onPress={() => { tap(); void save(DEFAULT_SCORING.tdBonus, DEFAULT_SCORING.ydMult, DEFAULT_SCORING.toPenalty, []); }}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
              <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.dim }}>RESET</Text>
            </Pressable>
          </View>
        </>
      }>
      <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
      {/* A CLASSIC LEAGUE HAS ONLY THE SCOPED BONUSES (v0.300.0). Its scoring
          catalog is edited on the web dash; a second TD bonus and a second
          yardage multiplier here silently doubled knobs it already owns. */}
      {mode !== 'classic' && <>
        {stepper('TD BONUS', 'extra points on every TD your players score', td, setTd, SCORING_BOUNDS.tdBonus, (n) => `${n > 0 ? '+' : ''}${n}`)}
        {stepper('YARDAGE MULTIPLIER', 'scales per-yard scoring and drip growth', yd, setYd, SCORING_BOUNDS.ydMult, (n) => `×${n}`)}
        {stepper('TURNOVER PENALTY', 'points off a player’s own bank per giveaway', to, setTo, SCORING_BOUNDS.toPenalty, (n) => (n === 0 ? 'off' : `−${n}`))}
      </>}

      {/* SCOPED BONUSES (0145): the founder's "team, position, tenure"
          filters — rules that pay only players matching the scope. v0.300.0
          adds the SPOT he's started in and the FLAG he wears. */}
      <View style={mode === 'classic'
        ? { marginTop: 4 }
        : { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 12 }}>
        <Mono size={9} tone="faint" track={0.12}>SCOPED BONUSES</Mono>
        <Mono size={8.5} tone="faint" style={{ marginTop: 3, lineHeight: fs(12) }}>
          Bonuses for players matching a position / team / tenure scope — and, if you like, the SPOT they’re started in or the FLAG they wear. Rules stack — multipliers multiply, points sum.
        </Mono>
        {scoped.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
            <Text numberOfLines={2} style={{ flex: 1, fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.warn, lineHeight: fs(13) }}>⚖ {scopedRuleLabel(r, spotNames)}</Text>
            <Pressable hitSlop={6} disabled={busy} onPress={() => { tap(); setScoped(scoped.filter((_, j) => j !== i)); }}>
              <Text style={{ fontSize: fs(13), color: t.opp }}>✕</Text>
            </Pressable>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          {FILTER_POS.map((p) => (
            <FilterChip key={p} label={p} on={dPos.has(p)} tone={t.you}
              onPress={() => setDPos((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n; })} />
          ))}
          {TENURES.map((tn) => (
            <FilterChip key={tn.id} label={tn.label} on={dTen === tn.id} tone={t.warn}
              onPress={() => setDTen(dTen === tn.id ? 'ALL' : tn.id)} />
          ))}
        </View>
        <TeamStrip value={dTeam} set={setDTeam} />
        {/* THE SPOT (v0.300.0): a rule about the LINEUP rather than the player
            — the FLEX pays ×1.5 no matter who fills it. */}
        {mode === 'classic' && spots.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            <Mono size={8} tone="faint">IN SPOT</Mono>
            {spots.map((sp) => (
              <FilterChip key={sp.id} label={sp.name} on={dSlot.has(sp.id)} tone={t.you}
                onPress={() => setDSlot((cur) => { const n = new Set(cur); if (n.has(sp.id)) n.delete(sp.id); else n.add(sp.id); return n; })} />
            ))}
          </View>
        )}
        {/* THE FLAG (v0.300.0): one rule that pays everyone wearing a label. */}
        {flagLabels.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            <Mono size={8} tone="faint">FLAGGED</Mono>
            {flagLabels.map((fl) => (
              <FilterChip key={fl} label={`⚑ ${fl}`} on={dFlag.has(fl)} tone={FLAG_PURPLE}
                onPress={() => setDFlag((cur) => { const n = new Set(cur); if (n.has(fl)) n.delete(fl); else n.add(fl); return n; })} />
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 }}>
          {mini('PTS', dMult, setDMult, 0.5, 3, 0.1, 1, (n) => `×${n}`)}
          {mini('BONUS', dPts, setDPts, -10, 10, 0.5, 0, (n) => `${n > 0 ? '+' : ''}${n}`)}
          {mini('TD', dTd, setDTd, -3, 6, 1, 0, (n) => `${n > 0 ? '+' : ''}${n}`)}
          <Pressable onPress={addRule}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.dim }}>＋ ADD RULE</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ height: 12 }} />
      </ScrollView>
    </Overlay>
  );
}

/** The same three tools as a COMMISH-SCREEN card (founder's ask: the board
 *  banner stays, but the commissioner's desk gets them too). Self-loading by
 *  leagueId — no live board required. Web sibling: CommishToolsPanel. */
export function CommishToolsCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [note, setNote] = useState<{ text: string | null; canEdit: boolean } | null>(null);
  const [scoring, setScoring] = useState<LeagueScoring | null>(null);
  const [flagCount, setFlagCount] = useState<number | null>(null);
  const [openTool, setOpenTool] = useState<null | 'note' | 'flags' | 'scoring'>(null);
  const load = async () => {
    const [n, f, sc] = await Promise.all([
      leagueNote(leagueId).catch(() => null),
      playerFlags(leagueId).catch(() => null),
      leagueScoringGet(leagueId).catch(() => null),
    ]);
    if (n && n.ok) setNote({ text: n.text ?? null, canEdit: !!n.can_edit });
    if (Array.isArray(f)) setFlagCount(f.length);
    if (sc && sc.ok) setScoring(parseScoring(sc));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const row = (icon: string, label: string, value: string, warnTone: boolean, tool: 'note' | 'flags' | 'scoring', cta: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 0.8, color: FLAG_PURPLE, width: 74 }}>{icon} {label}</Text>
      <Text numberOfLines={2} style={{ flex: 1, fontFamily: MONO, fontSize: fs(9.5), lineHeight: fs(13), color: warnTone ? t.warn : t.dim }}>{value}</Text>
      <Pressable onPress={() => { tap(); setOpenTool(tool); }}
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4 }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.dim }}>{cta}</Text>
      </Pressable>
    </View>
  );
  return (
    <>
      <View style={{ backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 10, padding: 12 }}>
        <Mono size={9} tone="faint" track={0.12}>⚑ COMMISH KIT</Mono>
        <Mono size={8.5} tone="faint" style={{ marginTop: 3, marginBottom: 6, lineHeight: fs(12) }}>
          The board banner's tools, here too. League-visible; rules and scoring apply from the next tick.
        </Mono>
        {row('⚑', 'NOTE', note == null ? 'loading…' : note.text ?? 'nothing posted', false, 'note', note?.text ? '✎ EDIT' : '✎ WRITE')}
        {row('⚑', 'FLAGS', flagCount == null ? 'loading…' : flagCount === 0 ? 'none' : `${flagCount} player${flagCount === 1 ? '' : 's'} flagged`, false, 'flags', '⚑ MANAGE')}
        {row('⚖', 'SCORING', scoring == null ? 'loading…' : scoringIsDefault(scoring) ? 'base rules' : scoringLabel(scoring), scoring != null && !scoringIsDefault(scoring), 'scoring', '⚖ ADJUST')}
      </View>
      <NoteEditor visible={openTool === 'note'} leagueId={leagueId} initial={note?.text ?? ''}
        onDone={() => { setOpenTool(null); void load(); }} onClose={() => setOpenTool(null)} />
      <FlagsEditor visible={openTool === 'flags'} leagueId={leagueId}
        onChanged={() => void load()} onClose={() => { setOpenTool(null); void load(); }} />
      {scoring && (
        <ScoringEditor visible={openTool === 'scoring'} leagueId={leagueId} initial={scoring}
          onDone={() => { setOpenTool(null); void load(); }} onClose={() => setOpenTool(null)} />
      )}
    </>
  );
}

function NoteEditor({ visible, leagueId, initial, onDone, onClose }: {
  visible: boolean; leagueId: string; initial: string; onDone: () => void; onClose: () => void;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setDraft(initial); setErr(null); } }, [visible, initial]);
  const save = async (text: string | null) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await setLeagueNote(leagueId, text);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not save the note.')); return; }
      commit(); onDone();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <Overlay visible={visible} title="⚑ League note"
      subtitle="One standing announcement, shown to every member on their board." onClose={onClose}>
      <TextInput value={draft} multiline maxLength={500} onChangeText={setDraft}
        placeholder="e.g. Practice week is open — set your boards by Friday 6PM ET."
        placeholderTextColor={t.faint}
        style={{ minHeight: 84, textAlignVertical: 'top', borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(13), lineHeight: fs(18), color: t.text, backgroundColor: t.bg }} />
      {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 6 }}>{err}</Mono>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton label={busy ? '…' : 'SAVE NOTE'} disabled={busy || !draft.trim()} onPress={() => void save(draft)} />
        </View>
        {!!initial && (
          <Pressable disabled={busy} onPress={() => { tap(); void save(null); }}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 13, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: t.opp }}>CLEAR</Text>
          </Pressable>
        )}
      </View>
    </Overlay>
  );
}

function FlagsEditor({ visible, leagueId, onChanged, onClose }: {
  visible: boolean; leagueId: string; onChanged: () => void; onClose: () => void;
}) {
  const t = useTheme();
  const [rows, setRows] = useState<PlayerFlagRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [labelFor, setLabelFor] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [rulesDraft, setRulesDraft] = useState<FlagRulesRaw>({});
  // BULK (0144): multi-select over the search results, one label + one rule
  // set in a single call — parity with the web editor.
  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Bulk filters (playtest finding): position / team / tenure narrow the
  // directory alongside (or instead of) the search box.
  const [fPos, setFPos] = useState('ALL');
  const [fTeam, setFTeam] = useState('ALL');
  const [fTen, setFTen] = useState('ALL');
  const filtersOn = fPos !== 'ALL' || fTeam !== 'ALL' || fTen !== 'ALL';
  // What the last scoped rule saved from here reads as — shown until the next
  // action, so a rule that vanished into the scoring editor still confirms.
  const [ruleNote, setRuleNote] = useState<string | null>(null);

  const load = () => playerFlags(leagueId).then((r) => { if (Array.isArray(r)) setRows(r); }).catch(() => {});
  useEffect(() => {
    if (visible) {
      void load(); setQ(''); setLabelFor(null); setErr(null);
      setSelected(new Set()); setFPos('ALL'); setFTeam('ALL'); setFTen('ALL');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leagueId]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2 && !(bulk && filtersOn)) return [];
    const out: string[] = [];
    for (const [slug, b] of Object.entries(PLAYER_BIO)) {
      if (needle.length >= 2 && !slug.replace(/-/g, ' ').includes(needle)) continue;
      if (bulk) {
        if (fPos !== 'ALL' && b.pos !== fPos) continue;
        if (fTeam !== 'ALL' && b.team !== fTeam) continue;
        if (fTen !== 'ALL' && !tenureMatch(b.exp, fTen)) continue;
      }
      out.push(slug);
      if (out.length >= (bulk ? 500 : 12)) break;
    }
    return out;
  }, [q, bulk, fPos, fTeam, fTen, filtersOn]);

  const save = async (slug: string, label: string | null) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await setPlayerFlag(leagueId, slug, label, rulesDraft);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not save the flag.')); return; }
      commit();
      setLabelFor(null); setLabelDraft(''); setQ('');
      await load(); onChanged();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  /** THE SAME FILTERS, AS A RULE INSTEAD OF A LIST (v0.278.0, founder: "can
   *  we allow scoped bonuses for player flags?").
   *
   *  Flagging is per-player: it names sixty slugs and stops there — a rookie
   *  signed in week 6 is not in the list, and nobody remembers to go back. A
   *  SCOPED bonus (0145) is the same intent said as a rule ("rookies ×1.5"),
   *  so it covers whoever matches, whenever. The filters on this screen
   *  already ARE a scope, so this just hands them over rather than making the
   *  commissioner rebuild them in the scoring editor.
   *
   *  Only the numeric halves travel: a scoped rule has no notion of
   *  can't-trade / can't-start — those stay per-player flags, and the sheet
   *  says so rather than dropping them silently. */
  /** The filter as the rule will read it — same order scopedRuleLabel uses,
   *  so the button's promise and the saved rule can't drift apart. */
  const scopeWords = (): string => {
    const parts = [
      fPos !== 'ALL' ? fPos : null,
      fTeam !== 'ALL' ? fTeam : null,
      fTen === 'rookie' ? 'rookies' : fTen === 'y2_3' ? '2nd–3rd yr' : fTen === 'vet4' ? 'vets 4+' : null,
    ].filter(Boolean);
    const who = parts.length ? parts.join(' / ') : 'everyone';
    const mult = rulesDraft.bonus_mult ?? 1;
    const pts = rulesDraft.bonus_pts ?? 0;
    const vals = [mult !== 1 ? `×${mult}` : null, pts !== 0 ? `${pts > 0 ? '+' : ''}${pts}` : null].filter(Boolean).join(' ');
    return vals ? `${who}: ${vals}` : `${who} — set a × or ± above`;
  };

  const saveScopedRule = async () => {
    if (busy) return;
    const mult = rulesDraft.bonus_mult ?? 1;
    const pts = rulesDraft.bonus_pts ?? 0;
    if (mult === 1 && pts === 0) {
      warn(); setErr('Set a × multiplier or ± points first — a scoped rule is a bonus, not a label.');
      return;
    }
    if (!filtersOn) { warn(); setErr('Pick a position, team or tenure — that filter is the rule’s scope.'); return; }
    setBusy(true); setErr(null);
    try {
      const cur = await leagueScoringGet(leagueId);
      if (!cur?.ok) { warn(); setErr('Could not read the league’s scoring.'); return; }
      const now = parseScoring(cur);
      if (now.scoped.length >= 12) { warn(); setErr('At most 12 scoped rules — remove one in ⚖ SCORING first.'); return; }
      const rule = {
        ...(fPos !== 'ALL' ? { pos: [fPos] } : {}),
        ...(fTeam !== 'ALL' ? { team: [fTeam] } : {}),
        ...(fTen !== 'ALL' ? { tenure: fTen } : {}),
        ...(mult !== 1 ? { bonus_mult: mult } : {}),
        ...(pts !== 0 ? { bonus_pts: pts } : {}),
      };
      const wire = now.scoped.map((r) => ({
        ...(r.pos?.length ? { pos: r.pos } : {}),
        ...(r.team?.length ? { team: r.team } : {}),
        ...(r.tenure ? { tenure: r.tenure } : {}),
        ...(r.bonusMult != null ? { bonus_mult: r.bonusMult } : {}),
        ...(r.bonusPts != null ? { bonus_pts: r.bonusPts } : {}),
        ...(r.tdBonus != null ? { td_bonus: r.tdBonus } : {}),
      }));
      const r = await leagueScoringSet(leagueId, now.tdBonus, now.ydMult, now.toPenalty, [...wire, rule]);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not save the rule.')); return; }
      commit();
      setRuleNote(`⚖ ${scopedRuleLabel(parseScoring({ scoped: [rule] }).scoped[0])} — saved. It pays everyone who matches, now and later.`);
      setFPos('ALL'); setFTeam('ALL'); setFTen('ALL');
      onChanged();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const saveBulk = async () => {
    if (busy || !selected.size) return;
    // Empty label + rules set → the rules name the flag (autoLabel). Only a
    // flag with nothing to say at all is refused — and the button TELLS you,
    // right where you're looking: a silently greyed button read as "the flag
    // doesn't take" in the founder's first playtest.
    const lbl = labelDraft.trim() || autoLabel(rulesDraft);
    if (!lbl) { warn(); setErr('Give the flag a label or a rule — the label is what the league sees on every chip.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await setPlayerFlagsBulk(leagueId, [...selected], lbl, rulesDraft);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not save the flags.')); return; }
      commit();
      setSelected(new Set()); setLabelDraft(''); setRulesDraft({}); setQ(''); setBulk(false);
      await load(); onChanged();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  // BULK REMOVE (playtest ask): the same RPC with a null label — its delete
  // gesture — chunked to the 500-slug cap so "clear all" survives any count.
  const unflag = async (slugs: string[]) => {
    if (busy || !slugs.length) return;
    setBusy(true); setErr(null);
    try {
      for (let i = 0; i < slugs.length; i += 500) {
        const r = await setPlayerFlagsBulk(leagueId, slugs.slice(i, i + 500), null);
        if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not remove the flags.')); return; }
      }
      commit();
      setSelected(new Set());
      await load(); onChanged();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const face = (slug: string) => {
    const src = headshot(slug);
    return (
      <View style={{ width: 22, height: 22, borderRadius: 11, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center' }}>
        {src ? <Image source={{ uri: src }} style={{ width: 22, height: 22 }} resizeMode="cover" />
          : <Text style={{ fontFamily: MONO, fontSize: fs(8), color: t.faint }}>?</Text>}
      </View>
    );
  };
  const mini = (v: number, dflt: number, min: number, max: number, step: number, key: 'bonus_mult' | 'bonus_pts', fmt: (n: number) => string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Pressable hitSlop={4} onPress={() => { tap(); setRulesDraft({ ...rulesDraft, [key]: Math.round(Math.max(min, v - step) * 10) / 10 }); }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(12), color: t.dim, paddingHorizontal: 4 }}>−</Text>
      </Pressable>
      <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', minWidth: 26, textAlign: 'center', color: v !== dflt ? t.warn : t.dim }}>{fmt(v)}</Text>
      <Pressable hitSlop={4} onPress={() => { tap(); setRulesDraft({ ...rulesDraft, [key]: Math.round(Math.min(max, v + step) * 10) / 10 }); }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(12), color: t.dim, paddingHorizontal: 4 }}>＋</Text>
      </Pressable>
    </View>
  );
  const ruleControls = (
    <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 6, flexBasis: '100%' }}>
      {RULE_DEFS.map((d) => {
        const on = rulesDraft[d.key] === true;
        return (
          <Pressable key={d.key} onPress={() => { tap(); setRulesDraft({ ...rulesDraft, [d.key]: on ? undefined : true }); }}
            style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: on ? FLAG_PURPLE : t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? FLAG_PURPLE : t.bd }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: on ? t.onAccent : t.dim }}>{d.label}</Text>
          </Pressable>
        );
      })}
      <Mono size={8} tone="faint">×</Mono>
      {mini(rulesDraft.bonus_mult ?? 1, 1, 0.5, 3, 0.1, 'bonus_mult', (n) => `×${n}`)}
      <Mono size={8} tone="faint">±</Mono>
      {mini(rulesDraft.bonus_pts ?? 0, 0, -10, 10, 0.5, 'bonus_pts', (n) => `${n > 0 ? '+' : ''}${n}`)}
    </View>
  );
  const labelInput = (slug: string) => {
    const effective = labelDraft.trim() || autoLabel(rulesDraft);
    return (
      <View style={{ flexDirection: 'row', gap: 6, flex: 1 }}>
        <TextInput value={labelDraft} autoFocus maxLength={40} onChangeText={setLabelDraft}
          placeholder="keeper · out for season…" placeholderTextColor={t.faint}
          style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: fs(11.5), color: t.text, backgroundColor: t.bg }} />
        <Pressable disabled={busy || !effective} onPress={() => { tap(); effective && void save(slug, effective); }}
          style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 10, justifyContent: 'center', opacity: busy || !effective ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.onAccent }}>SET</Text>
        </Pressable>
      </View>
    );
  };

  // Pinned below the scroll — the bulk save controls must never be the thing
  // the sheet clips, however long the flag list or the filtered matches run.
  const bulkFooter = (
    <>
      <TextInput value={labelDraft} maxLength={40} onChangeText={setLabelDraft}
        placeholder="label — leave empty and the rules name it…" placeholderTextColor={t.faint}
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(12.5), color: t.text, backgroundColor: t.bg }} />
      {ruleControls}
      {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 6 }}>{err}</Mono>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton label={busy ? '…' : `⚑ FLAG ${selected.size} PLAYER${selected.size === 1 ? '' : 'S'}`}
            disabled={busy || !selected.size} onPress={() => void saveBulk()} />
        </View>
        <Pressable disabled={busy || !selected.size} onPress={() => { tap(); void unflag([...selected]); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', opacity: busy || !selected.size ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.opp }}>✕ UNFLAG</Text>
        </Pressable>
      </View>
      {!labelDraft.trim() && selected.size > 0 && (
        autoLabel(rulesDraft)
          ? <Text style={{ fontFamily: MONO, fontSize: fs(8.5), color: t.dim, marginTop: 5, lineHeight: fs(12) }}>
              no label — the flag will read “{autoLabel(rulesDraft)}”
            </Text>
          : <Text style={{ fontFamily: MONO, fontSize: fs(8.5), color: t.warn, marginTop: 5, lineHeight: fs(12) }}>
              ↑ give it a label or a rule — the label is what the league sees on every flagged player’s chip
            </Text>
      )}
      {/* ⚖ THE SAME BONUS AS A RULE (v0.278.0). Offered only with a filter up,
          because the filter IS the scope — and it says what it will read as
          before you press it, since the rule lands in ⚖ SCORING rather than
          in the flag list above. */}
      {filtersOn && (
        <Pressable disabled={busy} onPress={() => { tap(); void saveScopedRule(); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginTop: 8, opacity: busy ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.warn }}>
            ⚖ MAKE IT A SCOPED RULE INSTEAD
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: fs(8.5), color: t.dim, marginTop: 3, lineHeight: fs(12) }}>
            {scopeWords()} — pays everyone who matches, now and later. No player list to keep up to date.
          </Text>
        </Pressable>
      )}
      {(rulesDraft.no_trade || rulesDraft.no_add || rulesDraft.no_start || rulesDraft.no_powerups || rulesDraft.immune) && filtersOn && (
        <Text style={{ fontFamily: MONO, fontSize: fs(8), color: t.faint, marginTop: 4, lineHeight: fs(11) }}>
          a scoped rule carries the × and ± only — the restrictions above stay per-player flags
        </Text>
      )}
      {!!ruleNote && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), color: t.warn, marginTop: 6, lineHeight: fs(12) }}>{ruleNote}</Text>}
    </>
  );

  return (
    <Overlay visible={visible} title="⚑ Player flags"
      subtitle="A short label the whole league sees wherever the player appears." onClose={onClose}
      footer={bulk ? bulkFooter : undefined}>
      {/* `flexShrink: 1` — the contract ui/Overlay states in its own docblock,
          and what every other sheet in the app uses. This body carried
          `flexGrow: 0` instead (since v0.217.0), which is a different
          property: it refuses to GROW, and RN's default flexShrink of 0 meant
          it also refused to shrink. With a footer under it (bulk mode) the
          column had nothing left to give the body, and it collapsed — the
          founder's flags sheet showed a label box, the rule chips, and an
          empty screen where the player list should be. */}
      <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
      {!bulk && !!err && <Mono size={9.5} tone="opp" style={{ marginBottom: 6 }}>{err}</Mono>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono size={9} tone="faint" track={0.12}>CURRENT FLAGS</Mono>
        <View style={{ flex: 1 }} />
        {(rows?.length ?? 0) > 1 && (
          <Pressable hitSlop={6} disabled={busy}
            onPress={() => {
              tap();
              Alert.alert('Clear all flags?', `Remove all ${rows!.length} flags from this league?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => void unflag(rows!.map((f) => f.slug)) },
              ]);
            }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.opp, opacity: busy ? 0.5 : 1 }}>✕ CLEAR ALL {rows!.length}</Text>
          </Pressable>
        )}
      </View>
      {rows == null && <Mono size={10} tone="faint" style={{ marginTop: 6 }}>Loading…</Mono>}
      {rows?.length === 0 && <Mono size={10} tone="faint" style={{ marginTop: 6 }}>None yet.</Mono>}
      {rows?.map((f) => (
        <View key={f.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd, flexWrap: 'wrap' }}>
          {face(f.slug)}
          <Text style={{ fontSize: fs(12), color: t.text }}>{prettify(f.slug)}</Text>
          {labelFor === f.slug
            ? <>{labelInput(f.slug)}{ruleControls}</>
            : <>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: FLAG_PURPLE }}>⚑ {f.label}{ruleGlyphs(f.rules) ? ` · ${ruleGlyphs(f.rules)}` : ''}</Text>
                <Pressable hitSlop={6} onPress={() => { tap(); setLabelFor(f.slug); setLabelDraft(f.label); setRulesDraft(f.rules ?? {}); }}>
                  <Text style={{ fontSize: fs(12), color: t.dim }}>✎</Text>
                </Pressable>
                <Pressable hitSlop={6} disabled={busy} onPress={() => { tap(); void save(f.slug, null); }}>
                  <Text style={{ fontSize: fs(12), color: t.opp }}>✕</Text>
                </Pressable>
              </>}
        </View>
      ))}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <Mono size={9} tone="faint" track={0.12}>{bulk ? `FLAG MANY — ${selected.size} SELECTED` : 'FLAG A PLAYER'}</Mono>
        <View style={{ flex: 1 }} />
        <Pressable hitSlop={6} onPress={() => { tap(); setBulk((v) => !v); setSelected(new Set()); setLabelFor(null); }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: bulk ? t.warn : t.dim }}>{bulk ? '✓ BULK ON' : '⧉ BULK'}</Text>
        </Pressable>
      </View>
      <TextInput value={q} onChangeText={(v) => { setQ(v); setLabelFor(null); }}
        placeholder="search any NFL player…" placeholderTextColor={t.faint}
        autoCapitalize="none" autoCorrect={false}
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(13), color: t.text, backgroundColor: t.bg, marginTop: 6 }} />
      {bulk && (
        <>
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 }}>
            {['ALL', ...FILTER_POS].map((p) => (
              <FilterChip key={p} label={p} on={fPos === p} tone={t.you} onPress={() => setFPos(p)} />
            ))}
            {TENURES.map((tn) => (
              <FilterChip key={tn.id} label={tn.label} on={fTen === tn.id} tone={t.warn}
                onPress={() => setFTen(fTen === tn.id ? 'ALL' : tn.id)} />
            ))}
          </View>
          <TeamStrip value={fTeam} set={setFTeam} />
          {(matches.length > 0 || selected.size > 0) && (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 7 }}>
              {matches.length > 0 && (
                <Pressable hitSlop={4} onPress={() => { tap(); setSelected(new Set(matches)); }}
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.dim }}>☑ SELECT ALL {matches.length}</Text>
                </Pressable>
              )}
              {selected.size > 0 && (
                <Pressable hitSlop={6} onPress={() => { tap(); setSelected(new Set()); }}>
                  <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.dim }}>clear</Text>
                </Pressable>
              )}
            </View>
          )}
        </>
      )}
      <View>
        {matches.map((slug) => (
          <View key={slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd, flexWrap: 'wrap' }}>
            {face(slug)}
            <Text style={{ fontSize: fs(12), color: t.text, flexShrink: 1 }} numberOfLines={1}>{prettify(slug)}</Text>
            {labelFor !== slug && <View style={{ flex: 1 }} />}
            {bulk
              ? <Pressable hitSlop={6} onPress={() => { tap(); setSelected((cur) => { const n = new Set(cur); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; }); }}>
                  <Text style={{ fontSize: fs(15), color: selected.has(slug) ? t.you : t.faint }}>{selected.has(slug) ? '☑' : '☐'}</Text>
                </Pressable>
              : labelFor === slug
                ? <>{labelInput(slug)}{ruleControls}</>
                : <Pressable onPress={() => { tap(); setLabelFor(slug); setLabelDraft(''); setRulesDraft({}); }}
                    style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4 }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: FLAG_PURPLE }}>⚑ FLAG</Text>
                  </Pressable>}
          </View>
        ))}
      </View>
      {q.trim().length >= 2 && matches.length === 0 && (
        <Mono size={10} tone="faint" style={{ marginTop: 6 }}>No player matches that.</Mono>
      )}
      <View style={{ height: 12 }} />
      </ScrollView>
    </Overlay>
  );
}
