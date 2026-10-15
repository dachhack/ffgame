// THE ROSTER SETTINGS, SPLIT THREE WAYS (v0.714.0). Founder: "We have several
// roster features: Roster Construction, Eligible Players, Per Manager Roster
// Constraints, let's have those be separate areas in the commish settings" —
// and of COPIES: "That's a players option that should be in the commish
// settings". Two cards the split needed a home for:
//
//   • CopiesCard (ELIGIBLE PLAYERS) — copies of every player (0500), which
//     lived in the draft room's setup. It locks when the draft starts.
//   • RosterCapsCard — the position limits (MANAGER ROSTER RULES) and, for a
//     drip league, the roster size (ROSTER CONSTRUCTION). Both lived inside
//     the WAIVERS & TRADES sheet, where nobody looked for them.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { draftState, leagueContracts, setLeagueCopies, rosterRules, setRosterRules, POS_CAP_KEYS, friendlyError, type PosCaps } from '@drip/core/data/liveApi';
import { useTheme, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Chip, Mono, PrimaryButton } from './prims';
import { LabelInfo } from './InfoChip';

const box = (bd: string) => ({ marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: bd, borderRadius: 6, padding: 8 });

/** COPIES OF EVERY PLAYER (0500): 1–4, each copy on a different team. Set
 *  before the draft; it locks when the draft starts. Not with an auction or
 *  salaries (the server also refuses devy, guillotine, vampire, a shotgun
 *  wedding — its message says which). */
export function CopiesCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<{ copies: number; status: string; mode: string } | null>(null);
  const [contracts, setContracts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => draftState(leagueId).then((d) => { if (d && !d.error) setSt({ copies: d.copies ?? 1, status: d.status, mode: d.mode }); }).catch(() => {});
  useEffect(() => {
    void load();
    leagueContracts(leagueId).then((c) => setContracts(!!c.contracts)).catch(() => {});
  }, [leagueId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return null;
  const locked = st.status !== 'pending';
  const unavailable = contracts ? 'not with salaries' : st.mode === 'auction' ? 'not with an auction draft — switch it to snake or linear' : null;
  const pick = async (n: number) => {
    if (busy || n === st.copies) return;
    tap(); setBusy(true); setMsg(null);
    try {
      const r = await setLeagueCopies(leagueId, n);
      if (r.ok) { commit(); setSt({ ...st, copies: n }); setMsg(n === 1 ? '✓ one copy of each player' : `✓ ${n} copies of each player`); }
      else { warn(); setMsg(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <View style={box(t.bd)}>
      <LabelInfo label="COPIES OF EVERY PLAYER" title="Copies of every player"
        info={'How many teams can roster the same player. At 2, two different teams can each draft or add him; a team never holds two of him. For big leagues where one pool runs thin.\n\nSet before the draft — it locks when the draft starts. Not offered with an auction, salaries, devy, guillotine, vampire or a shotgun wedding.'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {[1, 2, 3, 4].map((n) => (
          <Chip key={n} small label={String(n)} on={st.copies === n} disabled={busy || locked || !!unavailable} onPress={() => void pick(n)} />
        ))}
        {locked && <Mono size={8.5} tone="faint">🔒 locked — the draft has started</Mono>}
        {!locked && unavailable && <Mono size={8.5} tone="faint">{unavailable}</Mono>}
      </View>
      {!!msg && <Mono size={8.5} tone={msg.startsWith('✓') ? 'you' : 'warn'} style={{ marginTop: 5 }}>{msg}</Mono>}
    </View>
  );
}

/** Position limits (any time) and — `size` — the roster size (before the
 *  draft). A classic league's size is its spots plus bench/taxi/IR, set by the
 *  ROSTER CONSTRUCTION builder, so it asks only for the limits. */
export function RosterCapsCard({ leagueId, part }: { leagueId: string; part: 'caps' | 'size' }) {
  const t = useTheme();
  const [caps, setCaps] = useState<PosCaps | null>(null);
  const [capsInit, setCapsInit] = useState<PosCaps | null>(null);
  const [rounds, setRounds] = useState<number | null>(null);
  const [roundsInit, setRoundsInit] = useState<number | null>(null);
  const [preDraft, setPreDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    rosterRules(leagueId).then((r) => {
      if (!r || r.error) return;
      const pc = r.pos_caps ?? ({} as PosCaps);
      setCaps({ ...pc }); setCapsInit({ ...pc });
      setRounds(r.rounds ?? null); setRoundsInit(r.rounds ?? null);
      setPreDraft(r.draft_status === 'pending');
    }).catch((e) => setMsg(friendlyError(e)));
  }, [leagueId]);
  if (!caps) return null;
  // ∞ → 0 → 1 … 8 → ∞: one tap per step beats a stepper for nine states.
  const cycleCap = (k: keyof PosCaps) => {
    const cur = caps[k] ?? null;
    setCaps({ ...caps, [k]: cur === null ? 0 : cur >= 8 ? null : cur + 1 });
  };
  const capsChanged = !!capsInit && POS_CAP_KEYS.some((k) => (caps[k] ?? null) !== (capsInit[k] ?? null));
  const roundsChanged = rounds !== roundsInit;
  const dirty = part === 'caps' ? capsChanged : roundsChanged;
  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true); setMsg(null);
    try {
      const r = await setRosterRules(leagueId, part === 'size' ? rounds : null, part === 'caps' ? caps : null);
      if (r.ok) { commit(); setCapsInit({ ...caps }); setRoundsInit(rounds); setMsg(part === 'caps' ? '✓ position limits saved' : '✓ roster size saved'); }
      else { warn(); setMsg(friendlyError(r.error ?? 'save failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <View style={box(t.bd)}>
      {part === 'size' ? (
        <>
          <LabelInfo label="ROSTER SIZE" title="Roster size"
            info={'How many players each team holds — the draft fills it. Set before the draft; it locks when the draft starts.'} />
          {preDraft ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {[7, 9, 12, 14, 16, 20, 25, 30, 40].map((n) => (
                <Chip key={n} small label={String(n)} on={rounds === n} onPress={() => { tap(); setRounds(n); }} />
              ))}
            </View>
          ) : <Mono size={8.5} tone="faint" style={{ marginTop: 6 }}>{`${rounds ?? '—'} · 🔒 locked — the draft has started`}</Mono>}
        </>
      ) : (
        <>
          <LabelInfo label="POSITION LIMITS" title="Position limits"
            info={'The most of a position one team may hold. Tap a position to cycle its limit: ∞ → 0 → 1 … 8 → ∞.\n\nEnforced at the draft, free agency, waivers and auction bids. A roster already over a lowered limit keeps its players — the limit blocks new adds. Adjustable any time.'} />
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {POS_CAP_KEYS.map((k) => (
              <Chip key={k} small label={`${k} ${caps[k] ?? '∞'}`} on={(caps[k] ?? null) !== null} onPress={() => { tap(); cycleCap(k); }} />
            ))}
          </View>
        </>
      )}
      {(dirty || busy) && (
        <View style={{ marginTop: 8 }}>
          <PrimaryButton label={busy ? '…' : part === 'caps' ? 'SAVE LIMITS' : 'SAVE SIZE'} disabled={busy} onPress={() => void save()} />
        </View>
      )}
      {!!msg && <Mono size={8.5} tone={msg.startsWith('✓') ? 'you' : 'warn'} style={{ marginTop: 5, lineHeight: fs(12) }}>{msg}</Mono>}
    </View>
  );
}
