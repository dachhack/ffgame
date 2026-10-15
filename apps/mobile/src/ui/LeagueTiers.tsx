// TIERS INSIDE ONE LEAGUE (0507, v0.728.0) — the commissioner's card and the
// members' table, on the phone. The web's twin is src/screens/LeagueTiersPanel.
// Founder: "Lets also make within season within league relegation."
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { leagueTiers, setLeagueTiers, leagueStandings, friendlyError, type StandingsRow } from '@drip/core/data/liveApi';
import { TIER_PERIODS, TIER_MOVERS, TIERS_INFO, tierZone, periodLabel, lastTierMovesLine, type LeagueTiersState } from '@drip/core/data/leagueTiers';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono, PrimaryButton } from './prims';
import { InfoChip, LabelInfo } from './InfoChip';

/** The commissioner's card: on/off, the tier order, the period and the movers. */
export function TiersCommishCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<LeagueTiersState | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);   // division labels, top tier first
  const [allLabeled, setAllLabeled] = useState(false);
  const [period, setPeriod] = useState(4);
  const [movers, setMovers] = useState(2);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    const [s, rows] = await Promise.all([leagueTiers(leagueId), leagueStandings(leagueId)]);
    setSt(s);
    const rs = Array.isArray(rows) ? (rows as StandingsRow[]) : [];
    const divs = [...new Set(rs.map((r) => r.division).filter((d): d is string => !!d))];
    setAllLabeled(rs.length > 0 && rs.every((r) => !!r.division));
    const order = s.on && s.tiers?.length ? s.tiers.map((x) => x.tier) : divs.sort();
    setLabels(order);
    if (s.on) { setPeriod(s.period ?? 4); setMovers(s.movers ?? 2); }
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
  const move = (i: number, d: -1 | 1) => {
    if (!labels) return;
    const j = i + d; if (j < 0 || j >= labels.length) return;
    const n = [...labels]; [n[i], n[j]] = [n[j], n[i]]; setLabels(n);
  };

  if (!st || !labels) return <Card><Mono size={9.5} tone="faint">{note ?? 'loading…'}</Mono></Card>;
  const ready = allLabeled && labels.length >= 2;
  const save = () => {
    Alert.alert(st.on ? 'Save the tiers?' : 'Turn tiers on?',
      'The schedule is rebuilt from the next week that hasn’t started, inside the tiers. A lineup already saved for those weeks is set again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: st.on ? 'Save' : 'Turn on', onPress: () => void run(() => setLeagueTiers(leagueId, true, period, movers, labels), st.on ? 'tiers saved' : 'tiers on') },
      ]);
  };
  return (
    <Card>
      <LabelInfo label="IN-SEASON TIERS" title="In-season tiers" info={TIERS_INFO} />
      <Mono size={9.5} tone={st.on ? 'you' : 'faint'} style={{ marginTop: 4 }}>{st.on ? `on · ${periodLabel(st)} · ${st.movers} up & down` : 'off'}</Mono>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}

      {!ready ? (
        <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Give every team a division first — at least two.</Mono>
      ) : (
        <>
          <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 10 }}>TIERS, TOP FIRST</Mono>
          <View style={{ marginTop: 4, gap: 3 }}>
            {labels.map((d, i) => (
              <View key={d} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                <Mono size={8.5} tone="faint" weight="700" style={{ width: 46 }}>TIER {i + 1}</Mono>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12.5), color: t.text }}>{d}</Text>
                <Chip label="▲" disabled={i === 0} onPress={() => { tap(); move(i, -1); }} small />
                <Chip label="▼" disabled={i === labels.length - 1} onPress={() => { tap(); move(i, 1); }} small />
              </View>
            ))}
          </View>
          <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 10 }}>WEEKS A PERIOD</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
            {TIER_PERIODS.map((n) => <Chip key={n} label={String(n)} on={period === n} disabled={busy} onPress={() => { tap(); setPeriod(n); }} />)}
          </View>
          <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 10 }}>TEAMS UP &amp; DOWN</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
            {TIER_MOVERS.map((n) => <Chip key={n} label={String(n)} on={movers === n} disabled={busy} onPress={() => { tap(); setMovers(n); }} />)}
          </View>
          <View style={{ marginTop: 14, gap: 8 }}>
            <PrimaryButton label={st.on ? 'SAVE TIERS' : 'TURN TIERS ON'} disabled={busy} onPress={save} />
            {st.on && <Chip label="TURN TIERS OFF" disabled={busy} onPress={() => {
              Alert.alert('Turn tiers off?', 'The rest of the regular season is scheduled across the whole league again, from the next week that hasn’t started.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Turn off', style: 'destructive', onPress: () => void run(() => setLeagueTiers(leagueId, false), 'tiers off') },
              ]);
            }} />}
          </View>
        </>
      )}
    </Card>
  );
}

/** The members' card: each tier's table for this period, with who'd go up
 *  and down if it ended now. Nothing when tiers are off. */
export function TiersCard({ leagueId, myRoster }: { leagueId: string; myRoster?: number | null }) {
  const t = useTheme();
  const [st, setSt] = useState<LeagueTiersState | null>(null);
  useEffect(() => { leagueTiers(leagueId).then(setSt).catch(() => {}); }, [leagueId]);
  if (!st?.on || !st.tiers?.length) return null;
  const mv = st.movers ?? 2;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Mono size={9} tone="faint" track={0.12}>TIERS</Mono>
        <Mono size={9} tone="dim">{`· ${periodLabel(st)} · ${mv} up & down`}</Mono>
        <InfoChip title="In-season tiers">{TIERS_INFO}</InfoChip>
      </View>
      {st.tiers.map((tr, ti) => (
        <View key={tr.tier} style={{ marginTop: 8 }}>
          <Mono size={8.5} weight="700" track={0.12} tone="you">{`TIER ${tr.rank} · ${tr.tier.toUpperCase()}`}</Mono>
          {tr.teams.map((m, i) => {
            const z = tierZone(ti, st.tiers!.length, i, tr.teams.length, mv);
            const mine = myRoster != null && m.roster_id === myRoster;
            return (
              <View key={m.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(10.5), color: t.faint, width: 16 }}>{i + 1}</Text>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12.5), color: mine ? t.you : t.text, fontWeight: mine ? '700' : '400' }}>{m.team}</Text>
                <Text style={{ fontFamily: MONO, fontSize: fs(10.5), color: t.dim }}>{`${m.wins}-${m.losses} · ${m.points.toFixed(1)}`}</Text>
                <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '700', width: 14, textAlign: 'right', color: z === 'up' ? t.you : z === 'down' ? t.opp : t.faint }}>{z === 'up' ? '▲' : z === 'down' ? '▼' : ''}</Text>
              </View>
            );
          })}
        </View>
      ))}
      {!!lastTierMovesLine(st) && <Mono size={9} tone="faint" style={{ marginTop: 6 }}>{lastTierMovesLine(st)}</Mono>}
    </Card>
  );
}
