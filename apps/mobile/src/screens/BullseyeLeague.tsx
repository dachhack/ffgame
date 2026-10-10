// BULLSEYE LEAGUES, native (v0.661.0) — the web twin's note
// (src/screens/BullseyeLeague.tsx) and docs/dfs-bullseye.md §9. A Bullseye
// league opens into the rooms every league has, on the app's own room bar:
// MATCHUP (this week's squad and darts), LEAGUE (who's in, the week, the
// season), MY TEAM (my weeks, my name), CHAT (league chat, as everywhere), and
// behind ⚙ SETTINGS the rules, leaving, and — for its commissioner — the card,
// the size, the board, the name and deleting.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import {
  bullseyeLeague, bullseyeLeagueBoard, bullseyeMyWeeks, createBullseyeLeague, joinBullseye, setBullseyeSize, setDfsBullseye,
  setTeamName, leaveLeague, setLeagueName, commishDeleteLeague, postLeagueListing, closeLeagueListing, leagueListingState,
  isAdmin, myFeatures, bullseyeMaxSeats, bullseyeLeagueLine, friendlyError,
  type BullseyeLeague, type BullseyeLeagueBoard, type BullseyeMyWeek, type DfsVariant, type BullseyeSpan,
} from '@drip/core/data/liveApi';
import { DFS_SLOTS, dfsCard, dfsSlotLabel, dfsTiebreak } from '@drip/core/engine/dfsBullseye';
import { SITE_ORIGIN } from '@drip/core/data/invite';
import { useTheme } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, Mono } from '../ui/prims';
import { BullseyeSquad } from './BullseyeContest';

export type BullseyeRoom = 'matchup' | 'league' | 'team' | 'settings' | 'commish';
const n0 = (n: number) => n.toLocaleString('en-US');

function Field(props: React.ComponentProps<typeof TextInput>) {
  const t = useTheme();
  return <TextInput placeholderTextColor={t.faint} {...props}
    style={[{ color: t.text, borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: t.bg }, props.style]} />;
}
const useCap = () => {
  const [cap, setCap] = useState(32);
  useEffect(() => {
    Promise.all([isAdmin().catch(() => false), myFeatures().catch(() => ({} as Record<string, boolean>))])
      .then(([a, f]) => setCap(bullseyeMaxSeats(!!a, f))).catch(() => {});
  }, []);
  return cap;
};

// ── start: make one, or join one ───────────────────────────────────────────
export function BullseyeStart({ onOpen, onBack }: { onOpen: (leagueId: string, name: string, rosterId: number) => void; onBack: () => void }) {
  const t = useTheme();
  const cap = useCap();
  const [name, setName] = useState('');
  const [span, setSpan] = useState<BullseyeSpan>('season');
  const [variant, setVariant] = useState<DfsVariant>('slots');
  const [max, setMax] = useState('12');
  const [team, setTeam] = useState('');
  const [list, setList] = useState(true);
  const [blurb, setBlurb] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await createBullseyeLeague({ name, span, max: Number(max) || 0, variant, teamName: team || null });
      if (!r.ok || !r.league_id) { warn(); setErr(r.error ?? 'Couldn’t make it.'); return; }
      if (list) await postLeagueListing(r.league_id, blurb.trim() || null, null).catch(() => {});
      commit(); onOpen(r.league_id, r.name ?? 'Bullseye', r.roster_id ?? 1);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const join = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await joinBullseye(code, team || null);
      if (!r.ok || !r.league_id) { warn(); setErr(r.error ?? 'Couldn’t join.'); return; }
      commit(); onOpen(r.league_id, r.league ?? 'Bullseye', r.roster_id ?? 0);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Chip label="← BACK" onPress={() => { tap(); onBack(); }} />
        <Mono size={11} tone="you" weight="700" track={0.1}>🎯 BULLSEYE LEAGUE</Mono>
      </View>
      <Text style={{ fontSize: 13, color: t.dim, lineHeight: 19 }}>Each week everyone builds a $50,000 squad aimed at the week’s numbers. Closest wins. You run it: who’s in, how it plays, and whether it’s on the board.</Text>
      <Card style={{ gap: 10 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>START ONE</Mono>
        <Field value={name} onChangeText={setName} maxLength={60} placeholder="League name" />
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Mono size={9} tone="faint">RUNS</Mono>
          <Chip small label="ALL SEASON" on={span === 'season'} onPress={() => { tap(); setSpan('season'); }} />
          <Chip small label="THIS WEEK ONLY" on={span === 'week'} onPress={() => { tap(); setSpan('week'); }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Mono size={9} tone="faint">CARD</Mono>
          <Chip small label="SLOT TARGETS" on={variant === 'slots'} onPress={() => { tap(); setVariant('slots'); }} />
          <Chip small label="ONE TEAM TOTAL" on={variant === 'total'} onPress={() => { tap(); setVariant('total'); }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Mono size={9} tone="faint">{`UP TO (2–${n0(cap)})`}</Mono>
          <Field value={max} onChangeText={(v) => setMax(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 90 }} />
          <Mono size={9} tone="faint">people</Mono>
        </View>
        <Field value={team} onChangeText={setTeam} maxLength={30} placeholder="Your team name (optional)" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Switch value={list} onValueChange={setList} />
          <Mono size={9} tone="dim" style={{ flex: 1 }}>POST IT ON THE LEAGUE BOARD SO ANYONE CAN FIND IT</Mono>
        </View>
        {list && <Field value={blurb} onChangeText={setBlurb} maxLength={200} placeholder="Board blurb (optional)" />}
        <Chip on disabled={busy} label={busy ? 'MAKING IT…' : 'START THE LEAGUE →'} onPress={() => { tap(); void create(); }} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>HAVE A BULLSEYE CODE?</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" placeholder="ABCD1234" style={{ flex: 1 }} />
          <Chip on disabled={busy || code.trim().length < 4} label="JOIN" onPress={() => { tap(); void join(); }} />
        </View>
        <Mono size={9} tone="faint">Or find one on the league board.</Mono>
      </Card>
      {err && <Mono size={10} tone="warn">{err}</Mono>}
    </ScrollView>
  );
}

// ── the league's rooms ─────────────────────────────────────────────────────
export function BullseyeLeagueRoom({ leagueId, room, onRoom, onBack, onGone }: {
  leagueId: string; room: BullseyeRoom; onRoom: (r: BullseyeRoom) => void; onBack: () => void;
  /** Left or deleted: back to the leagues list. */
  onGone: () => void;
}) {
  const t = useTheme();
  const [lg, setLg] = useState<BullseyeLeague | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const load = useCallback(() => bullseyeLeague(leagueId).then((r) => { setLg(r); if (r.ok && r.week != null) setWeek((w) => w ?? r.week!); return r; }), [leagueId]);
  useEffect(() => { void load().catch(() => {}); }, [load]);
  if (!lg) return <View style={{ flex: 1, backgroundColor: t.bg }}><Mono size={10} tone="faint" style={{ padding: 16 }}>Loading…</Mono></View>;
  if (!lg.ok || !lg.bullseye) return <View style={{ flex: 1, backgroundColor: t.bg }}><Mono size={10} tone="warn" style={{ padding: 16 }}>{lg.error ?? 'Couldn’t open the league.'}</Mono></View>;
  const weeks = [...new Set([...(lg.weeks ?? []), ...(lg.week != null ? [lg.week] : [])])].sort((x, y) => x - y);

  if (room === 'matchup' && lg.me) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <WeekArrows weeks={weeks} week={week} current={lg.week ?? null} onWeek={setWeek} />
        {week != null && <BullseyeSquad key={week} leagueId={leagueId} week={week} onBack={() => onRoom('league')} />}
      </View>
    );
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 90 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void load(); }} />}>
      <Mono size={9} tone="dim">{bullseyeLeagueLine(lg.bullseye)}</Mono>
      {room === 'team' && lg.me ? <TeamRoom lg={lg} onOpenWeek={(w) => { setWeek(w); onRoom('matchup'); }} onRenamed={() => void load()} />
        : room === 'settings' ? <SettingsRoom lg={lg} onCommish={() => onRoom('commish')} onLeft={onGone} />
        : room === 'commish' && lg.commish ? <CommishRoom lg={lg} onChanged={() => void load()} onDeleted={onGone} />
        : <LeagueRoom lg={lg} weeks={weeks} week={week} onWeek={setWeek} onCommish={() => onRoom('commish')} onBack={onBack} />}
    </ScrollView>
  );
}

function WeekArrows({ weeks, week, current, onWeek }: { weeks: number[]; week: number | null; current: number | null; onWeek: (w: number) => void }) {
  if (week == null || weeks.length < 2) return null;
  const i = weeks.indexOf(week);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 8 }}>
      <Chip small dim={i <= 0} disabled={i <= 0} label="◀" onPress={() => { tap(); onWeek(weeks[i - 1]); }} />
      <Mono size={11} weight="700" tone="text">{`WEEK ${week}${week === current ? ' · THIS WEEK' : ''}`}</Mono>
      <Chip small dim={i < 0 || i >= weeks.length - 1} disabled={i < 0 || i >= weeks.length - 1} label="▶" onPress={() => { tap(); onWeek(weeks[i + 1]); }} />
    </View>
  );
}

function LeagueRoom({ lg, weeks, week, onWeek, onCommish, onBack }: { lg: BullseyeLeague; weeks: number[]; week: number | null; onWeek: (w: number) => void; onCommish: () => void; onBack: () => void }) {
  const t = useTheme();
  const [bd, setBd] = useState<BullseyeLeagueBoard | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => bullseyeLeagueBoard(lg.league_id!, week).then((r) => { if (alive) setBd(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [lg.league_id, week]);
  const b = lg.bullseye!;
  const share = async () => {
    if (!lg.invite_code) return;
    try { await Share.share({ message: `Join my Bullseye league "${lg.name}" on Drip Fantasy: ${SITE_ORIGIN}/?bullseye=${lg.invite_code}\nCode: ${lg.invite_code}` }); } catch { /* ignore */ }
  };
  return (
    <>
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Display size={22} tone="you">{n0(b.seats_taken)}</Display>
          <Mono size={9} tone="faint">{`of ${n0(b.max_seats)} in · ${b.span === 'week' ? `week ${b.week} only` : 'all season'}`}</Mono>
          {lg.listed && <Mono size={9} tone="you">ON THE BOARD</Mono>}
        </View>
        {lg.invite_code && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Mono size={9} tone="faint">CODE</Mono>
            <Mono size={13} weight="700" track={0.12} tone="text" style={{ flex: 1 }}>{lg.invite_code}</Mono>
            <Chip small label="INVITE" onPress={() => { tap(); void share(); }} />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {lg.commish && <Chip small label="⚑ COMMISSIONER" onPress={() => { tap(); onCommish(); }} />}
          <Chip small dim label="← MY LEAGUES" onPress={() => { tap(); onBack(); }} />
        </View>
      </Card>
      <WeekArrows weeks={weeks} week={week} current={lg.week ?? null} onWeek={onWeek} />
      <Card style={{ gap: 2 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>{`WEEK ${bd?.week ?? week ?? ''} · ${bd?.entries ?? 0} ${bd?.entries === 1 ? 'SQUAD' : 'SQUADS'}`}</Mono>
        {bd && !bd.started && <Mono size={9} tone="faint">Squads and scores show once the week’s first game locks.</Mono>}
        {(bd?.rows ?? []).map((r) => (
          <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.bd }}>
            <Mono size={10} tone={r.me ? 'you' : 'dim'} style={{ width: 30 }}>{String(r.rank)}</Mono>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: r.me ? t.you : t.text, fontWeight: r.me ? '700' : '400' }}>{r.team_name ?? `Team ${r.roster_id}`}</Text>
            <Mono size={9} tone="faint">{`${Number(r.points).toFixed(1)} pts`}</Mono>
            <Mono size={11} weight="700" tone={r.me ? 'you' : 'text'} style={{ width: 52, textAlign: 'right' }}>{Number(r.ring).toFixed(1)}</Mono>
          </View>
        ))}
        {bd?.me && !(bd.rows ?? []).some((r) => r.me) && <Mono size={10} tone="you" weight="700" style={{ marginTop: 6 }}>{`You: #${bd.me.rank} · ${Number(bd.me.ring).toFixed(1)}`}</Mono>}
      </Card>
      {bd?.season && (
        <Card style={{ gap: 2 }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>SEASON STANDINGS</Mono>
          {bd.season.rows.map((r) => (
            <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.bd }}>
              <Mono size={10} tone={r.me ? 'you' : 'dim'} style={{ width: 30 }}>{String(r.rank)}</Mono>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: r.me ? t.you : t.text, fontWeight: r.me ? '700' : '400' }}>{r.team_name ?? `Team ${r.roster_id}`}</Text>
              <Mono size={9} tone="faint">{`${r.weeks} wk${r.weeks === 1 ? '' : 's'}`}</Mono>
              <Mono size={11} weight="700" tone={r.me ? 'you' : 'text'} style={{ width: 60, textAlign: 'right' }}>{Number(r.total).toFixed(1)}</Mono>
            </View>
          ))}
          {bd.season.me && !bd.season.rows.some((r) => r.me) && <Mono size={10} tone="you" weight="700" style={{ marginTop: 6 }}>{`You: #${bd.season.me.rank} · ${Number(bd.season.me.total).toFixed(1)}`}</Mono>}
        </Card>
      )}
    </>
  );
}

function TeamRoom({ lg, onOpenWeek, onRenamed }: { lg: BullseyeLeague; onOpenWeek: (w: number) => void; onRenamed: () => void }) {
  const t = useTheme();
  const id = lg.league_id!;
  const [weeks, setWeeks] = useState<BullseyeMyWeek[] | null>(null);
  const [name, setName] = useState(lg.me?.team ?? '');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { bullseyeMyWeeks(id).then((r) => setWeeks(r.ok ? r.weeks ?? [] : [])).catch(() => setWeeks([])); }, [id]);
  const rid = lg.me?.roster_id;
  const tb = useMemo(() => (rid != null && lg.week != null ? dfsTiebreak(id, lg.week, rid, dfsCard(id, lg.week)) : null), [id, lg.week, rid]);
  const rename = async () => {
    if (rid == null) return;
    const r = await setTeamName(id, rid, name).catch((e) => ({ ok: false, error: friendlyError(e) }));
    setNote(r.ok ? '✓ renamed' : (r.error ?? 'Didn’t rename.'));
    if (r.ok) onRenamed();
  };
  return (
    <>
      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>MY TEAM</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field value={name} onChangeText={setName} maxLength={30} style={{ flex: 1 }} />
          <Chip on disabled={!name.trim() || name.trim() === lg.me?.team} label="RENAME" onPress={() => { tap(); void rename(); }} />
        </View>
        {note && <Mono size={9} tone={note.startsWith('✓') ? 'you' : 'warn'}>{note}</Mono>}
        {tb && <Mono size={9} tone="dim">{`⚖️ This week’s tie-breaker: your ${dfsSlotLabel(tb.slot)} aims at ${tb.target}.`}</Mono>}
      </Card>
      <Card style={{ gap: 2 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>MY WEEKS</Mono>
        {weeks && !weeks.length && <Mono size={9} tone="faint">No squads yet — build this week’s on MATCHUP.</Mono>}
        {(weeks ?? []).map((w) => (
          <Pressable key={w.week} onPress={() => { tap(); onOpenWeek(w.week); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.bd }}>
            <Mono size={11} tone="text" style={{ width: 64 }}>{`Week ${w.week}`}</Mono>
            <Mono size={9} tone="faint" style={{ flex: 1 }}>{`${w.status === 'final' ? 'final' : w.status === 'live' ? 'live' : 'squad set'}${w.rank != null ? ` · #${w.rank} of ${n0(w.entries)}` : ''}`}</Mono>
            <Mono size={11} weight="700" tone="text">{w.ring != null ? Number(w.ring).toFixed(1) : '—'}</Mono>
          </Pressable>
        ))}
      </Card>
    </>
  );
}

function SettingsRoom({ lg, onCommish, onLeft }: { lg: BullseyeLeague; onCommish: () => void; onLeft: () => void }) {
  const t = useTheme();
  const b = lg.bullseye!;
  const [err, setErr] = useState<string | null>(null);
  const leave = () => Alert.alert(`Leave ${lg.name}?`, 'Your squads stay in the standings.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Leave', style: 'destructive', onPress: async () => {
      const r = await leaveLeague(lg.league_id!).catch((e) => ({ ok: false, error: friendlyError(e) }));
      if (!r.ok) setErr(r.error ?? 'Couldn’t leave.'); else onLeft();
    } },
  ]);
  const rules = [
    `A squad of nine — ${DFS_SLOTS.map((d) => dfsSlotLabel(d.slot)).join(', ')} — under a $50,000 cap, from the week’s salary board.`,
    b.variant === 'total'
      ? `One number for the whole squad. Land your points close to it: dead-on doubles your score; any player who posts a zero costs ${b.radius}.`
      : `Every slot has its own number. Each player scores ${b.radius} for dead-on plus ${b.radius} more for a bullseye, less the farther off; a zero costs ${b.radius}.`,
    'Each player locks an hour before his own game. Until then you can swap him.',
    'Your opponents’ picks are sealed: each shows once his game locks.',
    'Ties are settled by your tie-breaker: one RB or WR spot with its own number, shown before you build. Closer wins.',
    b.span === 'week' ? `It plays week ${b.week} only.` : 'It plays every week. Season standings add up every week’s ring total; a week without a squad scores nothing.',
  ];
  return (
    <Card style={{ gap: 8 }}>
      <Mono size={9} tone="faint" weight="700" track={0.1}>HOW THIS LEAGUE PLAYS</Mono>
      {rules.map((r, i) => <Text key={i} style={{ fontSize: 13, color: t.dim, lineHeight: 19 }}>{`• ${r}`}</Text>)}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {lg.commish && <Chip label="⚑ COMMISSIONER SETTINGS" onPress={() => { tap(); onCommish(); }} />}
        {lg.me && !lg.commish && <Chip dim label="LEAVE THE LEAGUE" onPress={() => { tap(); leave(); }} />}
      </View>
      {err && <Mono size={10} tone="warn">{err}</Mono>}
    </Card>
  );
}

function CommishRoom({ lg, onChanged, onDeleted }: { lg: BullseyeLeague; onChanged: () => void; onDeleted: () => void }) {
  const b = lg.bullseye!;
  const id = lg.league_id!;
  const cap = useCap();
  const [size, setSize] = useState(String(b.max_seats));
  const [radius, setRadius] = useState(String(b.radius));
  const [name, setName] = useState(lg.name ?? '');
  const [listed, setListed] = useState(!!lg.listed);
  const [blurb, setBlurb] = useState('');
  const [dues, setDues] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    leagueListingState(id).then((s) => { if (s.ok) { setListed(!!s.listed); setBlurb(s.blurb ?? ''); setDues(s.dues ?? ''); } }).catch(() => {});
  }, [id]);
  const act = async (p: Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true); setNote(null);
    const r = await p.catch((e) => ({ ok: false, error: friendlyError(e) }));
    setBusy(false);
    if (r.ok) commit(); else warn();
    setNote(r.ok ? `✓ ${done}` : (r.error ?? 'That didn’t work.'));
    if (r.ok) onChanged();
    return r.ok;
  };
  const rad = Number(radius) || 10;
  return (
    <>
      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>THE CARD</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(['slots', 'total'] as const).map((v) => (
            <Chip key={v} small on={b.variant === v} disabled={busy} label={v === 'slots' ? 'SLOT TARGETS' : 'ONE TEAM TOTAL'} onPress={() => { tap(); void act(setDfsBullseye(id, v, rad), 'card changed'); }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Mono size={9} tone="faint" style={{ flex: 1 }}>RADIUS (2–50): points for dead-on, and the zero penalty</Mono>
          <Field value={radius} onChangeText={(v) => setRadius(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 60 }} />
          <Chip small on disabled={busy || rad === b.radius} label="SET" onPress={() => { tap(); void act(setDfsBullseye(id, b.variant, rad), 'radius changed'); }} />
        </View>
        <Mono size={8.5} tone="faint">Not while a week is being played — change it once that week is final.</Mono>
      </Card>
      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>WHO CAN GET IN</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Mono size={9} tone="faint" style={{ flex: 1 }}>{`UP TO (2–${n0(cap)}) · ${n0(b.seats_taken)} in now`}</Mono>
          <Field value={size} onChangeText={(v) => setSize(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 90 }} />
          <Chip small on disabled={busy || Number(size) === b.max_seats} label="SET" onPress={() => { tap(); void act(setBullseyeSize(id, Number(size) || 0), 'size changed'); }} />
        </View>
        <Mono size={9} tone="faint" weight="700" track={0.1}>THE LEAGUE BOARD</Mono>
        <Field value={blurb} onChangeText={setBlurb} maxLength={200} multiline placeholder="Blurb (optional)" />
        <Field value={dues} onChangeText={setDues} maxLength={120} placeholder="Dues (optional) — printed, never collected" />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip on disabled={busy} label={listed ? 'UPDATE THE POST' : 'POST IT TO THE BOARD'} onPress={() => { tap(); void act(postLeagueListing(id, blurb.trim() || null, dues.trim()), listed ? 'board post updated' : 'posted to the board').then((ok) => { if (ok) setListed(true); }); }} />
          {listed && <Chip disabled={busy} label="TAKE IT DOWN" onPress={() => { tap(); void act(closeLeagueListing(id), 'taken off the board').then((ok) => { if (ok) setListed(false); }); }} />}
        </View>
        {b.span === 'week' && <Mono size={8.5} tone="faint">A one-week league leaves the board once its week kicks off.</Mono>}
      </Card>
      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>THE LEAGUE</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field value={name} onChangeText={setName} maxLength={60} style={{ flex: 1 }} />
          <Chip small on disabled={busy || !name.trim() || name.trim() === lg.name} label="RENAME" onPress={() => { tap(); void act(setLeagueName(id, name), 'renamed'); }} />
        </View>
        <Mono size={9} tone="faint">{`To delete it for everyone, type its name: ${lg.name}`}</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field value={confirmName} onChangeText={setConfirmName} placeholder="League name" style={{ flex: 1 }} />
          <Chip dim disabled={busy || !confirmName.trim()} label="DELETE" onPress={() => { tap(); void act(commishDeleteLeague(id, confirmName), 'deleted').then((ok) => { if (ok) onDeleted(); }); }} />
        </View>
      </Card>
      {note && <Mono size={10} tone={note.startsWith('✓') ? 'you' : 'warn'}>{note}</Mono>}
    </>
  );
}
