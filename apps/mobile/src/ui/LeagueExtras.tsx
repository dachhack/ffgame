// League-wide panels for the team screen: standings, the playoff bracket, and
// the commissioner's player-move tools. Split out of Team.tsx so that file
// stays about the caller's own roster.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  advancePlayoffs, autoGeneratePlayoffs, commishMovePlayer, commishRemovePlayer, friendlyError, generatePlayoffs, leaguePool,
  leagueStandings, nativeRosters, playoffState, setPlayoffRules,
  type LeaguePoolPlayer, type PlayoffState, type StandingsRow,
} from '@drip/core/data/liveApi';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono, PosPill, PrimaryButton } from './prims';
import { Overlay } from './Overlay';

// ── Standings: wins, points, differential ────────────────────────────────────
type StandSort = 'record' | 'pf' | 'diff';

export function Standings({ leagueId, myRoster }: { leagueId: string; myRoster: number | null }) {
  const t = useTheme();
  const [rows, setRows] = useState<StandingsRow[] | null>(null);
  const [sort, setSort] = useState<StandSort>('record');

  useEffect(() => {
    leagueStandings(leagueId).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, [leagueId]);

  const sorted = useMemo(() => {
    const rs = [...(rows ?? [])];
    const diff = (r: StandingsRow) => r.pf - r.pa;
    if (sort === 'pf') rs.sort((a, b) => b.pf - a.pf || b.wins - a.wins);
    else if (sort === 'diff') rs.sort((a, b) => diff(b) - diff(a) || b.wins - a.wins);
    // 'record' keeps the server's order: wins desc, PF desc — the seeding order.
    return rs;
  }, [rows, sort]);

  if (rows === null) return <Card><ActivityIndicator color={t.you} /></Card>;
  if (rows.length === 0) return null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Mono size={9} tone="faint" track={0.12}>STANDINGS</Mono>
        <View style={{ flex: 1 }} />
        {(([['record', 'RECORD'], ['pf', 'POINTS'], ['diff', '± DIFF']] as const)).map(([id, label]) => (
          <Chip key={id} label={label} on={sort === id} onPress={() => { tap(); setSort(id); }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, paddingBottom: 3 }}>
        <Mono size={7.5} tone="faint" track={0.1} style={{ width: 18 }}>#</Mono>
        <Mono size={7.5} tone="faint" track={0.1} style={{ flex: 1 }}>TEAM</Mono>
        <Mono size={7.5} tone="faint" track={0.1} style={{ width: 44, textAlign: 'right' }}>W-L</Mono>
        <Mono size={7.5} tone="faint" track={0.1} style={{ width: 48, textAlign: 'right' }}>PF</Mono>
        <Mono size={7.5} tone="faint" track={0.1} style={{ width: 48, textAlign: 'right' }}>DIFF</Mono>
      </View>
      {sorted.map((r, i) => {
        const d = Math.round((r.pf - r.pa) * 10) / 10;
        const me = r.roster_id === myRoster;
        return (
          <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
            <Mono size={9} tone="faint" style={{ width: 18 }}>{i + 1}</Mono>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12), color: me ? t.you : t.text, fontWeight: me ? '700' : '400' }}>
              {r.team ?? `Roster ${r.roster_id}`}
            </Text>
            <Mono size={9.5} weight="700" style={{ width: 44, textAlign: 'right' }}>
              {r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}
            </Mono>
            <Mono size={9.5} style={{ width: 48, textAlign: 'right' }}>{Math.round(r.pf * 10) / 10}</Mono>
            <Mono size={9.5} tone={d > 0 ? 'you' : d < 0 ? 'opp' : 'dim'} style={{ width: 48, textAlign: 'right' }}>
              {d > 0 ? '+' : ''}{d}
            </Mono>
          </View>
        );
      })}
    </Card>
  );
}

// ── Playoff controls — lives in the ⚑ League settings sheet ──────────────────
// Split from the bracket card below: editing is a settings decision, the
// bracket is a scoreboard. Both read the same playoff_state.
export function PlayoffControls({ leagueId, onChanged }: { leagueId: string; onChanged: () => void }) {
  const [st, setSt] = useState<PlayoffState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () => playoffState(leagueId).then(setSt).catch(() => {});
  useEffect(() => {
    void load();
    // The season closes itself (0162): once the last regular-season game is
    // final, any member's visit here builds round 1 — the advance poke's twin.
    autoGeneratePlayoffs(leagueId).then((r) => { if (r.ok && r.generated !== false) void load(); }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); setNote(`✓ ${done}`); } else { warn(); setNote(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); void load(); onChanged(); }
  };
  if (!st || st.error) return null;
  return (
    <View>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}
      {st.underway ? (
        <Mono size={9} tone="faint" style={{ marginTop: 6 }}>The bracket is underway — size and start week are locked.</Mono>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">BRACKET</Mono>
            {[2, 4, 6, 8].map((n) => (
              <Chip key={n} label={`${n} TEAMS`} on={st.playoff_teams === n}
                onPress={() => { tap(); void run(() => setPlayoffRules(leagueId, n, null), `bracket of ${n}`); }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">STARTS WK</Mono>
            {[15, 16, 17].map((w) => (
              <Chip key={w} label={String(w)} on={st.playoff_start_week === w}
                onPress={() => { tap(); void run(() => setPlayoffRules(leagueId, null, w), `playoffs start week ${w}`); }} />
            ))}
          </View>
          <View style={{ marginTop: 8 }}>
            <PrimaryButton label={busy ? '…' : st.generated ? '↻ REGENERATE ROUND 1 (reseeds from standings)' : '⚡ GENERATE THE BRACKET'}
              disabled={busy} onPress={() => {
                tap();
                if (st.generated) {
                  Alert.alert('Regenerate round 1?', 'Reseeds from the current standings — any manual bracket state from the old round 1 is replaced.', [
                    { text: 'cancel', style: 'cancel' },
                    { text: 'regenerate', style: 'destructive', onPress: () => void run(() => generatePlayoffs(leagueId), 'round 1 rebuilt') },
                  ]);
                } else void run(() => generatePlayoffs(leagueId), 'bracket generated');
              }} />
          </View>
        </>
      )}
      {st.generated && st.champion == null && (
        <View style={{ marginTop: 8 }}>
          <PrimaryButton label={busy ? '…' : '⏭ ADVANCE (build the next round from finals)'} disabled={busy}
            onPress={() => { tap(); void run(() => advancePlayoffs(leagueId), 'advanced'); }} />
        </View>
      )}
      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
        Seeding comes from the standings (wins, then points-for). The bracket itself shows on the MY TEAM screen for everyone.
      </Mono>
    </View>
  );
}

// ── Playoffs: the bracket (view only — the levers live in ⚑ League settings) ──
export function Playoffs({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<PlayoffState | null>(null);

  useEffect(() => {
    playoffState(leagueId).then(setSt).catch(() => {});
  }, [leagueId]);

  if (!st || st.error) return null;
  const teamOf = (rid: number) => st.standings.find((s) => s.roster_id === rid)?.team ?? `Roster ${rid}`;
  const seedOf = (rid: number) => {
    const i = (st.seeds ?? []).indexOf(rid);
    return i >= 0 ? `#${i + 1} ` : '';
  };

  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>🏆 PLAYOFFS</Mono>

      {st.champion != null && (
        <Mono size={11} tone="you" weight="700" style={{ marginTop: 6 }}>
          👑 {st.champion_team ?? teamOf(st.champion)} — league champion
        </Mono>
      )}

      {/* the bracket, round by round */}
      {st.matchups.length === 0 && (
        <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>
          No bracket yet — the commissioner generates it from ⚑ League settings when the regular season wraps.
        </Mono>
      )}
      {Array.from(new Set(st.matchups.map((m) => m.round))).sort((a, b) => a - b).map((round) => (
        <View key={round} style={{ marginTop: 8 }}>
          <Mono size={8.5} tone="faint" track={0.1}>ROUND {round}</Mono>
          {st.matchups.filter((m) => m.round === round).map((m) => (
            <View key={m.id} style={{ paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11.5), color: t.text }}>
                  {seedOf(m.home)}{teamOf(m.home)} vs {seedOf(m.away)}{teamOf(m.away)}
                </Text>
                {m.home_final != null && m.away_final != null
                  ? <Mono size={9.5} weight="700">{m.home_final}–{m.away_final}</Mono>
                  : <Mono size={8} tone={m.status === 'live' ? 'you' : 'faint'} track={0.06}>{m.status.toUpperCase()}</Mono>}
              </View>
              {(m.label || m.consolation) && (
                <Mono size={8} tone="faint" style={{ marginTop: 1 }}>{m.consolation ? 'consolation' : m.label}</Mono>
              )}
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}

// ── Commissioner player moves: any player, any roster, waivers, FA ───────────
export function CommishPlayers({ leagueId, onChanged }: { leagueId: string; onChanged: () => void }) {
  const t = useTheme();
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [rosters, setRosters] = useState<{ roster_id: number; slug: string }[]>([]);
  const [teams, setTeams] = useState<Map<number, string>>(new Map());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<LeaguePoolPlayer | null>(null);
  /** 'all' = everyone rostered · 'fa' = the waiver wire · a roster id = one team. */
  const [view, setView] = useState<'all' | 'fa' | number>('all');

  const load = async () => {
    const [p, r, s] = await Promise.all([
      leaguePool(leagueId), nativeRosters(leagueId),
      leagueStandings(leagueId).then((x) => (Array.isArray(x) ? x : [])).catch(() => [] as StandingsRow[]),
    ]);
    setPool(p); setRosters(r);
    setTeams(new Map(s.map((row) => [row.roster_id, row.team ?? `Roster ${row.roster_id}`])));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const bySlug = useMemo(() => new Map(rosters.map((r) => [r.slug, r.roster_id])), [rosters]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); setNote(`✓ ${done}`); } else { warn(); setNote(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); await load(); onChanged(); }
  };

  // VIEW SELECTOR (v0.225.0, the web's v0.215.0 ported). A single flat list of
  // every rostered player meant answering "what does this manager actually
  // have" by reading a league-wide list and matching team names by eye, and
  // there was no way at all to browse who was AVAILABLE — a free agent could
  // only be reached by typing a name you already knew.
  //
  // SEARCH BEHAVIOUR IS PRESERVED DELIBERATELY: in the ALL view it still
  // reaches the whole pool, because that was the only route to a free agent
  // before this selector existed and muscle memory shouldn't break. Inside a
  // team or the wire it filters that set instead.
  const needle = q.trim().toLowerCase();
  const inView = (p: LeaguePoolPlayer) => {
    const rid = bySlug.get(p.slug);
    if (view === 'all') return needle ? true : rid != null;
    if (view === 'fa') return rid == null;
    return rid === view;
  };
  const rows = pool
    .filter((p) => inView(p) && (!needle || p.full_name.toLowerCase().includes(needle)))
    .slice(0, 40);
  const rosteredCount = pool.filter((p) => bySlug.has(p.slug)).length;
  const faCount = pool.length - rosteredCount;
  const teamIds = [...new Set(rosters.map((r) => r.roster_id))].sort((a, b) => a - b);

  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>⚑ ROSTERS &amp; WAIVER WIRE</Mono>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}
      <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
        <Chip label="ALL ROSTERED" on={view === 'all'} onPress={() => { tap(); setView('all'); }} />
        <Chip label={`⏳ WAIVER WIRE (${faCount})`} on={view === 'fa'} onPress={() => { tap(); setView('fa'); }} />
        {teamIds.map((rid) => (
          <Chip key={rid} label={teams.get(rid) ?? `Roster ${rid}`} on={view === rid} onPress={() => { tap(); setView(rid); }} />
        ))}
      </View>
      <Mono size={8.5} tone="faint" style={{ marginTop: 6 }}>
        {view === 'all' ? `${rosteredCount} rostered across the league · search reaches free agents too`
          : view === 'fa' ? `${faCount} available — nobody's roster`
          : `${pool.filter((p) => bySlug.get(p.slug) === view).length} on ${teams.get(view as number) ?? `roster ${view}`}`}
      </Mono>
      <TextInput value={q} onChangeText={setQ}
        placeholder={view === 'all' ? 'Search the whole pool (free agents too)…' : 'Search this list…'}
        placeholderTextColor={t.faint}
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(12.5), color: t.text, backgroundColor: t.bg, marginTop: 8, marginBottom: 4 }} />
      {rows.length === 0 && (
        <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>
          {needle ? 'No player matches that search here.'
            : view === 'fa' ? 'Every player in the pool is on a roster.'
            : view === 'all' ? 'Nobody is rostered yet — the draft fills this.'
            : 'This team has no players yet.'}
        </Mono>
      )}
      {rows.map((p) => {
        const rid = bySlug.get(p.slug);
        return (
          <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
            <PosPill pos={p.pos} size={8} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: fs(12), color: t.text }}>{p.full_name}</Text>
              <Mono size={8} tone={rid != null ? 'dim' : 'faint'}>
                {rid != null ? teams.get(rid) ?? `Roster ${rid}` : 'free agent'}
              </Mono>
            </View>
            <Chip label="⇄ MOVE" onPress={() => { tap(); setMoveFor(p); }} />
            {rid != null && (
              <>
                <Chip label="⏳" onPress={() => { tap(); void run(() => commishRemovePlayer(leagueId, p.slug, true), `${p.full_name} → waivers (24h)`); }} />
                <Chip label="✂" onPress={() => { tap(); void run(() => commishRemovePlayer(leagueId, p.slug, false), `${p.full_name} → free agent`); }} />
              </>
            )}
          </View>
        );
      })}
      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
        ⇄ move puts a player on any roster (clears waiver holds; position limits bypassed, roster size still enforced). ⏳ waives with the 24h claim hold; ✂ cuts straight to free agency.
      </Mono>

      <Overlay visible={!!moveFor} title={moveFor ? `Move ${moveFor.full_name} to…` : ''} onClose={() => setMoveFor(null)}>
        {[...teams.entries()].map(([rid, name]) => (
          <Pressable key={rid} disabled={busy}
            onPress={() => {
              const p = moveFor; setMoveFor(null);
              if (p) void run(() => commishMovePlayer(leagueId, p.slug, rid), `${p.full_name} → ${name}`);
            }}
            style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(12.5), fontWeight: '700', color: t.you }}>{name}</Text>
          </Pressable>
        ))}
      </Overlay>
    </Card>
  );
}
