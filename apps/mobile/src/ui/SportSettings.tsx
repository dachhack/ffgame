// A SPORT LEAGUE'S SCORING, on the phone (v0.628.0) — the web SportSettings'
// twin, in place of the football catalog: the format (points, categories,
// roto) and the categories while the season has not started; the points per
// stat any time. One SAVE for the points; the format and each category save
// on tap. The worker rescores every live matchup on its next pass.
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SPORTS, type Sport } from '@drip/core/sports/index';
import { normalizeScoring } from '@drip/core/sports/score';
import { sportSettingsOf, SPORT_FORMATS, SPORT_FORMAT_LABEL, type SportLeagueSettings, type SportFormat } from '@drip/core/sports/league';
import { setSportSettings, friendlyError } from '@drip/core/data/liveApi';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Chip, Mono } from './prims';
import { LabelInfo } from './InfoChip';

export function SportSettings({ leagueId, sport, initial, locked }: {
  leagueId: string; sport: Sport; initial: Record<string, unknown> | null | undefined;
  /** The season is under way: format and categories are frozen. */
  locked: boolean;
}) {
  const t = useTheme();
  const def = SPORTS[sport];
  const [settings, setSettings] = useState<SportLeagueSettings | null>(() => sportSettingsOf({ sport: initial }));
  const [format, setFormat] = useState<SportFormat>(settings?.format ?? 'points');
  const [cats, setCats] = useState<Set<string>>(() => new Set(settings?.categories ?? def.categoriesDefault));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [group, setGroup] = useState<string>(Object.keys(def.groups)[0] ?? 'all');

  useEffect(() => {
    const s = sportSettingsOf({ sport: initial });
    setSettings(s);
    setFormat(s?.format ?? 'points');
    setCats(new Set(s?.categories ?? def.categoriesDefault));
    const sc = normalizeScoring(def, s?.scoring);
    const d: Record<string, string> = {};
    for (const st of def.stats) d[st.id] = String(sc[st.id] ?? 0);
    setDraft(d);
  }, [initial, def]);

  const scoringNow = useMemo(() => normalizeScoring(def, settings?.scoring), [def, settings?.scoring]);
  const stats = def.stats.filter((s) => s.group === group || s.group === 'all');
  const changed = (id: string) => Number(draft[id]) !== (def.scoringDefault[id] ?? 0);
  const dirty = def.stats.some((s) => Number(draft[s.id]) !== (scoringNow[s.id] ?? 0));

  const saveScoring = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const over: Record<string, number> = {};
      for (const s of def.stats) {
        const v = Number(draft[s.id]);
        if (Number.isFinite(v) && v !== (def.scoringDefault[s.id] ?? 0)) over[s.id] = v;
      }
      const r = await setSportSettings(leagueId, { scoring: over });
      if (r.ok) { commit(); setSettings(sportSettingsOf({ sport: r.sport })); setNote(`✓ scoring saved — ${Object.keys(over).length} value${Object.keys(over).length === 1 ? '' : 's'} off the ${def.league} default`); }
      else { warn(); setNote(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const resetScoring = () => {
    const d: Record<string, string> = {};
    for (const st of def.stats) d[st.id] = String(def.scoringDefault[st.id] ?? 0);
    setDraft(d);
  };
  const saveFormat = async (f: SportFormat, c: Set<string>) => {
    if (busy || locked) return;
    setBusy(true); setNote(null);
    try {
      const r = await setSportSettings(leagueId, { format: f, categories: [...c] });
      if (r.ok) {
        commit(); setSettings(sportSettingsOf({ sport: r.sport })); setFormat(f); setCats(c);
        setNote(f === 'points' ? '✓ points — weekly totals head-to-head' : f === 'cats' ? `✓ categories — ${c.size} compared each week` : f === 'season' ? '✓ season points — one total all season, no weekly winner' : `✓ roto — ${c.size} categories ranked all season`);
      } else { warn(); setNote(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const toggleCat = (id: string) => {
    const next = new Set(cats);
    if (next.has(id)) next.delete(id); else next.add(id);
    void saveFormat(format, next);
  };

  const box = { borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 10 } as const;
  return (
    <View style={{ gap: 10 }}>
      <View style={box}>
        <LabelInfo label={`${def.league} FORMAT${locked ? ' · LOCKED' : ''}`}
          info={'POINTS — each week is the sum of every locked starter\'s points, head-to-head.\n\nH2H CATEGORIES — each week is won category by category from both sides\' summed lines; ratios (FG%, ERA…) are made from the totals.\n\nROTO — no weekly winner: every game all season sums into one line per team, each category ranks the league, best of N takes N points.\n\nSEASON POINTS — no weekly winner: every locked slot-day all season adds to one points total per team; the standings are that total. Pairs with 🎯 best-ball spots on the LINEUP page.\n\nThe format and the categories lock once the season is under way; points per stat change any time.'} />
        <View style={{ flexDirection: 'row', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
          {SPORT_FORMATS.map((f) => (
            <Chip key={f} label={SPORT_FORMAT_LABEL[f]} on={format === f} disabled={busy || locked}
              onPress={() => { tap(); void saveFormat(f, cats); }} />
          ))}
        </View>
        {format !== 'points' && format !== 'season' && (
          <View style={{ marginTop: 8 }}>
            <Mono size={8.5} tone="faint" weight="700" track={0.1}>CATEGORIES · {cats.size} ON</Mono>
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
              {def.categories.map((c) => (
                <Chip key={c.id} label={`${c.short}${c.lowerBetter ? ' ↓' : ''}`} on={cats.has(c.id)} disabled={busy || locked} onPress={() => { tap(); toggleCat(c.id); }} />
              ))}
            </View>
          </View>
        )}
      </View>

      <View style={box}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Mono size={8.5} tone="faint" weight="700" track={0.1}>POINTS PER STAT</Mono>
          <View style={{ marginLeft: 'auto', flexDirection: 'row', gap: 6 }}>
            <Chip label={`${def.league} DEFAULT`} on={false} disabled={busy} onPress={() => { tap(); resetScoring(); }} />
            <Chip label={busy ? 'SAVING…' : 'SAVE'} on={dirty} disabled={busy || !dirty} onPress={() => void saveScoring()} />
          </View>
        </View>
        {Object.keys(def.groups).length > 1 && (
          <View style={{ flexDirection: 'row', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            {Object.keys(def.groups).map((g) => (
              <Chip key={g} label={`${g.toUpperCase()}S`} on={group === g} onPress={() => { tap(); setGroup(g); }} />
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {stats.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: '47%' }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: MONO, fontSize: fs(9.5), color: changed(s.id) ? t.you : t.dim }}>{s.short}{s.derived ? ' *' : ''}</Text>
              <TextInput value={draft[s.id] ?? '0'} keyboardType="numbers-and-punctuation" onChangeText={(v) => setDraft({ ...draft, [s.id]: v })}
                style={{ width: 58, fontFamily: MONO, fontSize: fs(11), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: changed(s.id) ? t.you : t.bd, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 4, textAlign: 'right' }} />
            </View>
          ))}
        </View>
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(12) }}>
          * derived per game (a double-double, a quality start, innings from outs). Points apply from the next scoring pass, including the week in progress. Changed values light up.
        </Mono>
      </View>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'}>{note}</Mono>}
    </View>
  );
}
