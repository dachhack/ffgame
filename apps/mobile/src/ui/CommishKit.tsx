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
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  leagueNote, setLeagueNote, playerFlags, setPlayerFlag, leagueScoringGet, leagueScoringSet,
  friendlyError, type PlayerFlagRow, type FlagRulesRaw,
} from '@drip/core/data/liveApi';
import {
  SCORING_BOUNDS, DEFAULT_SCORING, setLeagueScoring, parseScoring, scoringIsDefault, scoringLabel,
  type LeagueScoring,
} from '@drip/core/engine/leagueScoring';
import { setLeagueFlags } from '@drip/core/data/commish';
import { PLAYER_BIO } from '@drip/core/data/playerBio';
import { headshot } from '@drip/core/data/media';
import { useTheme, alpha, MONO } from '../theme.native';
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

const prettify = (slug: string) =>
  slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

export function CommishKit({ leagueId, onChanged }: {
  leagueId: string;
  /** Called whenever flags land in the module cache — bump a version counter
   *  so the board's flag chips re-render. */
  onChanged: () => void;
}) {
  const t = useTheme();
  const [note, setNote] = useState<{ text: string | null; canEdit: boolean } | null>(null);
  const [scoring, setScoring] = useState<LeagueScoring | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);

  const load = async () => {
    const [n, f, sc] = await Promise.all([
      leagueNote(leagueId).catch(() => null),
      playerFlags(leagueId).catch(() => null),
      leagueScoringGet(leagueId).catch(() => null),
    ]);
    if (n && n.ok) setNote({ text: n.text ?? null, canEdit: !!n.can_edit });
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

  const scoringOn = scoring != null && !scoringIsDefault(scoring);
  if (!note || (!note.text && !note.canEdit && !scoringOn)) return null;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', backgroundColor: alpha(FLAG_PURPLE, 10), borderWidth: StyleSheet.hairlineWidth, borderColor: FLAG_PURPLE, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, marginBottom: 10 }}>
        <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: FLAG_PURPLE, paddingTop: 1 }}>⚑ LEAGUE NOTE</Text>
        {note.text
          ? <Text style={{ flexBasis: 180, flexGrow: 1, fontSize: 11.5, lineHeight: 16, color: t.text }}>{note.text}</Text>
          : <Mono size={9.5} tone="faint" style={{ flexBasis: 180, flexGrow: 1 }}>nothing posted — say something to the league</Mono>}
        {scoringOn && (
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.warn }}>⚖ {scoringLabel(scoring)}</Text>
          </View>
        )}
        {note.canEdit && (
          <View style={{ flexDirection: 'row', gap: 10, marginLeft: 'auto' }}>
            <Pressable hitSlop={6} onPress={() => { tap(); setNoteOpen(true); }}>
              <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>✎ {note.text ? 'edit' : 'write'}</Text>
            </Pressable>
            <Pressable hitSlop={6} onPress={() => { tap(); setFlagsOpen(true); }}>
              <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>⚑ flags</Text>
            </Pressable>
            <Pressable hitSlop={6} onPress={() => { tap(); setScoringOpen(true); }}>
              <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>⚖ scoring</Text>
            </Pressable>
          </View>
        )}
      </View>
      <NoteEditor visible={noteOpen} leagueId={leagueId} initial={note.text ?? ''}
        onDone={() => { setNoteOpen(false); void load(); }}
        onClose={() => setNoteOpen(false)} />
      <FlagsEditor visible={flagsOpen} leagueId={leagueId}
        onChanged={() => void load()}
        onClose={() => setFlagsOpen(false)} />
      {scoring && (
        <ScoringEditor visible={scoringOpen} leagueId={leagueId} initial={scoring}
          onDone={() => { setScoringOpen(false); void load(); }}
          onClose={() => setScoringOpen(false)} />
      )}
    </>
  );
}

function ScoringEditor({ visible, leagueId, initial, onDone, onClose }: {
  visible: boolean; leagueId: string; initial: LeagueScoring; onDone: () => void; onClose: () => void;
}) {
  const t = useTheme();
  const [td, setTd] = useState(initial.tdBonus);
  const [yd, setYd] = useState(initial.ydMult);
  const [to, setTo] = useState(initial.toPenalty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setTd(initial.tdBonus); setYd(initial.ydMult); setTo(initial.toPenalty); setErr(null); } }, [visible, initial]);
  const save = async (tdV: number, ydV: number, toV: number) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await leagueScoringSet(leagueId, tdV, Math.round(ydV * 10) / 10, toV);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not save.')); return; }
      commit(); onDone();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const stepper = (label: string, hint: string, v: number, set: (n: number) => void,
    b: { min: number; max: number; step: number }, fmt: (n: number) => string) => (
    <View style={{ marginTop: 12 }}>
      <Mono size={9} tone="faint" track={0.12}>{label}</Mono>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <Pressable onPress={() => { tap(); set(Math.round(Math.max(b.min, v - b.step) * 10) / 10); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 13, paddingVertical: 6 }}>
          <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', color: t.text }}>−</Text>
        </Pressable>
        <Text style={{ fontFamily: MONO, fontSize: 16, fontWeight: '700', color: t.text, minWidth: 48, textAlign: 'center' }}>{fmt(v)}</Text>
        <Pressable onPress={() => { tap(); set(Math.round(Math.min(b.max, v + b.step) * 10) / 10); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 13, paddingVertical: 6 }}>
          <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', color: t.text }}>＋</Text>
        </Pressable>
        <Mono size={8.5} tone="faint" style={{ flex: 1, lineHeight: 12 }}>{hint}</Mono>
      </View>
    </View>
  );
  return (
    <Overlay visible={visible} title="⚖ League scoring"
      subtitle="Adjustments layer on the base game and apply to every matchup. Every member sees them." onClose={onClose}>
      {stepper('TD BONUS', 'extra points on every TD your players score', td, setTd, SCORING_BOUNDS.tdBonus, (n) => `${n > 0 ? '+' : ''}${n}`)}
      {stepper('YARDAGE MULTIPLIER', 'scales per-yard scoring and drip growth', yd, setYd, SCORING_BOUNDS.ydMult, (n) => `×${n}`)}
      {stepper('TURNOVER PENALTY', 'points off a player’s own bank per giveaway', to, setTo, SCORING_BOUNDS.toPenalty, (n) => (n === 0 ? 'off' : `−${n}`))}
      {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 8 }}>{err}</Mono>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton label={busy ? '…' : 'SAVE'} disabled={busy} onPress={() => void save(td, yd, to)} />
        </View>
        <Pressable disabled={busy} onPress={() => { tap(); void save(DEFAULT_SCORING.tdBonus, DEFAULT_SCORING.ydMult, DEFAULT_SCORING.toPenalty); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>RESET</Text>
        </Pressable>
      </View>
    </Overlay>
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
        style={{ minHeight: 84, textAlignVertical: 'top', borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, lineHeight: 18, color: t.text, backgroundColor: t.bg }} />
      {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 6 }}>{err}</Mono>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton label={busy ? '…' : 'SAVE NOTE'} disabled={busy || !draft.trim()} onPress={() => void save(draft)} />
        </View>
        {!!initial && (
          <Pressable disabled={busy} onPress={() => { tap(); void save(null); }}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 13, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.opp }}>CLEAR</Text>
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

  const load = () => playerFlags(leagueId).then((r) => { if (Array.isArray(r)) setRows(r); }).catch(() => {});
  useEffect(() => { if (visible) { void load(); setQ(''); setLabelFor(null); setErr(null); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [visible, leagueId]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return Object.keys(PLAYER_BIO).filter((s) => s.replace(/-/g, ' ').includes(needle)).slice(0, 12);
  }, [q]);

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

  const face = (slug: string) => {
    const src = headshot(slug);
    return (
      <View style={{ width: 22, height: 22, borderRadius: 11, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center' }}>
        {src ? <Image source={{ uri: src }} style={{ width: 22, height: 22 }} resizeMode="cover" />
          : <Text style={{ fontFamily: MONO, fontSize: 8, color: t.faint }}>?</Text>}
      </View>
    );
  };
  const mini = (v: number, dflt: number, min: number, max: number, step: number, key: 'bonus_mult' | 'bonus_pts', fmt: (n: number) => string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Pressable hitSlop={4} onPress={() => { tap(); setRulesDraft({ ...rulesDraft, [key]: Math.round(Math.max(min, v - step) * 10) / 10 }); }}>
        <Text style={{ fontFamily: MONO, fontSize: 12, color: t.dim, paddingHorizontal: 4 }}>−</Text>
      </Pressable>
      <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', minWidth: 26, textAlign: 'center', color: v !== dflt ? t.warn : t.dim }}>{fmt(v)}</Text>
      <Pressable hitSlop={4} onPress={() => { tap(); setRulesDraft({ ...rulesDraft, [key]: Math.round(Math.min(max, v + step) * 10) / 10 }); }}>
        <Text style={{ fontFamily: MONO, fontSize: 12, color: t.dim, paddingHorizontal: 4 }}>＋</Text>
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
            <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: on ? t.onAccent : t.dim }}>{d.label}</Text>
          </Pressable>
        );
      })}
      <Mono size={8} tone="faint">×</Mono>
      {mini(rulesDraft.bonus_mult ?? 1, 1, 0.5, 3, 0.1, 'bonus_mult', (n) => `×${n}`)}
      <Mono size={8} tone="faint">±</Mono>
      {mini(rulesDraft.bonus_pts ?? 0, 0, -10, 10, 1, 'bonus_pts', (n) => `${n > 0 ? '+' : ''}${n}`)}
    </View>
  );
  const labelInput = (slug: string) => (
    <View style={{ flexDirection: 'row', gap: 6, flex: 1 }}>
      <TextInput value={labelDraft} autoFocus maxLength={40} onChangeText={setLabelDraft}
        placeholder="keeper · out for season…" placeholderTextColor={t.faint}
        style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11.5, color: t.text, backgroundColor: t.bg }} />
      <Pressable disabled={busy || !labelDraft.trim()} onPress={() => { tap(); labelDraft.trim() && void save(slug, labelDraft); }}
        style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 10, justifyContent: 'center', opacity: busy || !labelDraft.trim() ? 0.5 : 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.onAccent }}>SET</Text>
      </Pressable>
    </View>
  );

  return (
    <Overlay visible={visible} title="⚑ Player flags"
      subtitle="A short label the whole league sees wherever the player appears." onClose={onClose}>
      {!!err && <Mono size={9.5} tone="opp" style={{ marginBottom: 6 }}>{err}</Mono>}
      <Mono size={9} tone="faint" track={0.12}>CURRENT FLAGS</Mono>
      {rows == null && <Mono size={10} tone="faint" style={{ marginTop: 6 }}>Loading…</Mono>}
      {rows?.length === 0 && <Mono size={10} tone="faint" style={{ marginTop: 6 }}>None yet.</Mono>}
      {rows?.map((f) => (
        <View key={f.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd, flexWrap: 'wrap' }}>
          {face(f.slug)}
          <Text style={{ fontSize: 12, color: t.text }}>{prettify(f.slug)}</Text>
          {labelFor === f.slug
            ? <>{labelInput(f.slug)}{ruleControls}</>
            : <>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: FLAG_PURPLE }}>⚑ {f.label}{ruleGlyphs(f.rules) ? ` · ${ruleGlyphs(f.rules)}` : ''}</Text>
                <Pressable hitSlop={6} onPress={() => { tap(); setLabelFor(f.slug); setLabelDraft(f.label); setRulesDraft(f.rules ?? {}); }}>
                  <Text style={{ fontSize: 12, color: t.dim }}>✎</Text>
                </Pressable>
                <Pressable hitSlop={6} disabled={busy} onPress={() => { tap(); void save(f.slug, null); }}>
                  <Text style={{ fontSize: 12, color: t.opp }}>✕</Text>
                </Pressable>
              </>}
        </View>
      ))}

      <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>FLAG A PLAYER</Mono>
      <TextInput value={q} onChangeText={(v) => { setQ(v); setLabelFor(null); }}
        placeholder="search any NFL player…" placeholderTextColor={t.faint}
        autoCapitalize="none" autoCorrect={false}
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg, marginTop: 6 }} />
      <ScrollView style={{ maxHeight: 260, flexGrow: 0 }} nestedScrollEnabled>
        {matches.map((slug) => (
          <View key={slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd, flexWrap: 'wrap' }}>
            {face(slug)}
            <Text style={{ fontSize: 12, color: t.text, flexShrink: 1 }} numberOfLines={1}>{prettify(slug)}</Text>
            {labelFor !== slug && <View style={{ flex: 1 }} />}
            {labelFor === slug
              ? <>{labelInput(slug)}{ruleControls}</>
              : <Pressable onPress={() => { tap(); setLabelFor(slug); setLabelDraft(''); setRulesDraft({}); }}
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: FLAG_PURPLE }}>⚑ FLAG</Text>
                </Pressable>}
          </View>
        ))}
      </ScrollView>
      {q.trim().length >= 2 && matches.length === 0 && (
        <Mono size={10} tone="faint" style={{ marginTop: 6 }}>No player matches that.</Mono>
      )}
    </Overlay>
  );
}
