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
  tradeSignals, setTradeSignal, pickAssets,
  type LeaguePoolPlayer, type TradeRow, type TradeSignalRow, type PickAssetRow,
} from '@drip/core/data/liveApi';
import { useTheme, alpha, MONO, fs } from '../theme.native';
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
  const [signals, setSignals] = useState<TradeSignalRow[]>([]);
  const [assets, setAssets] = useState<PickAssetRow[]>([]);          // tradeable future picks (0183)
  const [blockEdit, setBlockEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [partner, setPartner] = useState<number | null>(null);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [givePicks, setGivePicks] = useState<PickAssetRow[]>([]);
  const [getPicks, setGetPicks] = useState<PickAssetRow[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => Promise.all([
    leagueTrades(leagueId).then((x) => { if (Array.isArray(x)) setTrades(x); }),
    tradeSignals(leagueId).then((s) => { if (Array.isArray(s)) setSignals(s); }),
    pickAssets(leagueId).then((a) => {
      // every FUTURE season's picks are tradeable (dynasty holds a 3-year
      // horizon, 0185); a rolled league's pending-draft assets belong to the
      // draft room
      if (a.ok && a.future_season != null) setAssets(a.picks.filter((p) => p.season >= a.future_season!));
    }),
  ]).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const teamName = (rid: number) => teams.find((x) => x.roster_id === rid)?.team ?? `Team ${rid}`;
  const pname = (s: string) => poolBySlug.get(s)?.full_name ?? s;
  const toggle = (list: string[], set: (v: string[]) => void, slug: string) => {
    tap();
    set(list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);
  };
  const samePick = (a: PickAssetRow, b: PickAssetRow) =>
    a.season === b.season && a.round === b.round && a.orig === b.orig;
  const togglePick = (list: PickAssetRow[], set: (v: PickAssetRow[]) => void, p: PickAssetRow) => {
    tap();
    set(list.some((x) => samePick(x, p)) ? list.filter((x) => !samePick(x, p)) : [...list, p]);
  };
  /** "2027 R1" — plus whose original slot it is when it was acquired. */
  const pickAssetLabel = (p: { season: string; round: number; orig: number }, holder: number) =>
    `${p.season} R${p.round}${p.orig !== holder ? ` (${teamName(p.orig)}’s slot)` : ''}`;
  const tradeLine = (x: TradeRow, side: 'give' | 'get') => {
    const slugs = (side === 'give' ? x.give : x.get).map(pname);
    const rid = side === 'give' ? x.from_roster : x.to_roster;
    const picks = ((side === 'give' ? x.give_picks : x.get_picks) ?? []).map((p) => `⛏ ${pickAssetLabel(p, rid)}`);
    return [...slugs, ...picks].join(', ') || '—';
  };

  // Standing signals (0140): the shared block and the interest marks. All
  // league-visible; the server already filtered out anything stale.
  const blocks = signals.filter((s) => s.kind === 'block');
  const wants = signals.filter((s) => s.kind === 'want');
  const myBlocked = new Set(blocks.filter((s) => s.roster_id === myRoster).map((s) => s.slug));
  const myWants = new Set(wants.filter((s) => s.roster_id === myRoster).map((s) => s.slug));
  const wantCount = (slug: string) => wants.filter((w) => w.slug === slug).length;
  const interestInMine = wants.filter((w) => w.holder_roster === myRoster);
  const toggleSignal = (slug: string, kind: 'block' | 'want', on: boolean) => {
    if (myRoster != null) { tap(); void act(() => setTradeSignal(leagueId, myRoster, slug, kind, on)); }
  };
  // A signal's natural next step is an offer: open the propose sheet already
  // pointed at the right team with the right player checked.
  const openPreset = (partnerRid: number, giveSlugs: string[], getSlugs: string[]) => {
    tap();
    setPartner(partnerRid); setGive(giveSlugs); setGet(getSlugs);
    setGivePicks([]); setGetPicks([]); setErr(null); setOpen(true);
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
    if (busy || myRoster == null || partner == null
        || give.length + get.length + givePicks.length + getPicks.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const r = await proposeTrade(leagueId, myRoster, partner, give, get, note.trim() || undefined,
        givePicks.map((p) => ({ season: p.season, round: p.round, orig: p.orig })),
        getPicks.map((p) => ({ season: p.season, round: p.round, orig: p.orig })));
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not propose the trade.')); return; }
      commit();
      setOpen(false); setPartner(null); setGive([]); setGet([]); setGivePicks([]); setGetPicks([]); setNote('');
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
        <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', letterSpacing: 0.5, color }}>{label}</Text>
      </View>
    );
  };

  // The proposer's / partner's roster as a tappable checklist. wantable: the
  // partner's list — each row grows a 👀 mark-interest toggle, so browsing a
  // roster mid-propose doubles as scouting (close without sending and the
  // marks stand).
  const pickList = (rid: number | null, sel: string[], set: (v: string[]) => void, wantable = false) => (
    <ScrollView style={{ maxHeight: 180, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 4 }} nestedScrollEnabled>
      {rosters.filter((r) => r.roster_id === rid).map((r) => {
        const p = poolBySlug.get(r.slug);
        const on = sel.includes(r.slug);
        return (
          <Pressable key={r.slug} onPress={() => toggle(sel, set, r.slug)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 5, backgroundColor: on ? alpha(t.you, 14) : 'transparent' }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11.5), color: on ? t.you : t.text, fontWeight: on ? '700' : '400' }}>
              {on ? '☑' : '☐'} {p?.full_name ?? r.slug}
            </Text>
            <Mono size={8} tone="faint">{p?.pos}</Mono>
            {wantable && myRoster != null && (
              <Pressable hitSlop={6} onPress={() => toggleSignal(r.slug, 'want', !myWants.has(r.slug))}>
                <Text style={{ fontSize: fs(12), opacity: myWants.has(r.slug) ? 1 : 0.35 }}>👀</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const shown = trades.slice(0, 8);

  // A side's tradeable draft picks (0183), below its player list. Renders
  // nothing until the commissioner provisions rookie rounds.
  const pickAssetList = (rid: number | null, sel: PickAssetRow[], set: (v: PickAssetRow[]) => void) => {
    const owned = assets.filter((a) => a.owner === rid);
    if (owned.length === 0) return null;
    return (
      <View style={{ marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 4 }}>
        <Mono size={7.5} tone="faint" track={0.1} style={{ marginBottom: 2 }}>⛏ DRAFT PICKS</Mono>
        {owned.map((a) => {
          const on = sel.some((x) => samePick(x, a));
          return (
            <Pressable key={`${a.season}:${a.round}:${a.orig}`} onPress={() => togglePick(sel, set, a)}
              style={{ borderRadius: 4, paddingHorizontal: 5, paddingVertical: 5, backgroundColor: on ? alpha(t.you, 14) : 'transparent' }}>
              <Text style={{ fontSize: fs(11.5), color: on ? t.you : t.text, fontWeight: on ? '700' : '400' }}>
                {on ? '☑' : '☐'} {pickAssetLabel(a, a.owner)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono size={9} tone="faint" track={0.12}>⇄ TRADES{tradeReview === 'commish' ? ' · COMMISH REVIEWS' : ''}</Mono>
        <View style={{ flex: 1 }} />
        {myRoster != null && <Chip label="＋ PROPOSE" on onPress={() => { tap(); setOpen(true); setErr(null); }} />}
      </View>
      {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 5 }}>{err}</Mono>}
      {shown.length === 0 && (
        <Mono size={10} tone="faint" style={{ marginTop: 6, lineHeight: fs(15) }}>
          No trades yet{myRoster != null ? ' — send the first offer.' : '.'}
        </Mono>
      )}
      {shown.map((x) => (
        <View key={x.id} style={{ paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: fs(11.5), color: t.text, lineHeight: fs(17) }}>
              <Text style={{ fontWeight: '700', color: x.from_roster === myRoster ? t.you : t.text }}>{teamName(x.from_roster)}</Text>
              {' '}sends {tradeLine(x, 'give')}{'\n'}
              <Text style={{ fontWeight: '700', color: x.to_roster === myRoster ? t.you : t.text }}>{teamName(x.to_roster)}</Text>
              {' '}sends {tradeLine(x, 'get')}
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

      {/* THE TRADE BLOCK — standing "I'd listen on this player" flags (0140).
          Every member sees the whole block; the 👀 count shows a shopped
          player's market before anyone commits to an offer. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <Mono size={9} tone="faint" track={0.12}>🔁 TRADE BLOCK</Mono>
        <View style={{ flex: 1 }} />
        {myRoster != null && (
          <Chip label={blockEdit ? '✓ DONE' : '✎ SHOP MY PLAYERS'} on={blockEdit}
            onPress={() => { tap(); setBlockEdit((v) => !v); }} />
        )}
      </View>
      {blockEdit && myRoster != null && (
        <ScrollView style={{ maxHeight: 180, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 4, marginTop: 7 }} nestedScrollEnabled>
          {rosters.filter((r) => r.roster_id === myRoster).map((r) => {
            const p = poolBySlug.get(r.slug);
            const on = myBlocked.has(r.slug);
            return (
              <Pressable key={r.slug} disabled={busy} onPress={() => toggleSignal(r.slug, 'block', !on)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 5, backgroundColor: on ? alpha(t.warn, 14) : 'transparent' }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11.5), color: on ? t.warn : t.text, fontWeight: on ? '700' : '400' }}>
                  {on ? '🔁' : '☐'} {p?.full_name ?? r.slug}
                </Text>
                <Mono size={8} tone="faint">{p?.pos}{on ? ' · ON THE BLOCK' : ''}</Mono>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {blocks.length === 0 && !blockEdit && (
        <Mono size={10} tone="faint" style={{ marginTop: 6, lineHeight: fs(15) }}>
          Nobody is shopping anyone yet. Put a player on the block and the whole league sees it here.
        </Mono>
      )}
      {blocks.map((s) => {
        const p = poolBySlug.get(s.slug);
        const mineRow = s.roster_id === myRoster;
        const n = wantCount(s.slug);
        return (
          <View key={`blk-${s.roster_id}-${s.slug}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 5 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: fs(12), fontWeight: '700', color: t.text }}>{pname(s.slug)}</Text>
              <Mono size={8.5} tone="faint">{p?.pos} · {mineRow ? 'your player' : teamName(s.roster_id)}</Mono>
            </View>
            {n > 0 && <Mono size={9} tone="you" weight="700">👀 {n}</Mono>}
            {mineRow
              ? <Chip label="✕ OFF" disabled={busy} onPress={() => toggleSignal(s.slug, 'block', false)} />
              : myRoster != null && (
                <>
                  <Chip label={myWants.has(s.slug) ? '👀 ✓' : '👀'} on={myWants.has(s.slug)} disabled={busy}
                    onPress={() => toggleSignal(s.slug, 'want', !myWants.has(s.slug))} />
                  <Chip label="⇄ OFFER" onPress={() => openPreset(s.roster_id, [], [s.slug])} />
                </>
              )}
          </View>
        );
      })}

      {/* INTEREST — who's eyeing whom. Your players with suitors float first;
          your own marks follow, each one tap from a real offer. */}
      {(interestInMine.length > 0 || myWants.size > 0) && (
        <>
          <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>👀 TRADE INTEREST</Mono>
          {interestInMine.map((w) => (
            <View key={`in-${w.roster_id}-${w.slug}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 5 }}>
              <Text numberOfLines={2} style={{ flex: 1, fontSize: fs(11.5), color: t.text, lineHeight: fs(16) }}>
                <Text style={{ fontWeight: '700', color: t.you }}>{teamName(w.roster_id)}</Text> is interested in your <Text style={{ fontWeight: '700' }}>{pname(w.slug)}</Text>
              </Text>
              {myRoster != null && <Chip label="⇄ TALK" onPress={() => openPreset(w.roster_id, [w.slug], [])} />}
            </View>
          ))}
          {wants.filter((w) => w.roster_id === myRoster).map((w) => (
            <View key={`my-${w.slug}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 5 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11.5), color: t.text }}>
                You 👀 <Text style={{ fontWeight: '700' }}>{pname(w.slug)}</Text> <Text style={{ color: t.dim, fontSize: fs(10) }}>({teamName(w.holder_roster)})</Text>
              </Text>
              <Chip label="✕" disabled={busy} onPress={() => toggleSignal(w.slug, 'want', false)} />
              <Chip label="⇄ OFFER" onPress={() => openPreset(w.holder_roster, [], [w.slug])} />
            </View>
          ))}
        </>
      )}

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
              {pickAssetList(myRoster, givePicks, setGivePicks)}
            </View>
            <View style={{ flex: 1 }}>
              <Mono size={9} tone="faint" track={0.1} style={{ marginBottom: 4 }}>YOU GET</Mono>
              {pickList(partner, get, setGet, true)}
              {pickAssetList(partner, getPicks, setGetPicks)}
            </View>
          </View>
        )}
        <TextInput value={note} maxLength={140} placeholder="Add a note (optional)…" placeholderTextColor={t.faint}
          onChangeText={setNote}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(12.5), color: t.text, backgroundColor: t.bg, marginTop: 10 }} />
        {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 6 }}>{err}</Mono>}
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : '⇄ SEND THE OFFER'}
            disabled={busy || partner == null || give.length + get.length + givePicks.length + getPicks.length === 0}
            onPress={() => void propose()} />
        </View>
      </Overlay>
    </Card>
  );
}
