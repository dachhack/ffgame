// Trades — propose, answer, follow, and (for the commissioner) rule.
//
// Port of the web TradeCenter (src/screens/NativeLeague.tsx), same 0072
// contract: propose_trade holds the offer, respond_trade accepts or declines,
// accepted trades execute instantly unless the league routes them through the
// commissioner (trade_review = 'commish'), and commish_rule_trade is that
// ruling. The server owns every check that matters — roster caps, position
// limits, player ownership (trade_cap_error) — so this screen only asks.
//
// One deliberate merge vs the web: the commissioner's APPROVE/VETO lives on
// the same card as everyone's trade list, not in a separate roster-tools
// panel. Two cards listing the same trades on one phone screen is noise.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  cancelTrade, commishRuleTrade, friendlyError, leagueTrades, proposeTrade, respondTrade,
  type LeaguePoolPlayer, type TradeRow,
} from '@drip/core/data/liveApi';
import { useTheme, alpha, MONO } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono, PrimaryButton } from './prims';
import { Overlay } from './Overlay';

export function TradeCenter({ leagueId, myRoster, teams, rosters, poolBySlug, tradeReview, isCommish, onChanged }: {
  leagueId: string; myRoster: number | null;
  teams: { roster_id: number; team: string | null }[];
  rosters: { roster_id: number; slug: string }[];
  poolBySlug: Map<string, LeaguePoolPlayer>;
  tradeReview?: 'none' | 'commish';
  isCommish: boolean;
  onChanged: () => void;
}) {
  const t = useTheme();
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [open, setOpen] = useState(false);
  const [partner, setPartner] = useState<number | null>(null);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => leagueTrades(leagueId).then((x) => { if (Array.isArray(x)) setTrades(x); }).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const teamName = (rid: number) => teams.find((x) => x.roster_id === rid)?.team ?? `Team ${rid}`;
  const pname = (s: string) => poolBySlug.get(s)?.full_name ?? s;
  const toggle = (list: string[], set: (v: string[]) => void, slug: string) => {
    tap();
    set(list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);
  };

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'That didn’t work.')); } else commit();
      await load(); onChanged();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const propose = async () => {
    if (busy || myRoster == null || partner == null || give.length + get.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const r = await proposeTrade(leagueId, myRoster, partner, give, get, note.trim() || undefined);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not propose the trade.')); return; }
      commit();
      setOpen(false); setPartner(null); setGive([]); setGet([]); setNote('');
      await load();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const statusChip = (x: TradeRow) => {
    const [label, color] =
      x.status === 'pending' ? ['OFFERED', t.warn]
      : x.status === 'accepted' ? ['AWAITING COMMISH', t.warn]
      : x.status === 'executed' ? ['EXECUTED', t.you]
      : x.status === 'vetoed' ? ['VETOED', t.opp]
      : [x.status.toUpperCase(), t.faint];
    return (
      <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: color, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 }}>
        <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.5, color }}>{label}</Text>
      </View>
    );
  };

  // The proposer's / partner's roster as a tappable checklist.
  const pickList = (rid: number | null, sel: string[], set: (v: string[]) => void) => (
    <ScrollView style={{ maxHeight: 180, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 4 }} nestedScrollEnabled>
      {rosters.filter((r) => r.roster_id === rid).map((r) => {
        const p = poolBySlug.get(r.slug);
        const on = sel.includes(r.slug);
        return (
          <Pressable key={r.slug} onPress={() => toggle(sel, set, r.slug)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 5, backgroundColor: on ? alpha(t.you, 14) : 'transparent' }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: on ? t.you : t.text, fontWeight: on ? '700' : '400' }}>
              {on ? '☑' : '☐'} {p?.full_name ?? r.slug}
            </Text>
            <Mono size={8} tone="faint">{p?.pos}</Mono>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const shown = trades.slice(0, 8);

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono size={9} tone="faint" track={0.12}>⇄ TRADES{tradeReview === 'commish' ? ' · COMMISH REVIEWS' : ''}</Mono>
        <View style={{ flex: 1 }} />
        {myRoster != null && <Chip label="＋ PROPOSE" on onPress={() => { tap(); setOpen(true); setErr(null); }} />}
      </View>
      {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 5 }}>{err}</Mono>}
      {shown.length === 0 && (
        <Mono size={10} tone="faint" style={{ marginTop: 6, lineHeight: 15 }}>
          No trades yet{myRoster != null ? ' — send the first offer.' : '.'}
        </Mono>
      )}
      {shown.map((x) => (
        <View key={x.id} style={{ paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 11.5, color: t.text, lineHeight: 17 }}>
              <Text style={{ fontWeight: '700', color: x.from_roster === myRoster ? t.you : t.text }}>{teamName(x.from_roster)}</Text>
              {' '}sends {x.give.map(pname).join(', ') || '—'}{'\n'}
              <Text style={{ fontWeight: '700', color: x.to_roster === myRoster ? t.you : t.text }}>{teamName(x.to_roster)}</Text>
              {' '}sends {x.get.map(pname).join(', ') || '—'}
            </Text>
            {statusChip(x)}
          </View>
          {!!x.note && <Mono size={8.5} tone="faint" style={{ marginTop: 3 }}>“{x.note}”</Mono>}
          {(x.status === 'pending' || x.status === 'accepted') && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {x.status === 'pending' && x.to_roster === myRoster && (
                <>
                  <Chip label="✓ ACCEPT" on disabled={busy} onPress={() => { tap(); void act(() => respondTrade(x.id, true)); }} />
                  <Chip label="✕ DECLINE" disabled={busy} onPress={() => { tap(); void act(() => respondTrade(x.id, false)); }} />
                </>
              )}
              {x.from_roster === myRoster && (
                <Chip label="withdraw" disabled={busy} onPress={() => { tap(); void act(() => cancelTrade(x.id)); }} />
              )}
              {/* the ruling, on the same card (see header) */}
              {isCommish && x.status === 'accepted' && (
                <>
                  <View style={{ flex: 1 }} />
                  <Chip label="⚑ APPROVE" on disabled={busy} onPress={() => { tap(); void act(() => commishRuleTrade(x.id, true)); }} />
                  <Chip label="⚑ VETO" disabled={busy} onPress={() => { tap(); void act(() => commishRuleTrade(x.id, false)); }} />
                </>
              )}
            </View>
          )}
        </View>
      ))}

      {/* propose: partner → two checklists → note → send */}
      <Overlay visible={open && myRoster != null} title="Propose a trade"
        subtitle={tradeReview === 'commish' ? 'Accepted trades go to the commissioner for a ruling.' : 'Accepted trades execute immediately.'}
        onClose={() => setOpen(false)}>
        <Mono size={9} tone="faint" track={0.1}>TRADE WITH</Mono>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {teams.filter((x) => x.roster_id !== myRoster).map((x) => (
            <Chip key={x.roster_id} label={x.team ?? `Team ${x.roster_id}`} on={partner === x.roster_id}
              onPress={() => { tap(); setPartner(x.roster_id); setGet([]); }} />
          ))}
        </View>
        {partner != null && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Mono size={9} tone="faint" track={0.1} style={{ marginBottom: 4 }}>YOU SEND</Mono>
              {pickList(myRoster, give, setGive)}
            </View>
            <View style={{ flex: 1 }}>
              <Mono size={9} tone="faint" track={0.1} style={{ marginBottom: 4 }}>YOU GET</Mono>
              {pickList(partner, get, setGet)}
            </View>
          </View>
        )}
        <TextInput value={note} maxLength={140} placeholder="Add a note (optional)…" placeholderTextColor={t.faint}
          onChangeText={setNote}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: t.text, backgroundColor: t.bg, marginTop: 10 }} />
        {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 6 }}>{err}</Mono>}
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : '⇄ SEND THE OFFER'}
            disabled={busy || partner == null || give.length + get.length === 0}
            onPress={() => void propose()} />
        </View>
      </Overlay>
    </Card>
  );
}
