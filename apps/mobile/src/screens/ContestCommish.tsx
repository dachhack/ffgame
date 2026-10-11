// THE CONTEST CARD, native (v0.664.0) — the web twin's note
// (src/screens/ContestCommish.tsx). The commissioner's map destination that
// is a contest league's own: what wins, how it plays, the budget, the
// Bullseye card, the size, the league board.
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import {
  contestLeague, setContestRules, setDfsBullseye, setBullseyeSize, postLeagueListing, closeLeagueListing, leagueListingState,
  isAdmin, myFeatures, bullseyeMaxSeats, friendlyError,
  type ContestInfo, type ContestKind,
} from '@drip/core/data/liveApi';
import { CONTEST_WORD, CONTEST_EMOJI } from '@drip/core/engine/contest';
import { useTheme } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Mono } from '../ui/prims';

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
      {note && <Mono size={10} tone={note.startsWith('✓') ? 'you' : 'warn'}>{note}</Mono>}
    </View>
  );
}
