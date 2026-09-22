// League settings, for the commissioner's thumb — waivers, FAAB, run times,
// free agency, trade review, and whether the league is public on the board.
//
// The rules half mirrors the web's TransactionRulesEditor (AdminPage), down to
// its changed-fields-only save: set_transaction_rules resets EVERY seat's FAAB
// balance when mode or budget arrives, so sending an unchanged budget is not
// harmless — it wipes season spending. Send null for anything untouched.
// The -1 sentinels are the server's CLEAR codes: clear time -1 → rolling 24h,
// FA start -1 → always open.
//
// Visibility is the 0123 board pair (post/close) behind one switch, with
// league_listing_state (0124) as the read — league_board() hides full leagues,
// so it cannot tell a commissioner whether their league is actually listed.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  closeLeagueListing, friendlyError,
  leagueListingState, postLeagueListing, rosterRules, setRosterRules, setTransactionRules, POS_CAP_KEYS,
  setPickTrading as setPickTradingRpc, pickAssets,
  type PosCaps, type TradeReview, type WaiverMode, type FaMode,
} from '@drip/core/data/liveApi';
import { DAY_LABEL, DEFAULT_WAIVER_DAYS, WAIVER_MODE_HINT, WAIVER_MODE_LABEL,
  nextWaiverMode, waiverDaysOf, normalizeWaiverDays, effectiveGameHoldDow,
  holdLine, waiverConflicts, etTime, type WaiverDayMode } from '@drip/core/data/waiverDays';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Chip, LinkButton, Mono, Notice, PrimaryButton } from './prims';
import { PlayoffControls } from './LeagueExtras';
import { Overlay } from './Overlay';

/** Minutes-since-midnight-ET → "3:30am". */
function fmtEt(m: number): string {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`;
}
const STEP = 30; // the schedule knobs move in half-hours, like the web's selects
const wrap = (m: number) => ((m % 1440) + 1440) % 1440;

/** −/＋ stepper over a time of day (ET). */
function TimeStep({ label, value, onChange }: { label: string; value: number; onChange: (m: number) => void }) {
  const t = useTheme();
  const btn = (txt: string, d: number) => (
    <Text
      onPress={() => { tap(); onChange(wrap(value + d)); }}
      style={{ fontFamily: MONO, fontSize: fs(15), fontWeight: '700', color: t.you, paddingHorizontal: 12, paddingVertical: 4 }}
    >{txt}</Text>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Mono size={9} tone="faint" style={{ width: 46 }}>{label}</Mono>
      {btn('−', -STEP)}
      <Text style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: '700', color: t.text, width: 72, textAlign: 'center' }}>{fmtEt(value)} ET</Text>
      {btn('＋', STEP)}
    </View>
  );
}

interface Rules {
  mode: WaiverMode; budget: number; review: TradeReview;
  clearMin: number | null; days: WaiverDayMode[]; gameHold: number | null;
  holdDays: number; faStart: number | null; faEnd: number | null;
  faMode: FaMode;
  agentWaivers: boolean;
  /** 0319: the FAAB floor, the days free agency may open (null = every
   *  day), the trade deadline week (null = none). */
  minBid: number; deadline: number | null;
}

export function CommishSettings({ visible, leagueId, onClose, onSaved, view = 'waivers' }: {
  visible: boolean; leagueId: string; onClose: () => void;
  /** Rules or visibility changed — the team screen should re-read. */
  onSaved: () => void;
  /** Which slice this sheet shows (v0.264.0): the old monolithic ⚑ SETTINGS
   *  overlay folded into the commish chip map — each destination opens as its
   *  own bottom sheet, mirroring the web console's sections. */
  view?: 'waivers' | 'playoffs' | 'board';
}) {
  const t = useTheme();
  const [init, setInit] = useState<Rules | null>(null);
  const [mode, setMode] = useState<WaiverMode>('rolling');
  const [budgetDraft, setBudgetDraft] = useState('100');
  const [review, setReview] = useState<TradeReview>('none');
  // The pick-trading switch (0190) — saved on the tap, not with SAVE RULES.
  const [pickTrading, setPickTrading_] = useState(true);
  const setPickTrading = setPickTrading_;
  const [pickNote, setPickNote] = useState<string | null>(null);
  const [clearMin, setClearMin] = useState<number | null>(null);   // null = rolling 24h
  // 0337: ONE SCHEDULE. The run's days, free agency's days and the days adds
  // waited for the run were three pickers answering one question; this is that
  // question, once per day, in four words.
  const [days, setDays] = useState<WaiverDayMode[]>([...DEFAULT_WAIVER_DAYS]);
  const [gameHold, setGameHold] = useState<number | null>(3);      // after-games morning; null = none
  const [holdDays, setHoldDays] = useState(1);
  const [agentWaivers, setAgentWaivers] = useState(true);
  const [faStart, setFaStart] = useState<number | null>(null);     // null = always open
  // 0287: the window said open-or-hours; the MODE can also say none at all.
  const [faMode, setFaMode] = useState<FaMode>('open');
  const [faEnd, setFaEnd] = useState<number | null>(null);
  const [minBidDraft, setMinBidDraft] = useState('0');

  const [deadline, setDeadline] = useState<number | null>(null);  // trade deadline week; null = none
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const [listed, setListed] = useState<boolean | null>(null);      // null = still loading
  const [blurbDraft, setBlurbDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Roster rules (0071): position caps any time; roster size pre-draft only.
  const [caps, setCaps] = useState<PosCaps | null>(null);
  const [capsInit, setCapsInit] = useState<PosCaps | null>(null);
  const [rounds, setRounds] = useState<number | null>(null);
  const [roundsInit, setRoundsInit] = useState<number | null>(null);
  const [preDraft, setPreDraft] = useState(false);

  // ── THE WAIVER SHEET, READ AS THIS LEAGUE IS CONFIGURED (0338) ────────────
  // Founder: "looks like the three waiver selections can conflict with the
  // daily schedule?" They could. The three readings below are core's, shared
  // with the web console and the rulebook and pinned by check:waiverdays, so
  // this sheet cannot describe the league differently from the database that
  // runs it — which is the complaint, one storey up from 0337's.
  const shownDays = normalizeWaiverDays(days, clearMin);
  const effGameHold = effectiveGameHoldDow(shownDays, gameHold);
  const conflicts = waiverConflicts({ days, clearMin, holdDays, gameHoldDow: gameHold, faMode, faStart, faEnd });

  useEffect(() => {
    if (!visible) return;
    setMsg(null);
    rosterRules(leagueId).then((r) => {
      if (r.error || !r.ok) { setMsg(friendlyError(r.error ?? 'could not load rules')); return; }
      const cur: Rules = {
        mode: r.waiver_mode ?? 'rolling', budget: r.faab_budget ?? 100, review: r.trade_review ?? 'none',
        clearMin: r.waiver_clear_min ?? null,
        days: waiverDaysOf(r.waiver_days),
        gameHold: r.waiver_game_hold_dow ?? null,
        holdDays: r.waiver_hold_days ?? 1,
        faStart: r.fa_start_min ?? null, faEnd: r.fa_end_min ?? null,
        // Absent reads from the hours, exactly as league_fa_mode does, so a
        // league that predates 0287 shows what it has always done.
        faMode: r.fa_mode ?? (r.fa_start_min != null ? 'window' : 'open'),
        // Absent means ON (0213) — the same default league_agent_waivers
        // applies, spelled once here so the switch can never render the
        // opposite of what the worker will do.
        agentWaivers: r.agent_waivers !== false,
        minBid: r.faab_min_bid ?? 0,

        deadline: r.trade_deadline_week ?? null,
      };
      setInit(cur); setMode(cur.mode); setBudgetDraft(String(cur.budget)); setReview(cur.review);
      pickAssets(leagueId).then((a) => { if (a.ok) setPickTrading(a.pick_trading !== false); }).catch(() => {});
      setClearMin(cur.clearMin); setDays(cur.days); setGameHold(cur.gameHold); setHoldDays(cur.holdDays); setFaStart(cur.faStart); setFaEnd(cur.faEnd); setFaMode(cur.faMode);
      setAgentWaivers(cur.agentWaivers);
      setMinBidDraft(String(cur.minBid)); setDeadline(cur.deadline); setDeadlinePassed(r.trade_deadline_passed === true);
      const pc = r.pos_caps ?? ({} as PosCaps);
      setCaps({ ...pc }); setCapsInit({ ...pc });
      setRounds(r.rounds ?? null); setRoundsInit(r.rounds ?? null);
      setPreDraft(r.draft_status === 'pending');
    }).catch((e) => setMsg(friendlyError(e)));
    leagueListingState(leagueId).then((r) => {
      if (r.ok) { setListed(!!r.listed); setBlurbDraft(r.blurb ?? ''); }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leagueId]);

  const budget = Math.max(1, parseInt(budgetDraft || '0', 10) || 0);
  const minBid = Math.max(0, parseInt(minBidDraft || '0', 10) || 0);

  const save = async () => {
    if (!init || busy) return;
    setBusy(true); setMsg(null);
    try {
      const clearChanged = clearMin !== init.clearMin;
      const faChanged = faStart !== init.faStart || faEnd !== init.faEnd;
      const daysChanged = days.join(',') !== init.days.join(',');
      const r = await setTransactionRules(leagueId,
        mode !== init.mode ? mode : null,
        mode === 'faab' && budget !== init.budget ? budget : null,
        null,   // 0321: trade review lives in TRADE FLOOR, which saves on the tap
        clearChanged ? (clearMin ?? -1) : null,
        holdDays !== init.holdDays ? holdDays : null,
        faChanged ? (faStart ?? -1) : null,
        faChanged ? (faEnd ?? -1) : null,
        null,   // 0337: the run's days are the schedule now
        null,   // …and so are the days adds wait for it
        agentWaivers !== init.agentWaivers ? agentWaivers : null,
        faMode !== init.faMode ? faMode : null,
        mode === 'faab' && minBid !== init.minBid ? minBid : null,
        null,   // …and the days free agency may open
        deadline !== init.deadline ? (deadline ?? -1) : null,
        daysChanged ? days : null,
        gameHold !== init.gameHold ? (gameHold ?? -1) : null);
      if (r.ok) {
        commit();
        setInit({ mode, budget, review, clearMin, days, gameHold, holdDays, faStart, faEnd, faMode, agentWaivers, minBid, deadline });
        setMsg('✓ saved'); onSaved();
      } else { warn(); setMsg(friendlyError(r.error ?? 'save failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const setVisibility = async (pub: boolean) => {
    if (busy || listed === null || pub === listed) return;
    setBusy(true); setMsg(null);
    try {
      const r = pub
        ? await postLeagueListing(leagueId, blurbDraft.trim() || null)
        : await closeLeagueListing(leagueId);
      if (r.ok) { commit(); setListed(pub); setMsg(pub ? '✓ on the board' : '✓ private — invite only'); onSaved(); }
      else { warn(); setMsg(friendlyError(r.error ?? 'could not change visibility')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const saveBlurb = async () => {
    if (busy || !listed) return;
    setBusy(true); setMsg(null);
    try {
      const r = await postLeagueListing(leagueId, blurbDraft.trim() || null);
      if (r.ok) { commit(); setMsg('✓ pitch updated'); } else { warn(); setMsg(friendlyError(r.error ?? 'could not update')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };

  // Cycle a position cap: ∞ → 0 → 1 … 8 → ∞. One tap per step beats a stepper
  // pair for a value with nine states and no typing.
  const cycleCap = (k: keyof PosCaps) => {
    if (!caps) return;
    const cur = caps[k] ?? null;
    const next = cur === null ? 0 : cur >= 8 ? null : cur + 1;
    setCaps({ ...caps, [k]: next });
  };
  const capsChanged = caps && capsInit && POS_CAP_KEYS.some((k) => (caps[k] ?? null) !== (capsInit[k] ?? null));
  const roundsChanged = rounds !== roundsInit;
  const saveRoster = async () => {
    if (busy || !caps) return;
    setBusy(true); setMsg(null);
    try {
      const r = await setRosterRules(leagueId, roundsChanged ? rounds : null, capsChanged ? caps : null);
      if (r.ok) { commit(); setCapsInit({ ...caps }); setRoundsInit(rounds); setMsg('✓ roster rules saved'); onSaved(); }
      else { warn(); setMsg(friendlyError(r.error ?? 'save failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const sec = (label: string) => <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>{label}</Mono>;
  const changed = init && (mode !== init.mode || (mode === 'faab' && budget !== init.budget) || review !== init.review
    || clearMin !== init.clearMin || holdDays !== init.holdDays || faStart !== init.faStart || faEnd !== init.faEnd
    || agentWaivers !== init.agentWaivers || faMode !== init.faMode
    || (mode === 'faab' && minBid !== init.minBid) || deadline !== init.deadline
    || days.join(',') !== init.days.join(',') || gameHold !== init.gameHold);

  const heads = {
    waivers: { title: '⇄ Waivers & trades', sub: 'Waiver system, free agency, trade review, roster rules.' },
    playoffs: { title: '🏆 Playoffs', sub: 'Bracket size, start week, seeding.' },
    board: { title: '📣 League board', sub: 'Public listing + the pitch recruits see.' },
  } as const;

  return (
    <Overlay visible={visible} title={heads[view].title} subtitle={heads[view].sub} onClose={onClose}>
      <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
      {view === 'waivers' && !init && !msg && <Mono size={10} tone="faint">Loading the rules…</Mono>}
      {!!msg && (
        <Notice tone={msg.startsWith('✓') ? 'you' : 'opp'}>
          <Mono size={10} tone={msg.startsWith('✓') ? 'you' : 'opp'}>{msg}</Mono>
        </Notice>
      )}

      {view === 'playoffs' && (
        <View style={{ marginTop: 2 }}>
          <PlayoffControls leagueId={leagueId} onChanged={onSaved} />
        </View>
      )}

      {view === 'board' && (listed === null ? (
        <Mono size={9.5} tone="faint" style={{ marginTop: 6 }}>Loading…</Mono>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Chip label="🔒 PRIVATE — INVITE ONLY" on={!listed} onPress={() => void setVisibility(false)} />
            <Chip label="🔎 PUBLIC ON THE BOARD" on={listed} onPress={() => void setVisibility(true)} />
          </View>
          <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(13) }}>
            {listed
              ? 'Anyone browsing the league board can take an open seat. It comes off the board the moment you go private or the seats fill.'
              : 'Only people you hand the invite code to can join — share it from the RECRUIT button.'}
          </Mono>
          {listed && (
            <View style={{ marginTop: 8 }}>
              <TextInput value={blurbDraft} maxLength={280} multiline placeholder="The pitch shown on the board…" placeholderTextColor={t.faint}
                onChangeText={setBlurbDraft}
                style={{ minHeight: 56, textAlignVertical: 'top', borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(12.5), color: t.text, backgroundColor: t.bg }} />
              <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
                <LinkButton label="update pitch" tone="you" onPress={() => void saveBlurb()} />
              </View>
            </View>
          )}
        </>
      ))}

      {view === 'waivers' && init && (
        <>
          {sec('WAIVER SYSTEM')}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Chip label="ROLLING" on={mode === 'rolling'} onPress={() => { tap(); setMode('rolling'); }} />
            <Chip label="REVERSE STANDINGS" on={mode === 'standings'} onPress={() => { tap(); setMode('standings'); }} />
            <Chip label="💰 FAAB" on={mode === 'faab'} onPress={() => { tap(); setMode('faab'); }} />
          </View>
          <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: fs(13) }}>
            {mode === 'rolling' ? 'A queue: winning a claim sends you to the back.'
              : mode === 'standings' ? 'The common default: priority is the reverse of the live standings at every clear — winning a claim costs nothing, only winning games does.'
              : 'Blind bids from a season budget; highest bid wins, only the winner pays.'}
          </Mono>
          {mode === 'faab' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Mono size={9} tone="faint">SEASON BUDGET $</Mono>
              <TextInput value={budgetDraft} keyboardType="number-pad" onChangeText={(v) => setBudgetDraft(v.replace(/\D/g, ''))}
                style={{ width: 76, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: fs(13), color: t.text, backgroundColor: t.bg }} />
            </View>
          )}
          {mode === 'faab' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Mono size={9} tone="faint">MINIMUM BID $</Mono>
              <TextInput value={minBidDraft} keyboardType="number-pad" onChangeText={(v) => setMinBidDraft(v.replace(/\D/g, ''))}
                style={{ width: 76, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: fs(13), color: t.text, backgroundColor: t.bg }} />
              <Mono size={8.5} tone="faint">{minBid === 0 ? '$0 claims allowed' : 'a claim below this is refused'}</Mono>
            </View>
          )}
          {init.mode !== mode || (mode === 'faab' && budget !== init.budget) ? (
            <Mono size={8.5} tone="warn" style={{ marginTop: 6, lineHeight: fs(13) }}>
              Changing the system or the budget hands every team a fresh full balance — season spending so far is forgotten.
            </Mono>
          ) : null}

          {sec('WAIVERS CLEAR')}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Chip label="ROLLING 24H" on={clearMin === null} onPress={() => { tap(); setClearMin(null); }} />
            <Chip label={clearMin !== null ? `DAILY AT ${fmtEt(clearMin)} ET` : 'DAILY AT A SET TIME'} on={clearMin !== null}
              onPress={() => { tap(); if (clearMin === null) setClearMin(180); }} />
          </View>
          {clearMin !== null && (
            <View style={{ marginTop: 8 }}>
              <TimeStep label="CLEAR" value={clearMin} onChange={setClearMin} />
            </View>
          )}
          {/* 0337: THE WEEKLY SCHEDULE — one mode a day. Tapping a day rings
              through the modes THIS league can say (0338: three when there is
              no run to clear at, four when there is), and the hint under it is
              the sentence for whichever it now reads. Rows render NORMALIZED —
              a stored WAIVERS TO FA in a rolling league shows as the WAIVERS
              the database reads it as — while the raw value stays stored, so
              switching back to a daily run gives the commissioner his Sunday
              back instead of having quietly eaten it. */}
          <View style={{ marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, padding: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mono size={9} tone="faint" track={0.1}>WEEKLY SCHEDULE</Mono>
              <View style={{ flex: 1 }} />
              <Chip label="DEFAULT" on={days.join(',') === DEFAULT_WAIVER_DAYS.join(',')}
                onPress={() => { tap(); setDays([...DEFAULT_WAIVER_DAYS]); }} />
            </View>
            {shownDays.map((m, i) => (
              <View key={DAY_LABEL[i]} style={{ marginTop: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Mono size={10} weight="700" style={{ width: 92 }}>{DAY_LABEL[i]}</Mono>
                  <View style={{ flex: 1 }} />
                  <Chip label={WAIVER_MODE_LABEL[m]} on
                    onPress={() => { tap(); setDays(days.map((x, j) => (j === i ? nextWaiverMode(m, clearMin) : x))); }} />
                </View>
                <Mono size={8} tone={faMode === 'off' && (m === 'fa' || m === 'waivers_to_fa') ? 'warn' : 'faint'} style={{ marginTop: 2, lineHeight: fs(12) }}>
                  {faMode === 'off' && (m === 'fa' || m === 'waivers_to_fa')
                    ? 'Overruled by NONE — WAIVERS ONLY: no door opens today.'
                    : WAIVER_MODE_HINT[m]}
                </Mono>
              </View>
            ))}
          </View>
          {/* AFTER GAMES, WAIVERS CLEAR: a player dropped once the week's games
              have started is not a free agent until this morning's run,
              whatever his own hold says. 0338 names the morning it really
              lands on — the chosen day rolled forward to one the run visits —
              and the time, which a rolling league is otherwise never shown. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">AFTER GAMES, CLEAR</Mono>
            <Chip label="NONE" on={gameHold === null} onPress={() => { tap(); setGameHold(null); }} />
            {[2, 3, 4].map((d) => (
              <Chip key={d} label={DAY_LABEL[d].slice(0, 3)} on={gameHold === d}
                onPress={() => { tap(); setGameHold(d); }} />
            ))}
          </View>
          {gameHold !== null && (
            <Mono size={8.5} tone="faint" style={{ marginTop: 4, lineHeight: fs(13) }}>
              {effGameHold === null
                ? 'No day on the schedule holds a run, so this cannot apply.'
                : `Dropped after the week's first kickoff → held until ${DAY_LABEL[effGameHold][0] + DAY_LABEL[effGameHold].slice(1).toLowerCase()} ${etTime(clearMin ?? 180)} ET.`}
            </Mono>
          )}
          {/* HOLD counts RUNS. A rolling league has none, so it gets the two
              settings it can actually honour rather than four that read the
              same (0338) — and the stored day count is left alone underneath,
              so a league that goes back to a daily run keeps its 3. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">HOLD</Mono>
            {clearMin === null ? (
              <>
                <Chip label="NONE" on={holdDays === 0} onPress={() => { tap(); setHoldDays(0); }} />
                <Chip label="24H" on={holdDays > 0} onPress={() => { tap(); if (holdDays === 0) setHoldDays(1); }} />
              </>
            ) : [0, 1, 2, 3].map((d) => (
              <Chip key={d} label={d === 0 ? 'NONE' : `${d} DAY${d > 1 ? 'S' : ''}`} on={holdDays === d} onPress={() => { tap(); setHoldDays(d); }} />
            ))}
          </View>
          <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(13) }}>{holdLine(clearMin, holdDays)}</Mono>

          {sec('FREE AGENCY')}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Chip label="ALWAYS OPEN" on={faMode === 'open'} onPress={() => { tap(); setFaMode('open'); setFaStart(null); setFaEnd(null); }} />
            <Chip label="DAILY WINDOW" on={faMode === 'window'} onPress={() => { tap(); setFaMode('window'); if (faStart === null) { setFaStart(600); setFaEnd(1380); } }} />
            {/* 0287 — not a narrower window, none at all. */}
            <Chip label="🚫 NONE — WAIVERS ONLY" on={faMode === 'off'} onPress={() => { tap(); setFaMode('off'); }} />
          </View>
          {faMode === 'off' && (
            <Mono size={9.5} tone="warn" style={{ marginTop: 6, lineHeight: 14 }}>
              {`No instant pickups at all. EVERY unowned player — including anyone who went undrafted — has to be won on waivers${mode === 'faab' ? ' with a FAAB bid' : ''}.${mode !== 'faab' ? ' This league runs priority waivers; switch the mode above to FAAB for blind bidding.' : ''}`}
            </Mono>
          )}
          {faMode !== 'off' && (
            <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(13) }}>
              Which DAYS free agency opens is the weekly schedule above. This is the league-wide switch: off means every unowned player is a claim, every day, whatever the schedule says.
            </Mono>
          )}
          {faMode === 'window' && (
            <View style={{ marginTop: 8, gap: 6 }}>
              <TimeStep label="OPENS" value={faStart ?? 600} onChange={setFaStart} />
              <TimeStep label="CLOSES" value={faEnd ?? 1380} onChange={setFaEnd} />
            </View>
          )}
          <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: fs(13) }}>
            A day that should open only once the run has spoken is WAIVERS TO FA on the schedule — one setting, so the door can never open on a run that never happened.
          </Mono>

          {/* WHAT THIS COMBINATION DOES (0338). Every setting here has a
              defined reading, so none of this blocks a save — it says which
              reading, out loud, where the old screen let a control look
              effective while the schedule quietly overruled it. */}
          {conflicts.length > 0 && (
            <View style={{ marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, padding: 8, gap: 6 }}>
              <Mono size={9} tone="faint" track={0.1}>HOW THESE READ TOGETHER</Mono>
              {conflicts.map((c, i) => (
                <Mono key={i} size={8.5} tone={c.level === 'warn' ? 'warn' : 'faint'} style={{ lineHeight: fs(13) }}>
                  {c.level === 'warn' ? '⚠ ' : '· '}{c.text}
                </Mono>
              ))}
            </View>
          )}

          {sec('TRADES')}
          {/* 0321: review (execute on accept / commissioner / league vote)
              lives in TRADE FLOOR. The two-way chips that sat here could not
              show the third value and, once tapped, saved over it (v0.456.0). */}
          <Mono size={8.5} tone="faint" style={{ marginTop: 4, lineHeight: fs(13) }}>
            Who approves a trade — nobody, the commissioner or a league vote — is set in TRADE FLOOR.
          </Mono>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">DEADLINE</Mono>
            <Chip label="NONE" on={deadline === null} onPress={() => { tap(); setDeadline(null); }} />
            <Chip label={deadline === null ? 'THROUGH WEEK…' : `THROUGH WEEK ${deadline}`} on={deadline !== null} onPress={() => { tap(); setDeadline(deadline ?? 11); }} />
            {deadline !== null && <Chip label="−" on={false} onPress={() => { tap(); setDeadline(Math.max(1, deadline - 1)); }} />}
            {deadline !== null && <Chip label="＋" on={false} onPress={() => { tap(); setDeadline(Math.min(18, deadline + 1)); }} />}
          </View>
          <Mono size={8.5} tone={deadlinePassed && init.deadline === deadline ? 'warn' : 'faint'} style={{ marginTop: 5, lineHeight: 12 }}>
            {deadline === null ? 'Trades all season.'
              : deadlinePassed && init.deadline === deadline ? 'Passed — trades are closed for the season.'
              : `Offers and acceptances go through until week ${deadline} is final.`}
          </Mono>

          {/* THE PICK SWITCH (0190). Saved on the tap rather than with the
              rules button beside it, because turning it ON PROVISIONS this
              league's draft slots and turning it OFF deletes them — that is a
              write, not a draft of one, and it can be refused (a slot somebody
              has already traded for is their property, and the server says so
              rather than deleting it). */}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Chip label={pickTrading ? 'PICK TRADING ON' : 'PICK TRADING OFF'} on={pickTrading}
              onPress={() => {
                tap();
                void (async () => {
                  const next = !pickTrading;
                  const r = await setPickTradingRpc(leagueId, next);
                  if (r.ok) { commit(); setPickTrading(next); setPickNote(null); }
                  else { warn(); setPickNote(friendlyError(r.error ?? 'that didn’t work')); }
                })();
              }} />
          </View>
          <Mono size={8.5} tone={pickNote ? 'opp' : 'faint'} style={{ marginTop: 5, lineHeight: 12 }}>
            {pickNote ?? (pickTrading
              ? 'Draft slots and rookie picks can be traded — before the draft and while it runs. The pick on the clock is never tradeable.'
              : 'Players trade as usual; offers naming a draft pick are refused.')}
          </Mono>

          {/* EMPTY SEATS ON THE WIRE (0213). Saved WITH the rules, unlike the
              pick switch above it: this one only writes a settings flag, so
              there is nothing to provision and nothing that can be refused.
              It is deliberately separate from the auto-slot opt-out — filling
              a lineup from players a seat already owns is housekeeping, while
              adding and dropping changes the league's pool and spends FAAB, and
              a commissioner can reasonably want the first without the second. */}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Chip label={agentWaivers ? '🤖 EMPTY SEATS CLAIM' : '🤖 EMPTY SEATS SIT'} on={agentWaivers}
              onPress={() => { tap(); setAgentWaivers(!agentWaivers); }} />
          </View>
          <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: 12 }}>
            {agentWaivers
              ? 'Seats nobody manages — empty seats and 🤖 AI teams — fill holes and take clear upgrades from waivers and free agency, never dropping a player who is in their starting lineup. A bot vampire builds its roster from the pool this way.'
              : 'Seats nobody manages — empty seats and 🤖 AI teams — still set their lineups, but never add or drop.'}
          </Mono>

          <View style={{ marginTop: 14 }}>
            <PrimaryButton label={busy ? '…' : changed ? 'SAVE RULES' : 'SAVED'} disabled={busy || !changed} onPress={() => void save()} />
          </View>

          {sec('ROSTER RULES')}
          {preDraft && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <Mono size={9} tone="faint">ROSTER SIZE</Mono>
              {/* Deeper sizes since 0192 (the cap is 99, not 25). */}
              {[7, 9, 12, 14, 16, 20, 25, 30, 40].map((n) => (
                <Chip key={n} label={String(n)} on={rounds === n} onPress={() => { tap(); setRounds(n); }} />
              ))}
            </View>
          )}
          {!preDraft && <Mono size={8.5} tone="faint" style={{ marginTop: 6 }}>Roster size is locked once the draft starts. Position limits stay adjustable.</Mono>}
          {caps && (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {POS_CAP_KEYS.map((k) => (
                <Chip key={k} label={`${k} ${caps[k] ?? '∞'}`} on={(caps[k] ?? null) !== null} onPress={() => { tap(); cycleCap(k); }} />
              ))}
            </View>
          )}
          <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(13) }}>
            Tap a position to cycle its limit: ∞ → 0 → 1 … 8 → ∞. Enforced at the draft, free agency, waivers, and auction bids; rosters already over a lowered limit keep their players — the limit blocks new adds.
          </Mono>
          <View style={{ marginTop: 10 }}>
            <PrimaryButton label={busy ? '…' : (capsChanged || roundsChanged) ? 'SAVE ROSTER RULES' : 'SAVED'}
              disabled={busy || !(capsChanged || roundsChanged)} onPress={() => void saveRoster()} />
          </View>

          {/* DRIP COIN moved to its own card on the ⚑ COMMISH screen — the
              allowance and the bulk levers live next to the balances they move.
              PLAYOFFS and LEAGUE VISIBILITY (v0.264.0) are their own sheets
              now — the 🏆 PLAYOFFS and 📣 LEAGUE BOARD chips on the map. */}
        </>
      )}
      </ScrollView>
    </Overlay>
  );
}
