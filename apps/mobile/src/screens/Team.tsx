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
  addFreeAgent, cancelWaiverClaim, dropPlayer,
  friendlyError, leagueInvite, leaguePool, nativeRosters, setRosterSpot,
  nativeTeamState, processWaivers, setTeamAvatar, setTeamName, submitWaiverClaim, POS_CAP_KEYS,
  myFavorites, loadTeamOverrides, playerFlags, leaguePoolExp,
  keeperState, setKeepers, type KeeperState,
  type LeaguePoolPlayer, type NativeTeamState,
} from '@drip/core/data/liveApi';
import { TENURE_BANDS, tenureMatches, type TenureBand } from '@drip/core/data/tenure';
import { headshot } from '@drip/core/data/media';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PosPill, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { AvatarGrid } from '../ui/AvatarGrid';
import { Playoffs, Standings } from '../ui/LeagueExtras';
import { TradeCenter } from '../ui/TradeCenter';
import { starApply, STAR_GOLD, type StarMode } from '../ui/stars';
import { FlagChip } from '../ui/rosterGroup';
import { setLeagueFlags } from '@drip/core/data/commish';

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

export function Team({ leagueId, onBack, onDraft }: { leagueId: string; onBack: () => void; onDraft: () => void }) {
  const t = useTheme();
  // The screen's TABS (v0.268.0): one area at a time, ROSTER first — the
  // founder's call, same shape as the commish map. Identity and the
  // over-limit warning stay above the tabs; modals are tab-agnostic.
  const [tab, setTab] = useState<'roster' | 'waivers' | 'trades' | 'league'>('roster');
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
  const [claimFor, setClaimFor] = useState<{ p: LeaguePoolPlayer; drop?: string } | null>(null); // FAAB blind bid
  const [bidDraft, setBidDraft] = useState('');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [myArtOpen, setMyArtOpen] = useState(false);       // own team art
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
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
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
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'That didn’t work.')); } else commit();
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
      await Share.share({
        message: `Join my league "${r.name}" on Drip Fantasy — real-time fantasy football. ` +
          `Invite code: ${r.invite_code}${r.seats_open ? ` (${r.seats_open} seat${r.seats_open === 1 ? '' : 's'} open)` : ''}. dripfantasy.com`,
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
          ['league', '🏆 LEAGUE'],
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
        {mine.map((p) => (
          <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
            <Face slug={p.slug} pos={p.pos} />
            <PosPill pos={p.pos} size={8} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12.5), color: t.text }}>{p.full_name}</Text>
            <FlagChip slug={p.slug} size={7.5} />
            {p.spot !== 'active' && <Mono size={7.5} weight="700" tone="opp">{p.spot.toUpperCase()}</Mono>}
            <Mono size={9} tone="faint">{p.team}</Mono>
            {/* TAXI/IR designations (0164): cycle active → taxi → ir → active;
                the server enforces caps + the IR injury gate and says why not. */}
            <Pressable disabled={busy} onPress={() => {
              tap();
              const next = p.spot === 'active' ? 'taxi' : p.spot === 'taxi' ? 'ir' : 'active';
              void run(() => setRosterSpot(leagueId, p.slug, next as 'active' | 'taxi' | 'ir'));
            }} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 5, opacity: busy ? 0.5 : 1 }}>
              <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.dim }}>{p.spot === 'active' ? '→TAXI' : p.spot === 'taxi' ? '→IR' : '→ACT'}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { tap(); myRoster != null && void run(() => dropPlayer(leagueId, myRoster, p.slug)); }}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 9, paddingVertical: 5, opacity: busy ? 0.5 : 1 }}>
              <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.opp }}>DROP</Text>
            </Pressable>
          </View>
        ))}
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(14) }}>
          Dropped players sit on waivers for 24h (claims beat first-come). Roster changes apply from the next unlocked week.
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
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: fs(12.5), color: t.text }}>
                  {favs.has(p.slug) && <Text style={{ color: STAR_GOLD }}>★ </Text>}{p.full_name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
                  <PosPill pos={p.pos} size={7.5} />
                  <Mono size={8.5} tone="faint">{p.team}</Mono>
                  <FlagChip slug={p.slug} size={7.5} />
                  {left != null && <Mono size={8.5} tone="warn">⏳ {fmtLeft(left)}</Mono>}
                </View>
              </View>
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

      {/* standings + the bracket — every member's read */}
      {tab === 'league' && (<>
      <Standings leagueId={leagueId} myRoster={myRoster} />
      <Playoffs leagueId={leagueId} />
      </>)}

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

      {settingsSheet}
    </ScrollView>
  );
}
