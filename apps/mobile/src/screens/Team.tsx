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
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  addFreeAgent, adminAssignRoster, adminLeagueJoiners, adminLeagueMembers, cancelWaiverClaim, commishClaimRoster,
  commishSeedCoin, commishSetManager, dropPlayer,
  friendlyError, leagueInvite, leaguePool, nativeRosters,
  nativeTeamState, processWaivers, setTeamAvatar, setTeamController, setTeamName, submitWaiverClaim,
  teamManagers, POS_CAP_KEYS,
  type AdminMember, type LeagueJoiner, type LeaguePoolPlayer, type NativeTeamState, type TeamManagerRow,
} from '@drip/core/data/liveApi';
import { headshot } from '@drip/core/data/media';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PosPill, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { CommishSettings } from '../ui/CommishSettings';
import { AvatarGrid } from '../ui/AvatarGrid';
import { CommishPlayers, Playoffs, Standings } from '../ui/LeagueExtras';
import { TradeCenter } from '../ui/TradeCenter';

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

/** Seat management, for the commissioner: assign a user to a team by email,
 *  unassign (kick) one, take an open seat yourself, or vacate your own —
 *  including the seat you were given at creation, which is how a playing
 *  commissioner becomes a non-playing one.
 *
 *  All three actions are the 0042/0045 RPCs the web console already uses;
 *  admin_assign_roster with a null email IS the kick — the membership row
 *  stays (the team and its players survive), only the person is detached. */
function CommishTeams({ leagueId, myRoster, onChanged, onSelfUnassigned }: {
  leagueId: string; myRoster: number | null;
  onChanged: () => void;
  /** The commissioner vacated their own seat — the screen above must not keep
   *  rendering a lineup for a roster they no longer hold. */
  onSelfUnassigned: () => void;
}) {
  const t = useTheme();
  const [seats, setSeats] = useState<AdminMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<AdminMember | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [coinFor, setCoinFor] = useState<AdminMember | null>(null);   // seed-coin target
  const [coinDraft, setCoinDraft] = useState('');
  const [coinSign, setCoinSign] = useState<1 | -1>(1);                // grant vs dock
  const [mgrs, setMgrs] = useState<TeamManagerRow[]>([]);             // co-managers (0125)
  const [joiners, setJoiners] = useState<LeagueJoiner[]>([]);         // the waiting room
  const [mgrFor, setMgrFor] = useState<AdminMember | null>(null);     // add-co-manager target
  const [mgrDraft, setMgrDraft] = useState('');
  const [renameFor, setRenameFor] = useState<AdminMember | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [artFor, setArtFor] = useState<AdminMember | null>(null);     // avatar target
  const [seatPickFor, setSeatPickFor] = useState<LeagueJoiner | null>(null); // waitlist → seat

  const loadSeats = () => Promise.all([
    adminLeagueMembers(leagueId).then(setSeats),
    teamManagers(leagueId).then(setMgrs).catch(() => {}),
    adminLeagueJoiners(leagueId).then((j) => setJoiners(Array.isArray(j) ? j : [])).catch(() => {}),
  ]).catch((e) => setNote(friendlyError(e)));
  useEffect(() => { void loadSeats(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string; status?: string }>, done: (status?: string) => void) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); done(r.status); await loadSeats(); onChanged(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const doAssign = () => {
    const email = emailDraft.trim().toLowerCase();
    if (!assignFor || !email) return;
    const seat = assignFor;
    setAssignFor(null); setEmailDraft('');
    void act(() => adminAssignRoster(leagueId, seat.roster_id, email), (status) => {
      setNote(status === 'pending'
        ? `✓ seat held for ${email} — theirs the moment they sign in with that address`
        : `✓ ${email} is in`);
    });
  };

  const doKick = (m: AdminMember) => {
    const self = m.roster_id === myRoster;
    const who = m.email ?? m.claim_email ?? 'this manager';
    Alert.alert(
      self ? 'Leave your team?' : `Remove ${who}?`,
      self
        ? 'The team stays in the league with its players; you stay commissioner. You just stop being a manager in it.'
        : `${who} loses ${m.team ?? 'the team'}. The team and its players stay, unassigned — hand it to someone else or leave it open.`,
      [
        { text: 'cancel', style: 'cancel' },
        {
          text: self ? 'leave team' : 'remove', style: 'destructive',
          onPress: () => void act(() => adminAssignRoster(leagueId, m.roster_id, ''), () => {
            if (self) onSelfUnassigned();
            else setNote(`✓ ${m.team ?? `roster ${m.roster_id}`} is unassigned`);
          }),
        },
      ],
    );
  };

  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>⚑ TEAMS — ASSIGN, UNASSIGN, KICK</Mono>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5 }}>{note}</Mono>}
      {seats === null ? <ActivityIndicator color={t.you} style={{ marginTop: 8 }} /> : seats.map((m) => {
        const openSeat = !m.enrolled && !m.claim_email;
        const self = m.roster_id === myRoster;
        return (
          <View key={m.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 5 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '700', color: t.text }}>
                {m.team ?? `Roster ${m.roster_id}`}{self ? '  (you)' : ''}
              </Text>
              <Mono size={8.5} tone={openSeat ? 'warn' : 'faint'}>
                {m.enrolled ? (m.email ?? m.sleeper ?? 'seated') : m.claim_email ? `held for ${m.claim_email}` : 'open seat'}
              </Mono>
            </View>
            {openSeat && (
              <>
                <Chip label="ASSIGN" onPress={() => { tap(); setAssignFor(m); setEmailDraft(''); }} />
                {myRoster == null && <Chip label="＋ ME" on onPress={() => { tap(); void act(() => commishClaimRoster(leagueId, m.roster_id), () => setNote('✓ the seat is yours')); }} />}
              </>
            )}
            {!openSeat && (
              <>
                {/* AI takeover: the resolver runs this seat's lineups until a
                    human takes it back. The standard AWOL-manager fix. */}
                <Chip label={m.controller === 'ai' ? '🤖' : '👤'} on={m.controller === 'ai'}
                  onPress={() => { tap(); void act(() => setTeamController(leagueId, m.roster_id, m.controller === 'ai' ? 'human' : 'ai'),
                    () => setNote(`✓ ${m.team ?? `roster ${m.roster_id}`} → ${m.controller === 'ai' ? 'human' : '🤖 AI'} control`)); }} />
                <Chip label="💰" onPress={() => { tap(); setCoinFor(m); setCoinDraft(''); setCoinSign(1); }} />
                <Chip label={self ? '✕ LEAVE' : '✕'} onPress={() => { tap(); doKick(m); }} />
              </>
            )}
          </View>
        );
      })}

      {/* second row of tools per seat: identity + co-managers. Kept separate
          from the action row above so neither wraps into soup on a 360dp
          screen. */}
      {(seats ?? []).filter((m) => m.enrolled || m.claim_email).map((m) => {
        const seatMgrs = mgrs.filter((g) => g.roster_id === m.roster_id);
        return (
          <View key={`x-${m.roster_id}`} style={{ paddingVertical: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Mono size={8.5} tone="faint" style={{ width: 90 }} >{m.team ?? `Roster ${m.roster_id}`}</Mono>
              <Chip label="✎ NAME" onPress={() => { tap(); setRenameFor(m); setRenameDraft(m.team ?? ''); }} />
              <Chip label="🖼 ART" onPress={() => { tap(); setArtFor(m); }} />
              <Chip label="＋ CO-MGR" onPress={() => { tap(); setMgrFor(m); setMgrDraft(''); }} />
            </View>
            {seatMgrs.map((g) => (
              <View key={g.app_user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, paddingLeft: 12 }}>
                <Mono size={8.5} tone="dim" style={{ flex: 1 }}>⇄ {g.email ?? g.app_user_id.slice(0, 8)}</Mono>
                <LinkButton label="remove" tone="opp" onPress={() => void act(
                  () => commishSetManager(leagueId, m.roster_id, { appUserId: g.app_user_id, remove: true }),
                  () => setNote('✓ co-manager removed'))} />
              </View>
            ))}
          </View>
        );
      })}

      {/* the waiting room: joined, no seat yet. Deal them in as owners of an
          open seat, or attach them to a full team as a co-manager — the two
          answers to "more people than spots". */}
      {joiners.length > 0 && (
        <View style={{ marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8 }}>
          <Mono size={9} tone="warn" track={0.12}>⏳ WAITING ROOM ({joiners.length})</Mono>
          {joiners.map((j) => (
            <View key={j.app_user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, flexWrap: 'wrap' }}>
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 120, fontSize: 12, color: t.text }}>{j.email ?? j.app_user_id.slice(0, 8)}</Text>
              <Chip label="SEAT →" onPress={() => { tap(); setSeatPickFor(j); }} />
            </View>
          ))}
        </View>
      )}
      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: 13 }}>
        Unassigned teams keep their players and can sit open as long as you like. Assigning by email seats them instantly if they have an account, or holds the seat until they sign in with it.
      </Mono>

      {/* assign → collect the email */}
      <Overlay visible={!!assignFor} title={assignFor ? `Assign ${assignFor.team ?? `roster ${assignFor.roster_id}`}` : ''}
        subtitle="The seat goes to this email — instantly if they have an account, held for them if not." onClose={() => setAssignFor(null)}>
        <TextInput value={emailDraft} autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
          placeholder="manager@email.com" placeholderTextColor={t.faint} onChangeText={setEmailDraft}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: t.text, backgroundColor: t.bg }} />
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : '✓ ASSIGN THE SEAT'} disabled={busy || !emailDraft.trim()} onPress={doAssign} />
        </View>
      </Overlay>

      {/* manual coin adjustment — commish_seed_coin is signed (only zero is
          refused), so grant and dock are the same lever with a sign toggle */}
      <Overlay visible={!!coinFor} title={coinFor ? `Adjust coin — ${coinFor.team ?? `roster ${coinFor.roster_id}`}` : ''}
        subtitle="Applied to their current balance." onClose={() => setCoinFor(null)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Chip label="＋ GRANT" on={coinSign === 1} onPress={() => { tap(); setCoinSign(1); }} />
          <Chip label="− DOCK" on={coinSign === -1} onPress={() => { tap(); setCoinSign(-1); }} />
          <TextInput value={coinDraft} autoFocus keyboardType="number-pad" placeholder="amount" placeholderTextColor={t.faint}
            onChangeText={(v) => setCoinDraft(v.replace(/\D/g, ''))}
            style={{ width: 100, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontFamily: MONO, fontSize: 14, color: t.text, backgroundColor: t.bg }} />
        </View>
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : coinSign === 1 ? '💰 GRANT' : '− DOCK'} disabled={busy || !coinDraft}
            onPress={() => {
              const m = coinFor; const amt = parseInt(coinDraft || '0', 10) * coinSign;
              if (!m || !amt) return;
              setCoinFor(null); setCoinDraft('');
              void act(() => commishSeedCoin(leagueId, m.roster_id, amt),
                () => setNote(`✓ ${amt > 0 ? '+' : ''}${amt} coin — ${m.team ?? `roster ${m.roster_id}`}`));
            }} />
        </View>
      </Overlay>

      {/* rename any team (commish) */}
      <Overlay visible={!!renameFor} title={renameFor ? `Rename ${renameFor.team ?? `roster ${renameFor.roster_id}`}` : ''} onClose={() => setRenameFor(null)}>
        <TextInput value={renameDraft} autoFocus maxLength={40} onChangeText={setRenameDraft}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: t.text, backgroundColor: t.bg }} />
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : '✓ SAVE NAME'} disabled={busy || !renameDraft.trim()}
            onPress={() => {
              const m = renameFor; setRenameFor(null);
              if (m && renameDraft.trim()) void act(() => setTeamName(leagueId, m.roster_id, renameDraft), () => setNote('✓ renamed'));
            }} />
        </View>
      </Overlay>

      {/* team art, any seat (commish; the same set_team_avatar a manager uses) */}
      <AvatarGrid visible={!!artFor} title={artFor ? `Art for ${artFor.team ?? `roster ${artFor.roster_id}`}` : ''}
        current={artFor?.avatar} onClose={() => setArtFor(null)}
        onPick={(url) => {
          const m = artFor; setArtFor(null);
          if (m) void act(() => setTeamAvatar(leagueId, m.roster_id, url), () => setNote('✓ art set'));
        }} />

      {/* add a co-manager by email */}
      <Overlay visible={!!mgrFor} title={mgrFor ? `Co-manager for ${mgrFor.team ?? `roster ${mgrFor.roster_id}`}` : ''}
        subtitle="They steer the same lineup as the owner — one team, more thumbs. Must already have an account." onClose={() => setMgrFor(null)}>
        <TextInput value={mgrDraft} autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
          placeholder="comanager@email.com" placeholderTextColor={t.faint} onChangeText={setMgrDraft}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: t.text, backgroundColor: t.bg }} />
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : '＋ ADD CO-MANAGER'} disabled={busy || !mgrDraft.trim()}
            onPress={() => {
              const m = mgrFor; setMgrFor(null);
              if (m && mgrDraft.trim()) void act(
                () => commishSetManager(leagueId, m.roster_id, { email: mgrDraft.trim() }),
                () => setNote('✓ co-manager added'));
            }} />
        </View>
      </Overlay>

      {/* waitlist → deal them in: open seats seat them as OWNER; taken seats
          attach them as CO-MANAGER */}
      <Overlay visible={!!seatPickFor} title={seatPickFor ? `Deal in ${seatPickFor.email ?? 'this joiner'}` : ''}
        subtitle="An open seat makes them its owner; a taken team adds them as a co-manager." onClose={() => setSeatPickFor(null)}>
        <ScrollView style={{ maxHeight: 380 }}>
          {(seats ?? []).map((m) => {
            const openSeat = !m.enrolled && !m.claim_email;
            return (
              <View key={m.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '700', color: t.text }}>{m.team ?? `Roster ${m.roster_id}`}</Text>
                  <Mono size={8.5} tone={openSeat ? 'warn' : 'faint'}>{openSeat ? 'open — seat as owner' : `${m.email ?? m.claim_email ?? 'taken'} — add as co-manager`}</Mono>
                </View>
                <Chip label={openSeat ? 'OWNER' : '＋ CO-MGR'} on={openSeat} disabled={busy}
                  onPress={() => {
                    const j = seatPickFor; setSeatPickFor(null);
                    if (!j) return;
                    if (openSeat) void act(() => adminAssignRoster(leagueId, m.roster_id, j.email ?? '', j.app_user_id), () => setNote(`✓ ${j.email ?? 'joiner'} owns ${m.team ?? `roster ${m.roster_id}`}`));
                    else void act(() => commishSetManager(leagueId, m.roster_id, { appUserId: j.app_user_id }), () => setNote(`✓ ${j.email ?? 'joiner'} co-manages ${m.team ?? `roster ${m.roster_id}`}`));
                  }} />
              </View>
            );
          })}
        </ScrollView>
      </Overlay>
    </Card>
  );
}

function fmtEtMin(m: number): string {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`;
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

export function Team({ leagueId, onBack, onDraft, onLeftSeat }: {
  leagueId: string; onBack: () => void; onDraft: () => void;
  /** The commissioner vacated their own seat — leave the league view entirely
   *  so nothing above keeps rendering the roster they no longer hold. */
  onLeftSeat: () => void;
}) {
  const t = useTheme();
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [rosters, setRosters] = useState<{ roster_id: number; slug: string }[]>([]);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>('ALL');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<LeaguePoolPlayer | null>(null); // roster full → pick a drop
  const [claimFor, setClaimFor] = useState<{ p: LeaguePoolPlayer; drop?: string } | null>(null); // FAAB blind bid
  const [bidDraft, setBidDraft] = useState('');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false); // ⚑ commish rules sheet
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
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const poolBySlug = useMemo(() => new Map(pool.map((p) => [p.slug, p])), [pool]);
  const rostered = useMemo(() => new Set(rosters.map((r) => r.slug)), [rosters]);
  const myRoster = team?.my_roster_id ?? null;
  const mine = useMemo(() => rosters.filter((r) => r.roster_id === myRoster)
    .map((r) => poolBySlug.get(r.slug)).filter(Boolean) as LeaguePoolPlayer[], [rosters, myRoster, poolBySlug]);
  const cap = team?.roster_cap ?? null;
  const full = cap != null && mine.length >= cap;

  const free = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((p) => !rostered.has(p.slug)
      && (pos === 'ALL' || p.pos === pos)
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
  }, [pool, rostered, q, pos]);

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
                style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
              <Pressable disabled={busy || !nameDraft.trim()}
                onPress={() => { if (nameDraft.trim() && myRoster != null) void run(() => setTeamName(leagueId, myRoster, nameDraft)); setNameDraft(null); }}
                style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 12, justifyContent: 'center', opacity: busy || !nameDraft.trim() ? 0.5 : 1 }}>
                <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.onAccent }}>SAVE</Text>
              </Pressable>
            </View>
          )}
          {team.waiver_mode === 'faab' && team.my_faab != null && (
            <Mono size={9.5} tone="you" style={{ marginTop: 4 }}>💰 FAAB budget ${team.my_faab}</Mono>
          )}
          <LinkButton label="🖼 team art" onPress={() => { tap(); setMyArtOpen(true); }} />
        </View>
        <Pressable onPress={shareInvite} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.you }}>⇪ RECRUIT</Text>
        </Pressable>
        {team.is_commish && (
          <Pressable onPress={() => { tap(); setSettingsOpen(true); }}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.warn }}>⚑ SETTINGS</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );

  // The commissioner-without-a-team header. identityCard is seat-gated (its
  // whole content is the seat), so a seatless commissioner needs a card of
  // their own or the SETTINGS/RECRUIT buttons vanish with the roster.
  const commishCard = myRoster == null && team.is_commish && (
    <Card style={{ borderLeftWidth: 3, borderLeftColor: t.warn }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Display size={15}>⚑ Commissioner</Display>
          <Mono size={9.5} tone="faint" style={{ marginTop: 3 }}>
            You run this league without a team in it — managing, not competing.
          </Mono>
        </View>
        <Pressable onPress={shareInvite} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.you }}>⇪ RECRUIT</Text>
        </Pressable>
        <Pressable onPress={() => { tap(); setSettingsOpen(true); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.warn }}>⚑ SETTINGS</Text>
        </Pressable>
      </View>
    </Card>
  );

  // The commish rules sheet, mounted in BOTH branches below — waiver systems
  // get chosen before the draft, not after it.
  const settingsSheet = (
    <>
      {team.is_commish && (
        <CommishSettings visible={settingsOpen} leagueId={leagueId}
          onClose={() => setSettingsOpen(false)} onSaved={() => void refresh()} />
      )}
      {myRoster != null && (
        <AvatarGrid visible={myArtOpen} title="Your team art" current={team.my_avatar}
          onClose={() => setMyArtOpen(false)}
          onPick={(url) => { setMyArtOpen(false); void run(() => setTeamAvatar(leagueId, myRoster, url)); }} />
      )}
    </>
  );

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
        {commishCard}
        <Card>
          <Display size={15}>Rosters arrive at the draft</Display>
          <Mono size={10} style={{ marginTop: 8, lineHeight: 16 }}>
            Waivers and free agency open once the draft is complete. Set your team name now — it shows on the draft board. Use RECRUIT to bring friends in before draft night.
          </Mono>
          <View style={{ marginTop: 12 }}>
            <PrimaryButton label="⛏ TO THE DRAFT ROOM" onPress={onDraft} />
          </View>
        </Card>
        {/* Seats get handed out BEFORE the draft — this is when assigning
            matters most, so the panel lives in this branch too. */}
        {team.is_commish && (
          <CommishTeams leagueId={leagueId} myRoster={myRoster} onChanged={() => void refresh()} onSelfUnassigned={onLeftSeat} />
        )}
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
      {commishCard}

      {/* over-limit lockout: no adds/claims/weekly lineups until legal */}
      {team.roster_issue && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: t.opp }}>
          <Display size={13} tone="opp">⚠ Roster over its limits</Display>
          <Mono size={9.5} style={{ marginTop: 6, lineHeight: 15 }}>
            {team.roster_issue}. Adds, waiver claims, and weekly lineups are locked until your roster is legal — drops always work.
          </Mono>
        </Card>
      )}

      {/* my roster */}
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
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: t.text }}>{p.full_name}</Text>
            <Mono size={9} tone="faint">{p.team}</Mono>
            <Pressable disabled={busy} onPress={() => { tap(); myRoster != null && void run(() => dropPlayer(leagueId, myRoster, p.slug)); }}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 9, paddingVertical: 5, opacity: busy ? 0.5 : 1 }}>
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.opp }}>DROP</Text>
            </Pressable>
          </View>
        ))}
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: 14 }}>
          Dropped players sit on waivers for 24h (claims beat first-come). Roster changes apply from the next unlocked week.
        </Mono>
      </Card>

      {/* pending + recent claims */}
      {(pendingClaims.length > 0 || recentClaims.length > 0) && (
        <Card>
          <Mono size={9} tone="faint" track={0.12}>MY WAIVER CLAIMS</Mono>
          {pendingClaims.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 12, color: t.text }}>＋ {poolBySlug.get(c.add_slug)?.full_name ?? c.add_slug}</Text>
                {c.drop_slug && <Mono size={9} tone="faint">dropping {poolBySlug.get(c.drop_slug)?.full_name ?? c.drop_slug}</Mono>}
              </View>
              {team.waiver_mode === 'faab' && <Mono size={9.5} tone="you" weight="700">${c.bid ?? 0}</Mono>}
              <Mono size={8} tone="warn" track={0.06}>PENDING</Mono>
              <LinkButton label="cancel" tone="opp" onPress={() => void run(() => cancelWaiverClaim(c.id))} />
            </View>
          ))}
          {recentClaims.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: t.dim }}>
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
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg, marginVertical: 8 }} />
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {POS_FILTERS.map((p) => <Chip key={p} label={p} on={pos === p} onPress={() => { tap(); setPos(p); }} />)}
        </View>
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
                <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.text }}>{p.full_name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
                  <PosPill pos={p.pos} size={7.5} />
                  <Mono size={8.5} tone="faint">{p.team}</Mono>
                  {left != null && <Mono size={8.5} tone="warn">⏳ {fmtLeft(left)}</Mono>}
                </View>
              </View>
              <Pressable disabled={!can} onPress={() => { tap(); addOrClaim(p); }}
                style={{ backgroundColor: can ? t.you : t.sh, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 7, opacity: can ? 1 : 0.45 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: can ? t.onAccent : t.faint }}>
                  {left != null ? 'CLAIM' : 'ADD'}
                </Text>
              </Pressable>
            </View>
          );
        })}
        {free.length > 60 && <Mono size={9.5} tone="faint" style={{ paddingTop: 8 }}>…{free.length - 60} more — narrow the search.</Mono>}
      </Card>

      {/* seat management (commish) */}
      {team.is_commish && (
        <CommishTeams leagueId={leagueId} myRoster={myRoster} onChanged={() => void refresh()} onSelfUnassigned={onLeftSeat} />
      )}

      {/* standings + the bracket — every member's read */}
      <Standings leagueId={leagueId} myRoster={myRoster} />
      <Playoffs leagueId={leagueId} />

      {/* commissioner player moves — any player, any roster */}
      {team.is_commish && <CommishPlayers leagueId={leagueId} onChanged={() => void refresh()} />}

      {/* trades — propose/answer for managers, rulings inline for the commish */}
      <TradeCenter leagueId={leagueId} myRoster={myRoster} teams={team.waiver_order}
        rosters={rosters} poolBySlug={poolBySlug} tradeReview={team.trade_review}
        isCommish={!!team.is_commish} onChanged={() => void refresh()} />

      {/* waiver order */}
      <Card>
        <Mono size={9} tone="faint" track={0.12}>WAIVER ORDER</Mono>
        {[...team.waiver_order].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map((w, i) => (
          <View key={w.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.bd, marginTop: i ? 0 : 6 }}>
            <Mono size={9.5} tone="faint" style={{ width: 16 }}>{i + 1}</Mono>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: w.roster_id === myRoster ? t.you : t.text, fontWeight: w.roster_id === myRoster ? '700' : '400' }}>
              {w.team ?? `Team ${w.roster_id}`}
            </Text>
            {team.waiver_mode === 'faab' && w.faab != null && <Mono size={9} weight="700">${w.faab}</Mono>}
          </View>
        ))}
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: 14 }}>
          {team.waiver_mode === 'faab'
            ? 'FAAB: claims carry blind bids from your season budget — highest bid wins, the order above only breaks ties. Winners still rotate to the back.'
            : 'Winning a claim sends you to the back of the line.'}
          {team.waiver_clear_min != null && ` Waivers clear daily at ${fmtEtMin(team.waiver_clear_min)} ET (${team.waiver_hold_days ?? 1}-day hold).`}
        </Mono>
      </Card>

      {/* FAAB claim → collect the blind bid */}
      <Overlay visible={!!claimFor} title={claimFor ? `Claim ${claimFor.p.full_name}` : ''} onClose={() => setClaimFor(null)}>
        {claimFor?.drop && (
          <Mono size={9.5} style={{ marginBottom: 8 }}>dropping {poolBySlug.get(claimFor.drop)?.full_name ?? claimFor.drop}</Mono>
        )}
        <Mono size={9} tone="faint" track={0.1}>BLIND BID — YOU HAVE ${team.my_faab ?? 0}</Mono>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput value={bidDraft} autoFocus keyboardType="number-pad" placeholder="$0" placeholderTextColor={t.faint}
            onChangeText={(v) => setBidDraft(v.replace(/\D/g, ''))}
            style={{ width: 90, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontFamily: MONO, fontSize: 14, color: t.text, backgroundColor: t.bg }} />
          <View style={{ flex: 1 }}>
            <PrimaryButton label="SUBMIT CLAIM" disabled={busy} onPress={submitClaimBid} />
          </View>
        </View>
        <Mono size={8.5} tone="faint" style={{ marginTop: 10, lineHeight: 14 }}>
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
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: t.text }}>{p.full_name}</Text>
              <Pressable disabled={busy} onPress={() => { tap(); pendingAdd && doAdd(pendingAdd, p.slug); }}
                style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 9, paddingVertical: 5 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.opp }}>DROP</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </Overlay>

      {settingsSheet}
    </ScrollView>
  );
}
