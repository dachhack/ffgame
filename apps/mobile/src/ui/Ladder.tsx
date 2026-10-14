// RELEGATION (0502): the commissioner's LADDER card and the members' ladder
// card — the web's LadderPanel / LadderCard, on the phone.
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  leagueLadderState, myLadderCandidates, createLeagueLadder, setLadderRules, setLadderTiers,
  deleteLeagueLadder, ladderRollover, friendlyError, type LadderState, type LadderMethod, type LadderRosterMode,
} from '@drip/core/data/liveApi';
import { LADDER_METHODS, LADDER_ROSTER_MODES, LADDER_INFO, ladderMethodLabel, ladderRosterLabel, tierMovesLine, lastMovesLine } from '@drip/core/data/ladder';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono, PrimaryButton } from './prims';
import { Overlay } from './Overlay';
import { InfoChip, LabelInfo } from './InfoChip';

type Cand = { league_id: string; name: string; season: string; teams: number; ladder_id: string | null };

/** The commissioner's LADDER card. */
export function LadderCommishCard({ leagueId, leagueName }: { leagueId: string; leagueName?: string | null }) {
  const t = useTheme();
  const [st, setSt] = useState<LadderState | null>(null);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tiers, setTiers] = useState<string[]>([leagueId]);
  const [method, setMethod] = useState<LadderMethod>('standings');
  const [movers, setMovers] = useState(2);
  const [mode, setMode] = useState<LadderRosterMode>('seat');
  const [editTiers, setEditTiers] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const s = await leagueLadderState(leagueId);
    setSt(s);
    if (s.ladder) {
      setMethod(s.ladder.method); setMovers(s.ladder.movers); setMode(s.ladder.roster_mode);
      setTiers((s.tiers ?? []).map((x) => x.league_id));
    }
    myLadderCandidates().then((c) => setCands(Array.isArray(c) ? c : [])).catch(() => setCands([]));
  };
  useEffect(() => { load().catch((e) => setNote(friendlyError(e))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); setNote(`✓ ${done}`); await load(); } else { warn(); setNote(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  if (!st) return <Card><Mono size={9.5} tone="faint">{note ?? 'loading…'}</Mono></Card>;
  const lad = st.ladder;
  if (!lad && cands && !cands.some((c) => c.league_id === leagueId)) {
    return (
      <Card>
        <LabelInfo label="🪜 LADDER" title="Relegation ladder" info={LADDER_INFO} />
        <Mono size={9.5} tone="faint" style={{ marginTop: 6 }}>season over — ladders live in next season’s league</Mono>
      </Card>
    );
  }
  const list = cands ?? [];
  const season = list.find((c) => c.league_id === leagueId)?.season ?? st.tiers?.find((x) => x.mine)?.season ?? null;
  const nameOf = (id: string) => list.find((c) => c.league_id === id)?.name ?? st.tiers?.find((x) => x.league_id === id)?.name ?? 'a league';
  const addable = list.filter((c) => !tiers.includes(c.league_id) && (!c.ladder_id || c.ladder_id === lad?.id) && (!season || c.season === season));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= tiers.length) return;
    const n = [...tiers]; [n[i], n[j]] = [n[j], n[i]]; setTiers(n);
  };
  const canEdit = !lad || lad.can_edit;
  const pick = (r: { method?: LadderMethod; movers?: number; rosterMode?: LadderRosterMode }) => {
    tap();
    if (r.method) setMethod(r.method); if (r.movers) setMovers(r.movers); if (r.rosterMode) setMode(r.rosterMode);
    if (lad) void run(() => setLadderRules(lad.id, r), 'saved');
  };

  const tierEditor = (
    <View style={{ marginTop: 6, gap: 3 }}>
      {tiers.map((id, i) => (
        <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
          <Mono size={8.5} tone="faint" weight="700" style={{ width: 46 }}>TIER {i + 1}</Mono>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12.5), color: t.text }}>{nameOf(id)}</Text>
          <Chip label="▲" disabled={i === 0} onPress={() => { tap(); move(i, -1); }} small />
          <Chip label="▼" disabled={i === tiers.length - 1} onPress={() => { tap(); move(i, 1); }} small />
          {id !== leagueId && <Chip label="✕" onPress={() => { tap(); setTiers(tiers.filter((x) => x !== id)); }} small />}
        </View>
      ))}
      {addable.length > 0 && <Chip label="+ ADD A LEAGUE" onPress={() => { tap(); setAdding(true); }} />}
    </View>
  );

  return (
    <Card>
      <LabelInfo label="🪜 LADDER" title="Relegation ladder" info={LADDER_INFO} />
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}

      {!lad ? (
        <>
          <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 10 }}>NAME</Mono>
          <TextInput value={name} maxLength={60} onChangeText={setName} placeholder={`${leagueName ?? 'League'} Ladder`} placeholderTextColor={t.faint}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(12.5), color: t.text, backgroundColor: t.bg, marginTop: 4 }} />
          <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 10 }}>TIERS</Mono>
          {tierEditor}
        </>
      ) : (
        <>
          <Text style={{ fontSize: fs(15), fontWeight: '700', color: t.text, marginTop: 8 }}>{lad.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <Mono size={8.5} tone="faint" track={0.1}>TIERS</Mono>
            {canEdit && <Chip label={editTiers ? 'CLOSE' : 'EDIT'} on={editTiers} onPress={() => { tap(); setEditTiers(!editTiers); }} small />}
          </View>
          {editTiers ? (
            <>
              {tierEditor}
              <View style={{ marginTop: 6 }}>
                <PrimaryButton label="SAVE TIERS" disabled={busy} onPress={() => void run(() => setLadderTiers(lad.id, tiers), 'tiers saved').then(() => setEditTiers(false))} />
              </View>
            </>
          ) : (st.tiers ?? []).map((x) => (
            <View key={x.league_id} style={{ paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Mono size={8.5} tone="faint" weight="700" style={{ width: 46 }}>TIER {x.tier}</Mono>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12.5), color: x.mine ? t.you : t.text, fontWeight: x.mine ? '700' : '400' }}>{x.name}</Text>
              </View>
              {!!tierMovesLine(x) && <Mono size={9} tone="dim" style={{ marginLeft: 52, marginTop: 1 }}>{tierMovesLine(x)}</Mono>}
            </View>
          ))}
        </>
      )}

      <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 12 }}>METHOD</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
        {LADDER_METHODS.map((m) => <Chip key={m.id} label={m.label} on={method === m.id} disabled={!canEdit || busy} onPress={() => pick({ method: m.id })} />)}
      </View>
      <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 10 }}>TEAMS UP &amp; DOWN</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
        {[1, 2, 3, 4, 5, 6].map((n) => <Chip key={n} label={String(n)} on={movers === n} disabled={!canEdit || busy} onPress={() => pick({ movers: n })} />)}
      </View>
      <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 10 }}>ROSTERS</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
        {LADDER_ROSTER_MODES.map((m) => <Chip key={m.id} label={m.label} on={mode === m.id} disabled={!canEdit || busy} onPress={() => pick({ rosterMode: m.id })} />)}
      </View>

      {!lad ? (
        <View style={{ marginTop: 14 }}>
          <PrimaryButton label="BUILD THE LADDER" disabled={busy || tiers.length < 2}
            onPress={() => void run(() => createLeagueLadder(name.trim() || `${leagueName ?? 'League'} Ladder`, tiers, method, movers, mode), 'ladder built')} />
        </View>
      ) : (
        <>
          {!!lastMovesLine(st) && <Mono size={9} tone="faint" style={{ marginTop: 10 }}>{lastMovesLine(st)}</Mono>}
          {canEdit && (
            <View style={{ marginTop: 14, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton label="⤴ ROLL THE LADDER OVER" disabled={busy} onPress={() => {
                    Alert.alert(`Roll the ${lad.name} ladder over?`,
                      `Every tier rolls into next season together, then ${lad.movers} team${lad.movers === 1 ? '' : 's'} per tier move up and down by ${ladderMethodLabel(lad.method)} (${ladderRosterLabel(lad.roster_mode)}). If any tier can’t roll yet, nothing changes.`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Roll it over', onPress: () => void run(async () => { const r = await ladderRollover(lad.id); return r.ok ? { ok: true } : r; }, 'the ladder rolled into next season') },
                      ]);
                  }} />
                </View>
                <InfoChip title="Rolling the ladder over">
                  Opens after the season ends. Every tier moves to next season at once — the same as NEXT SEASON for each league — and then the movers swap places. A league in a ladder can only roll over from here.
                </InfoChip>
              </View>
              <Pressable disabled={busy} onPress={() => {
                Alert.alert(`Take down the ${lad.name} ladder?`, 'The leagues stay as they are; they just stop being linked.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Take it down', style: 'destructive', onPress: () => void run(() => deleteLeagueLadder(lad.id), 'ladder taken down') },
                ]);
              }}>
                <Mono size={9.5} tone="opp" weight="700">✕ TAKE DOWN THE LADDER</Mono>
              </Pressable>
            </View>
          )}
        </>
      )}

      <Overlay visible={adding} title="Add a tier" onClose={() => setAdding(false)}>
        {addable.map((c) => (
          <Pressable key={c.league_id} onPress={() => { tap(); setTiers([...tiers, c.league_id]); setAdding(false); }}
            style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(12.5), fontWeight: '700', color: t.you }}>{c.name}</Text>
            <Mono size={9} tone="faint">{c.teams} teams · {c.season}</Mono>
          </Pressable>
        ))}
      </Overlay>
    </Card>
  );
}

/** The members' card: which tier this is, who's moving if it ended now.
 *  Renders nothing for a league outside any ladder. */
export function LadderCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<LadderState | null>(null);
  useEffect(() => { leagueLadderState(leagueId).then(setSt).catch(() => {}); }, [leagueId]);
  const lad = st?.ladder;
  if (!lad || !st?.tiers) return null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Mono size={9} tone="faint" track={0.12}>🪜 {lad.name.toUpperCase()}</Mono>
        <Mono size={9} tone="dim">· tier {st.tier} of {st.tiers.length}</Mono>
        <InfoChip title={lad.name}>{`${ladderMethodLabel(lad.method)} · ${lad.movers} up & down · ${ladderRosterLabel(lad.roster_mode)}\n\n${LADDER_INFO}`}</InfoChip>
      </View>
      {st.tiers.map((x) => (
        <View key={x.league_id} style={{ paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Mono size={8.5} tone="faint" weight="700" style={{ width: 46 }}>TIER {x.tier}</Mono>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12), color: x.mine ? t.you : t.text, fontWeight: x.mine ? '700' : '400' }}>{x.name}</Text>
          </View>
          {!!tierMovesLine(x) && <Mono size={9} tone="dim" style={{ marginLeft: 52, marginTop: 1 }}>{tierMovesLine(x)}</Mono>}
        </View>
      ))}
      {!!lastMovesLine(st) && <Mono size={9} tone="faint" style={{ marginTop: 4 }}>{lastMovesLine(st)}</Mono>}
    </Card>
  );
}
