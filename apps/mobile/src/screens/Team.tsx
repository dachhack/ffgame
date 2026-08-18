// Team management for native leagues — roster, free agency, waivers, FAAB.
//
// Port of the web TeamManage (src/screens/NativeLeague.tsx). Same self-driving
// rule: process_waivers runs on load (idempotent), so due claims clear even
// with no worker awake. Same gates, same order of decisions: waived player →
// claim (FAAB leagues collect the blind bid first), free agent → instant add,
// roster full → pick a drop before either.
//
// Everything the web TeamManage does lives here now — waivers/FAAB, trades
// (ui/TradeCenter), the avatar grid (ui/AvatarGrid), and the commissioner's
// whole kit. The old "web only for now" list is empty.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  addFreeAgent, cancelWaiverClaim,
  friendlyError, leagueInvite, leaguePool, nativeRosters, setRosterSpot,
  nativeTeamState, processWaivers, setTeamAvatar, setTeamName, submitWaiverClaim, POS_CAP_KEYS,
  myFavorites, loadTeamOverrides, playerFlags, leaguePoolExp,
  keeperState, setKeepers, type KeeperState,
  leagueGameMode, type GameModeInfo,
  type LeaguePoolPlayer, type NativeTeamState,
} from '@drip/core/data/liveApi';
import { inviteMessage } from '@drip/core/data/invite';
import { leagueSlotDefs, slotDisplayNames, slotBadgeLabel, assignSpots } from '@drip/core/engine/classic';
import { TENURE_BANDS, tenureMatches, type TenureBand } from '@drip/core/data/tenure';
import { headshot } from '@drip/core/data/media';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PosPill, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { AvatarGrid } from '../ui/AvatarGrid';
import { openPlayerCard } from '../ui/PlayerCardSheet';

import { TradeCenter } from '../ui/TradeCenter';
import { starApply, STAR_GOLD, type StarMode } from '../ui/stars';
import { FlagChip } from '../ui/rosterGroup';
import { setLeagueFlags } from '@drip/core/data/commish';
import { onRosterChanged, notifyRosterChanged } from '@drip/core/data/rosterBus';

/** Every spot chip is this wide, so the player column starts at the same x on
 *  every row (v0.289.0).
 *
 *  Sized from the arithmetic, not by eye: the longest label the badge form
 *  produces is "SUPERFLEX" (9 characters), and the chip's `fs(8.5)` resolves to
 *  ELEVEN points, not 8.5 — theme.native's type lift pulls small sizes toward
 *  its 15pt pivot. At a monospace advance of ~0.6em that is 9 × 11 × 0.6 ≈ 59pt
 *  of glyphs plus 8pt of padding ≈ 67pt, so 72 clears it with a little slack.
 *  Undersizing here does not truncate, it breaks a single word mid-glyph, which
 *  is why the slack is deliberate. Two lines are available above that for a
 *  commissioner's own longer name. */
const BADGE_W = 72;

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P'] as const;

function fmtEtMin(m: number): string {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`;
}

// ── Keepers (0182): declare who you carry into next season ──────────────────
// Mirror of the web KeepersCard. Renders nothing unless the commissioner set
// a keeper count; undeclared spots auto-fill by rank at rollover.
function KeepersCard({ leagueId, myRoster, mine }: {
  leagueId: string; myRoster: number; mine: (LeaguePoolPlayer & { spot: string })[];
}) {
  const t = useTheme();
  const [st, setSt] = useState<KeeperState | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    const s = await keeperState(leagueId);
    if (s.error || !s.ok) return;
    setSt(s);
    setSel(new Set(s.teams.find((x) => x.roster_id === myRoster)?.declared ?? []));
    setDirty(false);
  };
  useEffect(() => { void load().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId, myRoster]);
  if (!st || st.keeper_count === 0) return null;

  const rolled = !!st.rolled_league_id;
  const carried = st.teams.find((x) => x.roster_id === myRoster)?.keep ?? [];
  const nameOf = (slug: string) => mine.find((p) => p.slug === slug)?.full_name ?? slug;
  const toggle = (slug: string) => {
    if (rolled || busy) return;
    tap();
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < st.keeper_count) next.add(slug);
      else return cur;
      return next;
    });
    setDirty(true); setNote(null);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setKeepers(leagueId, myRoster, [...sel]);
      if (r.ok) { commit(); setNote('✓ saved'); await load(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card style={{ borderLeftWidth: 3, borderLeftColor: t.you }}>
      <Mono size={9} tone="faint" track={0.12}>
        ★ KEEPERS{st.next_season ? ` FOR ${st.next_season}` : ''} ({rolled ? carried.length : sel.size}/{st.keeper_count})
      </Mono>
      {rolled ? (
        <>
          <Mono size={9.5} tone="dim" style={{ marginTop: 6, lineHeight: fs(15) }}>
            The season rolled over — these carried into {st.next_season}:
          </Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {carried.map((k) => (
              <View key={k.slug} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(10.5), color: t.text }}>{k.declared ? '★ ' : ''}{nameOf(k.slug)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          <Mono size={9.5} tone="dim" style={{ marginTop: 6, lineHeight: fs(15) }}>
            Pick up to {st.keeper_count} to carry into next season. Spots you leave open auto-fill with your best-ranked players when the commissioner rolls the league over.
          </Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {mine.map((p) => {
              const on = sel.has(p.slug);
              return (
                <Pressable key={p.slug} disabled={busy} onPress={() => toggle(p.slug)}
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, backgroundColor: on ? t.you : 'transparent', borderRadius: 5, paddingHorizontal: 9, paddingVertical: 5, opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ fontFamily: MONO, fontSize: fs(10.5), fontWeight: '700', color: on ? t.onAccent : t.dim }}>{on ? '★ ' : ''}{p.full_name}</Text>
                </Pressable>
              );
            })}
          </View>
          {dirty && (
            <View style={{ marginTop: 10 }}>
              <PrimaryButton label={busy ? '…' : `SAVE KEEPERS (${sel.size}/${st.keeper_count})`} onPress={() => void save()} disabled={busy} />
            </View>
          )}
          {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 6 }}>{note}</Mono>}
        </>
      )}
    </Card>
  );
}

function Face({ slug, pos, size = 24 }: { slug: string; pos: string; size?: number }) {
  const t = useTheme();
  const src = headshot(slug);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {src
        ? <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        : <Text style={{ fontFamily: MONO, fontSize: size * 0.32, fontWeight: '700', color: t.faint }}>{pos}</Text>}
    </View>
  );
}

/** ONE ROSTER LINE — a spot badge, and who is in it.
 *
 *  The badge is the section's own language: a starting spot prints its NAME
 *  (QB, RB1, the commissioner's "NFC Flex"), tinted by the first position it
 *  accepts; bench/IR/taxi print BN/IR/TX. An EMPTY row is not a hole in the
 *  render — it is the answer to "how many more can I stash", which is why the
 *  IR and taxi sections draw their unused places too.
 *
 *  ONE FIXED BADGE WIDTH (v0.289.0, founder: "align the players in a column to
 *  the right and make the position label chips all the same size and large
 *  enough to accommodate labels"). The box was `minWidth: 40` and grew with its
 *  text, so a FLEX spot's chip ran three times the width of a QB's and shoved
 *  that one row's player out of the column every other row shared. Now every
 *  chip is `BADGE_W` wide whatever it says, which is what makes the faces and
 *  names line up — and the labels FIT rather than being cut to fit: the
 *  parenthetical eligibility comes off via `slotBadgeLabel` ("FLEX (RB/WR/TE)"
 *  → "FLEX"), and anything still long — a commissioner's own name — wraps to a
 *  second line inside the same box instead of widening it.
 *
 *  NO ACTION CHIPS (v0.285.0, founder). The line used to carry →TAXI and DROP
 *  next to every name, which put an irreversible red button one thumb-width
 *  from the name you meant to tap, and made "→TAXI" a cycle you had to press
 *  twice to reach IR. Both left:
 *
 *    • DESIGNATIONS are now the SLOTS' job — `onSlot` on an IR or taxi row.
 *      An empty one invites a player in; a filled one sends him back. That is
 *      what those sections are: places, with someone in them or not.
 *    • DROPPING is now the PLAYER CARD's job — one deliberate trip into a
 *      player, two taps to confirm, and the same button wherever you found him.
 */
function RosterRow({ badge, badgePos, tone, p, busy, t, onSlot, slotVerb }: {
  badge: string;
  /** First position the spot accepts — colours the badge like the board's. */
  badgePos?: string;
  tone?: 'warn' | 'you';
  p: (LeaguePoolPlayer & { spot: string }) | null;
  busy: boolean;
  t: ReturnType<typeof useTheme>;
  /** IR/taxi only: fill this place, or empty it. Absent on starters + bench. */
  onSlot?: () => void;
  /** What an empty one is offering — "TAXI SQUAD", "INJURED RESERVE". */
  slotVerb?: string;
}) {
  const posC = badgePos ? t.pos[badgePos as keyof typeof t.pos] : undefined;
  const fg = tone === 'warn' ? t.warn : tone === 'you' ? t.you : posC?.fg ?? t.dim;
  const bg = tone ? 'transparent' : posC?.bg ?? 'transparent';
  const badgeBox = (
    <View style={{ width: BADGE_W, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: fg, backgroundColor: bg, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 4 }}>
      <Text numberOfLines={2} style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: fg, textAlign: 'center' }}>
        {slotBadgeLabel(badge)}{p && onSlot ? ' ↩' : ''}
      </Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
      {/* On a FILLED taxi/IR place the badge is the way out — tap TX ↩ and he
          is back on the active roster. Nothing else on the line moves him, so
          the badge is unambiguous rather than one control among three. */}
      {p && onSlot
        ? <Pressable disabled={busy} onPress={onSlot} hitSlop={6} style={{ opacity: busy ? 0.5 : 1 }}>{badgeBox}</Pressable>
        : badgeBox}
      {p ? (
        <>
          <Face slug={p.slug} pos={p.pos} />
          <Pressable style={{ flex: 1, minWidth: 0 }} hitSlop={4}
            onPress={() => { tap(); openPlayerCard({ slug: p.slug, name: p.full_name, pos: p.pos, team: p.team }); }}>
            <Text numberOfLines={1} style={{ fontSize: fs(12.5), color: t.text }}>{p.full_name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
              <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.pos[p.pos as keyof typeof t.pos]?.fg ?? t.dim }}>{p.pos}</Text>
              <Mono size={8.5} tone="faint">{p.team}</Mono>
              <FlagChip slug={p.slug} size={7.5} />
            </View>
          </Pressable>
        </>
      ) : onSlot ? (
        <Pressable disabled={busy} onPress={onSlot} hitSlop={4} style={{ flex: 1, opacity: busy ? 0.5 : 1 }}>
          <Mono size={10.5} tone="dim">＋ move someone to the {slotVerb ?? 'squad'}</Mono>
        </Pressable>
      ) : (
        <Text style={{ flex: 1, fontFamily: MONO, fontSize: fs(11), color: t.faint }}>Empty</Text>
      )}
    </View>
  );
}

export function Team({ leagueId, onBack, onDraft }: { leagueId: string; onBack: () => void; onDraft: () => void }) {
  const t = useTheme();
  // The screen's TABS (v0.268.0): one area at a time, ROSTER first — the
  // founder's call, same shape as the commish map. Identity and the
  // over-limit warning stay above the tabs; modals are tab-agnostic.
  const [tab, setTab] = useState<'roster' | 'waivers' | 'trades'>('roster');
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [rosters, setRosters] = useState<{ roster_id: number; slug: string; spot?: 'active' | 'taxi' | 'ir' }[]>([]);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>('ALL');
  // Waiver-wire filters beyond position (founder): tenure band and NFL team.
  const [tenure, setTenure] = useState<TenureBand>('any');
  const [nflTeam, setNflTeam] = useState('ALL');
  const [expMap, setExpMap] = useState<Record<string, number>>({});
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [starMode, setStarMode] = useState<StarMode>('off');
  const [, setFlagVer] = useState(0); // commish flags landed in the cache (0141)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<LeaguePoolPlayer | null>(null); // roster full → pick a drop
  // Which empty place is asking to be filled — 'taxi' or 'ir' (v0.285.0).
  const [fillFor, setFillFor] = useState<'taxi' | 'ir' | null>(null);
  const [claimFor, setClaimFor] = useState<{ p: LeaguePoolPlayer; drop?: string } | null>(null); // FAAB blind bid
  const [bidDraft, setBidDraft] = useState('');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [myArtOpen, setMyArtOpen] = useState(false);       // own team art
  // The league's LINEUP SHAPE (v0.281.0) — what the roster tab lays itself out
  // against: the starting spots, and how many bench/IR/taxi places exist.
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  const skew = useRef(0);

  const refresh = async () => {
    try {
      // Clearing due waiver claims first keeps this screen self-driving even
      // with no worker running (process_waivers is idempotent).
      await processWaivers(leagueId).catch(() => {});
      const [tm, r, p] = await Promise.all([nativeTeamState(leagueId), nativeRosters(leagueId), leaguePool(leagueId)]);
      if (tm.error) { setErr(friendlyError(tm.error)); return; }
      skew.current = Date.parse(tm.server_now) - Date.now();
      setTeam(tm); setRosters(r); setPool(p); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => {
    void refresh();
    myFavorites().then(setFavs).catch(() => {});
    void loadTeamOverrides();
    playerFlags(leagueId).then((f) => { if (Array.isArray(f)) { setLeagueFlags(leagueId, f); setFlagVer((v) => v + 1); } }).catch(() => {});
    // years_exp by slug — the tenure filter's data. A failed read leaves the
    // map empty, so every band except ANY comes back empty rather than wrong.
    leaguePoolExp(leagueId).then(setExpMap).catch(() => {});
    leagueGameMode(leagueId).then((g) => { if (g.ok) setGm(g); }).catch(() => {});
    // A drop made from the PLAYER CARD (v0.285.0) has no way to call this
    // screen — the card is a module-level overlay. It rings the bus instead,
    // so the roster updates on the tap rather than on the next poll.
    const off = onRosterChanged((id2) => { if (id2 === leagueId) void refresh(); });
    const id = setInterval(refresh, 15000);
    return () => { off(); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const poolBySlug = useMemo(() => new Map(pool.map((p) => [p.slug, p])), [pool]);
  const rostered = useMemo(() => new Set(rosters.map((r) => r.slug)), [rosters]);
  const myRoster = team?.my_roster_id ?? null;
  const mine = useMemo(() => rosters.filter((r) => r.roster_id === myRoster)
    .map((r) => { const p = poolBySlug.get(r.slug); return p ? { ...p, spot: r.spot ?? 'active' } : null; })
    .filter(Boolean) as (LeaguePoolPlayer & { spot: string })[], [rosters, myRoster, poolBySlug]);
  const cap = team?.roster_cap ?? null;
  const full = cap != null && mine.length >= cap;

  /** TAXI/IR designations (0164), driven by the PLACES rather than by a cycle
   *  button on every line (v0.285.0). Tapping an empty taxi place opens the
   *  picker below; tapping a filled one's badge sends him back to active. The
   *  server still enforces the caps and the IR injury gate and says why not. */
  const moveToSpot = (slug: string, spot: 'active' | 'taxi' | 'ir') => {
    tap();
    setFillFor(null);
    void run(() => setRosterSpot(leagueId, slug, spot));
  };

  // ── THE ROSTER, LAID OUT LIKE A ROSTER (v0.281.0, founder) ───────────────
  // Was one flat list of everybody with a spot badge; now it is the shape the
  // league actually plays: a row per STARTING SPOT, then the bench, then IR,
  // then the taxi squad — Sleeper's arrangement, which every manager already
  // reads without being taught.
  //
  // The starters half is `assignSpots` — the same maximum-matching the draft
  // room's TEAMS panel uses to answer "who is legal where". It is NOT a
  // submitted lineup: drip sets one per WINDOW on the board and classic sets
  // one per week, so the header says what this is rather than letting the
  // layout imply it.
  const slotDefs = useMemo(
    () => leagueSlotDefs({ roster: gm?.roster ?? {}, slots: gm?.slots ?? null }),
    [gm]);
  const slotNames = useMemo(() => slotDisplayNames(slotDefs), [slotDefs]);
  const bySpot = useMemo(() => {
    const active = mine.filter((p) => p.spot === 'active');
    const seat = assignSpots(slotDefs, active.map((p) => ({ id: p.slug, pos: p.pos, team: p.team, exp: expMap[p.slug] ?? null })));
    const find = (id?: string | null) => (id ? active.find((p) => p.slug === id) ?? null : null);
    const started = new Set(seat.spots.map((r) => r.player?.id).filter(Boolean) as string[]);
    return {
      starters: seat.spots.map((r, i) => ({ label: slotNames[i] ?? r.def.slot, pos: r.def.pos, player: find(r.player?.id) })),
      bench: active.filter((p) => !started.has(p.slug)),
      ir: mine.filter((p) => p.spot === 'ir'),
      taxi: mine.filter((p) => p.spot === 'taxi'),
    };
  }, [mine, slotDefs, slotNames, expMap]);

  const free = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = pool.filter((p) => !rostered.has(p.slug)
      && (pos === 'ALL' || p.pos === pos)
      && (nflTeam === 'ALL' || p.team.toUpperCase() === nflTeam)
      // Unknown tenure matches no band but ANY — the pool's no-guess rule.
      && tenureMatches(tenure, expMap[p.slug] ?? null, p.pos)
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
    return starApply(base, starMode, favs, (p) => p.slug);
  }, [pool, rostered, q, pos, nflTeam, tenure, expMap, starMode, favs]);
  /** The teams actually IN this pool, so the filter never offers an empty one. */
  const poolTeams = useMemo(
    () => [...new Set(pool.map((p) => p.team.toUpperCase()).filter(Boolean))].sort(),
    [pool]);

  const waivedFor = (p: LeaguePoolPlayer): number | null => {
    if (!p.waived_until) return null;
    const ms = Date.parse(p.waived_until) - (Date.now() + skew.current);
    return ms > 0 ? ms : null;
  };
  const fmtLeft = (ms: number) => {
    const h = Math.floor(ms / 3_600_000), m = Math.ceil((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'That didn’t work.')); } else { commit(); notifyRosterChanged(leagueId); }
      await refresh();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const doAdd = (p: LeaguePoolPlayer, dropSlug?: string) => {
    if (myRoster == null) return;
    setPendingAdd(null);
    const onWaivers = waivedFor(p) != null;
    // FAAB league: a claim carries a blind bid — ask for it first.
    if (onWaivers && team?.waiver_mode === 'faab') { setClaimFor({ p, drop: dropSlug }); setBidDraft(''); return; }
    void run(() => onWaivers
      ? submitWaiverClaim(leagueId, myRoster, p.slug, dropSlug)
      : addFreeAgent(leagueId, myRoster, p.slug, dropSlug));
  };
  const submitClaimBid = () => {
    if (myRoster == null || !claimFor) return;
    const bid = Math.max(0, parseInt(bidDraft || '0', 10) || 0);
    const { p, drop } = claimFor;
    setClaimFor(null); setBidDraft('');
    void run(() => submitWaiverClaim(leagueId, myRoster, p.slug, drop, bid));
  };
  const addOrClaim = (p: LeaguePoolPlayer) => { if (full) setPendingAdd(p); else doAdd(p); };

  // Recruit a friend: fetch the code (enrolled members may — 0123) and hand it
  // to the OS share sheet with the pitch attached.
  const shareInvite = async () => {
    tap();
    try {
      const r = await leagueInvite(leagueId);
      if (!r.ok || !r.invite_code) { warn(); setErr(friendlyError(r.error ?? 'could not fetch the invite code')); return; }
      // One message from every surface (v0.291.0) — and a LINK rather than four
      // characters to dictate. `?code=` was already a complete join path; these
      // buttons just weren't building the URL.
      await Share.share({
        message: inviteMessage({ league: r.name, code: r.invite_code, seatsOpen: r.seats_open }),
      });
    } catch { /* user dismissed the sheet — not an error */ }
  };

  if (!team) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {err ? <Mono size={10.5} tone="opp">{err}</Mono> : <ActivityIndicator color={t.you} />}
        <LinkButton label="← back" onPress={onBack} />
      </View>
    );
  }

  const identityCard = myRoster != null && (
    <Card style={{ borderLeftWidth: 3, borderLeftColor: t.you }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {nameDraft === null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Display size={16}>{team.my_team ?? `Team ${myRoster}`}</Display>
              <LinkButton label="✎ rename" onPress={() => { tap(); setNameDraft(team.my_team ?? ''); }} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={nameDraft} autoFocus maxLength={40} onChangeText={setNameDraft}
                style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, fontSize: fs(13), color: t.text, backgroundColor: t.bg }} />
              <Pressable disabled={busy || !nameDraft.trim()}
                onPress={() => { if (nameDraft.trim() && myRoster != null) void run(() => setTeamName(leagueId, myRoster, nameDraft)); setNameDraft(null); }}
                style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 12, justifyContent: 'center', opacity: busy || !nameDraft.trim() ? 0.5 : 1 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: t.onAccent }}>SAVE</Text>
              </Pressable>
            </View>
          )}
          {team.waiver_mode === 'faab' && team.my_faab != null && (
            <Mono size={9.5} tone="you" style={{ marginTop: 4 }}>💰 FAAB budget ${team.my_faab}</Mono>
          )}
          <LinkButton label="🖼 team art" onPress={() => { tap(); setMyArtOpen(true); }} />
        </View>
        <Pressable onPress={shareInvite} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.you }}>⇪ RECRUIT</Text>
        </Pressable>
      </View>
    </Card>
  );

  // Own-team art (the league-rule sheets live on the ⚑ COMMISH tab now).
  const settingsSheet = myRoster != null ? (
    <AvatarGrid visible={myArtOpen} title="Your team art" current={team.my_avatar}
      onClose={() => setMyArtOpen(false)}
      onPick={(url) => { setMyArtOpen(false); void run(() => setTeamAvatar(leagueId, myRoster, url)); }} />
  ) : null;

  if (team.draft_status !== 'complete') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Display size={17}>⇄ My team</Display>
          <View style={{ flex: 1 }} />
          <LinkButton label="← back" onPress={onBack} />
        </View>
        {!!err && <Notice tone="opp"><Mono size={10} tone="opp">{err}</Mono></Notice>}
        {identityCard}
        <Card>
          <Display size={15}>Rosters arrive at the draft</Display>
          <Mono size={10} style={{ marginTop: 8, lineHeight: fs(16) }}>
            Waivers and free agency open once the draft is complete. Set your team name now — it shows on the draft board. Use RECRUIT to bring friends in before draft night.
          </Mono>
          <View style={{ marginTop: 12 }}>
            <PrimaryButton label="⛏ TO THE DRAFT ROOM" onPress={onDraft} />
          </View>
        </Card>
        {settingsSheet}
      </ScrollView>
    );
  }

  const pendingClaims = team.my_claims.filter((c) => c.status === 'pending');
  const recentClaims = team.my_claims.filter((c) => c.status !== 'pending').slice(0, 5);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Display size={17}>⇄ My team</Display>
        <View style={{ flex: 1 }} />
        <LinkButton label="← back" onPress={onBack} />
      </View>
      {!!err && <Notice tone="opp"><Mono size={10} tone="opp">{err}</Mono></Notice>}
      {identityCard}

      {/* ── The TABS (v0.268.0, founder: "My Team needs to have tabs as well.
          Default to roster but all the other areas need to be tabbed.") —
          the screen was one long scroll of everything; now one area shows at
          a time, ROSTER first. Identity and the over-limit warning stay
          global: who you are and what's broken outrank any tab. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        {([
          ['roster', '🧢 ROSTER'],
          ['waivers', `✚ WAIVERS${pendingClaims.length ? ` (${pendingClaims.length})` : ''}`],
          ['trades', '⇄ TRADES'],
        ] as const).map(([id, label]) => (
          <Chip key={id} label={label} on={tab === id} onPress={() => { tap(); setTab(id); }} />
        ))}
      </View>

      {/* over-limit lockout: no adds/claims/weekly lineups until legal */}
      {team.roster_issue && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: t.opp }}>
          <Display size={13} tone="opp">⚠ Roster over its limits</Display>
          <Mono size={9.5} style={{ marginTop: 6, lineHeight: fs(15) }}>
            {team.roster_issue}. Adds, waiver claims, and weekly lineups are locked until your roster is legal — drops always work.
          </Mono>
        </Card>
      )}

      {/* my roster */}
      {tab === 'roster' && (<>
      <Card>
        <Mono size={9} tone="faint" track={0.12}>MY ROSTER ({mine.length}{cap != null ? `/${cap}` : ''})</Mono>
        {team.pos_caps && mine.length > 0 && (
          <Mono size={8.5} tone="faint" style={{ marginTop: 4 }}>
            {POS_CAP_KEYS.map((k) => `${k} ${mine.filter((p) => p.pos === k).length}/${team.pos_caps![k] ?? '∞'}`).join(' · ')}
          </Mono>
        )}
        {mine.length === 0 && <Mono size={10} tone="faint" style={{ marginTop: 6 }}>No players yet.</Mono>}

        {/* ── STARTERS ─────────────────────────────────────────────────────
            One row per starting spot the league plays, filled by assignSpots
            (max matching over who is LEGAL where). Deliberately labelled as
            the FIT, not the lineup: drip sets its lineup per window on the
            board and classic sets one per week, so calling this "your
            lineup" would be the one thing this screen must not say. */}
        {mine.length > 0 && slotDefs.length > 0 && (<>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
            <Mono size={9} tone="faint" track={0.12}>STARTING SPOTS</Mono>
            <Mono size={8} tone="faint" style={{ flex: 1 }} numberOfLines={1}>how your roster fits — set the lineup on ▦ MATCHUP</Mono>
          </View>
          {bySpot.starters.map((row, i) => (
            <RosterRow key={`spot-${i}`} badge={row.label} badgePos={row.pos[0]} p={row.player} busy={busy} t={t} />
          ))}
        </>)}

        {/* ── BENCH ───────────────────────────────────────────────────────── */}
        {bySpot.bench.length > 0 && (<>
          <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>BENCH ({bySpot.bench.length})</Mono>
          {bySpot.bench.map((p) => (
            <RosterRow key={p.slug} badge="BN" p={p} busy={busy} t={t} />
          ))}
        </>)}

        {/* ── INJURED RESERVE ─────────────────────────────────────────────
            The empty places are shown too, up to the league's IR limit —
            "you have two more" is the thing a manager wants to know here,
            and an absent row cannot say it. */}
        {(bySpot.ir.length > 0 || !!gm?.shape?.ir) && (<>
          <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>
            INJURED RESERVE ({bySpot.ir.length}{gm?.shape?.ir ? `/${gm.shape.ir}` : ''})
          </Mono>
          {bySpot.ir.map((p) => (
            <RosterRow key={p.slug} badge="IR" tone="warn" p={p} busy={busy} t={t} onSlot={() => moveToSpot(p.slug, 'active')} />
          ))}
          {Array.from({ length: Math.max(0, (gm?.shape?.ir ?? 0) - bySpot.ir.length) }, (_, i) => (
            <RosterRow key={`ir-empty-${i}`} badge="IR" tone="warn" p={null} busy={busy} t={t}
              slotVerb="injured reserve" onSlot={() => { tap(); setFillFor('ir'); }} />
          ))}
        </>)}

        {/* ── TAXI SQUAD ──────────────────────────────────────────────────── */}
        {(bySpot.taxi.length > 0 || !!gm?.shape?.taxi) && (<>
          <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>
            TAXI SQUAD ({bySpot.taxi.length}{gm?.shape?.taxi ? `/${gm.shape.taxi}` : ''})
          </Mono>
          {bySpot.taxi.map((p) => (
            <RosterRow key={p.slug} badge="TX" tone="you" p={p} busy={busy} t={t} onSlot={() => moveToSpot(p.slug, 'active')} />
          ))}
          {Array.from({ length: Math.max(0, (gm?.shape?.taxi ?? 0) - bySpot.taxi.length) }, (_, i) => (
            <RosterRow key={`tx-empty-${i}`} badge="TX" tone="you" p={null} busy={busy} t={t}
              slotVerb="taxi squad" onSlot={() => { tap(); setFillFor('taxi'); }} />
          ))}
        </>)}

        <Mono size={8.5} tone="faint" style={{ marginTop: 10, lineHeight: fs(14) }}>
          Tap a name to open his card — that's where you drop him. Dropped players sit on waivers for 24h (claims beat
          first-come). Roster changes apply from the next unlocked week.
        </Mono>
      </Card>

      {/* keepers (0182) — only when the commissioner set a keeper count */}
      {myRoster != null && <KeepersCard leagueId={leagueId} myRoster={myRoster} mine={mine} />}
      </>)}

      {tab === 'waivers' && (<>
      {/* pending + recent claims */}
      {(pendingClaims.length > 0 || recentClaims.length > 0) && (
        <Card>
          <Mono size={9} tone="faint" track={0.12}>MY WAIVER CLAIMS</Mono>
          {pendingClaims.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: fs(12), color: t.text }}>＋ {poolBySlug.get(c.add_slug)?.full_name ?? c.add_slug}</Text>
                {c.drop_slug && <Mono size={9} tone="faint">dropping {poolBySlug.get(c.drop_slug)?.full_name ?? c.drop_slug}</Mono>}
              </View>
              {team.waiver_mode === 'faab' && <Mono size={9.5} tone="you" weight="700">${c.bid ?? 0}</Mono>}
              <Mono size={8} tone="warn" track={0.06}>PENDING</Mono>
              <LinkButton label="cancel" tone="opp" onPress={() => void run(() => cancelWaiverClaim(c.id))} />
            </View>
          ))}
          {recentClaims.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12), color: t.dim }}>
                ＋ {poolBySlug.get(c.add_slug)?.full_name ?? c.add_slug}{c.note ? ` — ${c.note}` : ''}
              </Text>
              <Mono size={8} tone={c.status === 'won' ? 'you' : 'faint'} track={0.06}>{c.status.toUpperCase()}</Mono>
            </View>
          ))}
        </Card>
      )}

      {/* free agents / waiver wire */}
      <Card>
        <Mono size={9} tone="faint" track={0.12}>
          PLAYER POOL ({free.length}){team.waiver_mode === 'faab' && team.my_faab != null ? ` · 💰 $${team.my_faab}` : ''}
          {team.fa_open === false && team.fa_start_min != null ? ` · 🔒 FA opens ${fmtEtMin(team.fa_start_min)} ET` : ''}
        </Mono>
        <TextInput value={q} onChangeText={setQ} placeholder="Search players or teams…" placeholderTextColor={t.faint}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(13), color: t.text, backgroundColor: t.bg, marginVertical: 8 }} />
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {POS_FILTERS.map((p) => <Chip key={p} label={p} on={pos === p} onPress={() => { tap(); setPos(p); }} />)}
          <Chip label="★ FIRST" on={starMode === 'first'} onPress={() => { tap(); setStarMode(starMode === 'first' ? 'off' : 'first'); }} />
          <Chip label="★ ONLY" on={starMode === 'only'} onPress={() => { tap(); setStarMode(starMode === 'only' ? 'off' : 'only'); }} />
        </View>
        {/* Tenure BANDS rather than a number box — nobody searches for
            "exactly 6 accrued seasons" — with ROOKIES as the first band so it
            and the tenure filter can never disagree about who is one. */}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {TENURE_BANDS.map((b) => (
            <Chip key={b.id} label={b.short} on={tenure === b.id} onPress={() => { tap(); setTenure(b.id); }} />
          ))}
        </View>
        {/* The team strip scrolls: 32 codes wrapped would fill a phone screen
            before a single player showed. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 6 }}
          contentContainerStyle={{ gap: 6, paddingRight: 12 }}>
          <Chip label="ALL NFL" on={nflTeam === 'ALL'} onPress={() => { tap(); setNflTeam('ALL'); }} />
          {poolTeams.map((tm) => (
            <Chip key={tm} label={tm} on={nflTeam === tm} onPress={() => { tap(); setNflTeam(nflTeam === tm ? 'ALL' : tm); }} />
          ))}
        </ScrollView>
        {free.slice(0, 60).map((p) => {
          const left = waivedFor(p);
          // over-limit rosters are locked out; the FA window gates instant adds only
          const blocked = !!team.roster_issue || (left == null && team.fa_open === false);
          const can = !busy && myRoster != null && !blocked;
          return (
            <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
              <Mono size={8.5} tone="faint" style={{ width: 28 }}>#{p.rank}</Mono>
              <Face slug={p.slug} pos={p.pos} />
              {/* The wire's names open cards too (founder: everywhere a name
                  is, a card is one tap away) — deciding whether to ADD him is
                  exactly when you want to read about him. */}
              <Pressable style={{ flex: 1, minWidth: 0 }} hitSlop={4}
                onPress={() => { tap(); openPlayerCard({ slug: p.slug, name: p.full_name, pos: p.pos, team: p.team }); }}>
                <Text numberOfLines={1} style={{ fontSize: fs(12.5), color: t.text }}>
                  {favs.has(p.slug) && <Text style={{ color: STAR_GOLD }}>★ </Text>}{p.full_name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
                  <PosPill pos={p.pos} size={7.5} />
                  <Mono size={8.5} tone="faint">{p.team}</Mono>
                  <FlagChip slug={p.slug} size={7.5} />
                  {left != null && <Mono size={8.5} tone="warn">⏳ {fmtLeft(left)}</Mono>}
                </View>
              </Pressable>
              <Pressable disabled={!can} onPress={() => { tap(); addOrClaim(p); }}
                style={{ backgroundColor: can ? t.you : t.sh, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 7, opacity: can ? 1 : 0.45 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: can ? t.onAccent : t.faint }}>
                  {left != null ? 'CLAIM' : 'ADD'}
                </Text>
              </Pressable>
            </View>
          );
        })}
        {free.length > 60 && <Mono size={9.5} tone="faint" style={{ paddingTop: 8 }}>…{free.length - 60} more — narrow the search.</Mono>}
      </Card>
      </>)}

      {/* The standings + bracket moved to the league menu (v0.274.0): the
          table is the LEAGUE's, not this team's. */}

      {/* trades — propose/answer for managers, rulings inline for the commish */}
      {tab === 'trades' && (
      <TradeCenter leagueId={leagueId} myRoster={myRoster} teams={team.waiver_order}
        rosters={rosters} poolBySlug={poolBySlug} tradeReview={team.trade_review}
        isCommish={!!team.is_commish} onChanged={() => void refresh()} />
      )}

      {/* waiver order */}
      {tab === 'waivers' && (
      <Card>
        <Mono size={9} tone="faint" track={0.12}>WAIVER ORDER</Mono>
        {[...team.waiver_order].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map((w, i) => (
          <View key={w.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.bd, marginTop: i ? 0 : 6 }}>
            <Mono size={9.5} tone="faint" style={{ width: 16 }}>{i + 1}</Mono>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12), color: w.roster_id === myRoster ? t.you : t.text, fontWeight: w.roster_id === myRoster ? '700' : '400' }}>
              {w.team ?? `Team ${w.roster_id}`}
            </Text>
            {team.waiver_mode === 'faab' && w.faab != null && <Mono size={9} weight="700">${w.faab}</Mono>}
          </View>
        ))}
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(14) }}>
          {team.waiver_mode === 'faab'
            ? 'FAAB: claims carry blind bids from your season budget — highest bid wins, the order above only breaks ties. Winners still rotate to the back.'
            : 'Winning a claim sends you to the back of the line.'}
          {team.waiver_clear_min != null && ` Waivers clear daily at ${fmtEtMin(team.waiver_clear_min)} ET (${team.waiver_hold_days ?? 1}-day hold).`}
        </Mono>
      </Card>
      )}

      {/* FAAB claim → collect the blind bid */}
      <Overlay visible={!!claimFor} title={claimFor ? `Claim ${claimFor.p.full_name}` : ''} onClose={() => setClaimFor(null)}>
        {claimFor?.drop && (
          <Mono size={9.5} style={{ marginBottom: 8 }}>dropping {poolBySlug.get(claimFor.drop)?.full_name ?? claimFor.drop}</Mono>
        )}
        <Mono size={9} tone="faint" track={0.1}>BLIND BID — YOU HAVE ${team.my_faab ?? 0}</Mono>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput value={bidDraft} autoFocus keyboardType="number-pad" placeholder="$0" placeholderTextColor={t.faint}
            onChangeText={(v) => setBidDraft(v.replace(/\D/g, ''))}
            style={{ width: 90, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontFamily: MONO, fontSize: fs(14), color: t.text, backgroundColor: t.bg }} />
          <View style={{ flex: 1 }}>
            <PrimaryButton label="SUBMIT CLAIM" disabled={busy} onPress={submitClaimBid} />
          </View>
        </View>
        <Mono size={8.5} tone="faint" style={{ marginTop: 10, lineHeight: fs(14) }}>
          Highest bid wins when waivers clear; only the winner pays. $0 is a legal bid.
        </Mono>
      </Overlay>

      {/* roster full → choose a drop for the pending add */}
      <Overlay visible={!!pendingAdd} title={pendingAdd ? `Drop who for ${pendingAdd.full_name}?` : ''}
        subtitle="Your roster is full — the add and the drop happen together." onClose={() => setPendingAdd(null)}>
        <ScrollView style={{ maxHeight: 380 }}>
          {mine.map((p) => (
            <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
              <Face slug={p.slug} pos={p.pos} />
              <PosPill pos={p.pos} size={8} />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12.5), color: t.text }}>{p.full_name}</Text>
              <Pressable disabled={busy} onPress={() => { tap(); pendingAdd && doAdd(pendingAdd, p.slug); }}
                style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 9, paddingVertical: 5 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.opp }}>DROP</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </Overlay>

      {/* AN EMPTY TAXI / IR PLACE, ASKING WHO GOES IN IT (v0.285.0) ────────
          The picker offers the ACTIVE roster only. A player already on IR or
          the taxi squad isn't a candidate for the other — send him back to
          active first (tap his badge), which keeps every move one legal step
          the server can answer for rather than a silent two-step. */}
      <Overlay visible={!!fillFor}
        title={fillFor === 'ir' ? 'Move to injured reserve' : 'Move to the taxi squad'}
        subtitle={fillFor === 'ir'
          ? 'IR holds players the league\u2019s rules say are hurt enough \u2014 the server checks, and says so if he isn\u2019t.'
          : 'The taxi squad holds prospects off your active roster. He can\u2019t be started while he\u2019s on it.'}
        onClose={() => setFillFor(null)}>
        <ScrollView style={{ maxHeight: 380 }}>
          {mine.filter((p) => p.spot === 'active').length === 0 && (
            <Mono size={10} tone="faint" style={{ paddingVertical: 10 }}>Nobody on your active roster to move.</Mono>
          )}
          {mine.filter((p) => p.spot === 'active').map((p) => (
            <Pressable key={p.slug} disabled={busy} onPress={() => moveToSpot(p.slug, fillFor === 'ir' ? 'ir' : 'taxi')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd, opacity: busy ? 0.5 : 1 }}>
              <Face slug={p.slug} pos={p.pos} />
              <PosPill pos={p.pos} size={8} />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12.5), color: t.text }}>{p.full_name}</Text>
              <Mono size={8.5} tone="faint">{p.team}</Mono>
              <Mono size={9} weight="700" tone="you">{fillFor === 'ir' ? '\u2192IR' : '\u2192TX'}</Mono>
            </Pressable>
          ))}
        </ScrollView>
      </Overlay>

      {settingsSheet}
    </ScrollView>
  );
}
