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
  closeLeagueListing, commishGrantWeeklyBudget, commishOverview, commishSetWeeklyBudget, friendlyError,
  leagueListingState, postLeagueListing, rosterRules, setRosterRules, setTransactionRules, POS_CAP_KEYS,
  type PosCaps, type TradeReview, type WaiverMode,
} from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
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
      style={{ fontFamily: MONO, fontSize: 15, fontWeight: '700', color: t.you, paddingHorizontal: 12, paddingVertical: 4 }}
    >{txt}</Text>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Mono size={9} tone="faint" style={{ width: 46 }}>{label}</Mono>
      {btn('−', -STEP)}
      <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', color: t.text, width: 72, textAlign: 'center' }}>{fmtEt(value)} ET</Text>
      {btn('＋', STEP)}
    </View>
  );
}

interface Rules {
  mode: WaiverMode; budget: number; review: TradeReview;
  clearMin: number | null; clearDow: number[] | null; holdDays: number; faStart: number | null; faEnd: number | null;
}

export function CommishSettings({ visible, leagueId, onClose, onSaved }: {
  visible: boolean; leagueId: string; onClose: () => void;
  /** Rules or visibility changed — the team screen should re-read. */
  onSaved: () => void;
}) {
  const t = useTheme();
  const [init, setInit] = useState<Rules | null>(null);
  const [mode, setMode] = useState<WaiverMode>('rolling');
  const [budgetDraft, setBudgetDraft] = useState('100');
  const [review, setReview] = useState<TradeReview>('none');
  const [clearMin, setClearMin] = useState<number | null>(null);   // null = rolling 24h
  const [clearDow, setClearDow] = useState<number[] | null>(null); // null = every day (0=Sun…6=Sat ET)
  const [holdDays, setHoldDays] = useState(1);
  const [faStart, setFaStart] = useState<number | null>(null);     // null = always open
  const [faEnd, setFaEnd] = useState<number | null>(null);
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
  // Drip coin: the league's weekly budget + a one-tap grant for a chosen week.
  const [weeklyDraft, setWeeklyDraft] = useState('');
  const [weeklyInit, setWeeklyInit] = useState<number | null>(null);
  const [grantWeekDraft, setGrantWeekDraft] = useState('');

  useEffect(() => {
    if (!visible) return;
    setMsg(null);
    rosterRules(leagueId).then((r) => {
      if (r.error || !r.ok) { setMsg(friendlyError(r.error ?? 'could not load rules')); return; }
      const cur: Rules = {
        mode: r.waiver_mode ?? 'rolling', budget: r.faab_budget ?? 100, review: r.trade_review ?? 'none',
        clearMin: r.waiver_clear_min ?? null,
        clearDow: Array.isArray(r.waiver_clear_dow) && r.waiver_clear_dow.length ? [...r.waiver_clear_dow].sort() : null,
        holdDays: r.waiver_hold_days ?? 1,
        faStart: r.fa_start_min ?? null, faEnd: r.fa_end_min ?? null,
      };
      setInit(cur); setMode(cur.mode); setBudgetDraft(String(cur.budget)); setReview(cur.review);
      setClearMin(cur.clearMin); setClearDow(cur.clearDow); setHoldDays(cur.holdDays); setFaStart(cur.faStart); setFaEnd(cur.faEnd);
      const pc = r.pos_caps ?? ({} as PosCaps);
      setCaps({ ...pc }); setCapsInit({ ...pc });
      setRounds(r.rounds ?? null); setRoundsInit(r.rounds ?? null);
      setPreDraft(r.draft_status === 'pending');
    }).catch((e) => setMsg(friendlyError(e)));
    leagueListingState(leagueId).then((r) => {
      if (r.ok) { setListed(!!r.listed); setBlurbDraft(r.blurb ?? ''); }
    }).catch(() => {});
    // The weekly budget rides along on commish_overview — the same read the
    // web's commissioner card uses.
    commishOverview().then((ls) => {
      const wb = ls.find((l) => l.league_id === leagueId)?.weekly_budget ?? null;
      setWeeklyInit(wb); setWeeklyDraft(wb != null ? String(wb) : '');
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leagueId]);

  const budget = Math.max(1, parseInt(budgetDraft || '0', 10) || 0);

  const save = async () => {
    if (!init || busy) return;
    setBusy(true); setMsg(null);
    try {
      const clearChanged = clearMin !== init.clearMin;
      const dowChanged = JSON.stringify(clearDow ?? []) !== JSON.stringify(init.clearDow ?? []);
      const faChanged = faStart !== init.faStart || faEnd !== init.faEnd;
      const r = await setTransactionRules(leagueId,
        mode !== init.mode ? mode : null,
        mode === 'faab' && budget !== init.budget ? budget : null,
        review !== init.review ? review : null,
        clearChanged ? (clearMin ?? -1) : null,
        holdDays !== init.holdDays ? holdDays : null,
        faChanged ? (faStart ?? -1) : null,
        faChanged ? (faEnd ?? -1) : null,
        dowChanged ? (clearDow ?? []) : null);
      if (r.ok) {
        commit();
        setInit({ mode, budget, review, clearMin, clearDow, holdDays, faStart, faEnd });
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

  const saveWeekly = async () => {
    const amt = parseInt(weeklyDraft || '0', 10) || 0;
    if (busy || amt < 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commishSetWeeklyBudget(leagueId, amt);
      if (r.ok) { commit(); setWeeklyInit(r.weekly_budget ?? amt); setMsg(`✓ weekly budget ${r.weekly_budget ?? amt}`); onSaved(); }
      else { warn(); setMsg(friendlyError(r.error ?? 'save failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const grantWeekly = async () => {
    const wk = parseInt(grantWeekDraft || '0', 10);
    if (busy || !wk) return;
    setBusy(true); setMsg(null);
    try {
      // Idempotent server-side: re-granting a week never double-credits.
      const r = await commishGrantWeeklyBudget(leagueId, wk);
      if (r.ok) { commit(); setMsg(`✓ credited ${r.credited ?? 0} teams for week ${wk}`); }
      else { warn(); setMsg(friendlyError(r.error ?? 'grant failed')); }
    } catch (e) { warn(); setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const sec = (label: string) => <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>{label}</Mono>;
  const changed = init && (mode !== init.mode || (mode === 'faab' && budget !== init.budget) || review !== init.review
    || clearMin !== init.clearMin || holdDays !== init.holdDays || faStart !== init.faStart || faEnd !== init.faEnd
    || JSON.stringify(clearDow ?? []) !== JSON.stringify(init.clearDow ?? []));

  return (
    <Overlay visible={visible} title="⚑ League settings" subtitle="Commissioner — waivers, rosters, coin, visibility." onClose={onClose}>
      <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
      {!init && !msg && <Mono size={10} tone="faint">Loading the rules…</Mono>}
      {!!msg && (
        <Notice tone={msg.startsWith('✓') ? 'you' : 'opp'}>
          <Mono size={10} tone={msg.startsWith('✓') ? 'you' : 'opp'}>{msg}</Mono>
        </Notice>
      )}

      {init && (
        <>
          {sec('WAIVER SYSTEM')}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Chip label="ROLLING" on={mode === 'rolling'} onPress={() => { tap(); setMode('rolling'); }} />
            <Chip label="REVERSE STANDINGS" on={mode === 'standings'} onPress={() => { tap(); setMode('standings'); }} />
            <Chip label="💰 FAAB" on={mode === 'faab'} onPress={() => { tap(); setMode('faab'); }} />
          </View>
          <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: 13 }}>
            {mode === 'rolling' ? 'A queue: winning a claim sends you to the back.'
              : mode === 'standings' ? "Sleeper's default: priority is the reverse of the live standings at every clear — winning a claim costs nothing, only winning games does."
              : 'Blind bids from a season budget; highest bid wins, only the winner pays.'}
          </Mono>
          {mode === 'faab' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Mono size={9} tone="faint">SEASON BUDGET $</Mono>
              <TextInput value={budgetDraft} keyboardType="number-pad" onChangeText={(v) => setBudgetDraft(v.replace(/\D/g, ''))}
                style={{ width: 76, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
            </View>
          )}
          {init.mode !== mode || (mode === 'faab' && budget !== init.budget) ? (
            <Mono size={8.5} tone="warn" style={{ marginTop: 6, lineHeight: 13 }}>
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
          {/* Sleeper's run days: waivers process only on the checked days.
              Meaningful with a daily clear; the server assumes 3:00am ET when
              days are set with no time. */}
          {clearMin !== null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
              <Mono size={9} tone="faint">DAYS</Mono>
              <Chip label="ALL" on={clearDow === null} onPress={() => { tap(); setClearDow(null); }} />
              {(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const).map((d, i) => (
                <Chip key={d} label={d} on={!!clearDow?.includes(i)}
                  onPress={() => {
                    tap();
                    const cur = clearDow ?? [];
                    const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort();
                    setClearDow(next.length ? next : null);
                  }} />
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">HOLD</Mono>
            {[1, 2, 3].map((d) => (
              <Chip key={d} label={`${d} DAY${d > 1 ? 'S' : ''}`} on={holdDays === d} onPress={() => { tap(); setHoldDays(d); }} />
            ))}
          </View>
          <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: 13 }}>
            {clearMin === null
              ? 'Rolling: each dropped player clears exactly 24h × hold after the drop.'
              : 'Daily: claims resolve at the set time once the hold has passed.'}
          </Mono>

          {sec('FREE AGENCY')}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Chip label="ALWAYS OPEN" on={faStart === null} onPress={() => { tap(); setFaStart(null); setFaEnd(null); }} />
            <Chip label="DAILY WINDOW" on={faStart !== null} onPress={() => { tap(); if (faStart === null) { setFaStart(600); setFaEnd(1380); } }} />
          </View>
          {faStart !== null && faEnd !== null && (
            <View style={{ marginTop: 8, gap: 6 }}>
              <TimeStep label="OPENS" value={faStart} onChange={setFaStart} />
              <TimeStep label="CLOSES" value={faEnd} onChange={setFaEnd} />
            </View>
          )}

          {sec('TRADES')}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Chip label="EXECUTE ON ACCEPT" on={review === 'none'} onPress={() => { tap(); setReview('none'); }} />
            <Chip label="⚑ COMMISH REVIEW" on={review === 'commish'} onPress={() => { tap(); setReview('commish'); }} />
          </View>

          <View style={{ marginTop: 14 }}>
            <PrimaryButton label={busy ? '…' : changed ? 'SAVE RULES' : 'SAVED'} disabled={busy || !changed} onPress={() => void save()} />
          </View>

          {sec('ROSTER RULES')}
          {preDraft && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Mono size={9} tone="faint">ROSTER SIZE</Mono>
              {[7, 9, 12, 14, 16].map((n) => (
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
          <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: 13 }}>
            Tap a position to cycle its limit: ∞ → 0 → 1 … 8 → ∞. Enforced at the draft, free agency, waivers, and auction bids; rosters already over a lowered limit keep their players — the limit blocks new adds.
          </Mono>
          <View style={{ marginTop: 10 }}>
            <PrimaryButton label={busy ? '…' : (capsChanged || roundsChanged) ? 'SAVE ROSTER RULES' : 'SAVED'}
              disabled={busy || !(capsChanged || roundsChanged)} onPress={() => void saveRoster()} />
          </View>

          {sec('DRIP COIN')}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <Mono size={9} tone="faint">WEEKLY BUDGET</Mono>
            <TextInput value={weeklyDraft} keyboardType="number-pad" placeholder={weeklyInit != null ? String(weeklyInit) : '0'}
              placeholderTextColor={t.faint} onChangeText={(v) => setWeeklyDraft(v.replace(/\D/g, ''))}
              style={{ width: 70, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
            <Chip label="SET" on disabled={busy || !weeklyDraft || parseInt(weeklyDraft, 10) === weeklyInit} onPress={() => void saveWeekly()} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Mono size={9} tone="faint">GRANT WEEK</Mono>
            <TextInput value={grantWeekDraft} keyboardType="number-pad" placeholder="wk#"
              placeholderTextColor={t.faint} onChangeText={(v) => setGrantWeekDraft(v.replace(/\D/g, ''))}
              style={{ width: 56, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
            <Chip label="💰 GRANT ALL TEAMS" disabled={busy || !grantWeekDraft} onPress={() => void grantWeekly()} />
          </View>
          <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: 13 }}>
            Granting credits every team the weekly budget for that week — idempotent, so re-granting a week never double-pays.
          </Mono>

          {sec('🏆 PLAYOFFS')}
          <PlayoffControls leagueId={leagueId} onChanged={onSaved} />

          {sec('LEAGUE VISIBILITY')}
          {listed === null ? (
            <Mono size={9.5} tone="faint" style={{ marginTop: 6 }}>Loading…</Mono>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <Chip label="🔒 PRIVATE — INVITE ONLY" on={!listed} onPress={() => void setVisibility(false)} />
                <Chip label="🔎 PUBLIC ON THE BOARD" on={listed} onPress={() => void setVisibility(true)} />
              </View>
              <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: 13 }}>
                {listed
                  ? 'Anyone browsing the league board can take an open seat. It comes off the board the moment you go private or the seats fill.'
                  : 'Only people you hand the invite code to can join — share it from the RECRUIT button.'}
              </Mono>
              {listed && (
                <View style={{ marginTop: 8 }}>
                  <TextInput value={blurbDraft} maxLength={280} multiline placeholder="The pitch shown on the board…" placeholderTextColor={t.faint}
                    onChangeText={setBlurbDraft}
                    style={{ minHeight: 56, textAlignVertical: 'top', borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: t.text, backgroundColor: t.bg }} />
                  <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
                    <LinkButton label="update pitch" tone="you" onPress={() => void saveBlurb()} />
                  </View>
                </View>
              )}
            </>
          )}
        </>
      )}
      </ScrollView>
    </Overlay>
  );
}
