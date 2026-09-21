// Trades — propose, answer, follow, and (for the commissioner) rule.
//
// Port of the web TradeCenter (src/screens/NativeLeague.tsx), same 0072
// contract: propose_trade holds the offer, respond_trade accepts or declines,
// accepted trades execute instantly unless the league routes them through the
// commissioner (trade_review = 'commish') or, since 0321, out to the league
// for a veto vote ('league'), and commish_rule_trade is that ruling. 0321 also
// brought the offer clock, the counter, and FAAB dollars as an asset. The
// server owns every check that matters — roster caps, position limits, player
// ownership (trade_cap_error), the vote's arithmetic — so this screen only
// asks.
//
// One deliberate merge vs the web: the commissioner's APPROVE/VETO lives on
// the same card as everyone's trade list, not in a separate roster-tools
// panel. Two cards listing the same trades on one phone screen is noise.
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  cancelTrade, commishRuleTrade, friendlyError, leagueTrades, proposeTrade, respondTrade,
  counterTrade, castTradeVote, proposeMultiTrade, commishReverseTrade, leagueGameMode,
  type GameModeInfo,
  tradeSignals, setTradeSignal, pickAssets, leagueContracts,
  type LeaguePoolPlayer, type TradeRow, type TradeSignalRow, type PickAssetRow, type LeagueContracts,
} from '@drip/core/data/liveApi';
import { fmtTimeLeft, voteTally } from '@drip/core/data/tradeClock';
import { gradeTrade, type GradeResult } from '@drip/core/data/tradeGrade';
import { useTheme, alpha, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono, PrimaryButton } from './prims';
import { openPlayerCard } from './PlayerCardSheet';
import { Overlay } from './Overlay';

export function TradeCenter({ leagueId, myRoster, teams, rosters, poolBySlug, tradeReview,
                              reviewHours, vetoNeed, offerDays, faabTrading, myFaab,
                              isCommish, presetPartner, onChanged }: {
  leagueId: string; myRoster: number | null;
  teams: { roster_id: number; team: string | null }[];
  rosters: { roster_id: number; slug: string }[];
  poolBySlug: Map<string, LeaguePoolPlayer>;
  tradeReview?: 'none' | 'commish' | 'league';
  /** 0321, the trade floor: the vote's window and bar, the default life of an
   *  offer, whether FAAB may ride one, and this seat's wallet. */
  reviewHours?: number; vetoNeed?: number; offerDays?: number;
  faabTrading?: boolean; myFaab?: number | null;
  isCommish: boolean;
  /** Deep link (v0.356.3): open the propose sheet pointed at this seat. */
  presetPartner?: number | null;
  onChanged: () => void;
}) {
  const t = useTheme();
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [signals, setSignals] = useState<TradeSignalRow[]>([]);
  const [assets, setAssets] = useState<PickAssetRow[]>([]);          // tradeable picks: futures (0183) + startup slots (0190)
  const [pickTradingOn, setPickTradingOn] = useState(true);          // the commissioner's switch (0190)
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
  // Contract leagues (0219): the salary terms an offer can carry. `retain` is
  // per traded slug — how much the CURRENT owner keeps eating; capDraft/capDir
  // move raw cap dollars (+ = I send room, − = I ask for room).
  const [contracts, setContracts] = useState<LeagueContracts | null>(null);
  const [retain, setRetain] = useState<Record<string, number>>({});
  const [capDraft, setCapDraft] = useState('');
  const [capDir, setCapDir] = useState<1 | -1>(1);
  // 0321: FAAB as an asset, the offer's own clock, and the offer this one
  // answers (set = the sheet is composing a counter, not a fresh proposal).
  const [faabDraft, setFaabDraft] = useState('');
  const [faabDir, setFaabDir] = useState<1 | -1>(1);
  const [expiryHours, setExpiryHours] = useState<number | null>(null);
  const [counterOf, setCounterOf] = useState<string | null>(null);
  // 0322: the seats beyond me and the partner. One of them turns the sheet
  // into a multi-team builder, where every asset names where it GOES rather
  // than which of two piles it is in.
  const [extraTeams, setExtraTeams] = useState<number[]>([]);
  const [dest, setDest] = useState<Record<string, number>>({});
  const [pickDest, setPickDest] = useState<Record<string, number>>({});
  const [faabTarget, setFaabTarget] = useState<number | null>(null);
  // 0328: the league's lineup spec and scoring — what the trade grade reads
  // the replacement line off.
  const [mode, setMode] = useState<GameModeInfo | null>(null);

  const load = () => Promise.all([
    leagueTrades(leagueId).then((x) => { if (Array.isArray(x)) setTrades(x); }),
    tradeSignals(leagueId).then((s) => { if (Array.isArray(s)) setSignals(s); }),
    leagueContracts(leagueId).then((c) => setContracts(c.contracts ? c : null)).catch(() => {}),
    leagueGameMode(leagueId).then((m) => { if (m.ok) setMode(m); }).catch(() => {}),
    pickAssets(leagueId).then((a) => {
      if (!a.ok) return;
      setPickTradingOn(a.pick_trading !== false);
      // FUTURE picks (dynasty holds a 3-year horizon, 0185) — and since 0190
      // THIS season's slots too. The draft in front of you used to be the one
      // draft whose picks you couldn't deal; now a startup slot is an asset
      // like any other, which is also what makes a MIXED offer work — the two
      // kinds are rows in one list and one trade carries both.
      setAssets(a.picks.filter((p) =>
        (a.future_season != null && p.season >= a.future_season) || p.kind === 'startup'));
    }),
  ]).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  // WHILE A DEAL IS IN FLIGHT, KEEP UP (v0.456.0) — see the web TradeCenter.
  const inFlight = trades.some((t) => t.status === 'pending' || t.status === 'review');
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => { leagueTrades(leagueId).then((x) => { if (Array.isArray(x)) setTrades(x); }).catch(() => {}); }, 20000);
    return () => clearInterval(id);
  }, [leagueId, inFlight]);

  const teamName = (rid: number) => teams.find((x) => x.roster_id === rid)?.team ?? `Team ${rid}`;
  const pname = (s: string) => poolBySlug.get(s)?.full_name ?? s;
  // A contract league trades DEALS, not just players (v0.355.9, founder: "in
  // trades, we should see the contracts") — every surface that names a
  // player prints his terms beside him. Null in a contract-free league.
  const dealTag = (s: string) => {
    const d = contracts?.deals?.find((x) => x.slug === s);
    return d ? `$${d.salary}·${d.years}yr${d.tagged ? ' ⭐' : ''}` : null;
  };
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
  /** "2027 R1" — plus whose original slot it is when it was acquired. A startup
   *  slot says DRAFT rather than a season, because "2026 R1" next to "2027 R1"
   *  reads as two future picks when one of them is a slot in the draft running
   *  right now. */
  const pickAssetLabel = (p: { season: string; round: number; orig: number; kind?: string }, holder: number) =>
    `${p.kind === 'startup' ? 'DRAFT' : p.season} R${p.round}${p.orig !== holder ? ` (${teamName(p.orig)}’s slot)` : ''}`;
  /** One seat's side of a multi-team deal (0322): every asset with the seat
   *  it is addressed to, since that is the only thing that says what the
   *  trade actually is. */
  const legLine = (l: NonNullable<TradeRow['legs']>[number]) => [
    ...l.send.map((v) => `${pname(v.slug)} → ${teamName(v.to)}`),
    ...l.send_picks.map((p) => `${pickAssetLabel(p, l.roster_id)} → ${teamName(p.to)}`),
    ...l.send_faab.map((f) => `$${f.amount} FAAB → ${teamName(f.to)}`),
    ...l.send_cap.map((f) => `$${f.amount} cap → ${teamName(f.to)}`),
  ].join(', ') || 'nothing';
  const tradeLine = (x: TradeRow, side: 'give' | 'get') => {
    const slugs = (side === 'give' ? x.give : x.get)
      .map((s) => { const dt = dealTag(s); return dt ? `${pname(s)} (${dt})` : pname(s); });
    const rid = side === 'give' ? x.from_roster : x.to_roster;
    const picks = ((side === 'give' ? x.give_picks : x.get_picks) ?? []).map((p) => `${pickAssetLabel(p, rid)}`);
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
  // Deep link from 👥 Teams & rosters (v0.356.3): arrive with the propose
  // sheet already pointed at the seat whose roster you were just reading.
  useEffect(() => {
    if (presetPartner != null) openPreset(presetPartner, [], []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetPartner]);

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

  const capDollars = (parseInt(capDraft, 10) || 0) * capDir;
  const faabDollars = (parseInt(faabDraft, 10) || 0) * faabDir;
  const nothingOffered = give.length + get.length + givePicks.length + getPicks.length
    + Math.abs(capDollars) + Math.abs(faabDollars) === 0;
  const closeSheet = () => {
    setOpen(false); setCounterOf(null); setPartner(null); setGive([]); setGet([]);
    setGivePicks([]); setGetPicks([]); setNote('');
    setRetain({}); setCapDraft(''); setCapDir(1); setFaabDraft(''); setFaabDir(1); setExpiryHours(null);
    setExtraTeams([]); setDest({}); setPickDest({}); setFaabTarget(null);
  };
  // An offer answered with an offer (0321): the same sheet, filed by a
  // different RPC, with the two seats already decided.
  const openCounter = (x: TradeRow) => {
    tap();
    setCounterOf(x.id); setPartner(x.from_roster);
    setGive(x.get); setGet(x.give); setGivePicks([]); setGetPicks([]);
    setExtraTeams([]); setDest({}); setPickDest({}); setFaabTarget(null);
    setNote(''); setRetain({}); setCapDraft(''); setCapDir(1); setFaabDraft(''); setFaabDir(1);
    setExpiryHours(null); setErr(null); setOpen(true);
  };
  // 0322: every seat in the deal, the proposer first; ≥3 switches the sheet.
  const teamsIn = myRoster != null && partner != null ? [myRoster, partner, ...extraTeams] : [];
  const isMulti = teamsIn.length > 2;
  const pickKey = (p: { season: string; round: number; orig: number }) => `${p.season}/${p.round}/${p.orig}`;
  /** The next team round the ring — the carousel most of these deals are. */
  const nextSeat = (rid: number) => teamsIn[(teamsIn.indexOf(rid) + 1) % teamsIn.length];
  const holderOf = (slug: string) => rosters.find((r) => r.slug === slug)?.roster_id ?? null;
  const multiAssets = Object.keys(dest).length + Object.keys(pickDest).length;
  // 0328: WHAT IS THIS WORTH — computed here rather than fetched, because the
  // projections and the league's scoring both live in core and the answer has
  // to move as the piles do. Two-seat offers only: a three-way has no "your
  // side" to grade.
  const grade: GradeResult | null = (!isMulti && myRoster != null && partner != null
    && give.length + get.length + givePicks.length + getPicks.length > 0)
    ? gradeTrade({
      send: {
        players: give.map((sl) => ({ slug: sl, pos: poolBySlug.get(sl)?.pos ?? 'RB', team: poolBySlug.get(sl)?.team, sleeperId: poolBySlug.get(sl)?.sleeper_id })),
        picks: givePicks.map((p) => ({ season: p.season, round: p.round, kind: p.kind })),
        faab: faabDollars > 0 ? faabDollars : 0, cap: capDollars > 0 ? capDollars : 0,
      },
      receive: {
        players: get.map((sl) => ({ slug: sl, pos: poolBySlug.get(sl)?.pos ?? 'RB', team: poolBySlug.get(sl)?.team, sleeperId: poolBySlug.get(sl)?.sleeper_id })),
        picks: getPicks.map((p) => ({ season: p.season, round: p.round, kind: p.kind })),
        faab: faabDollars < 0 ? -faabDollars : 0, cap: capDollars < 0 ? -capDollars : 0,
      },
      pool: [...poolBySlug.values()].map((p) => ({ slug: p.slug, pos: p.pos, team: p.team, sleeperId: p.sleeper_id })),
      teams: teams.length || 10,
      slots: mode ? { roster: mode.roster, slots: mode.slots } : null,
      scoring: mode?.scoring,
    })
    : null;
  const proposeMulti = async () => {
    if (busy || myRoster == null || multiAssets === 0) return;
    setBusy(true); setErr(null);
    try {
      const legs = teamsIn.map((rid) => ({
        roster: rid,
        send: Object.entries(dest).filter(([slug]) => holderOf(slug) === rid).map(([slug, to]) => ({ slug, to })),
        send_picks: assets.filter((p) => p.owner === rid && pickDest[pickKey(p)] != null)
          .map((p) => ({ season: p.season, round: p.round, orig: p.orig, to: pickDest[pickKey(p)] })),
        ...(rid === myRoster && (parseInt(faabDraft, 10) || 0) > 0 && faabTarget != null
          ? { send_faab: [{ to: faabTarget, amount: parseInt(faabDraft, 10) }] } : {}),
      }));
      const r = await proposeMultiTrade(leagueId, legs, note.trim() || undefined, expiryHours ?? undefined);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not propose the trade.')); return; }
      commit(); closeSheet(); await load();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const propose = async () => {
    if (isMulti) return proposeMulti();
    if (busy || myRoster == null || partner == null || nothingOffered) return;
    setBusy(true); setErr(null);
    try {
      const retainTerms = [...give, ...get]
        .filter((s) => (retain[s] ?? 0) > 0)
        .map((s) => ({ slug: s, amount: retain[s] }));
      const gp = givePicks.map((p) => ({ season: p.season, round: p.round, orig: p.orig }));
      const tp = getPicks.map((p) => ({ season: p.season, round: p.round, orig: p.orig }));
      const r = counterOf
        ? await counterTrade(counterOf, give, get, note.trim() || undefined, gp, tp,
            retainTerms, capDollars || undefined, faabDollars || undefined, expiryHours ?? undefined)
        : await proposeTrade(leagueId, myRoster, partner, give, get, note.trim() || undefined, gp, tp,
            retainTerms, capDollars || undefined, faabDollars || undefined, expiryHours ?? undefined);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not propose the trade.')); return; }
      commit();
      closeSheet();
      await load();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const statusChip = (x: TradeRow) => {
    const [label, color] =
      x.status === 'pending' ? ['OFFERED', t.warn]
      : x.status === 'accepted' ? ['AWAITING COMMISH', t.warn]
      : x.status === 'review' ? ['LEAGUE VOTE', t.warn]
      : x.status === 'executed' ? ['EXECUTED', t.you]
      : x.status === 'vetoed' ? ['VETOED', t.opp]
      : x.status === 'expired' ? ['EXPIRED', t.faint]
      : x.status === 'countered' ? ['COUNTERED', t.faint]
      : x.status === 'reversed' ? ['REVERSED', t.opp]
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
            {/* ⓘ rather than the name itself: the whole row is the CHECKBOX
                here, and stealing the name from it would make picking players
                for a trade harder to hit. */}
            <Pressable hitSlop={8} onPress={() => openPlayerCard({ slug: r.slug, name: p?.full_name ?? r.slug, pos: p?.pos ?? '', team: p?.team ?? '' })}>
              <Mono size={9} tone="dim" weight="700">ⓘ</Mono>
            </Pressable>
            <Mono size={8} tone="faint">{p?.pos}</Mono>
            {dealTag(r.slug) != null && <Mono size={8} tone="dim" weight="700">{dealTag(r.slug)}</Mono>}
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

  // A side's tradeable draft picks — rookie futures (0183) and startup slots
  // (0190), in one list, which is what lets one offer carry both. Renders
  // nothing until there is something to trade, and nothing at all when the
  // commissioner has the switch off (better than offering picks the server
  // will refuse on submit).
  const pickAssetList = (rid: number | null, sel: PickAssetRow[], set: (v: PickAssetRow[]) => void) => {
    if (!pickTradingOn) return null;
    const owned = assets.filter((a) => a.owner === rid);
    if (owned.length === 0) return null;
    return (
      <View style={{ marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 4 }}>
        <Mono size={7.5} tone="faint" track={0.1} style={{ marginBottom: 2 }}>DRAFT PICKS</Mono>
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
        <Mono size={9} tone="faint" track={0.12}>⇄ TRADES{tradeReview === 'commish' ? ' · COMMISH REVIEWS'
          : tradeReview === 'league' ? ` · LEAGUE VOTES (${vetoNeed ?? 2}, ${reviewHours ?? 24}H)` : ''}</Mono>
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
            {/* 0322: a multi-team deal reads as one line per seat — it has no
                two sides to put either end of a sentence. A tick marks the
                seats that have already said yes. */}
            {x.legs ? (
              <Text style={{ flex: 1, fontSize: fs(11.5), color: t.text, lineHeight: fs(17) }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(9), color: t.warn }}>{x.legs.length}-TEAM{'\n'}</Text>
                {x.legs.map((l, i) => (
                  <Text key={l.roster_id}>
                    {i > 0 ? '\n' : ''}
                    <Text style={{ fontWeight: '700', color: l.roster_id === myRoster ? t.you : t.text }}>
                      {x.status === 'pending' ? (l.accepted ? '✓ ' : '· ') : ''}{teamName(l.roster_id)}
                    </Text>
                    {' '}sends {legLine(l)}
                  </Text>
                ))}
              </Text>
            ) : (
              <Text style={{ flex: 1, fontSize: fs(11.5), color: t.text, lineHeight: fs(17) }}>
                <Text style={{ fontWeight: '700', color: x.from_roster === myRoster ? t.you : t.text }}>{teamName(x.from_roster)}</Text>
                {' '}sends {tradeLine(x, 'give')}{'\n'}
                <Text style={{ fontWeight: '700', color: x.to_roster === myRoster ? t.you : t.text }}>{teamName(x.to_roster)}</Text>
                {' '}sends {tradeLine(x, 'get')}
              </Text>
            )}
            {statusChip(x)}
          </View>
          {/* salary terms ride the row so the accepting side SEES the money */}
          {(x.retain ?? []).length > 0 && (
            <Mono size={8.5} tone="warn" style={{ marginTop: 3 }}>
              {(x.retain ?? []).map((r) => `💸 ${teamName(r.roster)} retains $${r.amount} on ${pname(r.slug)}`).join(' · ')}
            </Mono>
          )}
          {!!x.cap_dollars && (
            <Mono size={8.5} tone="warn" style={{ marginTop: 3 }}>
              💵 {teamName(x.cap_dollars > 0 ? x.from_roster : x.to_roster)} sends ${Math.abs(x.cap_dollars)} of cap room
            </Mono>
          )}
          {/* 0321: FAAB rides the row for the same reason the salary terms do —
              the side being asked has to SEE the money before it agrees. */}
          {!!x.faab_dollars && (
            <Mono size={8.5} tone="warn" style={{ marginTop: 3 }}>
              💵 {teamName(x.faab_dollars > 0 ? x.from_roster : x.to_roster)} sends ${Math.abs(x.faab_dollars)} of FAAB
            </Mono>
          )}
          {!!x.note && <Mono size={8.5} tone="faint" style={{ marginTop: 3 }}>“{x.note}”</Mono>}
          {x.status === 'pending' && !!fmtTimeLeft(x.expires_at) && (
            <Mono size={8.5} tone="faint" style={{ marginTop: 3 }}>⏳ offer {fmtTimeLeft(x.expires_at)}</Mono>
          )}
          {/* THE FLOOR (0321). Everyone sees the tally; only a seat outside the
              deal may move it. An allow is a real vote — it is what closes a
              window early once a veto is out of reach. */}
          {x.status === 'review' && (() => {
            const tally = voteTally(x.votes);
            const mine = (x.votes ?? []).find((v) => v.roster_id === myRoster);
            // A seat in the deal does not vote on it — and a MULTI-TEAM deal's
            // row names only two of its seats; the rest are legs (v0.456.0).
            const canVote = myRoster != null && myRoster !== x.from_roster && myRoster !== x.to_roster
              && !(x.legs ?? []).some((l) => l.roster_id === myRoster);
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <Mono size={8.5} tone="warn">
                  🗳 {tally.vetoes} of {x.veto_need ?? vetoNeed ?? 2} vetoes
                  {tally.allows > 0 ? ` · ${tally.allows} allowed` : ''}
                  {fmtTimeLeft(x.review_until) ? ` · vote ${fmtTimeLeft(x.review_until)}` : ''}
                </Mono>
                {canVote && (
                  <>
                    <Chip label={mine?.veto ? '✓ VETOED' : '🚫 VETO'} on={mine?.veto === true} disabled={busy}
                      onPress={() => { tap(); void act(() => castTradeVote(x.id, true)); }} />
                    <Chip label={mine && !mine.veto ? '✓ ALLOWED' : '👍 ALLOW'} on={mine?.veto === false} disabled={busy}
                      onPress={() => { tap(); void act(() => castTradeVote(x.id, false)); }} />
                  </>
                )}
              </View>
            );
          })()}
          {(x.status === 'pending' || x.status === 'accepted' || x.status === 'review'
            || (isCommish && x.status === 'executed')) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {x.status === 'pending' && !x.legs && x.to_roster === myRoster && (
                <>
                  <Chip label="✓ ACCEPT" on disabled={busy} onPress={() => { tap(); void act(() => respondTrade(x.id, true)); }} />
                  <Chip label="⇄ COUNTER" disabled={busy} onPress={() => openCounter(x)} />
                  <Chip label="✕ DECLINE" disabled={busy} onPress={() => { tap(); void act(() => respondTrade(x.id, false)); }} />
                </>
              )}
              {/* 0322: my seat answers for itself, and a no from anyone in it
                  kills the whole deal — which the chip says. */}
              {x.status === 'pending' && x.legs?.some((l) => l.roster_id === myRoster && !l.accepted) && (
                <>
                  <Chip label="✓ ACCEPT MY LEG" on disabled={busy} onPress={() => { tap(); void act(() => respondTrade(x.id, true)); }} />
                  <Chip label="✕ KILL THE DEAL" disabled={busy} onPress={() => { tap(); void act(() => respondTrade(x.id, false)); }} />
                </>
              )}
              {x.status === 'pending' && x.from_roster !== myRoster
                && x.legs?.some((l) => l.roster_id === myRoster && l.accepted) && (
                <Mono size={8.5} tone="faint">waiting on the other seats</Mono>
              )}
              {x.from_roster === myRoster && x.status === 'pending' && (
                <Chip label="withdraw" disabled={busy} onPress={() => { tap(); void act(() => cancelTrade(x.id)); }} />
              )}
              {/* 0328: the commissioner's undo, on a completed deal. */}
              {isCommish && x.status === 'executed' && (
                <Chip label="↩ REVERSE" disabled={busy}
                  onPress={() => { tap(); Alert.alert('Reverse this trade?',
                    'Everything goes back where it was — players, picks, dollars, cap. Every manager in the deal sees it.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Reverse', style: 'destructive', onPress: () => void act(() => commishReverseTrade(x.id)) },
                    ]); }} />
              )}
              {/* the ruling, on the same card (see header) — and over a vote
                  in progress too, which the commissioner outranks. */}
              {isCommish && (x.status === 'accepted' || x.status === 'review') && (
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
              <Mono size={8.5} tone="faint">{p?.pos}{dealTag(s.slug) ? ` · ${dealTag(s.slug)}` : ''} · {mineRow ? 'your player' : teamName(s.roster_id)}</Mono>
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
      <Overlay visible={open && myRoster != null}
        title={counterOf ? 'Counter the offer' : isMulti ? `${teamsIn.length}-team trade` : 'Propose a trade'}
        subtitle={tradeReview === 'commish' ? 'Accepted trades go to the commissioner for a ruling.'
          : tradeReview === 'league' ? `Accepted trades go to the league — ${vetoNeed ?? 2} vetoes in ${reviewHours ?? 24}h kill one.`
          : 'Accepted trades execute immediately.'}
        onClose={closeSheet}
        footer={
          // PINNED (v0.456.0): the composer grew a FAAB row, the grade, the
          // expiry chips and a per-seat builder this round, and a three-way
          // ran past the sheet's 92% with the send button clipped off the
          // bottom — a manager could build the deal and never file it.
          <>
            {!!err && <Mono size={9.5} tone="opp" style={{ marginBottom: 6 }}>{err}</Mono>}
            <PrimaryButton label={busy ? '…' : counterOf ? '⇄ SEND THE COUNTER'
              : isMulti ? `⇄ SEND THE ${teamsIn.length}-TEAM OFFER` : '⇄ SEND THE OFFER'}
              disabled={busy || partner == null || (isMulti ? multiAssets === 0 : nothingOffered)}
              onPress={() => void propose()} />
          </>
        }>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        <Mono size={9} tone="faint" track={0.1}>TRADE WITH</Mono>
        {/* A counter answers ONE offer, so its seats are already decided —
            changing them here would quietly make it a different proposal. */}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {teams.filter((x) => x.roster_id !== myRoster).map((x) => (
            <Chip key={x.roster_id} label={x.team ?? `Team ${x.roster_id}`} on={partner === x.roster_id}
              onPress={() => { if (!counterOf) { tap(); setPartner(x.roster_id); setGet([]); } }} />
          ))}
        </View>
        {/* A THIRD TEAM (0322). Adding one turns the two piles below into a
            per-seat builder: in a three-way "you get" means nothing, because
            every asset names where it goes. A counter stays two-seat. */}
        {partner != null && !counterOf && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <Mono size={7.5} tone="faint" track={0.1}>＋ A THIRD TEAM</Mono>
            {teams.filter((x) => x.roster_id !== myRoster && x.roster_id !== partner).map((x) => (
              <Chip key={x.roster_id} label={x.team ?? `Team ${x.roster_id}`} on={extraTeams.includes(x.roster_id)}
                onPress={() => { tap(); setExtraTeams((v) => v.includes(x.roster_id)
                  ? v.filter((y) => y !== x.roster_id) : [...v, x.roster_id]); }} />
            ))}
          </View>
        )}
        {partner != null && !isMulti && (
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
        {/* THE MULTI-TEAM BUILDER (0322): one block per seat, each asset
            tapped and then pointed at whoever receives it. The default is the
            next team round the ring; one tap moves it anywhere in the room. */}
        {isMulti && teamsIn.map((rid) => (
          <View key={`leg-${rid}`} style={{ marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 6 }}>
            <Mono size={8} tone="faint" track={0.1}>{(teamName(rid) ?? '').toUpperCase()} SENDS{rid === myRoster ? ' (YOU)' : ''}</Mono>
            <ScrollView style={{ maxHeight: 170, marginTop: 4 }} nestedScrollEnabled>
              {rosters.filter((r) => r.roster_id === rid).map((r) => {
                const to = dest[r.slug];
                const p = poolBySlug.get(r.slug);
                return (
                  <View key={r.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingVertical: 3 }}>
                    <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, flexBasis: 120 }}
                      onPress={() => { tap(); setDest((v) => {
                        const n = { ...v };
                        if (n[r.slug] != null) delete n[r.slug]; else n[r.slug] = nextSeat(rid);
                        return n;
                      }); }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11), color: to != null ? t.you : t.text, fontWeight: to != null ? '700' : '400' }}>
                        {to != null ? '☑' : '☐'} {p?.full_name ?? r.slug}
                      </Text>
                    </Pressable>
                    {to != null && teamsIn.filter((x) => x !== rid).map((x) => (
                      <Chip key={x} label={`→ ${teams.find((y) => y.roster_id === x)?.team ?? `Team ${x}`}`} on={to === x}
                        onPress={() => { tap(); setDest((v) => ({ ...v, [r.slug]: x })); }} />
                    ))}
                  </View>
                );
              })}
              {pickTradingOn && assets.filter((p) => p.owner === rid).map((p) => {
                const k = pickKey(p);
                const to = pickDest[k];
                return (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingVertical: 3 }}>
                    <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, flexBasis: 120 }}
                      onPress={() => { tap(); setPickDest((v) => {
                        const n = { ...v };
                        if (n[k] != null) delete n[k]; else n[k] = nextSeat(rid);
                        return n;
                      }); }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11), color: to != null ? t.warn : t.dim, fontWeight: to != null ? '700' : '400' }}>
                        {to != null ? '☑' : '☐'} 🎟 {pickAssetLabel(p, rid)}
                      </Text>
                    </Pressable>
                    {to != null && teamsIn.filter((x) => x !== rid).map((x) => (
                      <Chip key={x} label={`→ ${teams.find((y) => y.roster_id === x)?.team ?? `Team ${x}`}`} on={to === x}
                        onPress={() => { tap(); setPickDest((v) => ({ ...v, [k]: x })); }} />
                    ))}
                  </View>
                );
              })}
            </ScrollView>
            {rid === myRoster && faabTrading && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <Mono size={7.5} tone="faint" track={0.1}>💵 FAAB $</Mono>
                <TextInput value={faabDraft} keyboardType="number-pad" maxLength={5} placeholder="0" placeholderTextColor={t.faint}
                  onChangeText={(v) => setFaabDraft(v.replace(/[^0-9]/g, ''))}
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: fs(12), color: t.text, backgroundColor: t.bg, width: 58 }} />
                {(parseInt(faabDraft, 10) || 0) > 0 && teamsIn.filter((x) => x !== myRoster).map((x) => (
                  <Chip key={x} label={`→ ${teams.find((y) => y.roster_id === x)?.team ?? `Team ${x}`}`} on={faabTarget === x}
                    onPress={() => { tap(); setFaabTarget(x); }} />
                ))}
              </View>
            )}
          </View>
        ))}
        {/* ── SALARY TERMS (0219, contract leagues): retention steppers on the
            traded deals, and raw cap dollars when the commissioner allows. ── */}
        {contracts?.rules?.retention && !isMulti && [...give, ...get].some((s) => (contracts.deals ?? []).some((d) => d.slug === s && d.salary > 1)) && (
          <View style={{ marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 6 }}>
            <Mono size={7.5} tone="faint" track={0.1}>💸 RETAINED SALARY — the sender keeps eating this much</Mono>
            {[...give, ...get].map((s) => {
              const d = (contracts.deals ?? []).find((x) => x.slug === s);
              if (!d || d.salary <= 1) return null;
              const maxR = d.salary - 1 - (d.retained ?? 0);
              if (maxR < 1) return null;
              const cur = retain[s] ?? 0;
              return (
                <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11), color: t.text }}>
                    {pname(s)} <Text style={{ color: t.dim, fontSize: fs(9.5) }}>${d.salary}·{d.years}yr</Text>
                  </Text>
                  <Pressable hitSlop={6} disabled={cur <= 0} onPress={() => { tap(); setRetain((r) => ({ ...r, [s]: Math.max(0, cur - 1) })); }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(15), color: t.dim }}>−</Text>
                  </Pressable>
                  <Mono size={10} weight="700" tone={cur > 0 ? 'warn' : 'faint'} style={{ minWidth: 30, textAlign: 'center' }}>${cur}</Mono>
                  <Pressable hitSlop={6} disabled={cur >= maxR} onPress={() => { tap(); setRetain((r) => ({ ...r, [s]: Math.min(maxR, cur + 1) })); }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(15), color: t.dim }}>＋</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
        {contracts?.rules?.cap_trading && !isMulti && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <Mono size={7.5} tone="faint" track={0.1}>💵 CAP DOLLARS</Mono>
            <Chip label="I SEND" on={capDir === 1} onPress={() => { tap(); setCapDir(1); }} />
            <Chip label="I ASK" on={capDir === -1} onPress={() => { tap(); setCapDir(-1); }} />
            <TextInput value={capDraft} keyboardType="number-pad" maxLength={5} placeholder="0" placeholderTextColor={t.faint}
              onChangeText={(v) => setCapDraft(v.replace(/[^0-9]/g, ''))}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: fs(12), color: t.text, backgroundColor: t.bg, width: 58 }} />
          </View>
        )}
        {/* FAAB DOLLARS (0321) — the cap-room row's FAAB-league sibling. */}
        {faabTrading && !isMulti && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <Mono size={7.5} tone="faint" track={0.1}>💵 FAAB $</Mono>
            <Chip label="I SEND" on={faabDir === 1} onPress={() => { tap(); setFaabDir(1); }} />
            <Chip label="I ASK" on={faabDir === -1} onPress={() => { tap(); setFaabDir(-1); }} />
            <TextInput value={faabDraft} keyboardType="number-pad" maxLength={5} placeholder="0" placeholderTextColor={t.faint}
              onChangeText={(v) => setFaabDraft(v.replace(/[^0-9]/g, ''))}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: fs(12), color: t.text, backgroundColor: t.bg, width: 58 }} />
            {myFaab != null && <Mono size={8.5} tone="faint">you have ${myFaab}</Mono>}
          </View>
        )}
        {/* WHAT IS IT WORTH (0328) — the two sides' projected points over
            replacement rather than a letter, so it can be argued with. */}
        {grade && (
          <View style={{ marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 7 }}>
            <Mono size={7.5} tone="faint" track={0.1}>⚖ WHAT IT'S WORTH</Mono>
            <Mono size={10} weight="700" tone={grade.verdict === 'for' ? 'you' : grade.verdict === 'against' ? 'opp' : 'warn'}
              style={{ marginTop: 3, lineHeight: fs(14) }}>{grade.summary}</Mono>
            <Mono size={8.5} tone="faint" style={{ marginTop: 3 }}>
              you send {grade.out} · you get {grade.in}
              {grade.missing.length > 0 ? ` · ${grade.missing.length} unprojected` : ''}
            </Mono>
            <Mono size={8} tone="faint" style={{ marginTop: 3, lineHeight: fs(12) }}>
              Projected season points above the best player left in the pool at that spot, in this league's scoring. It does not know your record or your plans.
            </Mono>
          </View>
        )}
        {/* HOW LONG IT STANDS (0321). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Mono size={7.5} tone="faint" track={0.1}>⏳ STANDS FOR</Mono>
          <Chip label={offerDays ? `${offerDays}D (LEAGUE)` : 'UNTIL ANSWERED'} on={expiryHours === null}
            onPress={() => { tap(); setExpiryHours(null); }} />
          {[6, 24, 72].map((h) => (
            <Chip key={h} label={h < 24 ? `${h}H` : `${h / 24}D`} on={expiryHours === h}
              onPress={() => { tap(); setExpiryHours(h); }} />
          ))}
          {!!offerDays && <Chip label="NO LIMIT" on={expiryHours === -1} onPress={() => { tap(); setExpiryHours(-1); }} />}
        </View>
        <TextInput value={note} maxLength={140} placeholder="Add a note (optional)…" placeholderTextColor={t.faint}
          onChangeText={setNote}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(12.5), color: t.text, backgroundColor: t.bg, marginTop: 10 }} />
        </ScrollView>
      </Overlay>
    </Card>
  );
}
