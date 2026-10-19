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
  contestCoinRules, setContestCoinRules, contestWallets, commishAdjustContestWallet, setContestPlays, type ContestCoinRules, type ContestWalletRow,
  type ContestInfo, type ContestKind, type ContestWeekRow, type CommishContestSquad, type PodSalaryRow, type PrizeRow,
} from '@drip/core/data/liveApi';
import { CONTEST_WORD, CONTEST_EMOJI, CONTEST_LATE_WORD, CONTEST_DEADLINE_WORD, contestLateEntryDefault, contestSquadOf, contestSlotLabels, type ContestLateEntry, type ContestEntryDeadline,
  CONTEST_COIN_EVENTS, CONTEST_COIN_DEFAULTS, CONTEST_COIN_KEYS, coinEventApplies, coinRulesLine, contestPlaysFor } from '@drip/core/engine/contest';
import { classicSlotsFromSpec } from '@drip/core/engine/classic';
import { useTheme } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Mono } from '../ui/prims';
import { LabelInfo, InfoChip } from '../ui/InfoChip';
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

export type ContestCommishPart = 'game' | 'seats' | 'coin' | 'weeks' | 'money' | 'board';
export function ContestCommishCard({ leagueId, onChanged, part = 'game' }: { leagueId: string; onChanged?: () => void; part?: ContestCommishPart }) {
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
  // THE CATEGORIES (v0.693.0) — the web twin's note: one card, six destinations on the map.
  const game = part === 'game', seats = part === 'seats', coinPart = part === 'coin', weeks = part === 'weeks', money = part === 'money', board = part === 'board';
  return (
    <View style={{ gap: 10 }}>
      {game && (
        <Card style={{ gap: 8 }}>
          <LabelInfo label="WINS BY" info={'HIGHEST SCORE — most points wins.\n\nGOLF — lowest score wins; set each spot’s 0 → penalty on ROSTER so a scoreless player costs something.\n\nBULLSEYE — closest to the week’s card wins; the dart scores each spot.\n\nTakes effect from the next week, never while a week is being played.'} />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(['high', 'golf', 'bullseye'] as ContestKind[]).map((c) => (
              <Chip key={c} small on={b.contest === c} disabled={busy} label={`${CONTEST_EMOJI[c]} ${CONTEST_WORD[c]}`} onPress={() => { tap(); void act(setContestRules(leagueId, { contest: c }), `now ${CONTEST_WORD[c].toLowerCase()}`); }} />
            ))}
          </View>
          <LabelInfo label="PLAYS" info={'HEAD-TO-HEAD pairs an even number of seats, up to 32, and the CPU plays an empty seat.\n\nLEADERBOARD ranks everyone each week.\n\nSet once the league has played a week.'} />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip small on={h2h} disabled={busy || played} label="HEAD-TO-HEAD" onPress={() => { tap(); void act(setContestRules(leagueId, { format: 'h2h' }), 'head-to-head'); }} />
            <Chip small on={!h2h} disabled={busy || played} label="LEADERBOARD" onPress={() => { tap(); void act(setContestRules(leagueId, { format: 'board' }), 'leaderboard'); }} />
            {played && <Mono size={8.5} tone="faint">set — a week has been played</Mono>}
          </View>
          <LabelInfo label="BUDGET" info={'Per squad, from the next week. Add or remove spots on ROSTER — a bigger squad wants a bigger budget. NO CAP suits Bullseye: the card does the limiting.'} />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {[...new Set([...CONTEST_BUDGETS, b.budget])].sort((x, y) => x - y).map((v) => (
              <Chip key={v} small on={b.budget === v} disabled={busy} label={moneyChip(v, 'NO CAP')} onPress={() => { tap(); void act(setContestRules(leagueId, { budget: v }), 'budget changed'); }} />
            ))}
          </View>
          <LabelInfo label="MIN SPEND" info={'A floor a squad must spend, from the next week. Golf’s real constraint: cheap no-names can’t be the whole game.'} />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {[...new Set([...CONTEST_MIN_SPENDS, b.min_spend ?? 0])].sort((x, y) => x - y).map((v) => (
              <Chip key={v} small on={(b.min_spend ?? 0) === v} disabled={busy} label={moneyChip(v, 'NONE')} onPress={() => { tap(); void act(setContestRules(leagueId, { minSpend: v }), 'minimum spend changed'); }} />
            ))}
          </View>
          {b.contest === 'bullseye' && (
            <>
              <LabelInfo label="THE CARD" info={'SLOT TARGETS — each spot aims at its own number and scores a ring.\n\nONE TEAM TOTAL — one number for the whole squad; the distance is the score and lower wins.\n\nRADIUS (2–50) is the band for dead-on and the zero penalty.\n\nNot while a week is being played — change it once that week is final.'} />
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {(['slots', 'total'] as const).map((v) => (
                  <Chip key={v} small on={b.variant === v} disabled={busy} label={v === 'slots' ? 'SLOT TARGETS' : 'ONE TEAM TOTAL'} onPress={() => { tap(); void act(setDfsBullseye(leagueId, v, rad), 'card changed'); }} />
                ))}
                <Mono size={9} tone="faint">RADIUS</Mono>
                <Field value={radius} onChangeText={(v) => setRadius(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 60 }} />
                <Chip small on disabled={busy || rad === b.radius} label="SET" onPress={() => { tap(); void act(setDfsBullseye(leagueId, b.variant, rad), 'radius changed'); }} />
              </View>
            </>
          )}
        </Card>
      )}
      {seats && (
        <Card style={{ gap: 8 }}>
          <LabelInfo label="WHO CAN GET IN" info={'How many seats the league holds. Head-to-head wants an even number, 2–32, and an added seat plays as the CPU until someone takes it. A leaderboard holds up to your cap.'} />
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Mono size={9} tone="faint" style={{ flex: 1 }}>{`${h2h ? 'TEAMS · even, 2–32' : `UP TO · 2–${n0(cap)}`} · ${n0(b.seats_taken)} in now`}</Mono>
            <Field value={size} onChangeText={(v) => setSize(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 90 }} />
            <Chip small on disabled={busy || Number(size) === b.max_seats} label="SET" onPress={() => { tap(); void act(setBullseyeSize(leagueId, Number(size) || 0), 'size changed'); }} />
          </View>
          <LabelInfo label="ENTRIES" info={'UNTIL EACH PLAYER’S GAME — a new squad can go in until its players kick off.\n\nBY THE FIRST KICKOFF — not at all once the week’s first game has started.\n\nA saved squad still swaps its unlocked players either way.'} />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(['open', 'first'] as ContestEntryDeadline[]).map((v) => (
              <Chip key={v} small on={(b.entry_deadline ?? 'open') === v} disabled={busy} label={CONTEST_DEADLINE_WORD[v]} onPress={() => { tap(); void act(setContestRules(leagueId, { entryDeadline: v }), v === 'first' ? 'entries close at the first kickoff' : 'entries open until each player’s game'); }} />
            ))}
          </View>
          {!h2h && (
            <>
              <LabelInfo label="ENTRIES PER MEMBER" info={'How many squads one member may field. Each is its own seat on the board, built one at a time on MY TEAM. Head-to-head is always one: an opponent is a person.'} />
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {[...new Set([1, 2, 3, 5, 10, 20, b.max_entries ?? 1])].sort((x, y) => x - y).map((v) => (
                  <Chip key={v} small on={(b.max_entries ?? 1) === v} disabled={busy} label={String(v)} onPress={() => { tap(); void act(setContestRules(leagueId, { maxEntries: v }), `${v} ${v === 1 ? 'entry' : 'entries'} per member`); }} />
                ))}
              </View>
            </>
          )}
          <LabelInfo label="NO SQUAD BY LOCK" info={`A seat with no squad at the week’s first kickoff: ${h2h ? 'the CPU builds one so its opponent has a game, or it forfeits with a zero' : 'the CPU builds one, it scores a zero, or it sits the week out with no row at all'}.${b.contest === 'golf' ? '\n\nIn golf a scoreless squad is the best score, so SCORES ZERO needs every spot’s 0 → penalty set on ROSTER.' : ''}`} />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(h2h ? ['cpu', 'zero'] as ContestLateEntry[] : ['cpu', 'zero', 'drop'] as ContestLateEntry[]).map((v) => (
              <Chip key={v} small on={(b.late_entry ?? contestLateEntryDefault(b.format)) === v} disabled={busy} label={CONTEST_LATE_WORD[v]} onPress={() => { tap(); void act(setContestRules(leagueId, { lateEntry: v }), `a no-show ${CONTEST_LATE_WORD[v].toLowerCase()}`); }} />
            ))}
          </View>
          <LabelInfo label="RULED OUT" info={'Every player locks at his own kickoff, so a ruled-out pick can be swapped until then.\n\nSWAP HIM FOR ME puts the best affordable body in his spot in the minutes before his game if nobody has.\n\nLEAVE IT TO ME banks the zero.'} />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Chip small on={!!b.auto_sub} disabled={busy} label="SWAP HIM FOR ME" onPress={() => { tap(); void act(setContestRules(leagueId, { autoSub: true }), 'auto-sub on'); }} />
            <Chip small on={!b.auto_sub} disabled={busy} label="LEAVE IT TO ME" onPress={() => { tap(); void act(setContestRules(leagueId, { autoSub: false }), 'auto-sub off'); }} />
          </View>
        </Card>
      )}
      {coinPart && (
        <>
          <Card style={{ gap: 8 }}>
            <LabelInfo label="DRIP COIN" info={'Every seat starts with the starting coin and earns each week by the coin rules — for showing up, reading the board and losing, never for winning — and spends it in the shop on plays before kickoff.\n\nTurning it on seeds every seat already in.'} />
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Chip small on={!!b.coin} disabled={busy} label="ON" onPress={() => { tap(); void act(setContestRules(leagueId, { coin: true }), 'drip coin on — every seat seeded'); }} />
              <Chip small on={!b.coin} disabled={busy} label="OFF" onPress={() => { tap(); void act(setContestRules(leagueId, { coin: false }), 'drip coin off'); }} />
            </View>
          </Card>
          {b.coin && <PlaysCard leagueId={leagueId} info={b} />}
          {b.coin && <CoinRulesCard leagueId={leagueId} info={b} />}
          {b.coin && <PursesCard leagueId={leagueId} />}
        </>
      )}
      {weeks && (
        <>
          {h2h && b.span === 'season' && (
            <Card style={{ gap: 6 }}>
              <LabelInfo label="PLAYOFFS" info={'A season head-to-head league plays a bracket over its last weeks — four teams from week 15 unless you say otherwise, seeded by the regular-season standings; everyone else plays a consolation ladder. The round-robin stops where the bracket starts.'} />
              <PlayoffControls leagueId={leagueId} onChanged={() => void load()} />
            </Card>
          )}
          {played ? <ContestFixWeekCard leagueId={leagueId} /> : (
            <Card style={{ gap: 6 }}>
              <LabelInfo label="FIX A WEEK" info={'Once a week has been played: void it, restore it, correct a stat on the board, set a seat’s squad, or re-score it — the result card rebuilds.'} />
              <Mono size={8.5} tone="faint">No week played yet.</Mono>
            </Card>
          )}
        </>
      )}
      {money && (
        <Card style={{ gap: 6 }}>
          <LabelInfo label="DUES & PRIZES" info={'What a seat costs and what the places win. The platform prints it and never collects it; both show on the league’s SETTINGS and on the league board.'} />
          <DuesCard leagueId={leagueId} />
          <PrizesEditor leagueId={leagueId} prizes={b.prizes ?? []} onSaved={() => void load()} />
        </Card>
      )}
      {board && (
        <Card style={{ gap: 8 }}>
          <LabelInfo label="THE LEAGUE BOARD" info={'Post the league where anyone can find it, with a blurb and the dues (printed, never collected). A one-week league leaves the board once its week kicks off.'} />
          <Field value={blurb} onChangeText={setBlurb} maxLength={200} multiline placeholder="Blurb (optional)" />
          <Field value={dues} onChangeText={setDues} maxLength={120} placeholder="Dues (optional)" />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip on disabled={busy} label={listed ? 'UPDATE THE POST' : 'POST IT TO THE BOARD'} onPress={() => { tap(); void act(postLeagueListing(leagueId, blurb.trim() || null, dues.trim()), listed ? 'board post updated' : 'posted to the board').then((ok) => { if (ok) setListed(true); }); }} />
            {listed && <Chip disabled={busy} label="TAKE IT DOWN" onPress={() => { tap(); void act(closeLeagueListing(leagueId), 'taken off the board').then((ok) => { if (ok) setListed(false); }); }} />}
            <Mono size={8.5} tone="faint">{listed ? 'on the board' : 'not on the board'}</Mono>
          </View>
        </Card>
      )}
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
      <Mono size={8.5} tone="faint">One seat’s squad for this week, past the kickoff locks. Leave a spot — empty — to unset it and the member picks again. The budget and each spot’s rules still apply. The league is told who came in and who went out, with your reason.</Mono>
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
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Chip small disabled={busy || defs.every((d) => !picks[d.slot])} label="UNSET ALL" onPress={() => { tap(); setPicks(Object.fromEntries(defs.map((d) => [d.slot, null]))); setOpen(null); }} />
          </View>
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

// ── THE COIN RULES (v0.692.0) — the web twin's note ─────────────────────────
function CoinRulesCard({ leagueId, info }: { leagueId: string; info: ContestInfo }) {
  const [rules, setRules] = useState<ContestCoinRules | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const take = (r: ContestCoinRules) => { setRules(r); setDraft(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))); };
  useEffect(() => {
    contestCoinRules(leagueId).then((r) => { if (r.ok && r.rules) take(r.rules); else setNote(r.error ?? 'Couldn’t read the coin rules.'); }).catch((e) => setNote(friendlyError(e)));
  }, [leagueId]);
  const shape = { format: info.format, contest: info.contest, span: info.span };
  const num = (k: string) => Math.max(0, Math.min(100000, Math.round(Number(draft[k] ?? rules?.[k] ?? 0) || 0)));
  const dirty = !!rules && CONTEST_COIN_KEYS.some((k) => num(k) !== rules[k]);
  const save = async (next: ContestCoinRules, done: string) => {
    setBusy(true); setNote(null);
    try {
      const r = await setContestCoinRules(leagueId, next);
      if (!r.ok || !r.rules) { warn(); setNote(r.error ?? 'Couldn’t save the coin rules.'); return; }
      commit(); take(r.rules); setNote(done);
    } catch (e) { warn(); setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  if (!rules) return <Card style={{ gap: 6 }}><Mono size={9} tone="faint" weight="700" track={0.1}>COIN RULES</Mono><Mono size={8.5} tone="faint">{note ?? 'loading…'}</Mono></Card>;
  const groups = [...new Set(CONTEST_COIN_EVENTS.map((e) => e.group))];
  return (
    <Card style={{ gap: 8 }}>
      <LabelInfo label="COIN RULES" info={'The standard suite, yours to change: coin per event. 0 turns an event off; the ceiling at 0 is no ceiling. The allowance pays every seat every week, whatever happened.\n\nChanges reach the league chat and apply from the next week that settles. STANDARD SUITE puts every number back.'} />
      {groups.map((g) => (
        <View key={g} style={{ gap: 6 }}>
          <Mono size={8.5} tone="faint" weight="700" track={0.08}>{g.toUpperCase()}</Mono>
          {CONTEST_COIN_EVENTS.filter((e) => e.group === g).map((e) => {
            const on = coinEventApplies(e, shape);
            return (
              <View key={e.id} style={{ gap: 3, opacity: on ? 1 : 0.45 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Mono size={10} tone="text" weight="700" style={{ minWidth: 120 }}>{e.name}</Mono>
                  <InfoChip title={e.name}>{e.blurb}</InfoChip>
                  <Mono size={9} tone="faint">◎</Mono>
                  <Field value={draft[e.id] ?? ''} editable={!busy} keyboardType="number-pad" onChangeText={(v) => setDraft((d) => ({ ...d, [e.id]: v.replace(/[^0-9]/g, '') }))} style={{ width: 70, paddingVertical: 5 }} />
                  <Mono size={8.5} tone="faint">{e.unit === 'once' ? 'once' : e.unit === 'week' ? 'a week' : e.unit === 'ceiling' ? 'ceiling' : e.unit}</Mono>
                  {e.capId && (
                    <>
                      <Mono size={8.5} tone="faint">up to ◎</Mono>
                      <Field value={draft[e.capId] ?? ''} editable={!busy} keyboardType="number-pad" onChangeText={(v) => setDraft((d) => ({ ...d, [e.capId!]: v.replace(/[^0-9]/g, '') }))} style={{ width: 70, paddingVertical: 5 }} />
                    </>
                  )}
                </View>
                {(!on || rules[e.id] !== CONTEST_COIN_DEFAULTS[e.id]) && <Mono size={8.5} tone="faint">{[on ? null : 'not this league’s shape', rules[e.id] !== CONTEST_COIN_DEFAULTS[e.id] ? `standard ◎${CONTEST_COIN_DEFAULTS[e.id]}` : null].filter(Boolean).join(' · ')}</Mono>}
              </View>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip small on={dirty} dim={!dirty} disabled={busy || !dirty} label="SAVE RULES" onPress={() => { tap(); void save(Object.fromEntries(CONTEST_COIN_KEYS.map((k) => [k, num(k)])), 'coin rules saved — the league was told'); }} />
        <Chip small disabled={busy} label="STANDARD SUITE" onPress={() => { tap(); void save({}, 'back to the standard suite'); }} />
      </View>
      {note && <Mono size={8.5} tone="dim">{note}</Mono>}
      <Mono size={8.5} tone="faint">{`As this league plays it: ${coinRulesLine(rules, shape)}.`}</Mono>
    </Card>
  );
}

// THE PURSES (v0.692.0): every seat's coin, and the commissioner's hand on one.
function PursesCard({ leagueId }: { leagueId: string }) {
  const [rows, setRows] = useState<ContestWalletRow[] | null>(null);
  const [amount, setAmount] = useState('10');
  const [why, setWhy] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => contestWallets(leagueId).then((r) => { if (r.ok && r.rows) setRows(r.rows); else setNote(r.error ?? 'Couldn’t read the purses.'); }).catch((e) => setNote(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const move = async (row: ContestWalletRow, sign: 1 | -1) => {
    const n = Math.round(Number(amount) || 0);
    if (!n) { warn(); setNote('type an amount first'); return; }
    setBusy(true); setNote(null);
    try {
      const r = await commishAdjustContestWallet(leagueId, row.roster_id, sign * n, why.trim() || null);
      if (!r.ok) { warn(); setNote(r.error ?? 'Couldn’t change the purse.'); return; }
      commit(); setNote(`${row.team}: ◎${r.coins ?? '?'} now — the league was told`); await load();
    } catch (e) { warn(); setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Card style={{ gap: 8 }}>
      <LabelInfo label="PURSES" info={'Every seat’s coin. Type an amount and a note, then GIVE or TAKE on a seat; the league chat hears each one.'} />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Mono size={9} tone="faint">AMOUNT ◎</Mono>
        <Field value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 80, paddingVertical: 5 }} />
        <Field value={why} onChangeText={setWhy} maxLength={120} placeholder="Why (goes in the chat, optional)" style={{ flex: 1, minWidth: 160, paddingVertical: 5 }} />
      </View>
      {rows === null ? <Mono size={8.5} tone="faint">loading…</Mono> : rows.length === 0 ? <Mono size={8.5} tone="faint">No seats yet.</Mono> : rows.map((r) => (
        <View key={r.roster_id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Mono size={10} tone={r.human ? 'text' : 'faint'} weight="700" style={{ flex: 1, minWidth: 100 }}>{`${r.team}${r.human ? '' : ' · CPU'}`}</Mono>
          <Mono size={11} tone="you" weight="700">{`◎ ${Math.round(r.coins)}`}</Mono>
          <Chip small disabled={busy} label="GIVE" onPress={() => { tap(); void move(r, 1); }} />
          <Chip small dim disabled={busy} label="TAKE" onPress={() => { tap(); void move(r, -1); }} />
        </View>
      ))}
      {note && <Mono size={8.5} tone="dim">{note}</Mono>}
    </Card>
  );
}

// THE PLAYS, ON AND OFF (v0.694.0) — the web twin's note.
function PlaysCard({ leagueId, info }: { leagueId: string; info: ContestInfo }) {
  const [off, setOff] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    contestCoinRules(leagueId).then((r) => { if (r.ok) setOff(r.plays_off ?? []); else setNote(r.error ?? 'Couldn’t read the plays.'); }).catch((e) => setNote(friendlyError(e)));
  }, [leagueId]);
  const flip = async (id: string, on: boolean) => {
    if (!off) return;
    const next = on ? off.filter((x) => x !== id) : [...new Set([...off, id])];
    setBusy(true); setNote(null);
    try {
      const r = await setContestPlays(leagueId, next);
      if (!r.ok) { warn(); setNote(r.error ?? 'Couldn’t change the plays.'); return; }
      commit(); setOff(r.plays_off ?? next); setNote(`${on ? 'on' : 'off'} — the league was told`);
    } catch (e) { warn(); setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const plays = contestPlaysFor(info.format, info.contest);
  return (
    <Card style={{ gap: 8 }}>
      <LabelInfo label="PLAYS" info={'The power-ups the shop sells in this league. Turn one off and it leaves the shop and cannot be played; a card already in a hand waits until it is back on. The league chat hears each change.'} />
      {off === null ? <Mono size={8.5} tone="faint">{note ?? 'loading…'}</Mono> : plays.map((d) => {
        const on = !off.includes(d.id);
        return (
          <View key={d.id} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Mono size={10} tone={on ? 'text' : 'faint'} weight="700" style={{ flex: 1, minWidth: 110 }}>{`${d.icon} ${d.name}`}</Mono>
            <InfoChip title={d.name}>{`${d.blurb}\n\n◎${d.price} in the shop.`}</InfoChip>
            <Mono size={8.5} tone="faint">{`◎${d.price}`}</Mono>
            <Chip small on={on} disabled={busy} label="ON" onPress={() => { tap(); void flip(d.id, true); }} />
            <Chip small on={!on} disabled={busy} label="OFF" onPress={() => { tap(); void flip(d.id, false); }} />
          </View>
        );
      })}
      {note && off !== null && <Mono size={8.5} tone="dim">{note}</Mono>}
    </Card>
  );
}
