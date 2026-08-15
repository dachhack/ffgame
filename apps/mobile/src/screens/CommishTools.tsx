// The commissioner's kit, as its own tab — ⚑ COMMISH.
//
// This used to live inside MY TEAM, which buried league management under a
// screen about one roster and made a seatless commissioner "open their team"
// to run a league they don't play in. Now MY TEAM is about your team, and
// everything a commissioner does to OTHER people's teams — seats, co-managers,
// the waiting room, coin, any roster's players, league rules — lives here,
// behind a tab that only renders for commissioners.
//
// The pieces are the same ones the old placement used: CommishTeams (below),
// CommishPlayers (ui/LeagueExtras) and CommishSettings (ui/CommishSettings).
// The server is the real gate on all of it — every RPC here checks the caller
// is the league's commissioner or an admin; the tab merely hides the door.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  adminAssignRoster, adminLeagueJoiners, adminLeagueMembers, commishBulkCoin,
  commishClaimRoster, commishClearCoin, commishGrantWeeklyBudget, commishOverview,
  commishSeedCoin, commishSetManager, commishSetWeeklyBudget, friendlyError,
  leagueInvite, nativeTeamState,
  setTeamAvatar, setTeamController, setTeamName, teamManagers,
  type AdminMember, type LeagueJoiner, type NativeTeamState, type TeamManagerRow,
  leagueLastSeen, seenAgoLabel, leagueLiveBuffs, setLeagueLiveBuffs, type LeagueSeenRow,
  leagueGameMode, setLeagueGameMode,
} from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { AvatarGrid } from '../ui/AvatarGrid';
import { CommishSettings } from '../ui/CommishSettings';
import { CommishPlayers } from '../ui/LeagueExtras';
import { CommishToolsCard } from '../ui/CommishKit';

export function CommishTools({ leagueId, native, rosterId, onBack, onSelfUnassigned }: {
  leagueId: string;
  /** Platform (Sleeper) leagues get seat/co-manager/coin management only —
   *  rosters, waivers and rules live on the platform, so those cards hide.
   *  The RPCs behind the seats card are league-agnostic (0022/0042/0052). */
  native: boolean;
  /** The opener's seat, for a platform league where there's no
   *  native_team_state to ask. Native leagues re-derive it live instead, so a
   *  ＋ ME claim mid-screen is reflected without reopening the league. */
  rosterId: number | null;
  onBack: () => void;
  /** The commissioner vacated their own seat — the tabs above are stale (no
   *  MATCHUP/MY TEAM for a seat that no longer exists), so leave the league. */
  onSelfUnassigned: () => void;
}) {
  const t = useTheme();
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Remount lever for the child cards after a settings save — rules changes
  // (roster caps, coin budget) alter what CommishPlayers/CommishTeams show.
  const [epoch, setEpoch] = useState(0);

  const refresh = async () => {
    if (!native) return; // native_team_state is a native-league RPC
    try {
      const tm = await nativeTeamState(leagueId);
      if (tm.error) { setErr(friendlyError(tm.error)); return; }
      setTeam(tm); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const myRoster = native ? (team?.my_roster_id ?? null) : rosterId;

  // The same OS share sheet MY TEAM's ⇪ RECRUIT opens — a commissioner filling
  // seats is this button's whole audience, so it lives here too.
  const shareInvite = async () => {
    tap();
    try {
      const r = await leagueInvite(leagueId);
      if (!r.ok || !r.invite_code) { warn(); setErr(friendlyError(r.error ?? 'could not fetch the invite code')); return; }
      await Share.share({
        message: `Join my league "${r.name}" on Drip Fantasy — real-time fantasy football. ` +
          `Invite code: ${r.invite_code}${r.seats_open ? ` (${r.seats_open} seat${r.seats_open === 1 ? '' : 's'} open)` : ''}. dripfantasy.com`,
      });
    } catch (x) { warn(); setErr(friendlyError(x)); }
  };

  if (native && team === null && !err) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={11}>Loading league management…</Mono>
      </View>
    );
  }

  // Unreachable through the app's own UI (the tab only renders for
  // commissioners), but state can go stale — a commissioner demoted while the
  // screen is open should see why every button would refuse them.
  if (native && team && !team.is_commish) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        <Notice>These tools are the commissioner's. You're not this league's commissioner (anymore?) — head back to your leagues.</Notice>
        <View style={{ marginTop: 10, alignItems: 'center' }}><LinkButton label="← back" onPress={onBack} /></View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Display size={17}>⚑ Commissioner</Display>
            <Mono size={9} tone="faint" style={{ marginTop: 3 }}>
              {!native
                ? 'Rosters and rules live on Sleeper — seats, co-managers and coin are managed here.'
                : myRoster != null ? 'You also manage a team — that stays in MY TEAM.' : 'You run this league without a team in it.'}
            </Mono>
          </View>
          <Pressable onPress={shareInvite} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.you }}>⇪ RECRUIT</Text>
          </Pressable>
          {native && (
            <Pressable onPress={() => { tap(); setSettingsOpen(true); }} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
              <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.warn }}>⚑ SETTINGS</Text>
            </Pressable>
          )}
        </View>
        {!!err && <Mono size={10} tone="opp" style={{ marginTop: 6 }}>⚠ {err}</Mono>}
      </Card>

      {/* the commissioner's kit — note / player flags / scoring (0141/0143/0144) */}
      <CommishToolsCard leagueId={leagueId} />

      <CommishTeams key={`teams-${epoch}`} leagueId={leagueId} myRoster={myRoster}
        onChanged={() => void refresh()} onSelfUnassigned={onSelfUnassigned} />

      {/* who's actually been in the league (0151) — collapsed, loads on open */}
      <CommishSeen leagueId={leagueId} />

      {/* the real-time power-up switch (0155) */}
      <GameModeCard leagueId={leagueId} />
      <LiveBuffsCard leagueId={leagueId} />

      {/* league-wide coin: the allowance and the bulk levers, right under the
          seat rows whose 💰 chips they move. onChanged remounts the cards so
          those balances re-read after every bulk move. */}
      <CommishCoin leagueId={leagueId} onChanged={() => { setEpoch((n) => n + 1); void refresh(); }} />

      {native && <CommishPlayers key={`players-${epoch}`} leagueId={leagueId} onChanged={() => void refresh()} />}

      {native && (
        <CommishSettings visible={settingsOpen} leagueId={leagueId}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { setEpoch((n) => n + 1); void refresh(); }} />
      )}
    </ScrollView>
  );
}

/** A balance for humans: whole coins as-is, fractional ones to one decimal —
 *  wallets are numeric and window credits can leave change. */
const coinFmt = (v?: number) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

/** League-wide drip coin: the weekly allowance (set once, grant per week) and
 *  the bulk levers — the same signed grant commish_seed_coin makes, applied to
 *  every seat at once, plus a zero-everything reset. Balances live on the seat
 *  rows above (💰 chips); this card is everything that moves them together.
 *
 *  Moved here from the ⚑ SETTINGS sheet: an allowance is something you REVISIT
 *  (set it, grant a week, check balances, grant again), and burying it two taps
 *  deep under league rules made it read as configuration instead of a tool. */
function CommishCoin({ leagueId, onChanged }: { leagueId: string; onChanged: () => void }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [weeklyDraft, setWeeklyDraft] = useState('');
  const [weeklyInit, setWeeklyInit] = useState<number | null>(null);
  const [grantWeekDraft, setGrantWeekDraft] = useState('');
  const [bulkDraft, setBulkDraft] = useState('');
  const [bulkSign, setBulkSign] = useState<1 | -1>(1);

  useEffect(() => {
    // The weekly budget rides along on commish_overview — the same read the
    // web's commissioner card uses.
    commishOverview().then((ls) => {
      const wb = ls.find((l) => l.league_id === leagueId)?.weekly_budget ?? null;
      setWeeklyInit(wb); setWeeklyDraft(wb != null ? String(wb) : '');
    }).catch(() => {});
  }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: (r: { ok: boolean } & Record<string, unknown>) => void) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); done(r as { ok: boolean } & Record<string, unknown>); onChanged(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const inp = (w: number) => ({
    width: w, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6,
    paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: 13, color: t.text, backgroundColor: t.bg,
  } as const);

  const doClear = () => {
    Alert.alert('Zero every wallet?', 'Every team in the league goes to 0 coin. The moves land on the ledger like any other adjustment — this resets balances, not history.', [
      { text: 'cancel', style: 'cancel' },
      {
        text: 'zero them all', style: 'destructive',
        onPress: () => void act(() => commishClearCoin(leagueId),
          (r) => setNote(`✓ ${Number(r.cleared ?? 0)} wallet${Number(r.cleared ?? 0) === 1 ? '' : 's'} zeroed`)),
      },
    ]);
  };

  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>💰 DRIP COIN — THE WHOLE LEAGUE AT ONCE</Mono>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5 }}>{note}</Mono>}

      {/* the standing allowance: set it once, grant it per week (idempotent) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Mono size={9} tone="faint">WEEKLY ALLOWANCE</Mono>
        <TextInput value={weeklyDraft} keyboardType="number-pad" placeholder={weeklyInit != null ? String(weeklyInit) : '0'}
          placeholderTextColor={t.faint} onChangeText={(v) => setWeeklyDraft(v.replace(/\D/g, ''))} style={inp(70)} />
        <Chip label="SET" on disabled={busy || !weeklyDraft || parseInt(weeklyDraft, 10) === weeklyInit}
          onPress={() => {
            const amt = parseInt(weeklyDraft || '0', 10) || 0;
            void act(() => commishSetWeeklyBudget(leagueId, amt),
              (r) => { setWeeklyInit(Number(r.weekly_budget ?? amt)); setNote(`✓ weekly allowance ${Number(r.weekly_budget ?? amt)}`); });
          }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Mono size={9} tone="faint">GRANT WEEK</Mono>
        <TextInput value={grantWeekDraft} keyboardType="number-pad" placeholder="wk#"
          placeholderTextColor={t.faint} onChangeText={(v) => setGrantWeekDraft(v.replace(/\D/g, ''))} style={inp(56)} />
        <Chip label="💰 ALL TEAMS" disabled={busy || !grantWeekDraft || !weeklyInit}
          onPress={() => {
            const wk = parseInt(grantWeekDraft || '0', 10);
            if (!wk) return;
            void act(() => commishGrantWeeklyBudget(leagueId, wk),
              (r) => setNote(`✓ credited ${Number(r.credited ?? 0)} team${Number(r.credited ?? 0) === 1 ? '' : 's'} for week ${wk}`));
          }} />
      </View>
      <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: 13 }}>
        The allowance drops by itself as each week's games arrive — set it and forget it. GRANT WEEK is the manual catch-up (a missed week, an off-schedule top-up); auto and manual share one receipt per week, so nothing ever pays twice.
      </Mono>

      {/* one-off bulk move: every seat, same signed amount — commish_seed_coin
          generalized. NOT idempotent, exactly like the per-seat 💰 lever. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10, flexWrap: 'wrap' }}>
        <Mono size={9} tone="faint">ONE-OFF</Mono>
        <Chip label="＋" on={bulkSign === 1} onPress={() => { tap(); setBulkSign(1); }} />
        <Chip label="−" on={bulkSign === -1} onPress={() => { tap(); setBulkSign(-1); }} />
        <TextInput value={bulkDraft} keyboardType="number-pad" placeholder="amount"
          placeholderTextColor={t.faint} onChangeText={(v) => setBulkDraft(v.replace(/\D/g, ''))} style={inp(80)} />
        <Chip label={bulkSign === 1 ? '💰 GRANT ALL' : '− DOCK ALL'} disabled={busy || !bulkDraft}
          onPress={() => {
            const amt = (parseInt(bulkDraft || '0', 10) || 0) * bulkSign;
            if (!amt) return;
            setBulkDraft('');
            void act(() => commishBulkCoin(leagueId, amt),
              (r) => setNote(`✓ ${amt > 0 ? '+' : ''}${amt} coin × ${Number(r.teams ?? 0)} teams`));
          }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Mono size={8.5} tone="faint" style={{ lineHeight: 13 }}>
            Every adjustment here lands on the coin ledger — nothing is edited in place.
          </Mono>
        </View>
        <LinkButton label="⌀ zero all wallets" tone="opp" onPress={() => { tap(); doClear(); }} />
      </View>
    </Card>
  );
}

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
                {/* the balance IS the button label — you see what you're about
                    to move, and it re-reads with the seats after every act() */}
                <Chip label={`💰 ${coinFmt(m.coin)}`} onPress={() => { tap(); setCoinFor(m); setCoinDraft(''); setCoinSign(1); }} />
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
        subtitle={coinFor ? `Current balance: ${coinFmt(coinFor.coin)} coin.` : ''} onClose={() => setCoinFor(null)}>
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


// ── Last opened (0151) ───────────────────────────────────────────────────────
// Every member with when they last OPENED the league — the commissioner's
// pulse check a week before lineups matter. Collapsed by default; loads on
// first expand. "Never" = claimed a seat, hasn't been in.
function CommishSeen({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LeagueSeenRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || rows !== null) return;
    leagueLastSeen(leagueId)
      .then((r) => { if (r.ok && r.members) setRows(r.members); else setErr(friendlyError(r.error ?? 'load failed')); })
      .catch((x) => setErr(friendlyError(x)));
  }, [open, rows, leagueId]);
  const tone = (lastAt: string | null): string => {
    if (!lastAt) return t.opp;
    const d = Date.now() - Date.parse(lastAt);
    return d < 24 * 3600_000 ? t.you : d < 4 * 24 * 3600_000 ? t.text : t.warn;
  };
  return (
    <Card>
      <Pressable onPress={() => { tap(); setOpen((o) => !o); }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Mono size={9.5} weight="700" track={0.12} tone="faint">👁 LAST OPENED · who's been in the league</Mono>
        <Mono size={9.5} weight="700" tone="dim">{open ? '▾' : '▸'}</Mono>
      </Pressable>
      {open && (
        <View style={{ marginTop: 8, gap: 6 }}>
          {!!err && <Mono size={10} tone="opp">⚠ {err}</Mono>}
          {!err && rows === null && <Mono size={10} tone="faint">Loading…</Mono>}
          {rows?.length === 0 && <Mono size={10} tone="faint">No members yet.</Mono>}
          {rows?.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.text }}>{m.name}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: tone(m.last_at) }}>{seenAgoLabel(m.last_at)}</Text>
            </View>
          ))}
          <Mono size={8.5} tone="faint" style={{ marginTop: 2, lineHeight: 13 }}>
            When each member last opened this league — web or app. NEVER means a claimed seat that hasn't been in yet.
          </Mono>
        </View>
      )}
    </Card>
  );
}


// ── real-time power-ups switch (0155) ────────────────────────────────────────
// One league-wide on/off on the ARMED live buffs (overtime, momentum, amps,
// counters…). Off refuses new arms server-side before any coin moves; buffs
// armed before the flip stay reclaimable. The shop's pre-game power-ups are a
// different lever and are untouched.
// Normie mode (0157): DRIP ⇄ CLASSIC + the PPR knob while classic. The server
// freezes the mode once the draft starts; its refusal shows inline.
function GameModeCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [mode, setMode] = useState<'drip' | 'classic' | null>(null);
  const [ppr, setPpr] = useState(1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    leagueGameMode(leagueId).then((r) => { if (r.ok) { setMode(r.mode ?? 'drip'); setPpr(Number(r.ppr ?? 1)); } }).catch(() => {});
  }, [leagueId]);
  const set = async (m: 'drip' | 'classic', p?: number) => {
    if (busy || mode === null) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueGameMode(leagueId, m, p);
      if (r.ok) { commit(); setMode(m); if (p != null) setPpr(p); }
      else { warn(); setNote(r.error ?? 'failed'); }
    } catch { warn(); }
    finally { setBusy(false); }
  };
  const Pill = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <Pressable disabled={busy || mode === null} onPress={() => { tap(); onPress(); }}
      style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: on ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, opacity: busy || mode === null ? 0.5 : 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: on ? t.onAccent : t.dim }}>{label}</Text>
    </Pressable>
  );
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Mono size={9.5} weight="700" track={0.12} tone="faint">🎮 GAME MODE</Mono>
          <Mono size={8.5} tone="faint" style={{ marginTop: 3, lineHeight: 12 }}>
            DRIP is the full game. CLASSIC is traditional fantasy — standard scoring, one weekly QB/RB/RB/WR/WR/TE/FLEX/K/DEF lineup, no bonuses or power-ups. Locks once the draft starts.
          </Mono>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pill on={mode === 'drip'} label="DRIP" onPress={() => void set('drip')} />
          <Pill on={mode === 'classic'} label="CLASSIC" onPress={() => void set('classic')} />
        </View>
      </View>
      {mode === 'classic' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <Mono size={8.5} tone="faint" weight="700">RECEPTIONS</Mono>
          <Pill on={ppr === 0} label="NON-PPR" onPress={() => void set('classic', 0)} />
          <Pill on={ppr === 0.5} label="½ PPR" onPress={() => void set('classic', 0.5)} />
          <Pill on={ppr === 1} label="FULL PPR" onPress={() => void set('classic', 1)} />
        </View>
      )}
      {note && <Mono size={9} tone="warn" style={{ marginTop: 8 }}>{note}</Mono>}
    </Card>
  );
}

function LiveBuffsCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    leagueLiveBuffs(leagueId).then((r) => { if (r.ok) setOn(r.on !== false); }).catch(() => {});
  }, [leagueId]);
  const flip = async () => {
    if (on === null || busy) return;
    setBusy(true);
    try {
      const r = await setLeagueLiveBuffs(leagueId, !on);
      if (r.ok) { commit(); setOn(!on); } else warn();
    } catch { warn(); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Mono size={9.5} weight="700" track={0.12} tone="faint">◈ REAL-TIME POWER-UPS</Mono>
          <Mono size={8.5} tone="faint" style={{ marginTop: 3, lineHeight: 12 }}>
            The armed live buffs — overtime, momentum, amps, counters. Off blocks new arms league-wide; already-armed buffs stay reclaimable.
          </Mono>
        </View>
        <Pressable disabled={on === null || busy} onPress={() => { tap(); void flip(); }}
          style={{ borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: on ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, opacity: on === null || busy ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: on ? t.onAccent : t.dim }}>
            {on === null ? '…' : on ? 'ON' : 'OFF'}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
