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
  adminAssignRoster, adminLeagueJoiners, adminLeagueMembers, commishClaimRoster,
  commishSeedCoin, commishSetManager, friendlyError, leagueInvite, nativeTeamState,
  setTeamAvatar, setTeamController, setTeamName, teamManagers,
  type AdminMember, type LeagueJoiner, type NativeTeamState, type TeamManagerRow,
} from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { AvatarGrid } from '../ui/AvatarGrid';
import { CommishSettings } from '../ui/CommishSettings';
import { CommishPlayers } from '../ui/LeagueExtras';

export function CommishTools({ leagueId, onBack, onSelfUnassigned }: {
  leagueId: string;
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
    try {
      const tm = await nativeTeamState(leagueId);
      if (tm.error) { setErr(friendlyError(tm.error)); return; }
      setTeam(tm); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

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

  if (team === null && !err) {
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
  if (team && !team.is_commish) {
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
              {team?.my_roster_id != null ? 'You also manage a team — that stays in MY TEAM.' : 'You run this league without a team in it.'}
            </Mono>
          </View>
          <Pressable onPress={shareInvite} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.you }}>⇪ RECRUIT</Text>
          </Pressable>
          <Pressable onPress={() => { tap(); setSettingsOpen(true); }} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.warn }}>⚑ SETTINGS</Text>
          </Pressable>
        </View>
        {!!err && <Mono size={10} tone="opp" style={{ marginTop: 6 }}>⚠ {err}</Mono>}
      </Card>

      <CommishTeams key={`teams-${epoch}`} leagueId={leagueId} myRoster={team?.my_roster_id ?? null}
        onChanged={() => void refresh()} onSelfUnassigned={onSelfUnassigned} />

      <CommishPlayers key={`players-${epoch}`} leagueId={leagueId} onChanged={() => void refresh()} />

      <CommishSettings visible={settingsOpen} leagueId={leagueId}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => { setEpoch((n) => n + 1); void refresh(); }} />
    </ScrollView>
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
