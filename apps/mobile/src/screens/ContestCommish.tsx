// THE CONTEST CARD, native (v0.664.0) — the web twin's note
// (src/screens/ContestCommish.tsx). The commissioner's map destination that
// is a contest league's own: what wins, how it plays, the budget, the
// Bullseye card, the size, the league board.
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  contestLeague, setContestRules, setDfsBullseye, setBullseyeSize, postLeagueListing, closeLeagueListing, leagueListingState,
  isAdmin, myFeatures, bullseyeMaxSeats, friendlyError,
  contestWeekList, commishVoidWeek, commishContestSquad, commishSetContestSquad, contestBoard, contestBoardFind, podSalaries, setLeaguePrizes,
  type ContestInfo, type ContestKind, type ContestWeekRow, type CommishContestSquad, type PodSalaryRow, type PrizeRow,
} from '@drip/core/data/liveApi';
import { CONTEST_WORD, CONTEST_EMOJI, CONTEST_LATE_WORD, CONTEST_DEADLINE_WORD, contestLateEntryDefault, contestSquadOf, contestSlotLabels, type ContestLateEntry, type ContestEntryDeadline } from '@drip/core/engine/contest';
import { classicSlotsFromSpec } from '@drip/core/engine/classic';
import { useTheme } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Mono } from '../ui/prims';
import { RescoreBox, AdjustBox, DuesCard } from '../ui/CommishDesk';
import { PlayoffControls } from '../ui/LeagueExtras';

const n0 = (n: number) => n.toLocaleString('en-US');
export const CONTEST_BUDGETS = [0, 10000, 20000, 30000, 40000, 50000, 60000, 75000, 100000, 150000, 200000, 500000];   // 0 = NO CAP (0469)
/** The minimum spend (0469): golf's constraint. 0 = none. */
export const CONTEST_MIN_SPENDS = [0, 10000, 20000, 30000, 40000, 45000, 50000, 60000, 75000, 100000];
export const moneyChip = (v: number, none: string) => (v ? `$${Math.round(v / 1000)}k` : none);

function Field(props: React.ComponentProps<typeof TextInput>) {
  const t = useTheme();
  return <TextInput placeholderTextColor={t.faint} {...props}
    style={[{ color: t.text, borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: t.bg }, props.style]} />;
}

export function ContestCommishCard({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const [b, setB] = useState<ContestInfo | null>(null);
  const [played, setPlayed] = useState(false);
  const [cap, setCap] = useState(32);
  const [size, setSize] = useState('12');
  const [radius, setRadius] = useState('10');
  const [listed, setListed] = useState(false);
  const [blurb, setBlurb] = useState('');
  const [dues, setDues] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => contestLeague(leagueId).then((r) => {
    if (!r.ok || !r.bullseye) { setNote(r.error ?? 'Couldn’t read the league.'); return; }
    setB(r.bullseye); setSize(String(r.bullseye.max_seats)); setRadius(String(r.bullseye.radius));
    setPlayed((r.weeks ?? []).length > 0); setListed(!!r.listed);
  }).catch((e) => setNote(friendlyError(e)));
  useEffect(() => {
    void load();
    Promise.all([isAdmin().catch(() => false), myFeatures().catch(() => ({} as Record<string, boolean>))])
      .then(([a, f]) => setCap(bullseyeMaxSeats(!!a, f))).catch(() => {});
    leagueListingState(leagueId).then((s) => { if (s.ok) { setListed(!!s.listed); setBlurb(s.blurb ?? ''); setDues(s.dues ?? ''); } }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [leagueId]);
  const act = async (p: Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true); setNote(null);
    const r = await p.catch((e) => ({ ok: false, error: friendlyError(e) }));
    setBusy(false);
    if (r.ok) commit(); else warn();
    setNote(r.ok ? `✓ ${done}` : (r.error ?? 'That didn’t work.'));
    if (r.ok) { await load(); onChanged?.(); }
    return r.ok;
  };
  if (!b) return <Card><Mono size={9} tone="faint">{note ?? 'Loading…'}</Mono></Card>;
  const h2h = b.format === 'h2h';
  const rad = Number(radius) || 10;
  return (
    <View style={{ gap: 10 }}>
      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>WINS BY</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(['high', 'golf', 'bullseye'] as ContestKind[]).map((c) => (
            <Chip key={c} small on={b.contest === c} disabled={busy} label={`${CONTEST_EMOJI[c]} ${CONTEST_WORD[c]}`} onPress={() => { tap(); void act(setContestRules(leagueId, { contest: c }), `now ${CONTEST_WORD[c].toLowerCase()}`); }} />
          ))}
        </View>
        <Mono size={8.5} tone="faint">{b.contest === 'golf' ? 'Lowest score wins. Set each spot’s 0 → penalty on ROSTER so a scoreless player costs something.' : b.contest === 'high' ? 'Highest score wins.' : 'Closest to the week’s card wins; the dart scores each spot.'} Takes effect from the next week.</Mono>
        <Mono size={9} tone="faint" weight="700" track={0.1}>PLAYS</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Chip small on={h2h} disabled={busy || played} label="HEAD-TO-HEAD" onPress={() => { tap(); void act(setContestRules(leagueId, { format: 'h2h' }), 'head-to-head'); }} />
          <Chip small on={!h2h} disabled={busy || played} label="LEADERBOARD" onPress={() => { tap(); void act(setContestRules(leagueId, { format: 'board' }), 'leaderboard'); }} />
        </View>
        <Mono size={8.5} tone="faint">{played ? 'Set once the league has played a week.' : 'Head-to-head pairs an even number of seats, up to 32; the CPU plays an empty seat.'}</Mono>
        <Mono size={9} tone="faint" weight="700" track={0.1}>BUDGET</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {[...new Set([...CONTEST_BUDGETS, b.budget])].sort((x, y) => x - y).map((v) => (
            <Chip key={v} small on={b.budget === v} disabled={busy} label={moneyChip(v, 'NO CAP')} onPress={() => { tap(); void act(setContestRules(leagueId, { budget: v }), 'budget changed'); }} />
          ))}
        </View>
        <Mono size={8.5} tone="faint">Per squad, from the next week. Add or remove spots on ROSTER — a bigger squad wants a bigger budget. NO CAP suits Bullseye: the card does the limiting.</Mono>
        <Mono size={9} tone="faint" weight="700" track={0.1}>MIN SPEND</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {[...new Set([...CONTEST_MIN_SPENDS, b.min_spend ?? 0])].sort((x, y) => x - y).map((v) => (
            <Chip key={v} small on={(b.min_spend ?? 0) === v} disabled={busy} label={moneyChip(v, 'NONE')} onPress={() => { tap(); void act(setContestRules(leagueId, { minSpend: v }), 'minimum spend changed'); }} />
          ))}
        </View>
        <Mono size={8.5} tone="faint">{b.contest === 'golf' ? 'Golf’s real constraint: a squad must spend at least this, so cheap no-names aren’t the whole game.' : 'A floor a squad must spend; mostly for golf.'}</Mono>
        <Mono size={9} tone="faint" weight="700" track={0.1}>RULED OUT</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Chip small on={!!b.auto_sub} disabled={busy} label="SWAP HIM FOR ME" onPress={() => { tap(); void act(setContestRules(leagueId, { autoSub: true }), 'auto-sub on'); }} />
          <Chip small on={!b.auto_sub} disabled={busy} label="LEAVE IT TO ME" onPress={() => { tap(); void act(setContestRules(leagueId, { autoSub: false }), 'auto-sub off'); }} />
        </View>
        <Mono size={9} tone="faint" weight="700" track={0.1}>NO SQUAD BY LOCK</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(h2h ? ['cpu', 'zero'] as ContestLateEntry[] : ['cpu', 'zero', 'drop'] as ContestLateEntry[]).map((v) => (
            <Chip key={v} small on={(b.late_entry ?? contestLateEntryDefault(b.format)) === v} disabled={busy} label={CONTEST_LATE_WORD[v]} onPress={() => { tap(); void act(setContestRules(leagueId, { lateEntry: v }), `a no-show ${CONTEST_LATE_WORD[v].toLowerCase()}`); }} />
          ))}
        </View>
        <Mono size={8.5} tone="faint">{`A seat with no squad at the week’s first kickoff: ${h2h ? 'the CPU builds one so its opponent has a game, or it forfeits with a zero' : 'the CPU builds one, it scores a zero, or it sits the week out with no row at all'}.${b.contest === 'golf' ? ' In golf a scoreless squad is the best score, so SCORES ZERO needs every spot’s 0 → penalty set on ROSTER.' : ''}`}</Mono>
        <Mono size={9} tone="faint" weight="700" track={0.1}>ENTRIES</Mono>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(['open', 'first'] as ContestEntryDeadline[]).map((v) => (
            <Chip key={v} small on={(b.entry_deadline ?? 'open') === v} disabled={busy} label={CONTEST_DEADLINE_WORD[v]} onPress={() => { tap(); void act(setContestRules(leagueId, { entryDeadline: v }), v === 'first' ? 'entries close at the first kickoff' : 'entries open until each player’s game'); }} />
          ))}
        </View>
        <Mono size={8.5} tone="faint">A new squad can go in until its players kick off, or not at all once the week’s first game has — a saved squad still swaps its unlocked players either way.</Mono>
        {!h2h && (
          <>
            <Mono size={9} tone="faint" weight="700" track={0.1}>ENTRIES PER MEMBER</Mono>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {[...new Set([1, 2, 3, 5, 10, 20, b.max_entries ?? 1])].sort((x, y) => x - y).map((v) => (
                <Chip key={v} small on={(b.max_entries ?? 1) === v} disabled={busy} label={String(v)} onPress={() => { tap(); void act(setContestRules(leagueId, { maxEntries: v }), `${v} ${v === 1 ? 'entry' : 'entries'} per member`); }} />
              ))}
            </View>
            <Mono size={8.5} tone="faint">How many squads one member may field — each is its own seat on the board, built one at a time on MY TEAM. Head-to-head is always one: an opponent is a person.</Mono>
          </>
        )}
        <Mono size={8.5} tone="faint">Every player locks at his own kickoff, so a ruled-out pick can be swapped until then. SWAP HIM FOR ME puts the best affordable body in his spot in the minutes before his game if nobody has; LEAVE IT TO ME banks the zero.</Mono>
      </Card>

      {b.contest === 'bullseye' && (
        <Card style={{ gap: 8 }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>THE CARD</Mono>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(['slots', 'total'] as const).map((v) => (
              <Chip key={v} small on={b.variant === v} disabled={busy} label={v === 'slots' ? 'SLOT TARGETS' : 'ONE TEAM TOTAL'} onPress={() => { tap(); void act(setDfsBullseye(leagueId, v, rad), 'card changed'); }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Mono size={9} tone="faint" style={{ flex: 1 }}>RADIUS (2–50): points for dead-on, and the zero penalty</Mono>
            <Field value={radius} onChangeText={(v) => setRadius(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 60 }} />
            <Chip small on disabled={busy || rad === b.radius} label="SET" onPress={() => { tap(); void act(setDfsBullseye(leagueId, b.variant, rad), 'radius changed'); }} />
          </View>
          <Mono size={8.5} tone="faint">Not while a week is being played — change it once that week is final.</Mono>
        </Card>
      )}

      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>WHO CAN GET IN</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Mono size={9} tone="faint" style={{ flex: 1 }}>{`${h2h ? 'TEAMS (even, 2–32)' : `UP TO (2–${n0(cap)})`} · ${n0(b.seats_taken)} in now`}</Mono>
          <Field value={size} onChangeText={(v) => setSize(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 90 }} />
          <Chip small on disabled={busy || Number(size) === b.max_seats} label="SET" onPress={() => { tap(); void act(setBullseyeSize(leagueId, Number(size) || 0), 'size changed'); }} />
        </View>
        {h2h && <Mono size={8.5} tone="faint">An added seat plays as the CPU until someone takes it.</Mono>}
        <Mono size={9} tone="faint" weight="700" track={0.1}>THE LEAGUE BOARD</Mono>
        <Field value={blurb} onChangeText={setBlurb} maxLength={200} multiline placeholder="Blurb (optional)" />
        <Field value={dues} onChangeText={setDues} maxLength={120} placeholder="Dues (optional) — printed, never collected" />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip on disabled={busy} label={listed ? 'UPDATE THE POST' : 'POST IT TO THE BOARD'} onPress={() => { tap(); void act(postLeagueListing(leagueId, blurb.trim() || null, dues.trim()), listed ? 'board post updated' : 'posted to the board').then((ok) => { if (ok) setListed(true); }); }} />
          {listed && <Chip disabled={busy} label="TAKE IT DOWN" onPress={() => { tap(); void act(closeLeagueListing(leagueId), 'taken off the board').then((ok) => { if (ok) setListed(false); }); }} />}
        </View>
        {b.span === 'week' && <Mono size={8.5} tone="faint">A one-week league leaves the board once its week kicks off.</Mono>}
      </Card>
      <Card style={{ gap: 6 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>DUES & PRIZES</Mono>
        <Mono size={8.5} tone="faint">What a seat costs and what the places win. The platform prints it and never collects it; both show on the league’s SETTINGS and on the league board.</Mono>
        <DuesCard leagueId={leagueId} />
        <PrizesEditor leagueId={leagueId} prizes={b.prizes ?? []} onSaved={() => void load()} />
      </Card>
      {h2h && b.span === 'season' && (
        <Card style={{ gap: 6 }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>PLAYOFFS</Mono>
          <Mono size={8.5} tone="faint">A season head-to-head league plays a bracket over its last weeks — four teams from week 15 unless you say otherwise, seeded by the regular-season standings; everyone else plays a consolation ladder. The round-robin stops where the bracket starts.</Mono>
          <PlayoffControls leagueId={leagueId} onChanged={() => void load()} />
        </Card>
      )}
      {played && <ContestFixWeekCard leagueId={leagueId} />}
      {note && <Mono size={10} tone={note.startsWith('✓') ? 'you' : 'warn'}>{note}</Mono>}
    </View>
  );
}

// ── 🏆 PRIZES (0477) — the web PrizesEditor's twin ───────────────────────────
function PrizesEditor({ leagueId, prizes, onSaved }: { leagueId: string; prizes: PrizeRow[]; onSaved: () => void }) {
  const [rows, setRows] = useState<PrizeRow[]>(prizes.length ? prizes : [{ label: '1st', prize: '' }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setRows(prizes.length ? prizes : [{ label: '1st', prize: '' }]); }, [prizes]);
  const set = (i: number, k: keyof PrizeRow, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    const r = await setLeaguePrizes(leagueId, rows.filter((x) => x.label.trim() && x.prize.trim())).catch((e) => ({ ok: false, error: friendlyError(e) }));
    setBusy(false);
    if (r.ok) commit(); else warn();
    setMsg(r.ok ? '✓ prizes saved — the league was told' : (r.error ?? 'That didn’t work.'));
    if (r.ok) onSaved();
  };
  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      <Mono size={9} weight="700" tone="dim">🏆 PRIZES</Mono>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Field value={r.label} onChangeText={(v) => set(i, 'label', v)} maxLength={40} placeholder="1st" style={{ width: 90 }} />
          <Field value={r.prize} onChangeText={(v) => set(i, 'prize', v)} maxLength={60} placeholder="$150 — or a hat" style={{ flex: 1 }} />
          <Chip small dim label="✕" onPress={() => { tap(); setRows((x) => x.filter((_, j) => j !== i)); }} />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {rows.length < 8 && <Chip small label="+ A PLACE" onPress={() => { tap(); setRows((x) => [...x, { label: x.length === 1 ? '2nd' : x.length === 2 ? '3rd' : '', prize: '' }]); }} />}
        <Chip small on disabled={busy} label="SAVE PRIZES" onPress={() => { tap(); void save(); }} />
      </View>
      <Mono size={8.5} tone="faint">Leave the list empty and save to clear it.</Mono>
      {msg && <Mono size={9} tone={msg.startsWith('✓') ? 'you' : 'warn'}>{msg}</Mono>}
    </View>
  );
}

// ── FIX A WEEK (0474) — the web panel's twin (src/screens/ContestCommish.tsx) ──
// Void a final week (restore is the undo), correct a player's points, set a
// seat's squad past the locks, re-score the week. Every fix is announced in
// chat with the reason.
export function ContestFixWeekCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [weeks, setWeeks] = useState<ContestWeekRow[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () => contestWeekList(leagueId).then((r) => {
    if (!r.ok) { setNote(r.error ?? 'Couldn’t read the weeks.'); return; }
    setWeeks(r.weeks ?? []);
  }).catch((e) => setNote(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const w = weeks?.find((x) => x.week === week) ?? null;
  const send = async (on: boolean) => {
    if (w == null || busy) return;
    setBusy(true); setNote(null);
    const r = await commishVoidWeek(leagueId, w.week, on, why).catch((e) => ({ ok: false, error: friendlyError(e) }));
    setBusy(false);
    if (r.ok) commit(); else warn();
    setNote(r.ok ? `✓ week ${w.week} ${on ? 'voided' : 'restored'}` : (r.error ?? 'That didn’t work.'));
    if (r.ok) { setWhy(''); void load(); }
  };
  const voidIt = (on: boolean) => {
    if (!on || w == null) { void send(on); return; }
    Alert.alert(`Void week ${w.week}?`, 'It stops counting in the standings and the league is told why. You can restore it later.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Void it', style: 'destructive', onPress: () => { void send(true); } }]);
  };
  return (
    <Card style={{ gap: 8 }}>
      <Mono size={9} tone="faint" weight="700" track={0.1}>FIX A WEEK</Mono>
      <Mono size={8.5} tone="faint">Void a week that shouldn’t count, correct a player’s points after a stat correction, set a member’s squad, and re-score the week from the plays as they stand. Every fix is announced in the league chat with your reason.</Mono>
      {weeks && !weeks.length && <Mono size={9} tone="faint">No weeks yet.</Mono>}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {(weeks ?? []).map((x) => (
          <Chip key={x.week} small on={week === x.week} label={`WEEK ${x.week}${x.void ? ' · VOIDED' : x.final ? '' : ` · ${x.status.toUpperCase()}`}`}
            onPress={() => { tap(); setWeek(week === x.week ? null : x.week); }} />
        ))}
      </View>
      {w && (
        <>
          <Mono size={9} tone="faint">{`${w.final ? `${w.stamped} of ${w.matchups} final scores stamped` : `${w.status} — ${w.matchups} ${w.matchups === 1 ? 'matchup' : 'matchups'}`} · ${n0(w.entries)} ${w.entries === 1 ? 'squad' : 'squads'}${w.void ? ` · VOIDED — ${w.void_note ?? ''}` : ''}`}</Mono>
          {w.void ? (
            <View style={{ flexDirection: 'row' }}><Chip disabled={busy} label={`↩️ RESTORE WEEK ${w.week}`} onPress={() => { tap(); voidIt(false); }} /></View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Field value={why} onChangeText={setWhy} maxLength={200} placeholder="why void it — the league sees this" style={{ flex: 1 }} />
              <Chip disabled={busy || !w.final || !why.trim()} label="🚫 VOID" onPress={() => { tap(); voidIt(true); }} />
            </View>
          )}
          <Mono size={8.5} tone="faint">{w.void ? 'A voided week stays on the board, marked, and counts for nothing.' : w.final ? 'Voiding keeps the scores but takes the week out of the standings and records.' : 'A week can be voided once it’s final.'}</Mono>
          {w.final && w.stamped > 0
            ? <RescoreBox leagueId={leagueId} week={w.week} onApplied={() => void load()} contest fix={<SquadFixBox leagueId={leagueId} week={w.week} />} />
            : (
              <View style={{ marginTop: 4, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, gap: 6 }}>
                <Mono size={8.5} tone="faint">{`Week ${w.week} is still being scored: a fix here counts on the next scoring pass, within a minute or two. Re-scoring opens once every game is final.`}</Mono>
                <AdjustBox leagueId={leagueId} week={w.week} />
                <SquadFixBox leagueId={leagueId} week={w.week} />
              </View>
            )}
        </>
      )}
      {note && <Mono size={10} tone={note.startsWith('✓') ? 'you' : 'warn'}>{note}</Mono>}
    </Card>
  );
}

// ── 🧾 SET A SQUAD (0474) — the web SquadFixBox's twin ─────────────────────
type Seat = { roster_id: number; team_name: string | null };
function SquadFixBox({ leagueId, week }: { leagueId: string; week: number }) {
  const t = useTheme();
  const [seats, setSeats] = useState<Seat[]>([]);
  const [findQ, setFindQ] = useState('');
  const [hits, setHits] = useState<Seat[] | null>(null);
  const [rid, setRid] = useState<number | null>(null);
  const [sq, setSq] = useState<CommishContestSquad | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[]>([]);
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [pq, setPq] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    contestBoard(leagueId, week, 500).then((b) => {
      const rows = (b.season?.rows ?? b.rows ?? []) as Seat[];
      setSeats(rows.map((r) => ({ roster_id: r.roster_id, team_name: r.team_name })).sort((a, b2) => (a.team_name ?? '').localeCompare(b2.team_name ?? '')));
    }).catch(() => {});
  }, [leagueId, week]);
  useEffect(() => {
    const q = findQ.trim();
    if (!q) { setHits(null); return; }
    const local = seats.filter((s) => (s.team_name ?? `Team ${s.roster_id}`).toLowerCase().includes(q.toLowerCase()));
    if (local.length) { setHits(local.slice(0, 8)); return; }
    const id = setTimeout(() => contestBoardFind(leagueId, week, q).then((r) => {
      if (!r.ok) return;
      const found = (r.season.length ? r.season : r.found) as Seat[];
      setHits(found.slice(0, 8).map((h) => ({ roster_id: h.roster_id, team_name: h.team_name })));
    }).catch(() => {}), 300);
    return () => clearTimeout(id);
  }, [findQ, seats, leagueId, week]);
  useEffect(() => {
    if (rid == null) { setSq(null); return; }
    Promise.all([commishContestSquad(leagueId, week, rid), podSalaries(week)]).then(([s, rows]) => {
      if (!s.ok) { setMsg(s.error ?? 'could not load'); return; }
      setSq(s); setBoard(rows);
      setPicks(contestSquadOf(s.entry, classicSlotsFromSpec(s.slots ?? null) ?? []));
    }).catch((e) => setMsg(friendlyError(e)));
  }, [leagueId, week, rid]);
  const defs = classicSlotsFromSpec(sq?.slots ?? null) ?? [];
  const labels = contestSlotLabels(defs);
  const bySlug = new Map(board.map((r) => [r.slug, r]));
  const spent = defs.reduce((sum, d) => sum + (bySlug.get(picks[d.slot] ?? '')?.salary ?? 0), 0);
  const budget = sq?.budget ?? 0;
  const seatName = (s: Seat) => s.team_name ?? `Team ${s.roster_id}`;
  const shown = hits ?? seats.slice(0, 8);
  const openDef = defs.find((d) => d.slot === open) ?? null;
  const options = openDef
    ? board.filter((r) => openDef.pos.some((p) => String(p).toUpperCase() === String(r.pos).toUpperCase()))
        .filter((r) => !pq.trim() || r.name.toLowerCase().includes(pq.trim().toLowerCase()) || r.team.toLowerCase() === pq.trim().toLowerCase())
        .sort((a, b) => b.salary - a.salary).slice(0, 12)
    : [];
  const save = async () => {
    if (rid == null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetContestSquad(leagueId, week, rid, picks, why);
      if (!r.ok) { warn(); setMsg(r.error ?? 'failed'); return; }
      commit();
      setMsg(`✓ saved — in ${r.in?.length ? r.in.join(', ') : 'nobody'}; out ${r.out?.length ? r.out.join(', ') : 'nobody'}${r.rescore ? ` — week ${week}'s finals change when you re-score it below` : ''}`);
      setWhy('');
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const rowStyle = { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd } as const;
  return (
    <View style={{ gap: 6, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
      <Mono size={9} weight="700" tone="dim">{`🧾 SET A SQUAD · WEEK ${week}`}</Mono>
      <Mono size={8.5} tone="faint">One seat’s squad for this week, past the kickoff locks. The budget, the floor and each spot’s rules still apply. The league is told who came in and who went out, with your reason.</Mono>
      <Field value={findQ} onChangeText={setFindQ} maxLength={30} placeholder="find a team…" autoCorrect={false} />
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {shown.map((s) => <Chip key={s.roster_id} small on={rid === s.roster_id} label={seatName(s)} onPress={() => { tap(); setRid(rid === s.roster_id ? null : s.roster_id); setOpen(null); }} />)}
        {!shown.length && findQ.trim() ? <Mono size={9} tone="faint">No team by that name.</Mono> : null}
      </View>
      {sq && (
        <View style={{ gap: 2 }}>
          {defs.map((d) => {
            const cur = bySlug.get(picks[d.slot] ?? '');
            return (
              <View key={d.slot}>
                <Pressable onPress={() => { tap(); setOpen(open === d.slot ? null : d.slot); setPq(''); }} style={[rowStyle, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                  <Mono size={9} weight="700" style={{ width: 70 }}>{labels[d.slot] ?? d.slot}</Mono>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: cur ? t.text : t.faint }}>{cur ? `${cur.name} · ${cur.pos} ${cur.team}` : '— empty —'}</Text>
                  <Mono size={9} tone="faint">{cur ? `$${n0(cur.salary)}` : ''}</Mono>
                  <Mono size={9} tone="you">{open === d.slot ? '▲' : '▼'}</Mono>
                </Pressable>
                {open === d.slot && (
                  <View style={{ gap: 2, paddingLeft: 8, paddingBottom: 6 }}>
                    <Field value={pq} onChangeText={setPq} placeholder="search the board…" autoCorrect={false} />
                    <Pressable onPress={() => { tap(); setPicks((p) => ({ ...p, [d.slot]: null })); setOpen(null); }} style={rowStyle}><Mono size={9} tone="faint">— empty —</Mono></Pressable>
                    {options.map((o) => (
                      <Pressable key={o.slug} onPress={() => { tap(); setPicks((p) => ({ ...p, [d.slot]: o.slug })); setOpen(null); }} style={[rowStyle, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: picks[d.slot] === o.slug ? t.you : t.text }}>{`${o.name} · ${o.pos} ${o.team}`}</Text>
                        <Mono size={9} tone="faint">{`$${n0(o.salary)}`}</Mono>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          <Mono size={9} tone={budget > 0 && spent > budget ? 'warn' : 'faint'} style={{ marginTop: 4 }}>
            {`$${n0(spent)} of ${budget > 0 ? `$${n0(budget)}` : 'no cap'}${sq.min_spend ? ` · min spend $${n0(sq.min_spend)}` : ''}${sq.stamped ? ' · this seat’s week is stamped — re-score after saving' : ''}`}
          </Mono>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Field value={why} onChangeText={setWhy} maxLength={200} placeholder="why — the league sees this" style={{ flex: 1 }} />
            <Chip on disabled={busy || !why.trim()} label="SET" onPress={() => { tap(); void save(); }} />
          </View>
        </View>
      )}
      {msg && <Mono size={9} tone={msg.startsWith('✓') ? 'you' : 'warn'}>{msg}</Mono>}
    </View>
  );
}
