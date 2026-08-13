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
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  closeLeagueListing, friendlyError, leagueListingState, postLeagueListing, rosterRules, setTransactionRules,
  type TradeReview, type WaiverMode,
} from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Chip, LinkButton, Mono, Notice, PrimaryButton } from './prims';
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
  clearMin: number | null; holdDays: number; faStart: number | null; faEnd: number | null;
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
  const [holdDays, setHoldDays] = useState(1);
  const [faStart, setFaStart] = useState<number | null>(null);     // null = always open
  const [faEnd, setFaEnd] = useState<number | null>(null);
  const [listed, setListed] = useState<boolean | null>(null);      // null = still loading
  const [blurbDraft, setBlurbDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMsg(null);
    rosterRules(leagueId).then((r) => {
      if (r.error || !r.ok) { setMsg(friendlyError(r.error ?? 'could not load rules')); return; }
      const cur: Rules = {
        mode: r.waiver_mode ?? 'rolling', budget: r.faab_budget ?? 100, review: r.trade_review ?? 'none',
        clearMin: r.waiver_clear_min ?? null, holdDays: r.waiver_hold_days ?? 1,
        faStart: r.fa_start_min ?? null, faEnd: r.fa_end_min ?? null,
      };
      setInit(cur); setMode(cur.mode); setBudgetDraft(String(cur.budget)); setReview(cur.review);
      setClearMin(cur.clearMin); setHoldDays(cur.holdDays); setFaStart(cur.faStart); setFaEnd(cur.faEnd);
    }).catch((e) => setMsg(friendlyError(e)));
    leagueListingState(leagueId).then((r) => {
      if (r.ok) { setListed(!!r.listed); setBlurbDraft(r.blurb ?? ''); }
    }).catch(() => {});
  }, [visible, leagueId]);

  const budget = Math.max(1, parseInt(budgetDraft || '0', 10) || 0);

  const save = async () => {
    if (!init || busy) return;
    setBusy(true); setMsg(null);
    try {
      const clearChanged = clearMin !== init.clearMin;
      const faChanged = faStart !== init.faStart || faEnd !== init.faEnd;
      const r = await setTransactionRules(leagueId,
        mode !== init.mode ? mode : null,
        mode === 'faab' && budget !== init.budget ? budget : null,
        review !== init.review ? review : null,
        clearChanged ? (clearMin ?? -1) : null,
        holdDays !== init.holdDays ? holdDays : null,
        faChanged ? (faStart ?? -1) : null,
        faChanged ? (faEnd ?? -1) : null);
      if (r.ok) {
        commit();
        setInit({ mode, budget, review, clearMin, holdDays, faStart, faEnd });
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

  const sec = (label: string) => <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>{label}</Mono>;
  const changed = init && (mode !== init.mode || (mode === 'faab' && budget !== init.budget) || review !== init.review
    || clearMin !== init.clearMin || holdDays !== init.holdDays || faStart !== init.faStart || faEnd !== init.faEnd);

  return (
    <Overlay visible={visible} title="⚑ League settings" subtitle="Commissioner — waivers, free agency, visibility." onClose={onClose}>
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
            <Chip label="ROLLING PRIORITY" on={mode === 'rolling'} onPress={() => { tap(); setMode('rolling'); }} />
            <Chip label="💰 FAAB BIDS" on={mode === 'faab'} onPress={() => { tap(); setMode('faab'); }} />
          </View>
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
    </Overlay>
  );
}
